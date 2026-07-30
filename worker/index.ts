import serviceWorkerSource from './service-worker.js?raw'

interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url)
    if (url.pathname === '/sw.js') {
      return new Response(serviceWorkerSource, {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'CDN-Cache-Control': 'no-store',
          'Cloudflare-CDN-Cache-Control': 'no-store',
          'Content-Type': 'text/javascript; charset=utf-8',
          Expires: '0',
          Pragma: 'no-cache',
          'Service-Worker-Allowed': '/',
          'X-Dmg-Service-Worker': 'dynamic-v1',
        },
      })
    }

    const response = await env.ASSETS.fetch(request)
    const acceptsHtml = request.headers.get('Accept')?.includes('text/html') ?? false
    const mustRevalidate = (
      request.mode === 'navigate'
      || acceptsHtml
      || url.pathname === '/'
      || url.pathname === '/index.html'
      || url.pathname === '/sw.js'
      || url.pathname === '/manifest.webmanifest'
    )

    if (!mustRevalidate) return response

    const headers = new Headers(response.headers)
    headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')
    headers.set('Pragma', 'no-cache')
    if (url.pathname === '/sw.js') {
      headers.set('Service-Worker-Allowed', '/')
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  },
}
