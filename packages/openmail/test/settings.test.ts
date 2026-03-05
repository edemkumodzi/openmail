import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

// We can't easily test SettingsManager directly because it uses hardcoded
// ~/.openmail path and SolidJS signals (which need the reactive runtime).
// Instead, we test the pure logic: clamping, defaults, JSON parsing.

describe("settings logic", () => {
  const SIDEBAR_MIN = 14
  const SIDEBAR_MAX = 40
  const CALENDAR_MIN = 20
  const CALENDAR_MAX = 50

  function clampSidebar(v: number): number {
    return Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.round(v)))
  }

  function clampCalendar(v: number): number {
    return Math.max(CALENDAR_MIN, Math.min(CALENDAR_MAX, Math.round(v)))
  }

  interface Settings {
    theme: string
    sidebarWidth: number
    calendarWidth: number
  }

  const DEFAULTS: Settings = {
    theme: "opencode",
    sidebarWidth: 20,
    calendarWidth: 30,
  }

  function parseSettings(raw: string): Settings {
    try {
      const parsed = JSON.parse(raw)
      return {
        theme: typeof parsed.theme === "string" ? parsed.theme : DEFAULTS.theme,
        sidebarWidth: clampSidebar(parsed.sidebarWidth ?? DEFAULTS.sidebarWidth),
        calendarWidth: clampCalendar(parsed.calendarWidth ?? DEFAULTS.calendarWidth),
      }
    } catch {
      return { ...DEFAULTS }
    }
  }

  describe("clampSidebar", () => {
    test("clamps below minimum to minimum", () => {
      expect(clampSidebar(5)).toBe(SIDEBAR_MIN)
      expect(clampSidebar(0)).toBe(SIDEBAR_MIN)
      expect(clampSidebar(-10)).toBe(SIDEBAR_MIN)
    })

    test("clamps above maximum to maximum", () => {
      expect(clampSidebar(100)).toBe(SIDEBAR_MAX)
      expect(clampSidebar(50)).toBe(SIDEBAR_MAX)
    })

    test("passes through values in range", () => {
      expect(clampSidebar(20)).toBe(20)
      expect(clampSidebar(14)).toBe(14)
      expect(clampSidebar(40)).toBe(40)
      expect(clampSidebar(30)).toBe(30)
    })

    test("rounds floating point values", () => {
      expect(clampSidebar(20.4)).toBe(20)
      expect(clampSidebar(20.6)).toBe(21)
    })
  })

  describe("clampCalendar", () => {
    test("clamps below minimum to minimum", () => {
      expect(clampCalendar(10)).toBe(CALENDAR_MIN)
      expect(clampCalendar(0)).toBe(CALENDAR_MIN)
    })

    test("clamps above maximum to maximum", () => {
      expect(clampCalendar(60)).toBe(CALENDAR_MAX)
      expect(clampCalendar(100)).toBe(CALENDAR_MAX)
    })

    test("passes through values in range", () => {
      expect(clampCalendar(30)).toBe(30)
      expect(clampCalendar(20)).toBe(20)
      expect(clampCalendar(50)).toBe(50)
    })
  })

  describe("parseSettings", () => {
    test("returns defaults for invalid JSON", () => {
      const result = parseSettings("not json")
      expect(result).toEqual(DEFAULTS)
    })

    test("returns defaults for empty object", () => {
      const result = parseSettings("{}")
      expect(result).toEqual(DEFAULTS)
    })

    test("parses valid settings", () => {
      const result = parseSettings(JSON.stringify({
        theme: "catppuccin",
        sidebarWidth: 25,
        calendarWidth: 35,
      }))
      expect(result.theme).toBe("catppuccin")
      expect(result.sidebarWidth).toBe(25)
      expect(result.calendarWidth).toBe(35)
    })

    test("falls back to default theme for non-string theme", () => {
      const result = parseSettings(JSON.stringify({ theme: 123 }))
      expect(result.theme).toBe("opencode")
    })

    test("clamps out-of-range sidebar width", () => {
      const result = parseSettings(JSON.stringify({ sidebarWidth: 5 }))
      expect(result.sidebarWidth).toBe(SIDEBAR_MIN)
    })

    test("clamps out-of-range calendar width", () => {
      const result = parseSettings(JSON.stringify({ calendarWidth: 100 }))
      expect(result.calendarWidth).toBe(CALENDAR_MAX)
    })

    test("handles partial settings with defaults", () => {
      const result = parseSettings(JSON.stringify({ theme: "gruvbox" }))
      expect(result.theme).toBe("gruvbox")
      expect(result.sidebarWidth).toBe(DEFAULTS.sidebarWidth)
      expect(result.calendarWidth).toBe(DEFAULTS.calendarWidth)
    })
  })

  describe("settings persistence format", () => {
    let testDir: string

    beforeEach(() => {
      testDir = join(tmpdir(), `openmail-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      mkdirSync(testDir, { recursive: true })
    })

    afterEach(() => {
      rmSync(testDir, { recursive: true, force: true })
    })

    test("writes valid JSON", () => {
      const settings: Settings = { theme: "catppuccin", sidebarWidth: 22, calendarWidth: 28 }
      const path = join(testDir, "settings.json")
      writeFileSync(path, JSON.stringify(settings, null, 2) + "\n", "utf-8")

      const raw = readFileSync(path, "utf-8")
      const parsed = JSON.parse(raw)
      expect(parsed.theme).toBe("catppuccin")
      expect(parsed.sidebarWidth).toBe(22)
      expect(parsed.calendarWidth).toBe(28)
    })

    test("round-trips through parse", () => {
      const settings: Settings = { theme: "tokyonight", sidebarWidth: 30, calendarWidth: 40 }
      const serialized = JSON.stringify(settings, null, 2)
      const result = parseSettings(serialized)
      expect(result).toEqual(settings)
    })
  })
})
