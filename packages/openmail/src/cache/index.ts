import { Database } from "bun:sqlite"
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite"
import { sql } from "drizzle-orm"
import * as schema from "./schema.js"
import { existsSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"

export type DB = BunSQLiteDatabase<typeof schema>

export namespace Cache {
  let db: DB | null = null
  let sqlite: Database | null = null

  /**
   * Initialize the database at the given path.
   * Creates the directory and file if they don't exist.
   * Runs migrations (CREATE TABLE IF NOT EXISTS) on every startup.
   */
  export function init(dbPath: string): DB {
    if (db) return db

    // Ensure directory exists
    const dir = dirname(dbPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    sqlite = new Database(dbPath)

    // Enable WAL mode for better concurrent read/write performance
    sqlite.run("PRAGMA journal_mode = WAL")
    sqlite.run("PRAGMA foreign_keys = ON")
    sqlite.run("PRAGMA busy_timeout = 5000")

    db = drizzle(sqlite, { schema })

    // Run schema creation
    migrate(sqlite)

    return db
  }

  /**
   * Get the current database instance.
   * Throws if init() hasn't been called.
   */
  export function get(): DB {
    if (!db) throw new Error("Database not initialized. Call Cache.init() first.")
    return db
  }

  /**
   * Close the database connection.
   */
  export function close(): void {
    if (sqlite) {
      sqlite.close()
      sqlite = null
      db = null
    }
  }

  /**
   * Create all tables. Uses IF NOT EXISTS so it's safe to run on every startup.
   */
  function migrate(sqlite: Database): void {
    sqlite.run(`
      CREATE TABLE IF NOT EXISTS account (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        email TEXT NOT NULL,
        name TEXT NOT NULL,
        credentials TEXT NOT NULL,
        sync_cursor TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    sqlite.run(`
      CREATE TABLE IF NOT EXISTS thread (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES account(id),
        provider_thread_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        snippet TEXT NOT NULL,
        participants TEXT NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 1,
        has_attachments INTEGER NOT NULL DEFAULT 0,
        unread INTEGER NOT NULL DEFAULT 1,
        starred INTEGER NOT NULL DEFAULT 0,
        last_message_time INTEGER NOT NULL,
        history_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    sqlite.run(`
      CREATE TABLE IF NOT EXISTS message (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES thread(id),
        account_id TEXT NOT NULL REFERENCES account(id),
        provider_message_id TEXT NOT NULL,
        from_name TEXT NOT NULL,
        from_email TEXT NOT NULL,
        to_recipients TEXT NOT NULL,
        cc_recipients TEXT NOT NULL,
        bcc_recipients TEXT NOT NULL,
        reply_to TEXT,
        subject TEXT NOT NULL,
        body_text TEXT NOT NULL,
        body_html TEXT,
        attachments TEXT NOT NULL,
        time INTEGER NOT NULL,
        unread INTEGER NOT NULL DEFAULT 1,
        message_id_header TEXT,
        in_reply_to TEXT,
        raw_headers TEXT
      )
    `)

    sqlite.run(`
      CREATE TABLE IF NOT EXISTS folder (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES account(id),
        provider_folder_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        unread_count INTEGER NOT NULL DEFAULT 0
      )
    `)

    sqlite.run(`
      CREATE TABLE IF NOT EXISTS label (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES account(id),
        provider_label_id TEXT NOT NULL,
        name TEXT NOT NULL,
        color TEXT
      )
    `)

    sqlite.run(`
      CREATE TABLE IF NOT EXISTS thread_folder (
        thread_id TEXT NOT NULL REFERENCES thread(id),
        folder_id TEXT NOT NULL REFERENCES folder(id),
        PRIMARY KEY (thread_id, folder_id)
      )
    `)

    sqlite.run(`
      CREATE TABLE IF NOT EXISTS thread_label (
        thread_id TEXT NOT NULL REFERENCES thread(id),
        label_id TEXT NOT NULL REFERENCES label(id),
        PRIMARY KEY (thread_id, label_id)
      )
    `)

    sqlite.run(`
      CREATE TABLE IF NOT EXISTS calendar (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES account(id),
        provider_calendar_id TEXT NOT NULL,
        name TEXT NOT NULL,
        color TEXT,
        source TEXT NOT NULL,
        writable INTEGER NOT NULL DEFAULT 0
      )
    `)

    sqlite.run(`
      CREATE TABLE IF NOT EXISTS cal_event (
        id TEXT PRIMARY KEY,
        calendar_id TEXT NOT NULL REFERENCES calendar(id),
        account_id TEXT NOT NULL REFERENCES account(id),
        uid TEXT NOT NULL,
        summary TEXT NOT NULL,
        description TEXT,
        location TEXT,
        start_time INTEGER NOT NULL,
        end_time INTEGER NOT NULL,
        all_day INTEGER NOT NULL DEFAULT 0,
        organizer TEXT NOT NULL,
        attendees TEXT NOT NULL,
        my_status TEXT,
        recurrence TEXT,
        conference_url TEXT,
        source TEXT NOT NULL
      )
    `)

    sqlite.run(`
      CREATE TABLE IF NOT EXISTS event_thread (
        event_id TEXT NOT NULL REFERENCES cal_event(id),
        thread_id TEXT NOT NULL REFERENCES thread(id),
        PRIMARY KEY (event_id, thread_id)
      )
    `)

    sqlite.run(`
      CREATE TABLE IF NOT EXISTS contact (
        email TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        account_id TEXT NOT NULL REFERENCES account(id),
        frequency INTEGER NOT NULL DEFAULT 1,
        last_seen INTEGER NOT NULL
      )
    `)

    sqlite.run(`
      CREATE TABLE IF NOT EXISTS sync_state (
        account_id TEXT PRIMARY KEY REFERENCES account(id),
        cursor TEXT,
        last_sync INTEGER,
        status TEXT NOT NULL DEFAULT 'idle',
        error TEXT
      )
    `)

    // Indexes for common queries
    sqlite.run(`CREATE INDEX IF NOT EXISTS idx_thread_account ON thread(account_id)`)
    sqlite.run(`CREATE INDEX IF NOT EXISTS idx_thread_last_message ON thread(last_message_time DESC)`)
    sqlite.run(`CREATE INDEX IF NOT EXISTS idx_thread_unread ON thread(unread) WHERE unread = 1`)
    sqlite.run(`CREATE INDEX IF NOT EXISTS idx_message_thread ON message(thread_id)`)
    sqlite.run(`CREATE INDEX IF NOT EXISTS idx_message_time ON message(time DESC)`)
    sqlite.run(`CREATE INDEX IF NOT EXISTS idx_thread_folder ON thread_folder(folder_id)`)
    sqlite.run(`CREATE INDEX IF NOT EXISTS idx_thread_label ON thread_label(label_id)`)
    sqlite.run(`CREATE INDEX IF NOT EXISTS idx_cal_event_calendar ON cal_event(calendar_id)`)
    sqlite.run(`CREATE INDEX IF NOT EXISTS idx_cal_event_time ON cal_event(start_time)`)
    sqlite.run(`CREATE INDEX IF NOT EXISTS idx_contact_frequency ON contact(frequency DESC)`)
  }
}
