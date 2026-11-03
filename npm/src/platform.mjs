import path from 'node:path'
import { CliError } from './errors.mjs'

export const DEFAULT_REPO = 'hemil2005/open-in-opencode'
export const PRODUCT_NAME = 'Open in OpenCode'

export function assertSupportedHost({ platform = process.platform, arch = process.arch } = {}) {
  if (platform !== 'win32') {
    throw new CliError(
      'Open in OpenCode is a Windows app. The npm channel only supports Windows 10 and Windows 11.',
    )
  }
  if (arch !== 'x64' && arch !== 'arm64') {
    throw new CliError(
      `Unsupported Node.js architecture: ${arch}. Use a 64-bit Node.js build (x64 or arm64).`,
    )
  }
}

export function powershellPath(env = process.env) {
  const root = env.SystemRoot || env.windir || 'C:\\Windows'
  return path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

export function programFilesPath(env = process.env) {
  return env.ProgramFiles || 'C:\\Program Files'
}

export function classicOcshellPath(env = process.env) {
  return path.join(programFilesPath(env), 'OpenInOpenCode', 'ocshell.exe')
}

export function windowsAppsOcshellPath(env = process.env) {
  if (!env.LOCALAPPDATA) return null
  return path.join(env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'ocshell.exe')
}
