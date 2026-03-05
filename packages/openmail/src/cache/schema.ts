import { sqliteTable, text, integer, real, primaryKey } from "drizzle-orm/sqlite-core"

// Account — linked email accounts (Gmail, Outlook, IMAP, etc.)
export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  providerId: text("provider_id").notNull(), // "gmail", "outlook", "imap"
  email: text("email").notNull(),
  name: text("name").notNull(),
  credentials: text("credentials").notNull(), // encrypted JSON (access_token, refresh_token, etc.)
  syncCursor: text("sync_cursor"), // provider-specific sync cursor (Gmail historyId, etc.)
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
})

// Thread — email conversation thread
export const thread = sqliteTable("thread", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => account.id),
  providerThreadId: text("provider_thread_id").notNull(), // original ID from provider
  subject: text("subject").notNull(),
  snippet: text("snippet").notNull(),
  participants: text("participants", { mode: "json" }).notNull(), // JSON array of {name, email}
  messageCount: integer("message_count").notNull().default(1),
  hasAttachments: integer("has_attachments", { mode: "boolean" }).notNull().default(false),
  unread: integer("unread", { mode: "boolean" }).notNull().default(true),
  starred: integer("starred", { mode: "boolean" }).notNull().default(false),
  lastMessageTime: integer("last_message_time", { mode: "timestamp" }).notNull(),
  historyId: text("history_id"), // Gmail-specific, for incremental sync
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
})

// Message — individual email message within a thread
export const message = sqliteTable("message", {
  id: text("id").primaryKey(),
  threadId: text("thread_id").notNull().references(() => thread.id),
  accountId: text("account_id").notNull().references(() => account.id),
  providerMessageId: text("provider_message_id").notNull(), // original ID from provider
  fromName: text("from_name").notNull(),
  fromEmail: text("from_email").notNull(),
  toRecipients: text("to_recipients", { mode: "json" }).notNull(), // JSON array of {name, email}
  ccRecipients: text("cc_recipients", { mode: "json" }).notNull(), // JSON array of {name, email}
  bccRecipients: text("bcc_recipients", { mode: "json" }).notNull(), // JSON array of {name, email}
  replyTo: text("reply_to", { mode: "json" }), // {name, email} or null
  subject: text("subject").notNull(),
  bodyText: text("body_text").notNull(),
  bodyHtml: text("body_html"),
  attachments: text("attachments", { mode: "json" }).notNull(), // JSON array of {id, filename, mimeType, size}
  time: integer("time", { mode: "timestamp" }).notNull(),
  unread: integer("unread", { mode: "boolean" }).notNull().default(true),
  messageIdHeader: text("message_id_header"), // Message-ID header for threading/reply
  inReplyTo: text("in_reply_to"), // In-Reply-To header
  rawHeaders: text("raw_headers", { mode: "json" }), // preserved headers as JSON
})

// Folder — mailbox folders (Inbox, Sent, Drafts, etc.)
export const folder = sqliteTable("folder", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => account.id),
  providerFolderId: text("provider_folder_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(), // "inbox" | "sent" | "drafts" | "trash" | "spam" | "archive" | "custom"
  unreadCount: integer("unread_count").notNull().default(0),
})

// Label — user-created labels (Gmail labels, etc.)
export const label = sqliteTable("label", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => account.id),
  providerLabelId: text("provider_label_id").notNull(),
  name: text("name").notNull(),
  color: text("color"),
})

// Thread ↔ Folder join table
export const threadFolder = sqliteTable("thread_folder", {
  threadId: text("thread_id").notNull().references(() => thread.id),
  folderId: text("folder_id").notNull().references(() => folder.id),
}, (table) => [
  primaryKey({ columns: [table.threadId, table.folderId] }),
])

// Thread ↔ Label join table
export const threadLabel = sqliteTable("thread_label", {
  threadId: text("thread_id").notNull().references(() => thread.id),
  labelId: text("label_id").notNull().references(() => label.id),
}, (table) => [
  primaryKey({ columns: [table.threadId, table.labelId] }),
])

// Calendar — synced calendars
export const calendar = sqliteTable("calendar", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => account.id),
  providerCalendarId: text("provider_calendar_id").notNull(),
  name: text("name").notNull(),
  color: text("color"),
  source: text("source").notNull(), // "google" | "caldav" | "ics"
  writable: integer("writable", { mode: "boolean" }).notNull().default(false),
})

// Calendar Event
export const calEvent = sqliteTable("cal_event", {
  id: text("id").primaryKey(),
  calendarId: text("calendar_id").notNull().references(() => calendar.id),
  accountId: text("account_id").notNull().references(() => account.id),
  uid: text("uid").notNull(), // iCalendar UID for dedup
  summary: text("summary").notNull(),
  description: text("description"),
  location: text("location"),
  startTime: integer("start_time", { mode: "timestamp" }).notNull(),
  endTime: integer("end_time", { mode: "timestamp" }).notNull(),
  allDay: integer("all_day", { mode: "boolean" }).notNull().default(false),
  organizer: text("organizer", { mode: "json" }).notNull(), // {name, email}
  attendees: text("attendees", { mode: "json" }).notNull(), // JSON array of CalAttendee
  myStatus: text("my_status"), // "accepted" | "tentative" | "declined" | "needs-action" | null
  recurrence: text("recurrence"),
  conferenceUrl: text("conference_url"),
  source: text("source").notNull(), // "api" | "ics"
})

// Event ↔ Thread link table
export const eventThread = sqliteTable("event_thread", {
  eventId: text("event_id").notNull().references(() => calEvent.id),
  threadId: text("thread_id").notNull().references(() => thread.id),
}, (table) => [
  primaryKey({ columns: [table.eventId, table.threadId] }),
])

// Contact — for autocomplete ranking
export const contact = sqliteTable("contact", {
  email: text("email").primaryKey(),
  name: text("name").notNull(),
  accountId: text("account_id").notNull().references(() => account.id),
  frequency: integer("frequency").notNull().default(1),
  lastSeen: integer("last_seen", { mode: "timestamp" }).notNull(),
})

// Sync state — tracks sync progress per account
export const syncState = sqliteTable("sync_state", {
  accountId: text("account_id").primaryKey().references(() => account.id),
  cursor: text("cursor"), // provider-specific sync cursor
  lastSync: integer("last_sync", { mode: "timestamp" }),
  status: text("status").notNull().default("idle"), // "idle" | "syncing" | "error"
  error: text("error"),
})
