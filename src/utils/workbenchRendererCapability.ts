export const WORKBENCH_RENDERER_CAPABILITY_HEADER = 'x-def-workbench-renderer-capability';
export const WORKBENCH_RENDERER_CAPABILITY_QUERY = '__defWorkbenchRendererCapability';
const WORKBENCH_RENDERER_CAPABILITY_SESSION_KEY = 'def.main-workbench.renderer-capability.v1';
const WORKBENCH_RENDERER_BRIDGE_ORIGIN = 'http://127.0.0.1:31457';

function readRendererCapability(): string {
  if (typeof window === 'undefined') return '';
  const url = new URL(window.location.href);
  const fromLaunch = url.searchParams.get(WORKBENCH_RENDERER_CAPABILITY_QUERY)?.trim() || '';
  if (fromLaunch) {
    try {
      window.sessionStorage.setItem(WORKBENCH_RENDERER_CAPABILITY_SESSION_KEY, fromLaunch);
    } catch {
      // The in-memory launch capability still works when sessionStorage is disabled.
    }
    url.searchParams.delete(WORKBENCH_RENDERER_CAPABILITY_QUERY);
    window.history.replaceState(window.history.state, document.title, `${url.pathname}${url.search}${url.hash}`);
    return fromLaunch;
  }
  try {
    return window.sessionStorage.getItem(WORKBENCH_RENDERER_CAPABILITY_SESSION_KEY)?.trim() || '';
  } catch {
    return '';
  }
}

const rendererCapability = readRendererCapability();

export function isWorkbenchRendererBridgeUrl(input: RequestInfo | URL): boolean {
  try {
    const value = typeof Request !== 'undefined' && input instanceof Request ? input.url : String(input);
    return new URL(value).origin === WORKBENCH_RENDERER_BRIDGE_ORIGIN;
  } catch {
    return false;
  }
}

export function withWorkbenchRendererCapability(input: RequestInfo | URL, headers?: HeadersInit): Headers {
  const result = new Headers(headers);
  if (rendererCapability && isWorkbenchRendererBridgeUrl(input)) {
    result.set(WORKBENCH_RENDERER_CAPABILITY_HEADER, rendererCapability);
  }
  return result;
}

export function buildWorkbenchRendererEventUrl(baseUrl: string, pathname: string): string {
  const url = new URL(pathname, baseUrl);
  if (rendererCapability && isWorkbenchRendererBridgeUrl(url)) {
    url.searchParams.set(WORKBENCH_RENDERER_CAPABILITY_QUERY, rendererCapability);
  }
  return url.toString();
}
