import assert from 'node:assert/strict'
import test from 'node:test'
import { buildElevatedStartCommand, runElevated } from '../src/elevate.mjs'

test('builds an elevated Start-Process command', () => {
  const command = buildElevatedStartCommand('OIOC_TARGET', [
    '/VERYSILENT',
    '/SUPPRESSMSGBOXES',
    '/NORESTART',
  ])

  assert.match(command, /Start-Process -FilePath \$env:OIOC_TARGET/)
  assert.match(command, /-Verb RunAs/)
  assert.match(command, /-Wait -PassThru/)
  assert.match(command, /@\('\/VERYSILENT', '\/SUPPRESSMSGBOXES', '\/NORESTART'\)/)
  assert.match(command, /exit \$process\.ExitCode/)
})

test('escapes single quotes in arguments', () => {
  const command = buildElevatedStartCommand('OIOC_TARGET', ["a'b"])
  assert.match(command, /'a''b'/)
})

test('passes the target through the environment', async () => {
  let captured
  const runner = async (command, env) => {
    captured = { command, env }
    return { code: 0, stdout: '', stderr: '' }
  }

  const result = await runElevated('C:\\Temp\\setup.exe', ['/VERYSILENT'], { runner })

  assert.equal(result.code, 0)
  assert.equal(captured.env.OIOC_TARGET, 'C:\\Temp\\setup.exe')
  assert.match(captured.command, /\$env:OIOC_TARGET/)
})

test('turns a cancelled UAC prompt into a clear error', async () => {
  const runner = async () => ({
    code: 1,
    stdout: '',
    stderr: 'Start-Process : This command cannot be run due to the error: The operation was canceled by the user.',
  })

  await assert.rejects(
    () => runElevated('C:\\Temp\\setup.exe', ['/VERYSILENT'], { runner }),
    /Administrator approval was cancelled/,
  )
})

test('reports the elevated process exit code', async () => {
  const runner = async () => ({ code: 5, stdout: '', stderr: '' })

  await assert.rejects(
    () => runElevated('C:\\Temp\\setup.exe', ['/VERYSILENT'], { runner }),
    /exited with code 5/,
  )
})
