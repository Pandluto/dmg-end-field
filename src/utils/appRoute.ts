export const APP_ROUTE_PATHS = {
  home: '/',
  draft: '/operator-studio',
  buffDraft: '/buff-studio',
  buffSheet: '/buff-sheet',
  weaponSheet: '/weapon-sheet',
  equipmentSheet: '/sheet-equipment',
  damageSheet: '/damage-sheet',
  imageManager: '/image-manager',
} as const;

const APP_ROUTE_ALIASES: Record<string, string> = {
  '/draft': APP_ROUTE_PATHS.draft,
  '/character-studio': APP_ROUTE_PATHS.draft,
  '/buff-draft': APP_ROUTE_PATHS.buffDraft,
  '/sheet-buff': APP_ROUTE_PATHS.buffSheet,
  '/sheet-weapon': APP_ROUTE_PATHS.weaponSheet,
  '/equipment-sheet': APP_ROUTE_PATHS.equipmentSheet,
  '/sheet': APP_ROUTE_PATHS.damageSheet,
};

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
    return APP_ROUTE_ALIASES[normalized.slice(0, -1)] ?? normalized.slice(0, -1);
  }

  return APP_ROUTE_ALIASES[normalized] ?? normalized;
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
