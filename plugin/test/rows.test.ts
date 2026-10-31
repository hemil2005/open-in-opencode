import { describe, expect, test } from "bun:test"

import { defaultLaunchOptions } from "../lib/types"
import { buildRows, type Row, type RowModel } from "../ui/rows"
import {
  doctor,
  doctorWith,
  makeSnapshot,
  ocshellPath,
  settings,
  settingsWith,
  update,
} from "./fixtures"

function byId(model: RowModel, id: string): Row {
  const found = model.rows.find((row) => row.id === id)
  if (!found) throw new Error(`missing row: ${id}`)
  return found
}

describe("buildRows", () => {
  test("builds the four sections in display order", () => {
    const model = buildRows(makeSnapshot())

    expect(model.sections.map((section) => section.title)).toEqual([
      "Status",
      "Configuration",
      "Maintenance",
      "Advanced",
    ])
    expect(model.rows.map((row) => row.id)).toEqual([
      "package",
      "certificate",
      "ocshell",
      "opencode",
      "settings",
      "terminal",
      "binaryPath",
      "continueFromProjectRoot",
      "logging",
      "updateUri",
      "updates",
      "diagnostics",
      "terminalMode",
      "launchOptions",
      "launchAdd",
    ])
  })

  test("never duplicates row ids", () => {
    const model = buildRows(makeSnapshot())
    expect(new Set(model.rows.map((row) => row.id)).size).toBe(model.rows.length)
  })

  test("gives every row a label, value, and action", () => {
    const model = buildRows(makeSnapshot())

    for (const row of model.rows) {
      expect(row.label.trim().length).toBeGreaterThan(0)
      expect(row.value.trim().length).toBeGreaterThan(0)
      expect(row.action.length).toBeGreaterThan(0)
    }
  })

  test("shows live status values and tones", () => {
    const model = buildRows(makeSnapshot())

    expect(byId(model, "package")).toMatchObject({
      value: doctor.package,
      tone: "normal",
      copy: doctor.package,
    })
    expect(byId(model, "certificate")).toMatchObject({
      value: "trusted",
      tone: "success",
    })
    expect(byId(model, "ocshell")).toMatchObject({
      value: ocshellPath,
      tone: "success",
      copy: ocshellPath,
    })
    expect(byId(model, "opencode")).toMatchObject({
      value: "auto (npm)",
      tone: "success",
      copy: doctor.binaryPath,
    })
    expect(byId(model, "settings")).toMatchObject({
      value: doctor.settingsPath,
      tone: "success",
      copy: doctor.settingsPath,
    })
  })

  test("shows configuration values", () => {
    const model = buildRows(makeSnapshot())

    expect(byId(model, "terminal")).toMatchObject({
      value: "WezTerm (GUI) (wezterm-gui)",
      tone: "normal",
    })
    expect(byId(model, "binaryPath")).toMatchObject({
      value: "auto (npm)",
      tone: "muted",
    })
    expect(byId(model, "continueFromProjectRoot").value).toBe("off")
    expect(byId(model, "logging").value).toBe("off")
    expect(byId(model, "updateUri")).toMatchObject({
      value: "built-in",
      tone: "muted",
    })
  })

  test("reflects boolean settings in toggle rows", () => {
    const model = buildRows(
      makeSnapshot({
        settings: settingsWith({ continueFromProjectRoot: true, logging: true }),
      }),
    )

    expect(byId(model, "continueFromProjectRoot").value).toBe("on")
    expect(byId(model, "logging").value).toBe("on")
  })

  test("shows custom rows only in custom terminal mode", () => {
    const automatic = buildRows(makeSnapshot())
    expect(automatic.rows.some((row) => row.id === "customPath")).toBe(false)
    expect(automatic.rows.some((row) => row.id === "customArgs")).toBe(false)

    const custom = buildRows(
      makeSnapshot({
        settings: settingsWith({
          terminal: {
            mode: "custom",
            customPath: "C:\\Tools\\wt.exe",
            customArgs: ["--foo", "bar baz"],
          },
        }),
      }),
    )

    expect(byId(custom, "customPath")).toMatchObject({
      value: "C:\\Tools\\wt.exe",
      tone: "normal",
    })
    expect(byId(custom, "customArgs")).toMatchObject({
      value: '--foo "bar baz"',
      tone: "normal",
    })
  })

  test("warns for a custom mode without a path", () => {
    const model = buildRows(
      makeSnapshot({
        settings: settingsWith({
          terminal: { mode: "custom", customPath: "", customArgs: [] },
        }),
      }),
    )

    expect(byId(model, "customPath").tone).toBe("warning")
    expect(byId(model, "customArgs").tone).toBe("muted")
  })

  test("shows update states", () => {
    const available = buildRows(makeSnapshot())
    expect(byId(available, "updates")).toMatchObject({
      value: "0.8.0.0 available",
      tone: "warning",
    })

    const current = buildRows(
      makeSnapshot({ update: { ...update, updateAvailable: false, available: "0.7.0.1" } }),
    )
    expect(byId(current, "updates")).toMatchObject({
      value: "up to date",
      tone: "success",
    })

    const unchecked = buildRows(makeSnapshot({ update: null }))
    expect(byId(unchecked, "updates")).toMatchObject({
      value: "not checked",
      tone: "muted",
    })

    const failed = buildRows(
      makeSnapshot({
        update: null,
        errors: [{ kind: "exit", source: "update", message: "update source is not configured" }],
      }),
    )
    expect(byId(failed, "updates")).toMatchObject({
      value: "check failed",
      tone: "error",
    })
    expect(byId(failed, "updates").detail).toContain("not configured")
    expect(byId(failed, "diagnostics")).toMatchObject({
      value: "1 warning",
      tone: "warning",
    })
  })

  test("shows the health summary and reasons", () => {
    const healthy = buildRows(makeSnapshot())
    expect(byId(healthy, "diagnostics")).toMatchObject({
      value: "all checks passed",
      tone: "success",
      detail: "All checks passed.",
    })

    const broken = buildRows(
      makeSnapshot({ doctor: doctorWith({ binaryFound: false, binaryPath: "" }) }),
    )
    expect(byId(broken, "diagnostics").tone).toBe("error")
    expect(byId(broken, "diagnostics").value).toContain("issue")
    expect(byId(broken, "opencode").value).toBe("NOT FOUND")
  })

  test("disables writes when ocshell is missing", () => {
    const model = buildRows(makeSnapshot({ ocshellPath: null }))

    for (const id of [
      "terminal",
      "binaryPath",
      "continueFromProjectRoot",
      "logging",
      "updateUri",
      "updates",
      "terminalMode",
      "launchOptions",
      "launchAdd",
    ]) {
      expect(byId(model, id).disabled).toBe(true)
      expect(byId(model, id).disabledReason).toBe("ocshell.exe was not found.")
    }

    expect(byId(model, "package").disabled).toBeUndefined()
    expect(byId(model, "diagnostics").disabled).toBeUndefined()
  })

  test("disables writes when settings are unavailable", () => {
    const model = buildRows(makeSnapshot({ settings: null }))

    expect(byId(model, "terminal")).toMatchObject({
      value: "unavailable",
      tone: "error",
      disabled: true,
      disabledReason: "Settings are unavailable.",
    })
    expect(byId(model, "continueFromProjectRoot").value).toBe("unavailable")
    expect(byId(model, "updateUri").value).toBe("unavailable")
    expect(model.rows.some((row) => row.id === "customPath")).toBe(false)
  })

  test("shows launch option summary and the add limit", () => {
    const model = buildRows(makeSnapshot())
    expect(byId(model, "launchOptions")).toMatchObject({
      value: "3 shown, 0/3 custom",
      action: "launchOptions",
    })
    expect(byId(model, "launchAdd")).toMatchObject({
      value: "0/3 custom",
      action: "launchAdd",
    })

    const custom = {
      id: "custom-1",
      label: "Fast model",
      flags: "--model fast",
      builtin: false,
      hidden: false,
    }
    const one = buildRows(
      makeSnapshot({
        settings: settingsWith({
          launchOptions: [...defaultLaunchOptions(), custom],
        }),
      }),
    )
    expect(byId(one, "launchOptions").value).toBe("4 shown, 1/3 custom")

    const full = buildRows(
      makeSnapshot({
        settings: settingsWith({
          launchOptions: [
            ...defaultLaunchOptions(),
            custom,
            { ...custom, id: "custom-2", label: "Second" },
            { ...custom, id: "custom-3", label: "Third" },
          ],
        }),
      }),
    )
    expect(byId(full, "launchAdd")).toMatchObject({
      value: "3/3 custom",
      disabled: true,
      disabledReason: "3 custom launch options already defined.",
    })
  })

  test("keeps row ids stable across refreshes", () => {
    const before = buildRows(makeSnapshot())
    const after = buildRows(
      makeSnapshot({
        settings: settingsWith({ logging: true }),
        update: { ...update, updateAvailable: false },
      }),
    )

    expect(after.rows.map((row) => row.id)).toEqual(before.rows.map((row) => row.id))
  })

  test("uses the settings fixture for terminal mode", () => {
    expect(settings.terminal.mode).toBe("auto")
    expect(buildRows(makeSnapshot()).rows.find((row) => row.id === "terminalMode")?.value).toBe(
      "auto",
    )
  })
})
