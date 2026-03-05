/**
 * Credential store — saves and loads OAuth tokens.
 *
 * Tokens are stored in ~/.openmail/credentials.json, encrypted with
 * AES-256-GCM using a key derived from a machine-specific seed (hostname + username).
 *
 * This is not Fort Knox — the goal is to prevent plaintext tokens from sitting
 * on disk. For truly sensitive environments, users should use OS keychain
 * integration (future work).
 *
 * The encryption key derivation uses PBKDF2 with a machine-specific salt,
 * so the credentials file is not portable between machines by design.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs"
import { join } from "node:path"
import { homedir, hostname, userInfo } from "node:os"
import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from "node:crypto"
import type { OAuth } from "./oauth.js"

export namespace CredentialStore {
  export interface StoredCredentials {
    [accountId: string]: {
      providerId: string
      email: string
      name: string
      tokens: OAuth.TokenSet
    }
  }

  const CONFIG_DIR = join(homedir(), ".openmail")
  const CREDENTIALS_FILE = join(CONFIG_DIR, "credentials.json")
  const ALGORITHM = "aes-256-gcm"
  const KEY_LENGTH = 32
  const IV_LENGTH = 16
  const AUTH_TAG_LENGTH = 16
  const PBKDF2_ITERATIONS = 100_000

  /**
   * Derive an encryption key from machine-specific data.
   * This means credentials are bound to the machine — not portable.
   */
  function deriveKey(): Buffer {
    const seed = `openmail:${hostname()}:${userInfo().username}`
    const salt = Buffer.from("openmail-credential-salt-v1")
    return pbkdf2Sync(seed, salt, PBKDF2_ITERATIONS, KEY_LENGTH, "sha256")
  }

  function encrypt(plaintext: string): string {
    const key = deriveKey()
    const iv = randomBytes(IV_LENGTH)
    const cipher = createCipheriv(ALGORITHM, key, iv)
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
    const authTag = cipher.getAuthTag()

    // Format: base64(iv + authTag + ciphertext)
    const combined = Buffer.concat([iv, authTag, encrypted])
    return combined.toString("base64")
  }

  function decrypt(encoded: string): string {
    const key = deriveKey()
    const combined = Buffer.from(encoded, "base64")

    const iv = combined.subarray(0, IV_LENGTH)
    const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
    const ciphertext = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH)

    const decipher = createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return decrypted.toString("utf8")
  }

  function ensureDir(): void {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true })
    }
  }

  /**
   * Load all stored credentials.
   * Returns empty object if no credentials file exists.
   */
  export function load(): StoredCredentials {
    if (!existsSync(CREDENTIALS_FILE)) return {}

    try {
      const raw = readFileSync(CREDENTIALS_FILE, "utf8")
      const envelope = JSON.parse(raw) as { version: number; data: string }

      if (envelope.version !== 1) {
        console.error("CredentialStore: unknown version", envelope.version)
        return {}
      }

      const decrypted = decrypt(envelope.data)
      return JSON.parse(decrypted) as StoredCredentials
    } catch (err) {
      console.error("CredentialStore: failed to load credentials:", err)
      return {}
    }
  }

  /**
   * Save all credentials to disk (encrypted).
   */
  export function save(credentials: StoredCredentials): void {
    ensureDir()

    const plaintext = JSON.stringify(credentials)
    const encrypted = encrypt(plaintext)

    const envelope = { version: 1, data: encrypted }
    writeFileSync(CREDENTIALS_FILE, JSON.stringify(envelope, null, 2), "utf8")

    // Restrict file permissions (owner read/write only)
    try {
      chmodSync(CREDENTIALS_FILE, 0o600)
    } catch {
      // May fail on some systems, not critical
    }
  }

  /**
   * Get credentials for a specific account.
   */
  export function get(accountId: string): StoredCredentials[string] | undefined {
    return load()[accountId]
  }

  /**
   * Save credentials for a specific account.
   * Merges with existing credentials.
   */
  export function set(
    accountId: string,
    data: StoredCredentials[string]
  ): void {
    const all = load()
    all[accountId] = data
    save(all)
  }

  /**
   * Update just the tokens for an account (e.g. after refresh).
   */
  export function updateTokens(accountId: string, tokens: OAuth.TokenSet): void {
    const all = load()
    if (all[accountId]) {
      all[accountId].tokens = tokens
      save(all)
    }
  }

  /**
   * Remove credentials for a specific account.
   */
  export function remove(accountId: string): void {
    const all = load()
    delete all[accountId]
    save(all)
  }

  /**
   * Check if credentials exist for an account.
   */
  export function has(accountId: string): boolean {
    return !!load()[accountId]
  }

  /**
   * Get the credentials file path (for testing / diagnostics).
   */
  export function getPath(): string {
    return CREDENTIALS_FILE
  }

  /**
   * Get the config directory path.
   */
  export function getConfigDir(): string {
    return CONFIG_DIR
  }
}
