import { spawn as nodeSpawn } from "node:child_process"
import { existsSync } from "node:fs"
import { win32 } from "node:path"

import type { Result, RunResult, SourceError } from "./types"

/**
 * The only module in the plugin that starts processes.
 *
 * `ocshell.exe` is resolved once and cached. All calls are asynchronous so the
 * OpenCode UI stays responsive, and every failure is returned as a typed value
 * rather than thrown.
 */

export const MAX_OUTPUT_BYTES = 1024 * 1024
export const READ_TIMEOUT_MS = 15_000
export const WRITE_TIMEOUT_MS = 60_000
export const UPDATE_TIMEOUT_MS = 10 * 60_000
export const UPDATE_CHECK_TIMEOUT_MS = 30_000

export type OutputStream = "stdout" | "stderr"

export type RunOptions = {
  timeoutMs?: number
  signal?: AbortSignal
  maxBytes?: number
  allowNonZero?: boolean
  onOutput?: (stream: OutputStream, text: string) => void
}

export type ProcessOptions = {
  timeoutMs?: number
  signal?: AbortSignal
  maxBytes?: number
  input?: string
  onOutput?: (stream: OutputStream, text: string) => void
  spawn?: SpawnFn
}

export type Runner = {
  resolve(): string | undefined
  reset(): void
  run(args: string[], options?: RunOptions): Promise<RunResult>
  json<T>(
    args: string[],
    decode: (value: unknown) => T,
    options?: RunOptions,
  ): Promise<Result<T>>
}

export type SpawnOptions = {
  windowsHide: boolean
  stdio: ["ignore" | "pipe", "pipe", "pipe"]
}

export type ChildStream = {
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown
}

export type ChildStdin = {
  end(input: string): void
}

export type ChildProcessLike = {
  stdin: ChildStdin | null
  stdout: ChildStream | null
  stderr: ChildStream | null
  on(event: string, listener: (...args: any[]) => void): unknown
  kill(signal?: NodeJS.Signals | number): boolean
}

export type SpawnFn = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcessLike

export type CreateRunnerOptions = {
  spawn?: SpawnFn
  resolve?: () => string | undefined
  platform?: NodeJS.Platform
}

export type ResolveOptions = {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  exists?: (path: string) => boolean
}

const NOT_FOUND_MESSAGE =
  "ocshell.exe was not found. Install Open in OpenCode or add its execution alias to PATH."

function stripQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1)
  }
  return value
}

/**
 * Resolve ocshell.exe without touching the filesystem beyond `existsSync`.
 *
 * Windows execution aliases live in `%LOCALAPPDATA%\Microsoft\WindowsApps` and
 * report EACCES from `statSync`; `existsSync` is the only reliable check.
 */
export function resolveOcshell(options: ResolveOptions = {}): string | undefined {
  const platform = options.platform ?? process.platform
  if (platform !== "win32") return undefined

  const env = options.env ?? process.env
  const exists = options.exists ?? existsSync

  const override = env.OCSHELL_PATH?.trim()
  if (override) {
    const candidate = stripQuotes(override)
    if (exists(candidate)) return candidate
  }

  const pathValue = env.PATH ?? env.Path ?? ""
  for (const entry of pathValue.split(win32.delimiter)) {
    const directory = stripQuotes(entry.trim())
    if (!directory) continue
    const candidate = win32.join(directory, "ocshell.exe")
    if (exists(candidate)) return candidate
  }

  const localAppData = env.LOCALAPPDATA?.trim()
  if (localAppData) {
    const candidate = win32.join(
      stripQuotes(localAppData),
      "Microsoft",
      "WindowsApps",
      "ocshell.exe",
    )
    if (exists(candidate)) return candidate
  }

  return undefined
}

const defaultSpawn: SpawnFn = (command, args, options) =>
  nodeSpawn(command, args, options) as unknown as ChildProcessLike

class Collector {
  private readonly decoder = new TextDecoder("utf-8")
  private readonly parts: string[] = []
  private bytes = 0
  truncated = false

  constructor(
    private readonly maxBytes: number,
    private readonly onText?: (text: string) => void,
  ) {}

  push(chunk: Buffer | string): void {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk
    if (this.bytes >= this.maxBytes) {
      if (buffer.length > 0) this.truncated = true
      return
    }

    const remaining = this.maxBytes - this.bytes
    const slice = buffer.length > remaining ? buffer.subarray(0, remaining) : buffer
    if (buffer.length > remaining) this.truncated = true
    if (slice.length === 0) return

    this.bytes += slice.length
    this.emit(slice, true)
  }

  finish(): string {
    const tail = this.decoder.decode()
    if (tail) {
      this.parts.push(tail)
      this.onText?.(tail)
    }
    return this.parts.join("")
  }

  private emit(slice: Uint8Array, stream: boolean): void {
    const text = this.decoder.decode(slice, { stream })
    if (!text) return
    this.parts.push(text)
    this.onText?.(text)
  }
}

function commandLine(args: string[]): string {
  return ["ocshell.exe", ...args].join(" ")
}

function emptyResult(stderr: string, aborted = false): RunResult {
  return {
    code: null,
    stdout: "",
    stderr,
    timedOut: false,
    aborted,
    truncated: false,
  }
}

function failure(
  kind: SourceError["kind"],
  message: string,
  args: string[],
  result?: RunResult,
): { ok: false; error: SourceError } {
  const error: SourceError = {
    kind,
    message,
    command: commandLine(args),
  }

  if (result) {
    error.code = result.code
    error.stderr = result.stderr
    error.stdout = result.stdout
  }

  return { ok: false, error }
}

async function execute(
  spawn: SpawnFn,
  command: string,
  args: string[],
  options: ProcessOptions,
): Promise<RunResult> {
  if (options.signal?.aborted) {
    return emptyResult("Command cancelled before it started.", true)
  }

  const maxBytes = options.maxBytes ?? MAX_OUTPUT_BYTES

  return new Promise<RunResult>((settle) => {
    const stdout = new Collector(maxBytes, (text) => options.onOutput?.("stdout", text))
    const stderr = new Collector(maxBytes, (text) => options.onOutput?.("stderr", text))
    let child: ChildProcessLike

    try {
      child = spawn(command, args, {
        windowsHide: true,
        stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      })
    } catch (error) {
      settle(emptyResult(error instanceof Error ? error.message : String(error)))
      return
    }

    let settled = false
    let timedOut = false
    let aborted = false
    let timer: ReturnType<typeof setTimeout> | undefined

    function finish(code: number | null): void {
      if (settled) return
      settled = true

      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }

      options.signal?.removeEventListener("abort", onAbort)

      settle({
        code,
        stdout: stdout.finish(),
        stderr: stderr.finish(),
        timedOut,
        aborted,
        truncated: stdout.truncated || stderr.truncated,
      })
    }

    function kill(): void {
      try {
        // This terminates the direct child only. An installer it already
        // spawned (notably from `update apply`) may keep running after a timeout.
        child.kill()
      } catch {
        // The child may already be gone; there is nothing else to clean up.
      }
    }

    function onAbort(): void {
      if (settled) return
      aborted = true
      kill()
      finish(null)
    }

    child.stdout?.on("data", (chunk) => stdout.push(chunk))
    child.stderr?.on("data", (chunk) => stderr.push(chunk))

    if (options.input !== undefined) {
      try {
        child.stdin?.end(options.input)
      } catch {
        // A child that closed stdin early is reported by its exit code.
      }
    }

    child.on("error", (error: Error) => {
      if (settled) return
      stderr.push(error instanceof Error ? error.message : String(error))
      finish(null)
    })

    child.on("close", (code: number | null) => {
      finish(code)
    })

    const timeoutMs = options.timeoutMs ?? READ_TIMEOUT_MS
    if (Number.isFinite(timeoutMs) && timeoutMs >= 0) {
      timer = setTimeout(() => {
        if (settled) return
        timedOut = true
        kill()
        finish(null)
      }, timeoutMs)
    }

    if (options.signal) {
      options.signal.addEventListener("abort", onAbort, { once: true })
      if (options.signal.aborted) onAbort()
    }
  })
}

/** Runs an arbitrary Windows executable. Used for the `clip.exe` fallback. */
export async function runProcess(
  command: string,
  args: string[],
  options: ProcessOptions = {},
): Promise<RunResult> {
  return execute(options.spawn ?? defaultSpawn, command, args, options)
}

export function createRunner(options: CreateRunnerOptions = {}): Runner {
  const spawn = options.spawn ?? defaultSpawn
  const platform = options.platform ?? process.platform

  let cached: string | undefined
  let resolved = false

  function resolve(): string | undefined {
    if (!resolved) {
      const value = options.resolve ? options.resolve() : resolveOcshell({ platform })
      cached = value && value.length > 0 ? value : undefined
      resolved = true
    }
    return cached
  }

  function reset(): void {
    cached = undefined
    resolved = false
  }

  async function run(args: string[], runOptions: RunOptions = {}): Promise<RunResult> {
    const binary = resolve()
    if (!binary) return emptyResult(NOT_FOUND_MESSAGE)
    return execute(spawn, binary, args, runOptions)
  }

  async function json<T>(
    args: string[],
    decode: (value: unknown) => T,
    runOptions: RunOptions = {},
  ): Promise<Result<T>> {
    if (!resolve()) {
      return failure("not-found", NOT_FOUND_MESSAGE, args)
    }

    const result = await run(args, runOptions)
    const command = commandLine(args)

    if (result.timedOut) {
      return failure("timeout", `${command} timed out.`, args, result)
    }

    if (result.aborted) {
      return failure("aborted", `${command} was cancelled.`, args, result)
    }

    if (result.code === null) {
      return failure("exit", result.stderr.trim() || `${command} could not be started.`, args, result)
    }

    if (result.code !== 0 && !runOptions.allowNonZero) {
      return failure(
        "exit",
        result.stderr.trim() || `${command} exited with code ${result.code}.`,
        args,
        result,
      )
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(result.stdout)
    } catch {
      return failure("parse", `${command} returned invalid JSON.`, args, result)
    }

    try {
      return { ok: true, value: decode(parsed) }
    } catch (error) {
      return failure(
        "shape",
        error instanceof Error ? error.message : `${command} returned an unexpected JSON shape.`,
        args,
        result,
      )
    }
  }

  return { resolve, reset, run, json }
}
