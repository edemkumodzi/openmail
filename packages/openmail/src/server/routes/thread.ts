import { Hono } from "hono"
import { Cache } from "../../cache/index.js"
import * as schema from "../../cache/schema.js"
import { eq, desc, and, inArray } from "drizzle-orm"
import { ProviderRegistry } from "../../provider/registry.js"
import { EventBus } from "../../bus/index.js"
import { Mime } from "../../provider/gmail/mime.js"
import { Mail } from "../../mail/types.js"

/**
 * Look up a thread in the cache and resolve its provider.
 * Returns the thread row and provider plugin, or an error response.
 */
function resolveThreadAndProvider(threadId: string) {
  const db = Cache.get()
  const t = db.select().from(schema.thread).where(eq(schema.thread.id, threadId)).get()
  if (!t) return { error: "Thread not found" as const }

  const acct = db.select({ providerId: schema.account.providerId })
    .from(schema.account)
    .where(eq(schema.account.id, t.accountId))
    .get()

  const providerId = acct?.providerId ?? "gmail"
  const provider = ProviderRegistry.get(providerId)

  return { thread: t, provider, providerId }
}

/**
 * Cache a list of thread summaries from a provider fetch.
 * Upserts threads and their folder/label associations.
 */
function cacheThreadSummaries(threads: Mail.ThreadSummary[], accountId: string) {
  const db = Cache.get()
  const now = new Date()

  for (const thread of threads) {
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
        createdAt: now,
        updatedAt: now,
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
          updatedAt: now,
        },
      })
      .run()

    // Refresh folder/label associations
    db.delete(schema.threadFolder).where(eq(schema.threadFolder.threadId, thread.id)).run()
    db.delete(schema.threadLabel).where(eq(schema.threadLabel.threadId, thread.id)).run()

    for (const folderId of thread.folders) {
      db.insert(schema.threadFolder)
        .values({ threadId: thread.id, folderId })
        .onConflictDoNothing()
        .run()
    }
    for (const labelId of thread.labels) {
      db.insert(schema.threadLabel)
        .values({ threadId: thread.id, labelId })
        .onConflictDoNothing()
        .run()
    }
  }
}

export function threadRoutes(): Hono {
  const app = new Hono()

  // GET /threads — list threads with optional folder/label filter
  // If the cache has no threads for the requested folder/label,
  // fetches on-demand from the provider and caches them.
  app.get("/", async (c) => {
    const db = Cache.get()
    const accountId = c.req.query("accountId")
    const folderId = c.req.query("folderId")
    const labelId = c.req.query("labelId")
    const limit = parseInt(c.req.query("limit") ?? "50", 10)
    const cursor = c.req.query("cursor")
    const refresh = c.req.query("refresh") === "true"

    let threadIds: string[] | undefined

    // Filter by folder
    if (folderId) {
      const links = db.select({ threadId: schema.threadFolder.threadId })
        .from(schema.threadFolder)
        .where(eq(schema.threadFolder.folderId, folderId))
        .all()
      threadIds = links.map((l) => l.threadId)
    }

    // Filter by label
    if (labelId) {
      const links = db.select({ threadId: schema.threadLabel.threadId })
        .from(schema.threadLabel)
        .where(eq(schema.threadLabel.labelId, labelId))
        .all()
      const labelThreadIds = links.map((l) => l.threadId)
      threadIds = threadIds ? threadIds.filter((id) => labelThreadIds.includes(id)) : labelThreadIds
    }

    // On-demand provider fetch: if cache is empty for this folder/label,
    // fetch from the provider, cache results, then serve from cache.
    const cacheEmpty = threadIds !== undefined && threadIds.length === 0
    if ((cacheEmpty || refresh) && (folderId || labelId)) {
      try {
        // Find the account to use (first active account if not specified)
        const acct = accountId
          ? db.select().from(schema.account).where(eq(schema.account.id, accountId)).get()
          : db.select().from(schema.account).limit(1).get()

        if (acct) {
          const provider = ProviderRegistry.get(acct.providerId)
          const result = await provider.list({
            folderId: folderId ?? undefined,
            labelId: labelId ?? undefined,
            limit,
            cursor: cursor ?? undefined,
          })

          if (result.items.length > 0) {
            cacheThreadSummaries(result.items, acct.id)

            // Return the freshly fetched data directly
            return c.json({
              items: result.items.map((t) => ({
                ...t,
                time: t.time,
                linkedEventIds: t.linkedEventIds ?? [],
              })),
              hasMore: result.hasMore,
            })
          }
        }
      } catch (err) {
        console.error(`On-demand fetch failed for folder=${folderId} label=${labelId}:`, err)
        // Fall through to return empty cache result
      }
    }

    // Build query from cache
    let conditions = []
    if (accountId) conditions.push(eq(schema.thread.accountId, accountId))
    if (threadIds !== undefined) {
      if (threadIds.length === 0) {
        return c.json({ items: [], hasMore: false })
      }
      conditions.push(inArray(schema.thread.id, threadIds))
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined

    const threads = db.select()
      .from(schema.thread)
      .where(where)
      .orderBy(desc(schema.thread.lastMessageTime))
      .limit(limit + 1)
      .all()

    const hasMore = threads.length > limit
    const items = hasMore ? threads.slice(0, limit) : threads

    // Enrich with folders and labels
    const enriched = items.map((t) => {
      const folderLinks = db.select({ folderId: schema.threadFolder.folderId })
        .from(schema.threadFolder)
        .where(eq(schema.threadFolder.threadId, t.id))
        .all()
      const labelLinks = db.select({ labelId: schema.threadLabel.labelId })
        .from(schema.threadLabel)
        .where(eq(schema.threadLabel.threadId, t.id))
        .all()

      return {
        id: t.id,
        accountId: t.accountId,
        subject: t.subject,
        snippet: t.snippet,
        participants: t.participants,
        messageCount: t.messageCount,
        hasAttachments: t.hasAttachments,
        folders: folderLinks.map((l) => l.folderId),
        labels: labelLinks.map((l) => l.labelId),
        unread: t.unread,
        starred: t.starred,
        time: t.lastMessageTime,
        linkedEventIds: [],
      }
    })

    return c.json({ items: enriched, hasMore })
  })

  // GET /threads/:id — get thread detail with messages
  // If messages aren't cached, fetches from provider and caches them.
  app.get("/:id", async (c) => {
    const db = Cache.get()
    const threadId = c.req.param("id")

    const t = db.select().from(schema.thread).where(eq(schema.thread.id, threadId)).get()
    if (!t) return c.json({ error: "Thread not found" }, 404)

    let messages = db.select()
      .from(schema.message)
      .where(eq(schema.message.threadId, threadId))
      .orderBy(schema.message.time)
      .all()

    // Re-fetch if no messages cached OR if all cached messages have empty body
    // (stale cache from previous buggy HTML stripping)
    const allBodiesEmpty = messages.length > 0 && messages.every((m) => !m.bodyText || m.bodyText.trim().length === 0)
    if (messages.length === 0 || allBodiesEmpty) {
      // Clear stale cached messages before re-fetching
      if (allBodiesEmpty) {
        db.delete(schema.message).where(eq(schema.message.threadId, threadId)).run()
      }
      try {
        const provider = ProviderRegistry.get(
          db.select({ providerId: schema.account.providerId })
            .from(schema.account)
            .where(eq(schema.account.id, t.accountId))
            .get()?.providerId ?? "gmail"
        )

        const detail = await provider.getThread(threadId)

        // Cache the messages for next time
        for (const msg of detail.messages) {
          db.insert(schema.message)
            .values({
              id: msg.id,
              threadId: msg.threadId,
              accountId: t.accountId,
              providerMessageId: msg.id,
              fromName: msg.from.name,
              fromEmail: msg.from.email,
              toRecipients: msg.to as any,
              ccRecipients: msg.cc as any,
              bccRecipients: (msg.bcc ?? []) as any,
              replyTo: msg.replyTo as any,
              subject: msg.subject,
              bodyText: msg.body.text,
              bodyHtml: msg.body.html ?? null,
              attachments: msg.attachments as any,
              time: msg.time,
              unread: msg.unread,
              messageIdHeader: msg.messageIdHeader ?? null,
              inReplyTo: msg.inReplyTo ?? null,
            })
            .onConflictDoNothing()
            .run()
        }

        // Return the provider data directly (already in canonical format)
        const folderLinks = db.select({ folderId: schema.threadFolder.folderId })
          .from(schema.threadFolder)
          .where(eq(schema.threadFolder.threadId, threadId))
          .all()
        const labelLinks = db.select({ labelId: schema.threadLabel.labelId })
          .from(schema.threadLabel)
          .where(eq(schema.threadLabel.threadId, threadId))
          .all()

        return c.json({
          id: detail.id,
          accountId: t.accountId,
          subject: detail.subject,
          snippet: detail.snippet,
          participants: detail.participants,
          messageCount: detail.messageCount,
          hasAttachments: detail.hasAttachments,
          folders: folderLinks.map((l) => l.folderId),
          labels: labelLinks.map((l) => l.labelId),
          unread: detail.unread,
          starred: detail.starred,
          time: detail.time,
          linkedEventIds: [],
          messages: detail.messages.map((m) => ({
            id: m.id,
            threadId: m.threadId,
            from: m.from,
            to: m.to,
            cc: m.cc,
            bcc: m.bcc ?? [],
            replyTo: m.replyTo,
            subject: m.subject,
            body: m.body,
            attachments: m.attachments,
            time: m.time,
            unread: m.unread,
            messageIdHeader: m.messageIdHeader,
            inReplyTo: m.inReplyTo,
          })),
        })
      } catch (err) {
        // Provider fetch failed — return thread without messages
        console.error(`Failed to fetch thread ${threadId} from provider:`, err)
      }
    }

    const folderLinks = db.select({ folderId: schema.threadFolder.folderId })
      .from(schema.threadFolder)
      .where(eq(schema.threadFolder.threadId, threadId))
      .all()
    const labelLinks = db.select({ labelId: schema.threadLabel.labelId })
      .from(schema.threadLabel)
      .where(eq(schema.threadLabel.threadId, threadId))
      .all()

    // Get linked events
    const eventLinks = db.select({ eventId: schema.eventThread.eventId })
      .from(schema.eventThread)
      .where(eq(schema.eventThread.threadId, threadId))
      .all()

    return c.json({
      id: t.id,
      accountId: t.accountId,
      subject: t.subject,
      snippet: t.snippet,
      participants: t.participants,
      messageCount: t.messageCount,
      hasAttachments: t.hasAttachments,
      folders: folderLinks.map((l) => l.folderId),
      labels: labelLinks.map((l) => l.labelId),
      unread: t.unread,
      starred: t.starred,
      time: t.lastMessageTime,
      linkedEventIds: eventLinks.map((l) => l.eventId),
      messages: messages.map((m) => {
        // Re-strip HTML on the fly so cached messages benefit from
        // improved stripHtml and link extraction
        const stripped = m.bodyHtml ? Mime.stripHtml(m.bodyHtml) : null
        // If we have both text/plain and HTML, use text/plain but clean bare URLs
        let bodyText = m.bodyText
        if (stripped && m.bodyText) {
          bodyText = Mime.cleanTextWithLinks(m.bodyText, stripped.links)
        } else if (stripped) {
          bodyText = stripped.text
        }
        return {
          id: m.id,
          threadId: m.threadId,
          from: { name: m.fromName, email: m.fromEmail },
          to: m.toRecipients,
          cc: m.ccRecipients,
          bcc: m.bccRecipients,
          replyTo: m.replyTo,
          subject: m.subject,
          body: {
            text: bodyText,
            html: m.bodyHtml ?? undefined,
            links: stripped ? stripped.links : [],
          },
          attachments: m.attachments,
          time: m.time,
          unread: m.unread,
          messageIdHeader: m.messageIdHeader,
          inReplyTo: m.inReplyTo,
        }
      }),
    })
  })

  // POST /threads/:id/archive — remove from inbox
  app.post("/:id/archive", async (c) => {
    const threadId = c.req.param("id")
    const result = resolveThreadAndProvider(threadId)
    if ("error" in result) return c.json({ error: result.error }, 404)

    try {
      await result.provider.archive(threadId)

      // Update cache: remove from inbox folder
      const db = Cache.get()
      db.delete(schema.threadFolder)
        .where(and(
          eq(schema.threadFolder.threadId, threadId),
          eq(schema.threadFolder.folderId, "folder:INBOX"),
        ))
        .run()

      EventBus.emit("thread.updated", { threadId, action: "archive" }, result.thread.accountId)
      return c.json({ ok: true })
    } catch (err) {
      console.error(`Failed to archive thread ${threadId}:`, err)
      return c.json({ error: "Archive failed" }, 500)
    }
  })

  // POST /threads/:id/trash — move to trash
  app.post("/:id/trash", async (c) => {
    const threadId = c.req.param("id")
    const result = resolveThreadAndProvider(threadId)
    if ("error" in result) return c.json({ error: result.error }, 404)

    try {
      await result.provider.trash(threadId)

      // Update cache: remove all folder associations, add trash
      const db = Cache.get()
      db.delete(schema.threadFolder)
        .where(eq(schema.threadFolder.threadId, threadId))
        .run()

      // Add to trash folder (if it exists in cache)
      const trashFolder = db.select().from(schema.folder)
        .where(eq(schema.folder.id, "folder:TRASH"))
        .get()
      if (trashFolder) {
        db.insert(schema.threadFolder)
          .values({ threadId, folderId: "folder:TRASH" })
          .onConflictDoNothing()
          .run()
      }

      EventBus.emit("thread.updated", { threadId, action: "trash" }, result.thread.accountId)
      return c.json({ ok: true })
    } catch (err) {
      console.error(`Failed to trash thread ${threadId}:`, err)
      return c.json({ error: "Trash failed" }, 500)
    }
  })

  // POST /threads/:id/star
  app.post("/:id/star", async (c) => {
    const threadId = c.req.param("id")
    const result = resolveThreadAndProvider(threadId)
    if ("error" in result) return c.json({ error: result.error }, 404)

    try {
      await result.provider.star(threadId)

      // Update cache
      const db = Cache.get()
      db.update(schema.thread)
        .set({ starred: true, updatedAt: new Date() })
        .where(eq(schema.thread.id, threadId))
        .run()

      EventBus.emit("thread.updated", { threadId, action: "star" }, result.thread.accountId)
      return c.json({ ok: true })
    } catch (err) {
      console.error(`Failed to star thread ${threadId}:`, err)
      return c.json({ error: "Star failed" }, 500)
    }
  })

  // POST /threads/:id/unstar
  app.post("/:id/unstar", async (c) => {
    const threadId = c.req.param("id")
    const result = resolveThreadAndProvider(threadId)
    if ("error" in result) return c.json({ error: result.error }, 404)

    try {
      await result.provider.unstar(threadId)

      // Update cache
      const db = Cache.get()
      db.update(schema.thread)
        .set({ starred: false, updatedAt: new Date() })
        .where(eq(schema.thread.id, threadId))
        .run()

      EventBus.emit("thread.updated", { threadId, action: "unstar" }, result.thread.accountId)
      return c.json({ ok: true })
    } catch (err) {
      console.error(`Failed to unstar thread ${threadId}:`, err)
      return c.json({ error: "Unstar failed" }, 500)
    }
  })

  // POST /threads/:id/read — mark all messages in thread as read
  app.post("/:id/read", async (c) => {
    const threadId = c.req.param("id")
    const result = resolveThreadAndProvider(threadId)
    if ("error" in result) return c.json({ error: result.error }, 404)

    try {
      // Get message IDs for this thread (provider.markRead takes message IDs)
      const db = Cache.get()
      const messages = db.select({ id: schema.message.id })
        .from(schema.message)
        .where(eq(schema.message.threadId, threadId))
        .all()

      if (messages.length > 0) {
        await result.provider.markRead(messages.map((m) => m.id))
      }

      // Update cache: thread + messages
      db.update(schema.thread)
        .set({ unread: false, updatedAt: new Date() })
        .where(eq(schema.thread.id, threadId))
        .run()
      db.update(schema.message)
        .set({ unread: false })
        .where(eq(schema.message.threadId, threadId))
        .run()

      EventBus.emit("thread.updated", { threadId, action: "read" }, result.thread.accountId)
      return c.json({ ok: true })
    } catch (err) {
      console.error(`Failed to mark thread ${threadId} as read:`, err)
      return c.json({ error: "Mark read failed" }, 500)
    }
  })

  // POST /threads/:id/unread — mark thread as unread
  app.post("/:id/unread", async (c) => {
    const threadId = c.req.param("id")
    const result = resolveThreadAndProvider(threadId)
    if ("error" in result) return c.json({ error: result.error }, 404)

    try {
      // Get message IDs — mark all as unread
      const db = Cache.get()
      const messages = db.select({ id: schema.message.id })
        .from(schema.message)
        .where(eq(schema.message.threadId, threadId))
        .all()

      if (messages.length > 0) {
        await result.provider.markUnread(messages.map((m) => m.id))
      }

      // Update cache
      db.update(schema.thread)
        .set({ unread: true, updatedAt: new Date() })
        .where(eq(schema.thread.id, threadId))
        .run()
      db.update(schema.message)
        .set({ unread: true })
        .where(eq(schema.message.threadId, threadId))
        .run()

      EventBus.emit("thread.updated", { threadId, action: "unread" }, result.thread.accountId)
      return c.json({ ok: true })
    } catch (err) {
      console.error(`Failed to mark thread ${threadId} as unread:`, err)
      return c.json({ error: "Mark unread failed" }, 500)
    }
  })

  return app
}
