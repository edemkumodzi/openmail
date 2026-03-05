import { describe, expect, test } from "bun:test"
import {
  formatRelativeTime,
  formatTime,
  formatDuration,
  formatFileSize,
  formatDayLabel,
  truncate,
  groupEventsByDay,
} from "../src/cli/cmd/tui/util.js"
import { searchThreads } from "../src/cli/cmd/tui/component/search.js"
import { nextField, prevField, COMPOSE_FIELDS } from "../src/cli/cmd/tui/component/compose.js"
import { MockData } from "../src/mail/mock.js"

describe("formatRelativeTime", () => {
  const now = new Date()
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000)
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000)
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000)
  const minutesFromNow = (m: number) => new Date(now.getTime() + m * 60_000)
  const hoursFromNow = (h: number) => new Date(now.getTime() + h * 3_600_000)

  test("shows 'now' for very recent times", () => {
    expect(formatRelativeTime(now)).toBe("now")
  })

  test("shows minutes for times under an hour ago", () => {
    expect(formatRelativeTime(minutesAgo(5))).toBe("5m")
    expect(formatRelativeTime(minutesAgo(30))).toBe("30m")
    expect(formatRelativeTime(minutesAgo(59))).toBe("59m")
  })

  test("shows hours for times under a day ago", () => {
    expect(formatRelativeTime(hoursAgo(1))).toBe("1h")
    expect(formatRelativeTime(hoursAgo(12))).toBe("12h")
    expect(formatRelativeTime(hoursAgo(23))).toBe("23h")
  })

  test("shows days for times under a week ago", () => {
    expect(formatRelativeTime(daysAgo(1))).toBe("1d")
    expect(formatRelativeTime(daysAgo(6))).toBe("6d")
  })

  test("shows date for times over a week ago", () => {
    const result = formatRelativeTime(daysAgo(10))
    // Should be a date string like "Feb 23"
    expect(result).toMatch(/[A-Z][a-z]{2} \d{1,2}/)
  })

  test("shows future times with 'in' prefix", () => {
    const result = formatRelativeTime(minutesFromNow(30))
    expect(result).toBe("in 30m")
  })

  test("shows future hours", () => {
    const result = formatRelativeTime(hoursFromNow(2))
    expect(result).toBe("in 2h")
  })
})

describe("formatTime", () => {
  test("formats morning time", () => {
    const date = new Date(2026, 2, 5, 9, 30)
    const result = formatTime(date)
    expect(result).toMatch(/9:30\s*AM/)
  })

  test("formats afternoon time", () => {
    const date = new Date(2026, 2, 5, 14, 0)
    const result = formatTime(date)
    expect(result).toMatch(/2:00\s*PM/)
  })

  test("formats midnight", () => {
    const date = new Date(2026, 2, 5, 0, 0)
    const result = formatTime(date)
    expect(result).toMatch(/12:00\s*AM/)
  })
})

describe("formatDuration", () => {
  const base = new Date(2026, 2, 5, 10, 0)

  test("shows minutes for durations under an hour", () => {
    expect(formatDuration(base, new Date(base.getTime() + 30 * 60_000))).toBe("30m")
    expect(formatDuration(base, new Date(base.getTime() + 45 * 60_000))).toBe("45m")
  })

  test("shows hours for even hour durations", () => {
    expect(formatDuration(base, new Date(base.getTime() + 60 * 60_000))).toBe("1h")
    expect(formatDuration(base, new Date(base.getTime() + 120 * 60_000))).toBe("2h")
  })

  test("shows hours and minutes for mixed durations", () => {
    expect(formatDuration(base, new Date(base.getTime() + 90 * 60_000))).toBe("1h30m")
    expect(formatDuration(base, new Date(base.getTime() + 150 * 60_000))).toBe("2h30m")
  })
})

describe("formatFileSize", () => {
  test("shows bytes for small files", () => {
    expect(formatFileSize(0)).toBe("0 B")
    expect(formatFileSize(512)).toBe("512 B")
    expect(formatFileSize(1023)).toBe("1023 B")
  })

  test("shows KB for kilobyte-range files", () => {
    expect(formatFileSize(1024)).toBe("1.0 KB")
    expect(formatFileSize(1536)).toBe("1.5 KB")
    expect(formatFileSize(10240)).toBe("10.0 KB")
  })

  test("shows MB for megabyte-range files", () => {
    expect(formatFileSize(1_048_576)).toBe("1.0 MB")
    expect(formatFileSize(2_200_000)).toBe("2.1 MB")
    expect(formatFileSize(10_485_760)).toBe("10.0 MB")
  })
})

describe("formatDayLabel", () => {
  test("shows 'Today' for today's date", () => {
    expect(formatDayLabel(new Date())).toBe("Today")
  })

  test("shows 'Tomorrow' for tomorrow's date", () => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    expect(formatDayLabel(tomorrow)).toBe("Tomorrow")
  })

  test("shows 'Yesterday' for yesterday's date", () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    expect(formatDayLabel(yesterday)).toBe("Yesterday")
  })

  test("shows weekday name for days 2-6 in the future", () => {
    const date = new Date()
    date.setDate(date.getDate() + 3)
    const result = formatDayLabel(date)
    const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    expect(weekdays).toContain(result)
  })

  test("shows abbreviated date for dates far in the future", () => {
    const date = new Date()
    date.setDate(date.getDate() + 14)
    const result = formatDayLabel(date)
    // Should be like "Mon, Mar 19" or similar
    expect(result).toMatch(/[A-Z][a-z]{2}/)
  })
})

describe("truncate", () => {
  test("returns string as-is if under max length", () => {
    expect(truncate("hello", 10)).toBe("hello")
    expect(truncate("abc", 3)).toBe("abc")
  })

  test("truncates with ellipsis when over max length", () => {
    expect(truncate("hello world", 5)).toBe("hell\u2026")
    expect(truncate("abcdef", 4)).toBe("abc\u2026")
  })

  test("handles empty string", () => {
    expect(truncate("", 5)).toBe("")
  })

  test("handles max length of 1", () => {
    expect(truncate("abc", 1)).toBe("\u2026")
  })

  test("handles exact length", () => {
    expect(truncate("abc", 3)).toBe("abc")
  })
})

describe("groupEventsByDay", () => {
  test("groups events on the same day together", () => {
    const date = new Date(2026, 2, 5)
    const events = [
      { start: new Date(2026, 2, 5, 9, 0) },
      { start: new Date(2026, 2, 5, 14, 0) },
      { start: new Date(2026, 2, 6, 10, 0) },
    ]
    const groups = groupEventsByDay(events)
    expect(groups.size).toBe(2)

    const day1Key = new Date(2026, 2, 5, 9, 0).toDateString()
    const day2Key = new Date(2026, 2, 6, 10, 0).toDateString()
    expect(groups.get(day1Key)!.length).toBe(2)
    expect(groups.get(day2Key)!.length).toBe(1)
  })

  test("returns empty map for empty array", () => {
    const groups = groupEventsByDay([])
    expect(groups.size).toBe(0)
  })

  test("handles single event", () => {
    const events = [{ start: new Date(2026, 2, 5, 9, 0) }]
    const groups = groupEventsByDay(events)
    expect(groups.size).toBe(1)
  })
})

describe("searchThreads", () => {
  test("returns empty array for empty query", () => {
    expect(searchThreads(MockData.threads, "")).toEqual([])
    expect(searchThreads(MockData.threads, "   ")).toEqual([])
  })

  test("matches by subject", () => {
    const results = searchThreads(MockData.threads, "Quarterly planning")
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((t) => t.subject.toLowerCase().includes("quarterly planning"))).toBe(true)
  })

  test("matches by participant name", () => {
    const results = searchThreads(MockData.threads, "Sarah")
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((t) => t.participants.some((p) => p.name.toLowerCase().includes("sarah")))).toBe(true)
  })

  test("matches by snippet", () => {
    const results = searchThreads(MockData.threads, "attached")
    expect(results.length).toBeGreaterThan(0)
  })

  test("is case insensitive", () => {
    const lower = searchThreads(MockData.threads, "github")
    const upper = searchThreads(MockData.threads, "GitHub")
    const mixed = searchThreads(MockData.threads, "gitHub")
    expect(lower.length).toBe(upper.length)
    expect(lower.length).toBe(mixed.length)
    expect(lower.map((t) => t.id)).toEqual(upper.map((t) => t.id))
  })

  test("returns no results for non-matching query", () => {
    const results = searchThreads(MockData.threads, "xyznonexistent123")
    expect(results.length).toBe(0)
  })

  test("matches partial strings", () => {
    const results = searchThreads(MockData.threads, "Plan")
    expect(results.length).toBeGreaterThan(0)
  })

  test("preserves original thread objects", () => {
    const results = searchThreads(MockData.threads, "Sarah")
    for (const r of results) {
      expect(MockData.threads).toContain(r)
    }
  })
})

describe("compose field navigation", () => {
  test("COMPOSE_FIELDS has correct order", () => {
    expect(COMPOSE_FIELDS).toEqual(["to", "subject", "body"])
  })

  test("nextField advances through fields", () => {
    expect(nextField("to")).toBe("subject")
    expect(nextField("subject")).toBe("body")
  })

  test("nextField clamps at last field", () => {
    expect(nextField("body")).toBe("body")
  })

  test("prevField goes back through fields", () => {
    expect(prevField("body")).toBe("subject")
    expect(prevField("subject")).toBe("to")
  })

  test("prevField clamps at first field", () => {
    expect(prevField("to")).toBe("to")
  })
})
