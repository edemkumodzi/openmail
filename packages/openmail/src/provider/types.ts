import { Mail } from "../mail/types.js"

/**
 * Mail provider plugin system.
 *
 * Every provider must implement MailProvider.Plugin.
 * Providers can optionally implement capability extensions
 * (Searchable, Labelable, Pushable, IncrementallySyncable, Draftable).
 *
 * The server checks provider.info.capabilities before calling extension methods.
 */
export namespace MailProvider {
  export type Capability =
    | "threads"           // Native thread/conversation support
    | "labels"            // Multi-label (vs single folder)
    | "search"            // Server-side search
    | "push"              // Real-time push notifications
    | "incremental-sync"  // Efficient delta sync
    | "drafts"            // Server-side draft storage
    | "calendar"          // Calendar API access

  export interface Info {
    id: string            // "gmail", "outlook", "imap"
    name: string          // "Gmail", "Microsoft Outlook"
    capabilities: Capability[]
  }

  export interface ListOptions {
    folderId?: string
    labelId?: string
    cursor?: string
    limit?: number
  }

  export interface SearchOptions {
    cursor?: string
    limit?: number
  }

  /**
   * Core interface — every provider must implement this.
   */
  export interface Plugin {
    info: Info

    // Lifecycle
    auth(): Promise<Mail.AuthResult>
    disconnect(): Promise<void>

    // Read
    list(opts: ListOptions): Promise<Mail.Paginated<Mail.ThreadSummary>>
    getThread(id: string): Promise<Mail.ThreadDetail>
    getMessage(id: string): Promise<Mail.MessageDetail>

    // Write
    send(msg: Mail.OutgoingMessage): Promise<{ id: string }>
    reply(threadId: string, msg: Mail.OutgoingMessage): Promise<{ id: string }>

    // Organize
    archive(threadId: string): Promise<void>
    trash(threadId: string): Promise<void>
    markRead(ids: string[]): Promise<void>
    markUnread(ids: string[]): Promise<void>
    star(threadId: string): Promise<void>
    unstar(threadId: string): Promise<void>

    // Folders
    listFolders(): Promise<Mail.Folder[]>
    moveToFolder(threadId: string, folderId: string): Promise<void>
  }

  /**
   * Server-side search capability.
   */
  export interface Searchable {
    search(query: string, opts?: SearchOptions): Promise<Mail.Paginated<Mail.ThreadSummary>>
    searchSyntaxHint(): string
  }

  /**
   * Multi-label support (Gmail, Fastmail).
   */
  export interface Labelable {
    listLabels(): Promise<Mail.Label[]>
    createLabel(name: string, color?: string): Promise<Mail.Label>
    deleteLabel(id: string): Promise<void>
    addLabel(threadId: string, labelId: string): Promise<void>
    removeLabel(threadId: string, labelId: string): Promise<void>
  }

  /**
   * Push notifications (real-time updates).
   */
  export interface Pushable {
    subscribePush(callback: (event: Mail.PushEvent) => void): Promise<Mail.PushSubscription>
  }

  /**
   * Efficient incremental sync (Gmail historyId, Outlook deltaLink).
   */
  export interface IncrementallySyncable {
    sync(cursor: string | null): Promise<Mail.SyncResult>
  }

  /**
   * Server-side draft storage.
   */
  export interface Draftable {
    listDrafts(): Promise<Mail.Draft[]>
    saveDraft(msg: Mail.OutgoingMessage, threadId?: string): Promise<{ id: string }>
    updateDraft(id: string, msg: Mail.OutgoingMessage): Promise<void>
    deleteDraft(id: string): Promise<void>
    sendDraft(id: string): Promise<{ id: string }>
  }
}

/**
 * Calendar provider extension.
 * Providers that support "calendar" capability implement this.
 */
export namespace CalendarProvider {
  export interface Plugin {
    listCalendars(): Promise<Mail.Calendar[]>
    listEvents(calendarId: string, range: Mail.DateRange): Promise<Mail.CalEvent[]>
    getEvent(calendarId: string, eventId: string): Promise<Mail.CalEvent>
    createEvent(calendarId: string, event: NewEvent): Promise<Mail.CalEvent>
    updateEvent(calendarId: string, eventId: string, updates: Partial<NewEvent>): Promise<Mail.CalEvent>
    deleteEvent(calendarId: string, eventId: string): Promise<void>
    respondToInvite(eventId: string, response: "accepted" | "tentative" | "declined"): Promise<void>
  }

  export interface NewEvent {
    summary: string
    description?: string
    location?: string
    start: Date
    end: Date
    allDay: boolean
    attendees?: Mail.Participant[]
    conferenceUrl?: string
  }
}
