/**
 * Google Calendar REST API wrapper.
 *
 * Wraps the googleapis Calendar v3 client with our types and error handling.
 * Mirrors the pattern used by GmailApi for Gmail.
 */
import { google, type calendar_v3 } from "googleapis"
import { OAuth2Client } from "google-auth-library"
import { CredentialStore } from "../../auth/store.js"
import { OAuth } from "../../auth/oauth.js"

export namespace CalendarApi {
  export interface Config {
    accountId: string
    clientId: string
    clientSecret: string
  }

  interface CalendarClient {
    calendar: calendar_v3.Calendar
    oauth2Client: OAuth2Client
    accountId: string
  }

  /**
   * Create an authenticated Google Calendar API client.
   * Reuses the same credential store and token refresh as Gmail.
   */
  export function createClient(config: Config): CalendarClient {
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

    const calendar = google.calendar({ version: "v3", auth: oauth2Client })

    return { calendar, oauth2Client, accountId: config.accountId }
  }

  /**
   * List all calendars the user has access to.
   */
  export async function listCalendars(
    client: CalendarClient
  ): Promise<calendar_v3.Schema$CalendarListEntry[]> {
    const entries: calendar_v3.Schema$CalendarListEntry[] = []
    let pageToken: string | undefined

    do {
      const res = await client.calendar.calendarList.list({
        maxResults: 100,
        pageToken,
      })
      entries.push(...(res.data.items ?? []))
      pageToken = res.data.nextPageToken ?? undefined
    } while (pageToken)

    return entries
  }

  /**
   * List events in a calendar within a time range.
   */
  export async function listEvents(
    client: CalendarClient,
    calendarId: string,
    opts: {
      timeMin: Date
      timeMax: Date
      maxResults?: number
      syncToken?: string
    }
  ): Promise<{
    events: calendar_v3.Schema$Event[]
    nextSyncToken?: string
  }> {
    const events: calendar_v3.Schema$Event[] = []
    let pageToken: string | undefined

    do {
      const params: calendar_v3.Params$Resource$Events$List = {
        calendarId,
        maxResults: opts.maxResults ?? 250,
        singleEvents: true, // Expand recurring events
        orderBy: "startTime",
        pageToken,
      }

      // syncToken and timeMin/timeMax are mutually exclusive in Google Calendar API
      if (opts.syncToken) {
        params.syncToken = opts.syncToken
      } else {
        params.timeMin = opts.timeMin.toISOString()
        params.timeMax = opts.timeMax.toISOString()
      }

      const res = await client.calendar.events.list(params)
      events.push(...(res.data.items ?? []))
      pageToken = res.data.nextPageToken ?? undefined

      if (!pageToken && res.data.nextSyncToken) {
        return { events, nextSyncToken: res.data.nextSyncToken }
      }
    } while (pageToken)

    return { events }
  }

  /**
   * Get a single event by ID.
   */
  export async function getEvent(
    client: CalendarClient,
    calendarId: string,
    eventId: string
  ): Promise<calendar_v3.Schema$Event> {
    const res = await client.calendar.events.get({
      calendarId,
      eventId,
    })
    return res.data
  }
}
