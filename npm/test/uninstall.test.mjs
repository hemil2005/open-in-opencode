import assert from 'node:assert/strict'
import test from 'node:test'
import {
  UNINSTALLER_ARGS,
  findUninstaller,
  parseUninstallString,
  removePackage,
  uninstall,
} from '../src/uninstall.mjs'
import { createLog } from '../test-support/helpers.mjs'

test('parses a quoted Inno uninstall command', () => {
  assert.equal(
    parseUninstallString('"C:\\Program Files\\OpenInOpenCode\\unins000.exe"'),
    'C:\\Program Files\\OpenInOpenCode\\unins000.exe',
  )
})

test('parses a quoted uninstall command with arguments', () => {
  assert.equal(
    parseUninstallString('"C:\\Program Files\\OpenInOpenCode\\unins000.exe" /SILENT'),
    'C:\\Program Files\\OpenInOpenCode\\unins000.exe',
  )
})

test('parses an unquoted uninstall command', () => {
  assert.equal(parseUninstallString('C:\\Tools\\unins000.exe'), 'C:\\Tools\\unins000.exe')
  assert.equal(parseUninstallString('   '), null)
})

test('rejects a malformed quoted uninstall command', () => {
  assert.equal(parseUninstallString('"C:\\Program Files\\OpenInOpenCode'), null)
})

test('finds the Inno uninstaller from the registry', async () => {
  const runner = async () => ({
    code: 0,
    stdout: '"C:\\Program Files\\OpenInOpenCode\\unins000.exe"',
    stderr: '',
  })

  const uninstaller = await findUninstaller({ runner })
  assert.equal(uninstaller, 'C:\\Program Files\\OpenInOpenCode\\unins000.exe')
})

test('removePackage reports that nothing was installed', async () => {
  const runner = async () => ({ code: 3, stdout: '', stderr: '' })
  assert.equal(await removePackage({ runner }), false)
})

test('removePackage removes the MSIX package', async () => {
  const runner = async () => ({ code: 0, stdout: '', stderr: '' })
  assert.equal(await removePackage({ runner }), true)
})

test('removePackage reports a failed removal', async () => {
  const runner = async () => ({ code: 1, stdout: '', stderr: 'access denied' })

  await assert.rejects(
    () => removePackage({ runner }),
    /Could not remove the Open in OpenCode package\.\naccess denied/,
  )
})

test('uninstall runs the existing uninstaller elevated', async () => {
  const log = createLog()
  const elevated = []
  const runner = async () => ({
    code: 0,
    stdout: '"C:\\Program Files\\OpenInOpenCode\\unins000.exe"',
    stderr: '',
  })

  const code = await uninstall({
    runner,
    elevate: async (target, args) => {
      elevated.push({ target, args })
    },
    log,
  })

  assert.equal(code, 0)
  assert.equal(elevated.length, 1)
  assert.equal(elevated[0].target, 'C:\\Program Files\\OpenInOpenCode\\unins000.exe')
  assert.deepEqual(elevated[0].args, UNINSTALLER_ARGS)
  assert.match(log.text(), /Open in OpenCode was removed/)
  assert.match(log.text(), /npm uninstall -g open-in-opencode/)
})

test('uninstall falls back to removing the MSIX package', async () => {
  const log = createLog()

  const runner = async (command) => {
    if (command.includes('UninstallString')) return { code: 0, stdout: '', stderr: '' }
    return { code: 0, stdout: '', stderr: '' }
  }

  const code = await uninstall({
    runner,
    elevate: async () => {
      throw new Error('should not elevate')
    },
    log,
  })

  assert.equal(code, 0)
  assert.match(log.text(), /Open in OpenCode was removed/)
})

test('uninstall reports when nothing is installed', async () => {
  const log = createLog()

  const runner = async (command) => {
    if (command.includes('UninstallString')) return { code: 0, stdout: '', stderr: '' }
    return { code: 3, stdout: '', stderr: '' }
  }

  const code = await uninstall({ runner, findOcshellFn: () => null, log })

  assert.equal(code, 0)
  assert.match(log.text(), /not installed on this machine/)
})

test('uninstall explains a classic install with no uninstaller', async () => {
  const runner = async (command) => {
    if (command.includes('UninstallString')) return { code: 0, stdout: '', stderr: '' }
    return { code: 3, stdout: '', stderr: '' }
  }

  await assert.rejects(
    () => uninstall({ runner, findOcshellFn: () => 'C:\\ocshell.exe', log: createLog() }),
    /no uninstaller was found/,
  )
})
