import { Plugin } from "@opencode/plugin/tui"

import { registerDashboard } from "./ui/register"

/**
 * TUI front end for Open in OpenCode.
 *
 * The CLI (ocshell.exe, on PATH via the package's execution alias) is the source of truth.
 * This plugin only presents it inside opencode: settings, terminal choice and update checks.
 */

export default Plugin.define({
  id: "open-in-opencode.tui",
  setup(context) {
    return registerDashboard(context)
  },
})
