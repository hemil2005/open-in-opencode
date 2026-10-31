import type { Doctor, Settings, Terminal, UpdateInfo } from "./types"

/**
 * Pure formatting, health, and validation helpers.
 *
 * This module deliberately imports no Node or Solid modules so it stays cheap
 * to test and safe to use from both the dashboard and the report builder.
 * Filesystem checks are injected through `FileProbe`.
 */

export type HealthLevel = "ok" | "warn" | "error"

export type Health = {
  level: HealthLevel
  label: string
  reasons: string[]
}

export type Validation<T = string> =
  | { ok: true; value: T }
  | { ok: false; message: string }

export type FileProbe = (path: string) => "file" | "directory" | "missing"

export function formatTerminal(settings: Settings | null, terminals: Terminal[]): string {
  if (!settings) return "unavailable"

  const { mode, id, customPath } = settings.terminal

  if (mode === "default") return "Windows default"
  if (mode === "custom") return customPath.trim() || "custom (path not set)"

  if (id) {
    const selected = terminals.find((terminal) => terminal.id === id)
    return selected ? `${selected.name} (${selected.id})` : `${id} (not detected)`
  }

  const automatic = terminals.find((terminal) => terminal.supported)
  return automatic ? `${automatic.name} (${automatic.id})` : "none detected"
}

export function formatBinary(doctor: Doctor | null): string {
  if (!doctor) return "unavailable"
  if (!doctor.binaryFound) return "NOT FOUND"

  const source = doctor.binarySource.trim()
  if (source === "settings" || source === "OPENCODE_SHELL_BINARY") {
    return doctor.binaryPath ? `${doctor.binaryPath} (${source})` : `auto (${source})`
  }

  return source ? `auto (${source})` : "auto"
}

export function formatUpdate(update: UpdateInfo | null, failed = false): string {
  if (failed) return "check failed"
  if (!update) return "not checked"
  return update.updateAvailable ? `${update.available} available` : "up to date"
}

export function health(
  doctor: Doctor | null,
  settings: Settings | null,
  terminals: Terminal[],
  update: UpdateInfo | null,
): Health {
  const reasons: string[] = []
  let level: HealthLevel = "ok"

  const fail = (reason: string) => {
    reasons.push(reason)
    level = "error"
  }

  const warn = (reason: string) => {
    reasons.push(reason)
    if (level !== "error") level = "warn"
  }

  if (!doctor) {
    fail("ocshell or doctor output is unavailable.")
  } else {
    if (!doctor.binaryFound) fail("opencode executable not found.")
    if (doctor.certificate !== "trusted") {
      warn(`certificate is ${doctor.certificate.trim() || "unknown"}.`)
    }
    if (!doctor.settingsLoaded) {
      warn("settings could not be loaded.")
    } else if (doctor.settingsWarning.trim()) {
      warn(`settings warning: ${doctor.settingsWarning.trim()}`)
    }
  }

  if (!settings) warn("settings are unavailable.")

  if (terminals.length === 0) {
    warn("no terminals detected.")
  } else if (!terminals.some((terminal) => terminal.supported)) {
    warn("no supported terminals detected.")
  }

  if (settings) {
    const { mode, id, customPath } = settings.terminal

    if (mode === "custom" && !customPath.trim()) {
      warn("custom terminal path is not set.")
    }

    if (mode === "auto" && id) {
      const selected = terminals.find((terminal) => terminal.id === id)
      if (!selected) {
        warn(`selected terminal ${id} was not detected.`)
      } else if (!selected.supported) {
        warn(`${selected.name} is selected but unsupported.`)
      }
    }
  }

  // An available update is shown in the Updates row, not treated as a health
  // problem. `update` is part of the signature so diagnostics can grow later.
  void update

  const unique = [...new Set(reasons)]

  return {
    level,
    label: healthLabel(level, unique.length),
    reasons: unique,
  }
}

function healthLabel(level: HealthLevel, count: number): string {
  if (level === "ok") return "all checks passed"
  if (level === "warn") return count === 1 ? "1 warning" : `${count} warnings`
  return count === 1 ? "1 issue" : `${count} issues`
}

export function truncateMiddle(value: string, width: number): string {
  const limit = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0
  if (limit === 0) return ""
  if (value.length <= limit) return value
  if (limit <= 3) return value.slice(0, limit)

  const available = limit - 3
  const left = Math.ceil(available / 2)
  const right = available - left
  const tail = right > 0 ? value.slice(-right) : ""

  return `${value.slice(0, left)}...${tail}`
}

export function sortTerminals(terminals: Terminal[]): Terminal[] {
  return [...terminals].sort((left, right) => {
    if (left.supported !== right.supported) return left.supported ? -1 : 1

    const leftName = left.name.toLowerCase()
    const rightName = right.name.toLowerCase()
    if (leftName < rightName) return -1
    if (leftName > rightName) return 1

    const leftId = left.id.toLowerCase()
    const rightId = right.id.toLowerCase()
    if (leftId < rightId) return -1
    if (leftId > rightId) return 1
    return 0
  })
}

export function filterTerminals(query: string, terminals: Terminal[]): Terminal[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...terminals]

  return terminals.filter((terminal) => {
    return (
      terminal.id.toLowerCase().includes(needle) ||
      terminal.name.toLowerCase().includes(needle) ||
      terminal.path.toLowerCase().includes(needle)
    )
  })
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

function isAbsoluteWindowsPath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value)
}

export function validateBinaryPath(value: string, probe: FileProbe): Validation {
  const path = unquote(value)

  if (!path) return { ok: false, message: "Enter a path, or - to auto-detect." }
  if (path === "-") return { ok: true, value: "" }

  if (!isAbsoluteWindowsPath(path)) {
    return { ok: false, message: "Use a full path, for example C:\\Tools\\opencode.exe." }
  }

  let kind: ReturnType<FileProbe>
  try {
    kind = probe(path)
  } catch {
    return { ok: false, message: "That path could not be checked." }
  }

  if (kind === "directory") {
    return { ok: false, message: "That path is a directory. Choose opencode.exe." }
  }
  if (kind === "missing") {
    return { ok: false, message: "That file does not exist." }
  }

  return { ok: true, value: path }
}

export function validateUpdateUri(value: string): Validation {
  const trimmed = value.trim()
  if (!trimmed || trimmed === "-") return { ok: true, value: "" }

  if (/\s/.test(trimmed)) {
    return { ok: false, message: "The URL cannot contain spaces." }
  }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return { ok: false, message: "Enter an http:// or https:// URL." }
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, message: "Enter an http:// or https:// URL." }
  }
  if (!url.hostname) {
    return { ok: false, message: "Enter an http:// or https:// URL with a host." }
  }

  return { ok: true, value: trimmed }
}

/**
 * Split custom terminal arguments the same way the CLI's `SplitArguments`
 * does: double quotes group words and are removed, space/tab separate words,
 * and empty words are dropped. This is intentionally not full shell quoting.
 */
export function validateCustomArgs(value: string): Validation<string[]> {
  const args: string[] = []
  let current = ""
  let inQuotes = false

  for (const character of value) {
    if (character === '"') {
      inQuotes = !inQuotes
      continue
    }

    if ((character === " " || character === "\t") && !inQuotes) {
      if (current) {
        args.push(current)
        current = ""
      }
      continue
    }

    current += character
  }

  if (current) args.push(current)

  return { ok: true, value: args }
}

export function formatArgs(args: string[]): string {
  return args.map(quoteArg).join(" ")
}

function quoteArg(value: string): string {
  if (value.length === 0) return '""'
  if (!/[\s"]/.test(value)) return value
  return `"${value.replace(/"/g, '\\"')}"`
}
