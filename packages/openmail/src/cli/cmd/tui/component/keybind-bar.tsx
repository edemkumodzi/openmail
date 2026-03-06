import { For } from "solid-js"
import { type Theme } from "../theme.js"

export interface KeyHint {
  key: string
  label: string
}

interface KeybindBarProps {
  theme: Theme
  hints: KeyHint[]
}

export function KeybindBar(props: KeybindBarProps) {
  const t = () => props.theme

  return (
    <box
      flexDirection="row"
      flexShrink={0}
      height={1}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={t().backgroundElement}
    >
      <box flexDirection="row" flexGrow={1} gap={1} overflow="hidden">
        <For each={props.hints}>
          {(hint) => (
            <box flexDirection="row" flexShrink={0}>
              <box backgroundColor={t().borderSubtle} paddingLeft={1} paddingRight={1}>
                <text fg={t().text} wrapMode="none">{hint.key}</text>
              </box>
              <text fg={t().textMuted} wrapMode="none"> {hint.label}</text>
            </box>
          )}
        </For>
      </box>
    </box>
  )
}
