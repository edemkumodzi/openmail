import { Hono } from "hono"
import { Cache } from "../../cache/index.js"
import * as schema from "../../cache/schema.js"
import { eq } from "drizzle-orm"

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
    // Will delegate to provider — stub
    return c.json({ ok: true })
  })

  // POST /labels/:threadId/remove — remove label from thread
  app.post("/:threadId/remove", async (c) => {
    return c.json({ ok: true })
  })

  return app
}
