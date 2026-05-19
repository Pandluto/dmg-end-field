// ── ImageManager Communication Layer ──
// Unified entry point for desktop (Electron IPC) and browser (read-only).
// Does NOT contain path rules, file-system logic, or page state.
// Path semantics belong to imageFileService.ts.

import type { ImageAssetEntry } from '../components/ImageManager/types';
import {
  validateManagedDirPath,
  validateManagedFilePath,
  toUserImageRelPath,
} from './imageFileService';

// ── Bridge server constants ──

const BRIDGE_ORIGIN = 'http://127.0.0.1:31457';

// ── Capability primitives ──

function hasHostMethod(name: string): boolean {
  const rt = window.desktopRuntime;
  if (!rt) return false;
  return typeof (rt as unknown as Record<string, unknown>)[name] === 'function';
}

// ── Capabilities snapshot ──

export interface ImageManagerCapabilities {
  canList: boolean;
  canImport: boolean;
  canRename: boolean;
  canRenameDir: boolean;
  canDeleteFile: boolean;
  canCreateDir: boolean;
  canDeleteDir: boolean;
  canReveal: boolean;
  isElectron: boolean;
  isWritable: boolean;
  backendLabel: string;
}

export function getCapabilities(): ImageManagerCapabilities {
  const canList = hasHostMethod('listImageAssets');
  const canImport = hasHostMethod('importImageAssetsToDir');
  const canRename = hasHostMethod('renameImageAsset');
  const canRenameDir = hasHostMethod('renameImageDirectory');
  const canDeleteFile = hasHostMethod('deleteImageAsset');
  const canCreateDir = hasHostMethod('createImageDirectory');
  const canDeleteDir = hasHostMethod('deleteImageDirectory');
  const canReveal = hasHostMethod('revealInExplorer');
  const isElectron = canList;
  const isWritable = isElectron && canImport && canCreateDir && canRename;
  const backendLabel = isElectron ? (isWritable ? '桌面端 · 可管理' : '桌面端 · 受限') : '浏览器端 · 只读预览';

  return { canList, canImport, canRename, canRenameDir, canDeleteFile, canCreateDir, canDeleteDir, canReveal, isElectron, isWritable, backendLabel };
}

// ── Shared helpers ──

function requireDesktop(cap: keyof ImageManagerCapabilities): void {
  if (!hasHostMethod(methodForCap(cap))) {
    throw new Error('当前环境不支持此操作');
  }
}

function methodForCap(cap: keyof ImageManagerCapabilities): string {
  const map: Record<string, string> = {
    canList: 'listImageAssets',
    canImport: 'importImageAssetsToDir',
    canRename: 'renameImageAsset',
    canRenameDir: 'renameImageDirectory',
    canDeleteFile: 'deleteImageAsset',
    canCreateDir: 'createImageDirectory',
    canDeleteDir: 'deleteImageDirectory',
    canReveal: 'revealInExplorer',
  };
  return map[cap] || '';
}

/** Build a URL for a user image served by the Electron bridge HTTP server. */
export function getUserImageUrl(entry: ImageAssetEntry): string | null {
  const rel = toUserImageRelPath(entry);
  if (!rel) return null;
  return `${BRIDGE_ORIGIN}/user-images/${encodeURI(rel).replace(/%2F/g, '/')}`;
}

// ── Unified API ──

export const imageBridge = {
  getCapabilities,

  // ── List ──

  async listAssets(): Promise<ImageAssetEntry[]> {
    if (hasHostMethod('listImageAssets')) {
      return window.desktopRuntime!.listImageAssets!();
    }
    const { resolvePublicPath } = await import('./assetResolver');
    const url = resolvePublicPath('assets/images/_manifest.json');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  // ── Import ──

  async importToDir(targetDir?: string): Promise<{ ok: boolean; error?: string; imported?: string[] }> {
    requireDesktop('canImport');
    return window.desktopRuntime!.importImageAssetsToDir!({ targetDir });
  },

  // ── Create directory ──

  async createDirectory(dirName: string, parentDir?: string): Promise<{ ok: boolean; error?: string; createdPath?: string }> {
    requireDesktop('canCreateDir');
    return window.desktopRuntime!.createImageDirectory!({ dirName, parentDir });
  },

  // ── Delete directory ──

  async deleteDirectory(relativePath: string): Promise<{ ok: boolean; error?: string; lockedFiles?: string[] }> {
    requireDesktop('canDeleteDir');
    return window.desktopRuntime!.deleteImageDirectory!({ relativePath });
  },

  // ── Rename file ──

  async renameFile(relativePath: string, newName: string): Promise<{ ok: boolean; error?: string }> {
    requireDesktop('canRename');
    return window.desktopRuntime!.renameImageAsset!({ relativePath, newName });
  },

  // ── Rename directory ──

  async renameDirectory(dirPath: string, newName: string): Promise<{ ok: boolean; error?: string; newPath?: string }> {
    requireDesktop('canRenameDir');
    return window.desktopRuntime!.renameImageDirectory!({ dirPath, newName });
  },

  // ── Delete file ──

  async deleteFile(relativePath: string): Promise<{ ok: boolean; error?: string }> {
    requireDesktop('canDeleteFile');
    return window.desktopRuntime!.deleteImageAsset!({ relativePath });
  },

  // ── Reveal file ──

  async revealFile(relativePath: string): Promise<{ ok: boolean; error?: string }> {
    requireDesktop('canReveal');
    const validated = validateManagedFilePath(relativePath);
    if (!validated.ok) return validated;
    return window.desktopRuntime!.revealInExplorer!({ kind: 'file', relativePath: validated.normalized });
  },

  // ── Reveal directory ──

  async revealDirectory(dirPath: string): Promise<{ ok: boolean; error?: string }> {
    requireDesktop('canReveal');
    const validated = validateManagedDirPath(dirPath);
    if (!validated.ok) return validated;
    return window.desktopRuntime!.revealInExplorer!({ kind: 'dir', dirPath: validated.normalized });
  },
};

// Re-export for convenience (page layer needs these)
export { isManagedDir, normalizeDir } from './imageFileService';
