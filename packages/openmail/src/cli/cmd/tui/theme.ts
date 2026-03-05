import { RGBA } from "@opentui/core"

// OpenCode-compatible theme type
// We support all the core UI colors from OpenCode themes.
// Markdown/diff/syntax colors are omitted for now but can be added later.
export type ThemeColors = {
  primary: RGBA
  secondary: RGBA
  accent: RGBA
  error: RGBA
  warning: RGBA
  success: RGBA
  info: RGBA
  text: RGBA
  textMuted: RGBA
  selectedListItemText: RGBA
  background: RGBA
  backgroundPanel: RGBA
  backgroundElement: RGBA
  backgroundMenu: RGBA
  border: RGBA
  borderActive: RGBA
  borderSubtle: RGBA
}

export type Theme = ThemeColors & {
  _hasSelectedListItemText: boolean
}

type HexColor = `#${string}`
type RefName = string
type Variant = { dark: HexColor | RefName; light: HexColor | RefName }
type ColorValue = HexColor | RefName | Variant

export type ThemeJson = {
  $schema?: string
  defs?: Record<string, HexColor | RefName>
  theme: Record<string, ColorValue>
}

// --- Built-in themes (OpenCode-compatible JSON format) ---

import opencodeTheme from "./theme/opencode.json" with { type: "json" }
import catppuccinTheme from "./theme/catppuccin.json" with { type: "json" }
import gruvboxTheme from "./theme/gruvbox.json" with { type: "json" }
import tokyonightTheme from "./theme/tokyonight.json" with { type: "json" }

export const DEFAULT_THEMES: Record<string, ThemeJson> = {
  opencode: opencodeTheme,
  catppuccin: catppuccinTheme,
  gruvbox: gruvboxTheme,
  tokyonight: tokyonightTheme,
}

export const THEME_NAMES: Record<string, string> = {
  opencode: "OpenCode",
  catppuccin: "Catppuccin",
  gruvbox: "Gruvbox",
  tokyonight: "Tokyo Night",
}

// --- Theme resolution ---

export function resolveTheme(json: ThemeJson, mode: "dark" | "light"): Theme {
  const defs = json.defs ?? {}

  function resolveColor(c: ColorValue): RGBA {
    if (typeof c === "string") {
      if (c === "transparent" || c === "none") return RGBA.fromInts(0, 0, 0, 0)
      if (c.startsWith("#")) return RGBA.fromHex(c)
      if (defs[c] != null) return resolveColor(defs[c] as ColorValue)
      if (json.theme[c] !== undefined) return resolveColor(json.theme[c] as ColorValue)
      throw new Error(`Color reference "${c}" not found in defs or theme`)
    }
    return resolveColor(c[mode])
  }

  const coreKeys: (keyof ThemeColors)[] = [
    "primary",
    "secondary",
    "accent",
    "error",
    "warning",
    "success",
    "info",
    "text",
    "textMuted",
    "background",
    "backgroundPanel",
    "backgroundElement",
    "border",
    "borderActive",
    "borderSubtle",
  ]

  const resolved: Partial<ThemeColors> = {}
  for (const key of coreKeys) {
    if (json.theme[key] !== undefined) {
      resolved[key] = resolveColor(json.theme[key] as ColorValue)
    }
  }

  // Optional fields with fallbacks
  const hasSelectedListItemText = json.theme.selectedListItemText !== undefined
  resolved.selectedListItemText = hasSelectedListItemText
    ? resolveColor(json.theme.selectedListItemText as ColorValue)
    : resolved.background

  resolved.backgroundMenu =
    json.theme.backgroundMenu !== undefined
      ? resolveColor(json.theme.backgroundMenu as ColorValue)
      : resolved.backgroundElement

  return {
    ...resolved,
    _hasSelectedListItemText: hasSelectedListItemText,
  } as Theme
}

// --- Utilities ---

export function selectedForeground(theme: Theme, bg?: RGBA): RGBA {
  if (theme._hasSelectedListItemText) return theme.selectedListItemText
  if (theme.background.a === 0) {
    const target = bg ?? theme.primary
    const luminance = 0.299 * target.r + 0.587 * target.g + 0.114 * target.b
    return luminance > 0.5 ? RGBA.fromInts(0, 0, 0) : RGBA.fromInts(255, 255, 255)
  }
  return theme.background
}

export function tint(base: RGBA, overlay: RGBA, alpha: number): RGBA {
  const r = base.r + (overlay.r - base.r) * alpha
  const g = base.g + (overlay.g - base.g) * alpha
  const b = base.b + (overlay.b - base.b) * alpha
  return RGBA.fromInts(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255))
}

// --- Reactive theme (reads from SettingsManager) ---

import { createMemo } from "solid-js"
import { SettingsManager } from "./settings.js"

export function createTheme(): () => Theme {
  return createMemo(() => {
    const settings = SettingsManager.get()
    const themeJson = DEFAULT_THEMES[settings.theme] ?? DEFAULT_THEMES.opencode!
    return resolveTheme(themeJson, "dark")
  })
}

// Legacy compat — non-reactive, returns once
export function getTheme(): Theme {
  return resolveTheme(DEFAULT_THEMES.opencode!, "dark")
}
