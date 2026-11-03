import { UsageError } from './errors.mjs'
import { DEFAULT_REPO } from './platform.mjs'

export function normalizeVersion(value) {
  const version = String(value).trim().replace(/^v/i, '')
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(version)) {
    throw new UsageError(
      `Invalid app version "${value}". Expected four numeric parts, for example 1.0.0.0.`,
    )
  }
  return version
}

export function normalizeRepo(value) {
  const repo = String(value).trim()
  const match = repo.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/)
  if (
    !match ||
    ['.', '..'].includes(match[1]) ||
    ['.', '..'].includes(match[2])
  ) {
    throw new UsageError(`Invalid repository "${value}". Expected owner/name.`)
  }
  return repo
}

export function normalizeBaseUri(value) {
  let url
  try {
    url = new URL(String(value).trim())
  } catch {
    throw new UsageError(`Invalid base URI "${value}".`)
  }
  if (url.username || url.password) {
    throw new UsageError('The base URI must not contain credentials.')
  }
  if (url.protocol !== 'https:' && !isLoopback(url)) {
    throw new UsageError('The base URI must use HTTPS, except for local test servers on localhost.')
  }
  return url.toString().replace(/\/+$/, '')
}

function isLoopback(url) {
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
}

export function resolveRelease({ version, repo = DEFAULT_REPO, baseUri } = {}) {
  const root = baseUri
    ? normalizeBaseUri(baseUri)
    : `https://github.com/${normalizeRepo(repo)}/releases`

  if (version !== undefined && version !== null && version !== '') {
    const normalized = normalizeVersion(version)
    const tag = `v${normalized}`
    const asset = `OpenInOpenCodeSetup-${normalized}.exe`
    return {
      version: normalized,
      tag,
      asset,
      setupUrl: `${root}/download/${tag}/${asset}`,
      checksumsUrl: `${root}/download/${tag}/checksums.txt`,
    }
  }

  return {
    version: null,
    tag: 'latest',
    asset: 'OpenInOpenCodeSetup.exe',
    setupUrl: `${root}/latest/download/OpenInOpenCodeSetup.exe`,
    checksumsUrl: `${root}/latest/download/checksums.txt`,
  }
}
