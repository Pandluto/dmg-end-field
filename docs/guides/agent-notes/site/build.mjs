import { access, cp, mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const projectDir = path.dirname(fileURLToPath(import.meta.url))
const sourceDir = path.resolve(projectDir, "../web/dist")
const outputDir = path.join(projectDir, "dist")
const clientDir = path.join(outputDir, "client")
const serverDir = path.join(outputDir, "server")
const metadataDir = path.join(outputDir, ".openai")

await access(path.join(sourceDir, "index.html"))
await access(path.join(sourceDir, "10-harness.html"))

await rm(outputDir, { recursive: true, force: true })
await mkdir(clientDir, { recursive: true })
await mkdir(serverDir, { recursive: true })
await mkdir(metadataDir, { recursive: true })

await cp(sourceDir, clientDir, { recursive: true })
await cp(path.join(projectDir, "worker", "index.js"), path.join(serverDir, "index.js"))
await cp(
  path.join(projectDir, ".openai", "hosting.json"),
  path.join(metadataDir, "hosting.json"),
)

console.log(`Prepared Agent Notes for Sites at ${outputDir}`)
