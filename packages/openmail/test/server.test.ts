import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { Server } from "../src/server/server.js"
import { Cache } from "../src/cache/index.js"
import * as schema from "../src/cache/schema.js"
import { EventBus } from "../src/bus/index.js"
import { unlinkSync, existsSync } from "node:fs"

const TEST_DB = "/tmp/openmail-server-test.db"

function cleanUp() {
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
    name: "User", credentials: "{}", createdAt: now, updatedAt: now,
  }).run()

  db.insert(schema.folder).values([
    { id: "f-inbox", accountId: "acc-1", providerFolderId: "INBOX", name: "Inbox", type: "inbox", unreadCount: 2 },
    { id: "f-sent", accountId: "acc-1", providerFolderId: "SENT", name: "Sent", type: "sent", unreadCount: 0 },
  ]).run()

  db.insert(schema.label).values([
    { id: "l-work", accountId: "acc-1", providerLabelId: "Label_1", name: "work", color: "#5c9cf5" },
    { id: "l-personal", accountId: "acc-1", providerLabelId: "Label_2", name: "personal", color: "#7fd88f" },
  ]).run()

  db.insert(schema.thread).values([
    {
      id: "t-1", accountId: "acc-1", providerThreadId: "gt1",
      subject: "Quarterly planning", snippet: "Review the doc",
      participants: [{ name: "Alice", email: "alice@test.com" }] as any,
      messageCount: 2, hasAttachments: true, unread: true, starred: false,
      lastMessageTime: new Date(now.getTime() - 60000),
      createdAt: now, updatedAt: now,
    },
    {
      id: "t-2", accountId: "acc-1", providerThreadId: "gt2",
      subject: "API discussion", snippet: "Token bucket approach",
      participants: [{ name: "Bob", email: "bob@test.com" }] as any,
      messageCount: 3, hasAttachments: false, unread: true, starred: true,
      lastMessageTime: now,
      createdAt: now, updatedAt: now,
    },
  ]).run()

  db.insert(schema.threadFolder).values([
    { threadId: "t-1", folderId: "f-inbox" },
    { threadId: "t-2", folderId: "f-inbox" },
  ]).run()

  db.insert(schema.threadLabel).values([
    { threadId: "t-1", labelId: "l-work" },
    { threadId: "t-2", labelId: "l-work" },
    { threadId: "t-1", labelId: "l-personal" },
  ]).run()

  db.insert(schema.message).values([
    {
      id: "m-1", threadId: "t-1", accountId: "acc-1", providerMessageId: "gm1",
      fromName: "Alice", fromEmail: "alice@test.com",
      toRecipients: [{ name: "User", email: "user@gmail.com" }] as any,
      ccRecipients: [] as any, bccRecipients: [] as any,
      subject: "Quarterly planning", bodyText: "Please review", bodyHtml: "<p>Please review</p>",
      attachments: [{ id: "a1", filename: "plan.pdf", mimeType: "application/pdf", size: 1000 }] as any,
      time: now, unread: false,
    },
    {
      id: "m-2", threadId: "t-1", accountId: "acc-1", providerMessageId: "gm2",
      fromName: "User", fromEmail: "user@gmail.com",
      toRecipients: [{ name: "Alice", email: "alice@test.com" }] as any,
      ccRecipients: [] as any, bccRecipients: [] as any,
      subject: "Re: Quarterly planning", bodyText: "Will review",
      attachments: [] as any,
      time: new Date(now.getTime() + 60000), unread: false,
    },
  ]).run()

  db.insert(schema.syncState).values({
    accountId: "acc-1", status: "idle",
  }).run()
}

describe("Server — Health", () => {
  let app: ReturnType<typeof Server.createApp>

  beforeEach(() => {
    cleanUp()
    Cache.init(TEST_DB)
    app = Server.createApp()
  })

  afterEach(() => { cleanUp() })

  test("GET /health returns ok", async () => {
    const res = await app.request("/health")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("ok")
  })
})

describe("Server — Threads", () => {
  let app: ReturnType<typeof Server.createApp>

  beforeEach(() => {
    cleanUp()
    Cache.init(TEST_DB)
    seedData()
    app = Server.createApp()
  })

  afterEach(() => { cleanUp() })

  test("GET /threads returns all threads", async () => {
    const res = await app.request("/threads")
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.items).toHaveLength(2)
    // Ordered by lastMessageTime DESC
    expect(body.items[0].subject).toBe("API discussion")
    expect(body.items[1].subject).toBe("Quarterly planning")
  })

  test("GET /threads?folderId= filters by folder", async () => {
    const res = await app.request("/threads?folderId=f-inbox")
    const body = await res.json() as any
    expect(body.items).toHaveLength(2)
  })

  test("GET /threads?folderId= with empty folder", async () => {
    const res = await app.request("/threads?folderId=f-sent")
    const body = await res.json() as any
    expect(body.items).toHaveLength(0)
  })

  test("GET /threads?labelId= filters by label", async () => {
    const res = await app.request("/threads?labelId=l-work")
    const body = await res.json() as any
    expect(body.items).toHaveLength(2)
  })

  test("GET /threads?labelId= with partial match", async () => {
    const res = await app.request("/threads?labelId=l-personal")
    const body = await res.json() as any
    expect(body.items).toHaveLength(1)
    expect(body.items[0].subject).toBe("Quarterly planning")
  })

  test("GET /threads/:id returns thread detail", async () => {
    const res = await app.request("/threads/t-1")
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.subject).toBe("Quarterly planning")
    expect(body.messages).toHaveLength(2)
    expect(body.messages[0].from.name).toBe("Alice")
    expect(body.folders).toContain("f-inbox")
    expect(body.labels).toContain("l-work")
  })

  test("GET /threads/:id returns 404 for missing thread", async () => {
    const res = await app.request("/threads/nonexistent")
    expect(res.status).toBe(404)
  })

  test("thread items include enriched data", async () => {
    const res = await app.request("/threads")
    const body = await res.json() as any
    const t1 = body.items.find((t: any) => t.id === "t-1")
    expect(t1.folders).toContain("f-inbox")
    expect(t1.labels).toContain("l-work")
    expect(t1.labels).toContain("l-personal")
    expect(t1.hasAttachments).toBe(true)
  })
})

describe("Server — Folders", () => {
  let app: ReturnType<typeof Server.createApp>

  beforeEach(() => {
    cleanUp()
    Cache.init(TEST_DB)
    seedData()
    app = Server.createApp()
  })

  afterEach(() => { cleanUp() })

  test("GET /folders returns all folders", async () => {
    const res = await app.request("/folders")
    const body = await res.json() as any
    expect(body.items).toHaveLength(2)
    expect(body.items.map((f: any) => f.name).sort()).toEqual(["Inbox", "Sent"])
  })

  test("GET /folders?accountId= filters by account", async () => {
    const res = await app.request("/folders?accountId=acc-1")
    const body = await res.json() as any
    expect(body.items).toHaveLength(2)
  })
})

describe("Server — Labels", () => {
  let app: ReturnType<typeof Server.createApp>

  beforeEach(() => {
    cleanUp()
    Cache.init(TEST_DB)
    seedData()
    app = Server.createApp()
  })

  afterEach(() => { cleanUp() })

  test("GET /labels returns all labels", async () => {
    const res = await app.request("/labels")
    const body = await res.json() as any
    expect(body.items).toHaveLength(2)
    expect(body.items.map((l: any) => l.name).sort()).toEqual(["personal", "work"])
  })
})

describe("Server — Accounts", () => {
  let app: ReturnType<typeof Server.createApp>

  beforeEach(() => {
    cleanUp()
    Cache.init(TEST_DB)
    seedData()
    app = Server.createApp()
  })

  afterEach(() => { cleanUp() })

  test("GET /accounts returns accounts", async () => {
    const res = await app.request("/accounts")
    const body = await res.json() as any
    expect(body.items).toHaveLength(1)
    expect(body.items[0].email).toBe("user@gmail.com")
    // Should not expose credentials
    expect(body.items[0].credentials).toBeUndefined()
  })

  test("GET /accounts/:id returns single account", async () => {
    const res = await app.request("/accounts/acc-1")
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.email).toBe("user@gmail.com")
  })

  test("GET /accounts/:id returns 404 for missing", async () => {
    const res = await app.request("/accounts/nonexistent")
    expect(res.status).toBe(404)
  })

  test("GET /accounts/:id/sync returns sync state", async () => {
    const res = await app.request("/accounts/acc-1/sync")
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.status).toBe("idle")
  })
})

describe("EventBus", () => {
  beforeEach(() => {
    EventBus.clear()
  })

  test("on/emit for specific event type", () => {
    const events: EventBus.Event[] = []
    EventBus.on("thread.created", (e) => events.push(e))

    EventBus.emit("thread.created", { threadId: "t-1" }, "acc-1")

    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe("thread.created")
    expect(events[0]!.data.threadId).toBe("t-1")
    expect(events[0]!.accountId).toBe("acc-1")
  })

  test("wildcard listener receives all events", () => {
    const events: EventBus.Event[] = []
    EventBus.on("*", (e) => events.push(e))

    EventBus.emit("thread.created", { id: "1" })
    EventBus.emit("sync.completed", { count: 5 })

    expect(events).toHaveLength(2)
  })

  test("unsubscribe removes listener", () => {
    const events: EventBus.Event[] = []
    const unsub = EventBus.on("thread.created", (e) => events.push(e))

    EventBus.emit("thread.created", {})
    expect(events).toHaveLength(1)

    unsub()
    EventBus.emit("thread.created", {})
    expect(events).toHaveLength(1) // not called again
  })

  test("listener errors don't break other listeners", () => {
    const events: EventBus.Event[] = []

    EventBus.on("thread.created", () => { throw new Error("boom") })
    EventBus.on("thread.created", (e) => events.push(e))

    EventBus.emit("thread.created", {})
    expect(events).toHaveLength(1) // second listener still called
  })

  test("listenerCount", () => {
    expect(EventBus.listenerCount("thread.created")).toBe(0)
    const unsub = EventBus.on("thread.created", () => {})
    expect(EventBus.listenerCount("thread.created")).toBe(1)
    unsub()
    expect(EventBus.listenerCount("thread.created")).toBe(0)
  })

  test("clear removes all listeners", () => {
    EventBus.on("thread.created", () => {})
    EventBus.on("sync.completed", () => {})
    EventBus.on("*", () => {})

    EventBus.clear()
    expect(EventBus.listenerCount("thread.created")).toBe(0)
    expect(EventBus.listenerCount("*")).toBe(0)
  })
})
