const DESKTOP_WEB_MARKER = '__desktop_shell';

function isLoopbackHostname(hostname: string): boolean {
  return ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(
    hostname.toLowerCase().replace(/\.$/, ''),
  );
}

export function isDesktopWebHost(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.__DMG_DESKTOP_WEB_HOST__ === true) return true;
  try {
    const url = new URL(window.location.href);
    if (url.protocol !== 'http:' || !isLoopbackHostname(url.hostname)) return false;
    return url.port === '31457' || url.searchParams.get(DESKTOP_WEB_MARKER) === '1';
  } catch {
    return false;
  }
}
