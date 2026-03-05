export namespace Mail {
  export interface ExtractedLink {
    label: string
    url: string
  }

  export interface Participant {
    name: string
    email: string
  }

  export interface ThreadSummary {
    id: string
    accountId?: string
    subject: string
    snippet: string
    participants: Participant[]
    messageCount: number
    hasAttachments: boolean
    folders: string[]
    labels: string[]
    unread: boolean
    starred: boolean
    time: Date
    linkedEventIds: string[]
  }

  export interface ThreadDetail extends ThreadSummary {
    messages: MessageDetail[]
  }

  export interface MessageDetail {
    id: string
    threadId: string
    from: Participant
    to: Participant[]
    cc: Participant[]
    bcc?: Participant[]
    replyTo?: Participant | null
    subject: string
    body: { text: string; html?: string; links?: ExtractedLink[] }
    attachments: Attachment[]
    calendarEvent?: CalEvent
    time: Date
    unread: boolean
    messageIdHeader?: string
    inReplyTo?: string
  }

  export interface Attachment {
    id: string
    filename: string
    mimeType: string
    size: number
  }

  export interface OutgoingAttachment {
    filename: string
    mimeType: string
    content: Uint8Array
  }

  export interface OutgoingMessage {
    to: Participant[]
    cc?: Participant[]
    bcc?: Participant[]
    subject: string
    body: { text: string; html?: string }
    attachments?: OutgoingAttachment[]
    inReplyTo?: string // Message-ID header for threading
  }

  export interface Draft {
    id: string
    message: OutgoingMessage
    threadId?: string
    updatedAt: Date
  }

  export interface Folder {
    id: string
    name: string
    type: "inbox" | "sent" | "drafts" | "trash" | "spam" | "archive" | "custom"
    unreadCount: number
  }

  export interface Label {
    id: string
    name: string
    color: string
  }

  export interface Calendar {
    id: string
    accountId: string
    name: string
    color?: string
    source: "google" | "caldav" | "ics"
    writable: boolean
  }

  export interface CalEvent {
    id: string
    calendarId?: string
    accountId?: string
    uid?: string
    summary: string
    description?: string
    location?: string
    start: Date
    end: Date
    allDay: boolean
    organizer: Participant
    attendees: CalAttendee[]
    myStatus: "accepted" | "tentative" | "declined" | "needs-action" | null
    recurrence?: string
    conferenceUrl?: string
    source?: "api" | "ics"
    linkedThreadIds: string[]
  }

  export interface CalAttendee {
    participant: Participant
    status: "accepted" | "tentative" | "declined" | "needs-action"
    role: "required" | "optional"
  }

  // Pagination helper
  export interface Paginated<T> {
    items: T[]
    nextCursor?: string
    hasMore: boolean
  }

  // Auth result from provider
  export interface AuthResult {
    accountId: string
    email: string
    name: string
    accessToken: string
    refreshToken?: string
    expiresAt?: Date
  }

  // Sync result from provider
  export interface SyncResult {
    newCursor: string
    threads: ThreadSummary[]
    deletedThreadIds: string[]
    hasMore: boolean
  }

  // Push event from provider
  export interface PushEvent {
    type: "new_message" | "thread_updated" | "thread_deleted"
    threadId: string
    messageId?: string
  }

  // Push subscription handle
  export interface PushSubscription {
    unsubscribe(): Promise<void>
  }

  // Date range for calendar queries
  export interface DateRange {
    start: Date
    end: Date
  }
}
