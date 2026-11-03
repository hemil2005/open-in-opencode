import fs from 'node:fs/promises'
import path from 'node:path'

export function createLog() {
  const lines = []
  return {
    lines,
    log: (...args) => lines.push(args.join(' ')),
    error: (...args) => lines.push(args.join(' ')),
    text: () => lines.join('\n'),
  }
}

export function fakeDownloader(files) {
  return async (url, destination) => {
    if (!(url in files)) throw new Error(`unexpected download: ${url}`)
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.writeFile(destination, files[url])
    return destination
  }
}
