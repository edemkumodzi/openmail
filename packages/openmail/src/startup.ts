/**
 * Startup orchestrator.
 *
 * Called before the TUI renders. Handles:
 * 1. Load config
 * 2. Initialize SQLite cache
 * 3. Start the Hono server
 * 4. Check for authenticated accounts
 * 5. If no accounts: prompt for credentials, run OAuth, initial sync
 * 6. If accounts exist: trigger background sync
 * 7. Register providers
 *
 * Returns the server port so the TUI can connect.
 */
import { join } from "node:path"
import { Config } from "./config/index.js"
import { Cache } from "./cache/index.js"
import { Server } from "./server/server.js"
import { OAuth } from "./auth/oauth.js"
import { CredentialStore } from "./auth/store.js"
import { ProviderRegistry } from "./provider/registry.js"
import { GmailProvider } from "./provider/gmail/index.js"
import { EventBus } from "./bus/index.js"
import * as schema from "./cache/schema.js"
import { eq } from "drizzle-orm"

export namespace Startup {
  export interface Result {
    port: number
    stop: () => void
    accountEmail: string | null
    needsAuth: boolean
  }

  /**
   * Boot the entire backend. Call this before rendering the TUI.
   */
  export async function boot(): Promise<Result> {
    const config = Config.load()
    const serverPort = config.server?.port ?? 4580

    // 1. Initialize SQLite cache
    const dbPath = join(Config.getDir(), "cache.db")
    Cache.init(dbPath)

    // 2. Start HTTP server
    const server = Server.start(serverPort)

    // 3. Check for existing accounts
    const credentials = CredentialStore.load()
    const accountIds = Object.keys(credentials)

    if (accountIds.length > 0) {
      // We have accounts — register providers and trigger sync
      for (const accountId of accountIds) {
        const cred = credentials[accountId]
        if (cred.providerId === "gmail" && config.google?.clientId) {
          registerGmailProvider(accountId, config)
          // Trigger background sync (don't await — let it run)
          triggerSync(accountId, config).catch((err) => {
            console.error(`Sync failed for ${accountId}:`, err)
          })
        }
      }

      return {
        port: server.port,
        stop: server.stop,
        accountEmail: credentials[accountIds[0]]?.email ?? null,
        needsAuth: false,
      }
    }

    // 4. No accounts — check if we have Google credentials configured
    if (!Config.hasGoogleCredentials()) {
      // No credentials at all — need interactive setup
      return {
        port: server.port,
        stop: server.stop,
        accountEmail: null,
        needsAuth: true,
      }
    }

    // 5. Have credentials but no accounts — need OAuth
    return {
      port: server.port,
      stop: server.stop,
      accountEmail: null,
      needsAuth: true,
    }
  }

  /**
   * Run the first-time auth flow interactively.
   * Opens the browser for Google OAuth consent.
   */
  export async function authenticate(config: Config.AppConfig): Promise<{
    accountId: string
    email: string
    name: string
  }> {
    if (!config.google?.clientId || !config.google?.clientSecret) {
      throw new Error("Google OAuth credentials not configured")
    }

    const callbackPort = config.server?.callbackPort ?? 4581

    const oauthConfig: OAuth.Config = {
      clientId: config.google.clientId,
      clientSecret: config.google.clientSecret,
      callbackPort,
    }

    // Run OAuth flow (opens browser)
    const tokenSet = await OAuth.authorize(oauthConfig, {
      includeCalendar: true,
    })

    // Fetch user info
    const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenSet.accessToken}` },
    })
    if (!userInfoRes.ok) {
      throw new Error(`Failed to get user info: ${userInfoRes.status}`)
    }
    const userInfo = await userInfoRes.json() as { email: string; name: string }
    const accountId = `google:${userInfo.email}`

    // Store credentials
    CredentialStore.set(accountId, {
      providerId: "gmail",
      email: userInfo.email,
      name: userInfo.name,
      tokens: tokenSet,
    })

    // Create account in database
    const db = Cache.get()
    const now = new Date()

    db.insert(schema.account)
      .values({
        id: accountId,
        providerId: "gmail",
        email: userInfo.email,
        name: userInfo.name,
        credentials: JSON.stringify({
          clientId: config.google.clientId,
          clientSecret: config.google.clientSecret,
        }),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.account.id,
        set: { name: userInfo.name, updatedAt: now },
      })
      .run()

    // Create sync state
    db.insert(schema.syncState)
      .values({ accountId, status: "idle" })
      .onConflictDoNothing()
      .run()

    // Register provider
    registerGmailProvider(accountId, config)

    // Emit event
    EventBus.emit("account.added", {
      accountId,
      email: userInfo.email,
      providerId: "gmail",
    })

    return { accountId, email: userInfo.email, name: userInfo.name }
  }

  /**
   * Run initial sync for an account.
   * Fetches folders, labels, and threads from the provider and caches them.
   */
  export async function triggerSync(
    accountId: string,
    config: Config.AppConfig
  ): Promise<void> {
    if (!config.google?.clientId || !config.google?.clientSecret) return

    const db = Cache.get()

    // Update sync state
    db.update(schema.syncState)
      .set({ status: "syncing" })
      .where(eq(schema.syncState.accountId, accountId))
      .run()

    EventBus.emit("sync.started", { accountId })

    try {
      const provider = ProviderRegistry.get("gmail")
      if (!provider) {
        throw new Error("Gmail provider not registered")
      }

      // --- 1. Sync folders and labels from provider ---
      const [providerFolders, providerLabels] = await Promise.all([
        provider.listFolders(),
        ProviderRegistry.asLabelable(provider)?.listLabels() ?? Promise.resolve([]),
      ])

      // Store folders (clear stale first)
      db.delete(schema.folder).where(eq(schema.folder.accountId, accountId)).run()
      for (const folder of providerFolders) {
        db.insert(schema.folder)
          .values({
            id: folder.id,
            accountId,
            providerFolderId: folder.id,
            name: folder.name,
            type: folder.type,
            unreadCount: folder.unreadCount,
          })
          .onConflictDoNothing()
          .run()
      }

      // Store labels (clear stale first)
      db.delete(schema.label).where(eq(schema.label.accountId, accountId)).run()
      for (const label of providerLabels) {
        db.insert(schema.label)
          .values({
            id: label.id,
            accountId,
            providerLabelId: label.id,
            name: label.name,
            color: label.color,
          })
          .onConflictDoNothing()
          .run()
      }

      // --- 2. Sync threads ---
      const syncState = db.select()
        .from(schema.syncState)
        .where(eq(schema.syncState.accountId, accountId))
        .get()

      const cursor = syncState?.cursor ?? null

      const syncable = ProviderRegistry.asIncrementallySyncable(provider)
      if (!syncable) {
        throw new Error("Gmail provider does not support incremental sync")
      }

      const result = await syncable.sync(cursor)

      // Store synced threads in cache
      for (const thread of result.threads) {
        db.insert(schema.thread)
          .values({
            id: thread.id,
            accountId,
            providerThreadId: thread.id,
            subject: thread.subject,
            snippet: thread.snippet,
            participants: thread.participants as any,
            messageCount: thread.messageCount,
            hasAttachments: thread.hasAttachments,
            unread: thread.unread,
            starred: thread.starred,
            lastMessageTime: thread.time,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: schema.thread.id,
            set: {
              subject: thread.subject,
              snippet: thread.snippet,
              participants: thread.participants as any,
              messageCount: thread.messageCount,
              hasAttachments: thread.hasAttachments,
              unread: thread.unread,
              starred: thread.starred,
              lastMessageTime: thread.time,
              updatedAt: new Date(),
            },
          })
          .run()

        // Clear stale associations for this thread
        db.delete(schema.threadFolder).where(eq(schema.threadFolder.threadId, thread.id)).run()
        db.delete(schema.threadLabel).where(eq(schema.threadLabel.threadId, thread.id)).run()

        // Store folder associations (IDs are already prefixed: "folder:INBOX")
        for (const folderId of thread.folders) {
          db.insert(schema.threadFolder)
            .values({ threadId: thread.id, folderId })
            .onConflictDoNothing()
            .run()
        }

        // Store label associations (IDs are already prefixed: "label:Label_123")
        for (const labelId of thread.labels) {
          db.insert(schema.threadLabel)
            .values({ threadId: thread.id, labelId })
            .onConflictDoNothing()
            .run()
        }
      }

      // Handle deleted threads
      for (const deletedId of result.deletedThreadIds) {
        db.delete(schema.threadFolder)
          .where(eq(schema.threadFolder.threadId, deletedId))
          .run()
        db.delete(schema.threadLabel)
          .where(eq(schema.threadLabel.threadId, deletedId))
          .run()
        db.delete(schema.message)
          .where(eq(schema.message.threadId, deletedId))
          .run()
        db.delete(schema.thread)
          .where(eq(schema.thread.id, deletedId))
          .run()
      }

      // Update sync state
      db.update(schema.syncState)
        .set({
          cursor: result.newCursor,
          lastSync: new Date(),
          status: "idle",
          error: null,
        })
        .where(eq(schema.syncState.accountId, accountId))
        .run()

      EventBus.emit("sync.completed", {
        accountId,
        threadsUpdated: result.threads.length,
        threadsDeleted: result.deletedThreadIds.length,
      })

    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error"
      db.update(schema.syncState)
        .set({ status: "error", error: message })
        .where(eq(schema.syncState.accountId, accountId))
        .run()

      EventBus.emit("sync.error", { accountId, error: message })
      throw err
    }
  }

  // --- Helpers ---

  function registerGmailProvider(accountId: string, config: Config.AppConfig): void {
    if (!config.google?.clientId || !config.google?.clientSecret) return

    const provider = GmailProvider.create(accountId, {
      clientId: config.google.clientId,
      clientSecret: config.google.clientSecret,
      callbackPort: config.server?.callbackPort ?? 4581,
    })

    ProviderRegistry.register(provider)
  }


}
