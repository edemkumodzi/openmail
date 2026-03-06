import { For, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { Mail } from "../../../../mail/types.js"
import { type Theme } from "../theme.js"
import { formatRelativeTime, truncate } from "../util.js"
import { EmptyBorder } from "./border.js"

/**
 * Client-side thread search filter — used as offline fallback when server is unavailable.
 */
export function searchThreads(threads: Mail.ThreadSummary[], query: string): Mail.ThreadSummary[] {
  if (!query.trim()) return []
  const q = query.toLowerCase().trim()
  return threads.filter((thread) => {
    const subject = thread.subject.toLowerCase()
    const snippet = thread.snippet.toLowerCase()
    const participants = thread.participants.map((p) => `${p.name} ${p.email}`.toLowerCase()).join(" ")
    return subject.includes(q) || snippet.includes(q) || participants.includes(q)
  })
}

interface SearchViewProps {
  theme: Theme
  results: Mail.ThreadSummary[]
  query: string
  selectedIndex: number
  focused: boolean
  loading: boolean
  maxWidth: number
  onSelect: (index: number) => void
  onOpen: (thread: Mail.ThreadSummary) => void
}

export function SearchView(props: SearchViewProps) {
  const t = () => props.theme

  const results = () => props.results

  return (
    <box flexDirection="column" flexGrow={1}>
      {/* Search input area */}
      <box
        paddingLeft={2}
        paddingRight={2}
        paddingBottom={1}
        flexShrink={0}
      >
        <text fg={t().textMuted} wrapMode="none" overflow="hidden">
          <span style={{ fg: t().primary, bold: true }}>/</span>
          <span style={{ fg: props.query ? t().text : t().textMuted }}>
            {props.query ? " " + props.query : " search..."}
          </span>
          <Show when={props.focused}>
            <span style={{ fg: t().primary }}>_</span>
          </Show>
        </text>
      </box>

      {/* Results count */}
      <Show when={props.query.trim().length > 0}>
        <box paddingLeft={2} paddingRight={2} paddingBottom={1} flexShrink={0}>
          <text fg={t().textMuted}>
            {results().length} {results().length === 1 ? "result" : "results"}
          </text>
        </box>
      </Show>

      {/* Results list */}
      <Show when={results().length > 0}>
        <scrollbox flexGrow={1} paddingLeft={1} paddingRight={2} scrollbarOptions={{ visible: false }}>
          <box flexDirection="column">
            <For each={results()}>
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
      </Show>

      {/* Loading state */}
      <Show when={props.loading && results().length === 0}>
        <box flexGrow={1} justifyContent="center" alignItems="center">
          <text fg={t().textMuted}>Searching...</text>
        </box>
      </Show>

      {/* Empty state */}
      <Show when={!props.loading && props.query.trim().length > 0 && results().length === 0}>
        <box flexGrow={1} justifyContent="center" alignItems="center">
          <text fg={t().textMuted}>No threads match your search</text>
        </box>
      </Show>
    </box>
  )
}
