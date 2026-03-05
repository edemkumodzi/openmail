import { For, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { Mail } from "../../../../mail/types.js"
import { type Theme } from "../theme.js"
import { formatTime, formatDuration, formatDayLabel, groupEventsByDay, truncate } from "../util.js"

interface CalendarSidebarProps {
  theme: Theme
  events: Mail.CalEvent[]
  activeThreadId?: string
  width: number
}

export function CalendarSidebar(props: CalendarSidebarProps) {
  const t = () => props.theme

  const isRelatedToActiveThread = (event: Mail.CalEvent) =>
    props.activeThreadId ? event.linkedThreadIds.includes(props.activeThreadId) : false

  const isHappeningNow = (event: Mail.CalEvent) => {
    const now = new Date()
    return event.start <= now && event.end >= now
  }

  const sortedEvents = () => [...props.events].sort((a, b) => a.start.getTime() - b.start.getTime())
  const grouped = () => groupEventsByDay(sortedEvents())
  const contentWidth = () => Math.max(10, props.width - 4)

  return (
    <box
      flexDirection="column"
      width={props.width}
      flexShrink={0}
      paddingTop={1}
      paddingLeft={2}
      paddingRight={2}
      backgroundColor={t().backgroundPanel}
    >
      <box paddingBottom={1}>
        <text fg={t().text} attributes={TextAttributes.BOLD}>Calendar</text>
      </box>

      <For each={[...grouped().entries()]}>
        {([_dateStr, dayEvents]) => {
          const day = dayEvents[0]!.start
          const label = formatDayLabel(day)
          return (
            <box flexDirection="column" paddingBottom={1}>
              <text fg={t().text} attributes={TextAttributes.BOLD}>{label}</text>

              <For each={dayEvents}>
                {(event) => {
                  const related = () => isRelatedToActiveThread(event)
                  const current = () => isHappeningNow(event)
                  const highlight = () => related() || current()

                  const timeStr = formatTime(event.start).replace(/ (AM|PM)/, "").toLowerCase()
                  const durStr = formatDuration(event.start, event.end)
                  const loc = event.location ? event.location : ""
                  const detail = loc ? durStr + " \u00b7 " + truncate(loc, contentWidth() - 15) : durStr

                  return (
                    <box flexDirection="column" paddingTop={1}>
                      <box flexDirection="row">
                        <text
                          fg={highlight() ? t().text : t().textMuted}
                          attributes={highlight() ? TextAttributes.BOLD : 0}
                          width={6}
                          flexShrink={0}
                        >
                          {timeStr}
                        </text>
                        <text
                          fg={highlight() ? t().text : t().textMuted}
                          attributes={highlight() ? TextAttributes.BOLD : 0}
                        >
                          {truncate(event.summary, contentWidth() - 7)}
                        </text>
                      </box>
                      <box paddingLeft={6}>
                        <text fg={t().textMuted}>{detail}</text>
                      </box>

                      <Show when={related() && event.attendees.length > 0}>
                        <box flexDirection="column" paddingLeft={6} paddingTop={1}>
                          <For each={event.attendees}>
                            {(attendee) => {
                              const statusChar =
                                attendee.status === "accepted" ? "\u2713"
                                  : attendee.status === "declined" ? "\u2717"
                                    : "?"
                              const statusColor =
                                attendee.status === "accepted" ? t().success
                                  : attendee.status === "declined" ? t().error
                                    : t().warning
                              return (
                                <box flexDirection="row">
                                  <text fg={statusColor} width={2}>{statusChar}</text>
                                  <text fg={t().textMuted}>
                                    {truncate(attendee.participant.name, contentWidth() - 9)}
                                  </text>
                                </box>
                              )
                            }}
                          </For>
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
  )
}
