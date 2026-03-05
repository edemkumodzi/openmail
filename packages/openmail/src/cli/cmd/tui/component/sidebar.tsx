import { For } from "solid-js"
import { TextAttributes, RGBA } from "@opentui/core"
import { Mail } from "../../../../mail/types.js"
import { type Theme } from "../theme.js"
import { EmptyBorder } from "./border.js"

interface SidebarProps {
  theme: Theme
  folders: Mail.Folder[]
  labels: Mail.Label[]
  activeFolder: string
  activeLabel: string | null
  selectedIndex: number
  focused: boolean
  width: number
  onSelect: (type: "folder" | "label", id: string) => void
}

export function Sidebar(props: SidebarProps) {
  const t = () => props.theme

  const folderCount = () => props.folders.length

  return (
    <box
      flexDirection="column"
      width={props.width}
      flexShrink={0}
      paddingTop={1}
      backgroundColor={t().backgroundPanel}
    >
      <For each={props.folders}>
        {(folder, index) => {
          const isActive = () => props.activeFolder === folder.id && !props.activeLabel
          const isHighlighted = () => props.focused && index() === props.selectedIndex
          return (
            <box
              flexDirection="row"
              paddingLeft={1}
              paddingRight={1}
              border={["left"]}
              customBorderChars={{ ...EmptyBorder, vertical: "\u2503" }}
              borderColor={isHighlighted() || isActive() ? t().primary : t().backgroundPanel}
              backgroundColor={isHighlighted() || isActive() ? t().backgroundElement : undefined}
              onMouseUp={() => props.onSelect("folder", folder.id)}
            >
              <text
                fg={isActive() ? t().text : t().textMuted}
                attributes={isActive() || isHighlighted() ? TextAttributes.BOLD : 0}
                flexGrow={1}
              >
                {folder.name}
              </text>
              <text fg={t().textMuted}>
                {folder.unreadCount > 0 ? String(folder.unreadCount) : ""}
              </text>
            </box>
          )
        }}
      </For>

      <box paddingTop={1} paddingBottom={1} paddingLeft={2}>
        <text fg={t().text} attributes={TextAttributes.BOLD}>Labels</text>
      </box>

      <For each={props.labels}>
        {(label, index) => {
          const sidebarIndex = () => folderCount() + index()
          const isActive = () => props.activeLabel === label.id
          const isHighlighted = () => props.focused && sidebarIndex() === props.selectedIndex
          return (
            <box
              flexDirection="row"
              paddingLeft={1}
              paddingRight={1}
              border={["left"]}
              customBorderChars={{ ...EmptyBorder, vertical: "\u2503" }}
              borderColor={isHighlighted() || isActive() ? t().primary : t().backgroundPanel}
              backgroundColor={isHighlighted() || isActive() ? t().backgroundElement : undefined}
              onMouseUp={() => props.onSelect("label", label.id)}
            >
              <text
                fg={isActive() ? t().text : t().textMuted}
                attributes={isActive() || isHighlighted() ? TextAttributes.BOLD : 0}
                flexGrow={1}
              >
                <span style={{ fg: RGBA.fromHex(label.color) }}>{"\u2022"}</span>
                <span style={{ fg: isActive() ? t().text : t().textMuted }}> {label.name}</span>
              </text>
            </box>
          )
        }}
      </For>
    </box>
  )
}
