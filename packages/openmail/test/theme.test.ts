import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import {
  resolveTheme,
  selectedForeground,
  tint,
  DEFAULT_THEMES,
  THEME_NAMES,
  type ThemeJson,
  type Theme,
} from "../src/cli/cmd/tui/theme.js"

describe("resolveTheme", () => {
  test("resolves opencode dark theme with all core keys", () => {
    const theme = resolveTheme(DEFAULT_THEMES.opencode!, "dark")

    // Every core color should be an RGBA instance
    expect(theme.primary).toBeInstanceOf(RGBA)
    expect(theme.secondary).toBeInstanceOf(RGBA)
    expect(theme.accent).toBeInstanceOf(RGBA)
    expect(theme.error).toBeInstanceOf(RGBA)
    expect(theme.warning).toBeInstanceOf(RGBA)
    expect(theme.success).toBeInstanceOf(RGBA)
    expect(theme.info).toBeInstanceOf(RGBA)
    expect(theme.text).toBeInstanceOf(RGBA)
    expect(theme.textMuted).toBeInstanceOf(RGBA)
    expect(theme.background).toBeInstanceOf(RGBA)
    expect(theme.backgroundPanel).toBeInstanceOf(RGBA)
    expect(theme.backgroundElement).toBeInstanceOf(RGBA)
    expect(theme.border).toBeInstanceOf(RGBA)
    expect(theme.borderActive).toBeInstanceOf(RGBA)
    expect(theme.borderSubtle).toBeInstanceOf(RGBA)
  })

  test("resolves opencode dark background to #0a0a0a", () => {
    const theme = resolveTheme(DEFAULT_THEMES.opencode!, "dark")
    // darkStep1 = #0a0a0a → rgb(10, 10, 10)
    expect(Math.round(theme.background.r * 255)).toBe(10)
    expect(Math.round(theme.background.g * 255)).toBe(10)
    expect(Math.round(theme.background.b * 255)).toBe(10)
  })

  test("resolves opencode light background to #ffffff", () => {
    const theme = resolveTheme(DEFAULT_THEMES.opencode!, "light")
    // lightStep1 = #ffffff → rgb(255, 255, 255)
    expect(Math.round(theme.background.r * 255)).toBe(255)
    expect(Math.round(theme.background.g * 255)).toBe(255)
    expect(Math.round(theme.background.b * 255)).toBe(255)
  })

  test("resolves defs references correctly", () => {
    const json: ThemeJson = {
      defs: { myRed: "#ff0000" },
      theme: {
        primary: { dark: "myRed", light: "myRed" },
        secondary: { dark: "#00ff00", light: "#00ff00" },
        accent: { dark: "#0000ff", light: "#0000ff" },
        error: { dark: "#ff0000", light: "#ff0000" },
        warning: { dark: "#ffff00", light: "#ffff00" },
        success: { dark: "#00ff00", light: "#00ff00" },
        info: { dark: "#00ffff", light: "#00ffff" },
        text: { dark: "#ffffff", light: "#000000" },
        textMuted: { dark: "#808080", light: "#808080" },
        background: { dark: "#000000", light: "#ffffff" },
        backgroundPanel: { dark: "#111111", light: "#eeeeee" },
        backgroundElement: { dark: "#222222", light: "#dddddd" },
        border: { dark: "#333333", light: "#cccccc" },
        borderActive: { dark: "#444444", light: "#bbbbbb" },
        borderSubtle: { dark: "#555555", light: "#aaaaaa" },
      },
    }
    const theme = resolveTheme(json, "dark")
    // primary should resolve "myRed" → #ff0000
    expect(Math.round(theme.primary.r * 255)).toBe(255)
    expect(Math.round(theme.primary.g * 255)).toBe(0)
    expect(Math.round(theme.primary.b * 255)).toBe(0)
  })

  test("resolves direct hex values", () => {
    const json: ThemeJson = {
      theme: {
        primary: { dark: "#abcdef", light: "#abcdef" },
        secondary: { dark: "#000000", light: "#000000" },
        accent: { dark: "#000000", light: "#000000" },
        error: { dark: "#000000", light: "#000000" },
        warning: { dark: "#000000", light: "#000000" },
        success: { dark: "#000000", light: "#000000" },
        info: { dark: "#000000", light: "#000000" },
        text: { dark: "#ffffff", light: "#000000" },
        textMuted: { dark: "#808080", light: "#808080" },
        background: { dark: "#000000", light: "#ffffff" },
        backgroundPanel: { dark: "#111111", light: "#eeeeee" },
        backgroundElement: { dark: "#222222", light: "#dddddd" },
        border: { dark: "#333333", light: "#cccccc" },
        borderActive: { dark: "#444444", light: "#bbbbbb" },
        borderSubtle: { dark: "#555555", light: "#aaaaaa" },
      },
    }
    const theme = resolveTheme(json, "dark")
    expect(Math.round(theme.primary.r * 255)).toBe(0xab)
    expect(Math.round(theme.primary.g * 255)).toBe(0xcd)
    expect(Math.round(theme.primary.b * 255)).toBe(0xef)
  })

  test("throws on unknown color reference", () => {
    const json: ThemeJson = {
      theme: {
        primary: { dark: "nonexistent", light: "nonexistent" },
        secondary: { dark: "#000000", light: "#000000" },
        accent: { dark: "#000000", light: "#000000" },
        error: { dark: "#000000", light: "#000000" },
        warning: { dark: "#000000", light: "#000000" },
        success: { dark: "#000000", light: "#000000" },
        info: { dark: "#000000", light: "#000000" },
        text: { dark: "#ffffff", light: "#000000" },
        textMuted: { dark: "#808080", light: "#808080" },
        background: { dark: "#000000", light: "#ffffff" },
        backgroundPanel: { dark: "#111111", light: "#eeeeee" },
        backgroundElement: { dark: "#222222", light: "#dddddd" },
        border: { dark: "#333333", light: "#cccccc" },
        borderActive: { dark: "#444444", light: "#bbbbbb" },
        borderSubtle: { dark: "#555555", light: "#aaaaaa" },
      },
    }
    expect(() => resolveTheme(json, "dark")).toThrow('Color reference "nonexistent" not found')
  })

  test("selectedListItemText defaults to background when not specified", () => {
    const theme = resolveTheme(DEFAULT_THEMES.opencode!, "dark")
    expect(theme._hasSelectedListItemText).toBe(false)
    // Should fall back to background color
    expect(theme.selectedListItemText.r).toBe(theme.background.r)
    expect(theme.selectedListItemText.g).toBe(theme.background.g)
    expect(theme.selectedListItemText.b).toBe(theme.background.b)
  })

  test("backgroundMenu defaults to backgroundElement when not specified", () => {
    const theme = resolveTheme(DEFAULT_THEMES.opencode!, "dark")
    expect(theme.backgroundMenu.r).toBe(theme.backgroundElement.r)
    expect(theme.backgroundMenu.g).toBe(theme.backgroundElement.g)
    expect(theme.backgroundMenu.b).toBe(theme.backgroundElement.b)
  })
})

describe("all bundled themes resolve without error", () => {
  for (const [name, json] of Object.entries(DEFAULT_THEMES)) {
    test(`${name} resolves in dark mode`, () => {
      const theme = resolveTheme(json, "dark")
      expect(theme.primary).toBeInstanceOf(RGBA)
      expect(theme.background).toBeInstanceOf(RGBA)
      expect(theme.text).toBeInstanceOf(RGBA)
    })

    test(`${name} resolves in light mode`, () => {
      const theme = resolveTheme(json, "light")
      expect(theme.primary).toBeInstanceOf(RGBA)
      expect(theme.background).toBeInstanceOf(RGBA)
      expect(theme.text).toBeInstanceOf(RGBA)
    })

    test(`${name} has a display name`, () => {
      expect(THEME_NAMES[name]).toBeDefined()
      expect(typeof THEME_NAMES[name]).toBe("string")
    })
  }
})

describe("bundled themes produce visually distinct colors", () => {
  const themes: Record<string, Theme> = {}
  for (const [name, json] of Object.entries(DEFAULT_THEMES)) {
    themes[name] = resolveTheme(json, "dark")
  }

  test("dark backgrounds differ across themes", () => {
    const bgs = Object.values(themes).map((t) => Math.round(t.background.r * 255))
    const unique = new Set(bgs)
    // At least 3 distinct background red values across 4 themes
    expect(unique.size).toBeGreaterThanOrEqual(3)
  })

  test("primaries differ across themes", () => {
    const primaries = Object.values(themes).map((t) =>
      `${Math.round(t.primary.r * 255)},${Math.round(t.primary.g * 255)},${Math.round(t.primary.b * 255)}`
    )
    const unique = new Set(primaries)
    expect(unique.size).toBe(Object.keys(themes).length)
  })
})

describe("selectedForeground", () => {
  test("returns background color when theme has opaque background", () => {
    const theme = resolveTheme(DEFAULT_THEMES.opencode!, "dark")
    const fg = selectedForeground(theme)
    expect(fg.r).toBe(theme.background.r)
    expect(fg.g).toBe(theme.background.g)
    expect(fg.b).toBe(theme.background.b)
  })

  test("returns selectedListItemText when theme specifies it", () => {
    const json: ThemeJson = {
      theme: {
        primary: { dark: "#ff0000", light: "#ff0000" },
        secondary: { dark: "#000000", light: "#000000" },
        accent: { dark: "#000000", light: "#000000" },
        error: { dark: "#000000", light: "#000000" },
        warning: { dark: "#000000", light: "#000000" },
        success: { dark: "#000000", light: "#000000" },
        info: { dark: "#000000", light: "#000000" },
        text: { dark: "#ffffff", light: "#000000" },
        textMuted: { dark: "#808080", light: "#808080" },
        background: { dark: "#000000", light: "#ffffff" },
        backgroundPanel: { dark: "#111111", light: "#eeeeee" },
        backgroundElement: { dark: "#222222", light: "#dddddd" },
        border: { dark: "#333333", light: "#cccccc" },
        borderActive: { dark: "#444444", light: "#bbbbbb" },
        borderSubtle: { dark: "#555555", light: "#aaaaaa" },
        selectedListItemText: { dark: "#00ff00", light: "#00ff00" },
      },
    }
    const theme = resolveTheme(json, "dark")
    expect(theme._hasSelectedListItemText).toBe(true)
    const fg = selectedForeground(theme)
    expect(Math.round(fg.r * 255)).toBe(0)
    expect(Math.round(fg.g * 255)).toBe(255)
    expect(Math.round(fg.b * 255)).toBe(0)
  })
})

describe("tint", () => {
  test("alpha 0 returns base color", () => {
    const base = RGBA.fromInts(100, 100, 100)
    const overlay = RGBA.fromInts(200, 200, 200)
    const result = tint(base, overlay, 0)
    expect(Math.round(result.r * 255)).toBe(100)
    expect(Math.round(result.g * 255)).toBe(100)
    expect(Math.round(result.b * 255)).toBe(100)
  })

  test("alpha 1 returns overlay color", () => {
    const base = RGBA.fromInts(100, 100, 100)
    const overlay = RGBA.fromInts(200, 200, 200)
    const result = tint(base, overlay, 1)
    expect(Math.round(result.r * 255)).toBe(200)
    expect(Math.round(result.g * 255)).toBe(200)
    expect(Math.round(result.b * 255)).toBe(200)
  })

  test("alpha 0.5 returns midpoint", () => {
    const base = RGBA.fromInts(0, 0, 0)
    const overlay = RGBA.fromInts(200, 100, 50)
    const result = tint(base, overlay, 0.5)
    expect(Math.round(result.r * 255)).toBe(100)
    expect(Math.round(result.g * 255)).toBe(50)
    expect(Math.round(result.b * 255)).toBe(25)
  })
})
