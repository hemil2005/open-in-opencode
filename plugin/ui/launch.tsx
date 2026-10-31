/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui"
import { createEffect, createSignal, For } from "solid-js"

import {
  canAddLaunchOption,
  formatLaunchOption,
  truncateMiddle,
} from "../lib/format"
import type { LaunchOption } from "../lib/types"
import {
  addLaunchOption,
  editLaunchOption,
  moveLaunchOption,
  removeLaunchOption,
  setLaunchOptionHidden,
  type EditorHooks,
} from "./editors"

type Context = Plugin.Context

export function LaunchManager(props: {
  context: Context
  options: () => LaunchOption[]
  hooks: EditorHooks
  blocked: () => boolean
  close: () => void
}) {
  const theme = () => props.context.theme
  const [selectedId, setSelectedId] = createSignal(props.options()[0]?.id ?? "")
  const [working, setWorking] = createSignal(false)

  const options = () => props.options()
  const selected = () =>
    options().find((option) => option.id === selectedId()) ?? options()[0]
  const customCount = () => options().filter((option) => !option.builtin).length
  const visibleCount = () => options().filter((option) => !option.hidden).length

  const valueWidth = () =>
    Math.max(12, props.context.renderer.width - 2 - 2 - 4 - 10)

  function move(delta: number): void {
    const list = options()
    if (list.length === 0) return
    const index = Math.max(
      0,
      list.findIndex((option) => option.id === selectedId()),
    )
    const next = (index + delta + list.length) % list.length
    const target = list[next]
    if (target) setSelectedId(target.id)
  }

  async function run(action: () => Promise<void>): Promise<void> {
    if (working()) return
    setWorking(true)
    try {
      await action()
    } finally {
      setWorking(false)
    }
  }

  async function toggleHidden(): Promise<void> {
    const option = selected()
    if (option) await setLaunchOptionHidden(props.hooks, option, !option.hidden)
  }

  async function moveSelected(up: boolean): Promise<void> {
    const option = selected()
    if (option) await moveLaunchOption(props.hooks, option, up)
  }

  async function editSelected(): Promise<void> {
    const option = selected()
    if (option) await editLaunchOption(props.hooks, option)
  }

  async function removeSelected(): Promise<void> {
    const option = selected()
    if (option) await removeLaunchOption(props.hooks, option)
  }

  async function add(): Promise<void> {
    if (!canAddLaunchOption(options())) {
      await props.hooks.dialog(() =>
        props.context.ui.dialog.alert({
          title: "Launch options",
          message: "At most 3 custom launch options can be defined. Remove one first.",
        }),
      )
      return
    }
    await addLaunchOption(props.hooks)
  }

  createEffect(() => {
    const list = options()
    if (list.length === 0) return
    if (!list.some((option) => option.id === selectedId())) {
      setSelectedId(list[0]?.id ?? "")
    }
  })

  props.context.keymap.layer(() => ({
    mode: "global",
    priority: 300,
    enabled: () => !props.blocked(),
    commands: [
      {
        id: "ocshell.launch.up",
        title: "Up",
        bind: "up",
        run: () => move(-1),
      },
      {
        id: "ocshell.launch.k",
        title: "Up",
        bind: "k",
        run: () => move(-1),
      },
      {
        id: "ocshell.launch.down",
        title: "Down",
        bind: "down",
        run: () => move(1),
      },
      {
        id: "ocshell.launch.j",
        title: "Down",
        bind: "j",
        run: () => move(1),
      },
      {
        id: "ocshell.launch.toggle",
        title: "Show or hide",
        bind: "space",
        run: () => {
          void run(toggleHidden)
        },
      },
      {
        id: "ocshell.launch.toggle-return",
        title: "Show or hide",
        bind: "return",
        run: () => {
          void run(toggleHidden)
        },
      },
      {
        id: "ocshell.launch.move-up",
        title: "Move up",
        bind: "ctrl+up",
        run: () => {
          void run(() => moveSelected(true))
        },
      },
      {
        id: "ocshell.launch.move-down",
        title: "Move down",
        bind: "ctrl+down",
        run: () => {
          void run(() => moveSelected(false))
        },
      },
      {
        id: "ocshell.launch.edit",
        title: "Edit",
        bind: "e",
        run: () => {
          void run(editSelected)
        },
      },
      {
        id: "ocshell.launch.remove",
        title: "Remove",
        bind: "d",
        run: () => {
          void run(removeSelected)
        },
      },
      {
        id: "ocshell.launch.add",
        title: "Add",
        bind: "a",
        run: () => {
          void run(add)
        },
      },
      {
        id: "ocshell.launch.back",
        title: "Back",
        bind: "escape",
        run: () => props.close(),
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
        <b>Launch options</b>
      </text>
      <text fg={theme().text.muted} flexShrink={0} height={1}>
        {`${visibleCount()} shown, ${customCount()}/3 custom. Flags are passed to opencode automatically.`}
      </text>

      <box flexDirection="column" flexShrink={0} marginTop={1}>
        <For each={options()}>
          {(option) => {
            const isSelected = () => option.id === selectedId()
            return (
              <box
                id={`ocshell-launch-${option.id}`}
                flexDirection="row"
                height={1}
                flexShrink={0}
                backgroundColor={
                  isSelected() ? theme().background.raised.high : undefined
                }
                onMouseUp={() => setSelectedId(option.id)}
              >
                <text
                  fg={isSelected() ? theme().text.base : theme().text.muted}
                  width={2}
                  wrapMode="none"
                >
                  {isSelected() ? ">" : " "}
                </text>
                <text
                  fg={option.hidden ? theme().text.faint : theme().text.base}
                  width={4}
                  wrapMode="none"
                >
                  {option.hidden ? "[ ]" : "[x]"}
                </text>
                <text fg={theme().text.muted} width={10} wrapMode="none">
                  {option.builtin ? "built-in" : "custom"}
                </text>
                <text
                  fg={option.hidden ? theme().text.faint : theme().text.base}
                  wrapMode="none"
                >
                  {truncateMiddle(formatLaunchOption(option), valueWidth())}
                </text>
              </box>
            )
          }}
        </For>
      </box>

      <text fg={theme().text.muted} flexShrink={0} marginTop={1}>
        Hidden entries stay configured but do not appear in the Explorer menu.
      </text>

      <box flexGrow={1} />

      <box
        flexDirection="column"
        border={["top"]}
        borderColor={theme().border.base}
        paddingTop={1}
        flexShrink={0}
      >
        <text fg={theme().text.base} wrapMode="none">
          show/hide<span style={{ fg: theme().text.muted }}> space</span>
          {"   "}move<span style={{ fg: theme().text.muted }}> ctrl+up/down</span>
          {"   "}edit<span style={{ fg: theme().text.muted }}> e</span>
          {"   "}delete<span style={{ fg: theme().text.muted }}> d</span>
        </text>
        <text fg={theme().text.base} wrapMode="none">
          add<span style={{ fg: theme().text.muted }}> a</span>
          {"   "}back<span style={{ fg: theme().text.muted }}> esc</span>
          {working() ? "   working..." : ""}
        </text>
      </box>
    </box>
  )
}
