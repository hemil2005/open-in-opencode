import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expectedChecksum } from './checksums.mjs'
import { downloadFile } from './download.mjs'
import { runElevated } from './elevate.mjs'
import { CliError } from './errors.mjs'
import { sha256File } from './hash.mjs'
import { assertSupportedHost, PRODUCT_NAME } from './platform.mjs'
import { resolveRelease } from './release.mjs'
import { verifyInstalled } from './verify.mjs'

export const INSTALLER_ARGS = ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART']

export async function install(
  options = {},
  {
    resolveReleaseFn = resolveRelease,
    downloadFileFn = downloadFile,
    runElevatedFn = runElevated,
    verifyInstalledFn = verifyInstalled,
    sha256FileFn = sha256File,
    log = console,
    host = {},
    tmpRoot = os.tmpdir(),
  } = {},
) {
  const release = resolveReleaseFn({
    version: options.version,
    repo: options.repo,
    baseUri: options.baseUri,
  })

  if (options.dryRun) {
    log.log(`release : ${release.tag}`)
    log.log(`setup   : ${release.setupUrl}`)
    log.log(`checksum: ${release.checksumsUrl}`)
    return 0
  }

  assertSupportedHost(host)

  log.log(`Installing ${PRODUCT_NAME}${release.version ? ` ${release.version}` : ''}...`)

  const tempDir = await fs.mkdtemp(path.join(tmpRoot, 'open-in-opencode-'))
  try {
    const checksumsPath = path.join(tempDir, 'checksums.txt')
    log.log(`Downloading ${release.checksumsUrl}`)
    await downloadFileFn(release.checksumsUrl, checksumsPath)
    const expected = expectedChecksum(await fs.readFile(checksumsPath, 'utf8'), release.asset)

    const setupPath = path.join(tempDir, release.asset)
    log.log(`Downloading ${release.setupUrl}`)
    await downloadFileFn(release.setupUrl, setupPath)

    log.log('Verifying SHA-256...')
    const actual = await sha256FileFn(setupPath)
    if (actual !== expected) {
      throw new CliError(
        `SHA-256 mismatch for ${release.asset}.\n` +
          `  expected: ${expected}\n` +
          `  actual:   ${actual}\n` +
          'The download was discarded and nothing was installed.',
      )
    }

    log.log('Requesting administrator approval...')
    await runElevatedFn(setupPath, INSTALLER_ARGS)

    if (!(await verifyInstalledFn())) {
      throw new CliError(
        'The installer reported success, but Open in OpenCode was not found.\n' +
          'See https://github.com/hemil2005/open-in-opencode#troubleshooting or run `open-in-opencode doctor`.',
      )
    }

    log.log('')
    log.log(`Installed ${PRODUCT_NAME}.`)
    log.log('Right-click any folder, or empty space inside one, to use it.')
    log.log('Run `open-in-opencode doctor` to verify the installation.')
    return 0
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}
