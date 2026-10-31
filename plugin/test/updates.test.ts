import { describe, expect, test } from "bun:test"

import type { RunOptions, Runner } from "../lib/ocshell"
import type { Result, RunResult } from "../lib/types"
import { applyUpdate } from "../ui/updates"

type Call = { args: string[]; options?: RunOptions }

function result(overrides: Partial<RunResult> = {}): RunResult {
  return {
    code: 0,
    stdout: "",
    stderr: "",
    timedOut: false,
    aborted: false,
    truncated: false,
    ...overrides,
  }
}

function fakeRunner(
  outcome: RunResult,
  chunks: string[] = [],
  calls: Call[] = [],
): Runner {
  return {
    resolve: () => "ocshell.exe",
    reset: () => {},
    run: async (args, options) => {
      calls.push({ args, options })
      for (const chunk of chunks) options?.onOutput?.("stdout", chunk)
      return outcome
    },
    json: async <T,>(): Promise<Result<T>> => ({
      ok: false,
      error: { kind: "exit", message: "unused" },
    }),
  }
}

describe("applyUpdate", () => {
  test("refuses to apply without an installed package", async () => {
    const calls: Call[] = []
    const outcome = await applyUpdate({
      runner: fakeRunner(result(), [], calls),
      packageName: "",
    })

    expect(outcome).toEqual({
      ok: false,
      needsElevation: false,
      error: {
        kind: "not-found",
        source: "update",
        message: "Install the MSIX package first.",
      },
    })
    expect(calls).toEqual([])
  })

  test("applies with the ten minute timeout and streams the last five lines", async () => {
    const calls: Call[] = []
    const progress: string[][] = []
    const outcome = await applyUpdate({
      runner: fakeRunner(result(), ["one\ntwo\n", "three\nfour\n", "five\nsix\nseven\n"], calls),
      packageName: "OpenInOpenCode_0.7.0.1_x64__jqs6rpst54t28",
      onProgress: (lines) => progress.push(lines),
    })

    expect(outcome).toEqual({ ok: true })
    expect(calls[0]?.options?.timeoutMs).toBe(600_000)
    expect(progress.at(-1)).toEqual(["three", "four", "five", "six", "seven"])
  })

  test("detects elevation failures", async () => {
    const outcome = await applyUpdate({
      runner: fakeRunner(
        result({
          code: 5,
          stderr: "Access is denied. The installer requires elevation.",
        }),
      ),
      packageName: "OpenInOpenCode_0.7.0.1_x64__jqs6rpst54t28",
    })

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.needsElevation).toBe(true)
      expect(outcome.error.kind).toBe("exit")
      expect(outcome.error.source).toBe("update")
      expect(outcome.error.message).toContain("approve elevation")
      expect(outcome.error.stderr).toContain("Access is denied")
    }
  })

  test("treats a timeout as an elevation candidate", async () => {
    const outcome = await applyUpdate({
      runner: fakeRunner(result({ code: null, timedOut: true })),
      packageName: "OpenInOpenCode_0.7.0.1_x64__jqs6rpst54t28",
    })

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.needsElevation).toBe(true)
      expect(outcome.error.kind).toBe("timeout")
      expect(outcome.error.message).toContain("timed out")
      expect(outcome.error.message).toContain("approve elevation")
    }
  })

  test("reports an abort without an elevation hint", async () => {
    const outcome = await applyUpdate({
      runner: fakeRunner(result({ code: null, aborted: true })),
      packageName: "OpenInOpenCode_0.7.0.1_x64__jqs6rpst54t28",
    })

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.needsElevation).toBe(false)
      expect(outcome.error.kind).toBe("aborted")
      expect(outcome.error.message).toContain("cancelled")
    }
  })

  test("uses the output for ordinary failures", async () => {
    const outcome = await applyUpdate({
      runner: fakeRunner(result({ code: 2, stderr: "installer failed" })),
      packageName: "OpenInOpenCode_0.7.0.1_x64__jqs6rpst54t28",
    })

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.needsElevation).toBe(false)
      expect(outcome.error.kind).toBe("exit")
      expect(outcome.error.message).toBe("installer failed")
      expect(outcome.error.code).toBe(2)
    }
  })
})
