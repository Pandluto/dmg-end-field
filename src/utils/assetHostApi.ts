import type { ImageAssetEntry } from '../components/ImageManager/types';

// ── Managed directory constants ──

const MANAGED_REL = 'assets/images';
const MANAGED_TOP = 'images';

// ── Capability detection ──

function hasHostMethod(name: string): boolean {
  const rt = window.desktopRuntime;
  if (!rt) return false;
  return typeof (rt as unknown as Record<string, unknown>)[name] === 'function';
}

// ── Runtime host diagnostics ──

export interface HostMethodStatus {
  list: boolean;
  importFiles: boolean;
  importToDir: boolean;
  rename: boolean;
  renameDir: boolean;
  deleteFile: boolean;
  createDir: boolean;
  deleteDir: boolean;
  reveal: boolean;
}

export interface HostStatus {
  hasDesktopRuntime: boolean;
  methods: HostMethodStatus;
  isElectronLike: boolean;
  allWritable: boolean;
  mode: 'electron-writable' | 'electron-readonly' | 'browser-readonly';
  backendLabel: string;
  missingHint: string;
}

export function getHostStatus(): HostStatus {
  const m: HostMethodStatus = {
    list: hasHostMethod('listImageAssets'),
    importFiles: hasHostMethod('importImageAssets'),
    importToDir: hasHostMethod('importImageAssetsToDir'),
    rename: hasHostMethod('renameImageAsset'),
    renameDir: hasHostMethod('renameImageDirectory'),
    deleteFile: hasHostMethod('deleteImageAsset'),
    createDir: hasHostMethod('createImageDirectory'),
    deleteDir: hasHostMethod('deleteImageDirectory'),
    reveal: hasHostMethod('revealInExplorer'),
  };

  const hasDesktopRuntime = typeof window.desktopRuntime !== 'undefined' && window.desktopRuntime !== null;
  const isElectronLike = m.list;
  const allWritable = m.importToDir && m.rename && m.renameDir && m.deleteFile && m.createDir && m.deleteDir;

  let mode: HostStatus['mode'];
  if (isElectronLike) {
    mode = allWritable ? 'electron-writable' : 'electron-readonly';
  } else {
    mode = 'browser-readonly';
  }

  const missing: string[] = [];
  if (!m.list) missing.push('listImageAssets');
  if (!m.importToDir) missing.push('importImageAssetsToDir');
  if (!m.rename) missing.push('renameImageAsset');
  if (!m.renameDir) missing.push('renameImageDirectory');
  if (!m.deleteFile) missing.push('deleteImageAsset');
  if (!m.createDir) missing.push('createImageDirectory');
  if (!m.deleteDir) missing.push('deleteImageDirectory');
  if (!m.reveal) missing.push('revealInExplorer');
  const missingHint = missing.length > 0 ? `缺少: ${missing.join(', ')}` : '';

  let backendLabel: string;
  if (isElectronLike) {
    backendLabel = allWritable ? '桌面端 · 可管理' : `桌面端 · ${missingHint}`;
  } else {
    backendLabel = '浏览器端 · 只读预览';
  }

  return { hasDesktopRuntime, methods: m, isElectronLike, allWritable, mode, backendLabel, missingHint };
}

// ── Unified Desktop-First API ──

export const assetHostApi = {
  // ── Capabilities ──

  get canList(): boolean { return hasHostMethod('listImageAssets'); },
  get canImport(): boolean { return hasHostMethod('importImageAssetsToDir'); },
  get canRename(): boolean { return hasHostMethod('renameImageAsset'); },
  get canRenameDir(): boolean { return hasHostMethod('renameImageDirectory'); },
  get canDeleteFile(): boolean { return hasHostMethod('deleteImageAsset'); },
  get canCreateDir(): boolean { return hasHostMethod('createImageDirectory'); },
  get canDeleteDir(): boolean { return hasHostMethod('deleteImageDirectory'); },
  get canReveal(): boolean { return hasHostMethod('revealInExplorer'); },
  get isElectron(): boolean { return hasHostMethod('listImageAssets'); },
  get isWritable(): boolean {
    return this.isElectron && this.canImport && this.canCreateDir && this.canRename;
  },

  get backendLabel(): string { return getHostStatus().backendLabel; },

  // ── Operations ──

  async listAssets(): Promise<ImageAssetEntry[]> {
    if (hasHostMethod('listImageAssets')) {
      return window.desktopRuntime!.listImageAssets!();
    }
    const { resolvePublicPath } = await import('./assetResolver');
    const url = resolvePublicPath(`${MANAGED_REL}/_manifest.json`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  /** Desktop: native dialog import into a target directory. */
  async importToDir(targetDir?: string): Promise<{ ok: boolean; error?: string; imported?: string[] }> {
    if (!hasHostMethod('importImageAssetsToDir')) {
      return { ok: false, error: '当前环境不支持导入' };
    }
    return window.desktopRuntime!.importImageAssetsToDir!({ targetDir });
  },

  /** Browser fallback: base64 import. Disabled in desktop-first mode. */
  async importFiles(
    items: { fileName: string; data: string }[],
    targetDir?: string,
  ): Promise<{ ok: boolean; results: { fileName: string; ok: boolean; error?: string }[]; error?: string }> {
    if (!hasHostMethod('importImageAssetsFromBrowser')) {
      return { ok: false, results: [], error: '当前环境不支持导入' };
    }
    return window.desktopRuntime!.importImageAssetsFromBrowser!({ items, targetDir });
  },

  async createDirectory(
    dirName: string,
    parentDir?: string,
  ): Promise<{ ok: boolean; error?: string; createdPath?: string }> {
    if (!hasHostMethod('createImageDirectory')) {
      return { ok: false, error: '当前环境不支持创建目录' };
    }
    return window.desktopRuntime!.createImageDirectory!({ dirName, parentDir });
  },

  async deleteDirectory(
    relativePath: string,
  ): Promise<{ ok: boolean; error?: string; lockedFiles?: string[] }> {
    if (!hasHostMethod('deleteImageDirectory')) {
      return { ok: false, error: '当前环境不支持删除目录' };
    }
    return window.desktopRuntime!.deleteImageDirectory!({ relativePath });
  },

  async renameFile(
    relativePath: string,
    newName: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!hasHostMethod('renameImageAsset')) {
      return { ok: false, error: '当前环境不支持重命名' };
    }
    return window.desktopRuntime!.renameImageAsset!({ relativePath, newName });
  },

  async renameDirectory(
    dirPath: string,
    newName: string,
  ): Promise<{ ok: boolean; error?: string; newPath?: string }> {
    if (!hasHostMethod('renameImageDirectory')) {
      return { ok: false, error: '当前环境不支持重命名目录' };
    }
    return window.desktopRuntime!.renameImageDirectory!({ dirPath, newName });
  },

  async deleteFile(
    relativePath: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!hasHostMethod('deleteImageAsset')) {
      return { ok: false, error: '当前环境不支持删除文件' };
    }
    return window.desktopRuntime!.deleteImageAsset!({ relativePath });
  },

  /** Reveal a file in system file manager. relativePath must be "assets/images/...". */
  async revealFile(relativePath: string): Promise<{ ok: boolean; error?: string }> {
    if (!hasHostMethod('revealInExplorer')) {
      return { ok: false, error: '当前环境不支持此操作' };
    }
    if (!relativePath || typeof relativePath !== 'string') {
      return { ok: false, error: '缺少文件路径' };
    }
    const normalized = relativePath.replace(/\\/g, '/');
    if (!normalized.startsWith('assets/images/')) {
      return { ok: false, error: '非管理目录文件' };
    }
    return window.desktopRuntime!.revealInExplorer!({ kind: 'file', relativePath: normalized });
  },

  /** Open a managed directory in system file manager. dirPath must be "images" or "images/...". */
  async revealDirectory(dirPath: string): Promise<{ ok: boolean; error?: string }> {
    if (!hasHostMethod('revealInExplorer')) {
      return { ok: false, error: '当前环境不支持此操作' };
    }
    if (!dirPath || typeof dirPath !== 'string') {
      return { ok: false, error: '缺少目录路径' };
    }
    const normalized = dirPath.replace(/\\/g, '/').replace(/\/+$/, '');
    if (normalized === '') {
      return { ok: false, error: '无效目录路径' };
    }
    if (normalized !== 'images' && !normalized.startsWith('images/')) {
      return { ok: false, error: '目录不在管理范围内' };
    }
    return window.desktopRuntime!.revealInExplorer!({ kind: 'dir', dirPath: normalized });
  },
};

// ── Managed directory helpers ──

export function isManagedDir(dir: string): boolean {
  return dir === MANAGED_TOP || dir.startsWith(MANAGED_TOP + '/');
}

/** Convert a frontend dir path to backend-relative (strip "images" prefix). Returns undefined for root. */
export function toManagedRelative(dir: string): string | undefined {
  if (!dir) return undefined;
  if (dir === MANAGED_TOP) return undefined;
  if (dir.startsWith(MANAGED_TOP + '/')) return dir.slice(MANAGED_TOP.length + 1);
  return undefined;
}

/** Resolve a backend-relative path back to a frontend dir path. */
export function fromManagedRelative(rel: string | undefined): string {
  if (!rel) return MANAGED_TOP;
  return `${MANAGED_TOP}/${rel}`;
}

/** Format a relativePath into a human-readable directory label. */
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
