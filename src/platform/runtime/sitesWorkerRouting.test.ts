import assert from 'node:assert/strict'
import sitesWorker from '../../../worker/index'

const requestedPaths: string[] = []
const env = {
  ASSETS: {
    async fetch(request: Request) {
      const pathname = new URL(request.url).pathname
      requestedPaths.push(pathname)
      if (pathname === '/') {
        return new Response('<main>mobile shell</main>', {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }
      if (pathname === '/mobile') {
        return Response.redirect('https://dmgendfield.online/', 307)
      }
      if (pathname.endsWith('/existing.part-001')) {
        return new Response('image archive part', {
          headers: { 'Content-Type': 'application/octet-stream' },
        })
      }
      if (pathname.endsWith('/missing.part-001')) {
        return new Response('<main>SPA fallback</main>', {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }
      if (pathname === '/assets/images/example.png') {
        return new Response('image bytes', {
          headers: { 'Content-Type': 'image/png' },
        })
      }
      return new Response('not found', { status: 404 })
    },
  },
}

const mobileResponse = await sitesWorker.fetch(
  new Request('https://dmgendfield.online/mobile'),
  env,
)
assert.equal(mobileResponse.status, 200)
assert.equal(await mobileResponse.text(), '<main>mobile shell</main>')
assert.equal(mobileResponse.headers.get('Cache-Control'), 'no-store, no-cache, must-revalidate')
assert.deepEqual(requestedPaths, ['/'])

requestedPaths.length = 0
const unrelatedResponse = await sitesWorker.fetch(
  new Request('https://dmgendfield.online/not-a-client-route'),
  env,
)
assert.equal(unrelatedResponse.status, 404)
assert.deepEqual(requestedPaths, ['/not-a-client-route'])

requestedPaths.length = 0
const stableResponse = await sitesWorker.fetch(
  new Request('https://dmgendfield.online/resources/stable.json'),
  env,
)
assert.equal(stableResponse.headers.get('Cache-Control'), 'no-store, no-cache, must-revalidate')
assert.deepEqual(requestedPaths, ['/resources/stable.json'])

requestedPaths.length = 0
const immutableResponse = await sitesWorker.fetch(
  new Request('https://dmgendfield.online/resources/releases/v-test/packages/existing.part-001'),
  env,
)
assert.equal(immutableResponse.status, 200)
assert.equal(immutableResponse.headers.get('Cache-Control'), 'public, max-age=31536000, immutable')
assert.deepEqual(requestedPaths, ['/resources/releases/v-test/packages/existing.part-001'])

requestedPaths.length = 0
const missingResourceResponse = await sitesWorker.fetch(
  new Request('https://dmgendfield.online/resources/releases/v-test/packages/missing.part-001'),
  env,
)
assert.equal(missingResourceResponse.status, 404)
assert.equal(missingResourceResponse.headers.get('Cache-Control'), 'no-store')
assert.deepEqual(requestedPaths, ['/resources/releases/v-test/packages/missing.part-001'])

requestedPaths.length = 0
const mobileImageResponse = await sitesWorker.fetch(
  new Request('https://dmgendfield.online/assets/images/example.png?imageVersion=v-test'),
  env,
)
assert.equal(mobileImageResponse.headers.get('Cache-Control'), 'public, max-age=0, must-revalidate')
assert.deepEqual(requestedPaths, ['/assets/images/example.png'])
