/** @jsxImportSource @opentui/solid */
import { For, Show } from "solid-js"
import type { ScrollBoxRenderable } from "@opentui/core"
import type { Plugin } from "@opencode/plugin/tui"

import { buildChecks, buildReport, type CheckLevel } from "../lib/report"
import { truncateMiddle } from "../lib/format"
import type { Snapshot } from "../lib/types"

type Context = Plugin.Context

export function DiagnosticsDetail(props: {
  context: Context
  snapshot: Snapshot
  copy: (text: string) => Promise<void>
  close: () => void
}) {
  const theme = () => props.context.theme.surface("dialog")
  const checks = () => buildChecks(props.snapshot)
  const report = () => buildReport(props.snapshot, new Date())
  let scroll: ScrollBoxRenderable | undefined

  const color = (level: CheckLevel) => {
    if (level === "error") return theme().text.feedback.error.base
    if (level === "warn") return theme().text.feedback.warning.base
    return theme().text.feedback.success.base
  }

  const marker = (level: CheckLevel) => (level === "error" ? "x" : level === "warn" ? "!" : "ok")

  props.context.keymap.layer(() => ({
    mode: "global",
    priority: 200,
    commands: [
      {
        id: "ocshell.diagnostics.copy",
        title: "Copy report",
        bind: "c",
        run: () => {
          void props.copy(report())
        },
      },
      {
        id: "ocshell.diagnostics.close",
        title: "Close",
        bind: "return",
        run: () => props.close(),
      },
      {
        id: "ocshell.diagnostics.close-escape",
        title: "Close",
        bind: "escape",
        run: () => props.close(),
      },
      {
        id: "ocshell.diagnostics.up",
        title: "Scroll up",
        bind: "up",
        run: () => scroll?.scrollBy(-1),
      },
      {
        id: "ocshell.diagnostics.down",
        title: "Scroll down",
        bind: "down",
        run: () => scroll?.scrollBy(1),
      },
      {
        id: "ocshell.diagnostics.pageup",
        title: "Scroll up one page",
        bind: "pageup",
        run: () => scroll?.scrollBy(-10),
      },
      {
        id: "ocshell.diagnostics.pagedown",
        title: "Scroll down one page",
        bind: "pagedown",
        run: () => scroll?.scrollBy(10),
      },
    ],
  }))

  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor={theme().background.base}
      padding={1}
    >
      <text fg={theme().text.base} flexShrink={0} height={1}>
        <b>Open in OpenCode diagnostics</b>
      </text>
      <text fg={theme().text.muted} flexShrink={0} height={1}>
        {`${checks().length} checks - c copies the report`}
      </text>

      <scrollbox
        ref={(value) => {
          scroll = value
        }}
        flexGrow={1}
        minHeight={0}
        marginTop={1}
        scrollbarOptions={{ visible: false }}
      >
        <For each={checks()}>
          {(check) => (
            <box flexDirection="row" flexShrink={0} height={1}>
              <text fg={color(check.level)} width={4} wrapMode="none">
                {marker(check.level)}
              </text>
              <text fg={theme().text.base} width={13} wrapMode="none">
                {check.label}
              </text>
              <text fg={theme().text.muted} wrapMode="none">
                {truncateMiddle(
                  check.detail,
                  Math.max(16, Math.min(60, props.context.renderer.width - 48)),
                )}
              </text>
            </box>
          )}
        </For>

        <text marginTop={1} fg={theme().text.muted}>
          Full report
        </text>
        <text fg={theme().text.base} wrapMode="word">
          {report()}
        </text>
      </scrollbox>

      <Show when={props.snapshot.errors.length > 0}>
        <text fg={theme().text.feedback.warning.base} flexShrink={0}>
          {`${props.snapshot.errors.length} source error(s) are included in the report.`}
        </text>
      </Show>

      <box
        flexDirection="row"
        justifyContent="space-between"
        border={["top"]}
        borderColor={theme().border.base}
        paddingTop={1}
        flexShrink={0}
      >
        <text fg={theme().text.base}>
          scroll<span style={{ fg: theme().text.muted }}> up / down</span>
        </text>
        <text fg={theme().text.base}>
          copy<span style={{ fg: theme().text.muted }}> c</span>
        </text>
        <text fg={theme().text.base}>
          close<span style={{ fg: theme().text.muted }}> esc / enter</span>
        </text>
      </box>
    </box>
  )
}
