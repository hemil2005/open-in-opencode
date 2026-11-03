import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeBaseUri,
  normalizeRepo,
  normalizeVersion,
  resolveRelease,
} from '../src/release.mjs'

test('builds the latest release URLs', () => {
  const release = resolveRelease()

  assert.equal(release.tag, 'latest')
  assert.equal(release.version, null)
  assert.equal(release.asset, 'OpenInOpenCodeSetup.exe')
  assert.equal(
    release.setupUrl,
    'https://github.com/hemil2005/open-in-opencode/releases/latest/download/OpenInOpenCodeSetup.exe',
  )
  assert.equal(
    release.checksumsUrl,
    'https://github.com/hemil2005/open-in-opencode/releases/latest/download/checksums.txt',
  )
})

test('builds pinned release URLs', () => {
  const release = resolveRelease({ version: '1.2.3.4' })

  assert.equal(release.tag, 'v1.2.3.4')
  assert.equal(release.asset, 'OpenInOpenCodeSetup-1.2.3.4.exe')
  assert.equal(
    release.setupUrl,
    'https://github.com/hemil2005/open-in-opencode/releases/download/v1.2.3.4/OpenInOpenCodeSetup-1.2.3.4.exe',
  )
  assert.equal(
    release.checksumsUrl,
    'https://github.com/hemil2005/open-in-opencode/releases/download/v1.2.3.4/checksums.txt',
  )
})

test('accepts a leading v on the app version', () => {
  assert.equal(normalizeVersion('v1.2.3.4'), '1.2.3.4')
})

test('rejects malformed app versions', () => {
  assert.throws(() => normalizeVersion('1.2.3'), /Expected four numeric parts/)
  assert.throws(() => normalizeVersion('1.2.3.4.5'), /Expected four numeric parts/)
  assert.throws(() => normalizeVersion('latest'), /Expected four numeric parts/)
})

test('supports a repository override', () => {
  const release = resolveRelease({ repo: 'someone/elsewhere' })
  assert.equal(
    release.setupUrl,
    'https://github.com/someone/elsewhere/releases/latest/download/OpenInOpenCodeSetup.exe',
  )
})

test('validates repository overrides', () => {
  assert.equal(normalizeRepo('owner/repo'), 'owner/repo')
  assert.throws(() => normalizeRepo('owner'), /Expected owner\/name/)
  assert.throws(() => normalizeRepo('https://github.com/owner/repo'), /Expected owner\/name/)
  assert.throws(() => normalizeRepo('../repo'), /Expected owner\/name/)
  assert.throws(() => normalizeRepo('owner/..'), /Expected owner\/name/)
})

test('supports a local test server over HTTP', () => {
  const release = resolveRelease({ version: '1.0.0.0', baseUri: 'http://127.0.0.1:8080/releases/' })

  assert.equal(release.setupUrl, 'http://127.0.0.1:8080/releases/download/v1.0.0.0/OpenInOpenCodeSetup-1.0.0.0.exe')
  assert.equal(release.checksumsUrl, 'http://127.0.0.1:8080/releases/download/v1.0.0.0/checksums.txt')
})

test('rejects insecure base URIs', () => {
  assert.throws(() => normalizeBaseUri('http://example.com/releases'), /must use HTTPS/)
})

test('rejects base URIs with credentials', () => {
  assert.throws(
    () => normalizeBaseUri('https://user:pass@example.com/releases'),
    /must not contain credentials/,
  )
})

test('rejects malformed base URIs', () => {
  assert.throws(() => normalizeBaseUri('not a url'), /Invalid base URI/)
})
