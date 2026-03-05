import { For, Show } from "solid-js"
import { type Theme } from "../theme.js"

export interface KeyHint {
  key: string
  label: string
}

interface KeybindBarProps {
  theme: Theme
  hints: KeyHint[]
  email?: string
  syncStatus?: "synced" | "syncing" | "error"
}

export function KeybindBar(props: KeybindBarProps) {
  const t = () => props.theme

  const syncColor = () => {
    if (props.syncStatus === "synced") return t().success
    if (props.syncStatus === "syncing") return t().warning
    return t().error
  }

  return (
    <box
      flexDirection="row"
      flexShrink={0}
      height={1}
      justifyContent="space-between"
      paddingLeft={2}
      paddingRight={2}
      gap={2}
    >
      <text fg={t().text} wrapMode="none" overflow="hidden" flexGrow={1}>
        <For each={props.hints}>
          {(hint, i) => (
            <>
              <span style={{ bold: true, fg: t().text }}>{hint.key}</span>
              <span style={{ fg: t().textMuted }}> {hint.label}</span>
              <Show when={i() < props.hints.length - 1}>
                <span style={{ fg: t().textMuted }}>{"  "}</span>
              </Show>
            </>
          )}
        </For>
      </text>
      <text fg={t().textMuted} wrapMode="none" flexShrink={0}>
        <Show when={props.email}>
          <span style={{ fg: t().textMuted }}>{props.email}</span>
        </Show>
        <Show when={props.syncStatus}>
          <span style={{ fg: t().textMuted }}>{"  "}</span>
          <span style={{ fg: syncColor() }}>{"\u2022"}</span>
          <span style={{ fg: t().textMuted }}> {props.syncStatus}</span>
        </Show>
      </text>
    </box>
  )
}
