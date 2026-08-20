import {
  handleSitesMobileShareRequest,
  type SitesMobileShareEnv,
} from './mobileShareApi'

const DOMESTIC_ORIGIN = 'https://dmgendfield.cloud'
const RETIREMENT_RELEASE_VERSION = '1.8.5-retired'
const RETIREMENT_SHELL_VERSION = '3bbac54d4a3c4308'

const RETIREMENT_SERVICE_WORKER = `
const DOMESTIC_ORIGIN = ${JSON.stringify(DOMESTIC_ORIGIN)};
const RELEASE_VERSION = ${JSON.stringify(RETIREMENT_RELEASE_VERSION)};
const SHELL_VERSION = ${JSON.stringify(RETIREMENT_SHELL_VERSION)};

function domesticUrl(value) {
  const source = new URL(value);
  const target = new URL(DOMESTIC_ORIGIN);
  target.pathname = source.pathname;
  target.search = source.search;
  target.hash = source.hash;
  return target.href;
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'GET_PAGE_VERSION') {
    event.ports?.[0]?.postMessage({
      schemaVersion: 1,
      releaseVersion: RELEASE_VERSION,
      shellVersion: SHELL_VERSION,
    });
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const source = new URL(request.url);
  if (source.origin !== self.location.origin) return;
  if (
    source.pathname === '/api/mobile-shares'
    || source.pathname.startsWith('/api/mobile-shares/')
    || source.pathname === '/sw.js'
    || source.pathname === '/version.json'
  ) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }
  event.respondWith(Response.redirect(domesticUrl(request.url), 308));
});
`.trimStart()

function retirementHeaders(contentType?: string): Headers {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'X-DMG-Site-Status': 'retired',
  })
  if (contentType) headers.set('Content-Type', contentType)
  return headers
}

function domesticRedirect(requestUrl: string): Response {
  const source = new URL(requestUrl)
  const target = new URL(DOMESTIC_ORIGIN)
  target.pathname = source.pathname
  target.search = source.search
  const headers = retirementHeaders()
  headers.set('Location', target.href)
  return new Response(null, {
    status: 308,
    headers,
  })
}

function retirementServiceWorkerResponse(method: string): Response {
  const headers = retirementHeaders('application/javascript; charset=utf-8')
  headers.set('Service-Worker-Allowed', '/')
  headers.set('X-Content-Type-Options', 'nosniff')
  return new Response(method === 'HEAD' ? null : RETIREMENT_SERVICE_WORKER, { headers })
}

function retirementVersionResponse(method: string): Response {
  const body = JSON.stringify({
    schemaVersion: 1,
    releaseVersion: RETIREMENT_RELEASE_VERSION,
    shellVersion: RETIREMENT_SHELL_VERSION,
  })
  return new Response(method === 'HEAD' ? null : body, {
    headers: retirementHeaders('application/json; charset=utf-8'),
  })
}

export default {
  async fetch(request: Request, env: SitesMobileShareEnv) {
    const mobileShareResponse = await handleSitesMobileShareRequest(request, env)
    if (mobileShareResponse) return mobileShareResponse

    const url = new URL(request.url)
    if (
      (request.method === 'GET' || request.method === 'HEAD')
      && url.pathname === '/sw.js'
    ) {
      return retirementServiceWorkerResponse(request.method)
    }
    if (
      (request.method === 'GET' || request.method === 'HEAD')
      && url.pathname === '/version.json'
    ) {
      return retirementVersionResponse(request.method)
    }

    return domesticRedirect(request.url)
  },
}
