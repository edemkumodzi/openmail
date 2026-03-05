import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { MailClient } from "../src/client/index.js"
import { Server } from "../src/server/server.js"
import { Cache } from "../src/cache/index.js"
import * as schema from "../src/cache/schema.js"
import { EventBus } from "../src/bus/index.js"
import { unlinkSync, existsSync } from "node:fs"

const TEST_DB = "/tmp/openmail-client-test.db"
const TEST_PORT = 14590 // Use a unique port to avoid conflicts

function cleanDb() {
  Cache.close()
  EventBus.clear()
  for (const suffix of ["", "-wal", "-shm"]) {
    const path = TEST_DB + suffix
    if (existsSync(path)) unlinkSync(path)
  }
}

function seedData() {
  const db = Cache.get()
  const now = new Date()

  db.insert(schema.account).values({
    id: "acc-1", providerId: "gmail", email: "user@gmail.com",
    name: "Test User", credentials: "{}", createdAt: now, updatedAt: now,
  }).run()

  db.insert(schema.folder).values([
    { id: "f-inbox", accountId: "acc-1", providerFolderId: "INBOX", name: "Inbox", type: "inbox", unreadCount: 3 },
    { id: "f-sent", accountId: "acc-1", providerFolderId: "SENT", name: "Sent", type: "sent", unreadCount: 0 },
  ]).run()

  db.insert(schema.label).values([
    { id: "l-work", accountId: "acc-1", providerLabelId: "L1", name: "Work", color: "#5c9cf5" },
  ]).run()

  db.insert(schema.thread).values([
    {
      id: "t-1", accountId: "acc-1", providerThreadId: "gt1",
      subject: "Planning doc", snippet: "Review the doc",
      participants: [{ name: "Alice", email: "alice@test.com" }] as any,
      messageCount: 1, hasAttachments: false, unread: true, starred: false,
      lastMessageTime: now, createdAt: now, updatedAt: now,
    },
  ]).run()

  db.insert(schema.threadFolder).values({ threadId: "t-1", folderId: "f-inbox" }).run()
  db.insert(schema.threadLabel).values({ threadId: "t-1", labelId: "l-work" }).run()

  db.insert(schema.message).values({
    id: "m-1", threadId: "t-1", accountId: "acc-1", providerMessageId: "gm1",
    fromName: "Alice", fromEmail: "alice@test.com",
    toRecipients: [{ name: "User", email: "user@gmail.com" }] as any,
    ccRecipients: [] as any, bccRecipients: [] as any,
    subject: "Planning doc", bodyText: "Please review", bodyHtml: "<p>Please review</p>",
    attachments: [] as any, time: now, unread: false,
  }).run()

  db.insert(schema.syncState).values({ accountId: "acc-1", status: "idle" }).run()
}

let serverStop: (() => void) | null = null

describe("MailClient — integration with real server", () => {
  beforeAll(() => {
    cleanDb()
    Cache.init(TEST_DB)
    seedData()

    const result = Server.start(TEST_PORT)
    serverStop = result.stop

    MailClient.init({ baseUrl: `http://localhost:${TEST_PORT}` })
  })

  afterAll(() => {
    serverStop?.()
    cleanDb()
  })

  test("health check returns true", async () => {
    const ok = await MailClient.health()
    expect(ok).toBe(true)
    expect(MailClient.isConnected()).toBe(true)
  })

  test("listThreads returns threads", async () => {
    const result = await MailClient.listThreads()
    expect(result.items).toHaveLength(1)
    expect(result.items[0].subject).toBe("Planning doc")
    expect(result.items[0].time).toBeInstanceOf(Date)
    expect(result.items[0].folders).toContain("f-inbox")
    expect(result.items[0].labels).toContain("l-work")
  })

  test("listThreads with folder filter", async () => {
    const inbox = await MailClient.listThreads({ folderId: "f-inbox" })
    expect(inbox.items).toHaveLength(1)

    const sent = await MailClient.listThreads({ folderId: "f-sent" })
    expect(sent.items).toHaveLength(0)
  })

  test("listThreads with label filter", async () => {
    const work = await MailClient.listThreads({ labelId: "l-work" })
    expect(work.items).toHaveLength(1)
  })

  test("getThread returns thread detail with messages", async () => {
    const detail = await MailClient.getThread("t-1")
    expect(detail).not.toBeNull()
    expect(detail!.subject).toBe("Planning doc")
    expect(detail!.messages).toHaveLength(1)
    expect(detail!.messages[0].from.name).toBe("Alice")
    expect(detail!.messages[0].body.text).toBe("Please review")
    expect(detail!.messages[0].time).toBeInstanceOf(Date)
  })

  test("getThread returns null for missing thread", async () => {
    const detail = await MailClient.getThread("nonexistent")
    expect(detail).toBeNull()
  })

  test("listFolders returns folders", async () => {
    const folders = await MailClient.listFolders()
    expect(folders).toHaveLength(2)
    expect(folders.map((f) => f.name).sort()).toEqual(["Inbox", "Sent"])
  })

  test("listLabels returns labels", async () => {
    const labels = await MailClient.listLabels()
    expect(labels).toHaveLength(1)
    expect(labels[0].name).toBe("Work")
    expect(labels[0].color).toBe("#5c9cf5")
  })

  test("listAccounts returns accounts without credentials", async () => {
    const accounts = await MailClient.listAccounts()
    expect(accounts).toHaveLength(1)
    expect(accounts[0].email).toBe("user@gmail.com")
    expect((accounts[0] as any).credentials).toBeUndefined()
  })

  test("getSyncState returns sync state", async () => {
    const state = await MailClient.getSyncState("acc-1")
    expect(state).not.toBeNull()
    expect(state!.status).toBe("idle")
  })

  test("action endpoints return success", async () => {
    // These are stubs for now, but the client should handle them
    expect(await MailClient.archiveThread("t-1")).toBe(true)
    expect(await MailClient.trashThread("t-1")).toBe(true)
    expect(await MailClient.starThread("t-1")).toBe(true)
    expect(await MailClient.unstarThread("t-1")).toBe(true)
    expect(await MailClient.markRead("t-1")).toBe(true)
    expect(await MailClient.markUnread("t-1")).toBe(true)
  })
})

describe("MailClient — offline behavior", () => {
  test("health returns false when server not running", async () => {
    MailClient.init({ baseUrl: "http://localhost:19999" }) // no server on this port
    const ok = await MailClient.health()
    expect(ok).toBe(false)
    expect(MailClient.isConnected()).toBe(false)
  })
})
