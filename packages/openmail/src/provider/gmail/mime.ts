/**
 * MIME parsing utilities for Gmail API messages.
 *
 * Gmail returns messages in a nested payload structure with base64url-encoded
 * parts. This module extracts text/html bodies, attachments, and handles
 * charset conversion.
 */
import type { gmail_v1 } from "googleapis"

export namespace Mime {
  export interface ExtractedLink {
    label: string
    url: string
  }

  export interface StrippedHtml {
    text: string
    links: ExtractedLink[]
  }

  export interface ParsedBody {
    text: string
    html?: string
    links: ExtractedLink[]
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
      return { body: { text: "", links: [] }, attachments: [], hasCalendarInvite: false }
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
    let links: ExtractedLink[] = []
    if (!text && html) {
      const stripped = stripHtml(html)
      text = stripped.text
      links = stripped.links
    } else if (html) {
      // Even if we have text/plain, extract links from HTML
      const stripped = stripHtml(html)
      links = stripped.links
      // Clean bare URLs from text/plain that are now in the links popup
      text = cleanTextWithLinks(text, links)
    }

    return { body: { text, html, links }, attachments, hasCalendarInvite }
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
   *
   * Strategy:
   * - Remove style/script/head blocks entirely
   * - Convert block elements to newlines
   * - Links: show only the link text inline (no footnote references)
   *   and collect all links into a separate array for the links popup
   * - <hr> becomes a clean separator
   * - Aggressive whitespace cleanup
   */
  export function stripHtml(html: string): StrippedHtml {
    let text = html
    const links: ExtractedLink[] = []

    // Remove entire <head>, <style>, <script> blocks (content included)
    text = text.replace(/<head[\s>][\s\S]*?<\/head>/gi, "")
    text = text.replace(/<style[\s>][\s\S]*?<\/style>/gi, "")
    text = text.replace(/<script[\s>][\s\S]*?<\/script>/gi, "")

    // Remove HTML comments
    text = text.replace(/<!--[\s\S]*?-->/g, "")

    // Remove hidden elements (display:none, visibility:hidden, etc.)
    text = text.replace(/<[^>]+(?:display\s*:\s*none|visibility\s*:\s*hidden)[^>]*>[\s\S]*?<\/[^>]+>/gi, "")

    // Convert <br> to newlines
    text = text.replace(/<br\s*\/?>/gi, "\n")

    // Block-level elements get newlines
    text = text.replace(/<\/p>/gi, "\n\n")
    text = text.replace(/<\/div>/gi, "\n")
    text = text.replace(/<\/tr>/gi, "\n")
    text = text.replace(/<\/li>/gi, "\n")
    text = text.replace(/<\/h[1-6]>/gi, "\n\n")
    text = text.replace(/<\/blockquote>/gi, "\n")
    text = text.replace(/<hr\s*\/?>/gi, "\n\u2500\u2500\u2500\n")

    // Table elements: cells get a separator, tables get block newlines
    text = text.replace(/<\/td>/gi, "  ")
    text = text.replace(/<\/th>/gi, "  ")
    text = text.replace(/<\/table>/gi, "\n")

    // List items get a bullet
    text = text.replace(/<li[^>]*>/gi, "  \u2022 ")

    // Links: show text inline, collect URL silently
    text = text.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, content: string) => {
      const linkText = content.replace(/<[^>]+>/g, "").trim()
      const url = decodeHtmlEntities(href.trim())

      // Skip empty/javascript/anchor links — just show the text
      if (!url || url.startsWith("javascript:") || url.startsWith("#")) {
        return linkText || ""
      }

      // Collect the link silently
      const cleanedUrl = cleanUrl(url)
      if (linkText && !isUrlLike(linkText)) {
        // Named link: show link text, collect with label
        links.push({ label: linkText, url: cleanedUrl })
        return linkText
      }

      // URL-only link: collect silently, show nothing inline
      // (the link popup provides access to these)
      try {
        const parsed = new URL(url)
        const domain = parsed.hostname.replace(/^www\./, "")
        links.push({ label: domain, url: cleanedUrl })
        return ""
      } catch {
        links.push({ label: truncateUrl(url, 40), url: cleanedUrl })
        return ""
      }
    })

    // Remove image tags but note alt text if meaningful
    text = text.replace(/<img[^>]*alt=["']([^"']+)["'][^>]*\/?>/gi, (_, alt: string) => {
      const trimmed = alt.trim()
      // Skip generic alt text
      if (!trimmed || /^(image|photo|logo|icon|banner|spacer|pixel|img|\s)$/i.test(trimmed)) return ""
      return trimmed
    })

    // Remove all remaining HTML tags
    text = text.replace(/<[^>]+>/g, "")

    // Decode HTML entities
    text = decodeHtmlEntities(text)

    // Clean up whitespace
    text = text.replace(/[\u00A0\u200B\u200C\u200D\uFEFF]/g, " ")   // non-breaking/zero-width spaces → regular space
    text = text.replace(/[ \t]+/g, " ")          // collapse horizontal whitespace
    text = text.replace(/^ +| +$/gm, "")         // trim each line
    text = text.replace(/\n{3,}/g, "\n\n")        // max 2 consecutive newlines

    text = text.trim()

    return { text, links }
  }

  /**
   * Clean bare URLs from text/plain email body when we have
   * extracted links from the HTML version. Handles:
   * - Standalone lines that are just URLs
   * - URLs in angle brackets: <https://...>
   * - Parenthesized URLs: "Click here (https://...)" — including multi-line
   * - Bare inline URLs within text
   */
  export function cleanTextWithLinks(text: string, links: ExtractedLink[]): string {
    if (links.length === 0) return text

    let result = text

    // 1. Remove parenthesized URLs — these can span multiple lines in text/plain
    //    e.g. "LinkedIn (https://d5kNrC04.na1.hubspotlinks.com/Ctc/DQ+113/...\n...long-url )"
    //    The regex matches "(https://..." followed by any chars (including newlines) up to " )" or ")"
    result = result.replace(/\s*\(\s*https?:\/\/[^\s)][^)]*\)/g, "")

    // 2. Remove angle-bracketed URLs: <https://...>
    result = result.replace(/\s*<\s*https?:\/\/\S+\s*>/g, "")

    // 3. Remove standalone lines that are just a bare URL
    result = result.replace(/^[ \t]*https?:\/\/\S+[ \t]*$/gm, "")

    // 4. Remove inline bare URLs (not in parens/brackets) that remain in text
    //    Only remove if they look like tracking/long URLs (40+ chars) to avoid
    //    removing short meaningful URLs like "visit https://example.com"
    result = result.replace(/https?:\/\/\S{40,}/g, "")

    // Clean up whitespace artifacts
    result = result.replace(/[ \t]+$/gm, "")         // trailing spaces on lines
    result = result.replace(/^ +/gm, (m) => m)       // preserve leading spaces (indentation)
    result = result.replace(/\n{3,}/g, "\n\n")        // max 2 consecutive newlines
    result = result.replace(/[ \t]{2,}/g, " ")        // collapse multiple spaces mid-line

    return result.trim()
  }

  /**
   * Decode common HTML entities.
   */
  function decodeHtmlEntities(text: string): string {
    text = text.replace(/&amp;/g, "&")
    text = text.replace(/&lt;/g, "<")
    text = text.replace(/&gt;/g, ">")
    text = text.replace(/&quot;/g, '"')
    text = text.replace(/&#0?39;/g, "'")
    text = text.replace(/&apos;/g, "'")
    text = text.replace(/&nbsp;/g, " ")
    text = text.replace(/&copy;/gi, "\u00A9")
    text = text.replace(/&mdash;/gi, "\u2014")
    text = text.replace(/&ndash;/gi, "\u2013")
    text = text.replace(/&bull;/gi, "\u2022")
    text = text.replace(/&hellip;/gi, "\u2026")
    text = text.replace(/&laquo;/gi, "\u00AB")
    text = text.replace(/&raquo;/gi, "\u00BB")
    text = text.replace(/&trade;/gi, "\u2122")
    text = text.replace(/&reg;/gi, "\u00AE")
    text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
    text = text.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    text = text.replace(/&[a-zA-Z]+;/g, " ") // remaining unknown entities → space
    return text
  }

  /**
   * Check if a string looks like a URL.
   */
  function isUrlLike(text: string): boolean {
    return /^https?:\/\//i.test(text) || text.includes("www.")
  }

  /**
   * Clean a URL by removing tracking parameters but keeping full path/length.
   */
  function cleanUrl(url: string): string {
    try {
      const parsed = new URL(url)
      const cleanParams = new URLSearchParams()
      let hasCleanParams = false
      for (const [key] of parsed.searchParams) {
        if (/^(utm_|ref|trk|mid|eid|sid|fbclid|gclid|mc_|_hsenc|_hsmi|token|tracking|click|redirect|lipi|lgCta|lgTemp|midToken|midSig|scp|scn|stId)/i.test(key)) {
          continue
        }
        cleanParams.set(key, parsed.searchParams.get(key)!)
        hasCleanParams = true
      }
      const cleanQuery = hasCleanParams ? `?${cleanParams}` : ""
      return `${parsed.origin}${parsed.pathname}${cleanQuery}`
    } catch {
      return url
    }
  }

  /**
   * Truncate a URL for display. Removes tracking parameters and
   * limits total length.
   */
  export function truncateUrl(url: string, maxLen: number = 60): string {
    try {
      const parsed = new URL(url)
      // Strip known tracking params
      const cleanParams = new URLSearchParams()
      let hasCleanParams = false
      for (const [key] of parsed.searchParams) {
        // Skip common tracking parameters
        if (/^(utm_|ref|trk|mid|eid|sid|fbclid|gclid|mc_|_hsenc|_hsmi|token|tracking|click|redirect|lipi|lgCta|lgTemp|midToken|midSig|scp|scn|stId)/i.test(key)) {
          continue
        }
        cleanParams.set(key, parsed.searchParams.get(key)!)
        hasCleanParams = true
      }
      const cleanQuery = hasCleanParams ? `?${cleanParams}` : ""
      const clean = `${parsed.origin}${parsed.pathname}${cleanQuery}`

      if (clean.length <= maxLen) return clean
      // Truncate path, keep domain visible
      const domain = parsed.origin
      const remaining = maxLen - domain.length - 3 // for "..."
      if (remaining <= 0) return domain.slice(0, maxLen - 3) + "..."
      const path = parsed.pathname + cleanQuery
      return domain + path.slice(0, remaining) + "..."
    } catch {
      // Not a valid URL, just truncate
      if (url.length <= maxLen) return url
      return url.slice(0, maxLen - 3) + "..."
    }
  }
}
