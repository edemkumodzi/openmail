import { For, Show, createMemo } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { type Theme, DEFAULT_THEMES, THEME_NAMES } from "../theme.js"
import { SettingsManager, type Settings } from "../settings.js"
import { EmptyBorder } from "./border.js"

export interface SettingItem {
  key: keyof Settings
  label: string
  description: string
  type: "select" | "number"
  options?: { value: string; label: string }[]
  min?: number
  max?: number
  step?: number
  suffix?: string
}

export function getSettingItems(): SettingItem[] {
  const themeOptions = Object.keys(DEFAULT_THEMES).map((id) => ({
    value: id,
    label: THEME_NAMES[id] ?? id,
  }))

  return [
    {
      key: "theme",
      label: "Theme",
      description: "Color theme for the interface",
      type: "select",
      options: themeOptions,
    },
    {
      key: "sidebarWidth",
      label: "Sidebar width",
      description: "Width of the folder sidebar in columns",
      type: "number",
      min: SettingsManager.limits.sidebar.min,
      max: SettingsManager.limits.sidebar.max,
      step: 2,
      suffix: " cols",
    },
    {
      key: "calendarWidth",
      label: "Calendar width",
      description: "Width of the calendar sidebar in columns",
      type: "number",
      min: SettingsManager.limits.calendar.min,
      max: SettingsManager.limits.calendar.max,
      step: 2,
      suffix: " cols",
    },
  ]
}

export function cycleSettingValue(item: SettingItem, direction: 1 | -1): Settings {
  const settings = SettingsManager.get()
  if (item.type === "select" && item.options) {
    const currentIdx = item.options.findIndex((o) => o.value === String(settings[item.key]))
    const nextIdx = (currentIdx + direction + item.options.length) % item.options.length
    const newVal = item.options[nextIdx]!.value
    SettingsManager.set({ [item.key]: newVal })
  } else if (item.type === "number") {
    const current = settings[item.key] as number
    const step = item.step ?? 1
    const next = Math.max(item.min ?? 0, Math.min(item.max ?? 100, current + step * direction))
    SettingsManager.set({ [item.key]: next })
  }
  return SettingsManager.get()
}

interface SettingsViewProps {
  theme: Theme
  width: number
  height: number
  selectedIndex: number
}

export function SettingsView(props: SettingsViewProps) {
  const t = () => props.theme

  const items = createMemo(() => getSettingItems())

  const currentValue = (item: SettingItem): string => {
    const settings = SettingsManager.get()
    const val = settings[item.key]
    if (item.type === "select" && item.options) {
      const opt = item.options.find((o) => o.value === String(val))
      return opt?.label ?? String(val)
    }
    return String(val) + (item.suffix ?? "")
  }

  const panelWidth = () => Math.min(50, props.width - 4)
  const panelHeight = () => Math.min(items().length * 3 + 6, props.height - 4)
  const panelLeft = () => Math.floor((props.width - panelWidth()) / 2)
  const panelTop = () => Math.floor((props.height - panelHeight()) / 2)

  return (
    <box
      width={props.width}
      height={props.height}
      position="absolute"
      left={0}
      top={0}
    >
      {/* Full-screen background */}
      <box
        width={props.width}
        height={props.height}
        backgroundColor={t().background}
      />

      {/* Settings panel */}
      <box
        position="absolute"
        left={panelLeft()}
        top={panelTop()}
        width={panelWidth()}
        height={panelHeight()}
        flexDirection="column"
        backgroundColor={t().backgroundPanel}
        paddingTop={1}
        paddingBottom={1}
      >
        {/* Title */}
        <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
          <text fg={t().text} attributes={TextAttributes.BOLD}>Settings</text>
        </box>

        {/* Items */}
        <For each={items()}>
          {(item, index) => {
            const isSelected = () => index() === props.selectedIndex
            return (
              <box
                flexDirection="column"
                paddingLeft={1}
                paddingRight={2}
                paddingTop={0}
                paddingBottom={1}
                border={["left"]}
                customBorderChars={{ ...EmptyBorder, vertical: "\u2503" }}
                borderColor={isSelected() ? t().primary : t().backgroundPanel}
                backgroundColor={isSelected() ? t().backgroundElement : undefined}
              >
                <box flexDirection="row" justifyContent="space-between" gap={2}>
                  <text
                    fg={isSelected() ? t().text : t().textMuted}
                    attributes={isSelected() ? TextAttributes.BOLD : 0}
                    wrapMode="none"
                    overflow="hidden"
                  >
                    {item.label}
                  </text>
                  <text flexShrink={0} wrapMode="none">
                    <Show when={isSelected()}>
                      <span style={{ fg: t().textMuted }}>{"\u2190"} </span>
                    </Show>
                    <span style={{ fg: isSelected() ? t().primary : t().text, bold: isSelected() }}>
                      {currentValue(item)}
                    </span>
                    <Show when={isSelected()}>
                      <span style={{ fg: t().textMuted }}> {"\u2192"}</span>
                    </Show>
                  </text>
                </box>
                <text fg={t().textMuted}>{item.description}</text>
              </box>
            )
          }}
        </For>

        {/* Hints */}
        <box paddingLeft={2} paddingRight={2} paddingTop={1}>
          <text fg={t().text} wrapMode="none">
            <span style={{ bold: true, fg: t().text }}>j/k</span>
            <span style={{ fg: t().textMuted }}> navigate  </span>
            <span style={{ bold: true, fg: t().text }}>h/l</span>
            <span style={{ fg: t().textMuted }}> adjust  </span>
            <span style={{ bold: true, fg: t().text }}>esc</span>
            <span style={{ fg: t().textMuted }}> close</span>
          </text>
        </box>
      </box>
    </box>
  )
}
