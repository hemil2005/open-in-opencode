import { describe, expect, test } from "bun:test"

import {
  filterTerminals,
  formatArgs,
  formatBinary,
  formatTerminal,
  formatUpdate,
  health,
  sortTerminals,
  truncateMiddle,
  validateBinaryPath,
  validateCustomArgs,
  validateUpdateUri,
  type FileProbe,
} from "../lib/format"
import { doctor, doctorWith, settings, settingsWith, terminals, update } from "./fixtures"

const fileProbe: FileProbe = () => "file"
const directoryProbe: FileProbe = () => "directory"
const missingProbe: FileProbe = () => "missing"

describe("formatTerminal", () => {
  test("handles unavailable settings", () => {
    expect(formatTerminal(null, terminals)).toBe("unavailable")
  })

  test("shows Windows default for default mode", () => {
    const value = settingsWith({ terminal: { mode: "default" } })
    expect(formatTerminal(value, terminals)).toBe("Windows default")
  })

  test("shows the custom path, or a clear placeholder", () => {
    expect(
      formatTerminal(
        settingsWith({
          terminal: { mode: "custom", customPath: "C:\\Tools\\wt.exe" },
        }),
        terminals,
      ),
    ).toBe("C:\\Tools\\wt.exe")

    expect(formatTerminal(settingsWith({ terminal: { mode: "custom" } }), terminals)).toBe(
      "custom (path not set)",
    )
  })

  test("resolves the selected terminal by id", () => {
    expect(formatTerminal(settings, terminals)).toBe("WezTerm (GUI) (wezterm-gui)")
    expect(formatTerminal(settingsWith({ terminal: { id: "git-bash" } }), terminals)).toBe(
      "Git Bash (git-bash)",
    )
    expect(formatTerminal(settingsWith({ terminal: { id: "ghost" } }), terminals)).toBe(
      "ghost (not detected)",
    )
  })

  test("falls back to the first supported terminal when no id is set", () => {
    expect(formatTerminal(settingsWith({ terminal: { id: "" } }), terminals)).toBe(
      "WezTerm (GUI) (wezterm-gui)",
    )
  })

  test("reports when no supported terminal exists", () => {
    const unsupported = terminals.filter((terminal) => !terminal.supported)
    expect(formatTerminal(settingsWith({ terminal: { id: "" } }), unsupported)).toBe(
      "none detected",
    )
  })
})

describe("formatBinary", () => {
  test("handles unavailable doctor output", () => {
    expect(formatBinary(null)).toBe("unavailable")
  })

  test("reports a missing binary", () => {
    expect(formatBinary(doctorWith({ binaryFound: false, binaryPath: "" }))).toBe("NOT FOUND")
  })

  test("shows auto-detected sources", () => {
    expect(formatBinary(doctor)).toBe("auto (npm)")
    expect(formatBinary(doctorWith({ binarySource: "PATH" }))).toBe("auto (PATH)")
    expect(formatBinary(doctorWith({ binarySource: "" }))).toBe("auto")
  })

  test("shows explicit overrides as paths", () => {
    expect(
      formatBinary(
        doctorWith({
          binarySource: "settings",
          binaryPath: "C:\\Tools\\opencode.exe",
        }),
      ),
    ).toBe("C:\\Tools\\opencode.exe (settings)")

    expect(
      formatBinary(
        doctorWith({
          binarySource: "OPENCODE_SHELL_BINARY",
          binaryPath: "C:\\Tools\\opencode.exe",
        }),
      ),
    ).toBe("C:\\Tools\\opencode.exe (OPENCODE_SHELL_BINARY)")
  })
})

describe("formatUpdate", () => {
  test("covers every state", () => {
    expect(formatUpdate(null)).toBe("not checked")
    expect(formatUpdate(null, true)).toBe("check failed")
    expect(formatUpdate({ ...update, updateAvailable: false })).toBe("up to date")
    expect(formatUpdate(update)).toBe("0.8.0.0 available")
  })
})

describe("health", () => {
  test("is ok when everything checks out", () => {
    expect(health(doctor, settings, terminals, update)).toEqual({
      level: "ok",
      label: "all checks passed",
      reasons: [],
    })
  })

  test("is an error when doctor or ocshell is unavailable", () => {
    const result = health(null, settings, terminals, update)
    expect(result.level).toBe("error")
    expect(result.label).toBe("1 issue")
    expect(result.reasons.join(" ")).toContain("ocshell or doctor")
  })

  test("is an error when opencode is missing", () => {
    const result = health(doctorWith({ binaryFound: false }), settings, terminals, update)
    expect(result.level).toBe("error")
    expect(result.reasons).toContain("opencode executable not found.")
  })

  test("warns for certificate, settings, and terminal issues", () => {
    expect(health(doctorWith({ certificate: "untrusted" }), settings, terminals, update).level).toBe(
      "warn",
    )
    expect(health(doctor, null, terminals, update).level).toBe("warn")
    expect(
      health(doctorWith({ settingsLoaded: false }), settings, terminals, update).level,
    ).toBe("warn")
    expect(
      health(doctorWith({ settingsWarning: "using defaults" }), settings, terminals, update).level,
    ).toBe("warn")
    expect(health(doctor, settings, [], update).level).toBe("warn")
    expect(
      health(
        doctor,
        settings,
        terminals.filter((terminal) => !terminal.supported),
        update,
      ).level,
    ).toBe("warn")
  })

  test("warns for custom and auto terminal problems", () => {
    const custom = settingsWith({ terminal: { mode: "custom", customPath: "" } })
    expect(health(doctor, custom, terminals, update).reasons).toContain(
      "custom terminal path is not set.",
    )

    const ghost = settingsWith({ terminal: { id: "ghost" } })
    expect(health(doctor, ghost, terminals, update).reasons).toContain(
      "selected terminal ghost was not detected.",
    )

    const unsupported = settingsWith({ terminal: { id: "git-bash" } })
    expect(health(doctor, unsupported, terminals, update).reasons).toContain(
      "Git Bash is selected but unsupported.",
    )
  })

  test("counts warnings without duplicates", () => {
    const result = health(
      doctorWith({ certificate: "untrusted" }),
      null,
      [],
      update,
    )
    expect(result.level).toBe("warn")
    expect(result.label).toBe("3 warnings")
    expect(new Set(result.reasons).size).toBe(result.reasons.length)
  })

  test("warns when the update check fails", () => {
    const result = health(doctor, settings, terminals, update, true)
    expect(result.level).toBe("warn")
    expect(result.reasons).toContain("update check failed.")
  })
})

describe("truncateMiddle", () => {
  const value = "0123456789abcdefghij"

  test("keeps values that fit", () => {
    expect(truncateMiddle("short", 10)).toBe("short")
    expect(truncateMiddle(value, 20)).toBe(value)
    expect(truncateMiddle(value, 21)).toBe(value)
  })

  test("truncates in the middle", () => {
    expect(truncateMiddle(value, 10)).toBe("0123...hij")
    expect(truncateMiddle(value, 5)).toBe("0...j")
    expect(truncateMiddle(value, 4)).toBe("0...")
    expect(truncateMiddle(value, 3)).toBe("012")
  })

  test("handles tiny and invalid widths", () => {
    expect(truncateMiddle(value, 2)).toBe("01")
    expect(truncateMiddle(value, 1)).toBe("0")
    expect(truncateMiddle(value, 0)).toBe("")
    expect(truncateMiddle(value, -5)).toBe("")
    expect(truncateMiddle(value, Number.NaN)).toBe("")
  })
})

describe("terminal sorting and filtering", () => {
  test("sorts supported terminals first, then by name and id", () => {
    const unsorted = [
      { id: "z", name: "Zeta", path: "", supported: false },
      { id: "b", name: "beta", path: "", supported: true },
      { id: "a", name: "Alpha", path: "", supported: true },
      { id: "a2", name: "alpha", path: "", supported: true },
    ]

    expect(sortTerminals(unsorted).map((terminal) => terminal.id)).toEqual(["a", "a2", "b", "z"])
    expect(unsorted.map((terminal) => terminal.id)).toEqual(["z", "b", "a", "a2"])
  })

  test("filters by id, name, or path, case-insensitively", () => {
    expect(filterTerminals("", terminals)).toHaveLength(2)
    expect(filterTerminals("   ", terminals)).toHaveLength(2)
    expect(filterTerminals("WEZ", terminals).map((terminal) => terminal.id)).toEqual([
      "wezterm-gui",
    ])
    expect(filterTerminals("git", terminals).map((terminal) => terminal.id)).toEqual(["git-bash"])
    expect(filterTerminals("program files", terminals)).toHaveLength(2)
    expect(filterTerminals("nope", terminals)).toEqual([])
  })
})

describe("validateBinaryPath", () => {
  test("accepts - as the clear value", () => {
    expect(validateBinaryPath("-", fileProbe)).toEqual({ ok: true, value: "" })
    expect(validateBinaryPath("  -  ", fileProbe)).toEqual({ ok: true, value: "" })
  })

  test("accepts absolute files and strips quotes", () => {
    expect(validateBinaryPath("C:\\Tools\\opencode.exe", fileProbe)).toEqual({
      ok: true,
      value: "C:\\Tools\\opencode.exe",
    })
    expect(validateBinaryPath(' "C:\\Tools\\opencode.exe" ', fileProbe)).toEqual({
      ok: true,
      value: "C:\\Tools\\opencode.exe",
    })
    expect(validateBinaryPath("C:/Tools/opencode.exe", fileProbe)).toEqual({
      ok: true,
      value: "C:/Tools/opencode.exe",
    })
    expect(validateBinaryPath("\\\\server\\share\\opencode.exe", fileProbe)).toEqual({
      ok: true,
      value: "\\\\server\\share\\opencode.exe",
    })
  })

  test("rejects empty, relative, and root-relative paths", () => {
    expect(validateBinaryPath("", fileProbe).ok).toBe(false)
    expect(validateBinaryPath("tools\\opencode.exe", fileProbe).ok).toBe(false)
    expect(validateBinaryPath("opencode.exe", fileProbe).ok).toBe(false)
    expect(validateBinaryPath("\\Windows\\opencode.exe", fileProbe).ok).toBe(false)
  })

  test("rejects directories, missing files, and probe failures", () => {
    expect(validateBinaryPath("C:\\Tools\\opencode.exe", directoryProbe)).toEqual({
      ok: false,
      message: "That path is a directory. Choose opencode.exe.",
    })
    expect(validateBinaryPath("C:\\Tools\\opencode.exe", missingProbe)).toEqual({
      ok: false,
      message: "That file does not exist.",
    })
    expect(
      validateBinaryPath("C:\\Tools\\opencode.exe", () => {
        throw new Error("EACCES")
      }),
    ).toEqual({ ok: false, message: "That path could not be checked." })
  })
})

describe("validateUpdateUri", () => {
  test("accepts empty and - as built-in", () => {
    expect(validateUpdateUri("")).toEqual({ ok: true, value: "" })
    expect(validateUpdateUri("   ")).toEqual({ ok: true, value: "" })
    expect(validateUpdateUri("-")).toEqual({ ok: true, value: "" })
  })

  test("accepts http and https URLs", () => {
    expect(validateUpdateUri("https://example.test/appinstaller")).toEqual({
      ok: true,
      value: "https://example.test/appinstaller",
    })
    expect(validateUpdateUri("http://example.test")).toEqual({
      ok: true,
      value: "http://example.test",
    })
    expect(validateUpdateUri("HTTPS://EXAMPLE.TEST")).toEqual({
      ok: true,
      value: "HTTPS://EXAMPLE.TEST",
    })
  })

  test("rejects other schemes, spaces, and malformed URLs", () => {
    expect(validateUpdateUri("ftp://example.test").ok).toBe(false)
    expect(validateUpdateUri("file:///C:/update.xml").ok).toBe(false)
    expect(validateUpdateUri("https://example.test/a b").ok).toBe(false)
    expect(validateUpdateUri("example.test").ok).toBe(false)
    expect(validateUpdateUri("http://").ok).toBe(false)
    expect(validateUpdateUri("javascript:alert(1)").ok).toBe(false)
  })
})

describe("validateCustomArgs", () => {
  test("matches the CLI quote handling", () => {
    expect(validateCustomArgs("a \"b c\" d")).toEqual({
      ok: true,
      value: ["a", "b c", "d"],
    })
    expect(validateCustomArgs("a\t\"b c\"")).toEqual({
      ok: true,
      value: ["a", "b c"],
    })
    expect(validateCustomArgs("  a   b  ")).toEqual({ ok: true, value: ["a", "b"] })
    expect(validateCustomArgs("")).toEqual({ ok: true, value: [] })
    expect(validateCustomArgs('""')).toEqual({ ok: true, value: [] })
    expect(validateCustomArgs('"unterminated')).toEqual({
      ok: true,
      value: ["unterminated"],
    })
  })

  test("formats arguments for display", () => {
    expect(formatArgs([])).toBe("")
    expect(formatArgs(["a", "b"])).toBe("a b")
    expect(formatArgs(["b c"])).toBe('"b c"')
    expect(formatArgs([""])).toBe('""')
    expect(formatArgs(['a"b'])).toBe('"a\\"b"')
  })
})
