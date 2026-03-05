/**
 * OAuth2 flow for Google (Gmail + Calendar).
 *
 * Flow:
 * 1. Generate authorization URL with scopes
 * 2. Open user's browser to consent screen
 * 3. Spin up ephemeral localhost HTTP server to receive callback
 * 4. Exchange authorization code for access/refresh tokens
 * 5. Store tokens via CredentialStore
 *
 * Uses google-auth-library for token management and refresh.
 */
import { OAuth2Client, type Credentials } from "google-auth-library"

export namespace OAuth {
  /** Google OAuth2 scopes for Gmail + Calendar. */
  export const GMAIL_SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
  ] as const

  export const CALENDAR_SCOPES = [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
  ] as const

  export interface Config {
    clientId: string
    clientSecret: string
    callbackPort?: number // default 4581
  }

  export interface TokenSet {
    accessToken: string
    refreshToken: string
    expiresAt: number // unix timestamp ms
    scopes: string[]
  }

  const DEFAULT_CALLBACK_PORT = 4581
  const REDIRECT_PATH = "/auth/callback"

  /**
   * Create an OAuth2Client configured with app credentials.
   */
  export function createClient(config: Config): OAuth2Client {
    const port = config.callbackPort ?? DEFAULT_CALLBACK_PORT
    return new OAuth2Client({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: `http://localhost:${port}${REDIRECT_PATH}`,
    })
  }

  /**
   * Generate the authorization URL for user consent.
   */
  export function getAuthUrl(
    client: OAuth2Client,
    opts?: { includeCalendar?: boolean }
  ): string {
    const scopes = [
      ...GMAIL_SCOPES,
      ...(opts?.includeCalendar ? CALENDAR_SCOPES : []),
    ]

    return client.generateAuthUrl({
      access_type: "offline", // get refresh token
      prompt: "consent",      // always show consent (ensures refresh token)
      scope: scopes,
    })
  }

  /**
   * Exchange an authorization code for tokens.
   */
  export async function exchangeCode(
    client: OAuth2Client,
    code: string
  ): Promise<TokenSet> {
    const { tokens } = await client.getToken(code)
    return credentialsToTokenSet(tokens)
  }

  /**
   * Refresh an expired access token using the refresh token.
   */
  export async function refreshAccessToken(
    client: OAuth2Client,
    refreshToken: string
  ): Promise<TokenSet> {
    client.setCredentials({ refresh_token: refreshToken })
    const { credentials } = await client.refreshAccessToken()
    return credentialsToTokenSet(credentials, refreshToken)
  }

  /**
   * Check if a token set is expired (or will expire within 5 minutes).
   */
  export function isExpired(tokenSet: TokenSet): boolean {
    const BUFFER_MS = 5 * 60 * 1000 // 5 minutes
    return Date.now() >= tokenSet.expiresAt - BUFFER_MS
  }

  /**
   * Get a valid access token, refreshing if needed.
   */
  export async function getValidToken(
    client: OAuth2Client,
    tokenSet: TokenSet
  ): Promise<{ token: string; refreshed: boolean; tokenSet: TokenSet }> {
    if (!isExpired(tokenSet)) {
      return { token: tokenSet.accessToken, refreshed: false, tokenSet }
    }
    const newTokenSet = await refreshAccessToken(client, tokenSet.refreshToken)
    return { token: newTokenSet.accessToken, refreshed: true, tokenSet: newTokenSet }
  }

  /**
   * Start an ephemeral localhost HTTP server to catch the OAuth callback.
   * Returns a promise that resolves with the authorization code.
   */
  export function startCallbackServer(
    port: number = DEFAULT_CALLBACK_PORT
  ): {
    promise: Promise<string>
    stop: () => void
  } {
    let resolveCode: (code: string) => void
    let rejectCode: (err: Error) => void
    let server: ReturnType<typeof Bun.serve> | null = null

    const promise = new Promise<string>((resolve, reject) => {
      resolveCode = resolve
      rejectCode = reject

      server = Bun.serve({
        port,
        fetch(req) {
          const url = new URL(req.url)

          if (url.pathname === REDIRECT_PATH) {
            const code = url.searchParams.get("code")
            const error = url.searchParams.get("error")

            if (error) {
              rejectCode(new Error(`OAuth error: ${error}`))
              return new Response(
                htmlPage("Authentication Failed", `Error: ${error}. You can close this tab.`),
                { headers: { "content-type": "text/html" } }
              )
            }

            if (!code) {
              rejectCode(new Error("No authorization code received"))
              return new Response(
                htmlPage("Authentication Failed", "No authorization code received. You can close this tab."),
                { headers: { "content-type": "text/html" } }
              )
            }

            resolveCode(code)
            return new Response(
              htmlPage("Authentication Successful", "You can close this tab and return to the terminal."),
              { headers: { "content-type": "text/html" } }
            )
          }

          return new Response("Not found", { status: 404 })
        },
      })
    })

    return {
      promise,
      stop: () => {
        if (server) {
          server.stop()
          server = null
        }
      },
    }
  }

  /**
   * Run the full OAuth flow: open browser, wait for callback, exchange code.
   * Returns tokens on success.
   */
  export async function authorize(
    config: Config,
    opts?: { includeCalendar?: boolean; skipBrowserOpen?: boolean }
  ): Promise<TokenSet> {
    const port = config.callbackPort ?? DEFAULT_CALLBACK_PORT
    const client = createClient(config)
    const authUrl = getAuthUrl(client, opts)

    // Start callback server
    const callback = startCallbackServer(port)

    // Open browser (unless skipped, e.g. in tests)
    if (!opts?.skipBrowserOpen) {
      openBrowser(authUrl)
    }

    try {
      // Wait for the authorization code
      const code = await callback.promise
      // Exchange code for tokens
      const tokenSet = await exchangeCode(client, code)
      return tokenSet
    } finally {
      callback.stop()
    }
  }

  // --- Internal helpers ---

  function credentialsToTokenSet(
    credentials: Credentials,
    fallbackRefreshToken?: string
  ): TokenSet {
    const refreshToken = credentials.refresh_token ?? fallbackRefreshToken
    if (!refreshToken) {
      throw new Error("No refresh token received. Re-authorize with prompt=consent.")
    }

    return {
      accessToken: credentials.access_token!,
      refreshToken,
      expiresAt: credentials.expiry_date ?? Date.now() + 3600 * 1000,
      scopes: credentials.scope?.split(" ") ?? [...GMAIL_SCOPES],
    }
  }

  function openBrowser(url: string): void {
    const cmd = process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", url]
        : ["xdg-open", url]

    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" })
  }

  function htmlPage(title: string, message: string): string {
    return `<!DOCTYPE html>
<html>
<head>
  <title>OpenMail - ${title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex; justify-content: center; align-items: center;
      min-height: 100vh; margin: 0;
      background: #1e1e2e; color: #cdd6f4;
    }
    .card {
      text-align: center; padding: 2rem;
      background: #313244; border-radius: 12px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }
    h1 { color: #cba6f7; margin-bottom: 0.5rem; }
    p { color: #a6adc8; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`
  }
}
