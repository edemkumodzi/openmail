import { describe, expect, test } from "bun:test"
import { MockData } from "../src/mail/mock.js"

describe("mock data shape validation", () => {
  describe("folders", () => {
    test("has at least one folder", () => {
      expect(MockData.folders.length).toBeGreaterThan(0)
    })

    test("has required system folders", () => {
      const folderIds = MockData.folders.map((f) => f.id)
      expect(folderIds).toContain("folder:INBOX")
      expect(folderIds).toContain("folder:SENT")
      expect(folderIds).toContain("folder:DRAFTS")
      expect(folderIds).toContain("folder:TRASH")
      expect(folderIds).toContain("folder:SPAM")
    })

    test("every folder has an id and name", () => {
      for (const folder of MockData.folders) {
        expect(typeof folder.id).toBe("string")
        expect(folder.id.length).toBeGreaterThan(0)
        expect(typeof folder.name).toBe("string")
        expect(folder.name.length).toBeGreaterThan(0)
      }
    })

    test("every folder has a valid type", () => {
      const validTypes = ["inbox", "sent", "drafts", "trash", "spam", "starred", "archive", "custom"]
      for (const folder of MockData.folders) {
        expect(validTypes).toContain(folder.type)
      }
    })

    test("unread counts are non-negative", () => {
      for (const folder of MockData.folders) {
        expect(folder.unreadCount).toBeGreaterThanOrEqual(0)
      }
    })
  })

  describe("labels", () => {
    test("has at least one label", () => {
      expect(MockData.labels.length).toBeGreaterThan(0)
    })

    test("every label has id, name, and hex color", () => {
      for (const label of MockData.labels) {
        expect(typeof label.id).toBe("string")
        expect(label.id.length).toBeGreaterThan(0)
        expect(typeof label.name).toBe("string")
        expect(label.name.length).toBeGreaterThan(0)
        expect(label.color).toMatch(/^#[0-9a-fA-F]{6}$/)
      }
    })

    test("label ids are unique", () => {
      const ids = MockData.labels.map((l) => l.id)
      expect(new Set(ids).size).toBe(ids.length)
    })
  })

  describe("threads", () => {
    test("has at least one thread", () => {
      expect(MockData.threads.length).toBeGreaterThan(0)
    })

    test("every thread has required fields", () => {
      for (const thread of MockData.threads) {
        expect(typeof thread.id).toBe("string")
        expect(thread.id.length).toBeGreaterThan(0)
        expect(typeof thread.subject).toBe("string")
        expect(typeof thread.snippet).toBe("string")
        expect(thread.participants.length).toBeGreaterThan(0)
        expect(thread.messageCount).toBeGreaterThan(0)
        expect(typeof thread.unread).toBe("boolean")
        expect(typeof thread.starred).toBe("boolean")
        expect(thread.time).toBeInstanceOf(Date)
        expect(Array.isArray(thread.folders)).toBe(true)
        expect(Array.isArray(thread.labels)).toBe(true)
        expect(Array.isArray(thread.linkedEventIds)).toBe(true)
      }
    })

    test("thread ids are unique", () => {
      const ids = MockData.threads.map((t) => t.id)
      expect(new Set(ids).size).toBe(ids.length)
    })

    test("threads are sorted by time (most recent first)", () => {
      for (let i = 1; i < MockData.threads.length; i++) {
        expect(MockData.threads[i - 1]!.time.getTime())
          .toBeGreaterThanOrEqual(MockData.threads[i]!.time.getTime())
      }
    })

    test("every participant has name and email", () => {
      for (const thread of MockData.threads) {
        for (const p of thread.participants) {
          expect(typeof p.name).toBe("string")
          expect(p.name.length).toBeGreaterThan(0)
          expect(typeof p.email).toBe("string")
          expect(p.email).toContain("@")
        }
      }
    })
  })

  describe("thread details", () => {
    test("has at least one thread detail", () => {
      expect(Object.keys(MockData.threadDetails).length).toBeGreaterThan(0)
    })

    test("every detail id matches a thread", () => {
      const threadIds = MockData.threads.map((t) => t.id)
      for (const id of Object.keys(MockData.threadDetails)) {
        expect(threadIds).toContain(id)
      }
    })

    test("every detail has messages matching messageCount", () => {
      for (const [id, detail] of Object.entries(MockData.threadDetails)) {
        expect(detail.messages.length).toBe(detail.messageCount)
      }
    })

    test("every message has required fields", () => {
      for (const detail of Object.values(MockData.threadDetails)) {
        for (const msg of detail.messages) {
          expect(typeof msg.id).toBe("string")
          expect(typeof msg.threadId).toBe("string")
          expect(msg.threadId).toBe(detail.id)
          expect(typeof msg.from.name).toBe("string")
          expect(msg.from.email).toContain("@")
          expect(msg.to.length).toBeGreaterThan(0)
          expect(Array.isArray(msg.cc)).toBe(true)
          expect(typeof msg.subject).toBe("string")
          expect(typeof msg.body.text).toBe("string")
          expect(msg.body.text.length).toBeGreaterThan(0)
          expect(Array.isArray(msg.attachments)).toBe(true)
          expect(msg.time).toBeInstanceOf(Date)
          expect(typeof msg.unread).toBe("boolean")
        }
      }
    })

    test("message ids are unique across all details", () => {
      const allMsgIds: string[] = []
      for (const detail of Object.values(MockData.threadDetails)) {
        for (const msg of detail.messages) {
          allMsgIds.push(msg.id)
        }
      }
      expect(new Set(allMsgIds).size).toBe(allMsgIds.length)
    })
  })

  describe("events", () => {
    test("has at least one event", () => {
      expect(MockData.events.length).toBeGreaterThan(0)
    })

    test("every event has required fields", () => {
      for (const event of MockData.events) {
        expect(typeof event.id).toBe("string")
        expect(typeof event.summary).toBe("string")
        expect(event.start).toBeInstanceOf(Date)
        expect(event.end).toBeInstanceOf(Date)
        expect(event.end.getTime()).toBeGreaterThan(event.start.getTime())
        expect(typeof event.allDay).toBe("boolean")
        expect(event.organizer.email).toContain("@")
        expect(Array.isArray(event.attendees)).toBe(true)
        expect(Array.isArray(event.linkedThreadIds)).toBe(true)
      }
    })

    test("event ids are unique", () => {
      const ids = MockData.events.map((e) => e.id)
      expect(new Set(ids).size).toBe(ids.length)
    })

    test("attendees have valid statuses", () => {
      const validStatuses = ["accepted", "tentative", "declined", "needs-action"]
      for (const event of MockData.events) {
        for (const attendee of event.attendees) {
          expect(validStatuses).toContain(attendee.status)
          expect(["required", "optional"]).toContain(attendee.role)
          expect(attendee.participant.email).toContain("@")
        }
      }
    })

    test("linkedThreadIds reference valid thread ids", () => {
      const threadIds = MockData.threads.map((t) => t.id)
      for (const event of MockData.events) {
        for (const tid of event.linkedThreadIds) {
          expect(threadIds).toContain(tid)
        }
      }
    })
  })

  describe("me", () => {
    test("has name and email", () => {
      expect(typeof MockData.me.name).toBe("string")
      expect(MockData.me.name.length).toBeGreaterThan(0)
      expect(MockData.me.email).toContain("@")
    })
  })
})
