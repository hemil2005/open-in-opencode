import { runElevated } from './elevate.mjs'
import { CliError } from './errors.mjs'
import { findOcshell } from './ocshell.mjs'
import { runPowerShell } from './powershell.mjs'

export const UNINSTALLER_ARGS = ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART']

export function parseUninstallString(value) {
  const raw = String(value || '').trim()
  if (!raw) return null

  if (raw.startsWith('"')) {
    const end = raw.indexOf('"', 1)
    return end > 1 ? raw.slice(1, end) : null
  }

  return raw.split(/\s+/)[0]
}

export async function findUninstaller({ runner = runPowerShell } = {}) {
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    '$paths = @(' +
      "'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'," +
      "'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'," +
      "'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'" +
      ')',
    "$entry = Get-ItemProperty $paths -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'Open in OpenCode' } | Select-Object -First 1",
    'if ($entry -and $entry.UninstallString) { [Console]::Out.Write($entry.UninstallString) }',
  ].join('; ')

  const result = await runner(script)
  if (result.code !== 0) return null
  return parseUninstallString(result.stdout)
}

export async function removePackage({ runner = runPowerShell } = {}) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$package = Get-AppxPackage OpenInOpenCode -ErrorAction SilentlyContinue',
    'if (-not $package) { exit 3 }',
    'Remove-AppxPackage -Package $package.PackageFullName',
    'exit 0',
  ].join('; ')

  const result = await runner(script)
  if (result.code === 3) return false
  if (result.code !== 0) {
    throw new CliError(
      `Could not remove the Open in OpenCode package.${result.stderr ? `\n${String(result.stderr).trim()}` : ''}`,
    )
  }
  return true
}

export async function uninstall({
  runner = runPowerShell,
  elevate = runElevated,
  findOcshellFn = findOcshell,
  log = console,
} = {}) {
  const uninstaller = await findUninstaller({ runner })

  if (uninstaller) {
    log.log('Running the Open in OpenCode uninstaller...')
    await elevate(uninstaller, UNINSTALLER_ARGS, { runner })
    log.log('Open in OpenCode was removed.')
  } else if (await removePackage({ runner })) {
    log.log('Open in OpenCode was removed.')
  } else if (findOcshellFn()) {
    throw new CliError(
      'Open in OpenCode appears to be installed, but no uninstaller was found.\n' +
        'Run `ocshell registry uninstall` as administrator, then remove the remaining files manually.',
    )
  } else {
    log.log('Open in OpenCode is not installed on this machine.')
    return 0
  }

  log.log('The npm wrapper is still installed. Remove it with `npm uninstall -g open-in-opencode`.')
  return 0
}
