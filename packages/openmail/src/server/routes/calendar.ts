import { Hono } from "hono"
import { Cache } from "../../cache/index.js"
import * as schema from "../../cache/schema.js"
import { eq, and, gte, lte, inArray } from "drizzle-orm"

export function calendarRoutes(): Hono {
  const app = new Hono()

  // GET /calendar/events — list events in a date range
  app.get("/events", async (c) => {
    const db = Cache.get()
    const accountId = c.req.query("accountId")
    const startStr = c.req.query("start")
    const endStr = c.req.query("end")

    if (!startStr || !endStr) {
      return c.json({ error: "start and end query params required" }, 400)
    }

    const start = new Date(startStr)
    const end = new Date(endStr)

    let conditions = [
      gte(schema.calEvent.startTime, start),
      lte(schema.calEvent.startTime, end),
    ]
    if (accountId) {
      conditions.push(eq(schema.calEvent.accountId, accountId))
    }

    const events = db.select()
      .from(schema.calEvent)
      .where(and(...conditions))
      .orderBy(schema.calEvent.startTime)
      .all()

    // Batch-fetch linked thread IDs for all events
    const eventIds = events.map((e) => e.id)
    const links = eventIds.length > 0
      ? db.select().from(schema.eventThread).where(inArray(schema.eventThread.eventId, eventIds)).all()
      : []
    const linkMap = new Map<string, string[]>()
    for (const link of links) {
      const arr = linkMap.get(link.eventId)
      if (arr) arr.push(link.threadId)
      else linkMap.set(link.eventId, [link.threadId])
    }

    return c.json({
      items: events.map((e) => ({
        id: e.id,
        calendarId: e.calendarId,
        accountId: e.accountId,
        uid: e.uid,
        summary: e.summary,
        description: e.description,
        location: e.location,
        start: e.startTime,
        end: e.endTime,
        allDay: e.allDay,
        organizer: e.organizer,
        attendees: e.attendees,
        myStatus: e.myStatus,
        recurrence: e.recurrence,
        conferenceUrl: e.conferenceUrl,
        source: e.source,
        linkedThreadIds: linkMap.get(e.id) ?? [],
      })),
    })
  })

  // GET /calendar/calendars — list calendars
  app.get("/calendars", async (c) => {
    const db = Cache.get()
    const accountId = c.req.query("accountId")

    const where = accountId ? eq(schema.calendar.accountId, accountId) : undefined
    const calendars = db.select().from(schema.calendar).where(where).all()

    return c.json({
      items: calendars.map((cal) => ({
        id: cal.id,
        accountId: cal.accountId,
        name: cal.name,
        color: cal.color,
        source: cal.source,
        writable: cal.writable,
      })),
    })
  })

  return app
}
