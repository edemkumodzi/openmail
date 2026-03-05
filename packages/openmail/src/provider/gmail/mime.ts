/**
 * MIME parsing utilities for Gmail API messages.
 *
 * Gmail returns messages in a nested payload structure with base64url-encoded
 * parts. This module extracts text/html bodies, attachments, and handles
 * charset conversion.
 */
import type { gmail_v1 } from "googleapis"

export namespace Mime {
  export interface ParsedBody {
    text: string
    html?: string
  }

  export interface ParsedAttachment {
    id: string              // Gmail attachment ID (for download)
    filename: string
    mimeType: string
    size: number
  }

  export interface ParsedMessage {
    body: ParsedBody
    attachments: ParsedAttachment[]
    hasCalendarInvite: boolean
  }

  /**
   * Parse a Gmail message payload into text/html body and attachment list.
   */
  export function parsePayload(payload: gmail_v1.Schema$MessagePart | undefined): ParsedMessage {
    if (!payload) {
      return { body: { text: "" }, attachments: [], hasCalendarInvite: false }
    }

    const parts: gmail_v1.Schema$MessagePart[] = []
    flattenParts(payload, parts)

    let text = ""
    let html: string | undefined
    const attachments: ParsedAttachment[] = []
    let hasCalendarInvite = false

    for (const part of parts) {
      const mime = part.mimeType ?? ""
      const data = part.body?.data
      const filename = part.filename ?? ""
      const attachmentId = part.body?.attachmentId

      // Calendar invite
      if (mime === "text/calendar" || mime === "application/ics") {
        hasCalendarInvite = true
      }

      // If it has an attachmentId or a filename, it's an attachment
      if (attachmentId || (filename && filename.length > 0)) {
        attachments.push({
          id: attachmentId ?? part.partId ?? "",
          filename: filename || "untitled",
          mimeType: mime,
          size: part.body?.size ?? 0,
        })
        continue
      }

      // Text body
      if (mime === "text/plain" && data) {
        text = decodeBase64Url(data)
      }

      // HTML body
      if (mime === "text/html" && data) {
        html = decodeBase64Url(data)
      }
    }

    // Fallback: if payload itself has data (simple, non-multipart message)
    if (!text && !html && payload.body?.data) {
      const decoded = decodeBase64Url(payload.body.data)
      if (payload.mimeType === "text/html") {
        html = decoded
      } else {
        text = decoded
      }
    }

    // If we only have HTML, generate a basic text version
    if (!text && html) {
      text = stripHtml(html)
    }

    return { body: { text, html }, attachments, hasCalendarInvite }
  }

  /**
   * Extract a specific header value from a Gmail message.
   */
  export function getHeader(
    headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
    name: string
  ): string | undefined {
    if (!headers) return undefined
    const lower = name.toLowerCase()
    return headers.find((h) => h.name?.toLowerCase() === lower)?.value ?? undefined
  }

  /**
   * Parse an email address header like "Alice <alice@test.com>" or "alice@test.com".
   */
  export function parseEmailAddress(raw: string): { name: string; email: string } {
    const match = raw.match(/^(.+?)\s*<([^>]+)>$/)
    if (match) {
      return { name: match[1].replace(/^"|"$/g, "").trim(), email: match[2].trim() }
    }
    return { name: raw.split("@")[0] ?? raw, email: raw.trim() }
  }

  /**
   * Parse a comma-separated list of email addresses.
   */
  export function parseEmailList(raw: string | undefined): { name: string; email: string }[] {
    if (!raw) return []
    // Split on commas, but not commas within angle brackets or quotes
    const parts = splitEmailList(raw)
    return parts.map(parseEmailAddress).filter((p) => p.email.includes("@"))
  }

  /**
   * Decode a base64url-encoded string to UTF-8 text.
   */
  export function decodeBase64Url(data: string): string {
    // Convert base64url to standard base64
    const base64 = data.replace(/-/g, "+").replace(/_/g, "/")
    const buffer = Buffer.from(base64, "base64")
    return buffer.toString("utf8")
  }

  // --- Internal helpers ---

  /**
   * Recursively flatten all MIME parts from a nested payload structure.
   */
  function flattenParts(
    part: gmail_v1.Schema$MessagePart,
    result: gmail_v1.Schema$MessagePart[]
  ): void {
    if (part.parts && part.parts.length > 0) {
      for (const child of part.parts) {
        flattenParts(child, result)
      }
    } else {
      result.push(part)
    }
  }

  /**
   * Split a comma-separated email list, respecting quoted strings and angle brackets.
   */
  function splitEmailList(raw: string): string[] {
    const results: string[] = []
    let current = ""
    let depth = 0
    let inQuote = false

    for (const ch of raw) {
      if (ch === '"' && !inQuote) { inQuote = true; current += ch; continue }
      if (ch === '"' && inQuote) { inQuote = false; current += ch; continue }
      if (inQuote) { current += ch; continue }
      if (ch === "<") { depth++; current += ch; continue }
      if (ch === ">") { depth--; current += ch; continue }
      if (ch === "," && depth === 0) {
        const trimmed = current.trim()
        if (trimmed) results.push(trimmed)
        current = ""
        continue
      }
      current += ch
    }

    const trimmed = current.trim()
    if (trimmed) results.push(trimmed)

    return results
  }

  /**
   * Convert HTML email to readable plain text.
   * Handles real-world HTML emails: removes style/script blocks,
   * converts block elements to newlines, decodes entities.
   */
  export function stripHtml(html: string): string {
    let text = html

    // Remove entire <head>, <style>, <script> blocks (content included)
    text = text.replace(/<head[\s>][\s\S]*?<\/head>/gi, "")
    text = text.replace(/<style[\s>][\s\S]*?<\/style>/gi, "")
    text = text.replace(/<script[\s>][\s\S]*?<\/script>/gi, "")

    // Remove HTML comments
    text = text.replace(/<!--[\s\S]*?-->/g, "")

    // Convert <br> to newlines
    text = text.replace(/<br\s*\/?>/gi, "\n")

    // Block-level elements get newlines
    text = text.replace(/<\/p>/gi, "\n\n")
    text = text.replace(/<\/div>/gi, "\n")
    text = text.replace(/<\/tr>/gi, "\n")
    text = text.replace(/<\/li>/gi, "\n")
    text = text.replace(/<\/h[1-6]>/gi, "\n\n")
    text = text.replace(/<\/blockquote>/gi, "\n")
    text = text.replace(/<hr\s*\/?>/gi, "\n---\n")

    // List items get a bullet
    text = text.replace(/<li[^>]*>/gi, "  \u2022 ")

    // Links: extract href text
    text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, content) => {
      const linkText = content.replace(/<[^>]+>/g, "").trim()
      if (!linkText || linkText === href) return href
      return `${linkText} (${href})`
    })

    // Remove all remaining HTML tags
    text = text.replace(/<[^>]+>/g, "")

    // Decode HTML entities
    text = text.replace(/&amp;/g, "&")
    text = text.replace(/&lt;/g, "<")
    text = text.replace(/&gt;/g, ">")
    text = text.replace(/&quot;/g, '"')
    text = text.replace(/&#0?39;/g, "'")
    text = text.replace(/&apos;/g, "'")
    text = text.replace(/&nbsp;/g, " ")
    text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
    text = text.replace(/&[a-zA-Z]+;/g, " ") // remaining entities → space

    // Clean up whitespace
    text = text.replace(/[ \t]+/g, " ")          // collapse horizontal whitespace
    text = text.replace(/^ +| +$/gm, "")         // trim each line
    text = text.replace(/\n{3,}/g, "\n\n")        // max 2 consecutive newlines

    return text.trim()
  }
}
