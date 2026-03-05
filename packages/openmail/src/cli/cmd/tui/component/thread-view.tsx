import { For, Show, createEffect, on } from "solid-js"
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { Mail } from "../../../../mail/types.js"
import { type Theme } from "../theme.js"
import { formatFileSize } from "../util.js"
import { EmptyBorder } from "./border.js"

interface ThreadViewProps {
  theme: Theme
  thread: Mail.ThreadDetail
  selectedMessageIndex: number
}

export function ThreadView(props: ThreadViewProps) {
  const t = () => props.theme
  let scrollboxRef: ScrollBoxRenderable | undefined

  const formatDate = (date: Date) =>
    date.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    ", " +
    date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })

  // Auto-scroll to keep selected message visible
  createEffect(on(() => props.selectedMessageIndex, (index) => {
    if (!scrollboxRef) return
    // Defer to next frame so layout is computed
    setTimeout(() => {
      if (!scrollboxRef) return
      const children = scrollboxRef.content.getChildren()
      // Children are inside a column box wrapper; get message boxes from it
      const wrapper = children[0]
      if (!wrapper) return
      const messageBoxes = (wrapper as any).getChildren?.()
      if (!messageBoxes || index >= messageBoxes.length) return

      const target = messageBoxes[index]
      if (!target) return

      const targetY = target.y as number
      const targetHeight = target.height as number
      const viewportHeight = scrollboxRef.viewport.height

      // Scroll so the target message is visible with some padding
      const currentScroll = scrollboxRef.scrollTop
      if (targetY < currentScroll) {
        // Message is above viewport — scroll up to it
        scrollboxRef.scrollTo(Math.max(0, targetY - 1))
      } else if (targetY + targetHeight > currentScroll + viewportHeight) {
        // Message is below viewport — scroll down so it fits
        scrollboxRef.scrollTo(targetY + targetHeight - viewportHeight + 1)
      }
    }, 16)
  }))

  return (
    <scrollbox ref={scrollboxRef} flexGrow={1} paddingLeft={2} paddingRight={2} scrollbarOptions={{ visible: false }}>
      <box flexDirection="column">
        <For each={props.thread.messages}>
          {(message, index) => {
            const isSelected = () => index() === props.selectedMessageIndex
            return (
            <box
              flexDirection="column"
              marginTop={index() === 0 ? 0 : 1}
              border={["left"]}
              customBorderChars={{ ...EmptyBorder, vertical: "\u2503" }}
              borderColor={isSelected() ? t().primary : t().border}
            >
              <box
                flexDirection="column"
                paddingLeft={2}
                paddingRight={1}
                paddingTop={1}
                paddingBottom={1}
                backgroundColor={isSelected() ? t().backgroundElement : undefined}
              >
                {/* Sender + date */}
                <box flexDirection="row" justifyContent="space-between" gap={1}>
                  <text fg={t().text} attributes={TextAttributes.BOLD} wrapMode="none" overflow="hidden">
                    {message.from.name}
                  </text>
                  <text fg={t().textMuted} flexShrink={0} wrapMode="none">{formatDate(message.time)}</text>
                </box>

                {/* Recipients */}
                <text fg={t().textMuted} wrapMode="none" overflow="hidden">
                  to {message.to.map((p) => p.name || p.email).join(", ")}
                </text>

                {/* Body */}
                <box paddingTop={1}>
                  <text fg={t().text} wrapMode="word">{message.body.text}</text>
                </box>

                {/* Calendar invite */}
                <Show when={message.calendarEvent}>
                  {(event) => (
                    <box
                      flexDirection="column"
                      marginTop={1}
                      border={["left"]}
                      customBorderChars={{ ...EmptyBorder, vertical: "\u2503" }}
                      borderColor={t().success}
                      paddingLeft={2}
                      backgroundColor={t().backgroundElement}
                    >
                      <text fg={t().text} attributes={TextAttributes.BOLD}>{event().summary}</text>
                      <text fg={t().textMuted}>
                        {formatDate(event().start)} \u2192 {formatDate(event().end)}
                      </text>
                      <Show when={event().location}>
                        <text fg={t().textMuted}>{event().location}</text>
                      </Show>
                      <box flexDirection="row" gap={2} paddingTop={1}>
                        <box
                          paddingLeft={1}
                          paddingRight={1}
                          backgroundColor={event().myStatus === "accepted" ? t().success : undefined}
                        >
                          <text fg={event().myStatus === "accepted" ? t().background : t().textMuted}>
                            {event().myStatus === "accepted" ? "\u2713 Accepted" : "Accept"}
                          </text>
                        </box>
                        <box
                          paddingLeft={1}
                          paddingRight={1}
                          backgroundColor={event().myStatus === "tentative" ? t().warning : undefined}
                        >
                          <text fg={event().myStatus === "tentative" ? t().background : t().textMuted}>
                            {event().myStatus === "tentative" ? "\u2713 Tentative" : "Tentative"}
                          </text>
                        </box>
                        <box
                          paddingLeft={1}
                          paddingRight={1}
                          backgroundColor={event().myStatus === "declined" ? t().error : undefined}
                        >
                          <text fg={event().myStatus === "declined" ? t().background : t().textMuted}>
                            {event().myStatus === "declined" ? "\u2713 Declined" : "Decline"}
                          </text>
                        </box>
                      </box>
                    </box>
                  )}
                </Show>

                {/* Attachments */}
                <Show when={message.attachments.length > 0}>
                  <box flexDirection="column" paddingTop={1}>
                    <For each={message.attachments}>
                      {(attachment) => (
                        <text fg={t().textMuted}>
                          {attachment.filename} ({formatFileSize(attachment.size)})
                        </text>
                      )}
                    </For>
                  </box>
                </Show>
              </box>
            </box>
          )}}
        </For>
      </box>
    </scrollbox>
  )
}
