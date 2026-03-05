/**
 * Gmail API → canonical Mail type mapping.
 *
 * Converts Gmail's native types (threads, messages, labels, etc.)
 * into the canonical Mail namespace types used throughout the app.
 */
import type { gmail_v1 } from "googleapis"
import { Mail } from "../../mail/types.js"
import { Mime } from "./mime.js"

export namespace GmailMapping {
  /** Gmail system label IDs → our folder types */
  const FOLDER_LABEL_MAP: Record<string, Mail.Folder["type"]> = {
    INBOX: "inbox",
    SENT: "sent",
    DRAFT: "drafts",
    TRASH: "trash",
    SPAM: "spam",
    STARRED: "custom", // starred is handled as a flag, not a folder type
    IMPORTANT: "custom",
    CATEGORY_PERSONAL: "custom",
    CATEGORY_SOCIAL: "custom",
    CATEGORY_PROMOTIONS: "custom",
    CATEGORY_UPDATES: "custom",
    CATEGORY_FORUMS: "custom",
  }

  /** System labels that we treat as folders (not user labels). */
  const SYSTEM_FOLDER_IDS = new Set([
    "INBOX", "SENT", "DRAFT", "TRASH", "SPAM",
    "STARRED", "IMPORTANT", "UNREAD",
    "CATEGORY_PERSONAL", "CATEGORY_SOCIAL",
    "CATEGORY_PROMOTIONS", "CATEGORY_UPDATES", "CATEGORY_FORUMS",
  ])

  /** Label IDs we should hide from the user. */
  const HIDDEN_LABEL_IDS = new Set([
    "UNREAD", "STARRED", "IMPORTANT", "DRAFT",
    "CATEGORY_PERSONAL", "CATEGORY_SOCIAL",
    "CATEGORY_PROMOTIONS", "CATEGORY_UPDATES", "CATEGORY_FORUMS",
    "CHAT",
  ])

  /**
   * Map a Gmail thread (from threads.list) to a ThreadSummary.
   * Note: threads.list only returns the first message's snippet,
   * so we enrich with message data when available.
   */
  export function threadToSummary(
    thread: gmail_v1.Schema$Thread,
    accountId: string
  ): Mail.ThreadSummary {
    const messages = thread.messages ?? []
    const lastMessage = messages[messages.length - 1]
    const firstMessage = messages[0]
    const headers = firstMessage?.payload?.headers

    // Collect all unique participants across messages
    const participantMap = new Map<string, Mail.Participant>()
    for (const msg of messages) {
      const msgHeaders = msg.payload?.headers
      const from = Mime.getHeader(msgHeaders, "From")
      if (from) {
        const parsed = Mime.parseEmailAddress(from)
        participantMap.set(parsed.email, parsed)
      }
    }

    // Determine labels and folders
    const labelIds = new Set<string>()
    for (const msg of messages) {
      for (const id of msg.labelIds ?? []) {
        labelIds.add(id)
      }
    }

    const folders = [...labelIds]
      .filter((id) => SYSTEM_FOLDER_IDS.has(id) && !HIDDEN_LABEL_IDS.has(id))
      .map((id) => `folder:${id}`)
    const userLabels = [...labelIds]
      .filter((id) => !SYSTEM_FOLDER_IDS.has(id) && !HIDDEN_LABEL_IDS.has(id))
      .map((id) => `label:${id}`)

    const unread = labelIds.has("UNREAD")
    const starred = labelIds.has("STARRED")

    // Check for attachments (may not be available with metadata-only format)
    const hasAttachments = messages.some((msg) => {
      // Only check if payload has parts (full format)
      if (!msg.payload?.parts) return false
      const parsed = Mime.parsePayload(msg.payload)
      return parsed.attachments.length > 0
    })

    const subject = Mime.getHeader(headers, "Subject") ?? "(no subject)"
    const lastTime = lastMessage?.internalDate
      ? new Date(parseInt(lastMessage.internalDate))
      : new Date()

    return {
      id: thread.id!,
      accountId,
      subject,
      snippet: thread.snippet ?? "",
      participants: [...participantMap.values()],
      messageCount: messages.length,
      hasAttachments,
      folders,
      labels: userLabels,
      unread,
      starred,
      time: lastTime,
      linkedEventIds: [],
    }
  }

  /**
   * Map a full Gmail thread (from threads.get with full messages) to a ThreadDetail.
   */
  export function threadToDetail(
    thread: gmail_v1.Schema$Thread,
    accountId: string
  ): Mail.ThreadDetail {
    const summary = threadToSummary(thread, accountId)
    const messages = (thread.messages ?? []).map((msg) => messageToDetail(msg, accountId))

    return {
      ...summary,
      messages,
    }
  }

  /**
   * Map a single Gmail message to a MessageDetail.
   */
  export function messageToDetail(
    message: gmail_v1.Schema$Message,
    accountId: string
  ): Mail.MessageDetail {
    const headers = message.payload?.headers
    const parsed = Mime.parsePayload(message.payload)

    const fromRaw = Mime.getHeader(headers, "From") ?? ""
    const from = Mime.parseEmailAddress(fromRaw)

    const to = Mime.parseEmailList(Mime.getHeader(headers, "To"))
    const cc = Mime.parseEmailList(Mime.getHeader(headers, "Cc"))
    const bcc = Mime.parseEmailList(Mime.getHeader(headers, "Bcc"))

    const replyToRaw = Mime.getHeader(headers, "Reply-To")
    const replyTo = replyToRaw ? Mime.parseEmailAddress(replyToRaw) : undefined

    const subject = Mime.getHeader(headers, "Subject") ?? "(no subject)"
    const messageIdHeader = Mime.getHeader(headers, "Message-ID") ?? Mime.getHeader(headers, "Message-Id")
    const inReplyTo = Mime.getHeader(headers, "In-Reply-To")

    const time = message.internalDate
      ? new Date(parseInt(message.internalDate))
      : new Date()

    const labelIds = new Set(message.labelIds ?? [])
    const unread = labelIds.has("UNREAD")

    return {
      id: message.id!,
      threadId: message.threadId!,
      from,
      to,
      cc,
      bcc,
      replyTo,
      subject,
      body: parsed.body,
      attachments: parsed.attachments,
      time,
      unread,
      messageIdHeader,
      inReplyTo,
    }
  }

  /**
   * Map Gmail labels to our Folder and Label types.
   * System labels become Folders, user labels become Labels.
   */
  export function labelsToFoldersAndLabels(
    labels: gmail_v1.Schema$Label[],
    accountId: string
  ): { folders: Mail.Folder[]; labels: Mail.Label[] } {
    const folders: Mail.Folder[] = []
    const userLabels: Mail.Label[] = []

    for (const label of labels) {
      const id = label.id!
      const name = label.name ?? id

      if (HIDDEN_LABEL_IDS.has(id)) continue

      if (label.type === "system" && SYSTEM_FOLDER_IDS.has(id)) {
        const folderType = FOLDER_LABEL_MAP[id] ?? "custom"
        folders.push({
          id: `folder:${id}`,
          name: formatFolderName(name),
          type: folderType,
          unreadCount: label.messagesUnread ?? 0,
        })
      } else if (label.type === "user") {
        userLabels.push({
          id: `label:${id}`,
          name,
          color: labelColorToHex(label.color),
        })
      }
    }

    // Sort folders: inbox first, then alphabetical
    const folderOrder: Record<string, number> = {
      inbox: 0, sent: 1, drafts: 2, trash: 3, spam: 4, archive: 5, custom: 6,
    }
    folders.sort((a, b) => (folderOrder[a.type] ?? 99) - (folderOrder[b.type] ?? 99))

    return { folders, labels: userLabels }
  }

  /**
   * Convert a Gmail label ID to our internal folder ID.
   */
  export function gmailLabelIdToFolderId(labelId: string): string {
    if (SYSTEM_FOLDER_IDS.has(labelId)) return `folder:${labelId}`
    return `label:${labelId}`
  }

  /**
   * Convert our internal folder ID back to a Gmail label ID.
   */
  export function folderIdToGmailLabelId(folderId: string): string {
    return folderId.replace(/^(folder|label):/, "")
  }

  // --- Internal helpers ---

  function formatFolderName(name: string): string {
    // Gmail returns system labels in ALL CAPS (INBOX, SENT, etc.)
    if (name === name.toUpperCase() && name.length > 1) {
      return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()
    }
    return name
  }

  function labelColorToHex(color: gmail_v1.Schema$LabelColor | undefined): string {
    if (!color) return "#888888"
    // Gmail provides background and text colors; use background
    return color.backgroundColor ?? "#888888"
  }
}
