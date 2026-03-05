import { Hono } from "hono"
import { Cache } from "../../cache/index.js"
import * as schema from "../../cache/schema.js"
import { eq } from "drizzle-orm"

export function accountRoutes(): Hono {
  const app = new Hono()

  // GET /accounts — list all accounts
  app.get("/", async (c) => {
    const db = Cache.get()
    const accounts = db.select().from(schema.account).all()

    return c.json({
      items: accounts.map((a) => ({
        id: a.id,
        providerId: a.providerId,
        email: a.email,
        name: a.name,
        active: a.active,
      })),
    })
  })

  // GET /accounts/:id — get account details
  app.get("/:id", async (c) => {
    const db = Cache.get()
    const id = c.req.param("id")

    const account = db.select().from(schema.account).where(eq(schema.account.id, id)).get()
    if (!account) return c.json({ error: "Account not found" }, 404)

    return c.json({
      id: account.id,
      providerId: account.providerId,
      email: account.email,
      name: account.name,
      active: account.active,
    })
  })

  // GET /accounts/:id/sync — get sync state
  app.get("/:id/sync", async (c) => {
    const db = Cache.get()
    const id = c.req.param("id")

    const state = db.select().from(schema.syncState).where(eq(schema.syncState.accountId, id)).get()
    if (!state) return c.json({ error: "Sync state not found" }, 404)

    return c.json({
      accountId: state.accountId,
      status: state.status,
      lastSync: state.lastSync,
      error: state.error,
    })
  })

  // POST /accounts/:id/sync — trigger sync
  app.post("/:id/sync", async (c) => {
    // Will trigger the sync coordinator — stub for now
    return c.json({ ok: true, message: "Sync triggered" })
  })

  return app
}
