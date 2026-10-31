import { Plugin } from "@opencode/plugin/tui"
import { spawnSync } from "node:child_process"

/**
 * TUI front end for Open in OpenCode.
 *
 * The CLI (ocshell.exe, on PATH via the package's execution alias) is the source of truth.
 * This plugin only presents it inside opencode: settings, terminal choice and update checks.
 *
 * It is a convenience surface, never the only way in: the settings it edits are needed before
 * opencode can even launch, and they work fine from a terminal.
 */

const COMMAND_ID = "ocshell.open"

type RunResult = { code: number; stdout: string; stderr: string }

function run(args: string[]): RunResult {
  const result = spawnSync("ocshell.exe", args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
  })

  return {
    code: typeof result.status === "number" ? result.status : 1,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  }
}

function available(): boolean {
  if (process.platform !== "win32") return false
  return run(["version"]).code === 0
}

type Terminal = { id: string; name: string; path: string; supported: boolean }

function loadTerminals(): Terminal[] {
  const result = run(["settings", "terminals", "--json"])
  if (result.code !== 0) return []
  try {
    return JSON.parse(result.stdout) as Terminal[]
  } catch {
    return []
  }
}

async function changeTerminal(context: any): Promise<void> {
  const terminals = loadTerminals().filter((terminal) => terminal.supported)

  if (terminals.length === 0) {
    await context.ui.dialog.alert({
      title: "Open in OpenCode",
      message: "No terminals were detected. Set one from a terminal with `ocshell settings set terminal.mode custom`.",
    })
    return
  }

  const choice = await context.ui.dialog.select({
    title: "Terminal for Open in OpenCode",
    options: [
      { title: "Windows default", value: "", description: "Let Windows choose the console host" },
      ...terminals.map((terminal) => ({
        title: terminal.name,
        value: terminal.id,
        description: terminal.path,
      })),
    ],
  })

  if (choice === undefined) return

  const result = choice === ""
    ? run(["settings", "set", "terminal.mode", "default"])
    : (() => {
        run(["settings", "set", "terminal.mode", "auto"])
        return run(["settings", "set", "terminal.id", choice])
      })()

  context.ui.toast.show({
    message: result.code === 0 ? "Terminal updated" : result.stderr || "Could not update the terminal",
    variant: result.code === 0 ? "success" : "error",
  })
}

async function changeBinary(context: any): Promise<void> {
  const current = run(["settings", "list", "--json"])
  let binaryPath = ""
  try {
    binaryPath = (JSON.parse(current.stdout) as { binaryPath?: string }).binaryPath ?? ""
  } catch {
    // ignore: the prompt still works with an empty default
  }

  const answer = await context.ui.dialog.prompt({
    title: "opencode executable",
    placeholder: "Full path to opencode.exe, or - for auto-detection",
    value: binaryPath || "-",
  })

  if (answer === undefined) return

  const result = run(["settings", "set", "binaryPath", answer.trim() || "-"])
  context.ui.toast.show({
    message: result.code === 0 ? "opencode path updated" : result.stderr || "Could not update the path",
    variant: result.code === 0 ? "success" : "error",
  })
}

async function showSettings(context: any): Promise<void> {
  const result = run(["settings", "list"])
  await context.ui.dialog.alert({
    title: "Open in OpenCode settings",
    message: result.stdout || result.stderr || "No output",
  })
}

async function checkUpdates(context: any): Promise<void> {
  const result = run(["update", "check", "--json"])
  if (result.code !== 0) {
    await context.ui.dialog.alert({ title: "Update check failed", message: result.stderr || result.stdout })
    return
  }

  let info: { current?: string; available?: string; updateAvailable?: boolean }
  try {
    info = JSON.parse(result.stdout)
  } catch {
    await context.ui.dialog.alert({ title: "Update check failed", message: result.stdout })
    return
  }

  if (!info.updateAvailable) {
    context.ui.toast.show({ message: `Open in OpenCode ${info.current} is up to date`, variant: "success" })
    return
  }

  const confirmed = await context.ui.dialog.confirm({
    title: "Update available",
    message: `Installed ${info.current}, available ${info.available}. Install it now?`,
    label: { confirm: "Install", cancel: "Later" },
  })

  if (!confirmed) return

  context.ui.toast.show({ message: `Installing Open in OpenCode ${info.available}...` })
  const applied = run(["update", "apply"])
  context.ui.toast.show({
    message: applied.code === 0 ? `Updated to ${info.available}` : applied.stderr || applied.stdout,
    variant: applied.code === 0 ? "success" : "error",
    duration: applied.code === 0 ? 3000 : 10000,
  })
}

async function open(context: any): Promise<void> {
  if (process.platform !== "win32") {
    await context.ui.dialog.alert({
      title: "Open in OpenCode",
      message: "The Open in OpenCode shell integration is Windows-only.",
    })
    return
  }

  if (!available()) {
    await context.ui.dialog.alert({
      title: "Open in OpenCode",
      message:
        "The ocshell.exe command was not found.\n\n" +
        "Install Open in OpenCode, or make sure its execution alias is on PATH.",
    })
    return
  }

  const choice = await context.ui.dialog.select({
    title: "Open in OpenCode",
    options: [
      { title: "Show settings", value: "show", description: "Current values and config path" },
      { title: "Change terminal", value: "terminal", description: "Where opencode opens" },
      { title: "opencode executable", value: "binary", description: "Override auto-detection" },
      { title: "Check for updates", value: "update", description: "Compare with the published version" },
    ],
  })

  switch (choice) {
    case "show":
      return showSettings(context)
    case "terminal":
      return changeTerminal(context)
    case "binary":
      return changeBinary(context)
    case "update":
      return checkUpdates(context)
  }
}

export default Plugin.define({
  id: "open-in-opencode.tui",
  setup(context: any) {
    context.keymap.layer(() => ({
      mode: "global" as const,
      commands: [
        {
          id: COMMAND_ID,
          title: "Open in OpenCode settings",
          group: "Open in OpenCode",
          palette: true,
          slash: { name: "ocshell" },
          run: () => open(context),
        },
      ],
      bindings: [COMMAND_ID],
    }))
  },
})
