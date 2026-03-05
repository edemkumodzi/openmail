/**
 * Gmail incremental sync — uses Gmail's history API for efficient delta sync.
 *
 * Flow:
 * 1. First sync: Get current historyId from profile, fetch N recent threads
 * 2. Incremental sync: Use history.list from last historyId to get changes
 * 3. Apply changes: Insert new threads, update modified, remove deleted
 *
 * The history API returns changes since a given historyId:
 * - messagesAdded / messagesDeleted
 * - labelsAdded / labelsRemoved
 */
import type { gmail_v1 } from "googleapis"
import { Mail } from "../../mail/types.js"
import { GmailApi } from "./api.js"
import { GmailMapping } from "./mapping.js"

export namespace GmailSync {
  export interface SyncState {
    historyId: string
    lastSync: Date
  }

  export interface SyncResult {
    /** New historyId to store for next sync */
    newHistoryId: string
    /** Thread IDs that were created or updated (need re-fetch) */
    updatedThreadIds: string[]
    /** Thread IDs that were deleted */
    deletedThreadIds: string[]
    /** Whether there are more history pages to process */
    hasMore: boolean
  }

  export interface FullSyncResult {
    /** All threads fetched */
    threads: gmail_v1.Schema$Thread[]
    /** The historyId at the time of sync */
    historyId: string
  }

  /**
   * Perform a full initial sync: fetch recent threads and current historyId.
   * Used when there's no previous sync state.
   */
  export async function fullSync(
    client: ReturnType<typeof GmailApi.createClient>,
    opts: {
      maxThreads?: number
      labelIds?: string[]
    } = {}
  ): Promise<FullSyncResult> {
    const maxThreads = opts.maxThreads ?? 200
    const labelIds = opts.labelIds ?? ["INBOX"]

    // Get current profile for historyId
    const profile = await GmailApi.getProfile(client)

    // Fetch threads (paginated)
    const allThreads: gmail_v1.Schema$Thread[] = []
    let pageToken: string | undefined

    while (allThreads.length < maxThreads) {
      const remaining = maxThreads - allThreads.length
      const res = await GmailApi.listThreads(client, {
        labelIds,
        maxResults: Math.min(remaining, 50),
        pageToken,
      })

      // threads.list returns minimal data — fetch metadata in parallel batches
      const threadIds = res.threads.map((t) => t.id).filter(Boolean) as string[]
      const BATCH_SIZE = 10
      for (let i = 0; i < threadIds.length; i += BATCH_SIZE) {
        const batch = threadIds.slice(i, i + BATCH_SIZE)
        const results = await Promise.allSettled(
          batch.map((id) => GmailApi.getThread(client, id, "metadata"))
        )
        for (const result of results) {
          if (result.status === "fulfilled") {
            allThreads.push(result.value)
          }
        }
      }

      pageToken = res.nextPageToken
      if (!pageToken) break
    }

    return {
      threads: allThreads,
      historyId: profile.historyId,
    }
  }

  /**
   * Perform an incremental sync using Gmail's history API.
   * Returns the set of changed thread IDs (to re-fetch) and deleted thread IDs.
   */
  export async function incrementalSync(
    client: ReturnType<typeof GmailApi.createClient>,
    startHistoryId: string
  ): Promise<SyncResult> {
    const updatedThreadIds = new Set<string>()
    const deletedThreadIds = new Set<string>()
    let currentHistoryId = startHistoryId
    let pageToken: string | undefined
    let hasMore = false

    try {
      do {
        const res = await GmailApi.listHistory(client, startHistoryId, {
          pageToken,
        })

        currentHistoryId = res.historyId

        for (const history of res.history) {
          // Messages added → thread was updated
          for (const added of history.messagesAdded ?? []) {
            if (added.message?.threadId) {
              updatedThreadIds.add(added.message.threadId)
              // If it was previously marked deleted, un-delete
              deletedThreadIds.delete(added.message.threadId)
            }
          }

          // Messages deleted → thread might be deleted
          for (const deleted of history.messagesDeleted ?? []) {
            if (deleted.message?.threadId) {
              updatedThreadIds.add(deleted.message.threadId)
            }
          }

          // Labels changed → thread was updated
          for (const added of history.labelsAdded ?? []) {
            if (added.message?.threadId) {
              updatedThreadIds.add(added.message.threadId)
            }
          }

          for (const removed of history.labelsRemoved ?? []) {
            if (removed.message?.threadId) {
              updatedThreadIds.add(removed.message.threadId)
            }
          }
        }

        pageToken = res.nextPageToken
      } while (pageToken)
    } catch (err: any) {
      // 404 means the historyId is too old — need full sync
      if (err.code === 404 || err.status === 404) {
        throw new HistoryExpiredError(
          `History ID ${startHistoryId} is too old. Full sync required.`
        )
      }
      throw err
    }

    return {
      newHistoryId: currentHistoryId,
      updatedThreadIds: [...updatedThreadIds],
      deletedThreadIds: [...deletedThreadIds],
      hasMore: false,
    }
  }

  /**
   * Fetch full thread data for a list of thread IDs.
   * Used after incrementalSync to get updated thread details.
   */
  export async function fetchThreads(
    client: ReturnType<typeof GmailApi.createClient>,
    threadIds: string[]
  ): Promise<gmail_v1.Schema$Thread[]> {
    const threads: gmail_v1.Schema$Thread[] = []

    // Fetch in parallel batches of 10 to avoid rate limiting
    const BATCH_SIZE = 10
    for (let i = 0; i < threadIds.length; i += BATCH_SIZE) {
      const batch = threadIds.slice(i, i + BATCH_SIZE)
      const results = await Promise.allSettled(
        batch.map((id) => GmailApi.getThread(client, id, "full"))
      )

      for (const result of results) {
        if (result.status === "fulfilled") {
          threads.push(result.value)
        } else {
          // Thread might have been permanently deleted
          console.error("Failed to fetch thread:", result.reason)
        }
      }
    }

    return threads
  }

  /**
   * Error thrown when the history ID is too old and a full sync is needed.
   */
  export class HistoryExpiredError extends Error {
    constructor(message: string) {
      super(message)
      this.name = "HistoryExpiredError"
    }
  }
}
