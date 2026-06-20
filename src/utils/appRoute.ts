export const APP_ROUTE_PATHS = {
  home: '/',
  draft: '/operator-studio',
  buffSheet: '/buff-sheet',
  weaponSheet: '/weapon-sheet',
  equipmentSheet: '/sheet-equipment',
  operatorConfig: '/operator-config',
  damageSheet: '/damage-sheet',
  damageReportPpt: '/damage-report-ppt',
  imageManager: '/image-manager',
  aiCli: '/ai-cli',
} as const;

function normalizeRoutePath(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return APP_ROUTE_PATHS.home;
  }

  const withoutHash = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  const withoutQuery = withoutHash.split('?')[0] ?? '';
  const normalized = withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;

  if (normalized === '/index.html' || /\/index\.html$/i.test(normalized)) {
    return APP_ROUTE_PATHS.home;
  }

  if (normalized.length > 1 && normalized.endsWith('/')) {
    return normalized.slice(0, -1);
  }

  return normalized;
}

export function getCurrentAppPath(locationLike: Pick<Location, 'hash' | 'pathname'>): string {
  if (locationLike.hash) {
    return normalizeRoutePath(locationLike.hash);
  }
  return normalizeRoutePath(locationLike.pathname);
}

export function navigateToAppPath(path: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  const normalized = normalizeRoutePath(path);
  const nextHash = `#${normalized}`;
  if (window.location.hash === nextHash) {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    return;
  }
  window.location.hash = nextHash;
}
