import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { downloadFile } from '../src/download.mjs'

async function tempDestination(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-download-test-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  return path.join(directory, 'setup.exe')
}

test('downloads an asset through PowerShell and reports the destination', async (t) => {
  const destination = await tempDestination(t)
  let captured

  const runner = async (command, env) => {
    captured = { command, env }
    await fs.writeFile(env.OIOC_OUT, 'payload')
    return { code: 0, stdout: '', stderr: '' }
  }

  const result = await downloadFile('https://example.test/setup.exe', destination, { runner })

  assert.equal(result, destination)
  assert.equal(captured.env.OIOC_URL, 'https://example.test/setup.exe')
  assert.equal(captured.env.OIOC_OUT, destination)
  assert.match(captured.command, /Invoke-WebRequest/)
  assert.match(captured.command, /-UseBasicParsing/)
  assert.equal(await fs.readFile(destination, 'utf8'), 'payload')
})

test('reports the first line of a failed download', async (t) => {
  const destination = await tempDestination(t)

  const runner = async () => ({
    code: 1,
    stdout: '',
    stderr: 'Invoke-WebRequest : 404 Not Found\nAt line:1 char:1',
  })

  await assert.rejects(
    () => downloadFile('https://example.test/missing.exe', destination, { runner }),
    /Could not download https:\/\/example\.test\/missing\.exe: Invoke-WebRequest : 404 Not Found/,
  )
})

test('rejects an empty download and removes it', async (t) => {
  const destination = await tempDestination(t)

  const runner = async (command, env) => {
    await fs.writeFile(env.OIOC_OUT, '')
    return { code: 0, stdout: '', stderr: '' }
  }

  await assert.rejects(
    () => downloadFile('https://example.test/empty.exe', destination, { runner }),
    /was empty/,
  )
  await assert.rejects(() => fs.stat(destination), { code: 'ENOENT' })
})

test('rejects a download over the size limit and removes it', async (t) => {
  const destination = await tempDestination(t)

  const runner = async (command, env) => {
    await fs.writeFile(env.OIOC_OUT, Buffer.alloc(11))
    return { code: 0, stdout: '', stderr: '' }
  }

  await assert.rejects(
    () => downloadFile('https://example.test/large.exe', destination, { runner, maxBytes: 10 }),
    /larger than the 10 bytes safety limit/,
  )
  await assert.rejects(() => fs.stat(destination), { code: 'ENOENT' })
})

test('rejects a successful process that produced no file', async (t) => {
  const destination = await tempDestination(t)
  const runner = async () => ({ code: 0, stdout: '', stderr: '' })

  await assert.rejects(
    () => downloadFile('https://example.test/missing.exe', destination, { runner }),
    /was not created/,
  )
})
