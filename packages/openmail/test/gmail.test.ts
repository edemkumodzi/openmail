import { describe, test, expect } from "bun:test"
import { Mime } from "../src/provider/gmail/mime.js"
import { GmailMapping } from "../src/provider/gmail/mapping.js"
import { GmailApi } from "../src/provider/gmail/api.js"
import { GmailProvider } from "../src/provider/gmail/index.js"
import type { gmail_v1 } from "googleapis"

// --- MIME Parsing ---

describe("Mime — decodeBase64Url", () => {
  test("decodes standard base64url to UTF-8", () => {
    const encoded = Buffer.from("Hello, World!").toString("base64url")
    expect(Mime.decodeBase64Url(encoded)).toBe("Hello, World!")
  })

  test("handles padding correctly", () => {
    const encoded = Buffer.from("A").toString("base64url") // "QQ"
    expect(Mime.decodeBase64Url(encoded)).toBe("A")
  })

  test("handles unicode", () => {
    const encoded = Buffer.from("Héllo Wörld 日本語").toString("base64url")
    expect(Mime.decodeBase64Url(encoded)).toBe("Héllo Wörld 日本語")
  })

  test("handles empty string", () => {
    expect(Mime.decodeBase64Url("")).toBe("")
  })
})

describe("Mime — parseEmailAddress", () => {
  test("parses 'Name <email>' format", () => {
    const result = Mime.parseEmailAddress("Alice Smith <alice@test.com>")
    expect(result.name).toBe("Alice Smith")
    expect(result.email).toBe("alice@test.com")
  })

  test("parses quoted name format", () => {
    const result = Mime.parseEmailAddress('"Bob Jones" <bob@test.com>')
    expect(result.name).toBe("Bob Jones")
    expect(result.email).toBe("bob@test.com")
  })

  test("parses plain email address", () => {
    const result = Mime.parseEmailAddress("alice@test.com")
    expect(result.name).toBe("alice")
    expect(result.email).toBe("alice@test.com")
  })

  test("handles extra whitespace", () => {
    const result = Mime.parseEmailAddress("  Alice  <  alice@test.com  >")
    expect(result.name).toBe("Alice")
    expect(result.email).toBe("alice@test.com")
  })
})

describe("Mime — parseEmailList", () => {
  test("parses single address", () => {
    const result = Mime.parseEmailList("Alice <alice@test.com>")
    expect(result).toHaveLength(1)
    expect(result[0].email).toBe("alice@test.com")
  })

  test("parses multiple addresses", () => {
    const result = Mime.parseEmailList("Alice <alice@test.com>, Bob <bob@test.com>")
    expect(result).toHaveLength(2)
    expect(result[0].email).toBe("alice@test.com")
    expect(result[1].email).toBe("bob@test.com")
  })

  test("returns empty array for undefined", () => {
    expect(Mime.parseEmailList(undefined)).toEqual([])
  })

  test("returns empty array for empty string", () => {
    expect(Mime.parseEmailList("")).toEqual([])
  })

  test("filters out invalid addresses", () => {
    const result = Mime.parseEmailList("Alice <alice@test.com>, invalid, Bob <bob@test.com>")
    expect(result).toHaveLength(2)
  })
})

describe("Mime — getHeader", () => {
  const headers: gmail_v1.Schema$MessagePartHeader[] = [
    { name: "From", value: "alice@test.com" },
    { name: "To", value: "bob@test.com" },
    { name: "Subject", value: "Test Subject" },
    { name: "Message-ID", value: "<msg-123@test.com>" },
  ]

  test("finds header by name (case-insensitive)", () => {
    expect(Mime.getHeader(headers, "from")).toBe("alice@test.com")
    expect(Mime.getHeader(headers, "FROM")).toBe("alice@test.com")
    expect(Mime.getHeader(headers, "From")).toBe("alice@test.com")
  })

  test("returns undefined for missing header", () => {
    expect(Mime.getHeader(headers, "Cc")).toBeUndefined()
  })

  test("returns undefined for undefined headers", () => {
    expect(Mime.getHeader(undefined, "From")).toBeUndefined()
  })
})

describe("Mime — parsePayload", () => {
  test("handles undefined payload", () => {
    const result = Mime.parsePayload(undefined)
    expect(result.body.text).toBe("")
    expect(result.attachments).toEqual([])
    expect(result.hasCalendarInvite).toBe(false)
  })

  test("parses simple text/plain message", () => {
    const payload: gmail_v1.Schema$MessagePart = {
      mimeType: "text/plain",
      body: {
        data: Buffer.from("Hello World").toString("base64url"),
      },
    }
    const result = Mime.parsePayload(payload)
    expect(result.body.text).toBe("Hello World")
    expect(result.body.html).toBeUndefined()
  })

  test("parses simple text/html message", () => {
    const payload: gmail_v1.Schema$MessagePart = {
      mimeType: "text/html",
      body: {
        data: Buffer.from("<p>Hello World</p>").toString("base64url"),
      },
    }
    const result = Mime.parsePayload(payload)
    expect(result.body.html).toBe("<p>Hello World</p>")
    // Should generate text fallback
    expect(result.body.text).toBe("Hello World")
  })

  test("parses multipart/alternative message", () => {
    const payload: gmail_v1.Schema$MessagePart = {
      mimeType: "multipart/alternative",
      parts: [
        {
          mimeType: "text/plain",
          body: { data: Buffer.from("Plain text body").toString("base64url") },
        },
        {
          mimeType: "text/html",
          body: { data: Buffer.from("<p>HTML body</p>").toString("base64url") },
        },
      ],
    }
    const result = Mime.parsePayload(payload)
    expect(result.body.text).toBe("Plain text body")
    expect(result.body.html).toBe("<p>HTML body</p>")
  })

  test("extracts attachments", () => {
    const payload: gmail_v1.Schema$MessagePart = {
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "text/plain",
          body: { data: Buffer.from("Body text").toString("base64url") },
        },
        {
          mimeType: "application/pdf",
          filename: "report.pdf",
          body: { attachmentId: "att-123", size: 12345 },
        },
      ],
    }
    const result = Mime.parsePayload(payload)
    expect(result.body.text).toBe("Body text")
    expect(result.attachments).toHaveLength(1)
    expect(result.attachments[0].id).toBe("att-123")
    expect(result.attachments[0].filename).toBe("report.pdf")
    expect(result.attachments[0].mimeType).toBe("application/pdf")
    expect(result.attachments[0].size).toBe(12345)
  })

  test("detects calendar invites", () => {
    const payload: gmail_v1.Schema$MessagePart = {
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "text/plain",
          body: { data: Buffer.from("You have an invite").toString("base64url") },
        },
        {
          mimeType: "text/calendar",
          filename: "invite.ics",
          body: { attachmentId: "cal-1", size: 500 },
        },
      ],
    }
    const result = Mime.parsePayload(payload)
    expect(result.hasCalendarInvite).toBe(true)
  })

  test("handles deeply nested multipart", () => {
    const payload: gmail_v1.Schema$MessagePart = {
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [
            {
              mimeType: "text/plain",
              body: { data: Buffer.from("Nested plain").toString("base64url") },
            },
            {
              mimeType: "text/html",
              body: { data: Buffer.from("<b>Nested HTML</b>").toString("base64url") },
            },
          ],
        },
        {
          mimeType: "image/png",
          filename: "photo.png",
          body: { attachmentId: "img-1", size: 5000 },
        },
      ],
    }
    const result = Mime.parsePayload(payload)
    expect(result.body.text).toBe("Nested plain")
    expect(result.body.html).toBe("<b>Nested HTML</b>")
    expect(result.attachments).toHaveLength(1)
    expect(result.attachments[0].filename).toBe("photo.png")
  })
})

describe("Mime — stripHtml", () => {
  test("strips style and script blocks", () => {
    const html = `<html><head><style>body { color: red; }</style></head><body><p>Hello</p></body></html>`
    const result = Mime.stripHtml(html)
    expect(result).toBe("Hello")
    expect(result).not.toContain("color")
    expect(result).not.toContain("style")
  })

  test("preserves link text and href", () => {
    const html = `<p>Click <a href="https://example.com">here</a> to visit</p>`
    const result = Mime.stripHtml(html)
    expect(result).toContain("here")
    expect(result).toContain("https://example.com")
  })

  test("converts block elements to newlines", () => {
    const html = `<div>Line 1</div><div>Line 2</div><p>Paragraph</p>`
    const result = Mime.stripHtml(html)
    expect(result).toContain("Line 1")
    expect(result).toContain("Line 2")
    expect(result).toContain("Paragraph")
  })

  test("handles complex real-world HTML email", () => {
    const html = `
      <html>
      <head>
        <style>.container { max-width: 600px; } .header { background: #333; color: #fff; }</style>
      </head>
      <body>
        <div class="container">
          <div class="header"><h1>Newsletter</h1></div>
          <p>Dear subscriber,</p>
          <p>Here is your weekly update.</p>
          <ul>
            <li>Item one</li>
            <li>Item two</li>
          </ul>
          <p>Best,<br>The Team</p>
        </div>
      </body>
      </html>
    `
    const result = Mime.stripHtml(html)
    expect(result).toContain("Newsletter")
    expect(result).toContain("Dear subscriber")
    expect(result).toContain("weekly update")
    expect(result).toContain("Item one")
    expect(result).toContain("Item two")
    expect(result).toContain("Best,")
    expect(result).toContain("The Team")
    expect(result).not.toContain("max-width")
    expect(result).not.toContain("class=")
    expect(result.length).toBeGreaterThan(20)
  })

  test("decodes HTML entities", () => {
    const html = `<p>Price: &lt;$100&gt; &amp; &quot;free&quot; isn&#39;t real</p>`
    const result = Mime.stripHtml(html)
    expect(result).toContain("<$100>")
    expect(result).toContain('& "free"')
    expect(result).toContain("isn't")
  })

  test("removes HTML comments", () => {
    const html = `<p>Visible</p><!-- hidden comment --><p>Also visible</p>`
    const result = Mime.stripHtml(html)
    expect(result).toContain("Visible")
    expect(result).toContain("Also visible")
    expect(result).not.toContain("hidden comment")
  })

  test("converts hr to separator", () => {
    const html = `<p>Above</p><hr><p>Below</p>`
    const result = Mime.stripHtml(html)
    expect(result).toContain("Above")
    expect(result).toContain("---")
    expect(result).toContain("Below")
  })
})

// --- Gmail Mapping ---

describe("GmailMapping — threadToSummary", () => {
  test("maps a Gmail thread to ThreadSummary", () => {
    const thread: gmail_v1.Schema$Thread = {
      id: "thread-123",
      snippet: "Hey, let's meet tomorrow",
      messages: [
        {
          id: "msg-1",
          threadId: "thread-123",
          internalDate: "1700000000000",
          labelIds: ["INBOX", "UNREAD"],
          payload: {
            headers: [
              { name: "From", value: "Alice <alice@test.com>" },
              { name: "Subject", value: "Meeting Tomorrow" },
            ],
            mimeType: "text/plain",
            body: { data: Buffer.from("Hey").toString("base64url") },
          },
        },
        {
          id: "msg-2",
          threadId: "thread-123",
          internalDate: "1700003600000",
          labelIds: ["INBOX", "UNREAD"],
          payload: {
            headers: [
              { name: "From", value: "Bob <bob@test.com>" },
              { name: "Subject", value: "Re: Meeting Tomorrow" },
            ],
            mimeType: "text/plain",
            body: { data: Buffer.from("Sure").toString("base64url") },
          },
        },
      ],
    }

    const result = GmailMapping.threadToSummary(thread, "acc-1")

    expect(result.id).toBe("thread-123")
    expect(result.accountId).toBe("acc-1")
    expect(result.subject).toBe("Meeting Tomorrow")
    expect(result.snippet).toBe("Hey, let's meet tomorrow")
    expect(result.messageCount).toBe(2)
    expect(result.participants).toHaveLength(2)
    expect(result.participants.map((p) => p.email).sort()).toEqual(["alice@test.com", "bob@test.com"])
    expect(result.unread).toBe(true)
    expect(result.starred).toBe(false)
    expect(result.folders).toContain("folder:INBOX")
    expect(result.time).toEqual(new Date(1700003600000))
  })

  test("detects starred threads", () => {
    const thread: gmail_v1.Schema$Thread = {
      id: "t-1",
      snippet: "",
      messages: [{
        id: "m-1",
        threadId: "t-1",
        internalDate: "1700000000000",
        labelIds: ["INBOX", "STARRED"],
        payload: {
          headers: [{ name: "Subject", value: "Important" }],
          mimeType: "text/plain",
          body: { data: Buffer.from("").toString("base64url") },
        },
      }],
    }

    const result = GmailMapping.threadToSummary(thread, "acc-1")
    expect(result.starred).toBe(true)
  })

  test("handles thread with no messages", () => {
    const thread: gmail_v1.Schema$Thread = {
      id: "t-empty",
      snippet: "",
      messages: [],
    }

    const result = GmailMapping.threadToSummary(thread, "acc-1")
    expect(result.subject).toBe("(no subject)")
    expect(result.messageCount).toBe(0)
    expect(result.participants).toEqual([])
  })
})

describe("GmailMapping — messageToDetail", () => {
  test("maps a Gmail message to MessageDetail", () => {
    const message: gmail_v1.Schema$Message = {
      id: "msg-1",
      threadId: "thread-1",
      internalDate: "1700000000000",
      labelIds: ["INBOX", "UNREAD"],
      payload: {
        headers: [
          { name: "From", value: "Alice Smith <alice@test.com>" },
          { name: "To", value: "Bob <bob@test.com>, Carol <carol@test.com>" },
          { name: "Cc", value: "Dave <dave@test.com>" },
          { name: "Subject", value: "Quarterly Review" },
          { name: "Message-ID", value: "<msg-123@test.com>" },
          { name: "In-Reply-To", value: "<msg-122@test.com>" },
        ],
        mimeType: "multipart/alternative",
        parts: [
          {
            mimeType: "text/plain",
            body: { data: Buffer.from("Please review the Q3 numbers.").toString("base64url") },
          },
          {
            mimeType: "text/html",
            body: { data: Buffer.from("<p>Please review the Q3 numbers.</p>").toString("base64url") },
          },
        ],
      },
    }

    const result = GmailMapping.messageToDetail(message, "acc-1")

    expect(result.id).toBe("msg-1")
    expect(result.threadId).toBe("thread-1")
    expect(result.from.name).toBe("Alice Smith")
    expect(result.from.email).toBe("alice@test.com")
    expect(result.to).toHaveLength(2)
    expect(result.to[0].email).toBe("bob@test.com")
    expect(result.to[1].email).toBe("carol@test.com")
    expect(result.cc).toHaveLength(1)
    expect(result.cc[0].email).toBe("dave@test.com")
    expect(result.subject).toBe("Quarterly Review")
    expect(result.body.text).toBe("Please review the Q3 numbers.")
    expect(result.body.html).toBe("<p>Please review the Q3 numbers.</p>")
    expect(result.unread).toBe(true)
    expect(result.messageIdHeader).toBe("<msg-123@test.com>")
    expect(result.inReplyTo).toBe("<msg-122@test.com>")
    expect(result.time).toEqual(new Date(1700000000000))
  })

  test("handles message marked as read", () => {
    const message: gmail_v1.Schema$Message = {
      id: "msg-1",
      threadId: "t-1",
      internalDate: "1700000000000",
      labelIds: ["INBOX"], // no UNREAD
      payload: {
        headers: [{ name: "Subject", value: "Read message" }],
        mimeType: "text/plain",
        body: { data: Buffer.from("Body").toString("base64url") },
      },
    }

    const result = GmailMapping.messageToDetail(message, "acc-1")
    expect(result.unread).toBe(false)
  })
})

describe("GmailMapping — labelsToFoldersAndLabels", () => {
  test("separates system labels into folders and user labels", () => {
    const labels: gmail_v1.Schema$Label[] = [
      { id: "INBOX", name: "INBOX", type: "system", messagesUnread: 5 },
      { id: "SENT", name: "SENT", type: "system", messagesUnread: 0 },
      { id: "TRASH", name: "TRASH", type: "system", messagesUnread: 0 },
      { id: "SPAM", name: "SPAM", type: "system", messagesUnread: 2 },
      { id: "UNREAD", name: "UNREAD", type: "system" },
      { id: "STARRED", name: "STARRED", type: "system" },
      { id: "Label_1", name: "Work", type: "user", color: { backgroundColor: "#5c9cf5" } },
      { id: "Label_2", name: "Personal", type: "user" },
    ]

    const result = GmailMapping.labelsToFoldersAndLabels(labels, "acc-1")

    // System labels → folders (excluding UNREAD, STARRED which are hidden)
    expect(result.folders.length).toBeGreaterThanOrEqual(4)
    expect(result.folders.find((f) => f.type === "inbox")).toBeDefined()
    expect(result.folders.find((f) => f.type === "sent")).toBeDefined()
    expect(result.folders.find((f) => f.type === "trash")).toBeDefined()
    expect(result.folders.find((f) => f.type === "spam")).toBeDefined()

    // Inbox should have unread count
    const inbox = result.folders.find((f) => f.type === "inbox")!
    expect(inbox.unreadCount).toBe(5)

    // Folders should be sorted: inbox first
    expect(result.folders[0].type).toBe("inbox")

    // User labels
    expect(result.labels).toHaveLength(2)
    expect(result.labels.find((l) => l.name === "Work")).toBeDefined()
    expect(result.labels.find((l) => l.name === "Personal")).toBeDefined()
  })

  test("formats folder names from UPPERCASE to Title Case", () => {
    const labels: gmail_v1.Schema$Label[] = [
      { id: "INBOX", name: "INBOX", type: "system" },
    ]

    const result = GmailMapping.labelsToFoldersAndLabels(labels, "acc-1")
    expect(result.folders[0].name).toBe("Inbox")
  })

  test("hides system labels like UNREAD, STARRED, IMPORTANT", () => {
    const labels: gmail_v1.Schema$Label[] = [
      { id: "UNREAD", name: "UNREAD", type: "system" },
      { id: "STARRED", name: "STARRED", type: "system" },
      { id: "IMPORTANT", name: "IMPORTANT", type: "system" },
      { id: "DRAFT", name: "DRAFT", type: "system" },
      { id: "CHAT", name: "CHAT", type: "system" },
    ]

    const result = GmailMapping.labelsToFoldersAndLabels(labels, "acc-1")
    expect(result.folders).toHaveLength(0) // All hidden
    expect(result.labels).toHaveLength(0)
  })
})

describe("GmailMapping — ID conversion", () => {
  test("gmailLabelIdToFolderId for system labels", () => {
    expect(GmailMapping.gmailLabelIdToFolderId("INBOX")).toBe("folder:INBOX")
    expect(GmailMapping.gmailLabelIdToFolderId("SENT")).toBe("folder:SENT")
    expect(GmailMapping.gmailLabelIdToFolderId("TRASH")).toBe("folder:TRASH")
  })

  test("gmailLabelIdToFolderId for user labels", () => {
    expect(GmailMapping.gmailLabelIdToFolderId("Label_1")).toBe("label:Label_1")
  })

  test("folderIdToGmailLabelId strips prefix", () => {
    expect(GmailMapping.folderIdToGmailLabelId("folder:INBOX")).toBe("INBOX")
    expect(GmailMapping.folderIdToGmailLabelId("label:Label_1")).toBe("Label_1")
  })

  test("roundtrip conversion", () => {
    const original = "INBOX"
    const folderId = GmailMapping.gmailLabelIdToFolderId(original)
    const back = GmailMapping.folderIdToGmailLabelId(folderId)
    expect(back).toBe(original)
  })
})

// --- GmailApi — buildRawMessage ---

describe("GmailApi — buildRawMessage", () => {
  test("builds basic text message", () => {
    const raw = GmailApi.buildRawMessage({
      from: { name: "Alice", email: "alice@test.com" },
      to: [{ name: "Bob", email: "bob@test.com" }],
      subject: "Test Subject",
      body: { text: "Hello World" },
    })

    expect(raw).toContain('From: "Alice" <alice@test.com>')
    expect(raw).toContain('To: "Bob" <bob@test.com>')
    expect(raw).toContain("Subject: Test Subject")
    expect(raw).toContain("Content-Type: text/plain; charset=UTF-8")
    expect(raw).toContain("Hello World")
  })

  test("builds multipart message with HTML", () => {
    const raw = GmailApi.buildRawMessage({
      from: { name: "Alice", email: "alice@test.com" },
      to: [{ name: "Bob", email: "bob@test.com" }],
      subject: "HTML Test",
      body: { text: "Plain text", html: "<p>HTML body</p>" },
    })

    expect(raw).toContain("multipart/alternative")
    expect(raw).toContain("Plain text")
    expect(raw).toContain("<p>HTML body</p>")
    expect(raw).toContain("Content-Type: text/plain; charset=UTF-8")
    expect(raw).toContain("Content-Type: text/html; charset=UTF-8")
  })

  test("includes CC and BCC", () => {
    const raw = GmailApi.buildRawMessage({
      from: { name: "Alice", email: "alice@test.com" },
      to: [{ name: "Bob", email: "bob@test.com" }],
      cc: [{ name: "Carol", email: "carol@test.com" }],
      bcc: [{ name: "Dave", email: "dave@test.com" }],
      subject: "CC Test",
      body: { text: "Body" },
    })

    expect(raw).toContain('Cc: "Carol" <carol@test.com>')
    expect(raw).toContain('Bcc: "Dave" <dave@test.com>')
  })

  test("includes In-Reply-To header", () => {
    const raw = GmailApi.buildRawMessage({
      from: { name: "Alice", email: "alice@test.com" },
      to: [{ name: "Bob", email: "bob@test.com" }],
      subject: "Re: Original",
      body: { text: "Reply body" },
      inReplyTo: "<original-msg-id@test.com>",
    })

    expect(raw).toContain("In-Reply-To: <original-msg-id@test.com>")
  })

  test("includes MIME-Version header", () => {
    const raw = GmailApi.buildRawMessage({
      from: { name: "Alice", email: "alice@test.com" },
      to: [{ name: "Bob", email: "bob@test.com" }],
      subject: "Test",
      body: { text: "Body" },
    })

    expect(raw).toContain("MIME-Version: 1.0")
  })

  test("handles multiple recipients", () => {
    const raw = GmailApi.buildRawMessage({
      from: { name: "Alice", email: "alice@test.com" },
      to: [
        { name: "Bob", email: "bob@test.com" },
        { name: "Carol", email: "carol@test.com" },
      ],
      subject: "Group",
      body: { text: "Hey all" },
    })

    expect(raw).toContain('"Bob" <bob@test.com>, "Carol" <carol@test.com>')
  })
})

// --- GmailProvider — Plugin info ---

describe("GmailProvider — Plugin creation", () => {
  test("create returns a Plugin with correct info", () => {
    const provider = GmailProvider.create("test-account", {
      clientId: "test-id",
      clientSecret: "test-secret",
    })

    expect(provider.info.id).toBe("gmail")
    expect(provider.info.name).toBe("Gmail")
    expect(provider.info.capabilities).toContain("threads")
    expect(provider.info.capabilities).toContain("labels")
    expect(provider.info.capabilities).toContain("search")
    expect(provider.info.capabilities).toContain("incremental-sync")
    expect(provider.info.capabilities).toContain("drafts")
  })

  test("searchSyntaxHint returns Gmail syntax help", () => {
    const provider = GmailProvider.create("test-account", {
      clientId: "test-id",
      clientSecret: "test-secret",
    })

    const hint = provider.searchSyntaxHint()
    expect(hint).toContain("from:")
    expect(hint).toContain("subject:")
    expect(hint).toContain("has:attachment")
  })
})
