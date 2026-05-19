// ── ImageManager File Processing Layer ──
// Owns all resource path semantics, validation, and normalisation.
// Does NOT import React, does NOT touch page state, does NOT call IPC.

// ── Managed directory constants ──

const MANAGED_REL = 'assets/images';
export const MANAGED_ROOT = 'images';

// ── Path normalisation ──

/** Convert '' (全部图片) to the managed root for write-target resolution. */
export function normalizeDir(dir: string): string {
  return dir === '' ? MANAGED_ROOT : dir;
}

// ── Managed-directory checks ──

/** True when `dir` is a managed frontend directory (images or images/...). */
export function isManagedDir(dir: string): boolean {
  return dir === MANAGED_ROOT || dir.startsWith(MANAGED_ROOT + '/');
}

// ── Asset source checks ──

export function isUserAsset(entry: { source?: 'builtin' | 'user' }): boolean {
  return entry.source === 'user';
}

export function isBuiltinAsset(entry: { source?: 'builtin' | 'user' }): boolean {
  return entry.source === 'builtin';
}

// ── Frontend ↔ Backend path conversion ──

/**
 * Convert a frontend dir path to a backend-relative path.
 * `images`       → undefined (root)
 * `images/foo`   → `foo`
 * `images/a/b`   → `a/b`
 */
export function toManagedRelative(dir: string): string | undefined {
  if (!dir) return undefined;
  if (dir === MANAGED_ROOT) return undefined;
  if (dir.startsWith(MANAGED_ROOT + '/')) return dir.slice(MANAGED_ROOT.length + 1);
  return undefined;
}

/**
 * Convert a backend-relative path back to a frontend dir path.
 * undefined / '' → `images`
 * `foo`          → `images/foo`
 */
export function fromManagedRelative(rel: string | undefined): string {
  if (!rel) return MANAGED_ROOT;
  return `${MANAGED_ROOT}/${rel}`;
}

// ── Human-readable labels ──

/** Format a relativePath into a directory label for display. */
export function managedDirLabel(relativePath: string): string {
  const prefix = `${MANAGED_REL}/`;
  if (!relativePath.startsWith(prefix)) {
    const parts = relativePath.split('/');
    parts.pop();
    return parts.join('/') || '/';
  }
  const stripped = relativePath.slice(prefix.length);
  const i = stripped.lastIndexOf('/');
  return i === -1 ? '/' : stripped.slice(0, i);
}

// ── Path prefix helpers (used by page layer for state recovery) ──

/**
 * True when `assetPath` (assets/images/...) lives under `dir` (images or images/...).
 * Uses directory-boundary matching to avoid sibling-path false positives.
 */
export function isPathUnderDir(assetPath: string, dir: string): boolean {
  const prefix = `assets/${dir}/`;
  return assetPath.startsWith(prefix);
}

/**
 * Replace a directory prefix in a frontend path (images/old → images/new).
 * Only matches on complete directory boundaries:
 *   - exact match (path === oldDir)
 *   - path starts with oldDir + '/'
 */
export function replaceDirPrefix(frontendPath: string, oldDir: string, newDir: string): string {
  if (frontendPath === oldDir) return newDir;
  if (frontendPath.startsWith(oldDir + '/')) return newDir + frontendPath.slice(oldDir.length);
  return frontendPath;
}

/**
 * Replace a directory prefix in an asset relativePath
 * (assets/images/old/... → assets/images/new/...).
 * Only matches on complete directory boundaries.
 */
export function replaceAssetDirPrefix(assetPath: string, oldDir: string, newDir: string): string {
  const oldPrefix = `assets/${oldDir}`;
  if (assetPath === oldPrefix) return `assets/${newDir}`;
  if (assetPath.startsWith(oldPrefix + '/')) return `assets/${newDir}` + assetPath.slice(oldPrefix.length);
  return assetPath;
}

// ── Reveal path helpers (file-processing layer owns ALL reveal validation) ──

export interface NormalizedPath {
  ok: true;
  normalized: string;
}

export interface PathError {
  ok: false;
  error: string;
}

type PathResult = NormalizedPath | PathError;

/** Normalize and validate a managed directory path (images or images/...). */
export function validateManagedDirPath(dirPath: string): PathResult {
  if (!dirPath || typeof dirPath !== 'string') {
    return { ok: false, error: '缺少目录路径' };
  }
  const normalized = dirPath.replace(/\\/g, '/').replace(/\/+$/, '');
  if (normalized === '' || normalized === '.') {
    return { ok: false, error: '无效目录路径' };
  }
  if (normalized !== MANAGED_ROOT && !normalized.startsWith(MANAGED_ROOT + '/')) {
    return { ok: false, error: '目录不在管理范围内' };
  }
  return { ok: true, normalized };
}

/** Normalize and validate a managed file path (assets/images/...). */
export function validateManagedFilePath(filePath: string): PathResult {
  if (!filePath || typeof filePath !== 'string') {
    return { ok: false, error: '缺少文件路径' };
  }
  const normalized = filePath.replace(/\\/g, '/');
  if (!normalized.startsWith(`${MANAGED_REL}/`)) {
    return { ok: false, error: '非管理目录文件' };
  }
  return { ok: true, normalized };
}

// ── User-image path helpers ──

/**
 * Convert an asset relativePath (assets/images/foo/bar.png) to a user-image
 * relative path for the bridge HTTP server (foo/bar.png).
 * Returns null for builtin assets.
 */
export function toUserImageRelPath(entry: { relativePath: string; source?: 'builtin' | 'user' }): string | null {
  if (entry.source !== 'user') return null;
  const prefix = `${MANAGED_REL}/`;
  if (!entry.relativePath.startsWith(prefix)) return null;
  return entry.relativePath.slice(prefix.length);
}
