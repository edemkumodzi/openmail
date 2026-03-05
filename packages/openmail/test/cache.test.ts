import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { Cache, type DB } from "../src/cache/index.js"
import * as schema from "../src/cache/schema.js"
import { eq } from "drizzle-orm"
import { unlinkSync, existsSync } from "node:fs"

const TEST_DB = "/tmp/openmail-test.db"

function cleanUp() {
  Cache.close()
  for (const suffix of ["", "-wal", "-shm"]) {
    const path = TEST_DB + suffix
    if (existsSync(path)) unlinkSync(path)
  }
}

describe("Cache", () => {
  beforeEach(() => {
    cleanUp()
  })

  afterEach(() => {
    cleanUp()
  })

  test("init creates database and tables", () => {
    const db = Cache.init(TEST_DB)
    expect(db).toBeDefined()
    expect(existsSync(TEST_DB)).toBe(true)
  })

  test("init is idempotent", () => {
    const db1 = Cache.init(TEST_DB)
    const db2 = Cache.init(TEST_DB)
    expect(db1).toBe(db2)
  })

  test("get returns initialized database", () => {
    Cache.init(TEST_DB)
    const db = Cache.get()
    expect(db).toBeDefined()
  })

  test("get throws if not initialized", () => {
    expect(() => Cache.get()).toThrow("Database not initialized")
  })

  test("close and reinitialize", () => {
    Cache.init(TEST_DB)
    Cache.close()
    expect(() => Cache.get()).toThrow()
    const db = Cache.init(TEST_DB)
    expect(db).toBeDefined()
  })
})

describe("Schema — Account", () => {
  let db: DB

  beforeEach(() => {
    cleanUp()
    db = Cache.init(TEST_DB)
  })

  afterEach(() => {
    cleanUp()
  })

  test("insert and read account", () => {
    const now = new Date()
    db.insert(schema.account).values({
      id: "acc-1",
      providerId: "gmail",
      email: "user@gmail.com",
      name: "Test User",
      credentials: JSON.stringify({ accessToken: "xxx", refreshToken: "yyy" }),
      active: true,
      createdAt: now,
      updatedAt: now,
    }).run()

    const accounts = db.select().from(schema.account).all()
    expect(accounts).toHaveLength(1)
    expect(accounts[0]!.email).toBe("user@gmail.com")
    expect(accounts[0]!.providerId).toBe("gmail")
    expect(accounts[0]!.active).toBe(true)
  })
})

describe("Schema — Thread + Folder + Label", () => {
  let db: DB

  beforeEach(() => {
    cleanUp()
    db = Cache.init(TEST_DB)
    const now = new Date()

    // Insert account
    db.insert(schema.account).values({
      id: "acc-1",
      providerId: "gmail",
      email: "user@gmail.com",
      name: "Test User",
      credentials: "{}",
      createdAt: now,
      updatedAt: now,
    }).run()
  })

  afterEach(() => {
    cleanUp()
  })

  test("insert thread", () => {
    const now = new Date()
    db.insert(schema.thread).values({
      id: "t-1",
      accountId: "acc-1",
      providerThreadId: "gmail-t1",
      subject: "Test Thread",
      snippet: "This is a test",
      participants: [{ name: "Alice", email: "alice@test.com" }] as any,
      messageCount: 2,
      hasAttachments: false,
      unread: true,
      starred: false,
      lastMessageTime: now,
      createdAt: now,
      updatedAt: now,
    }).run()

    const threads = db.select().from(schema.thread).all()
    expect(threads).toHaveLength(1)
    expect(threads[0]!.subject).toBe("Test Thread")
    expect(threads[0]!.unread).toBe(true)
  })

  test("insert folder and link to thread", () => {
    const now = new Date()

    db.insert(schema.folder).values({
      id: "f-inbox",
      accountId: "acc-1",
      providerFolderId: "INBOX",
      name: "Inbox",
      type: "inbox",
      unreadCount: 3,
    }).run()

    db.insert(schema.thread).values({
      id: "t-1",
      accountId: "acc-1",
      providerThreadId: "gmail-t1",
      subject: "Test",
      snippet: "Test",
      participants: [] as any,
      lastMessageTime: now,
      createdAt: now,
      updatedAt: now,
    }).run()

    db.insert(schema.threadFolder).values({
      threadId: "t-1",
      folderId: "f-inbox",
    }).run()

    const links = db.select().from(schema.threadFolder).all()
    expect(links).toHaveLength(1)
    expect(links[0]!.threadId).toBe("t-1")
    expect(links[0]!.folderId).toBe("f-inbox")
  })

  test("insert label and link to thread", () => {
    const now = new Date()

    db.insert(schema.label).values({
      id: "l-work",
      accountId: "acc-1",
      providerLabelId: "Label_1",
      name: "work",
      color: "#5c9cf5",
    }).run()

    db.insert(schema.thread).values({
      id: "t-1",
      accountId: "acc-1",
      providerThreadId: "gmail-t1",
      subject: "Test",
      snippet: "Test",
      participants: [] as any,
      lastMessageTime: now,
      createdAt: now,
      updatedAt: now,
    }).run()

    db.insert(schema.threadLabel).values({
      threadId: "t-1",
      labelId: "l-work",
    }).run()

    const links = db.select().from(schema.threadLabel).all()
    expect(links).toHaveLength(1)
  })
})

describe("Schema — Message", () => {
  let db: DB

  beforeEach(() => {
    cleanUp()
    db = Cache.init(TEST_DB)
    const now = new Date()

    db.insert(schema.account).values({
      id: "acc-1", providerId: "gmail", email: "user@gmail.com",
      name: "User", credentials: "{}", createdAt: now, updatedAt: now,
    }).run()

    db.insert(schema.thread).values({
      id: "t-1", accountId: "acc-1", providerThreadId: "gt1",
      subject: "Test", snippet: "Test", participants: [] as any,
      lastMessageTime: now, createdAt: now, updatedAt: now,
    }).run()
  })

  afterEach(() => {
    cleanUp()
  })

  test("insert and read message", () => {
    const now = new Date()
    db.insert(schema.message).values({
      id: "m-1",
      threadId: "t-1",
      accountId: "acc-1",
      providerMessageId: "gm1",
      fromName: "Alice",
      fromEmail: "alice@test.com",
      toRecipients: [{ name: "Bob", email: "bob@test.com" }] as any,
      ccRecipients: [] as any,
      bccRecipients: [] as any,
      subject: "Hello",
      bodyText: "Hi there",
      bodyHtml: "<p>Hi there</p>",
      attachments: [] as any,
      time: now,
      unread: false,
    }).run()

    const messages = db.select().from(schema.message).where(eq(schema.message.threadId, "t-1")).all()
    expect(messages).toHaveLength(1)
    expect(messages[0]!.fromName).toBe("Alice")
    expect(messages[0]!.bodyText).toBe("Hi there")
  })
})

describe("Schema — Calendar + Event", () => {
  let db: DB

  beforeEach(() => {
    cleanUp()
    db = Cache.init(TEST_DB)
    const now = new Date()

    db.insert(schema.account).values({
      id: "acc-1", providerId: "gmail", email: "user@gmail.com",
      name: "User", credentials: "{}", createdAt: now, updatedAt: now,
    }).run()
  })

  afterEach(() => {
    cleanUp()
  })

  test("insert calendar and event", () => {
    db.insert(schema.calendar).values({
      id: "cal-1",
      accountId: "acc-1",
      providerCalendarId: "primary",
      name: "My Calendar",
      source: "google",
      writable: true,
    }).run()

    const start = new Date(2026, 2, 5, 14, 0)
    const end = new Date(2026, 2, 5, 15, 0)

    db.insert(schema.calEvent).values({
      id: "ev-1",
      calendarId: "cal-1",
      accountId: "acc-1",
      uid: "abc123@google.com",
      summary: "Team Standup",
      location: "Zoom",
      startTime: start,
      endTime: end,
      allDay: false,
      organizer: { name: "Alice", email: "alice@test.com" } as any,
      attendees: [] as any,
      myStatus: "accepted",
      source: "api",
    }).run()

    const events = db.select().from(schema.calEvent).all()
    expect(events).toHaveLength(1)
    expect(events[0]!.summary).toBe("Team Standup")
    expect(events[0]!.myStatus).toBe("accepted")
  })

  test("link event to thread", () => {
    const now = new Date()

    db.insert(schema.calendar).values({
      id: "cal-1", accountId: "acc-1", providerCalendarId: "primary",
      name: "Calendar", source: "google", writable: true,
    }).run()

    db.insert(schema.calEvent).values({
      id: "ev-1", calendarId: "cal-1", accountId: "acc-1", uid: "abc",
      summary: "Meeting", startTime: now, endTime: now, allDay: false,
      organizer: { name: "A", email: "a@a.com" } as any,
      attendees: [] as any, source: "api",
    }).run()

    db.insert(schema.thread).values({
      id: "t-1", accountId: "acc-1", providerThreadId: "gt1",
      subject: "Meeting", snippet: "Join", participants: [] as any,
      lastMessageTime: now, createdAt: now, updatedAt: now,
    }).run()

    db.insert(schema.eventThread).values({
      eventId: "ev-1",
      threadId: "t-1",
    }).run()

    const links = db.select().from(schema.eventThread).all()
    expect(links).toHaveLength(1)
    expect(links[0]!.eventId).toBe("ev-1")
    expect(links[0]!.threadId).toBe("t-1")
  })
})

describe("Schema — Contact + SyncState", () => {
  let db: DB

  beforeEach(() => {
    cleanUp()
    db = Cache.init(TEST_DB)
    const now = new Date()

    db.insert(schema.account).values({
      id: "acc-1", providerId: "gmail", email: "user@gmail.com",
      name: "User", credentials: "{}", createdAt: now, updatedAt: now,
    }).run()
  })

  afterEach(() => {
    cleanUp()
  })

  test("insert contact", () => {
    db.insert(schema.contact).values({
      email: "alice@test.com",
      name: "Alice",
      accountId: "acc-1",
      frequency: 15,
      lastSeen: new Date(),
    }).run()

    const contacts = db.select().from(schema.contact).all()
    expect(contacts).toHaveLength(1)
    expect(contacts[0]!.frequency).toBe(15)
  })

  test("insert and update sync state", () => {
    db.insert(schema.syncState).values({
      accountId: "acc-1",
      status: "idle",
    }).run()

    db.update(schema.syncState)
      .set({ status: "syncing", cursor: "history-123" })
      .where(eq(schema.syncState.accountId, "acc-1"))
      .run()

    const states = db.select().from(schema.syncState).all()
    expect(states).toHaveLength(1)
    expect(states[0]!.status).toBe("syncing")
    expect(states[0]!.cursor).toBe("history-123")
  })
})
