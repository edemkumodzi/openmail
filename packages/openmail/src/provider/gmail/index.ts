/**
 * Gmail provider plugin.
 *
 * Implements MailProvider.Plugin + all capability extensions:
 * - Searchable (Gmail's powerful query syntax)
 * - Labelable (multi-label system)
 * - IncrementallySyncable (history-based delta sync)
 * - Draftable (server-side draft storage)
 *
 * Does NOT implement Pushable (requires Google Cloud Pub/Sub setup).
 */
import { Mail } from "../../mail/types.js"
import { MailProvider } from "../types.js"
import { OAuth } from "../../auth/oauth.js"
import { CredentialStore } from "../../auth/store.js"
import { GmailApi } from "./api.js"
import { GmailMapping } from "./mapping.js"
import { GmailSync } from "./sync.js"

export namespace GmailProvider {
  export interface Config {
    clientId: string
    clientSecret: string
    callbackPort?: number
  }

  export function create(accountId: string, config: Config): Plugin {
    return new Plugin(accountId, config)
  }

  export class Plugin implements
    MailProvider.Plugin,
    MailProvider.Searchable,
    MailProvider.Labelable,
    MailProvider.IncrementallySyncable
  {
    readonly info: MailProvider.Info = {
      id: "gmail",
      name: "Gmail",
      capabilities: [
        "threads",
        "labels",
        "search",
        "incremental-sync",
        "drafts",
      ],
    }

    private client: ReturnType<typeof GmailApi.createClient> | null = null
    private accountId: string
    private config: Config

    constructor(accountId: string, config: Config) {
      this.accountId = accountId
      this.config = config
    }

    private getClient(): ReturnType<typeof GmailApi.createClient> {
      if (!this.client) {
        this.client = GmailApi.createClient({
          accountId: this.accountId,
          clientId: this.config.clientId,
          clientSecret: this.config.clientSecret,
          callbackPort: this.config.callbackPort,
        })
      }
      return this.client
    }

    // --- Lifecycle ---

    async auth(): Promise<Mail.AuthResult> {
      const tokenSet = await OAuth.authorize(this.config, {
        includeCalendar: false,
      })

      // Fetch user info
      const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokenSet.accessToken}` },
      })
      const userInfo = await userInfoRes.json() as { email: string; name: string }

      this.accountId = `google:${userInfo.email}`

      CredentialStore.set(this.accountId, {
        providerId: "gmail",
        email: userInfo.email,
        name: userInfo.name,
        tokens: tokenSet,
      })

      // Reset client to use new credentials
      this.client = null

      return {
        accountId: this.accountId,
        email: userInfo.email,
        name: userInfo.name,
        accessToken: tokenSet.accessToken,
        refreshToken: tokenSet.refreshToken,
        expiresAt: new Date(tokenSet.expiresAt),
      }
    }

    async disconnect(): Promise<void> {
      CredentialStore.remove(this.accountId)
      this.client = null
    }

    // --- Read ---

    async list(opts: MailProvider.ListOptions): Promise<Mail.Paginated<Mail.ThreadSummary>> {
      const client = this.getClient()
      const labelIds: string[] = []

      if (opts.folderId) {
        labelIds.push(GmailMapping.folderIdToGmailLabelId(opts.folderId))
      }
      if (opts.labelId) {
        labelIds.push(GmailMapping.folderIdToGmailLabelId(opts.labelId))
      }
      if (labelIds.length === 0) {
        labelIds.push("INBOX") // default to inbox
      }

      const res = await GmailApi.listThreads(client, {
        labelIds,
        maxResults: opts.limit ?? 50,
        pageToken: opts.cursor,
      })

      // Fetch thread metadata in parallel batches
      // Using "metadata" format — includes headers and labelIds but not body data,
      // which is all we need for summaries and is much faster than "full".
      const BATCH_SIZE = 10
      const threads: Mail.ThreadSummary[] = []
      const threadIds = res.threads.map((t) => t.id).filter(Boolean) as string[]

      for (let i = 0; i < threadIds.length; i += BATCH_SIZE) {
        const batch = threadIds.slice(i, i + BATCH_SIZE)
        const results = await Promise.allSettled(
          batch.map((id) => GmailApi.getThread(client, id, "metadata"))
        )
        for (const result of results) {
          if (result.status === "fulfilled") {
            threads.push(GmailMapping.threadToSummary(result.value, this.accountId))
          }
        }
      }

      return {
        items: threads,
        nextCursor: res.nextPageToken,
        hasMore: !!res.nextPageToken,
      }
    }

    async getThread(id: string): Promise<Mail.ThreadDetail> {
      const client = this.getClient()
      const thread = await GmailApi.getThread(client, id, "full")
      return GmailMapping.threadToDetail(thread, this.accountId)
    }

    async getMessage(id: string): Promise<Mail.MessageDetail> {
      const client = this.getClient()
      const message = await GmailApi.getMessage(client, id, "full")
      return GmailMapping.messageToDetail(message, this.accountId)
    }

    // --- Write ---

    async send(msg: Mail.OutgoingMessage): Promise<{ id: string }> {
      const client = this.getClient()
      const stored = CredentialStore.get(this.accountId)
      if (!stored) throw new Error("No credentials found")

      const raw = GmailApi.buildRawMessage({
        from: { name: stored.name, email: stored.email },
        to: msg.to,
        cc: msg.cc,
        bcc: msg.bcc,
        subject: msg.subject,
        body: msg.body,
        inReplyTo: msg.inReplyTo,
      })

      const result = await GmailApi.sendMessage(client, raw)
      return { id: result.id! }
    }

    async reply(threadId: string, msg: Mail.OutgoingMessage): Promise<{ id: string }> {
      const client = this.getClient()
      const stored = CredentialStore.get(this.accountId)
      if (!stored) throw new Error("No credentials found")

      const raw = GmailApi.buildRawMessage({
        from: { name: stored.name, email: stored.email },
        to: msg.to,
        cc: msg.cc,
        bcc: msg.bcc,
        subject: msg.subject,
        body: msg.body,
        inReplyTo: msg.inReplyTo,
      })

      const result = await GmailApi.sendMessage(client, raw, threadId)
      return { id: result.id! }
    }

    // --- Organize ---

    async archive(threadId: string): Promise<void> {
      const client = this.getClient()
      await GmailApi.modifyThread(client, threadId, {
        removeLabelIds: ["INBOX"],
      })
    }

    async trash(threadId: string): Promise<void> {
      const client = this.getClient()
      await GmailApi.trashThread(client, threadId)
    }

    async markRead(ids: string[]): Promise<void> {
      const client = this.getClient()
      await GmailApi.batchModifyMessages(client, ids, {
        removeLabelIds: ["UNREAD"],
      })
    }

    async markUnread(ids: string[]): Promise<void> {
      const client = this.getClient()
      await GmailApi.batchModifyMessages(client, ids, {
        addLabelIds: ["UNREAD"],
      })
    }

    async star(threadId: string): Promise<void> {
      const client = this.getClient()
      await GmailApi.modifyThread(client, threadId, {
        addLabelIds: ["STARRED"],
      })
    }

    async unstar(threadId: string): Promise<void> {
      const client = this.getClient()
      await GmailApi.modifyThread(client, threadId, {
        removeLabelIds: ["STARRED"],
      })
    }

    // --- Folders ---

    async listFolders(): Promise<Mail.Folder[]> {
      const client = this.getClient()
      const labels = await GmailApi.listLabels(client)
      const { folders } = GmailMapping.labelsToFoldersAndLabels(labels, this.accountId)
      return folders
    }

    async moveToFolder(threadId: string, folderId: string): Promise<void> {
      const client = this.getClient()
      const gmailLabelId = GmailMapping.folderIdToGmailLabelId(folderId)
      await GmailApi.modifyThread(client, threadId, {
        addLabelIds: [gmailLabelId],
        // Gmail doesn't really have "move" — we add the new label.
        // To truly move, we'd also remove the current folder label.
      })
    }

    // --- Searchable ---

    async search(
      query: string,
      opts?: MailProvider.SearchOptions
    ): Promise<Mail.Paginated<Mail.ThreadSummary>> {
      const client = this.getClient()
      const res = await GmailApi.searchThreads(client, query, {
        maxResults: opts?.limit ?? 50,
        pageToken: opts?.cursor,
      })

      const threads: Mail.ThreadSummary[] = []
      for (const thread of res.threads) {
        if (thread.id) {
          try {
            const full = await GmailApi.getThread(client, thread.id, "full")
            threads.push(GmailMapping.threadToSummary(full, this.accountId))
          } catch (err) {
            console.error(`Failed to fetch thread ${thread.id}:`, err)
          }
        }
      }

      return {
        items: threads,
        nextCursor: res.nextPageToken,
        hasMore: !!res.nextPageToken,
      }
    }

    searchSyntaxHint(): string {
      return "Gmail search syntax: from:alice subject:meeting has:attachment is:unread after:2024/01/01"
    }

    // --- Labelable ---

    async listLabels(): Promise<Mail.Label[]> {
      const client = this.getClient()
      const labels = await GmailApi.listLabels(client)
      const { labels: userLabels } = GmailMapping.labelsToFoldersAndLabels(labels, this.accountId)
      return userLabels
    }

    async createLabel(name: string, color?: string): Promise<Mail.Label> {
      const client = this.getClient()
      const res = await client.gmail.users.labels.create({
        userId: "me",
        requestBody: {
          name,
          labelListVisibility: "labelShow",
          messageListVisibility: "show",
          ...(color ? {
            color: {
              backgroundColor: color,
              textColor: "#ffffff",
            },
          } : {}),
        },
      })

      return {
        id: `label:${res.data.id}`,
        name: res.data.name!,
        color: color ?? "#888888",
      }
    }

    async deleteLabel(id: string): Promise<void> {
      const client = this.getClient()
      const gmailId = GmailMapping.folderIdToGmailLabelId(id)
      await client.gmail.users.labels.delete({
        userId: "me",
        id: gmailId,
      })
    }

    async addLabel(threadId: string, labelId: string): Promise<void> {
      const client = this.getClient()
      const gmailId = GmailMapping.folderIdToGmailLabelId(labelId)
      await GmailApi.modifyThread(client, threadId, {
        addLabelIds: [gmailId],
      })
    }

    async removeLabel(threadId: string, labelId: string): Promise<void> {
      const client = this.getClient()
      const gmailId = GmailMapping.folderIdToGmailLabelId(labelId)
      await GmailApi.modifyThread(client, threadId, {
        removeLabelIds: [gmailId],
      })
    }

    // --- IncrementallySyncable ---

    async sync(cursor: string | null): Promise<Mail.SyncResult> {
      const client = this.getClient()

      if (!cursor) {
        // Full sync — no previous cursor
        const result = await GmailSync.fullSync(client)
        const threads = result.threads.map((t) =>
          GmailMapping.threadToSummary(t, this.accountId)
        )

        return {
          newCursor: result.historyId,
          threads,
          deletedThreadIds: [],
          hasMore: false,
        }
      }

      try {
        // Incremental sync
        const changes = await GmailSync.incrementalSync(client, cursor)

        // Fetch updated threads
        const updatedThreads = await GmailSync.fetchThreads(client, changes.updatedThreadIds)
        const threads = updatedThreads.map((t) =>
          GmailMapping.threadToSummary(t, this.accountId)
        )

        return {
          newCursor: changes.newHistoryId,
          threads,
          deletedThreadIds: changes.deletedThreadIds,
          hasMore: changes.hasMore,
        }
      } catch (err) {
        if (err instanceof GmailSync.HistoryExpiredError) {
          // Fall back to full sync
          const result = await GmailSync.fullSync(client)
          const threads = result.threads.map((t) =>
            GmailMapping.threadToSummary(t, this.accountId)
          )

          return {
            newCursor: result.historyId,
            threads,
            deletedThreadIds: [],
            hasMore: false,
          }
        }
        throw err
      }
    }
  }
}

// Re-export submodules for direct access
export { GmailApi } from "./api.js"
export { GmailMapping } from "./mapping.js"
export { GmailSync } from "./sync.js"
export { Mime } from "./mime.js"
