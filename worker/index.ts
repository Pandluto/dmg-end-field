interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>
  }
}

type ImagePackagePart = {
  path: string
  sha256: string
  size: number
}

type ImagePackageManifest = {
  archive?: {
    sourceUrl?: string
    parts?: ImagePackagePart[]
  }
}

type ImagePackageProxyRoute = ImagePackagePart & {
  end: number
  start: number
}

type ImagePackageProxyManifest = {
  routes: Map<string, ImagePackageProxyRoute>
  sourceUrl: string
}

let imagePackageProxyManifest: Promise<ImagePackageProxyManifest> | null = null

function normalizePackagePath(path: string): string {
  return `/${path.replace(/^\/+/, '')}`
}

async function loadImagePackageProxyManifest(
  requestUrl: string,
  env: Env,
): Promise<ImagePackageProxyManifest> {
  const manifestUrl = new URL('/web-image-manifest.json', requestUrl)
  const response = await env.ASSETS.fetch(new Request(manifestUrl, {
    headers: { Accept: 'application/json' },
  }))
  if (!response.ok) {
    throw new Error(`image package manifest returned HTTP ${response.status}`)
  }

  const manifest = await response.json() as ImagePackageManifest
  const sourceUrl = manifest.archive?.sourceUrl
  const parts = manifest.archive?.parts
  if (!sourceUrl || !Array.isArray(parts) || parts.length === 0) {
    throw new Error('image package manifest has no deployable archive parts')
  }
  const parsedSourceUrl = new URL(sourceUrl)
  if (parsedSourceUrl.protocol !== 'https:') {
    throw new Error('image package source URL must use HTTPS')
  }

  let start = 0
  const routes = new Map<string, ImagePackageProxyRoute>()
  for (const part of parts) {
    if (!part.path || !part.sha256 || !Number.isSafeInteger(part.size) || part.size <= 0) {
      throw new Error('image package manifest contains an invalid part')
    }
    const end = start + part.size - 1
    routes.set(normalizePackagePath(part.path), { ...part, start, end })
    start = end + 1
  }
  return { routes, sourceUrl: parsedSourceUrl.toString() }
}

async function getImagePackageProxyManifest(
  requestUrl: string,
  env: Env,
): Promise<ImagePackageProxyManifest> {
  imagePackageProxyManifest ??= loadImagePackageProxyManifest(requestUrl, env)
  try {
    return await imagePackageProxyManifest
  } catch (error) {
    imagePackageProxyManifest = null
    throw error
  }
}

function imagePackageResponseHeaders(part: ImagePackageProxyRoute): Headers {
  return new Headers({
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Length': String(part.size),
    'Content-Type': 'application/octet-stream',
    ETag: `"sha256-${part.sha256}"`,
    'X-Content-Type-Options': 'nosniff',
  })
}

async function proxyImagePackagePart(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/packages/')) return null

  const manifest = await getImagePackageProxyManifest(request.url, env)
  const part = manifest.routes.get(url.pathname)
  if (!part) return null
  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers: imagePackageResponseHeaders(part) })
  }
  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { Allow: 'GET, HEAD' },
    })
  }

  const upstream = await fetch(manifest.sourceUrl, {
    headers: { Range: `bytes=${part.start}-${part.end}` },
    redirect: 'follow',
  })
  const contentLength = Number(upstream.headers.get('Content-Length'))
  if (upstream.status !== 206 || contentLength !== part.size || !upstream.body) {
    await upstream.body?.cancel()
    throw new Error(
      `image package source returned ${upstream.status} with ${contentLength} bytes`,
    )
  }

  return new Response(upstream.body, {
    status: 200,
    headers: imagePackageResponseHeaders(part),
  })
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url)
    const isMobileRoute = url.pathname === '/mobile' || url.pathname.startsWith('/mobile/')
    try {
      const packageResponse = await proxyImagePackagePart(request, env)
      if (packageResponse) return packageResponse
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return new Response(`Image package is temporarily unavailable: ${message}`, {
        status: 502,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'text/plain; charset=utf-8',
        },
      })
    }

    let response = await env.ASSETS.fetch(request)
    if (
      response.status === 404
      && isMobileRoute
      && (request.method === 'GET' || request.method === 'HEAD')
    ) {
      response = await env.ASSETS.fetch(new Request(new URL('/index.html', request.url), {
        method: request.method,
        headers: request.headers,
        redirect: request.redirect,
      }))
    }

    const acceptsHtml = request.headers.get('Accept')?.includes('text/html') ?? false
    const mustRevalidate = (
      request.mode === 'navigate'
      || acceptsHtml
      || isMobileRoute
      || url.pathname === '/'
      || url.pathname === '/index.html'
      || url.pathname === '/sw.js'
      || url.pathname === '/version.json'
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
