/**
 * Event bus — typed pub/sub for internal communication and SSE delivery.
 *
 * Events flow: Provider → Sync Coordinator → Event Bus → SSE endpoint → TUI
 * Also used for internal subscribers (notifications, cache invalidation).
 */
export namespace EventBus {
  export type EventType =
    | "thread.created"
    | "thread.updated"
    | "thread.deleted"
    | "message.created"
    | "folder.updated"
    | "label.updated"
    | "sync.started"
    | "sync.completed"
    | "sync.error"
    | "calendar.event.created"
    | "calendar.event.updated"
    | "calendar.event.deleted"
    | "account.added"
    | "account.removed"

  export interface Event {
    type: EventType
    accountId?: string
    data: Record<string, unknown>
    timestamp: Date
  }

  type Listener = (event: Event) => void

  const listeners = new Map<EventType | "*", Set<Listener>>()

  /**
   * Subscribe to a specific event type, or "*" for all events.
   * Returns an unsubscribe function.
   */
  export function on(type: EventType | "*", listener: Listener): () => void {
    if (!listeners.has(type)) {
      listeners.set(type, new Set())
    }
    listeners.get(type)!.add(listener)

    return () => {
      listeners.get(type)?.delete(listener)
    }
  }

  /**
   * Emit an event to all subscribers of that type and wildcard subscribers.
   */
  export function emit(type: EventType, data: Record<string, unknown> = {}, accountId?: string): void {
    const event: Event = { type, data, accountId, timestamp: new Date() }

    // Notify type-specific listeners
    const specific = listeners.get(type)
    if (specific) {
      for (const listener of specific) {
        try {
          listener(event)
        } catch (err) {
          console.error(`EventBus listener error for "${type}":`, err)
        }
      }
    }

    // Notify wildcard listeners
    const wildcard = listeners.get("*")
    if (wildcard) {
      for (const listener of wildcard) {
        try {
          listener(event)
        } catch (err) {
          console.error("EventBus wildcard listener error:", err)
        }
      }
    }
  }

  /**
   * Remove all listeners. Used in tests.
   */
  export function clear(): void {
    listeners.clear()
  }

  /**
   * Get the count of listeners for a given event type.
   */
  export function listenerCount(type: EventType | "*"): number {
    return listeners.get(type)?.size ?? 0
  }
}
