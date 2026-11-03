import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { main } from '../src/cli.mjs'
import { createLog } from '../test-support/helpers.mjs'

const require = createRequire(import.meta.url)
const pkg = require('../package.json')

test('prints help with no arguments', async () => {
  const log = createLog()
  const code = await main([], { log })

  assert.equal(code, 0)
  assert.match(log.text(), /open-in-opencode install \[options\]/)
})

test('prints the wrapper version', async () => {
  const log = createLog()
  const code = await main(['--version'], { log })

  assert.equal(code, 0)
  assert.equal(log.text(), pkg.version)
})

test('passes install options through', async () => {
  const log = createLog()
  let captured

  const code = await main(['install', '--dry-run', '--version', '1.2.3.4'], {
    log,
    install: async (options, deps) => {
      captured = { options, deps }
      return 0
    },
  })

  assert.equal(code, 0)
  assert.equal(captured.options.version, '1.2.3.4')
  assert.equal(captured.options.dryRun, true)
  assert.equal(captured.deps.log, log)
})

test('prints help for install --help', async () => {
  const log = createLog()
  const code = await main(['install', '--help'], { log })

  assert.equal(code, 0)
  assert.match(log.text(), /Install options:/)
})

test('rejects unknown install options', async () => {
  const log = createLog()
  const code = await main(['install', '--nope'], { log })

  assert.equal(code, 2)
  assert.match(log.text(), /Unknown option/)
})

test('rejects unknown commands', async () => {
  const log = createLog()
  const code = await main(['frobnicate'], { log })

  assert.equal(code, 2)
  assert.match(log.text(), /Unknown command "frobnicate"/)
})

test('forwards doctor arguments to ocshell', async () => {
  const log = createLog()
  let captured

  const code = await main(['doctor', '--json'], {
    log,
    resolveOcshell: async () => 'C:\\ocshell.exe',
    runOcshell: (args, options) => {
      captured = { args, options }
      return 0
    },
  })

  assert.equal(code, 0)
  assert.deepEqual(captured.args, ['doctor', '--json'])
  assert.equal(captured.options.exe, 'C:\\ocshell.exe')
})

test('returns a not-installed exit code when ocshell is missing', async () => {
  const log = createLog()
  const code = await main(['settings', 'list'], {
    log,
    resolveOcshell: async () => null,
  })

  assert.equal(code, 3)
  assert.match(log.text(), /Run `open-in-opencode install` first/)
})

test('forwards settings and update commands', async () => {
  const log = createLog()
  const calls = []

  const deps = {
    log,
    resolveOcshell: async () => 'C:\\ocshell.exe',
    runOcshell: (args) => {
      calls.push(args)
      return 0
    },
  }

  await main(['settings', 'set', 'logging', 'true'], deps)
  await main(['update', 'apply'], deps)

  assert.deepEqual(calls, [
    ['settings', 'set', 'logging', 'true'],
    ['update', 'apply'],
  ])
})

test('runs the uninstall command', async () => {
  const log = createLog()
  let called = false

  const code = await main(['uninstall'], {
    log,
    uninstall: async (deps) => {
      called = true
      assert.equal(deps.log, log)
      return 0
    },
  })

  assert.equal(code, 0)
  assert.equal(called, true)
})

test('rejects uninstall arguments', async () => {
  const log = createLog()
  const code = await main(['uninstall', '--force'], { log })

  assert.equal(code, 2)
  assert.match(log.text(), /uninstall does not accept arguments/)
})
