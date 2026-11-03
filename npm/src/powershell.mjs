import { spawn } from 'node:child_process'
import { CliError } from './errors.mjs'
import { powershellPath } from './platform.mjs'

/**
 * Runs a command with Windows PowerShell 5.1.
 *
 * Values are passed through environment variables by the callers so paths and URLs never
 * need to be interpolated into the script text.
 */
export function runPowerShell(command, extraEnv = {}, { spawnImpl = spawn, baseEnv = process.env } = {}) {
  if (process.platform !== 'win32') {
    return Promise.reject(new CliError('This command requires Windows.'))
  }

  // Paths can contain non-ASCII characters. Force UTF-8 stdout so Node decodes them correctly.
  const wrappedCommand = `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); ${command}`

  return new Promise((resolve, reject) => {
    const child = spawnImpl(
      powershellPath(baseEnv),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', wrappedCommand],
      {
        env: { ...baseEnv, ...extraEnv },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )

    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}
