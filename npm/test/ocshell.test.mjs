import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { findOcshell, resolveOcshell, runOcshell } from '../src/ocshell.mjs'

test('prefers the packaged execution alias over PATH', () => {
  const alias = path.join('D:\\Local', 'Microsoft', 'WindowsApps', 'ocshell.exe')
  const pathEntry = path.join('D:\\tools', 'ocshell.exe')

  const found = findOcshell({
    env: {
      PATH: 'D:\\tools',
      ProgramFiles: 'D:\\Programs',
      LOCALAPPDATA: 'D:\\Local',
    },
    exists: (candidate) => candidate === alias || candidate === pathEntry,
  })

  assert.equal(found, alias)
})

test('falls back to the first matching directory on PATH', () => {
  const first = 'D:\\tools'
  const second = 'D:\\other'
  const expected = path.join(second, 'ocshell.exe')

  const found = findOcshell({
    env: { PATH: `${first};${second}`, ProgramFiles: 'D:\\Programs' },
    exists: (candidate) => candidate === expected,
  })

  assert.equal(found, expected)
})

test('falls back to Program Files for the classic install', () => {
  const expected = path.join('D:\\Programs', 'OpenInOpenCode', 'ocshell.exe')

  const found = findOcshell({
    env: { PATH: '', ProgramFiles: 'D:\\Programs' },
    exists: (candidate) => candidate === expected,
  })

  assert.equal(found, expected)
})

test('falls back to the WindowsApps execution alias', () => {
  const expected = path.join('D:\\Local', 'Microsoft', 'WindowsApps', 'ocshell.exe')

  const found = findOcshell({
    env: { PATH: '', ProgramFiles: 'D:\\Programs', LOCALAPPDATA: 'D:\\Local' },
    exists: (candidate) => candidate === expected,
  })

  assert.equal(found, expected)
})

test('ignores malformed PATH entries', () => {
  const expected = path.join('D:\\Programs', 'OpenInOpenCode', 'ocshell.exe')

  const found = findOcshell({
    env: { PATH: ';;;', ProgramFiles: 'D:\\Programs' },
    exists: (candidate) => {
      if (candidate.includes('invalid')) throw new Error('bad path')
      return candidate === expected
    },
  })

  assert.equal(found, expected)
})

test('returns null when ocshell is not installed', () => {
  const found = findOcshell({
    env: { PATH: 'D:\\tools', ProgramFiles: 'D:\\Programs' },
    exists: () => false,
  })

  assert.equal(found, null)
})

test('resolves ocshell from the installed package when it is not on PATH', async () => {
  const expected = 'C:\\WindowsApps\\OpenInOpenCode\\ocshell.exe'
  const runner = async () => ({ code: 0, stdout: expected, stderr: '' })

  const found = await resolveOcshell({
    runner,
    env: { PATH: '', ProgramFiles: 'D:\\Programs' },
    exists: (candidate) => candidate === expected,
  })

  assert.equal(found, expected)
})

test('runOcshell forwards arguments and returns the child status', () => {
  let captured

  const status = runOcshell(['doctor', '--json'], {
    exe: 'C:\\ocshell.exe',
    spawn: (exe, args, options) => {
      captured = { exe, args, options }
      return { status: 7 }
    },
  })

  assert.equal(status, 7)
  assert.equal(captured.exe, 'C:\\ocshell.exe')
  assert.deepEqual(captured.args, ['doctor', '--json'])
  assert.equal(captured.options.stdio, 'inherit')
})

test('runOcshell explains when the app is not installed', () => {
  assert.throws(
    () => runOcshell(['doctor'], { exe: null }),
    /Run `open-in-opencode install` first/,
  )
})

test('runOcshell reports spawn errors', () => {
  assert.throws(
    () =>
      runOcshell(['doctor'], {
        exe: 'C:\\ocshell.exe',
        spawn: () => ({ error: new Error('access denied'), status: null }),
      }),
    /Could not run C:\\ocshell\.exe: access denied/,
  )
})
