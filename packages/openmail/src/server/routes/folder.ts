import { Hono } from "hono"
import { Cache } from "../../cache/index.js"
import * as schema from "../../cache/schema.js"
import { eq } from "drizzle-orm"

export function folderRoutes(): Hono {
  const app = new Hono()

  // GET /folders — list folders for an account
  app.get("/", async (c) => {
    const db = Cache.get()
    const accountId = c.req.query("accountId")

    const where = accountId ? eq(schema.folder.accountId, accountId) : undefined
    const folders = db.select().from(schema.folder).where(where).all()

    return c.json({
      items: folders.map((f) => ({
        id: f.id,
        name: f.name,
        type: f.type,
        unreadCount: f.unreadCount,
      })),
    })
  })

  return app
}
