import { For, Show, createMemo } from "solid-js"
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { Mail } from "../../../../mail/types.js"
import { type Theme } from "../theme.js"
import { formatTime, formatDuration, formatDayLabel, groupEventsByDay, truncate } from "../util.js"
import { EmptyBorder } from "./border.js"

export interface CalendarSidebarHandle {
  /** Total number of events in the flat list */
  eventCount: () => number
  /** Get the selected event (by index into the flat sorted list) */
  getEvent: (index: number) => Mail.CalEvent | undefined
  /** Scroll to keep the event at the given flat index visible */
  scrollToIndex: (index: number) => void
}

interface CalendarSidebarProps {
  theme: Theme
  events: Mail.CalEvent[]
  activeThreadId?: string
  width: number
  focused?: boolean
  selectedIndex: number
  ref?: (handle: CalendarSidebarHandle) => void
}

export function CalendarSidebar(props: CalendarSidebarProps) {
  const t = () => props.theme
  let scrollboxRef: ScrollBoxRenderable | undefined

  const sortedEvents = createMemo(() =>
    [...props.events].sort((a, b) => a.start.getTime() - b.start.getTime())
  )
  const grouped = createMemo(() => groupEventsByDay(sortedEvents()))

  // Build a flat index → event mapping so app.tsx can navigate by index
  const flatEvents = createMemo(() => {
    const flat: Mail.CalEvent[] = []
    for (const [, dayEvents] of grouped()) {
      for (const event of dayEvents) {
        flat.push(event)
      }
    }
    return flat
  })

  // Get all event item boxes from the scrollbox DOM tree
  const getEventBoxes = (): any[] => {
    if (!scrollboxRef) return []
    const children = scrollboxRef.content.getChildren()
    const wrapper = children[0]
    if (!wrapper) return []
    const dayGroups = (wrapper as any).getChildren?.() ?? []
    const boxes: any[] = []
    for (const group of dayGroups) {
      // Each day group: [day header box, event box, event box, ...]
      const groupChildren = (group as any).getChildren?.() ?? []
      // Skip the first child (day header), rest are event items
      for (let i = 1; i < groupChildren.length; i++) {
        boxes.push(groupChildren[i])
      }
    }
    return boxes
  }

  const scrollToIndex = (index: number) => {
    if (!scrollboxRef) return
    setTimeout(() => {
      if (!scrollboxRef) return
      const boxes = getEventBoxes()
      if (index >= boxes.length) return

      const target = boxes[index]
      if (!target) return

      // target.y is screen-space; convert to content-space by adding current scrollTop
      const contentY = (target.y as number) + scrollboxRef.scrollTop
      const targetHeight = target.height as number
      const viewportHeight = scrollboxRef.viewport.height

      // Keep the selected item centered in the viewport
      const centeredScroll = contentY - (viewportHeight - targetHeight) / 2
      scrollboxRef.scrollTo(Math.max(0, centeredScroll))
    }, 16)
  }

  // Expose handle via ref
  if (props.ref) {
    props.ref({
      eventCount: () => flatEvents().length,
      getEvent: (index: number) => flatEvents()[index],
      scrollToIndex,
    })
  }

  const isRelatedToActiveThread = (event: Mail.CalEvent) =>
    props.activeThreadId ? event.linkedThreadIds.includes(props.activeThreadId) : false

  const isHappeningNow = (event: Mail.CalEvent) => {
    const now = new Date()
    return event.start <= now && event.end >= now
  }

  // Content width inside each event row (subtract: 1 scrollbox paddingLeft + left border char + 2 paddingLeft + 1 paddingRight)
  const contentWidth = () => Math.max(10, props.width - 5)

  // Build a lookup from event id to flat index for O(1) index resolution
  const eventIndexMap = createMemo(() => {
    const map = new Map<string, number>()
    flatEvents().forEach((e, i) => map.set(e.id, i))
    return map
  })

  return (
    <box
      flexDirection="column"
      width={props.width}
      flexShrink={0}
      height="100%"
      backgroundColor={t().background}
      border={["top"]}
      borderColor={props.focused ? t().borderActive : t().background}
    >
      <box paddingLeft={2} paddingRight={1} paddingBottom={1} flexShrink={0}>
        <text fg={props.focused ? t().accent : t().text} attributes={TextAttributes.BOLD}>Calendar</text>
      </box>

      <scrollbox ref={scrollboxRef} flexGrow={1} paddingLeft={1} paddingRight={1} scrollbarOptions={{ visible: false }}>
        <box flexDirection="column">
          <For each={[...grouped().entries()]}>
            {([_dateStr, dayEvents]) => {
              const day = dayEvents[0]!.start
              const label = formatDayLabel(day)
              return (
                <box flexDirection="column">
                  {/* Day header — styled like a section label */}
                  <box paddingLeft={3} paddingTop={1}>
                    <text fg={t().text} attributes={TextAttributes.BOLD} wrapMode="none">{label}</text>
                  </box>

                  <For each={dayEvents}>
                    {(event) => {
                      const myIndex = () => eventIndexMap().get(event.id) ?? -1
                      const isSelected = () => props.focused && myIndex() === props.selectedIndex
                      const related = () => isRelatedToActiveThread(event)
                      const current = () => isHappeningNow(event)
                      const highlight = () => isSelected() || related() || current()

                      const timeStr = () => {
                        if (event.allDay) return "all day"
                        const raw = formatTime(event.start)
                        return raw.replace(/ ?(AM|PM)/i, "").toLowerCase()
                      }
                      const durStr = () => formatDuration(event.start, event.end)

                      // Detail line: location (shown as snippet row, like thread snippet)
                      const detailLine = () => event.location ?? ""

                      return (
                        <box
                          flexDirection="column"
                          backgroundColor={isSelected() ? t().backgroundElement : undefined}
                          paddingTop={1}
                          paddingBottom={1}
                          border={["left"]}
                          customBorderChars={{ ...EmptyBorder, vertical: "\u2503" }}
                          borderColor={isSelected() ? t().primary : t().background}
                          paddingLeft={2}
                          paddingRight={1}
                        >
                          {/* Row 1: time + summary + duration */}
                          <box flexDirection="row" gap={1}>
                            <text
                              fg={highlight() ? t().text : t().textMuted}
                              attributes={highlight() ? TextAttributes.BOLD : 0}
                              wrapMode="none"
                              overflow="hidden"
                              flexShrink={0}
                              width={7}
                            >
                              {timeStr()}
                            </text>
                            <text
                              fg={highlight() ? t().text : t().textMuted}
                              attributes={highlight() ? TextAttributes.BOLD : 0}
                              flexGrow={1}
                              wrapMode="none"
                              overflow="hidden"
                            >
                              {event.summary}
                            </text>
                            <text fg={t().textMuted} flexShrink={0} wrapMode="none">
                              {durStr()}
                            </text>
                          </box>

                          {/* Row 2: location snippet */}
                          <Show when={detailLine()}>
                            <text fg={t().textMuted} wrapMode="none" overflow="hidden" paddingLeft={8}>
                              {truncate(detailLine(), contentWidth())}
                            </text>
                          </Show>

                          {/* Expanded details when selected */}
                          <Show when={isSelected()}>
                            <box flexDirection="column" paddingLeft={8} paddingTop={1}>
                              {/* Conference link */}
                              <Show when={event.conferenceUrl}>
                                <text fg={t().accent} wrapMode="none" overflow="hidden">
                                  {truncate(event.conferenceUrl!, contentWidth() - 8)}
                                </text>
                              </Show>

                              {/* Description snippet */}
                              <Show when={event.description}>
                                <text fg={t().textMuted} wrapMode="none" overflow="hidden">
                                  {truncate(event.description!.replace(/\n/g, " ").trim(), contentWidth() - 8)}
                                </text>
                              </Show>

                              {/* Attendees */}
                              <Show when={event.attendees.length > 0}>
                                <box flexDirection="column" paddingTop={1}>
                                  <For each={event.attendees}>
                                    {(attendee) => {
                                      const statusChar =
                                        attendee.status === "accepted" ? "\u2713"
                                          : attendee.status === "declined" ? "\u2717"
                                            : attendee.status === "tentative" ? "~"
                                              : "?"
                                      const statusColor =
                                        attendee.status === "accepted" ? t().success
                                          : attendee.status === "declined" ? t().error
                                            : t().warning
                                      return (
                                        <box flexDirection="row">
                                          <text fg={statusColor} width={2} wrapMode="none">{statusChar}</text>
                                          <text fg={t().textMuted} wrapMode="none" overflow="hidden">
                                            {truncate(attendee.participant.name || attendee.participant.email, contentWidth() - 10)}
                                          </text>
                                        </box>
                                      )
                                    }}
                                  </For>
                                </box>
                              </Show>
                            </box>
                          </Show>
                        </box>
                      )
                    }}
                  </For>
                </box>
              )
            }}
          </For>
        </box>
      </scrollbox>
    </box>
  )
}
