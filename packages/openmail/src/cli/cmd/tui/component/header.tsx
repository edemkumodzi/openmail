import { Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { type Theme } from "../theme.js"
import { EmptyBorder } from "./border.js"

interface HeaderProps {
  theme: Theme
  email: string
  unreadCount: number
  syncStatus: "synced" | "syncing" | "error"
}

export function Header(props: HeaderProps) {
  const t = () => props.theme

  const syncColor = () => {
    if (props.syncStatus === "synced") return t().success
    if (props.syncStatus === "syncing") return t().warning
    return t().error
  }

  return (
    <box
      flexShrink={0}
      flexDirection="row"
      justifyContent="space-between"
      gap={1}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      backgroundColor={t().backgroundPanel}
      border={["left"]}
      customBorderChars={{ ...EmptyBorder, vertical: "\u2503" }}
      borderColor={t().primary}
    >
      <text fg={t().text}>
        <span style={{ bold: true, fg: t().primary }}>Open</span>
        <span style={{ bold: true }}>Mail</span>
      </text>
      <box flexDirection="row" gap={2} flexShrink={0}>
        <text fg={t().textMuted}>{props.email}</text>
        <Show when={props.unreadCount > 0}>
          <text fg={t().text} attributes={TextAttributes.BOLD}>
            {props.unreadCount} unread
          </text>
        </Show>
        <text fg={t().textMuted}>
          <span style={{ fg: syncColor() }}>{"\u2022"}</span>
          <span style={{ fg: t().textMuted }}> {props.syncStatus}</span>
        </text>
      </box>
    </box>
  )
}
