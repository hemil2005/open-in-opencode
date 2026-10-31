import { UPDATE_TIMEOUT_MS, type Runner } from "../lib/ocshell"
import type { SourceError } from "../lib/types"

/** Update apply flow. There is deliberately no cancel that pretends to stop the installer. */

export type ApplyUpdateOptions = {
  runner: Runner
  packageName: string
  signal?: AbortSignal
  onProgress?: (lines: string[]) => void
}

export type ApplyUpdateResult =
  | { ok: true }
  | { ok: false; error: SourceError; needsElevation: boolean }

const ELEVATION_PATTERN =
  /(access is denied|access denied|requires elevation|elevated|administrator|uac|permission denied)/i

function pushLines(lines: string[], text: string): void {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  for (const line of normalized.split("\n")) {
    if (!line) continue
    lines.push(line)
    while (lines.length > 5) lines.shift()
  }
}

export async function applyUpdate(options: ApplyUpdateOptions): Promise<ApplyUpdateResult> {
  if (!options.packageName.trim()) {
    return {
      ok: false,
      needsElevation: false,
      error: {
        kind: "not-found",
        source: "update",
        message: "Install the MSIX package first.",
      },
    }
  }

  const lines: string[] = []
  const result = await options.runner.run(["update", "apply"], {
    timeoutMs: UPDATE_TIMEOUT_MS,
    signal: options.signal,
    onOutput: (_stream, text) => {
      pushLines(lines, text)
      options.onProgress?.([...lines])
    },
  })

  if (result.code === 0) return { ok: true }

  const output = `${result.stdout}\n${result.stderr}`.trim()
  const needsElevation = result.timedOut || ELEVATION_PATTERN.test(output)
  const base = result.timedOut
    ? "The update timed out."
    : result.aborted
      ? "The update was cancelled."
      : output || `ocshell.exe update apply exited with code ${result.code}.`
  const message = needsElevation
    ? `${base}\nRun "ocshell update apply" in a terminal to approve elevation.`
    : base

  return {
    ok: false,
    needsElevation,
    error: {
      kind: result.timedOut ? "timeout" : result.aborted ? "aborted" : "exit",
      source: "update",
      message,
      command: "ocshell.exe update apply",
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
    },
  }
}
