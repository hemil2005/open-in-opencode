import { CliError } from './errors.mjs'

export function parseChecksums(text) {
  const checksums = new Map()

  for (const rawLine of String(text).replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const match = line.match(/^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/)
    if (!match) continue

    const file = match[2].replace(/^\.\//, '')
    checksums.set(file, match[1].toLowerCase())
  }

  return checksums
}

export function expectedChecksum(text, asset) {
  const hash = parseChecksums(text).get(asset)
  if (!hash) {
    throw new CliError(
      `No SHA-256 entry for ${asset} in checksums.txt. Refusing to install an unverified download.`,
    )
  }
  return hash
}
