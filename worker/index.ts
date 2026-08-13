import {
  handleSitesMobileShareRequest,
  type SitesMobileShareEnv,
} from './mobileShareApi'

interface Env extends SitesMobileShareEnv {
  ASSETS: {
    fetch(request: Request): Promise<Response>
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url)
    const mobileShareResponse = await handleSitesMobileShareRequest(request, env)
    if (mobileShareResponse) return mobileShareResponse
    const isMobileRoute = url.pathname === '/mobile' || url.pathname.startsWith('/mobile/')
    const isShareRoute = url.pathname.startsWith('/share/')
    const isClientEntryRoute = isMobileRoute || isShareRoute
    const assetRequest = (
      isClientEntryRoute
      && (request.method === 'GET' || request.method === 'HEAD')
    )
      ? new Request(new URL('/', request.url), {
        method: request.method,
        headers: request.headers,
        redirect: request.redirect,
      })
      : request
    const response = await env.ASSETS.fetch(assetRequest)
    const headers = new Headers(response.headers)
    const isVersionedResource = url.pathname.startsWith('/resources/releases/')
    const isImage = url.pathname.startsWith('/assets/images/')
    const isHashedBuildAsset = url.pathname.startsWith('/assets/') && !isImage
    const isStaticAssetNamespace = isVersionedResource || isImage || isHashedBuildAsset
    const isSpaFallback = (
      isStaticAssetNamespace
      && response.ok
      && response.headers.get('Content-Type')?.includes('text/html')
    )

    if (isSpaFallback) {
      return new Response('not found', {
        status: 404,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    }

    if (isVersionedResource) {
      headers.set(
        'Cache-Control',
        response.ok ? 'public, max-age=31536000, immutable' : 'no-store',
      )
      headers.set('X-Content-Type-Options', 'nosniff')
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    }

    if (isHashedBuildAsset) {
      headers.set(
        'Cache-Control',
        response.ok ? 'public, max-age=31536000, immutable' : 'no-store',
      )
      headers.set('X-Content-Type-Options', 'nosniff')
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    }

    if (isImage) {
      headers.set(
        'Cache-Control',
        response.ok ? 'public, max-age=0, must-revalidate' : 'no-store',
      )
      headers.set('X-Content-Type-Options', 'nosniff')
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    }

    const acceptsHtml = request.headers.get('Accept')?.includes('text/html') ?? false
    const mustRevalidate = (
      request.mode === 'navigate'
      || acceptsHtml
      || isClientEntryRoute
      || url.pathname === '/cache-recovery.html'
      || url.pathname === '/'
      || url.pathname === '/index.html'
      || url.pathname === '/sw.js'
      || url.pathname === '/version.json'
      || url.pathname === '/manifest.webmanifest'
      || url.pathname === '/resources/stable.json'
      || url.pathname === '/web-data-manifest.json'
      || url.pathname === '/web-image-manifest.json'
    )

    if (!mustRevalidate) return response

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
