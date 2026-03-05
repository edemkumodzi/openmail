import { Hono } from "hono"
import { Cache } from "../../cache/index.js"
import * as schema from "../../cache/schema.js"
import { eq, desc, and, inArray } from "drizzle-orm"
import { ProviderRegistry } from "../../provider/registry.js"

export function threadRoutes(): Hono {
  const app = new Hono()

  // GET /threads — list threads with optional folder/label filter
  app.get("/", async (c) => {
    const db = Cache.get()
    const accountId = c.req.query("accountId")
    const folderId = c.req.query("folderId")
    const labelId = c.req.query("labelId")
    const limit = parseInt(c.req.query("limit") ?? "50", 10)
    const cursor = c.req.query("cursor")

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

    // Build query
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
      messages: messages.map((m) => ({
        id: m.id,
        threadId: m.threadId,
        from: { name: m.fromName, email: m.fromEmail },
        to: m.toRecipients,
        cc: m.ccRecipients,
        bcc: m.bccRecipients,
        replyTo: m.replyTo,
        subject: m.subject,
        body: { text: m.bodyText, html: m.bodyHtml ?? undefined },
        attachments: m.attachments,
        time: m.time,
        unread: m.unread,
        messageIdHeader: m.messageIdHeader,
        inReplyTo: m.inReplyTo,
      })),
    })
  })

  // POST /threads/:id/archive
  app.post("/:id/archive", async (c) => {
    // Will delegate to provider — stub for now
    return c.json({ ok: true })
  })

  // POST /threads/:id/trash
  app.post("/:id/trash", async (c) => {
    return c.json({ ok: true })
  })

  // POST /threads/:id/star
  app.post("/:id/star", async (c) => {
    return c.json({ ok: true })
  })

  // POST /threads/:id/unstar
  app.post("/:id/unstar", async (c) => {
    return c.json({ ok: true })
  })

  // POST /threads/:id/read
  app.post("/:id/read", async (c) => {
    return c.json({ ok: true })
  })

  // POST /threads/:id/unread
  app.post("/:id/unread", async (c) => {
    return c.json({ ok: true })
  })

  return app
}
