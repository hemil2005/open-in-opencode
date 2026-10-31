/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui"

import { Dashboard } from "./dashboard"

type Context = Plugin.Context

const ROUTE = "open-in-opencode.dashboard"
const COMMAND = "ocshell.open"

export function registerDashboard(context: Context): () => void {
  if (!context.ui?.router) {
    void context.ui?.dialog.alert({
      title: "Open in OpenCode",
      message: "This plugin needs OpenCode 2.2.5 or newer, which provides the page router.",
    })
    return () => {}
  }

  let previous: ReturnType<typeof context.ui.router.current> = { type: "home" }

  const open = (): void => {
    const current = context.ui.router.current()
    if (current.type === "plugin" && current.name === ROUTE) return
    previous = { ...current }
    context.ui.router.navigate({ type: "plugin", name: ROUTE })
  }

  const close = (): void => {
    const target =
      previous.type === "plugin" && previous.name === ROUTE ? { type: "home" as const } : previous
    context.ui.router.navigate(target)
  }

  const unregister = context.ui.router.register({
    name: ROUTE,
    render: () => <Dashboard context={context} onClose={close} />,
  })

  const slot = context.ui.slot({
    append: "app",
    render: () => {
      context.keymap.layer(() => ({
        mode: "global",
        commands: [
          {
            id: COMMAND,
            title: "Open in OpenCode",
            group: "Open in OpenCode",
            palette: true,
            slash: { name: "ocshell" },
            run: open,
          },
        ],
        bindings: [COMMAND],
      }))
      return null
    },
  })

  return () => {
    slot()
    unregister()
  }
}
