/**
 * Types and runtime shape guards for the JSON emitted by ocshell.exe.
 *
 * The CLI is the source of truth. These decoders are intentionally strict: a
 * missing or mistyped field is reported as a `shape` error instead of being
 * silently rendered as an empty value in the dashboard.
 */

export type Doctor = {
  version: string
  settingsPath: string
  settingsLoaded: boolean
  settingsWarning: string
  binaryFound: boolean
  binaryPath: string
  binarySource: string
  package: string
  certificate: string
  terminalCount: number
  terminal: string
}

export type TerminalMode = "auto" | "default" | "custom"

export type TerminalSettings = {
  mode: TerminalMode
  id: string
  customPath: string
  customArgs: string[]
}

export type LaunchOption = {
  id: string
  label: string
  flags: string
  builtin: boolean
  hidden: boolean
}

export type Settings = {
  version: number
  binaryPath: string
  updateUri: string
  continueFromProjectRoot: boolean
  logging: boolean
  terminal: TerminalSettings
  launchOptions: LaunchOption[]
}

export type Terminal = {
  id: string
  name: string
  path: string
  supported: boolean
}

export type UpdateInfo = {
  current: string
  available: string
  updateAvailable: boolean
  bundleUri: string
  installerUri: string
}

export type RunResult = {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  aborted: boolean
  truncated: boolean
}

/** The failure modes a single ocshell command can produce. */
export type FailureKind = "not-found" | "exit" | "timeout" | "aborted" | "parse" | "shape"

/** The dashboard area that produced an error. */
export type ErrorSource = "doctor" | "settings" | "terminals" | "update" | "write"

export type SourceError = {
  kind: FailureKind
  source?: ErrorSource
  message: string
  command?: string
  code?: number | null
  stderr?: string
  stdout?: string
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: SourceError }

/**
 * Everything the dashboard renders. Any source can fail without blanking the
 * rest of the page; failures are kept in `errors`.
 */
export type Snapshot = {
  ocshellPath: string | null
  doctor: Doctor | null
  settings: Settings | null
  terminals: Terminal[]
  update: UpdateInfo | null
  updateCheckedAt?: number | null
  errors: SourceError[]
}

/** Thrown by the decoders below when JSON does not match the CLI contract. */
export class ShapeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ShapeError"
  }
}

type JsonObject = Record<string, unknown>

function asObject(value: unknown, path: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ShapeError(`${path} must be an object`)
  }
  return value as JsonObject
}

function field(object: JsonObject, key: string, path: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(object, key)) {
    throw new ShapeError(`${path}.${key} is missing`)
  }
  return object[key]
}

function asString(value: unknown, path: string): string {
  if (typeof value !== "string") throw new ShapeError(`${path} must be a string`)
  return value
}

function asBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new ShapeError(`${path} must be a boolean`)
  return value
}

function asNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ShapeError(`${path} must be a number`)
  }
  return value
}

function asStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new ShapeError(`${path} must be an array`)
  return value.map((item, index) => asString(item, `${path}[${index}]`))
}

function asTerminalMode(value: unknown, path: string): TerminalMode {
  const mode = asString(value, path)
  if (mode !== "auto" && mode !== "default" && mode !== "custom") {
    throw new ShapeError(`${path} must be auto, default or custom`)
  }
  return mode
}

export function decodeDoctor(value: unknown): Doctor {
  const root = asObject(value, "doctor")
  return {
    version: asString(field(root, "version", "doctor"), "doctor.version"),
    settingsPath: asString(field(root, "settingsPath", "doctor"), "doctor.settingsPath"),
    settingsLoaded: asBoolean(field(root, "settingsLoaded", "doctor"), "doctor.settingsLoaded"),
    settingsWarning: asString(field(root, "settingsWarning", "doctor"), "doctor.settingsWarning"),
    binaryFound: asBoolean(field(root, "binaryFound", "doctor"), "doctor.binaryFound"),
    binaryPath: asString(field(root, "binaryPath", "doctor"), "doctor.binaryPath"),
    binarySource: asString(field(root, "binarySource", "doctor"), "doctor.binarySource"),
    package: asString(field(root, "package", "doctor"), "doctor.package"),
    certificate: asString(field(root, "certificate", "doctor"), "doctor.certificate"),
    terminalCount: asNumber(field(root, "terminalCount", "doctor"), "doctor.terminalCount"),
    terminal: asString(field(root, "terminal", "doctor"), "doctor.terminal"),
  }
}

export function defaultLaunchOptions(): LaunchOption[] {
  return [
    { id: "new", label: "New session", flags: "", builtin: true, hidden: false },
    {
      id: "continue",
      label: "Continue last session",
      flags: "--continue",
      builtin: true,
      hidden: false,
    },
    {
      id: "skip",
      label: "Skip permission prompts",
      flags: "--auto",
      builtin: true,
      hidden: false,
    },
  ]
}

function decodeLaunchOption(value: unknown, path: string): LaunchOption {
  const root = asObject(value, path)
  return {
    id: asString(field(root, "id", path), `${path}.id`),
    label: asString(field(root, "label", path), `${path}.label`),
    flags: asString(field(root, "flags", path), `${path}.flags`),
    builtin: asBoolean(field(root, "builtin", path), `${path}.builtin`),
    hidden: asBoolean(field(root, "hidden", path), `${path}.hidden`),
  }
}

export function decodeLaunchOptions(value: unknown): LaunchOption[] {
  // Settings written by older CLI versions do not have this field.
  if (value === undefined) return defaultLaunchOptions()
  if (!Array.isArray(value)) throw new ShapeError("settings.launchOptions must be an array")
  return value.map((item, index) =>
    decodeLaunchOption(item, `settings.launchOptions[${index}]`),
  )
}

export function decodeSettings(value: unknown): Settings {
  const root = asObject(value, "settings")
  const terminal = asObject(field(root, "terminal", "settings"), "settings.terminal")
  return {
    version: asNumber(field(root, "version", "settings"), "settings.version"),
    binaryPath: asString(field(root, "binaryPath", "settings"), "settings.binaryPath"),
    updateUri: asString(field(root, "updateUri", "settings"), "settings.updateUri"),
    continueFromProjectRoot: asBoolean(
      field(root, "continueFromProjectRoot", "settings"),
      "settings.continueFromProjectRoot",
    ),
    logging: asBoolean(field(root, "logging", "settings"), "settings.logging"),
    terminal: {
      mode: asTerminalMode(field(terminal, "mode", "settings.terminal"), "settings.terminal.mode"),
      id: asString(field(terminal, "id", "settings.terminal"), "settings.terminal.id"),
      customPath: asString(
        field(terminal, "customPath", "settings.terminal"),
        "settings.terminal.customPath",
      ),
      customArgs: asStringArray(
        field(terminal, "customArgs", "settings.terminal"),
        "settings.terminal.customArgs",
      ),
    },
    launchOptions: decodeLaunchOptions(root.launchOptions),
  }
}

function decodeTerminal(value: unknown, path: string): Terminal {
  const root = asObject(value, path)
  return {
    id: asString(field(root, "id", path), `${path}.id`),
    name: asString(field(root, "name", path), `${path}.name`),
    path: asString(field(root, "path", path), `${path}.path`),
    supported: asBoolean(field(root, "supported", path), `${path}.supported`),
  }
}

export function decodeTerminals(value: unknown): Terminal[] {
  if (!Array.isArray(value)) throw new ShapeError("terminals must be an array")
  return value.map((item, index) => decodeTerminal(item, `terminals[${index}]`))
}

export function decodeUpdateInfo(value: unknown): UpdateInfo {
  const root = asObject(value, "update")
  return {
    current: asString(field(root, "current", "update"), "update.current"),
    available: asString(field(root, "available", "update"), "update.available"),
    updateAvailable: asBoolean(field(root, "updateAvailable", "update"), "update.updateAvailable"),
    bundleUri: asString(field(root, "bundleUri", "update"), "update.bundleUri"),
    installerUri: asString(field(root, "installerUri", "update"), "update.installerUri"),
  }
}
