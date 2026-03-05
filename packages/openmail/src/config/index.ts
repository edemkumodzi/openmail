/**
 * Config file management.
 *
 * Config lives at ~/.openmail/config.json and stores:
 * - Server port overrides
 * - Sync settings
 *
 * Google OAuth credentials are embedded (same pattern as gcloud CLI,
 * firebase CLI, rclone, thunderbird). Client secrets for installed/CLI
 * apps are not truly confidential per Google's own documentation.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

export namespace Config {
  export interface AppConfig {
    google?: {
      clientId: string
      clientSecret: string
    }
    server?: {
      port: number
      callbackPort: number
    }
    sync?: {
      intervalMs: number
      maxThreadsPerSync: number
    }
  }

  const CONFIG_DIR = join(homedir(), ".openmail")
  const CONFIG_PATH = join(CONFIG_DIR, "config.json")

  // Embedded OAuth credentials — standard pattern for CLI/desktop apps.
  // See: gcloud CLI (CLOUDSDK_CLIENT_NOTSOSECRET), firebase CLI, rclone, thunderbird.
  // These alone grant zero access — users must still consent via browser.
  // The NOTSOSECRET prefix follows gcloud CLI convention to signal that
  // this is an intentionally-public installed app credential.
  const GOOGLE_CLIENT_ID = "617081422767-n912p1p0ek714ci7pqjev18av11f9g7s.apps.googleusercontent.com"
  const GOOGLE_CLIENT_NOTSOSECRET = "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"

  const DEFAULTS: Required<AppConfig> = {
    google: {
      clientId: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_NOTSOSECRET,
    },
    server: {
      port: 4580,
      callbackPort: 4581,
    },
    sync: {
      intervalMs: 5 * 60 * 1000, // 5 minutes
      maxThreadsPerSync: 200,
    },
  }

  function ensureDir(): void {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true })
    }
  }

  /**
   * Load config from disk. Returns defaults for any missing fields.
   */
  export function load(): AppConfig {
    try {
      if (existsSync(CONFIG_PATH)) {
        const raw = readFileSync(CONFIG_PATH, "utf8")
        const parsed = JSON.parse(raw) as Partial<AppConfig>
        return merge(parsed)
      }
    } catch {
      // Fall through to defaults
    }
    return { ...DEFAULTS }
  }

  /**
   * Save config to disk.
   */
  export function save(config: AppConfig): void {
    ensureDir()
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8")
  }

  /**
   * Check if Google credentials are configured.
   */
  export function hasGoogleCredentials(): boolean {
    const config = load()
    return !!(config.google?.clientId && config.google?.clientSecret)
  }

  /**
   * Set Google OAuth credentials.
   */
  export function setGoogleCredentials(clientId: string, clientSecret: string): void {
    const config = load()
    config.google = { clientId, clientSecret }
    save(config)
  }

  /**
   * Get the config file path (for display to user).
   */
  export function getPath(): string {
    return CONFIG_PATH
  }

  /**
   * Get the config directory path.
   */
  export function getDir(): string {
    return CONFIG_DIR
  }

  function merge(partial: Partial<AppConfig>): AppConfig {
    return {
      google: partial.google ?? DEFAULTS.google,
      server: {
        port: partial.server?.port ?? DEFAULTS.server.port,
        callbackPort: partial.server?.callbackPort ?? DEFAULTS.server.callbackPort,
      },
      sync: {
        intervalMs: partial.sync?.intervalMs ?? DEFAULTS.sync.intervalMs,
        maxThreadsPerSync: partial.sync?.maxThreadsPerSync ?? DEFAULTS.sync.maxThreadsPerSync,
      },
    }
  }
}
