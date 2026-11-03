import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { INSTALLER_ARGS, install } from '../src/install.mjs'
import { createLog, fakeDownloader } from '../test-support/helpers.mjs'

const SETUP_BYTES = Buffer.from('fake setup binary')
const SETUP_HASH = createHash('sha256').update(SETUP_BYTES).digest('hex')
const RELEASE = {
  version: '1.2.3.4',
  tag: 'v1.2.3.4',
  asset: 'OpenInOpenCodeSetup-1.2.3.4.exe',
  setupUrl: 'https://example.test/setup.exe',
  checksumsUrl: 'https://example.test/checksums.txt',
}

async function tempRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-install-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return root
}

function downloads({ checksum = SETUP_HASH, asset = RELEASE.asset } = {}) {
  return fakeDownloader({
    [RELEASE.checksumsUrl]: `${checksum}  ${asset}\n`,
    [RELEASE.setupUrl]: SETUP_BYTES,
  })
}

test('downloads, verifies, elevates and confirms a successful install', async (t) => {
  const tmpRoot = await tempRoot(t)
  const log = createLog()
  const elevated = []

  const code = await install(
    {},
    {
      resolveReleaseFn: () => RELEASE,
      downloadFileFn: downloads(),
      runElevatedFn: async (target, args) => {
        elevated.push({ target, args })
      },
      verifyInstalledFn: async () => true,
      log,
      host: { platform: 'win32', arch: 'x64' },
      tmpRoot,
    },
  )

  assert.equal(code, 0)
  assert.equal(elevated.length, 1)
  assert.equal(path.basename(elevated[0].target), RELEASE.asset)
  assert.deepEqual(elevated[0].args, INSTALLER_ARGS)
  assert.match(log.text(), /Installed Open in OpenCode/)
  assert.deepEqual(await fs.readdir(tmpRoot), [])
})

test('refuses a checksum mismatch before elevation', async (t) => {
  const tmpRoot = await tempRoot(t)
  const log = createLog()
  let elevated = false

  await assert.rejects(
    () =>
      install(
        {},
        {
          resolveReleaseFn: () => RELEASE,
          downloadFileFn: downloads({ checksum: '0'.repeat(64) }),
          runElevatedFn: async () => {
            elevated = true
          },
          verifyInstalledFn: async () => true,
          log,
          host: { platform: 'win32', arch: 'x64' },
          tmpRoot,
        },
      ),
    /SHA-256 mismatch for OpenInOpenCodeSetup-1\.2\.3\.4\.exe/,
  )

  assert.equal(elevated, false)
  assert.deepEqual(await fs.readdir(tmpRoot), [])
})

test('refuses an asset missing from checksums.txt', async (t) => {
  const tmpRoot = await tempRoot(t)

  await assert.rejects(
    () =>
      install(
        {},
        {
          resolveReleaseFn: () => RELEASE,
          downloadFileFn: downloads({ asset: 'some-other-file.exe' }),
          runElevatedFn: async () => {},
          verifyInstalledFn: async () => true,
          log: createLog(),
          host: { platform: 'win32', arch: 'x64' },
          tmpRoot,
        },
      ),
    /No SHA-256 entry for OpenInOpenCodeSetup-1\.2\.3\.4\.exe/,
  )
})

test('fails when the installer exits successfully but the app is missing', async (t) => {
  const tmpRoot = await tempRoot(t)

  await assert.rejects(
    () =>
      install(
        {},
        {
          resolveReleaseFn: () => RELEASE,
          downloadFileFn: downloads(),
          runElevatedFn: async () => {},
          verifyInstalledFn: async () => false,
          log: createLog(),
          host: { platform: 'win32', arch: 'x64' },
          tmpRoot,
        },
      ),
    /installer reported success, but Open in OpenCode was not found/,
  )
})

test('rejects unsupported hosts before downloading', async (t) => {
  const tmpRoot = await tempRoot(t)
  let downloaded = false

  await assert.rejects(
    () =>
      install(
        {},
        {
          resolveReleaseFn: () => RELEASE,
          downloadFileFn: async () => {
            downloaded = true
          },
          log: createLog(),
          host: { platform: 'linux', arch: 'x64' },
          tmpRoot,
        },
      ),
    /only supports Windows/,
  )

  assert.equal(downloaded, false)
})

test('dry run prints the release URLs without downloading', async () => {
  const log = createLog()

  const code = await install(
    { dryRun: true },
    {
      resolveReleaseFn: () => RELEASE,
      log,
      host: { platform: 'linux', arch: 'x64' },
    },
  )

  assert.equal(code, 0)
  assert.match(log.text(), /^release : v1\.2\.3\.4$/m)
  assert.match(log.text(), /^setup   : https:\/\/example\.test\/setup\.exe$/m)
  assert.match(log.text(), /^checksum: https:\/\/example\.test\/checksums\.txt$/m)
})
