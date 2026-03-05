import { describe, test, expect, beforeEach } from "bun:test"
import { ProviderRegistry } from "../src/provider/registry.js"
import { MailProvider, CalendarProvider } from "../src/provider/types.js"
import { Mail } from "../src/mail/types.js"

// Minimal mock provider for testing
function createMockProvider(overrides: Partial<MailProvider.Info> = {}): MailProvider.Plugin {
  return {
    info: {
      id: overrides.id ?? "mock",
      name: overrides.name ?? "Mock Provider",
      capabilities: overrides.capabilities ?? [],
    },
    auth: async () => ({ accountId: "a1", email: "test@test.com", name: "Test", accessToken: "tok" }),
    disconnect: async () => {},
    list: async () => ({ items: [], hasMore: false }),
    getThread: async () => ({ id: "t1", subject: "", snippet: "", participants: [], messageCount: 0, hasAttachments: false, folders: [], labels: [], unread: false, starred: false, time: new Date(), linkedEventIds: [], messages: [] }),
    getMessage: async () => ({ id: "m1", threadId: "t1", from: { name: "", email: "" }, to: [], cc: [], subject: "", body: { text: "" }, attachments: [], time: new Date(), unread: false }),
    send: async () => ({ id: "m1" }),
    reply: async () => ({ id: "m1" }),
    archive: async () => {},
    trash: async () => {},
    markRead: async () => {},
    markUnread: async () => {},
    star: async () => {},
    unstar: async () => {},
    listFolders: async () => [],
    moveToFolder: async () => {},
  }
}

// Mock provider with all capabilities
function createFullProvider(): MailProvider.Plugin & MailProvider.Searchable & MailProvider.Labelable & MailProvider.IncrementallySyncable & MailProvider.Draftable {
  const base = createMockProvider({
    id: "full",
    name: "Full Provider",
    capabilities: ["threads", "labels", "search", "incremental-sync", "drafts"],
  })
  return {
    ...base,
    // Searchable
    search: async () => ({ items: [], hasMore: false }),
    searchSyntaxHint: () => "from:user subject:hello",
    // Labelable
    listLabels: async () => [],
    createLabel: async (name: string) => ({ id: "l1", name, color: "#000" }),
    deleteLabel: async () => {},
    addLabel: async () => {},
    removeLabel: async () => {},
    // IncrementallySyncable
    sync: async () => ({ newCursor: "c1", threads: [], deletedThreadIds: [], hasMore: false }),
    // Draftable
    listDrafts: async () => [],
    saveDraft: async () => ({ id: "d1" }),
    updateDraft: async () => {},
    deleteDraft: async () => {},
    sendDraft: async () => ({ id: "m1" }),
  }
}

describe("ProviderRegistry", () => {
  beforeEach(() => {
    ProviderRegistry.clear()
  })

  test("register and get provider", () => {
    const provider = createMockProvider({ id: "gmail" })
    ProviderRegistry.register(provider)
    const result = ProviderRegistry.get("gmail")
    expect(result).toBe(provider)
  })

  test("register duplicate throws", () => {
    const provider = createMockProvider({ id: "gmail" })
    ProviderRegistry.register(provider)
    expect(() => ProviderRegistry.register(provider)).toThrow("already registered")
  })

  test("get unknown provider throws", () => {
    expect(() => ProviderRegistry.get("unknown")).toThrow('Provider "unknown" not found')
  })

  test("list returns all provider info", () => {
    ProviderRegistry.register(createMockProvider({ id: "gmail", name: "Gmail" }))
    ProviderRegistry.register(createMockProvider({ id: "outlook", name: "Outlook" }))

    const infos = ProviderRegistry.list()
    expect(infos).toHaveLength(2)
    expect(infos.map((i) => i.id).sort()).toEqual(["gmail", "outlook"])
  })

  test("hasCapability returns correct value", () => {
    ProviderRegistry.register(createMockProvider({
      id: "gmail",
      capabilities: ["threads", "labels", "search"],
    }))

    expect(ProviderRegistry.hasCapability("gmail", "threads")).toBe(true)
    expect(ProviderRegistry.hasCapability("gmail", "labels")).toBe(true)
    expect(ProviderRegistry.hasCapability("gmail", "search")).toBe(true)
    expect(ProviderRegistry.hasCapability("gmail", "push")).toBe(false)
    expect(ProviderRegistry.hasCapability("gmail", "calendar")).toBe(false)
  })

  test("hasCapability returns false for unknown provider", () => {
    expect(ProviderRegistry.hasCapability("unknown", "threads")).toBe(false)
  })

  test("clear removes all providers", () => {
    ProviderRegistry.register(createMockProvider({ id: "a" }))
    ProviderRegistry.register(createMockProvider({ id: "b" }))
    expect(ProviderRegistry.list()).toHaveLength(2)

    ProviderRegistry.clear()
    expect(ProviderRegistry.list()).toHaveLength(0)
  })
})

describe("ProviderRegistry — capability narrowing", () => {
  beforeEach(() => {
    ProviderRegistry.clear()
  })

  test("asSearchable returns null for provider without search", () => {
    const provider = createMockProvider({ id: "basic" })
    expect(ProviderRegistry.asSearchable(provider)).toBeNull()
  })

  test("asSearchable returns provider with search capability", () => {
    const provider = createFullProvider()
    const searchable = ProviderRegistry.asSearchable(provider)
    expect(searchable).not.toBeNull()
    expect(searchable!.searchSyntaxHint()).toBe("from:user subject:hello")
  })

  test("asLabelable returns null for provider without labels", () => {
    const provider = createMockProvider({ id: "basic" })
    expect(ProviderRegistry.asLabelable(provider)).toBeNull()
  })

  test("asLabelable returns provider with labels capability", () => {
    const provider = createFullProvider()
    const labelable = ProviderRegistry.asLabelable(provider)
    expect(labelable).not.toBeNull()
  })

  test("asIncrementallySyncable works", () => {
    const basic = createMockProvider({ id: "basic" })
    expect(ProviderRegistry.asIncrementallySyncable(basic)).toBeNull()

    const full = createFullProvider()
    const syncable = ProviderRegistry.asIncrementallySyncable(full)
    expect(syncable).not.toBeNull()
  })

  test("asDraftable works", () => {
    const basic = createMockProvider({ id: "basic" })
    expect(ProviderRegistry.asDraftable(basic)).toBeNull()

    const full = createFullProvider()
    const draftable = ProviderRegistry.asDraftable(full)
    expect(draftable).not.toBeNull()
  })

  test("asPushable returns null without push", () => {
    const provider = createMockProvider({ id: "basic" })
    expect(ProviderRegistry.asPushable(provider)).toBeNull()
  })

  test("asCalendar returns null without calendar", () => {
    const provider = createMockProvider({ id: "basic" })
    expect(ProviderRegistry.asCalendar(provider)).toBeNull()
  })
})

describe("MailProvider.Plugin interface", () => {
  test("mock provider implements full interface", async () => {
    const provider = createMockProvider({ id: "test" })

    const authResult = await provider.auth()
    expect(authResult.email).toBe("test@test.com")

    const list = await provider.list({})
    expect(list.items).toEqual([])
    expect(list.hasMore).toBe(false)

    const folders = await provider.listFolders()
    expect(folders).toEqual([])
  })

  test("full provider implements all extensions", async () => {
    const provider = createFullProvider()

    const searchResult = await provider.search("test")
    expect(searchResult.items).toEqual([])

    const labels = await provider.listLabels()
    expect(labels).toEqual([])

    const syncResult = await provider.sync(null)
    expect(syncResult.newCursor).toBe("c1")

    const drafts = await provider.listDrafts()
    expect(drafts).toEqual([])
  })
})
