import {
  formatArgs,
  formatBinary,
  formatTerminal,
  formatUpdate,
  health,
} from "../lib/format"
import type { Snapshot } from "../lib/types"

/**
 * Pure row model for the dashboard.
 *
 * Labels, values, tones, and disabled reasons live here so the component only
 * renders what this module decides. No Solid or Node imports.
 */

export type RowTone = "normal" | "muted" | "success" | "warning" | "error"

export type RowAction =
  | "package"
  | "certificate"
  | "ocshell"
  | "binary"
  | "settings"
  | "terminal"
  | "binaryPath"
  | "continueFromProjectRoot"
  | "logging"
  | "updateUri"
  | "updates"
  | "diagnostics"
  | "terminalMode"
  | "customPath"
  | "customArgs"

export type SectionId = "status" | "configuration" | "maintenance" | "advanced"

export type Row = {
  id: string
  section: SectionId
  label: string
  value: string
  tone: RowTone
  action: RowAction
  disabled?: boolean
  disabledReason?: string
  detail?: string
  copy?: string
}

export type RowSection = {
  id: SectionId
  title: string
  rows: Row[]
}

export type RowModel = {
  sections: RowSection[]
  rows: Row[]
}

export function buildRows(snapshot: Snapshot): RowModel {
  const doctor = snapshot.doctor
  const settings = snapshot.settings
  const updateFailed = snapshot.errors.some((error) => error.source === "update")
  const updateError = snapshot.errors.find((error) => error.source === "update")
  const overall = health(doctor, settings, snapshot.terminals, snapshot.update, updateFailed)

  const missingOcshell = !snapshot.ocshellPath
  const missingSettings = !settings
  const writeDisabled = missingOcshell || missingSettings
  const writeReason = missingOcshell
    ? "ocshell.exe was not found."
    : missingSettings
      ? "Settings are unavailable."
      : undefined

  function row(
    section: SectionId,
    id: string,
    label: string,
    value: string,
    tone: RowTone,
    action: RowAction,
    extra: Partial<Row> = {},
  ): Row {
    return { id, section, label, value, tone, action, ...extra }
  }

  function guard(disabled: boolean, reason: string | undefined): Partial<Row> {
    return disabled ? { disabled: true, disabledReason: reason } : {}
  }

  const packageName = doctor?.package.trim() ?? ""
  const certificate = doctor?.certificate.trim() ?? ""
  const ocshell = snapshot.ocshellPath?.trim() ?? ""
  const settingsPath = doctor?.settingsPath.trim() ?? ""
  const updateUri = settings?.updateUri.trim() ?? ""

  const statusRows: Row[] = [
    row(
      "status",
      "package",
      "Package",
      doctor ? packageName || "not installed" : "unavailable",
      !doctor ? "error" : packageName ? "normal" : "warning",
      "package",
      {
        detail: doctor
          ? packageName || "No Open in OpenCode package was reported."
          : "Doctor output is unavailable.",
        ...(packageName ? { copy: packageName } : {}),
      },
    ),
    row(
      "status",
      "certificate",
      "Certificate",
      doctor ? certificate || "unknown" : "unavailable",
      !doctor ? "error" : certificate === "trusted" ? "success" : "warning",
      "certificate",
      {
        detail: doctor
          ? certificate || "No certificate state was reported."
          : "Doctor output is unavailable.",
      },
    ),
    row(
      "status",
      "ocshell",
      "ocshell",
      ocshell || "not found",
      ocshell ? "success" : "error",
      "ocshell",
      {
        detail: ocshell || "ocshell.exe was not found on PATH.",
        ...(ocshell ? { copy: ocshell } : {}),
      },
    ),
    row(
      "status",
      "opencode",
      "opencode",
      formatBinary(doctor),
      !doctor ? "error" : doctor.binaryFound ? "success" : "error",
      "binary",
      {
        detail: doctor?.binaryPath.trim() || (doctor ? "No opencode executable was found." : "Doctor output is unavailable."),
        ...(doctor?.binaryPath.trim() ? { copy: doctor.binaryPath.trim() } : {}),
      },
    ),
    row(
      "status",
      "settings",
      "Settings",
      settingsPath || "unavailable",
      !doctor
        ? "error"
        : !doctor.settingsLoaded || doctor.settingsWarning.trim()
          ? "warning"
          : "success",
      "settings",
      {
        detail: doctor
          ? doctor.settingsWarning.trim() || settingsPath || "No settings path was reported."
          : "Doctor output is unavailable.",
        ...(settingsPath ? { copy: settingsPath } : {}),
      },
    ),
  ]

  const selectedTerminal = settings
    ? snapshot.terminals.find((terminal) => terminal.id === settings.terminal.id)
    : undefined
  const hasSupportedTerminal = snapshot.terminals.some((terminal) => terminal.supported)

  let terminalTone: RowTone = "normal"
  let terminalDetail = "Automatic selection."

  if (!settings) {
    terminalTone = "error"
    terminalDetail = "Settings are unavailable."
  } else if (settings.terminal.mode === "default") {
    terminalDetail = "Let Windows choose the console host."
  } else if (settings.terminal.mode === "custom") {
    const customPath = settings.terminal.customPath.trim()
    terminalTone = customPath ? "normal" : "warning"
    terminalDetail = customPath || "Custom terminal path is not set."
  } else if (settings.terminal.id) {
    if (selectedTerminal) {
      terminalTone = selectedTerminal.supported ? "normal" : "warning"
      terminalDetail = `${selectedTerminal.name} (${selectedTerminal.id}) - ${selectedTerminal.path}${
        selectedTerminal.supported ? "" : " [unsupported]"
      }`
    } else {
      terminalTone = "warning"
      terminalDetail = `Selected terminal ${settings.terminal.id} was not detected.`
    }
  } else if (hasSupportedTerminal) {
    terminalDetail = "Automatic selection."
  } else {
    terminalTone = "warning"
    terminalDetail = "No supported terminal was detected."
  }

  const override = settings?.binaryPath.trim() ?? ""
  let binaryPathTone: RowTone = "normal"
  if (!doctor) {
    binaryPathTone = override ? "normal" : "error"
  } else if (!doctor.binaryFound) {
    binaryPathTone = "error"
  } else if (!override) {
    binaryPathTone = "muted"
  }

  const configurationRows: Row[] = [
    row("configuration", "terminal", "Terminal", formatTerminal(settings, snapshot.terminals), terminalTone, "terminal", {
      detail: terminalDetail,
      ...guard(writeDisabled, writeReason),
    }),
    row(
      "configuration",
      "binaryPath",
      "opencode path",
      override || formatBinary(doctor),
      binaryPathTone,
      "binaryPath",
      {
        detail: override
          ? `Override: ${override}`
          : doctor
            ? `Auto-detected from ${doctor.binarySource.trim() || "unknown source"}.`
            : "Doctor output is unavailable.",
        ...guard(writeDisabled, writeReason),
      },
    ),
    row(
      "configuration",
      "continueFromProjectRoot",
      "Continue root",
      settings ? (settings.continueFromProjectRoot ? "on" : "off") : "unavailable",
      settings ? "normal" : "error",
      "continueFromProjectRoot",
      {
        detail: settings
          ? `Continue from project root is ${settings.continueFromProjectRoot ? "on" : "off"}.`
          : "Settings are unavailable.",
        ...guard(writeDisabled, writeReason),
      },
    ),
    row(
      "configuration",
      "logging",
      "Logging",
      settings ? (settings.logging ? "on" : "off") : "unavailable",
      settings ? "normal" : "error",
      "logging",
      {
        detail: settings
          ? `Logging is ${settings.logging ? "on" : "off"}.`
          : "Settings are unavailable.",
        ...guard(writeDisabled, writeReason),
      },
    ),
    row(
      "configuration",
      "updateUri",
      "Update source",
      settings ? updateUri || "built-in" : "unavailable",
      !settings ? "error" : updateUri ? "normal" : "muted",
      "updateUri",
      {
        detail: settings
          ? updateUri || "Using the built-in update source."
          : "Settings are unavailable.",
        ...(updateUri ? { copy: updateUri } : {}),
        ...guard(writeDisabled, writeReason),
      },
    ),
  ]

  const maintenanceRows: Row[] = [
    row(
      "maintenance",
      "updates",
      "Updates",
      formatUpdate(snapshot.update, updateFailed),
      updateFailed ? "error" : !snapshot.update ? "muted" : snapshot.update.updateAvailable ? "warning" : "success",
      "updates",
      {
        detail: updateFailed
          ? updateError?.message || "The update check failed."
          : snapshot.update
            ? `Installed ${snapshot.update.current}; available ${snapshot.update.available}.`
            : "No update check has run yet.",
        ...guard(missingOcshell, missingOcshell ? "ocshell.exe was not found." : undefined),
      },
    ),
    row(
      "maintenance",
      "diagnostics",
      "Diagnostics",
      overall.label,
      overall.level === "ok" ? "success" : overall.level === "warn" ? "warning" : "error",
      "diagnostics",
      {
        detail: overall.reasons.length ? overall.reasons.join("\n") : "All checks passed.",
      },
    ),
  ]

  const advancedRows: Row[] = [
    row(
      "advanced",
      "terminalMode",
      "Terminal mode",
      settings?.terminal.mode ?? "unavailable",
      settings ? "normal" : "error",
      "terminalMode",
      {
        detail: settings
          ? `Terminal mode is ${settings.terminal.mode}.`
          : "Settings are unavailable.",
        ...guard(writeDisabled, writeReason),
      },
    ),
  ]

  if (settings?.terminal.mode === "custom") {
    const customPath = settings.terminal.customPath.trim()
    const customArgs = settings.terminal.customArgs

    advancedRows.push(
      row(
        "advanced",
        "customPath",
        "Custom path",
        customPath || "not set",
        customPath ? "normal" : "warning",
        "customPath",
        {
          detail: customPath || "Custom terminal path is not set.",
          ...guard(writeDisabled, writeReason),
        },
      ),
      row(
        "advanced",
        "customArgs",
        "Custom args",
        customArgs.length ? formatArgs(customArgs) : "not set",
        customArgs.length ? "normal" : "muted",
        "customArgs",
        {
          detail: customArgs.length ? formatArgs(customArgs) : "No custom arguments.",
          ...guard(writeDisabled, writeReason),
        },
      ),
    )
  }

  const sections: RowSection[] = [
    { id: "status", title: "Status", rows: statusRows },
    { id: "configuration", title: "Configuration", rows: configurationRows },
    { id: "maintenance", title: "Maintenance", rows: maintenanceRows },
    { id: "advanced", title: "Advanced", rows: advancedRows },
  ]

  return {
    sections,
    rows: sections.flatMap((section) => section.rows),
  }
}
