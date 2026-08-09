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
