interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const response = await env.ASSETS.fetch(request)
    const url = new URL(request.url)
    const acceptsHtml = request.headers.get('Accept')?.includes('text/html') ?? false
    const mustRevalidate = (
      request.mode === 'navigate'
      || acceptsHtml
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
