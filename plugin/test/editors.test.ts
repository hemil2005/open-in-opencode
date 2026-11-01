import { describe, expect, test } from "bun:test"
import type { Plugin } from "@opencode/plugin/tui"

import type { RunOptions, Runner } from "../lib/ocshell"
import type { LaunchOption, Result, RunResult, Snapshot, SourceError } from "../lib/types"
import {
  addLaunchOption,
  editBinaryPath,
  editCustomArgs,
  editCustomPath,
  editLaunchOption,
  editUpdateUri,
  moveLaunchOption,
  pickTerminal,
  removeLaunchOption,
  selectTerminalMode,
  setLaunchOptionHidden,
  toggleSetting,
  type EditorHooks,
} from "../ui/editors"
import { defaultLaunchOptions } from "../lib/types"
import { makeSnapshot, settingsWith } from "./fixtures"

type HarnessOptions = {
  prompt?: string
  prompts?: string[]
  select?: string
  confirm?: boolean
  fail?: boolean
  snapshot?: Snapshot
}

function harness(options: HarnessOptions = {}) {
  const calls: string[][] = []
  const alerts: string[] = []
  const toasts: { message: string; variant?: string }[] = []
  const refreshArgs: Array<boolean | undefined> = []
  const errors: Array<SourceError | null> = []

  const context = {
    ui: {
      dialog: {
        prompt: async () => (options.prompts ? options.prompts.shift() : options.prompt),
        alert: async (alert: { message: string }) => {
          alerts.push(alert.message)
        },
        select: async () => options.select,
        confirm: async () => options.confirm ?? true,
      },
      toast: {
        show: (toast: { message: string; variant?: string }) => {
          toasts.push(toast)
        },
      },
    },
  } as unknown as Plugin.Context

  const runner: Runner = {
    resolve: () => "ocshell.exe",
    reset: () => {},
    run: async (args: string[], _runOptions?: RunOptions): Promise<RunResult> => {
      calls.push(args)
      return options.fail
        ? {
            code: 1,
            stdout: "",
            stderr: "boom",
            timedOut: false,
            aborted: false,
            truncated: false,
          }
        : {
            code: 0,
            stdout: "",
            stderr: "",
            timedOut: false,
            aborted: false,
            truncated: false,
          }
    },
    json: async <T,>(): Promise<Result<T>> => ({
      ok: false,
      error: { kind: "exit", message: "unused" },
    }),
  }

  const hooks: EditorHooks = {
    context,
    runner,
    snapshot: options.snapshot ?? makeSnapshot(),
    refresh: async (force?: boolean) => {
      refreshArgs.push(force)
    },
    dialog: async (action) => action(),
    setBusy: () => {},
    setError: (error) => {
      errors.push(error)
    },
  }

  return { hooks, calls, alerts, toasts, refreshArgs, errors }
}

describe("binary path editor", () => {
  test("rejects relative paths without writing", async () => {
    const h = harness({ prompt: "opencode.exe" })

    await editBinaryPath(h.hooks)

    expect(h.calls).toEqual([])
    expect(h.alerts[0]).toContain("full path")
  })

  test("rejects directories without writing", async () => {
    const h = harness({ prompt: process.cwd() })

    await editBinaryPath(h.hooks)

    expect(h.calls).toEqual([])
    expect(h.alerts[0]).toContain("directory")
  })

  test("writes an existing absolute file", async () => {
    const h = harness({ prompt: process.execPath })

    await editBinaryPath(h.hooks)

    expect(h.calls).toEqual([["settings", "set", "binaryPath", process.execPath]])
    expect(h.refreshArgs).toEqual([undefined])
    expect(h.toasts.at(-1)).toMatchObject({ variant: "success" })
  })

  test("clears with -", async () => {
    const h = harness({ prompt: "-" })

    await editBinaryPath(h.hooks)

    expect(h.calls).toEqual([["settings", "set", "binaryPath", "-"]])
  })
})

describe("update source editor", () => {
  test("rejects non-http URLs without writing", async () => {
    const h = harness({ prompt: "ftp://example.test/appinstaller" })

    await editUpdateUri(h.hooks)

    expect(h.calls).toEqual([])
    expect(h.alerts[0]).toContain("http://")
  })

  test("writes a valid URL and forces an update check", async () => {
    const h = harness({ prompt: "https://example.test/appinstaller" })

    await editUpdateUri(h.hooks)

    expect(h.calls).toEqual([
      ["settings", "set", "updateUri", "https://example.test/appinstaller"],
    ])
    expect(h.refreshArgs).toEqual([true])
  })
})

describe("setting editors", () => {
  test("toggles a boolean from its current value", async () => {
    const h = harness({
      snapshot: makeSnapshot({ settings: settingsWith({ logging: false }) }),
    })

    await toggleSetting(h.hooks, "logging")

    expect(h.calls).toEqual([["settings", "set", "logging", "true"]])
  })

  test("does not write when the terminal mode is unchanged", async () => {
    const h = harness({ select: "auto" })

    await selectTerminalMode(h.hooks)

    expect(h.calls).toEqual([])
  })

  test("writes the selected terminal in two steps", async () => {
    const h = harness({ select: "terminal:wezterm-gui" })

    await pickTerminal(h.hooks)

    expect(h.calls).toEqual([
      ["settings", "set", "terminal.mode", "auto"],
      ["settings", "set", "terminal.id", "wezterm-gui"],
    ])
  })

  test("clears the terminal id for automatic selection", async () => {
    const h = harness({ select: "auto" })

    await pickTerminal(h.hooks)

    expect(h.calls).toEqual([
      ["settings", "set", "terminal.mode", "auto"],
      ["settings", "set", "terminal.id", "-"],
    ])
  })

  test("rejects a relative custom terminal path", async () => {
    const h = harness({ prompt: "wt.exe" })

    await editCustomPath(h.hooks)

    expect(h.calls).toEqual([])
  })

  test("writes custom arguments as raw CLI input", async () => {
    const h = harness({ prompt: '--foo "bar baz"' })

    await editCustomArgs(h.hooks)

    expect(h.calls).toEqual([
      ["settings", "set", "terminal.customArgs", '--foo "bar baz"'],
    ])
  })

  test("clears custom arguments with an empty value", async () => {
    const h = harness({ prompt: "" })

    await editCustomArgs(h.hooks)

    expect(h.calls).toEqual([["settings", "set", "terminal.customArgs", ""]])
  })

  test("reports a failed write and refreshes anyway", async () => {
    const h = harness({ fail: true })

    await toggleSetting(h.hooks, "logging")

    expect(h.calls).toEqual([["settings", "set", "logging", "true"]])
    expect(h.errors.at(-1)).toMatchObject({
      kind: "exit",
      source: "write",
      message: "boom",
    })
    expect(h.refreshArgs).toEqual([undefined])
  })
})

describe("launch option editors", () => {
  const customOption: LaunchOption = {
    id: "custom-1",
    label: "Fast model",
    flags: "--model fast",
    builtin: false,
    hidden: false,
  }

  test("adds a custom option after validating both prompts", async () => {
    const h = harness({ prompts: ["Fast model", "--model fast"] })

    await addLaunchOption(h.hooks)

    expect(h.calls).toEqual([
      ["settings", "launch", "add", "Fast model", "--model fast"],
    ])
  })

  test("never writes an unmatched quote", async () => {
    const h = harness({ prompts: ["Fast model", '--flag "unterminated'] })

    await addLaunchOption(h.hooks)

    expect(h.calls).toEqual([])
    expect(h.alerts.at(-1)).toContain("unmatched quote")
  })

  test("accepts subcommands", async () => {
    const h = harness({ prompts: ["Mini", "mini"] })

    await addLaunchOption(h.hooks)

    expect(h.calls).toEqual([["settings", "launch", "add", "Mini", "mini"]])
  })

  test("refuses a fourth custom option", async () => {
    const h = harness({
      snapshot: makeSnapshot({
        settings: settingsWith({
          launchOptions: [
            ...defaultLaunchOptions(),
            customOption,
            { ...customOption, id: "custom-2", label: "Second" },
            { ...customOption, id: "custom-3", label: "Third" },
          ],
        }),
      }),
    })

    await addLaunchOption(h.hooks)

    expect(h.calls).toEqual([])
    expect(h.alerts.at(-1)).toContain("At most 3")
  })

  test("updates a custom option", async () => {
    const h = harness({ prompts: ["Renamed", "--auto"] })

    await editLaunchOption(h.hooks, customOption)

    expect(h.calls).toEqual([
      ["settings", "launch", "update", "custom-1", "Renamed", "--auto"],
    ])
  })

  test("does not edit or remove built-ins", async () => {
    const builtin = defaultLaunchOptions()[0]!
    const h = harness()

    await editLaunchOption(h.hooks, builtin)
    await removeLaunchOption(h.hooks, builtin)

    expect(h.calls).toEqual([])
    expect(h.alerts).toHaveLength(2)
    expect(h.alerts[0]).toContain("Built-in")
    expect(h.alerts[1]).toContain("Built-in")
  })

  test("removes a custom option after confirmation", async () => {
    const h = harness({ confirm: true })

    await removeLaunchOption(h.hooks, customOption)

    expect(h.calls).toEqual([["settings", "launch", "remove", "custom-1"]])
  })

  test("hides and moves a custom option", async () => {
    const h = harness()

    await setLaunchOptionHidden(h.hooks, customOption, true)
    await moveLaunchOption(h.hooks, customOption, true)

    expect(h.calls).toEqual([
      ["settings", "launch", "hide", "custom-1", "true"],
      ["settings", "launch", "move", "custom-1", "up"],
    ])
  })
})
