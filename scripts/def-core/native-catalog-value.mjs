const BLOCKED_CATALOG_KEYS = new Set([
  'selected', 'selection', 'selectedIndex', 'draft', 'ui', 'session',
  'chat', 'commandQueue', 'command', 'approval', 'checkout', 'timeline',
  'workNode', 'workspace', 'storage', 'localStorage', 'sessionStorage',
]);

/**
 * Normalize the user-facing catalog identity while retaining the established
 * suffix convention that makes “潮涌套” resolve as the “潮涌” set.
 */
export function normalizeDefCatalogIdentity(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .replace(/(?:套装|套)$/u, '');
}

function project(value, depth) {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= 10 || !value || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) return value
    .map((item) => project(item, depth + 1))
    .filter((item) => item !== undefined);
  return Object.fromEntries(Object.keys(value).sort().flatMap((key) => {
    if (BLOCKED_CATALOG_KEYS.has(key)) return [];
    const entry = project(value[key], depth + 1);
    return entry === undefined ? [] : [[key, entry]];
  }));
}

/** Project catalog business facts without UI, session, approval, or storage state. */
export function projectDefCatalogSafeValue(value) {
  return project(value, 0);
}
