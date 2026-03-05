/**
 * Gmail REST API wrapper.
 *
 * Wraps the googleapis Gmail client with our types and error handling.
 * All methods operate against a single authenticated account.
 */
import { google, type gmail_v1 } from "googleapis"
import { OAuth2Client } from "google-auth-library"
import { OAuth } from "../../auth/oauth.js"
import { CredentialStore } from "../../auth/store.js"

export namespace GmailApi {
  export interface Config {
    accountId: string
    clientId: string
    clientSecret: string
    callbackPort?: number
  }

  interface GmailClient {
    gmail: gmail_v1.Gmail
    oauth2Client: OAuth2Client
    accountId: string
  }

  /**
   * Create an authenticated Gmail API client.
   * Handles token refresh automatically.
   */
  export function createClient(config: Config): GmailClient {
    const oauth2Client = new OAuth2Client({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    })

    const stored = CredentialStore.get(config.accountId)
    if (!stored) {
      throw new Error(`No credentials found for account: ${config.accountId}`)
    }

    oauth2Client.setCredentials({
      access_token: stored.tokens.accessToken,
      refresh_token: stored.tokens.refreshToken,
      expiry_date: stored.tokens.expiresAt,
    })

    // Auto-refresh tokens
    oauth2Client.on("tokens", (tokens) => {
      const newTokenSet: OAuth.TokenSet = {
        accessToken: tokens.access_token ?? stored.tokens.accessToken,
        refreshToken: tokens.refresh_token ?? stored.tokens.refreshToken,
        expiresAt: tokens.expiry_date ?? Date.now() + 3600 * 1000,
        scopes: stored.tokens.scopes,
      }
      CredentialStore.updateTokens(config.accountId, newTokenSet)
    })

    const gmail = google.gmail({ version: "v1", auth: oauth2Client })

    return { gmail, oauth2Client, accountId: config.accountId }
  }

  /**
   * List threads (paginated).
   */
  export async function listThreads(
    client: GmailClient,
    opts: {
      labelIds?: string[]
      maxResults?: number
      pageToken?: string
      query?: string
    } = {}
  ): Promise<{
    threads: gmail_v1.Schema$Thread[]
    nextPageToken?: string
  }> {
    const res = await client.gmail.users.threads.list({
      userId: "me",
      labelIds: opts.labelIds,
      maxResults: opts.maxResults ?? 50,
      pageToken: opts.pageToken,
      q: opts.query,
    })

    return {
      threads: res.data.threads ?? [],
      nextPageToken: res.data.nextPageToken ?? undefined,
    }
  }

  /**
   * Get a full thread with all messages (including payload).
   */
  export async function getThread(
    client: GmailClient,
    threadId: string,
    format: "full" | "metadata" | "minimal" = "full"
  ): Promise<gmail_v1.Schema$Thread> {
    const res = await client.gmail.users.threads.get({
      userId: "me",
      id: threadId,
      format,
    })
    return res.data
  }

  /**
   * Get a single message.
   */
  export async function getMessage(
    client: GmailClient,
    messageId: string,
    format: "full" | "metadata" | "minimal" | "raw" = "full"
  ): Promise<gmail_v1.Schema$Message> {
    const res = await client.gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format,
    })
    return res.data
  }

  /**
   * List all labels for the account.
   */
  export async function listLabels(
    client: GmailClient
  ): Promise<gmail_v1.Schema$Label[]> {
    const res = await client.gmail.users.labels.list({
      userId: "me",
    })
    return res.data.labels ?? []
  }

  /**
   * Get a single label (includes unread count).
   */
  export async function getLabel(
    client: GmailClient,
    labelId: string
  ): Promise<gmail_v1.Schema$Label> {
    const res = await client.gmail.users.labels.get({
      userId: "me",
      id: labelId,
    })
    return res.data
  }

  /**
   * Modify labels on a message (add/remove).
   */
  export async function modifyMessage(
    client: GmailClient,
    messageId: string,
    opts: {
      addLabelIds?: string[]
      removeLabelIds?: string[]
    }
  ): Promise<gmail_v1.Schema$Message> {
    const res = await client.gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: {
        addLabelIds: opts.addLabelIds,
        removeLabelIds: opts.removeLabelIds,
      },
    })
    return res.data
  }

  /**
   * Modify labels on all messages in a thread.
   */
  export async function modifyThread(
    client: GmailClient,
    threadId: string,
    opts: {
      addLabelIds?: string[]
      removeLabelIds?: string[]
    }
  ): Promise<gmail_v1.Schema$Thread> {
    const res = await client.gmail.users.threads.modify({
      userId: "me",
      id: threadId,
      requestBody: {
        addLabelIds: opts.addLabelIds,
        removeLabelIds: opts.removeLabelIds,
      },
    })
    return res.data
  }

  /**
   * Trash a thread (move to Trash label).
   */
  export async function trashThread(
    client: GmailClient,
    threadId: string
  ): Promise<void> {
    await client.gmail.users.threads.trash({
      userId: "me",
      id: threadId,
    })
  }

  /**
   * Send an email (raw RFC 2822 format).
   */
  export async function sendMessage(
    client: GmailClient,
    raw: string,
    threadId?: string
  ): Promise<gmail_v1.Schema$Message> {
    const res = await client.gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: Buffer.from(raw).toString("base64url"),
        threadId,
      },
    })
    return res.data
  }

  /**
   * Get history (incremental sync from a history ID).
   */
  export async function listHistory(
    client: GmailClient,
    startHistoryId: string,
    opts: {
      labelId?: string
      maxResults?: number
      pageToken?: string
    } = {}
  ): Promise<{
    history: gmail_v1.Schema$History[]
    historyId: string
    nextPageToken?: string
  }> {
    const res = await client.gmail.users.history.list({
      userId: "me",
      startHistoryId,
      labelId: opts.labelId,
      maxResults: opts.maxResults ?? 500,
      pageToken: opts.pageToken,
      historyTypes: ["messageAdded", "messageDeleted", "labelAdded", "labelRemoved"],
    })

    return {
      history: res.data.history ?? [],
      historyId: res.data.historyId ?? startHistoryId,
      nextPageToken: res.data.nextPageToken ?? undefined,
    }
  }

  /**
   * Get the current user profile (email, historyId).
   */
  export async function getProfile(
    client: GmailClient
  ): Promise<{
    email: string
    historyId: string
    messagesTotal: number
    threadsTotal: number
  }> {
    const res = await client.gmail.users.getProfile({
      userId: "me",
    })

    return {
      email: res.data.emailAddress!,
      historyId: res.data.historyId!,
      messagesTotal: res.data.messagesTotal ?? 0,
      threadsTotal: res.data.threadsTotal ?? 0,
    }
  }

  /**
   * Get an attachment by ID (returns base64 data).
   */
  export async function getAttachment(
    client: GmailClient,
    messageId: string,
    attachmentId: string
  ): Promise<{ data: string; size: number }> {
    const res = await client.gmail.users.messages.attachments.get({
      userId: "me",
      messageId,
      id: attachmentId,
    })

    return {
      data: res.data.data ?? "",
      size: res.data.size ?? 0,
    }
  }

  /**
   * Batch modify messages (for bulk operations).
   */
  export async function batchModifyMessages(
    client: GmailClient,
    messageIds: string[],
    opts: {
      addLabelIds?: string[]
      removeLabelIds?: string[]
    }
  ): Promise<void> {
    await client.gmail.users.messages.batchModify({
      userId: "me",
      requestBody: {
        ids: messageIds,
        addLabelIds: opts.addLabelIds,
        removeLabelIds: opts.removeLabelIds,
      },
    })
  }

  /**
   * Search threads using Gmail query syntax.
   */
  export async function searchThreads(
    client: GmailClient,
    query: string,
    opts: {
      maxResults?: number
      pageToken?: string
    } = {}
  ): Promise<{
    threads: gmail_v1.Schema$Thread[]
    nextPageToken?: string
  }> {
    return listThreads(client, {
      query,
      maxResults: opts.maxResults,
      pageToken: opts.pageToken,
    })
  }

  /**
   * Build an RFC 2822 message from our types.
   */
  export function buildRawMessage(opts: {
    from: { name: string; email: string }
    to: { name: string; email: string }[]
    cc?: { name: string; email: string }[]
    bcc?: { name: string; email: string }[]
    subject: string
    body: { text: string; html?: string }
    inReplyTo?: string
    references?: string
  }): string {
    const formatAddr = (p: { name: string; email: string }) =>
      p.name ? `"${p.name}" <${p.email}>` : p.email

    const lines: string[] = [
      `From: ${formatAddr(opts.from)}`,
      `To: ${opts.to.map(formatAddr).join(", ")}`,
    ]

    if (opts.cc?.length) {
      lines.push(`Cc: ${opts.cc.map(formatAddr).join(", ")}`)
    }
    if (opts.bcc?.length) {
      lines.push(`Bcc: ${opts.bcc.map(formatAddr).join(", ")}`)
    }

    lines.push(`Subject: ${opts.subject}`)
    lines.push(`Date: ${new Date().toUTCString()}`)
    lines.push(`MIME-Version: 1.0`)

    if (opts.inReplyTo) {
      lines.push(`In-Reply-To: ${opts.inReplyTo}`)
    }
    if (opts.references) {
      lines.push(`References: ${opts.references}`)
    }

    if (opts.body.html) {
      const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`
      lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`)
      lines.push("")
      lines.push(`--${boundary}`)
      lines.push("Content-Type: text/plain; charset=UTF-8")
      lines.push("")
      lines.push(opts.body.text)
      lines.push(`--${boundary}`)
      lines.push("Content-Type: text/html; charset=UTF-8")
      lines.push("")
      lines.push(opts.body.html)
      lines.push(`--${boundary}--`)
    } else {
      lines.push("Content-Type: text/plain; charset=UTF-8")
      lines.push("")
      lines.push(opts.body.text)
    }

    return lines.join("\r\n")
  }
}
