import { For, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { Mail } from "../../../../mail/types.js"
import { type Theme } from "../theme.js"
import { EmptyBorder } from "./border.js"

interface LinksPopupProps {
  theme: Theme
  links: Mail.ExtractedLink[]
  selectedIndex: number
  width: number
  height: number
}

export function LinksPopup(props: LinksPopupProps) {
  const t = () => props.theme

  const panelWidth = () => Math.min(70, props.width - 4)
  const panelHeight = () => Math.min(props.links.length * 2 + 6, props.height - 4)
  const panelLeft = () => Math.floor((props.width - panelWidth()) / 2)
  const panelTop = () => Math.floor((props.height - panelHeight()) / 2)

  const truncateForDisplay = (url: string, maxLen: number): string => {
    if (url.length <= maxLen) return url
    return url.slice(0, maxLen - 3) + "..."
  }

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

      {/* Links panel */}
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
        <box paddingLeft={2} paddingRight={2} paddingBottom={1} flexDirection="row" justifyContent="space-between">
          <text fg={t().text} attributes={TextAttributes.BOLD}>Links</text>
          <text fg={t().textMuted} wrapMode="none">{props.links.length} {props.links.length === 1 ? "link" : "links"}</text>
        </box>

        {/* Link list */}
        <Show when={props.links.length > 0} fallback={
          <box paddingLeft={2} paddingRight={2}>
            <text fg={t().textMuted}>No links in this message</text>
          </box>
        }>
          <scrollbox flexGrow={1} scrollbarOptions={{ visible: false }}>
            <box flexDirection="column">
              <For each={props.links}>
                {(link, index) => {
                  const isSelected = () => index() === props.selectedIndex
                  return (
                    <box
                      flexDirection="column"
                      paddingLeft={1}
                      paddingRight={2}
                      border={["left"]}
                      customBorderChars={{ ...EmptyBorder, vertical: "\u2503" }}
                      borderColor={isSelected() ? t().primary : t().backgroundPanel}
                      backgroundColor={isSelected() ? t().backgroundElement : undefined}
                    >
                      <text
                        fg={isSelected() ? t().text : t().textMuted}
                        attributes={isSelected() ? TextAttributes.BOLD : 0}
                        wrapMode="none"
                        overflow="hidden"
                      >
                        {link.label}
                      </text>
                      <text fg={isSelected() ? t().primary : t().textMuted} wrapMode="none" overflow="hidden">
                        {truncateForDisplay(link.url, panelWidth() - 6)}
                      </text>
                    </box>
                  )
                }}
              </For>
            </box>
          </scrollbox>
        </Show>

        {/* Hints */}
        <box paddingLeft={2} paddingRight={2} paddingTop={1}>
          <text fg={t().text} wrapMode="none">
            <span style={{ bold: true, fg: t().text }}>j/k</span>
            <span style={{ fg: t().textMuted }}> navigate  </span>
            <span style={{ bold: true, fg: t().text }}>enter</span>
            <span style={{ fg: t().textMuted }}> open  </span>
            <span style={{ bold: true, fg: t().text }}>esc</span>
            <span style={{ fg: t().textMuted }}> close</span>
          </text>
        </box>
      </box>
    </box>
  )
}
