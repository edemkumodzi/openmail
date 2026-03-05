import { For } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { Mail } from "../../../../mail/types.js"
import { type Theme } from "../theme.js"
import { formatRelativeTime, truncate } from "../util.js"
import { EmptyBorder } from "./border.js"

interface ThreadListProps {
  theme: Theme
  threads: Mail.ThreadSummary[]
  selectedIndex: number
  onSelect: (index: number) => void
  onOpen: (thread: Mail.ThreadSummary) => void
  maxWidth: number
}

export function ThreadList(props: ThreadListProps) {
  const t = () => props.theme

  return (
    <scrollbox flexGrow={1} paddingLeft={1} paddingRight={2} scrollbarOptions={{ visible: false }}>
      <box flexDirection="column">
        <For each={props.threads}>
          {(thread, index) => {
            const isSelected = () => index() === props.selectedIndex
            const senderName = () => thread.participants[0]?.name ?? "Unknown"

            const titleFg = () =>
              isSelected() ? t().text : thread.unread ? t().text : t().textMuted
            const subjectFg = () =>
              isSelected() ? t().text : thread.unread ? t().text : t().textMuted
            const metaFg = () => t().textMuted

            return (
              <box
                  flexDirection="column"
                  backgroundColor={isSelected() ? t().backgroundElement : undefined}
                  paddingTop={1}
                  paddingBottom={1}
                  border={["left"]}
                  customBorderChars={{ ...EmptyBorder, vertical: "\u2503" }}
                  borderColor={isSelected() ? t().primary : t().backgroundPanel}
                  paddingLeft={2}
                  paddingRight={1}
                  onMouseUp={() => {
                    props.onSelect(index())
                    props.onOpen(thread)
                  }}
                >
                  {/* Row 1: sender + subject + time */}
                  <box flexDirection="row" gap={2}>
                    <text
                      fg={titleFg()}
                      attributes={thread.unread || isSelected() ? TextAttributes.BOLD : 0}
                      wrapMode="none"
                      overflow="hidden"
                      flexShrink={0}
                      width={14}
                    >
                      {truncate(senderName(), 13)}
                    </text>
                    <text fg={subjectFg()} flexGrow={1} wrapMode="none" overflow="hidden">
                      {thread.subject}
                    </text>
                    <text fg={metaFg()} flexShrink={0} wrapMode="none">
                      {formatRelativeTime(thread.time)}
                    </text>
                  </box>
                  {/* Row 2: snippet */}
                  <text fg={metaFg()} wrapMode="none" overflow="hidden" paddingLeft={16}>
                    {thread.snippet}
                  </text>
                </box>
            )
          }}
        </For>
      </box>
    </scrollbox>
  )
}
