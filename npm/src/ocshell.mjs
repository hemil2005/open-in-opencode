import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { CliError } from './errors.mjs'
import { classicOcshellPath, windowsAppsOcshellPath } from './platform.mjs'
import { runPowerShell } from './powershell.mjs'

export function findOcshell({ env = process.env, exists = fs.existsSync } = {}) {
  // Prefer the locations the installer owns before trusting the rest of PATH.
  const candidates = []
  const alias = windowsAppsOcshellPath(env)
  if (alias) candidates.push(alias)
  candidates.push(classicOcshellPath(env))

  const pathValue = env.PATH || env.Path || ''
  for (const directory of pathValue.split(';')) {
    const trimmed = directory.trim()
    if (trimmed) candidates.push(path.join(trimmed, 'ocshell.exe'))
  }

  const seen = new Set()
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue
    seen.add(candidate)
    try {
      if (exists(candidate)) return candidate
    } catch {
      // Ignore malformed PATH entries.
    }
  }

  return null
}

export async function resolveOcshell({
  runner = runPowerShell,
  exists = fs.existsSync,
  ...findOptions
} = {}) {
  const direct = findOcshell({ ...findOptions, exists })
  if (direct) return direct

  // The execution alias is normally on PATH. This fallback covers aliases that were disabled
  // or a PATH that has not been refreshed since installation.
  const script = [
    '$package = Get-AppxPackage OpenInOpenCode -ErrorAction SilentlyContinue | Select-Object -First 1',
    "if ($package) { Join-Path $package.InstallLocation 'ocshell.exe' }",
  ].join('; ')

  const result = await runner(script)
  const candidate = String(result.stdout || '').trim()
  if (result.code === 0 && candidate) {
    try {
      if (exists(candidate)) return candidate
    } catch {
      // Fall through to the not-installed result.
    }
  }

  return null
}

export function runOcshell(args, { exe, spawn = spawnSync } = {}) {
  if (!exe) {
    throw new CliError(
      'Open in OpenCode is not installed. Run `open-in-opencode install` first.',
      3,
    )
  }

  const result = spawn(exe, args, { stdio: 'inherit' })
  if (result.error) {
    throw new CliError(`Could not run ${exe}: ${result.error.message}`)
  }
  return result.status ?? 1
}
