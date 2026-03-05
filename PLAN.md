# OpenMail — Project Plan

The open-source TUI email client with integrated calendar.

Built with the same architectural patterns as [OpenCode](https://github.com/anomalyco/opencode): local HTTP server, SolidJS terminal UI, SQLite cache, provider plugin system.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Provider Plugin System](#provider-plugin-system)
4. [Data Models](#data-models)
5. [Calendar Integration](#calendar-integration)
6. [Email Rendering Pipeline](#email-rendering-pipeline)
7. [TUI Layout & Interaction](#tui-layout--interaction)
8. [Project Structure](#project-structure)
9. [Tech Stack](#tech-stack)
10. [Implementation Phases](#implementation-phases)
11. [Configuration](#configuration)
12. [Open Questions & Future Work](#open-questions--future-work)

---

## Overview

OpenMail is a TUI email client that:

- Runs a local HTTP server (Hono + Bun) that syncs with email providers
- Caches everything in SQLite for instant startup and offline reading
- Renders an interactive terminal UI via SolidJS + OpenTUI
- Supports multiple email providers through a plugin interface (starting with Gmail)
- Integrates calendar as a contextual sidebar alongside email
- Communicates between server and TUI via a typed SDK (auto-generated from OpenAPI)

### Key Differentiators from Existing TUI Email Clients

| Area | Existing Clients (mutt, aerc, etc.) | OpenMail |
|------|-------------------------------------|----------|
| Auth | Manual OAuth2 / app passwords | Browser-redirect OAuth — one click |
| Protocol | IMAP everywhere | Provider plugins: Gmail API first, IMAP as fallback |
| Sync | IMAP FETCH (blocking, slow) | Incremental sync (Gmail historyId) + push |
| Search | Requires notmuch toolchain | Built-in SQLite full-text index |
| Calendar | None | Contextual sidebar + full calendar view |
| Setup | Edit config files manually | Interactive first-run wizard |
| Architecture | Direct protocol connection | Client-server (enables future web/desktop/mobile frontends) |
| HTML email | Shell out to w3m/lynx | Built-in HTML-to-terminal renderer |
| Multi-account | Per-account views | Unified inbox with provider indicators |
| Extensibility | Lua hooks or nothing | Plugin-based providers |

---

## Architecture

```
┌──────────────────────────────────────────────┐
│  TUI (SolidJS + OpenTUI)                     │
│  Three-panel layout: folders / email / cal   │
│  Renders from local SQLite cache             │
│  Subscribes to SSE for real-time updates     │
└──────────────────┬───────────────────────────┘
                   │ HTTP REST + SSE (via typed SDK)
┌──────────────────▼───────────────────────────┐
│  Local Server (Hono + Bun.serve)             │
│  REST API + SSE event stream                 │
│  Provider plugin system                      │
│  SQLite cache (Drizzle ORM)                  │
│  OAuth token management                      │
│  Background sync coordinator                 │
└──────────────────┬───────────────────────────┘
                   │ Provider Plugin Interface
┌──────────────────▼───────────────────────────┐
│  Provider Plugins                            │
│  ┌─────────────┐  ┌───────────────────────┐  │
│  │ Gmail       │  │ Outlook (future)      │  │
│  │ Gmail API   │  │ Graph API             │  │
│  │ + Calendar  │  │ + Calendar            │  │
│  └─────────────┘  └───────────────────────┘  │
│  ┌─────────────┐  ┌───────────────────────┐  │
│  │ IMAP/SMTP   │  │ Fastmail/JMAP         │  │
│  │ (future)    │  │ (future)              │  │
│  └─────────────┘  └───────────────────────┘  │
└──────────────────────────────────────────────┘
```

### Why Client-Server?

Borrowing from OpenCode's architecture, the TUI does not talk to Gmail directly. A local HTTP server handles all provider communication, caching, and sync. This gives us:

1. **Background sync** — continues even when the TUI is closed and restarted
2. **Future frontends** — a web or desktop app is just another client connecting to the same server
3. **SDK-driven development** — the API is auto-generated from OpenAPI, so any client gets typed access for free
4. **Offline capability** — the TUI reads from SQLite cache; the server syncs in the background

### Event Flow

```
Provider (Gmail) ──push/poll──▶ Server ──SSE──▶ TUI
                                  │
                                  ▼
                              SQLite cache
                                  │
                                  ▼
                            Event bus (Zod-typed)
                                  │
                         ┌────────┴────────┐
                         ▼                 ▼
                    SSE endpoint      Internal subscribers
                    (GET /event)      (sync, notifications)
```

---

## Provider Plugin System

### Design Principle

Email providers vary significantly. Gmail has labels + native threading + push + rich search. IMAP has single folders + manual threading + limited search. Rather than lowest-common-denominator, we define a **minimal required interface** with **optional capability extensions**.

The core server never imports a provider directly. Providers register through the registry, and the server interacts only through interfaces. This is the same pattern OpenCode uses with LLM providers.

### Core Interface (Required)

Every provider must implement this:

```typescript
export namespace MailProvider {
  export interface Info {
    id: string                          // "gmail", "outlook", "imap"
    name: string                        // "Gmail", "Microsoft Outlook"
    capabilities: Capability[]
  }

  export type Capability =
    | "threads"             // Native thread/conversation support
    | "labels"              // Multi-label (vs single folder)
    | "search"              // Server-side search
    | "push"                // Real-time push notifications
    | "incremental-sync"    // Efficient delta sync
    | "drafts"              // Server-side draft storage
    | "calendar"            // Calendar API access

  export interface Plugin {
    info: Info

    // Lifecycle
    auth(): Promise<AuthResult>
    disconnect(): Promise<void>

    // Read
    list(opts: ListOptions): Promise<Paginated<Mail.ThreadSummary>>
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

    // Folders (every provider has at least folders)
    listFolders(): Promise<Mail.Folder[]>
    moveToFolder(threadId: string, folderId: string): Promise<void>
  }
}
```

### Capability Extensions (Optional)

Providers opt into these. The server checks `provider.info.capabilities` before calling:

```typescript
export namespace MailProvider {
  // Server-side search
  export interface Searchable {
    search(query: string, opts?: SearchOptions): Promise<Paginated<Mail.ThreadSummary>>
    searchSyntaxHint(): string
  }

  // Multi-label support (Gmail, Fastmail)
  export interface Labelable {
    listLabels(): Promise<Mail.Label[]>
    createLabel(name: string, color?: string): Promise<Mail.Label>
    deleteLabel(id: string): Promise<void>
    addLabel(threadId: string, labelId: string): Promise<void>
    removeLabel(threadId: string, labelId: string): Promise<void>
  }

  // Push notifications
  export interface Pushable {
    subscribePush(callback: (event: PushEvent) => void): Promise<Subscription>
    unsubscribePush(subscription: Subscription): Promise<void>
  }

  // Efficient incremental sync
  export interface IncrementallySyncable {
    sync(cursor: string | null): Promise<SyncResult>
  }

  // Server-side drafts
  export interface Draftable {
    listDrafts(): Promise<Mail.Draft[]>
    saveDraft(msg: Mail.OutgoingMessage): Promise<{ id: string }>
    updateDraft(id: string, msg: Mail.OutgoingMessage): Promise<void>
    deleteDraft(id: string): Promise<void>
    sendDraft(id: string): Promise<{ id: string }>
  }
}
```

### Calendar Provider Extension

```typescript
export namespace CalendarProvider {
  export interface Plugin {
    listCalendars(): Promise<Mail.Calendar[]>
    listEvents(calendarId: string, range: DateRange): Promise<Mail.CalEvent[]>
    getEvent(calendarId: string, eventId: string): Promise<Mail.CalEvent>
    createEvent(calendarId: string, event: NewEvent): Promise<Mail.CalEvent>
    updateEvent(calendarId: string, eventId: string, updates: Partial<NewEvent>): Promise<Mail.CalEvent>
    deleteEvent(calendarId: string, eventId: string): Promise<void>
    respondToInvite(eventId: string, response: "accepted" | "tentative" | "declined"): Promise<void>
  }
}
```

### Provider Registry

```typescript
export namespace ProviderRegistry {
  function register(provider: MailProvider.Plugin): void
  function get(id: string): MailProvider.Plugin
  function list(): MailProvider.Info[]

  // Type-safe capability narrowing
  function asSearchable(p: MailProvider.Plugin): MailProvider.Searchable | null
  function asLabelable(p: MailProvider.Plugin): MailProvider.Labelable | null
  function asPushable(p: MailProvider.Plugin): MailProvider.Pushable | null
  function asIncrementallySyncable(p: MailProvider.Plugin): MailProvider.IncrementallySyncable | null
  function asDraftable(p: MailProvider.Plugin): MailProvider.Draftable | null
  function asCalendar(p: MailProvider.Plugin): CalendarProvider.Plugin | null
}
```

### Sync Strategy (Provider-Aware)

The sync coordinator adapts based on provider capabilities:

| Capability | Strategy | Fallback |
|-----------|----------|----------|
| `incremental-sync` | Delta sync via cursor (Gmail historyId, Outlook deltaLink) | Fetch recent messages, diff against cache |
| `push` | Subscribe to real-time notifications | Poll every 60 seconds |
| `search` | Pass query to provider's server-side search | Search local SQLite full-text index |
| `labels` | Show label management UI | Hide label UI, show folders only |
| `calendar` | Sync from calendar API | Parse ICS attachments from email only |

### Gmail Provider Implementation

The first provider. Implements the full interface + all extensions:

```typescript
export const GmailProvider: MailProvider.Plugin
  & MailProvider.Searchable
  & MailProvider.Labelable
  & MailProvider.Pushable
  & MailProvider.IncrementallySyncable
  & MailProvider.Draftable
  & CalendarProvider.Plugin = {

  info: {
    id: "gmail",
    name: "Gmail",
    capabilities: ["threads", "labels", "search", "push", "incremental-sync", "drafts", "calendar"],
  },
  // ... method implementations using Gmail REST API + Google Calendar API
}
```

---

## Data Models

### Canonical Types

All providers map their native types to these canonical models:

```typescript
export namespace Mail {
  export interface ThreadSummary {
    id: string
    providerId: string
    subject: string
    snippet: string
    participants: Participant[]
    messageCount: number
    hasAttachments: boolean
    folders: string[]
    labels: string[]               // empty if provider lacks labels
    unread: boolean
    starred: boolean
    time: Date                     // most recent message
    linkedEventIds: string[]       // calendar events related to this thread
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
    bcc: Participant[]
    replyTo: Participant | null
    subject: string
    body: { text: string; html?: string }
    attachments: Attachment[]
    calendarEvents: CalEvent[]     // parsed ICS attachments
    time: Date
    unread: boolean
  }

  export interface Participant {
    name: string
    email: string
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
    color?: string
  }

  export interface OutgoingMessage {
    to: Participant[]
    cc?: Participant[]
    bcc?: Participant[]
    subject: string
    body: { text: string; html?: string }
    attachments?: OutgoingAttachment[]
    inReplyTo?: string             // Message-ID header for threading
  }

  export interface Draft {
    id: string
    message: OutgoingMessage
    threadId?: string
    updatedAt: Date
  }
}
```

### Calendar Types

```typescript
export namespace Mail {
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
    calendarId: string
    accountId: string
    uid: string                    // iCalendar UID for dedup
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
    source: "api" | "ics"
    linkedThreadIds: string[]
  }

  export interface CalAttendee {
    participant: Participant
    status: "accepted" | "tentative" | "declined" | "needs-action"
    role: "required" | "optional"
  }
}
```

### SQLite Schema (Drizzle ORM)

```
Tables:
  account          — id, providerId, email, name, credentials (encrypted), syncCursor, active
  thread           — id, accountId, subject, snippet, historyId, labels (JSON), unread, starred, lastMessageTime
  message          — id, threadId, from, to, cc, subject, bodyText, bodyHtml, time, attachments (JSON)
  folder           — id, accountId, name, type, unreadCount
  label            — id, accountId, name, color
  thread_label     — threadId, labelId (join table)
  thread_folder    — threadId, folderId (join table)
  calendar         — id, accountId, name, color, source, writable
  cal_event        — id, calendarId, uid, summary, description, location, startTime, endTime, allDay, organizer, attendees, myStatus, recurrence, conferenceUrl, source
  event_thread     — eventId, threadId (link table for related emails)
  contact          — email, name, frequency (for autocomplete ranking)
  sync_state       — accountId, cursor, lastSync, status
```

---

## Calendar Integration

### Three Data Sources (Phased)

| Source | Phase | How It Works |
|--------|-------|-------------|
| ICS attachments in email | Phase 1 | Parse `text/calendar` MIME parts. Free — comes through email provider. |
| Google Calendar API | Phase 5 | Same OAuth project, expanded scopes. Full read/write calendar access. |
| CalDAV (RFC 4791) | Phase 6 | Universal standard. Works with iCloud, Fastmail, Nextcloud, etc. |

### ICS Parsing (Phase 1)

When a message contains a `text/calendar` attachment:

1. Detect MIME type `text/calendar` or `application/ics`
2. Parse with `ical.js` library
3. Extract event data into `Mail.CalEvent`
4. Render as an invite card in the message body
5. Responding (accept/decline) sends a reply email with `METHOD:REPLY` ICS

### Google Calendar API (Phase 5)

Same Google Cloud project and OAuth flow as Gmail. Additional scopes:

```
https://www.googleapis.com/auth/calendar.readonly
https://www.googleapis.com/auth/calendar.events
```

### Event-Email Linking

Events are linked to email threads by:

1. **Direct ICS match** — the invite email contains the same event UID
2. **Subject similarity** — fuzzy match between thread subject and event summary
3. **Participant overlap + time proximity** — same people, within 7 days of event

Links are stored in the `event_thread` join table and surfaced in both directions:
- Thread view → shows related events in the calendar sidebar
- Event detail → shows related email threads

---

## Email Rendering Pipeline

### The Problem

Modern email is ~80% HTML. Terminals don't render HTML. Existing TUI clients either shell out to w3m/lynx or strip HTML entirely.

### Three-Tier Strategy

**Tier 1: Plain text (preferred when available)**

Many emails include a `text/plain` MIME part. Use it directly when present and substantive (>20 chars). Handles developer emails, mailing lists, and simple messages perfectly.

**Tier 2: Built-in HTML-to-terminal conversion (primary renderer)**

For HTML-only emails, convert to terminal-renderable SolidJS components:

| HTML Element | Terminal Rendering |
|-------------|-------------------|
| `<h1>`–`<h6>` | Bold + color |
| `<strong>`, `<b>` | Bold |
| `<em>`, `<i>` | Italic (if terminal supports) |
| `<a href="...">` | Cyan text + footnote-style `[n]` link |
| `<ul>`, `<ol>`, `<li>` | Bullet/numbered lists with indentation |
| `<blockquote>` | Indented with `│` border, dimmed |
| `<code>` | Dim background |
| `<pre>` | Code block with border |
| `<hr>` | `─────────` divider |
| `<img>` | `[image: alt text]` placeholder (or inline via Kitty/iTerm2 protocol) |
| `<br>`, `<p>` | Newlines |
| `<table>` (data) | Aligned columns |
| `<table>` (layout) | Collapsed — extract content only |
| Button/CTA `<a>` | `[ Link Text ]` with footnote URL |

Layout table detection heuristic: if a `<table>` has no `<th>`, a single column, or nested tables, it's layout — collapse it.

Quoted reply detection: `>` prefixed lines (plain text) or `<blockquote>`/`class="gmail_quote"` (HTML) are collapsed with a `▶ N quoted lines hidden` toggle.

**Tier 3: External renderer (configurable)**

For users wanting full HTML fidelity:

```json
{
  "render": {
    "html": "w3m -dump -T text/html"
  }
}
```

Supports any command that reads HTML from stdin and writes text to stdout.

### Inline Images (Optional)

```json
{
  "render": {
    "images": "placeholder"    // default: [image: alt text]
    // "kitty"                 // Kitty graphics protocol
    // "iterm2"                // iTerm2 inline images
  }
}
```

### Rendering Pipeline

```
Email arrives
    │
    ▼
MIME decode (base64, charset handling)
    │
    ├── text/plain exists and substantive? ──▶ Use directly (wrap lines)
    │
    ├── text/html? ──▶ Sanitize
    │                     │
    │                     ▼
    │                  Strip layout tables
    │                     │
    │                     ▼
    │                  Convert to terminal parts (headings, bold, links, lists, etc.)
    │                     │
    │                     ▼
    │                  Render via SolidJS components
    │                     │
    │                     ▼
    │                  Footnote-style links at bottom
    │                     │
    │                     ▼
    │                  Collapse quoted replies
    │
    ├── text/calendar? ──▶ Parse ICS, render invite card
    │
    └── Other MIME? ──▶ Show attachment: 📎 filename (size)
```

---

## TUI Layout & Interaction

### Three-Panel Layout

```
┌──────────────────────────────────────────────────────────────────┐
│                           Header                                 │
├───────────┬──────────────────────────────────┬───────────────────┤
│           │                                  │                   │
│  Folders  │         Email Panel              │ Calendar Sidebar  │
│  Labels   │  (inbox / thread / compose /     │ (agenda view,     │
│           │   search)                        │  contextual)      │
│           │                                  │                   │
├───────────┴──────────────────────────────────┴───────────────────┤
│                         Keybind Bar                              │
└──────────────────────────────────────────────────────────────────┘

Widths: ~15%            ~55-60%                    ~25-30%
```

- **Left sidebar**: Folders with unread counts, labels (if provider supports), account switcher
- **Center panel**: The active view (inbox thread list, thread conversation, compose, search results)
- **Right sidebar**: Calendar agenda for the next few days. Contextual — highlights events related to the current thread. Toggleable with `Ctrl+b`.
- **Header**: App name, active account, unread count, sync status
- **Keybind bar**: Context-sensitive hints for the current view

### Inbox View

```
┌──────────────┬──────────────────────────────────────────────┬────────────────────────┐
│              │                                              │                        │
│  ■ Inbox (3) │  ★  Sarah Chen       Quarterly planning do… │  ── Today, Mar 4 ──   │
│    Starred   │     Review the attached planning document…   │                        │
│    Sent      │  ─────────────────────────────────────────── │  ● 2:00  Quarterly    │
│    Drafts (1)│  ●  Dave Kumar       Re: API rate limiting…  │          Planning     │
│    Spam      │     I think we should go with the token b…   │          1h · Room B  │
│    Trash     │  ─────────────────────────────────────────── │                        │
│    Archive   │  ●  GitHub           [opencode] Fix stream…  │    4:30  1:1 w/       │
│              │     @anomaly merged pull request #1847 in…   │          Jordan       │
│  ── Labels ──│  ─────────────────────────────────────────── │          30m · Zoom   │
│    work      │     Jira             [PROJ-142] Sprint rev…  │                        │
│    personal  │     Sprint 24 retrospective has been sche…   │  ── Tomorrow ──────   │
│    receipts  │  ─────────────────────────────────────────── │                        │
│              │     AWS              Your March invoice is…   │    9:00  Sprint       │
│              │     Your AWS bill for March 2026 is $142.…   │          Planning     │
│              │                                              │          2h · Room A  │
│              │                                              │                        │
```

- Unread threads: `●` marker, bold/bright text
- Read threads: dimmed
- Starred threads: `★` marker
- Thread list shows: sender, subject (truncated), snippet, relative time

### Thread View

```
┌─────────────────────────────────────────────────────────────┬────────────────────┐
│                                                             │                    │
│  Sarah Chen <sarah@company.com>              Mar 4, 2:15 PM│  ── Today ──      │
│  to me, dave                                                │                    │
│  ───────────────────────────────────────────────────────── │ ▶● 2:00 Quarterly │
│  Hi team, please review the attached planning doc.          │          Planning │
│                                                             │          1h        │
│  ┌──────────────────────────────────────────────────────┐  │          Room B    │
│  │  📅  Meeting Invite                                  │  │          ──────── │
│  │  Quarterly Planning Review                           │  │          Sarah C.  │
│  │  Today · 2:00 PM – 3:00 PM                          │  │          you ✓     │
│  │  📍 Conference Room B                                │  │          Dave K. ? │
│  │  [ ✓ Accepted ]   [ Tentative ]   [ Decline ]       │  │                    │
│  └──────────────────────────────────────────────────────┘  │    4:30  1:1 w/   │
│                                                             │          Jordan   │
│  📎 q2-planning.pdf (2.1 MB)                              │                    │
│                                                             │                    │
```

- Messages stacked chronologically with sender/date headers
- ICS attachments render as invite cards with action buttons
- Calendar sidebar highlights the related event with expanded attendee info
- Quoted replies collapsed by default

### Compose View

```
│  From:  edem@gmail.com                                                   │
│  To:    dave@example.com, alice@example.com                              │
│  Cc:    ▊                                                                │
│  Subj:  Re: API rate limiting strategy                                   │
│  ───────────────────────────────────────────────────────────────────────  │
│                                                                           │
│  (message body — text editor)                                            │
│  ▊                                                                       │
```

- Tab between fields
- Contact autocomplete from cached sender addresses (fuzzy search)
- `Ctrl+Enter` to send, `Ctrl+S` to save draft, `Esc` to cancel
- Auto-quote original message for replies

### Search View

```
│  /  from:dave has:attachment after:2026/01/01▊                           │
│                                                                           │
│  3 results                                                                │
│  ───────────────────────────────────────────────────────────────────────  │
│  ●  Dave Kumar     Re: API rate limiting strat          ·  1h           │
│     📎 rate-limit-rfc.pdf                                                │
```

- Passes through provider's native search syntax when supported
- Falls back to local SQLite full-text search otherwise
- Shows syntax hint based on active provider

### Full Calendar View (via `g c`)

The email panel is replaced with a week grid:

```
│    Mon 3       Tue 4        Wed 5       Thu 6        Fri 7           │
│                                                                      │
│                 ┌────────┐                                           │
│  9  ┌────────┐ │        │  ┌────────┐                               │
│     │Sprint  │ │Quarterly│  │Sprint  │                               │
│     │Review  │ │Planning │  │Plan    │                               │
│ 10  └────────┘ │Review   │  └────────┘                               │
│                └────────┘                                            │
```

- Day/week/month switchable with `1`/`2`/`3`
- `h`/`l` to navigate prev/next period
- `Enter` on event opens detail view with linked emails
- `n` to create new event
- `Esc` returns to inbox

### Keybind Map

| Key | Inbox | Thread | Compose | Calendar |
|-----|-------|--------|---------|----------|
| `j` / `k` | Next/prev thread | Scroll down/up | — | Next/prev event |
| `Enter` | Open thread | — | — | Open event detail |
| `q` | Quit | Back to inbox | — | Back to inbox |
| `Esc` | — | — | Cancel | Back to inbox |
| `a` | Archive | Archive | — | — |
| `d` | Trash | Trash | — | — |
| `s` | Star/unstar | Star/unstar | — | — |
| `r` | — | Reply | — | — |
| `R` | — | Reply all | — | — |
| `f` | — | Forward | — | — |
| `c` | Compose new | — | — | — |
| `/` | Search | — | — | — |
| `l` | Apply label | Apply label | — | — |
| `u` | Mark unread | Mark unread | — | — |
| `g i` | Go to inbox | — | — | Go to inbox |
| `g s` | Go to starred | — | — | — |
| `g d` | Go to drafts | — | — | — |
| `g c` | Calendar view | — | — | — |
| `Tab` | Focus calendar sidebar | Focus calendar sidebar | Next field | Focus inbox |
| `Ctrl+b` | Toggle calendar sidebar | Toggle calendar sidebar | — | — |
| `Ctrl+Enter` | — | — | Send | — |
| `Ctrl+S` | — | — | Save draft | — |
| `h` / `l` | — | — | — | Prev/next week |
| `1`/`2`/`3` | — | — | — | Day/week/month |
| `n` | — | — | — | New event |

All keybinds are configurable via config file.

### Color Theme

| Element | Color |
|---------|-------|
| Unread thread | White bold |
| Read thread | Gray/dim |
| Starred | Yellow `★` |
| Sender name | Cyan |
| Subject | White |
| Snippet / time | Dim gray |
| Labels | Colored pills |
| Unread dot | Blue `●` |
| Selected row | Inverted background |
| Keybind hints | Dim with key highlighted |
| Attachment | Yellow `📎` |
| Calendar event | Green `📅` |
| Current/next event | Bold with `●` marker |
| Sync indicator | Green when synced, yellow when syncing |

---

## Project Structure

```
openmail/
├── package.json                    # Monorepo root (Bun workspaces + Turborepo)
├── turbo.json                      # Build orchestration
├── tsconfig.json                   # Base TypeScript config
├── PLAN.md                         # This document
│
├── packages/
│   ├── openmail/                   # Core: CLI, server, cache, provider system, TUI
│   │   ├── package.json
│   │   ├── bin/openmail            # Executable entry point
│   │   └── src/
│   │       ├── index.ts                    # yargs CLI entry
│   │       │
│   │       ├── server/
│   │       │   ├── server.ts               # Hono + Bun.serve() + SSE + WebSocket
│   │       │   └── routes/
│   │       │       ├── thread.ts           # Thread CRUD
│   │       │       ├── message.ts          # Message read, attachments
│   │       │       ├── draft.ts            # Draft CRUD
│   │       │       ├── folder.ts           # Folder listing
│   │       │       ├── label.ts            # Label CRUD (capability-gated)
│   │       │       ├── search.ts           # Search (server-side or local fallback)
│   │       │       ├── calendar.ts         # Calendar + events
│   │       │       ├── account.ts          # Account management
│   │       │       ├── config.ts           # User preferences
│   │       │       └── timeline.ts         # Unified timeline (threads + events)
│   │       │
│   │       ├── provider/
│   │       │   ├── provider.ts             # MailProvider namespace + interfaces
│   │       │   ├── calendar.ts             # CalendarProvider namespace
│   │       │   └── registry.ts             # Provider registration + capability checks
│   │       │
│   │       ├── mail/
│   │       │   ├── types.ts                # Canonical data models
│   │       │   ├── thread.ts               # Thread operations
│   │       │   ├── message.ts              # Message operations
│   │       │   ├── draft.ts                # Draft operations
│   │       │   ├── folder.ts               # Folder operations
│   │       │   ├── label.ts                # Label operations
│   │       │   ├── search.ts               # Search logic
│   │       │   ├── calendar.ts             # Calendar event operations
│   │       │   ├── timeline.ts             # Unified timeline builder
│   │       │   ├── render.ts               # HTML-to-terminal conversion
│   │       │   └── ics.ts                  # ICS parsing + reply generation
│   │       │
│   │       ├── account/
│   │       │   └── account.ts              # Multi-account management
│   │       │
│   │       ├── auth/
│   │       │   ├── oauth.ts                # Local OAuth server (localhost callback)
│   │       │   └── store.ts                # Encrypted credential storage
│   │       │
│   │       ├── cache/
│   │       │   ├── schema.sql.ts           # Drizzle ORM table definitions
│   │       │   ├── sync.ts                 # Provider-aware sync coordinator
│   │       │   └── search.ts              # Local full-text search fallback
│   │       │
│   │       ├── bus.ts                      # Event bus (Zod-typed, SSE delivery)
│   │       ├── config.ts                   # Config file loading
│   │       │
│   │       └── cli/
│   │           └── cmd/
│   │               └── tui/
│   │                   ├── app.tsx                  # Root SolidJS component
│   │                   ├── context/
│   │                   │   ├── mail.tsx             # Thread/message reactive state
│   │                   │   ├── account.tsx          # Active account context
│   │                   │   ├── calendar.tsx         # Calendar events context
│   │                   │   ├── navigation.tsx       # Panel/view state
│   │                   │   └── compose.tsx          # Compose state
│   │                   ├── routes/
│   │                   │   ├── inbox.tsx            # Thread list view
│   │                   │   ├── thread.tsx           # Conversation view
│   │                   │   ├── compose.tsx          # Compose/reply editor
│   │                   │   ├── search.tsx           # Search view
│   │                   │   ├── calendar.tsx         # Full calendar view
│   │                   │   └── event.tsx            # Event detail view
│   │                   ├── component/
│   │                   │   ├── thread-list.tsx      # Virtualized thread list
│   │                   │   ├── message.tsx          # Single message renderer
│   │                   │   ├── message-body.tsx     # HTML/text body renderer
│   │                   │   ├── invite-card.tsx      # ICS invite card
│   │                   │   ├── sidebar.tsx          # Left sidebar (folders/labels)
│   │                   │   ├── calendar-sidebar.tsx # Right sidebar (agenda)
│   │                   │   ├── calendar-grid.tsx    # Week/day grid
│   │                   │   ├── header.tsx           # Top bar
│   │                   │   ├── status-bar.tsx       # Bottom keybind bar
│   │                   │   ├── input.tsx            # Text input
│   │                   │   ├── contact-picker.tsx   # Fuzzy autocomplete
│   │                   │   └── label-picker.tsx     # Label selector overlay
│   │                   └── keybinds.ts              # Keybind definitions
│   │
│   ├── provider-gmail/             # Gmail provider plugin
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts                    # Exports GmailProvider (Plugin + all extensions)
│   │       ├── auth.ts                     # Google OAuth2 (browser redirect to localhost)
│   │       ├── api.ts                      # Gmail REST API wrapper
│   │       ├── calendar.ts                 # Google Calendar API wrapper
│   │       ├── sync.ts                     # historyId-based incremental sync
│   │       ├── mime.ts                     # MIME parsing (base64 parts, charset)
│   │       └── mapping.ts                  # Gmail types → canonical Mail types
│   │
│   └── sdk/                        # TypeScript SDK (auto-generated from OpenAPI)
│       ├── package.json
│       └── src/
│           ├── client.ts                   # createMailClient()
│           └── server.ts                   # createMailServer() (spawns server process)
```

---

## Tech Stack

| Dependency | Purpose |
|------------|---------|
| `bun` | Runtime (not Node.js) |
| `hono` | HTTP server framework |
| `drizzle-orm` + `bun:sqlite` | SQLite ORM |
| `zod` | Schema validation (API types, event bus, config) |
| `yargs` | CLI argument parsing |
| `solid-js` | Reactive UI framework |
| `@opentui/core` + `@opentui/solid` | Terminal UI rendering for SolidJS |
| `googleapis` | Gmail + Google Calendar REST API |
| `google-auth-library` | OAuth2 token management |
| `ical.js` | ICS (iCalendar) parsing and generation |
| `htmlparser2` | HTML parsing for email body conversion |
| `sanitize-html` | HTML sanitization |
| `fuzzysort` | Fuzzy search (contacts, labels, search) |
| `@hey-api/openapi-ts` | SDK code generation from OpenAPI spec |
| `turbo` | Monorepo build orchestration |

---

## Implementation Phases

### Phase 1+2: Foundation + Read-Only TUI

**Goal**: `openmail` launches, authenticates with Gmail, syncs inbox, and renders an interactive read-only TUI.

| # | Task | Package |
|---|------|---------|
| 1 | Scaffold monorepo (package.json, turbo.json, tsconfig) | root |
| 2 | Define provider interfaces (MailProvider, CalendarProvider, extensions) | openmail |
| 3 | Define canonical data types (Mail namespace) | openmail |
| 4 | Implement provider registry | openmail |
| 5 | Define SQLite schema (Drizzle ORM) | openmail |
| 6 | Implement config file loading (~/.config/openmail/) | openmail |
| 7 | Implement event bus with Zod-typed events | openmail |
| 8 | Implement Hono server with SSE endpoint | openmail |
| 9 | Implement REST routes (threads, messages, folders, labels, search, calendar, timeline) | openmail |
| 10 | Implement OAuth flow (localhost callback, browser redirect) | openmail |
| 11 | Implement credential storage (encrypted tokens in SQLite or file) | openmail |
| 12 | Implement Gmail provider — auth | provider-gmail |
| 13 | Implement Gmail provider — list, getThread, getMessage | provider-gmail |
| 14 | Implement Gmail provider — listFolders, listLabels | provider-gmail |
| 15 | Implement Gmail provider — search (Searchable) | provider-gmail |
| 16 | Implement Gmail provider — incremental sync (IncrementallySyncable) | provider-gmail |
| 17 | Implement MIME parsing (base64, charset, multipart) | provider-gmail |
| 18 | Implement Gmail → canonical type mapping | provider-gmail |
| 19 | Implement sync coordinator (full sync + incremental) | openmail |
| 20 | Implement ICS parsing for invite detection | openmail |
| 21 | Implement HTML-to-terminal renderer | openmail |
| 22 | Implement yargs CLI with auth, serve, sync commands | openmail |
| 23 | Scaffold TUI app (SolidJS + OpenTUI) | openmail |
| 24 | Implement left sidebar (folders, labels, account) | openmail |
| 25 | Implement thread list (inbox view) with virtualized scrolling | openmail |
| 26 | Implement thread view (conversation with stacked messages) | openmail |
| 27 | Implement message body rendering (text + HTML + ICS invite cards) | openmail |
| 28 | Implement calendar sidebar (agenda view, contextual highlighting) | openmail |
| 29 | Implement header and keybind bar | openmail |
| 30 | Implement vim-style keybind system | openmail |
| 31 | Wire TUI to server via SSE (reactive updates on sync) | openmail |
| 32 | Implement search view | openmail |
| 33 | Generate SDK from OpenAPI spec | sdk |

### Phase 3: Actions

**Goal**: Archive, trash, star, label, mark read/unread from the TUI.

| # | Task |
|---|------|
| 34 | Server POST routes for archive, trash, star, markRead, markUnread, addLabel, removeLabel |
| 35 | Gmail provider — archive, trash, markRead, markUnread, addLabel, removeLabel |
| 36 | TUI keybinds — a (archive), d (trash), s (star), u (toggle unread) |
| 37 | Optimistic updates — update SQLite cache immediately, sync in background |
| 38 | Label picker overlay — fuzzy search to select/apply labels |

### Phase 4: Compose

**Goal**: Send, reply, and forward emails from the TUI.

| # | Task |
|---|------|
| 39 | Compose view — From/To/Cc/Subject fields + body text editor |
| 40 | Contact autocomplete — fuzzy search from cached sender addresses |
| 41 | Reply — pre-populate fields, quote original message |
| 42 | Forward — pre-populate with forwarded body |
| 43 | Gmail provider — send, reply |
| 44 | MIME building for outgoing messages |
| 45 | Draft save/resume — auto-save to Gmail drafts |
| 46 | Attachment support — attach files, display in thread view |
| 47 | Send confirmation prompt |

### Phase 5: Calendar View + Google Calendar API

**Goal**: Full calendar experience with Google Calendar sync.

| # | Task |
|---|------|
| 48 | Expand OAuth scopes to include Calendar API |
| 49 | Gmail provider — implement CalendarProvider.Plugin (listCalendars, listEvents, createEvent, respondToInvite, etc.) |
| 50 | Sync coordinator — calendar sync alongside email sync |
| 51 | Full calendar view — week grid with events |
| 52 | Day and month views |
| 53 | Event detail view with linked emails |
| 54 | Event-email linking logic (UID match, subject similarity, participant overlap) |
| 55 | Event creation from TUI |
| 56 | Calendar navigation (h/l prev/next, 1/2/3 day/week/month) |

### Phase 6: Polish + Future Providers

**Goal**: Multi-account, config, themes, CalDAV, future providers.

| # | Task |
|---|------|
| 57 | Multi-account support — add multiple Gmail accounts, account switcher in sidebar |
| 58 | Unified inbox view across accounts |
| 59 | Config file — keybinds, theme, default account, sync interval, render preferences |
| 60 | Theme system — dark/light/custom color schemes |
| 61 | Desktop notifications on new mail (optional) |
| 62 | Background sync on timer (configurable interval) |
| 63 | CalDAV provider (universal calendar sync) |
| 64 | IMAP/SMTP provider (generic email) |
| 65 | Outlook/Graph API provider |

---

## Configuration

### File Locations (XDG)

```
~/.config/openmail/config.json     # User configuration
~/.local/share/openmail/openmail.db   # SQLite database (cache + credentials)
~/.local/share/openmail/logs/      # Log files
```

### Config Schema

```json
{
  "accounts": [
    {
      "id": "gmail-personal",
      "provider": "gmail",
      "email": "user@gmail.com",
      "default": true
    }
  ],
  "sync": {
    "interval": 60,
    "onStartup": true
  },
  "layout": {
    "calendarSidebar": true
  },
  "keybinds": {
    "archive": "a",
    "trash": "d",
    "star": "s",
    "compose": "c",
    "search": "/",
    "reply": "r",
    "replyAll": "R",
    "forward": "f"
  },
  "render": {
    "html": "internal",
    "images": "placeholder"
  },
  "theme": "dark",
  "notifications": {
    "enabled": false,
    "sound": false
  }
}
```

---

## Open Questions & Future Work

### Decisions to Make Later

- **Encryption at rest**: How to encrypt OAuth tokens in SQLite. Options: OS keychain (via `keytar`), password-derived key, or plaintext (with file permissions).
- **Background daemon**: Should `openmail serve` run as a persistent background daemon, or only while the TUI is open? Daemon enables true push notifications but adds complexity.
- **Gmail API quotas**: Gmail API has a 250 quota units/second limit. Need to implement rate limiting and batching for large syncs.
- **Attachment downloads**: Where to save attachments when opened from TUI. Temp directory? Configurable download path?

### Future Providers (Post-MVP)

- **Outlook / Microsoft Graph API**: Second largest email provider. Graph API is well-documented with similar capabilities to Gmail.
- **IMAP/SMTP**: Generic provider for any email service. Most constrained (no labels, no push, manual threading), but universal.
- **Fastmail / JMAP**: JMAP is the modern replacement for IMAP. Fastmail is the reference implementation.
- **Proton Mail**: Would require their Bridge application for API access.

### Future Features

- **PGP/GPG encryption**: Sign and encrypt emails.
- **Snooze**: Hide a thread until a specified time.
- **Scheduled send**: Compose now, send later.
- **Thread muting**: Stop notifications for a thread.
- **Filters/rules**: Auto-label, auto-archive based on rules.
- **Import/export**: Migrate data between instances.

---

## References

- [OpenCode architecture](https://github.com/anomalyco/opencode) — the architectural inspiration
- [Gmail API documentation](https://developers.google.com/gmail/api)
- [Google Calendar API documentation](https://developers.google.com/calendar/api)
- [iCalendar RFC 5545](https://datatracker.ietf.org/doc/html/rfc5545)
- [CalDAV RFC 4791](https://datatracker.ietf.org/doc/html/rfc4791)
- [JMAP RFC 8620](https://datatracker.ietf.org/doc/html/rfc8620)
- [Hono web framework](https://hono.dev)
- [Drizzle ORM](https://orm.drizzle.team)
- [OpenTUI](https://github.com/sst/opentui)
- [SolidJS](https://www.solidjs.com)
