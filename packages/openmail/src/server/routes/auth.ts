import { Hono } from "hono"
import { eq } from "drizzle-orm"
import { OAuth } from "../../auth/oauth.js"
import { CredentialStore } from "../../auth/store.js"
import { Cache } from "../../cache/index.js"
import * as schema from "../../cache/schema.js"
import { EventBus } from "../../bus/index.js"

export function authRoutes(): Hono {
  const app = new Hono()

  // GET /auth/status — list authenticated accounts
  app.get("/status", async (c) => {
    const credentials = CredentialStore.load()
    const accounts = Object.entries(credentials).map(([id, cred]) => ({
      id,
      providerId: cred.providerId,
      email: cred.email,
      name: cred.name,
      hasTokens: !!cred.tokens.accessToken,
      expired: OAuth.isExpired(cred.tokens),
    }))
    return c.json({ accounts })
  })

  // POST /auth/google — initiate Google OAuth flow
  // Body: { clientId, clientSecret, callbackPort?, includeCalendar? }
  app.post("/google", async (c) => {
    const body = await c.req.json() as {
      clientId: string
      clientSecret: string
      callbackPort?: number
      includeCalendar?: boolean
    }

    if (!body.clientId || !body.clientSecret) {
      return c.json({ error: "clientId and clientSecret are required" }, 400)
    }

    const config: OAuth.Config = {
      clientId: body.clientId,
      clientSecret: body.clientSecret,
      callbackPort: body.callbackPort,
    }

    try {
      const tokenSet = await OAuth.authorize(config, {
        includeCalendar: body.includeCalendar,
      })

      // Fetch user info to get email and name
      const userInfo = await fetchGoogleUserInfo(tokenSet.accessToken)
      const accountId = `google:${userInfo.email}`

      // Store credentials
      CredentialStore.set(accountId, {
        providerId: "gmail",
        email: userInfo.email,
        name: userInfo.name,
        tokens: tokenSet,
      })

      // Create account record in SQLite
      const db = Cache.get()
      const now = new Date()

      db.insert(schema.account)
        .values({
          id: accountId,
          providerId: "gmail",
          email: userInfo.email,
          name: userInfo.name,
          credentials: JSON.stringify({
            clientId: body.clientId,
            clientSecret: body.clientSecret,
            callbackPort: body.callbackPort,
          }),
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: schema.account.id,
          set: {
            name: userInfo.name,
            updatedAt: now,
          },
        })
        .run()

      // Create initial sync state
      db.insert(schema.syncState)
        .values({ accountId, status: "idle" })
        .onConflictDoNothing()
        .run()

      EventBus.emit("account.added", {
        accountId,
        email: userInfo.email,
        providerId: "gmail",
      })

      return c.json({
        ok: true,
        accountId,
        email: userInfo.email,
        name: userInfo.name,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error"
      return c.json({ error: `OAuth failed: ${message}` }, 500)
    }
  })

  // POST /auth/google/url — just get the auth URL (for custom flows)
  // Body: { clientId, clientSecret, callbackPort?, includeCalendar? }
  app.post("/google/url", async (c) => {
    const body = await c.req.json() as {
      clientId: string
      clientSecret: string
      callbackPort?: number
      includeCalendar?: boolean
    }

    if (!body.clientId || !body.clientSecret) {
      return c.json({ error: "clientId and clientSecret are required" }, 400)
    }

    const client = OAuth.createClient({
      clientId: body.clientId,
      clientSecret: body.clientSecret,
      callbackPort: body.callbackPort,
    })

    const url = OAuth.getAuthUrl(client, {
      includeCalendar: body.includeCalendar,
    })

    return c.json({ url })
  })

  // POST /auth/:accountId/refresh — force token refresh
  app.post("/:accountId/refresh", async (c) => {
    const accountId = c.req.param("accountId")
    const stored = CredentialStore.get(accountId)

    if (!stored) {
      return c.json({ error: "Account not found in credential store" }, 404)
    }

    try {
      // Load the client credentials from the account record
      const db = Cache.get()
      const account = db.select().from(schema.account)
        .where(eq(schema.account.id, accountId))
        .get()

      if (!account) {
        return c.json({ error: "Account not found in database" }, 404)
      }

      const clientCreds = JSON.parse(account.credentials) as {
        clientId: string
        clientSecret: string
        callbackPort?: number
      }

      const client = OAuth.createClient(clientCreds)
      const newTokens = await OAuth.refreshAccessToken(client, stored.tokens.refreshToken)

      CredentialStore.updateTokens(accountId, newTokens)

      return c.json({
        ok: true,
        expiresAt: new Date(newTokens.expiresAt).toISOString(),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error"
      return c.json({ error: `Token refresh failed: ${message}` }, 500)
    }
  })

  // DELETE /auth/:accountId — remove account and credentials
  app.delete("/:accountId", async (c) => {
    const accountId = c.req.param("accountId")

    CredentialStore.remove(accountId)

    // Optionally remove from database too
    // For now just mark inactive
    try {
      const db = Cache.get()
      db.update(schema.account)
        .set({ active: false })
        .where(eq(schema.account.id, accountId))
        .run()
    } catch {
      // DB might not have this account, that's fine
    }

    EventBus.emit("account.removed", { accountId })

    return c.json({ ok: true })
  })

  return app
}

/**
 * Fetch Google user info using an access token.
 */
async function fetchGoogleUserInfo(
  accessToken: string
): Promise<{ email: string; name: string }> {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!res.ok) {
    throw new Error(`Failed to fetch user info: ${res.status} ${res.statusText}`)
  }

  const data = await res.json() as { email: string; name: string }
  return { email: data.email, name: data.name }
}
