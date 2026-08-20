import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import sitesWorker from '../../../worker/index'

const viteConfigSource = readFileSync(new URL('../../../vite.config.ts', import.meta.url), 'utf8')
const packageSource = readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')
assert.match(
  viteConfigSource,
  /run_worker_first:\s*true/,
  'Sites must route every request through the retirement Worker',
)
assert.match(
  packageSource,
  /prune-sites-retirement-client\.mjs/,
  'Sites deployment must remove files that could bypass the retirement Worker',
)

const env = {} as Parameters<typeof sitesWorker.fetch>[1]

async function assertRedirect(source: string, target: string, method = 'GET'): Promise<void> {
  const response = await sitesWorker.fetch(new Request(source, { method }), env)
  assert.equal(response.status, 308)
  assert.equal(response.headers.get('Location'), target)
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.equal(response.headers.get('X-DMG-Site-Status'), 'retired')
}

await assertRedirect(
  'https://dmgendfield.online/',
  'https://dmgendfield.cloud/',
)
await assertRedirect(
  'https://dmgendfield.online/mobile?entry=bookmark',
  'https://dmgendfield.cloud/mobile?entry=bookmark',
)
await assertRedirect(
  'https://dmgendfield.online/share/AbCdEfGhIjKlMn01?source=qr',
  'https://dmgendfield.cloud/share/AbCdEfGhIjKlMn01?source=qr',
)
await assertRedirect(
  'https://dmgendfield-online.hf233666.chatgpt.site/resources/stable.json',
  'https://dmgendfield.cloud/resources/stable.json',
)
await assertRedirect(
  'https://dmgendfield-online.hf233666.chatgpt.site/assets/app.js?v=1',
  'https://dmgendfield.cloud/assets/app.js?v=1',
  'HEAD',
)
await assertRedirect(
  'https://dmgendfield.online//example.com/not-an-open-redirect',
  'https://dmgendfield.cloud//example.com/not-an-open-redirect',
)
await assertRedirect(
  'https://dmgendfield.online/api/mobile-shares-legacy',
  'https://dmgendfield.cloud/api/mobile-shares-legacy',
)

const versionResponse = await sitesWorker.fetch(
  new Request('https://dmgendfield.online/version.json?check=1'),
  env,
)
assert.equal(versionResponse.status, 200)
assert.equal(versionResponse.headers.get('Cache-Control'), 'no-store')
assert.deepEqual(await versionResponse.json(), {
  schemaVersion: 1,
  releaseVersion: '1.8.5-retired',
  shellVersion: '3bbac54d4a3c4308',
})

const serviceWorkerResponse = await sitesWorker.fetch(
  new Request('https://dmgendfield.online/sw.js?update=1'),
  env,
)
assert.equal(serviceWorkerResponse.status, 200)
assert.equal(serviceWorkerResponse.headers.get('Cache-Control'), 'no-store')
assert.equal(serviceWorkerResponse.headers.get('Service-Worker-Allowed'), '/')
assert.match(await serviceWorkerResponse.text(), /https:\/\/dmgendfield\.cloud/)
assert.match(await (await sitesWorker.fetch(
  new Request('https://dmgendfield.online/sw.js'),
  env,
)).text(), /self\.skipWaiting\(\)/)

const apiResponse = await sitesWorker.fetch(
  new Request('https://dmgendfield.online/api/mobile-shares', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://dmgendfield.cloud',
      'Access-Control-Request-Method': 'GET',
    },
  }),
  env,
)
assert.equal(apiResponse.status, 204)
assert.equal(apiResponse.headers.get('Access-Control-Allow-Origin'), 'https://dmgendfield.cloud')
assert.equal(apiResponse.headers.get('Location'), null)

console.log('Sites overseas retirement routing: PASS')
