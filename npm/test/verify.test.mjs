import assert from 'node:assert/strict'
import test from 'node:test'
import { verifyInstalled } from '../src/verify.mjs'

test('accepts a package or classic installation', async () => {
  let script = ''
  const runner = async (command) => {
    script = command
    return { code: 0, stdout: '', stderr: '' }
  }

  assert.equal(await verifyInstalled({ runner }), true)
  assert.match(script, /Get-AppxPackage OpenInOpenCode/)
  assert.match(script, /ProgramFiles/)
  assert.match(script, /ocshell\.exe/)
})

test('rejects a missing installation', async () => {
  const runner = async () => ({ code: 1, stdout: '', stderr: '' })
  assert.equal(await verifyInstalled({ runner }), false)
})
