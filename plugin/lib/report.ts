import { formatArgs, formatBinary, formatTerminal, formatUpdate, health } from "./format"
import type { Snapshot } from "./types"

/**
 * Plain-text diagnostics report. It contains only values already visible in
 * the dashboard, plus the error details the dashboard can show in a dialog.
 */

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
  const overall = health(doctor, settings, snapshot.terminals, update)
  const updateFailed = snapshot.errors.some((error) => error.source === "update")

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
