import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import {
  assertSupportedHost,
  classicOcshellPath,
  powershellPath,
  windowsAppsOcshellPath,
} from '../src/platform.mjs'

test('accepts supported Windows hosts', () => {
  assert.doesNotThrow(() => assertSupportedHost({ platform: 'win32', arch: 'x64' }))
  assert.doesNotThrow(() => assertSupportedHost({ platform: 'win32', arch: 'arm64' }))
})

test('rejects non-Windows hosts', () => {
  assert.throws(
    () => assertSupportedHost({ platform: 'linux', arch: 'x64' }),
    /only supports Windows/,
  )
  assert.throws(
    () => assertSupportedHost({ platform: 'darwin', arch: 'arm64' }),
    /only supports Windows/,
  )
})

test('rejects 32-bit Node.js', () => {
  assert.throws(
    () => assertSupportedHost({ platform: 'win32', arch: 'ia32' }),
    /Unsupported Node\.js architecture/,
  )
})

test('resolves the Windows PowerShell path from the system root', () => {
  assert.equal(
    powershellPath({ SystemRoot: 'D:\\Windows' }),
    path.join('D:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  )
})

test('resolves the classic and packaged ocshell locations', () => {
  assert.equal(
    classicOcshellPath({ ProgramFiles: 'D:\\Programs' }),
    path.join('D:\\Programs', 'OpenInOpenCode', 'ocshell.exe'),
  )
  assert.equal(
    windowsAppsOcshellPath({ LOCALAPPDATA: 'D:\\Local' }),
    path.join('D:\\Local', 'Microsoft', 'WindowsApps', 'ocshell.exe'),
  )
  assert.equal(windowsAppsOcshellPath({}), null)
})
