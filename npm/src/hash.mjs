import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

export async function sha256File(file) {
  const hash = createHash('sha256')
  const stream = createReadStream(file)

  await new Promise((resolve, reject) => {
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolve)
  })

  return hash.digest('hex')
}
