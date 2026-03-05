import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { OAuth } from "../src/auth/oauth.js"
import { CredentialStore } from "../src/auth/store.js"
import { existsSync, unlinkSync, mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { join } from "node:path"

// --- OAuth tests (unit-level, no real Google calls) ---

describe("OAuth — config and URL generation", () => {
  test("createClient returns OAuth2Client", () => {
    const client = OAuth.createClient({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
    })
    expect(client).toBeDefined()
  })

  test("getAuthUrl generates valid URL with Gmail scopes", () => {
    const client = OAuth.createClient({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
    })
    const url = OAuth.getAuthUrl(client)

    expect(url).toContain("accounts.google.com")
    expect(url).toContain("test-client-id")
    expect(url).toContain("access_type=offline")
    expect(url).toContain("prompt=consent")
    // Check for Gmail scopes
    expect(url).toContain("gmail.readonly")
    expect(url).toContain("gmail.modify")
    expect(url).toContain("gmail.send")
    expect(url).toContain("userinfo.email")
    // Should NOT include calendar scopes by default
    expect(url).not.toContain("calendar.readonly")
  })

  test("getAuthUrl includes calendar scopes when requested", () => {
    const client = OAuth.createClient({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
    })
    const url = OAuth.getAuthUrl(client, { includeCalendar: true })

    expect(url).toContain("calendar.readonly")
    expect(url).toContain("calendar.events")
  })

  test("getAuthUrl uses custom callback port", () => {
    const client = OAuth.createClient({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      callbackPort: 9999,
    })
    const url = OAuth.getAuthUrl(client)

    expect(url).toContain("localhost%3A9999") // URL-encoded :
  })

  test("GMAIL_SCOPES contains expected scopes", () => {
    expect(OAuth.GMAIL_SCOPES).toContain("https://www.googleapis.com/auth/gmail.readonly")
    expect(OAuth.GMAIL_SCOPES).toContain("https://www.googleapis.com/auth/gmail.modify")
    expect(OAuth.GMAIL_SCOPES).toContain("https://www.googleapis.com/auth/gmail.send")
    expect(OAuth.GMAIL_SCOPES).toContain("https://www.googleapis.com/auth/userinfo.email")
    expect(OAuth.GMAIL_SCOPES).toContain("https://www.googleapis.com/auth/userinfo.profile")
  })

  test("CALENDAR_SCOPES contains expected scopes", () => {
    expect(OAuth.CALENDAR_SCOPES).toContain("https://www.googleapis.com/auth/calendar.readonly")
    expect(OAuth.CALENDAR_SCOPES).toContain("https://www.googleapis.com/auth/calendar.events")
  })
})

describe("OAuth — token expiration", () => {
  test("isExpired returns false for fresh token", () => {
    const tokenSet: OAuth.TokenSet = {
      accessToken: "test-access",
      refreshToken: "test-refresh",
      expiresAt: Date.now() + 3600 * 1000, // 1 hour from now
      scopes: [...OAuth.GMAIL_SCOPES],
    }
    expect(OAuth.isExpired(tokenSet)).toBe(false)
  })

  test("isExpired returns true for expired token", () => {
    const tokenSet: OAuth.TokenSet = {
      accessToken: "test-access",
      refreshToken: "test-refresh",
      expiresAt: Date.now() - 1000, // expired 1 second ago
      scopes: [...OAuth.GMAIL_SCOPES],
    }
    expect(OAuth.isExpired(tokenSet)).toBe(true)
  })

  test("isExpired returns true within 5-minute buffer", () => {
    const tokenSet: OAuth.TokenSet = {
      accessToken: "test-access",
      refreshToken: "test-refresh",
      expiresAt: Date.now() + 2 * 60 * 1000, // 2 minutes from now (within 5-minute buffer)
      scopes: [...OAuth.GMAIL_SCOPES],
    }
    expect(OAuth.isExpired(tokenSet)).toBe(true)
  })

  test("isExpired returns false just outside 5-minute buffer", () => {
    const tokenSet: OAuth.TokenSet = {
      accessToken: "test-access",
      refreshToken: "test-refresh",
      expiresAt: Date.now() + 6 * 60 * 1000, // 6 minutes from now
      scopes: [...OAuth.GMAIL_SCOPES],
    }
    expect(OAuth.isExpired(tokenSet)).toBe(false)
  })
})

describe("OAuth — callback server", () => {
  test("callback server starts and stops", async () => {
    const callback = OAuth.startCallbackServer(14581)
    // Server should be running
    const res = await fetch("http://localhost:14581/nonexistent")
    expect(res.status).toBe(404)
    callback.stop()
  })

  test("callback server receives auth code", async () => {
    const callback = OAuth.startCallbackServer(14582)

    // Simulate Google redirecting back with a code
    const fetchPromise = fetch("http://localhost:14582/auth/callback?code=test-auth-code-123")
    const code = await callback.promise
    const res = await fetchPromise

    expect(code).toBe("test-auth-code-123")
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain("Authentication Successful")
    callback.stop()
  })

  test("callback server handles OAuth error", async () => {
    const callback = OAuth.startCallbackServer(14583)

    // Simulate Google returning an error
    const fetchPromise = fetch("http://localhost:14583/auth/callback?error=access_denied")

    try {
      await callback.promise
      expect(true).toBe(false) // Should not reach here
    } catch (err) {
      expect((err as Error).message).toContain("access_denied")
    }

    const res = await fetchPromise
    const html = await res.text()
    expect(html).toContain("Authentication Failed")
    callback.stop()
  })

  test("callback server handles missing code", async () => {
    const callback = OAuth.startCallbackServer(14584)

    // Simulate callback without code or error
    const fetchPromise = fetch("http://localhost:14584/auth/callback")

    try {
      await callback.promise
      expect(true).toBe(false) // Should not reach here
    } catch (err) {
      expect((err as Error).message).toContain("No authorization code")
    }

    const res = await fetchPromise
    const html = await res.text()
    expect(html).toContain("Authentication Failed")
    callback.stop()
  })
})

// --- CredentialStore tests ---

const TEST_CRED_DIR = "/tmp/openmail-test-creds"
const TEST_CRED_FILE = join(TEST_CRED_DIR, "credentials.json")

// We can't easily override CredentialStore's paths since they're constants,
// so we test the encryption/decryption round-trip through save/load.
// For the actual file I/O tests we use the real ~/.openmail path but clean up.

describe("CredentialStore — save and load", () => {
  const testAccountId = `test-account-${Date.now()}`

  afterEach(() => {
    // Clean up test account
    CredentialStore.remove(testAccountId)
  })

  test("set and get credentials", () => {
    const data = {
      providerId: "gmail",
      email: "test@gmail.com",
      name: "Test User",
      tokens: {
        accessToken: "access-123",
        refreshToken: "refresh-456",
        expiresAt: Date.now() + 3600000,
        scopes: [...OAuth.GMAIL_SCOPES],
      },
    }

    CredentialStore.set(testAccountId, data)
    const loaded = CredentialStore.get(testAccountId)

    expect(loaded).toBeDefined()
    expect(loaded!.email).toBe("test@gmail.com")
    expect(loaded!.name).toBe("Test User")
    expect(loaded!.providerId).toBe("gmail")
    expect(loaded!.tokens.accessToken).toBe("access-123")
    expect(loaded!.tokens.refreshToken).toBe("refresh-456")
  })

  test("returns undefined for non-existent account", () => {
    const result = CredentialStore.get("nonexistent-account-xyz")
    expect(result).toBeUndefined()
  })

  test("has returns true for existing account", () => {
    CredentialStore.set(testAccountId, {
      providerId: "gmail",
      email: "test@gmail.com",
      name: "Test",
      tokens: {
        accessToken: "a", refreshToken: "r",
        expiresAt: Date.now() + 3600000,
        scopes: [],
      },
    })
    expect(CredentialStore.has(testAccountId)).toBe(true)
  })

  test("has returns false for non-existent account", () => {
    expect(CredentialStore.has("nonexistent-xyz")).toBe(false)
  })

  test("updateTokens updates only the tokens", () => {
    CredentialStore.set(testAccountId, {
      providerId: "gmail",
      email: "test@gmail.com",
      name: "Test User",
      tokens: {
        accessToken: "old-access",
        refreshToken: "old-refresh",
        expiresAt: Date.now(),
        scopes: [],
      },
    })

    const newTokens: OAuth.TokenSet = {
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresAt: Date.now() + 7200000,
      scopes: [...OAuth.GMAIL_SCOPES],
    }

    CredentialStore.updateTokens(testAccountId, newTokens)

    const loaded = CredentialStore.get(testAccountId)
    expect(loaded!.tokens.accessToken).toBe("new-access")
    expect(loaded!.tokens.refreshToken).toBe("new-refresh")
    // Name should be unchanged
    expect(loaded!.name).toBe("Test User")
  })

  test("remove deletes credentials", () => {
    CredentialStore.set(testAccountId, {
      providerId: "gmail",
      email: "test@gmail.com",
      name: "Test",
      tokens: {
        accessToken: "a", refreshToken: "r",
        expiresAt: Date.now() + 3600000,
        scopes: [],
      },
    })

    expect(CredentialStore.has(testAccountId)).toBe(true)
    CredentialStore.remove(testAccountId)
    expect(CredentialStore.has(testAccountId)).toBe(false)
  })

  test("multiple accounts stored independently", () => {
    const account2 = `${testAccountId}-2`

    CredentialStore.set(testAccountId, {
      providerId: "gmail",
      email: "user1@gmail.com",
      name: "User 1",
      tokens: {
        accessToken: "a1", refreshToken: "r1",
        expiresAt: Date.now() + 3600000,
        scopes: [],
      },
    })

    CredentialStore.set(account2, {
      providerId: "gmail",
      email: "user2@gmail.com",
      name: "User 2",
      tokens: {
        accessToken: "a2", refreshToken: "r2",
        expiresAt: Date.now() + 3600000,
        scopes: [],
      },
    })

    const loaded1 = CredentialStore.get(testAccountId)
    const loaded2 = CredentialStore.get(account2)

    expect(loaded1!.email).toBe("user1@gmail.com")
    expect(loaded2!.email).toBe("user2@gmail.com")

    // Clean up second account
    CredentialStore.remove(account2)
  })

  test("credentials file is encrypted on disk", () => {
    CredentialStore.set(testAccountId, {
      providerId: "gmail",
      email: "secret@gmail.com",
      name: "Secret User",
      tokens: {
        accessToken: "super-secret-token",
        refreshToken: "super-secret-refresh",
        expiresAt: Date.now() + 3600000,
        scopes: [],
      },
    })

    const path = CredentialStore.getPath()
    const raw = readFileSync(path, "utf8")
    const envelope = JSON.parse(raw)

    // Should have version and encrypted data
    expect(envelope.version).toBe(1)
    expect(typeof envelope.data).toBe("string")

    // The raw file should NOT contain plaintext tokens
    expect(raw).not.toContain("super-secret-token")
    expect(raw).not.toContain("super-secret-refresh")
    expect(raw).not.toContain("secret@gmail.com")
  })

  test("load returns empty object for corrupted file", () => {
    const path = CredentialStore.getPath()
    // First set something valid
    CredentialStore.set(testAccountId, {
      providerId: "gmail",
      email: "test@gmail.com",
      name: "Test",
      tokens: {
        accessToken: "a", refreshToken: "r",
        expiresAt: Date.now() + 3600000,
        scopes: [],
      },
    })

    // Corrupt the file
    writeFileSync(path, JSON.stringify({ version: 1, data: "corrupted-base64-data" }), "utf8")

    // Should return empty without crashing
    const result = CredentialStore.load()
    expect(result).toEqual({})
  })
})

describe("CredentialStore — paths", () => {
  test("getPath returns credentials file path", () => {
    const path = CredentialStore.getPath()
    expect(path).toContain(".openmail")
    expect(path).toContain("credentials.json")
  })

  test("getConfigDir returns config directory path", () => {
    const dir = CredentialStore.getConfigDir()
    expect(dir).toContain(".openmail")
  })
})
