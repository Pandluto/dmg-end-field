import { readFile, rm, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

const clientDirectory = resolve(process.cwd(), 'dist', 'client')
const manifestPath = resolve(clientDirectory, 'web-image-manifest.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const parts = manifest.archive?.parts

if (!manifest.archive?.sourceUrl || !Array.isArray(parts) || parts.length === 0) {
  throw new Error('Sites image package pruning requires archive.sourceUrl and archive.parts')
}

let removedBytes = 0
for (const part of parts) {
  const target = resolve(clientDirectory, part.path)
  const localPath = relative(clientDirectory, target)
  if (!localPath || localPath.startsWith('..') || isAbsolute(localPath)) {
    throw new Error(`Refusing to prune image package path outside dist/client: ${part.path}`)
  }
  const metadata = await stat(target)
  if (metadata.size !== part.size) {
    throw new Error(`Image package part size mismatch: ${part.path}`)
  }
  await rm(target)
  removedBytes += metadata.size
}

console.log(
  `Pruned ${parts.length} Sites image package parts (${removedBytes} bytes); `
  + 'the Worker will stream them from archive.sourceUrl.',
)
