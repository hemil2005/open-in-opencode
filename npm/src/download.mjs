import fs from 'node:fs/promises'
import path from 'node:path'
import { CliError } from './errors.mjs'
import { runPowerShell } from './powershell.mjs'

const DEFAULT_MAX_BYTES = 200 * 1024 * 1024
const DOWNLOAD_TIMEOUT_SECONDS = 300

/**
 * Downloads a release asset with Windows PowerShell so the Windows proxy and TLS settings
 * are used. The URL and destination go through environment variables, not the script text.
 */
export async function downloadFile(
  url,
  destination,
  { runner = runPowerShell, maxBytes = DEFAULT_MAX_BYTES } = {},
) {
  await fs.mkdir(path.dirname(destination), { recursive: true })

  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    `Invoke-WebRequest -Uri $env:OIOC_URL -OutFile $env:OIOC_OUT -UseBasicParsing -TimeoutSec ${DOWNLOAD_TIMEOUT_SECONDS}`,
  ].join('; ')

  const result = await runner(script, { OIOC_URL: url, OIOC_OUT: destination })
  if (result.code !== 0) {
    const detail = firstLine(result.stderr)
    throw new CliError(`Could not download ${url}${detail ? `: ${detail}` : ''}`)
  }

  let stat
  try {
    stat = await fs.stat(destination)
  } catch {
    throw new CliError(`The download finished but ${destination} was not created.`)
  }

  if (stat.size === 0) {
    await fs.rm(destination, { force: true })
    throw new CliError(`The download from ${url} was empty.`)
  }

  if (stat.size > maxBytes) {
    await fs.rm(destination, { force: true })
    throw new CliError(
      `The download from ${url} is larger than the ${formatBytes(maxBytes)} safety limit.`,
    )
  }

  return destination
}

function firstLine(value) {
  return String(value || '')
    .trim()
    .split(/\r?\n/)
    .find(Boolean) || ''
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} bytes`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${Math.round(bytes / (1024 * 1024))} MB`
}
