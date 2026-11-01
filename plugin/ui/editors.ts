import { existsSync, statSync } from "node:fs"
import type { Plugin } from "@opencode/plugin/tui"

import {
  canAddLaunchOption,
  filterTerminals,
  formatArgs,
  sortTerminals,
  validateBinaryPath,
  validateCustomArgs,
  validateLaunchFlags,
  validateLaunchLabel,
  validateUpdateUri,
  type FileProbe,
} from "../lib/format"
import { WRITE_TIMEOUT_MS, type Runner } from "../lib/ocshell"
import type { LaunchOption, RunResult, Snapshot, SourceError } from "../lib/types"

type Context = Plugin.Context

/**
 * Dialog-based editors. Every write goes through the CLI, then re-reads
 * settings so the dashboard always shows the persisted value. Invalid input
 * never reaches `settings set`.
 */

export type EditorHooks = {
  context: Context
  runner: Runner
  snapshot: Snapshot
  refresh: (forceUpdate?: boolean) => Promise<void>
  dialog<T>(action: () => Promise<T>): Promise<T>
  setBusy: (busy: boolean) => void
  setError: (error: SourceError | null) => void
}

const fileProbe: FileProbe = (path) => {
  try {
    return statSync(path).isFile() ? "file" : "directory"
  } catch {
    return existsSync(path) ? "file" : "missing"
  }
}

function commandLine(args: string[]): string {
  return ["ocshell.exe", ...args].join(" ")
}

function writeError(result: RunResult, args: string[]): SourceError {
  const command = commandLine(args)
  return {
    kind: result.timedOut ? "timeout" : result.aborted ? "aborted" : "exit",
    source: "write",
    message: result.stderr.trim() || result.stdout.trim() || `${command} failed.`,
    command,
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

async function writeCommands(
  hooks: EditorHooks,
  commands: string[][],
  success: string,
  after?: () => Promise<void>,
): Promise<boolean> {
  hooks.setBusy(true)
  try {
    for (const args of commands) {
      const result = await hooks.runner.run(args, { timeoutMs: WRITE_TIMEOUT_MS })
      if (result.code !== 0) {
        const error = writeError(result, args)
        hooks.setError(error)
        hooks.context.ui.toast.show({
          message: error.message,
          variant: "error",
          duration: 10_000,
        })
        await hooks.refresh()
        return false
      }
    }

    hooks.setError(null)
    hooks.context.ui.toast.show({ message: success, variant: "success" })
    if (after) await after()
    else await hooks.refresh()
    return true
  } finally {
    hooks.setBusy(false)
  }
}

function currentTerminalValue(snapshot: Snapshot): string {
  const settings = snapshot.settings
  if (!settings) return "auto"
  if (settings.terminal.mode === "default") return "default"
  if (settings.terminal.mode === "custom") return "custom"
  return settings.terminal.id ? `terminal:${settings.terminal.id}` : "auto"
}

export async function pickTerminal(hooks: EditorHooks): Promise<void> {
  if (!hooks.snapshot.settings) return

  const terminals = sortTerminals(hooks.snapshot.terminals)
  const choice = await hooks.dialog(() =>
    hooks.context.ui.dialog.select<string>({
      title: "Terminal for Open in OpenCode",
      placeholder: "Search terminals",
      options: [
        {
          title: "Automatic",
          value: "auto",
          description: "Use the selected terminal, or the Windows default",
        },
        {
          title: "Windows default",
          value: "default",
          description: "Let Windows choose the console host",
        },
        ...terminals.map((terminal) => ({
          title: `${terminal.name} (${terminal.id})`,
          value: `terminal:${terminal.id}`,
          description: terminal.path,
          footer: terminal.supported ? undefined : "detected, no launch template",
          disabled: !terminal.supported,
        })),
        {
          title: "Custom",
          value: "custom",
          description: "Use the custom path and arguments in Advanced",
        },
      ],
      current: currentTerminalValue(hooks.snapshot),
      search: (query, options) => filterOptions(query, options),
    }),
  )

  if (choice === undefined) return

  if (choice === "auto") {
    await writeCommands(
      hooks,
      [
        ["settings", "set", "terminal.mode", "auto"],
        ["settings", "set", "terminal.id", "-"],
      ],
      "Terminal set to automatic",
    )
    return
  }

  if (choice === "default") {
    await writeCommands(
      hooks,
      [["settings", "set", "terminal.mode", "default"]],
      "Terminal set to Windows default",
    )
    return
  }

  if (choice === "custom") {
    await writeCommands(
      hooks,
      [["settings", "set", "terminal.mode", "custom"]],
      "Terminal mode set to custom",
    )
    return
  }

  const id = choice.startsWith("terminal:") ? choice.slice("terminal:".length) : ""
  if (!id) return

  await writeCommands(
    hooks,
    [
      ["settings", "set", "terminal.mode", "auto"],
      ["settings", "set", "terminal.id", id],
    ],
    `Terminal set to ${id}`,
  )
}

function filterOptions<Value>(
  query: string,
  options: readonly {
    readonly title: string
    readonly value: Value
    readonly description?: string
  }[],
): readonly {
  readonly title: string
  readonly value: Value
  readonly description?: string
}[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return options
  return options.filter((option) =>
    `${option.title} ${option.description ?? ""}`.toLowerCase().includes(needle),
  )
}

export async function editBinaryPath(hooks: EditorHooks): Promise<void> {
  const settings = hooks.snapshot.settings
  if (!settings) return

  const answer = await hooks.dialog(() =>
    hooks.context.ui.dialog.prompt({
      title: "opencode executable",
      description: "Full path to opencode.exe, or - for auto-detection.",
      placeholder: "C:\\Tools\\opencode.exe",
      value: settings.binaryPath || "-",
    }),
  )

  if (answer === undefined) return

  const validation = validateBinaryPath(answer, fileProbe)
  if (!validation.ok) {
    await hooks.dialog(() =>
      hooks.context.ui.dialog.alert({
        title: "Invalid opencode path",
        message: validation.message,
      }),
    )
    return
  }

  await writeCommands(
    hooks,
    [["settings", "set", "binaryPath", validation.value || "-"]],
    validation.value ? "opencode path updated" : "opencode path set to auto-detect",
  )
}

export async function toggleSetting(
  hooks: EditorHooks,
  key: "continueFromProjectRoot" | "logging",
): Promise<void> {
  const settings = hooks.snapshot.settings
  if (!settings) return

  const next = !settings[key]
  const label = key === "continueFromProjectRoot" ? "Continue from project root" : "Logging"
  await writeCommands(
    hooks,
    [["settings", "set", key, next ? "true" : "false"]],
    `${label} ${next ? "on" : "off"}`,
  )
}

export async function editUpdateUri(hooks: EditorHooks): Promise<void> {
  const settings = hooks.snapshot.settings
  if (!settings) return

  const answer = await hooks.dialog(() =>
    hooks.context.ui.dialog.prompt({
      title: "Update source",
      description: "An http:// or https:// URL, or - for the built-in source.",
      placeholder: "https://example.test/OpenInOpenCode.appinstaller",
      value: settings.updateUri || "-",
    }),
  )

  if (answer === undefined) return

  const validation = validateUpdateUri(answer)
  if (!validation.ok) {
    await hooks.dialog(() =>
      hooks.context.ui.dialog.alert({
        title: "Invalid update source",
        message: validation.message,
      }),
    )
    return
  }

  await writeCommands(
    hooks,
    [["settings", "set", "updateUri", validation.value || "-"]],
    validation.value ? "Update source updated" : "Update source set to built-in",
    () => hooks.refresh(true),
  )
}

export async function selectTerminalMode(hooks: EditorHooks): Promise<void> {
  const settings = hooks.snapshot.settings
  if (!settings) return

  const choice = await hooks.dialog(() =>
    hooks.context.ui.dialog.select<"auto" | "default" | "custom">({
      title: "Terminal mode",
      options: [
        { title: "Automatic", value: "auto", description: "Use the selected terminal, or the Windows default" },
        { title: "Windows default", value: "default", description: "Let Windows choose" },
        { title: "Custom", value: "custom", description: "Use a custom path and arguments" },
      ],
      current: settings.terminal.mode,
    }),
  )

  if (choice === undefined || choice === settings.terminal.mode) return

  await writeCommands(
    hooks,
    [["settings", "set", "terminal.mode", choice]],
    `Terminal mode set to ${choice}`,
  )
}

export async function editCustomPath(hooks: EditorHooks): Promise<void> {
  const settings = hooks.snapshot.settings
  if (!settings) return

  const answer = await hooks.dialog(() =>
    hooks.context.ui.dialog.prompt({
      title: "Custom terminal path",
      description: "Full path to the terminal executable, or - to clear.",
      placeholder: "C:\\Tools\\wt.exe",
      value: settings.terminal.customPath || "-",
    }),
  )

  if (answer === undefined) return

  const validation = validateBinaryPath(answer, fileProbe)
  if (!validation.ok) {
    await hooks.dialog(() =>
      hooks.context.ui.dialog.alert({
        title: "Invalid terminal path",
        message: validation.message,
      }),
    )
    return
  }

  await writeCommands(
    hooks,
    [["settings", "set", "terminal.customPath", validation.value || "-"]],
    validation.value ? "Custom terminal path updated" : "Custom terminal path cleared",
  )
}

async function launchOptionName(
  hooks: EditorHooks,
  title: string,
  value: string,
): Promise<string | undefined> {
  const answer = await hooks.dialog(() =>
    hooks.context.ui.dialog.prompt({
      title,
      description: "This name appears in the Explorer context menu.",
      placeholder: "Fast model",
      value,
    }),
  )
  if (answer === undefined) return undefined

  const validation = validateLaunchLabel(answer)
  if (!validation.ok) {
    await hooks.dialog(() =>
      hooks.context.ui.dialog.alert({
        title: "Invalid launch option",
        message: validation.message,
      }),
    )
    return undefined
  }
  return validation.value
}

async function launchOptionFlags(
  hooks: EditorHooks,
  title: string,
  value: string,
): Promise<string | undefined> {
  const answer = await hooks.dialog(() =>
    hooks.context.ui.dialog.prompt({
      title,
      description:
        "Type arguments exactly as they should follow opencode, including subcommands. The opencode prefix is automatic.",
      placeholder: "--model fast",
      value,
    }),
  )
  if (answer === undefined) return undefined

  const validation = validateLaunchFlags(answer)
  if (!validation.ok) {
    await hooks.dialog(() =>
      hooks.context.ui.dialog.alert({
        title: "Invalid launch flags",
        message: validation.message,
      }),
    )
    return undefined
  }
  return answer.trim()
}

export async function addLaunchOption(hooks: EditorHooks): Promise<void> {
  const settings = hooks.snapshot.settings
  if (!settings) return

  if (!canAddLaunchOption(settings.launchOptions)) {
    await hooks.dialog(() =>
      hooks.context.ui.dialog.alert({
        title: "Launch options",
        message: "At most 3 custom launch options can be defined. Remove one first.",
      }),
    )
    return
  }

  const label = await launchOptionName(hooks, "New launch option name", "")
  if (label === undefined) return

  const flags = await launchOptionFlags(hooks, "opencode flags", "")
  if (flags === undefined) return

  await writeCommands(
    hooks,
    [["settings", "launch", "add", label, flags]],
    `Launch option "${label}" added`,
  )
}

export async function editLaunchOption(
  hooks: EditorHooks,
  option: LaunchOption,
): Promise<void> {
  if (option.builtin) {
    await hooks.dialog(() =>
      hooks.context.ui.dialog.alert({
        title: "Built-in launch option",
        message: "Built-in options cannot be renamed or edited. Hide or reorder it instead.",
      }),
    )
    return
  }

  const label = await launchOptionName(hooks, "Rename launch option", option.label)
  if (label === undefined) return

  const flags = await launchOptionFlags(hooks, "opencode flags", option.flags)
  if (flags === undefined) return

  await writeCommands(
    hooks,
    [["settings", "launch", "update", option.id, label, flags]],
    `Launch option "${label}" updated`,
  )
}

export async function removeLaunchOption(
  hooks: EditorHooks,
  option: LaunchOption,
): Promise<void> {
  if (option.builtin) {
    await hooks.dialog(() =>
      hooks.context.ui.dialog.alert({
        title: "Built-in launch option",
        message: "Built-in options cannot be removed. Hide it instead.",
      }),
    )
    return
  }

  const confirmed = await hooks.dialog(() =>
    hooks.context.ui.dialog.confirm({
      title: `Remove "${option.label}"?`,
      message: "The context-menu entry will be deleted. This cannot be undone.",
      label: { confirm: "Remove", cancel: "Keep" },
    }),
  )
  if (!confirmed) return

  await writeCommands(
    hooks,
    [["settings", "launch", "remove", option.id]],
    `Launch option "${option.label}" removed`,
  )
}

export async function setLaunchOptionHidden(
  hooks: EditorHooks,
  option: LaunchOption,
  hidden: boolean,
): Promise<void> {
  await writeCommands(
    hooks,
    [["settings", "launch", "hide", option.id, hidden ? "true" : "false"]],
    hidden ? `"${option.label}" hidden` : `"${option.label}" shown`,
  )
}

export async function moveLaunchOption(
  hooks: EditorHooks,
  option: LaunchOption,
  up: boolean,
): Promise<void> {
  await writeCommands(
    hooks,
    [["settings", "launch", "move", option.id, up ? "up" : "down"]],
    `"${option.label}" moved ${up ? "up" : "down"}`,
  )
}

export async function editCustomArgs(hooks: EditorHooks): Promise<void> {
  const settings = hooks.snapshot.settings
  if (!settings) return

  const answer = await hooks.dialog(() =>
    hooks.context.ui.dialog.prompt({
      title: "Custom terminal arguments",
      description: "Space-separated. Double quotes group words. Leave empty to clear.",
      placeholder: '--flag "value" or subcommand',
      value: formatArgs(settings.terminal.customArgs),
    }),
  )

  if (answer === undefined) return

  const validation = validateCustomArgs(answer)
  const parsed = validation.ok ? validation.value : []
  const raw = answer.trim()

  await writeCommands(
    hooks,
    [["settings", "set", "terminal.customArgs", raw]],
    parsed.length ? `Custom arguments: ${formatArgs(parsed)}` : "Custom arguments cleared",
  )
}
