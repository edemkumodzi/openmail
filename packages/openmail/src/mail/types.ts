export namespace Mail {
  export interface Participant {
    name: string
    email: string
  }

  export interface ThreadSummary {
    id: string
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
    subject: string
    body: { text: string; html?: string }
    attachments: Attachment[]
    calendarEvent?: CalEvent
    time: Date
    unread: boolean
  }

  export interface Attachment {
    id: string
    filename: string
    mimeType: string
    size: number
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

  export interface CalEvent {
    id: string
    summary: string
    description?: string
    location?: string
    start: Date
    end: Date
    allDay: boolean
    organizer: Participant
    attendees: CalAttendee[]
    myStatus: "accepted" | "tentative" | "declined" | "needs-action" | null
    conferenceUrl?: string
    linkedThreadIds: string[]
  }

  export interface CalAttendee {
    participant: Participant
    status: "accepted" | "tentative" | "declined" | "needs-action"
    role: "required" | "optional"
  }
}
