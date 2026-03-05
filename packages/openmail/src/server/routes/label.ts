import { Hono } from "hono"
import { Cache } from "../../cache/index.js"
import * as schema from "../../cache/schema.js"
import { eq, and } from "drizzle-orm"
import { ProviderRegistry } from "../../provider/registry.js"
import { EventBus } from "../../bus/index.js"

export function labelRoutes(): Hono {
  const app = new Hono()

  // GET /labels — list labels for an account
  app.get("/", async (c) => {
    const db = Cache.get()
    const accountId = c.req.query("accountId")

    const where = accountId ? eq(schema.label.accountId, accountId) : undefined
    const labels = db.select().from(schema.label).where(where).all()

    return c.json({
      items: labels.map((l) => ({
        id: l.id,
        name: l.name,
        color: l.color ?? "#888888",
      })),
    })
  })

  // POST /labels/:threadId/add — add label to thread
  app.post("/:threadId/add", async (c) => {
    const threadId = c.req.param("threadId")
    const body = await c.req.json<{ labelId: string }>().catch(() => ({ labelId: "" }))
    if (!body.labelId) return c.json({ error: "labelId required" }, 400)

    const db = Cache.get()
    const t = db.select().from(schema.thread).where(eq(schema.thread.id, threadId)).get()
    if (!t) return c.json({ error: "Thread not found" }, 404)

    // Get provider
    const acct = db.select({ providerId: schema.account.providerId })
      .from(schema.account)
      .where(eq(schema.account.id, t.accountId))
      .get()

    try {
      const provider = ProviderRegistry.get(acct?.providerId ?? "gmail")
      const labelable = ProviderRegistry.asLabelable(provider)
      if (!labelable) return c.json({ error: "Provider does not support labels" }, 400)

      await labelable.addLabel(threadId, body.labelId)

      // Update cache: add to thread_label join table
      db.insert(schema.threadLabel)
        .values({ threadId, labelId: body.labelId })
        .onConflictDoNothing()
        .run()

      EventBus.emit("thread.updated", { threadId, action: "addLabel", labelId: body.labelId }, t.accountId)
      return c.json({ ok: true })
    } catch (err) {
      console.error(`Failed to add label ${body.labelId} to thread ${threadId}:`, err)
      return c.json({ error: "Add label failed" }, 500)
    }
  })

  // POST /labels/:threadId/remove — remove label from thread
  app.post("/:threadId/remove", async (c) => {
    const threadId = c.req.param("threadId")
    const body = await c.req.json<{ labelId: string }>().catch(() => ({ labelId: "" }))
    if (!body.labelId) return c.json({ error: "labelId required" }, 400)

    const db = Cache.get()
    const t = db.select().from(schema.thread).where(eq(schema.thread.id, threadId)).get()
    if (!t) return c.json({ error: "Thread not found" }, 404)

    const acct = db.select({ providerId: schema.account.providerId })
      .from(schema.account)
      .where(eq(schema.account.id, t.accountId))
      .get()

    try {
      const provider = ProviderRegistry.get(acct?.providerId ?? "gmail")
      const labelable = ProviderRegistry.asLabelable(provider)
      if (!labelable) return c.json({ error: "Provider does not support labels" }, 400)

      await labelable.removeLabel(threadId, body.labelId)

      // Update cache: remove from thread_label join table
      db.delete(schema.threadLabel)
        .where(and(
          eq(schema.threadLabel.threadId, threadId),
          eq(schema.threadLabel.labelId, body.labelId),
        ))
        .run()

      EventBus.emit("thread.updated", { threadId, action: "removeLabel", labelId: body.labelId }, t.accountId)
      return c.json({ ok: true })
    } catch (err) {
      console.error(`Failed to remove label ${body.labelId} from thread ${threadId}:`, err)
      return c.json({ error: "Remove label failed" }, 500)
    }
  })

  return app
}
