import { Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { type Theme } from "../theme.js"

export type ComposeField = "to" | "subject" | "body"

export interface ComposeState {
  to: string
  subject: string
  body: string
  activeField: ComposeField
}

export const COMPOSE_FIELDS: ComposeField[] = ["to", "subject", "body"]

export function nextField(current: ComposeField): ComposeField {
  const idx = COMPOSE_FIELDS.indexOf(current)
  return COMPOSE_FIELDS[Math.min(idx + 1, COMPOSE_FIELDS.length - 1)]!
}

export function prevField(current: ComposeField): ComposeField {
  const idx = COMPOSE_FIELDS.indexOf(current)
  return COMPOSE_FIELDS[Math.max(idx - 1, 0)]!
}

interface ComposeViewProps {
  theme: Theme
  width: number
  height: number
  state: ComposeState
}

export function ComposeView(props: ComposeViewProps) {
  const t = () => props.theme
  const s = () => props.state

  const panelWidth = () => Math.min(70, props.width - 4)
  const panelHeight = () => Math.min(props.height - 4, 20)
  const panelLeft = () => Math.floor((props.width - panelWidth()) / 2)
  const panelTop = () => Math.floor((props.height - panelHeight()) / 2)

  const isActive = (field: ComposeField) => s().activeField === field
  const bodyHeight = () => Math.max(3, panelHeight() - 10)

  return (
    <box
      width={props.width}
      height={props.height}
      position="absolute"
      left={0}
      top={0}
    >
      {/* Full-screen dim background */}
      <box
        width={props.width}
        height={props.height}
        backgroundColor={t().background}
      />

      {/* Compose panel */}
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
        <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
          <text fg={t().text} attributes={TextAttributes.BOLD}>New Message</text>
        </box>

        {/* To field */}
        <box
          paddingLeft={2}
          paddingRight={2}
          paddingBottom={1}
          backgroundColor={isActive("to") ? t().backgroundElement : undefined}
        >
          <text wrapMode="none" overflow="hidden">
            <span style={{ fg: t().textMuted }}>To: </span>
            <span style={{ fg: isActive("to") ? t().text : t().textMuted }}>
              {s().to || (isActive("to") ? "" : "recipient@example.com")}
            </span>
            <Show when={isActive("to")}>
              <span style={{ fg: t().primary }}>_</span>
            </Show>
          </text>
        </box>

        {/* Subject field */}
        <box
          paddingLeft={2}
          paddingRight={2}
          paddingBottom={1}
          backgroundColor={isActive("subject") ? t().backgroundElement : undefined}
        >
          <text wrapMode="none" overflow="hidden">
            <span style={{ fg: t().textMuted }}>Subject: </span>
            <span style={{ fg: isActive("subject") ? t().text : t().textMuted }}>
              {s().subject || (isActive("subject") ? "" : "Enter subject")}
            </span>
            <Show when={isActive("subject")}>
              <span style={{ fg: t().primary }}>_</span>
            </Show>
          </text>
        </box>

        {/* Separator */}
        <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
          <text fg={t().textMuted}>{"─".repeat(Math.max(1, panelWidth() - 4))}</text>
        </box>

        {/* Body field */}
        <box
          flexGrow={1}
          paddingLeft={2}
          paddingRight={2}
          backgroundColor={isActive("body") ? t().backgroundElement : undefined}
        >
          <text fg={isActive("body") ? t().text : t().textMuted}>
            {s().body || (isActive("body") ? "" : "Compose your message...")}
            <Show when={isActive("body")}>
              <span style={{ fg: t().primary }}>_</span>
            </Show>
          </text>
        </box>

        {/* Hints */}
        <box paddingLeft={2} paddingRight={2} paddingTop={1}>
          <text fg={t().text} wrapMode="none">
            <span style={{ bold: true, fg: t().text }}>tab</span>
            <span style={{ fg: t().textMuted }}> next field  </span>
            <span style={{ bold: true, fg: t().text }}>shift+tab</span>
            <span style={{ fg: t().textMuted }}> prev  </span>
            <span style={{ bold: true, fg: t().text }}>ctrl+s</span>
            <span style={{ fg: t().textMuted }}> send  </span>
            <span style={{ bold: true, fg: t().text }}>esc</span>
            <span style={{ fg: t().textMuted }}> discard</span>
          </text>
        </box>
      </box>
    </box>
  )
}
