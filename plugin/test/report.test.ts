import { describe, expect, test } from "bun:test"

import { buildChecks, buildReport, copyText } from "../lib/report"
import { doctor, doctorWith, makeSnapshot, ocshellPath, update } from "./fixtures"

const generatedAt = new Date("2026-10-31T12:34:56.000Z")

describe("buildReport", () => {
  test("includes every doctor, settings, terminal, and update field", () => {
    const report = buildReport(makeSnapshot(), generatedAt)

    expect(report).toContain("Open in OpenCode diagnostics")
    expect(report).toContain("Generated: 2026-10-31T12:34:56.000Z")
    expect(report).toContain("Health: ok (all checks passed)")
    expect(report).toContain("Reasons: (none)")

    expect(report).toContain(`Package: ${doctor.package}`)
    expect(report).toContain("Certificate: trusted")
    expect(report).toContain(`ocshell: ${ocshellPath}`)
    expect(report).toContain("ocshell version: 0.7.0.1")
    expect(report).toContain("opencode: auto (npm)")
    expect(report).toContain(`opencode path: ${doctor.binaryPath}`)
    expect(report).toContain("opencode source: npm")
    expect(report).toContain("opencode found: yes")
    expect(report).toContain(`Settings: ${doctor.settingsPath}`)
    expect(report).toContain("Settings loaded: yes")
    expect(report).toContain("Settings warning: (none)")
    expect(report).toContain("Terminal count: 8")
    expect(report).toContain("Terminal: wezterm-gui")

    expect(report).toContain("Terminal: WezTerm (GUI) (wezterm-gui)")
    expect(report).toContain("opencode path: auto")
    expect(report).toContain("Continue root: off")
    expect(report).toContain("Logging: off")
    expect(report).toContain("Update source: built-in")
    expect(report).toContain("Settings version: 1")
    expect(report).toContain("Settings binaryPath: (empty)")
    expect(report).toContain("Settings updateUri: (empty)")
    expect(report).toContain("Settings continueFromProjectRoot: no")
    expect(report).toContain("Settings logging: no")
    expect(report).toContain("Terminal mode: auto")
    expect(report).toContain("Terminal id: wezterm-gui")
    expect(report).toContain("Terminal custom path: (empty)")
    expect(report).toContain("Terminal custom args: (none)")

    expect(report).toContain("Updates: 0.8.0.0 available")
    expect(report).toContain("Update current: 0.7.0.1")
    expect(report).toContain("Update available version: 0.8.0.0")
    expect(report).toContain("Update available?: yes")
    expect(report).toContain("Update bundle: https://example.test/OpenInOpenCode.msix")
    expect(report).toContain("Update installer: https://example.test/OpenInOpenCode.appinstaller")
    expect(report).toContain("Update checked: never")
    expect(report).toContain("Diagnostics: all checks passed")

    expect(report).toContain("Custom path: not set")
    expect(report).toContain("Custom args: not set")

    expect(report).toContain(
      "[supported] WezTerm (GUI) (wezterm-gui): C:\\Program Files\\WezTerm\\wezterm-gui.exe",
    )
    expect(report).toContain(
      "[unsupported] Git Bash (git-bash): C:\\Program Files\\Git\\git-bash.exe",
    )

    expect(report).toContain("Errors\n  (none)")
    expect(report).not.toContain("undefined")
  })

  test("renders partial snapshots without undefined values", () => {
    const report = buildReport(
      makeSnapshot({
        ocshellPath: null,
        doctor: null,
        settings: null,
        terminals: [],
        update: null,
        errors: [
          {
            kind: "not-found",
            source: "doctor",
            message: "ocshell.exe was not found.",
          },
        ],
      }),
      generatedAt,
    )

    expect(report).toContain("Package: not installed")
    expect(report).toContain("Certificate: unavailable")
    expect(report).toContain("ocshell: not found")
    expect(report).toContain("ocshell version: unavailable")
    expect(report).toContain("opencode: unavailable")
    expect(report).toContain("opencode found: (unknown)")
    expect(report).toContain("Settings: unavailable")
    expect(report).toContain("Terminal: unavailable")
    expect(report).toContain("Updates: not checked")
    expect(report).toContain("Diagnostics: 3 issues")
    expect(report).toContain("ocshell.exe was not found.")
    expect(report).not.toContain("undefined")
  })

  test("renders full error details", () => {
    const report = buildReport(
      makeSnapshot({
        errors: [
          {
            kind: "exit",
            source: "settings",
            message: "settings could not be read",
            command: "ocshell.exe settings list --json",
            code: 1,
            stderr: "error: bad settings\nline two",
            stdout: "partial output",
          },
        ],
      }),
      generatedAt,
    )

    expect(report).toContain("1. exit (settings): settings could not be read")
    expect(report).toContain("command: ocshell.exe settings list --json")
    expect(report).toContain("code: 1")
    expect(report).toContain("stderr:")
    expect(report).toContain("error: bad settings")
    expect(report).toContain("line two")
    expect(report).toContain("stdout:")
    expect(report).toContain("partial output")
  })

  test("renders health warnings and reasons", () => {
    const report = buildReport(
      makeSnapshot({ doctor: doctorWith({ certificate: "untrusted" }) }),
      generatedAt,
    )

    expect(report).toContain("Health: warn (1 warning)")
    expect(report).toContain("Reasons:")
    expect(report).toContain("certificate is untrusted.")
    expect(report).toContain("Diagnostics: 1 warning")
  })

  test("treats an update check failure as a health warning", () => {
    const report = buildReport(
      makeSnapshot({
        update: null,
        errors: [{ kind: "exit", source: "update", message: "no update source" }],
      }),
      generatedAt,
    )

    expect(report).toContain("Health: warn (1 warning)")
    expect(report).toContain("update check failed.")
  })

  test("renders the update cache timestamp", () => {
    const report = buildReport(
      makeSnapshot({ updateCheckedAt: Date.parse("2026-10-31T11:00:00.000Z") }),
      generatedAt,
    )

    expect(report).toContain("Update checked: 2026-10-31T11:00:00.000Z")
  })

  test("renders every section even when the snapshot is empty", () => {
    const report = buildReport(
      makeSnapshot({
        ocshellPath: null,
        doctor: null,
        settings: null,
        terminals: [],
        update: null,
        errors: [],
      }),
      generatedAt,
    )

    for (const section of [
      "Status",
      "Configuration",
      "Maintenance",
      "Advanced",
      "Terminals",
      "Errors",
    ]) {
      expect(report).toContain(section)
    }
    expect(report).toContain("Errors\n  (none)")
  })

  test("uses the fixture update data", () => {
    expect(update.updateAvailable).toBe(true)
    expect(buildReport(makeSnapshot(), generatedAt)).toContain("Updates: 0.8.0.0 available")
  })
})

describe("buildChecks", () => {
  test("reports each dashboard check", () => {
    const checks = buildChecks(makeSnapshot())

    expect(checks.map((check) => check.id)).toEqual([
      "ocshell",
      "package",
      "certificate",
      "opencode",
      "settings",
      "terminals",
      "update",
    ])
    expect(checks.every((check) => check.detail.length > 0)).toBe(true)
    expect(checks.find((check) => check.id === "terminals")).toMatchObject({
      level: "ok",
      detail: "1 supported of 2 detected.",
    })
    expect(checks.find((check) => check.id === "update")).toMatchObject({
      level: "warn",
      detail: "0.8.0.0 available",
    })
  })

  test("reports missing sources and update failures", () => {
    const checks = buildChecks(
      makeSnapshot({
        ocshellPath: null,
        doctor: null,
        settings: null,
        terminals: [],
        update: null,
        errors: [{ kind: "exit", source: "update", message: "no update source" }],
      }),
    )

    expect(checks.find((check) => check.id === "ocshell")?.level).toBe("error")
    expect(checks.find((check) => check.id === "opencode")?.level).toBe("error")
    expect(checks.find((check) => check.id === "settings")?.level).toBe("warn")
    expect(checks.find((check) => check.id === "terminals")?.level).toBe("warn")
    expect(checks.find((check) => check.id === "update")).toMatchObject({
      level: "warn",
      detail: "no update source",
    })
  })
})

describe("copyText", () => {
  test("prefers OSC 52", async () => {
    const calls: string[] = []

    const result = await copyText("report", {
      osc52: () => {
        calls.push("osc52")
        return true
      },
      clip: async () => {
        calls.push("clip")
        return true
      },
      tempFile: async () => {
        calls.push("file")
        return "report.txt"
      },
    })

    expect(result).toEqual({ ok: true, method: "osc52" })
    expect(calls).toEqual(["osc52"])
  })

  test("falls back to clip.exe", async () => {
    const calls: string[] = []

    const result = await copyText("report", {
      osc52: () => {
        calls.push("osc52")
        return false
      },
      clip: async () => {
        calls.push("clip")
        return true
      },
      tempFile: async () => {
        calls.push("file")
        return "report.txt"
      },
    })

    expect(result).toEqual({ ok: true, method: "clip" })
    expect(calls).toEqual(["osc52", "clip"])
  })

  test("falls back to a temp file", async () => {
    const calls: string[] = []

    const result = await copyText("report", {
      osc52: () => {
        calls.push("osc52")
        throw new Error("no OSC 52")
      },
      clip: async () => {
        calls.push("clip")
        return false
      },
      tempFile: async () => {
        calls.push("file")
        return "C:\\Temp\\report.txt"
      },
    })

    expect(result).toEqual({ ok: true, method: "file", path: "C:\\Temp\\report.txt" })
    expect(calls).toEqual(["osc52", "clip", "file"])
  })

  test("reports a failure when every transport fails", async () => {
    const result = await copyText("report", {
      osc52: () => false,
      clip: async () => {
        throw new Error("clip missing")
      },
      tempFile: async () => {
        throw new Error("disk full")
      },
    })

    expect(result).toEqual({ ok: false, message: "disk full" })
  })
})
