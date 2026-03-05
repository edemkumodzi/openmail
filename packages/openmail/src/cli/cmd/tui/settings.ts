import { createSignal } from "solid-js"
import { join } from "path"
import { homedir } from "os"
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs"

export interface Settings {
  theme: string
  sidebarWidth: number
  calendarWidth: number
}

const DEFAULTS: Settings = {
  theme: "opencode",
  sidebarWidth: 20,
  calendarWidth: 30,
}

const SIDEBAR_MIN = 14
const SIDEBAR_MAX = 40
const CALENDAR_MIN = 20
const CALENDAR_MAX = 50

export namespace SettingsManager {
  const configDir = join(homedir(), ".openmail")
  const configPath = join(configDir, "settings.json")

  function load(): Settings {
    try {
      if (existsSync(configPath)) {
        const raw = readFileSync(configPath, "utf-8")
        const parsed = JSON.parse(raw)
        return {
          theme: typeof parsed.theme === "string" ? parsed.theme : DEFAULTS.theme,
          sidebarWidth: clampSidebar(parsed.sidebarWidth ?? DEFAULTS.sidebarWidth),
          calendarWidth: clampCalendar(parsed.calendarWidth ?? DEFAULTS.calendarWidth),
        }
      }
    } catch {
      // Fall through to defaults
    }
    return { ...DEFAULTS }
  }

  function save(settings: Settings) {
    try {
      mkdirSync(configDir, { recursive: true })
      writeFileSync(configPath, JSON.stringify(settings, null, 2) + "\n", "utf-8")
    } catch {
      // Silently fail — not critical
    }
  }

  function clampSidebar(v: number): number {
    return Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.round(v)))
  }

  function clampCalendar(v: number): number {
    return Math.max(CALENDAR_MIN, Math.min(CALENDAR_MAX, Math.round(v)))
  }

  // Reactive SolidJS signal
  const [settings, setSettingsRaw] = createSignal<Settings>(load())

  export function get(): Settings {
    return settings()
  }

  export function set(partial: Partial<Settings>) {
    const current = settings()
    const updated: Settings = {
      theme: partial.theme ?? current.theme,
      sidebarWidth: clampSidebar(partial.sidebarWidth ?? current.sidebarWidth),
      calendarWidth: clampCalendar(partial.calendarWidth ?? current.calendarWidth),
    }
    setSettingsRaw(updated)
    save(updated)
  }

  export const limits = {
    sidebar: { min: SIDEBAR_MIN, max: SIDEBAR_MAX },
    calendar: { min: CALENDAR_MIN, max: CALENDAR_MAX },
  }
}
