export const APP_ROUTE_PATHS = {
  home: '/',
  draft: '/operator-studio',
  buffSheet: '/buff-sheet',
  weaponSheet: '/weapon-sheet',
  equipmentSheet: '/sheet-equipment',
  operatorConfig: '/operator-config',
  timelineSkillDetail: '/timeline-skill-detail',
  damageSheet: '/damage-sheet',
  damageReportPpt: '/damage-report-ppt',
  imageManager: '/image-manager',
  aiCli: '/ai-cli',
  mcpFill: '/mcp-fill',
  /** @deprecated Compatibility alias for links created before the MCP product route was named. */
  legacyFillReview: '/legacy-fill-review',
} as const;

export function getTimelineSkillDetailPath(buttonId: string): string {
  return `${APP_ROUTE_PATHS.timelineSkillDetail}/${encodeURIComponent(buttonId)}`;
}

export function getTimelineSkillDetailButtonId(path: string): string | null {
  const prefix = `${APP_ROUTE_PATHS.timelineSkillDetail}/`;
  if (!path.startsWith(prefix)) {
    return null;
  }

  const encodedButtonId = path.slice(prefix.length);
  if (!encodedButtonId) {
    return null;
  }

  try {
    return decodeURIComponent(encodedButtonId);
  } catch {
    return null;
  }
}

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
