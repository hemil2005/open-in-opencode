import { formatArgs, formatBinary, formatTerminal, formatUpdate, health } from "./format"
import type { Snapshot } from "./types"

/**
 * Plain-text diagnostics report. It contains only values already visible in
 * the dashboard, plus the error details the dashboard can show in a dialog.
 */

export type CheckLevel = "ok" | "warn" | "error"

export type Check = {
  id: string
  label: string
  level: CheckLevel
  detail: string
}

export function buildChecks(snapshot: Snapshot): Check[] {
  const doctor = snapshot.doctor
  const settings = snapshot.settings
  const updateError = snapshot.errors.find((error) => error.source === "update")
  const supported = snapshot.terminals.filter((terminal) => terminal.supported).length

  const checks: Check[] = [
    {
      id: "ocshell",
      label: "ocshell",
      level: snapshot.ocshellPath ? "ok" : "error",
      detail: snapshot.ocshellPath
        ? snapshot.ocshellPath
        : "ocshell.exe was not found on PATH.",
    },
    {
      id: "package",
      label: "Package",
      level: doctor?.package.trim() ? "ok" : "warn",
      detail: doctor?.package.trim() || "Open in OpenCode package not detected.",
    },
    {
      id: "certificate",
      label: "Certificate",
      level: doctor?.certificate.trim() === "trusted" ? "ok" : "warn",
      detail: doctor?.certificate.trim() || "Certificate state is unavailable.",
    },
    {
      id: "opencode",
      label: "opencode",
      level: doctor?.binaryFound ? "ok" : "error",
      detail: doctor?.binaryFound
        ? `${doctor.binaryPath.trim()} (${doctor.binarySource.trim() || "unknown source"})`
        : "opencode executable not found.",
    },
    {
      id: "settings",
      label: "Settings",
      level:
        settings && doctor?.settingsLoaded && !doctor.settingsWarning.trim() ? "ok" : "warn",
      detail:
        doctor?.settingsWarning.trim() ||
        (settings ? doctor?.settingsPath.trim() || "loaded" : "settings are unavailable."),
    },
    {
      id: "terminals",
      label: "Terminals",
      level: supported > 0 ? "ok" : "warn",
      detail:
        supported > 0
          ? `${supported} supported of ${snapshot.terminals.length} detected.`
          : "No supported terminals detected.",
    },
  ]

  if (updateError) {
    checks.push({
      id: "update",
      label: "Updates",
      level: "warn",
      detail: updateError.message,
    })
  } else if (snapshot.update) {
    checks.push({
      id: "update",
      label: "Updates",
      level: snapshot.update.updateAvailable ? "warn" : "ok",
      detail: snapshot.update.updateAvailable
        ? `${snapshot.update.available} available`
        : "up to date",
    })
  } else {
    checks.push({
      id: "update",
      label: "Updates",
      level: "ok",
      detail: "not checked",
    })
  }

  return checks
}

export type CopyMethod = "osc52" | "clip" | "file"

export type CopyResult =
  | { ok: true; method: CopyMethod; path?: string }
  | { ok: false; message: string }

export type CopyDependencies = {
  osc52(text: string): boolean
  clip(text: string): Promise<boolean>
  tempFile(text: string): Promise<string>
}

/**
 * Copy in the same order as the host: OSC 52, then Windows `clip.exe`, then a
 * temp file whose path the caller can show. Every step is injected so the
 * fallback order is testable without a terminal.
 */
export async function copyText(
  text: string,
  dependencies: CopyDependencies,
): Promise<CopyResult> {
  try {
    if (dependencies.osc52(text)) return { ok: true, method: "osc52" }
  } catch {
    // Fall through to the next transport.
  }

  try {
    if (await dependencies.clip(text)) return { ok: true, method: "clip" }
  } catch {
    // Fall through to the temp file.
  }

  try {
    const path = await dependencies.tempFile(text)
    return { ok: true, method: "file", path }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Could not copy the report.",
    }
  }
}

function text(value: string | null | undefined, fallback = "(none)"): string {
  if (value === null || value === undefined) return fallback
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : fallback
}

function flag(value: boolean | null | undefined): string {
  if (value === null || value === undefined) return "(unknown)"
  return value ? "yes" : "no"
}

function onOff(value: boolean | null | undefined): string {
  if (value === null || value === undefined) return "(unknown)"
  return value ? "on" : "off"
}

function timestamp(value: number | null | undefined): string {
  if (value === null || value === undefined) return "never"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "(invalid)" : date.toISOString()
}

export function buildReport(snapshot: Snapshot, generatedAt: Date = new Date()): string {
  const doctor = snapshot.doctor
  const settings = snapshot.settings
  const update = snapshot.update
  const updateFailed = snapshot.errors.some((error) => error.source === "update")
  const overall = health(doctor, settings, snapshot.terminals, update, updateFailed)

  const lines: string[] = []

  lines.push("Open in OpenCode diagnostics")
  lines.push(`Generated: ${generatedAt.toISOString()}`)
  lines.push(`Health: ${overall.level} (${overall.label})`)
  if (overall.reasons.length === 0) {
    lines.push("Reasons: (none)")
  } else {
    lines.push("Reasons:")
    for (const reason of overall.reasons) lines.push(`  - ${reason}`)
  }
  lines.push("")

  lines.push("Status")
  lines.push(`  Package: ${text(doctor?.package, "not installed")}`)
  lines.push(`  Certificate: ${text(doctor?.certificate, "unavailable")}`)
  lines.push(`  ocshell: ${text(snapshot.ocshellPath, "not found")}`)
  lines.push(`  ocshell version: ${text(doctor?.version, "unavailable")}`)
  lines.push(`  opencode: ${formatBinary(doctor)}`)
  lines.push(`  opencode path: ${text(doctor?.binaryPath, "not found")}`)
  lines.push(`  opencode source: ${text(doctor?.binarySource, "none")}`)
  lines.push(`  opencode found: ${flag(doctor?.binaryFound)}`)
  lines.push(`  Settings: ${text(doctor?.settingsPath, "unavailable")}`)
  lines.push(`  Settings loaded: ${flag(doctor?.settingsLoaded)}`)
  lines.push(`  Settings warning: ${text(doctor?.settingsWarning, "(none)")}`)
  lines.push(`  Terminal count: ${doctor ? doctor.terminalCount : "(unknown)"}`)
  lines.push(`  Terminal: ${text(doctor?.terminal, "none")}`)
  lines.push("")

  lines.push("Configuration")
  lines.push(`  Terminal: ${formatTerminal(settings, snapshot.terminals)}`)
  lines.push(`  opencode path: ${settings ? text(settings.binaryPath, "auto") : "unavailable"}`)
  lines.push(`  Continue root: ${onOff(settings?.continueFromProjectRoot)}`)
  lines.push(`  Logging: ${onOff(settings?.logging)}`)
  lines.push(`  Update source: ${settings ? text(settings.updateUri, "built-in") : "unavailable"}`)
  lines.push(`  Settings version: ${settings ? settings.version : "(unknown)"}`)
  lines.push(`  Settings binaryPath: ${text(settings?.binaryPath, "(empty)")}`)
  lines.push(`  Settings updateUri: ${text(settings?.updateUri, "(empty)")}`)
  lines.push(`  Settings continueFromProjectRoot: ${flag(settings?.continueFromProjectRoot)}`)
  lines.push(`  Settings logging: ${flag(settings?.logging)}`)
  lines.push(`  Terminal mode: ${text(settings?.terminal.mode, "unavailable")}`)
  lines.push(`  Terminal id: ${text(settings?.terminal.id, "(empty)")}`)
  lines.push(`  Terminal custom path: ${text(settings?.terminal.customPath, "(empty)")}`)
  lines.push(
    `  Terminal custom args: ${
      settings
        ? settings.terminal.customArgs.length
          ? formatArgs(settings.terminal.customArgs)
          : "(none)"
        : "(unknown)"
    }`,
  )
  lines.push("")

  lines.push("Maintenance")
  lines.push(`  Updates: ${formatUpdate(update, updateFailed)}`)
  lines.push(`  Update current: ${text(update?.current, "(unknown)")}`)
  lines.push(`  Update available version: ${text(update?.available, "(unknown)")}`)
  lines.push(`  Update available?: ${flag(update?.updateAvailable)}`)
  lines.push(`  Update bundle: ${text(update?.bundleUri, "(none)")}`)
  lines.push(`  Update installer: ${text(update?.installerUri, "(none)")}`)
  lines.push(`  Update checked: ${timestamp(snapshot.updateCheckedAt)}`)
  lines.push(`  Diagnostics: ${overall.label}`)
  lines.push("")

  lines.push("Advanced")
  lines.push(`  Terminal mode: ${text(settings?.terminal.mode, "unavailable")}`)
  lines.push(`  Custom path: ${text(settings?.terminal.customPath, "not set")}`)
  lines.push(
    `  Custom args: ${
      settings?.terminal.customArgs.length ? formatArgs(settings.terminal.customArgs) : "not set"
    }`,
  )
  lines.push("")

  lines.push("Terminals")
  if (snapshot.terminals.length === 0) {
    lines.push("  (none)")
  } else {
    for (const terminal of snapshot.terminals) {
      lines.push(
        `  [${terminal.supported ? "supported" : "unsupported"}] ${terminal.name} (${terminal.id}): ${terminal.path}`,
      )
    }
  }
  lines.push("")

  lines.push("Errors")
  if (snapshot.errors.length === 0) {
    lines.push("  (none)")
  } else {
    snapshot.errors.forEach((error, index) => {
      lines.push(
        `  ${index + 1}. ${error.kind}${error.source ? ` (${error.source})` : ""}: ${error.message}`,
      )
      if (error.command) lines.push(`     command: ${error.command}`)
      if (error.code !== undefined) {
        lines.push(`     code: ${error.code === null ? "null" : error.code}`)
      }

      const stderr = error.stderr?.trim() ?? ""
      if (stderr) {
        lines.push("     stderr:")
        for (const line of stderr.split(/\r?\n/)) lines.push(`       ${line}`)
      }

      const stdout = error.stdout?.trim() ?? ""
      if (stdout) {
        lines.push("     stdout:")
        for (const line of stdout.split(/\r?\n/)) lines.push(`       ${line}`)
      }
    })
  }

  return `${lines.join("\n")}\n`
}
