/**
 * Typed HTTP client SDK for the OpenMail local server.
 *
 * The TUI uses this to communicate with the Hono server running on localhost.
 * All methods return typed responses matching our canonical Mail types.
 *
 * Falls back gracefully when the server is unavailable (returns empty data).
 */
import { Mail } from "../mail/types.js"

export namespace MailClient {
  export interface Config {
    baseUrl: string // e.g. "http://localhost:4580"
  }

  interface ClientState {
    config: Config
    connected: boolean
    sseController: AbortController | null
  }

  let state: ClientState | null = null

  /**
   * Initialize the client with server connection details.
   */
  export function init(config: Config): void {
    state = {
      config,
      connected: false,
      sseController: null,
    }
  }

  /**
   * Get the current base URL.
   */
  export function getBaseUrl(): string {
    return state?.config.baseUrl ?? "http://localhost:4580"
  }

  /**
   * Check if the server is healthy.
   */
  export async function health(): Promise<boolean> {
    try {
      const res = await fetchJson<{ status: string }>("/health")
      if (state) state.connected = res.status === "ok"
      return res.status === "ok"
    } catch {
      if (state) state.connected = false
      return false
    }
  }

  /**
   * Whether the client has successfully connected to the server.
   */
  export function isConnected(): boolean {
    return state?.connected ?? false
  }

  // --- Threads ---

  export async function listThreads(opts?: {
    folderId?: string
    labelId?: string
    accountId?: string
    limit?: number
    cursor?: string
  }): Promise<Mail.Paginated<Mail.ThreadSummary>> {
    const params = new URLSearchParams()
    if (opts?.folderId) params.set("folderId", opts.folderId)
    if (opts?.labelId) params.set("labelId", opts.labelId)
    if (opts?.accountId) params.set("accountId", opts.accountId)
    if (opts?.limit) params.set("limit", String(opts.limit))
    if (opts?.cursor) params.set("cursor", opts.cursor)

    const query = params.toString()
    const url = `/threads${query ? `?${query}` : ""}`

    const data = await fetchJson<{ items: any[]; hasMore: boolean }>(url)

    return {
      items: data.items.map(normalizeThread),
      hasMore: data.hasMore,
    }
  }

  export async function getThread(id: string): Promise<Mail.ThreadDetail | null> {
    try {
      const data = await fetchJson<any>(`/threads/${id}`)
      return normalizeThreadDetail(data)
    } catch {
      return null
    }
  }

  // --- Folders ---

  export async function listFolders(opts?: {
    accountId?: string
  }): Promise<Mail.Folder[]> {
    const params = new URLSearchParams()
    if (opts?.accountId) params.set("accountId", opts.accountId)

    const query = params.toString()
    const url = `/folders${query ? `?${query}` : ""}`

    const data = await fetchJson<{ items: Mail.Folder[] }>(url)
    return data.items
  }

  // --- Labels ---

  export async function listLabels(opts?: {
    accountId?: string
  }): Promise<Mail.Label[]> {
    const params = new URLSearchParams()
    if (opts?.accountId) params.set("accountId", opts.accountId)

    const query = params.toString()
    const url = `/labels${query ? `?${query}` : ""}`

    const data = await fetchJson<{ items: Mail.Label[] }>(url)
    return data.items
  }

  // --- Accounts ---

  export async function listAccounts(): Promise<Array<{
    id: string
    providerId: string
    email: string
    name: string
    active: boolean
  }>> {
    const data = await fetchJson<{ items: any[] }>("/accounts")
    return data.items
  }

  export async function getSyncState(accountId: string): Promise<{
    accountId: string
    status: string
    lastSync?: Date
    error?: string
  } | null> {
    try {
      return await fetchJson(`/accounts/${accountId}/sync`)
    } catch {
      return null
    }
  }

  export async function triggerSync(accountId: string): Promise<boolean> {
    try {
      await postJson(`/accounts/${accountId}/sync`)
      return true
    } catch {
      return false
    }
  }

  // --- Calendar ---

  export async function listCalendarEvents(opts: {
    start: Date
    end: Date
    accountId?: string
  }): Promise<Mail.CalEvent[]> {
    const params = new URLSearchParams()
    params.set("start", opts.start.toISOString())
    params.set("end", opts.end.toISOString())
    if (opts.accountId) params.set("accountId", opts.accountId)

    const data = await fetchJson<{ items: any[] }>(`/calendar/events?${params}`)
    return data.items.map(normalizeCalEvent)
  }

  // --- Auth ---

  export async function getAuthStatus(): Promise<Array<{
    id: string
    providerId: string
    email: string
    name: string
    hasTokens: boolean
    expired: boolean
  }>> {
    const data = await fetchJson<{ accounts: any[] }>("/auth/status")
    return data.accounts
  }

  export async function startGoogleAuth(opts: {
    clientId: string
    clientSecret: string
    callbackPort?: number
    includeCalendar?: boolean
  }): Promise<{
    ok: boolean
    accountId?: string
    email?: string
    name?: string
    error?: string
  }> {
    return postJson("/auth/google", opts)
  }

  // --- Actions ---

  export async function archiveThread(threadId: string): Promise<boolean> {
    try {
      await postJson(`/threads/${threadId}/archive`)
      return true
    } catch {
      return false
    }
  }

  export async function trashThread(threadId: string): Promise<boolean> {
    try {
      await postJson(`/threads/${threadId}/trash`)
      return true
    } catch {
      return false
    }
  }

  export async function starThread(threadId: string): Promise<boolean> {
    try {
      await postJson(`/threads/${threadId}/star`)
      return true
    } catch {
      return false
    }
  }

  export async function unstarThread(threadId: string): Promise<boolean> {
    try {
      await postJson(`/threads/${threadId}/unstar`)
      return true
    } catch {
      return false
    }
  }

  export async function markRead(threadId: string): Promise<boolean> {
    try {
      await postJson(`/threads/${threadId}/read`)
      return true
    } catch {
      return false
    }
  }

  export async function markUnread(threadId: string): Promise<boolean> {
    try {
      await postJson(`/threads/${threadId}/unread`)
      return true
    } catch {
      return false
    }
  }

  // --- SSE (Server-Sent Events) ---

  export type EventHandler = (event: {
    type: string
    accountId?: string
    data: Record<string, unknown>
    timestamp: string
  }) => void

  /**
   * Subscribe to real-time events from the server via SSE.
   * Returns an unsubscribe function.
   */
  export function subscribe(handler: EventHandler): () => void {
    const baseUrl = getBaseUrl()
    const controller = new AbortController()

    if (state) {
      // Close existing subscription
      state.sseController?.abort()
      state.sseController = controller
    }

    const connect = () => {
      const eventSource = new EventSource(`${baseUrl}/events`)

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          handler({
            type: event.type === "message" ? "unknown" : event.type,
            ...data,
          })
        } catch {
          // Ignore unparseable events
        }
      }

      eventSource.onerror = () => {
        // Reconnection is automatic with EventSource
        if (state) state.connected = false
      }

      eventSource.onopen = () => {
        if (state) state.connected = true
      }

      // Handle abort
      controller.signal.addEventListener("abort", () => {
        eventSource.close()
      })
    }

    // Only connect if we have a server URL
    if (baseUrl) {
      try {
        connect()
      } catch {
        // EventSource might not be available
      }
    }

    return () => {
      controller.abort()
      if (state) state.sseController = null
    }
  }

  /**
   * Close the SSE connection.
   */
  export function disconnect(): void {
    state?.sseController?.abort()
    if (state) {
      state.sseController = null
      state.connected = false
    }
  }

  // --- Internal helpers ---

  async function fetchJson<T>(path: string): Promise<T> {
    const baseUrl = getBaseUrl()
    const res = await fetch(`${baseUrl}${path}`)
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    }
    return res.json() as Promise<T>
  }

  async function postJson<T>(path: string, body?: unknown): Promise<T> {
    const baseUrl = getBaseUrl()
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    }
    return res.json() as Promise<T>
  }

  function normalizeThread(data: any): Mail.ThreadSummary {
    return {
      ...data,
      time: new Date(data.time),
      participants: data.participants ?? [],
      folders: data.folders ?? [],
      labels: data.labels ?? [],
      linkedEventIds: data.linkedEventIds ?? [],
    }
  }

  function normalizeThreadDetail(data: any): Mail.ThreadDetail {
    return {
      ...normalizeThread(data),
      messages: (data.messages ?? []).map((m: any) => ({
        ...m,
        time: new Date(m.time),
        from: m.from ?? { name: "", email: "" },
        to: m.to ?? [],
        cc: m.cc ?? [],
        bcc: m.bcc ?? [],
        attachments: m.attachments ?? [],
        body: m.body ?? { text: "" },
      })),
    }
  }

  function normalizeCalEvent(data: any): Mail.CalEvent {
    return {
      ...data,
      start: new Date(data.start),
      end: new Date(data.end),
      organizer: data.organizer ?? { name: "", email: "" },
      attendees: data.attendees ?? [],
      linkedThreadIds: data.linkedThreadIds ?? [],
    }
  }
}
