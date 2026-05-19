import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../utils/appRoute';
import { resolvePublicPath } from '../utils/assetResolver';
import { imageBridge, getCapabilities, isManagedDir, normalizeDir, getUserImageUrl } from '../utils/imageBridge';
import {
  MANAGED_ROOT,
  toManagedRelative,
  fromManagedRelative,
  managedDirLabel,
  isPathUnderDir,
  replaceDirPrefix,
  replaceAssetDirPrefix,
} from '../utils/imageFileService';
import './ImageManagerPage.css';
import { ImageManagerRibbon } from './ImageManager/ImageManagerRibbon';
import { ImageManagerExplorer } from './ImageManager/ImageManagerExplorer';
import { ImageManagerAssetList } from './ImageManager/ImageManagerAssetList';
import { ImageManagerPreviewPanel } from './ImageManager/ImageManagerPreviewPanel';
import { ImageManagerRenameModal } from './ImageManager/ImageManagerRenameModal';
import { ImageManagerCreateFolderModal } from './ImageManager/ImageManagerCreateFolderModal';
import { ImageManagerDeleteFolderModal } from './ImageManager/ImageManagerDeleteFolderModal';
import { ImageManagerHostStatus } from './ImageManager/ImageManagerHostStatus';
import type { ImageAssetEntry, TreeNode, CtxTarget, DirActions, FileActions } from './ImageManager/types';

export { managedDirLabel };

const IMAGE_MANAGER_SESSION_KEY = 'image-manager:session-state';

interface ImageManagerSessionState {
  browseDir: string;
  selectedAssetPath: string | null;
  previewAssetPath: string | null;
  expandedDirs: string[];
}

function readImageManagerSessionState(): ImageManagerSessionState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(IMAGE_MANAGER_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ImageManagerSessionState>;
    return {
      browseDir: typeof parsed.browseDir === 'string' ? parsed.browseDir : '',
      selectedAssetPath: typeof parsed.selectedAssetPath === 'string' ? parsed.selectedAssetPath : null,
      previewAssetPath: typeof parsed.previewAssetPath === 'string' ? parsed.previewAssetPath : null,
      expandedDirs: Array.isArray(parsed.expandedDirs)
        ? parsed.expandedDirs.filter((value): value is string => typeof value === 'string')
        : [],
    };
  } catch {
    return null;
  }
}

function writeImageManagerSessionState(state: ImageManagerSessionState): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(IMAGE_MANAGER_SESSION_KEY, JSON.stringify(state));
  } catch {
    // best-effort cache only
  }
}

// ── UI presentation helpers (belongs to interaction layer) ──

function assetUrl(entry: ImageAssetEntry): string {
  const userUrl = getUserImageUrl(entry);
  if (userUrl) return userUrl;
  const isFileProtocol = window.location.protocol === 'file:';
  const path = isFileProtocol
    ? entry.relativePath
    : entry.relativePath.split('/').map(encodeURIComponent).join('/');
  return resolvePublicPath(path);
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '--';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(2)} MB`;
}

// ── Tree builder (UI data transformation) ──

function buildTree(assets: ImageAssetEntry[]): TreeNode[] {
  const files = assets.filter((a) => a.kind !== 'dir');
  const emptyDirs = assets.filter((a) => a.kind === 'dir');

  const dirCounts = new Map<string, number>();
  for (const a of files) {
    const parts = a.relativePath.replace(/^assets\//, '').split('/');
    parts.pop();
    for (let i = 1; i <= parts.length; i++) {
      const dirPath = parts.slice(0, i).join('/');
      dirCounts.set(dirPath, (dirCounts.get(dirPath) || 0) + 1);
    }
  }

  for (const d of emptyDirs) {
    const dirPath = d.relativePath.replace(/^assets\//, '');
    if (!dirCounts.has(dirPath)) dirCounts.set(dirPath, 0);
  }

  const treeMap = new Map<string, TreeNode>();

  for (const a of files) {
    const parts = a.relativePath.replace(/^assets\//, '').split('/');
    for (let i = 0; i < parts.length - 1; i++) {
      const dirPath = parts.slice(0, i + 1).join('/');
      if (!treeMap.has(dirPath)) {
        treeMap.set(dirPath, {
          name: parts[i], path: dirPath,
          isManaged: isManagedDir(dirPath),
          count: dirCounts.get(dirPath) || 0, children: [],
        });
      }
    }
  }

  for (const d of emptyDirs) {
    const dirPath = d.relativePath.replace(/^assets\//, '');
    if (!treeMap.has(dirPath)) {
      treeMap.set(dirPath, {
        name: d.fileName, path: dirPath,
        isManaged: true, count: 0, children: [],
      });
    }
  }

  const roots: TreeNode[] = [];
  for (const [dirPath, node] of treeMap) {
    const parentParts = dirPath.split('/');
    parentParts.pop();
    const parentPath = parentParts.join('/');
    if (parentPath && treeMap.has(parentPath)) {
      treeMap.get(parentPath)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortChildren = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    for (const n of nodes) sortChildren(n.children);
  };
  sortChildren(roots);
  return roots;
}

// ── Action capability helpers (UI-layer: translate caps → button states) ──

function computeDirActions(dir: string): DirActions {
  const caps = getCapabilities();
  const isRoot = dir === MANAGED_ROOT;

  if (!isManagedDir(dir)) {
    return { canCreateDir: false, canImport: false, canRenameDir: false, canDeleteDir: false, canReveal: false, reason: '非管理目录，只读' };
  }

  const missing: string[] = [];
  if (!caps.canCreateDir) missing.push('createImageDirectory');
  if (!caps.canImport) missing.push('importImageAssetsToDir');
  if (!caps.canRenameDir) missing.push('renameImageDirectory');
  if (!caps.canDeleteDir) missing.push('deleteImageDirectory');
  if (!caps.canReveal) missing.push('revealInExplorer');

  return {
    canCreateDir: caps.canCreateDir,
    canImport: caps.canImport,
    canRenameDir: caps.canRenameDir && !isRoot,
    canDeleteDir: caps.canDeleteDir && !isRoot,
    canReveal: caps.canReveal,
    reason: missing.length > 0 ? `缺少: ${missing.join(', ')}` : undefined,
  };
}

function computeFileActions(asset: ImageAssetEntry): FileActions {
  const caps = getCapabilities();
  if (!asset.writable) {
    return { canRename: false, canDelete: false, canReveal: false, canCopyPath: true, reason: '非管理目录，只读' };
  }
  const missing: string[] = [];
  if (!caps.canRename) missing.push('renameImageAsset');
  if (!caps.canDeleteFile) missing.push('deleteImageAsset');
  if (!caps.canReveal) missing.push('revealInExplorer');
  return {
    canRename: caps.canRename,
    canDelete: caps.canDeleteFile,
    canReveal: caps.canReveal,
    canCopyPath: true,
    reason: missing.length > 0 ? `缺少: ${missing.join(', ')}` : undefined,
  };
}

// ── Route guard ──

export function isImageManagerPath(path: string): boolean {
  return path === APP_ROUTE_PATHS.imageManager;
}

// ══════════════════════════════════════════════════════════
// Component — interaction layer only
// ══════════════════════════════════════════════════════════

export function ImageManagerPage() {
  // ── Data ──
  const [assets, setAssets] = useState<ImageAssetEntry[]>([]);
  const [hasLoadedAssets, setHasLoadedAssets] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // ── Browse context ──
  const [browseDir, setBrowseDir] = useState('');

  // ── List highlight ──
  const [selectedAssetPath, setSelectedAssetPath] = useState<string | null>(null);

  // ── Preview panel ──
  const [previewAssetPath, setPreviewAssetPath] = useState<string | null>(null);

  // ── Tree expansion ──
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  // ── Search / view ──
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

  // ── Modal / menu ──
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; target: CtxTarget } | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameTarget, setRenameTarget] = useState<CtxTarget | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CtxTarget | null>(null);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [folderParentViewDir, setFolderParentViewDir] = useState('');
  const [folderParentWriteDir, setFolderParentWriteDir] = useState('');
  const [isDeletingFolder, setIsDeletingFolder] = useState(false);
  const [deleteFolderDir, setDeleteFolderDir] = useState('');
  const [deleteFolderError, setDeleteFolderError] = useState<string | null>(null);

  const renameInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const pendingSessionRestoreRef = useRef<ImageManagerSessionState | null>(readImageManagerSessionState());
  const hasRestoredSessionRef = useRef(false);

  // ── Capabilities ──
  const caps = getCapabilities();
  const isDesktop = caps.isElectron;

  // ═══════════════════════════════════════════════════════
  // Data loading
  // ═══════════════════════════════════════════════════════

  const loadAssets = useCallback(async () => {
    setLoading(true);
    try {
      const list = await imageBridge.listAssets();
      const sorted = [...list].sort((a, b) =>
        a.fileName.localeCompare(b.fileName, undefined, { numeric: true }),
      );
      setAssets(sorted);
    } catch (err) {
      setMessage(`加载失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setHasLoadedAssets(true);
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAssets(); }, [loadAssets]);

  // ═══════════════════════════════════════════════════════
  // Derived data
  // ═══════════════════════════════════════════════════════

  const dirTree = useMemo(() => buildTree(assets), [assets]);

  const assetPathSet = useMemo(() => new Set(assets.map((a) => a.relativePath)), [assets]);
  const availableDirSet = useMemo(() => {
    const dirs = new Set<string>(['']);
    for (const asset of assets) {
      const stripped = asset.relativePath.replace(/^assets\//, '');
      if (asset.kind === 'dir') {
        dirs.add(stripped);
        continue;
      }
      const parts = stripped.split('/');
      parts.pop();
      for (let i = 1; i <= parts.length; i++) {
        dirs.add(parts.slice(0, i).join('/'));
      }
    }
    return dirs;
  }, [assets]);

  const filteredAssets = useMemo(() => {
    let list = assets;
    if (browseDir) {
      const prefix = `assets/${browseDir}/`;
      list = list.filter((a) => a.relativePath.startsWith(prefix));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((a) => a.fileName.toLowerCase().includes(q));
    }
    return list;
  }, [assets, browseDir, searchQuery]);

  const previewAsset = useMemo(
    () => (previewAssetPath ? (assets.find((a) => a.relativePath === previewAssetPath) ?? null) : null),
    [assets, previewAssetPath],
  );

  useEffect(() => {
    if (!hasLoadedAssets) return;
    if (hasRestoredSessionRef.current) return;
    const cached = pendingSessionRestoreRef.current;
    hasRestoredSessionRef.current = true;
    if (!cached) return;

    const resolveBrowseDir = (dir: string): string => {
      let current = dir;
      while (current) {
        if (availableDirSet.has(current)) return current;
        const parts = current.split('/');
        parts.pop();
        current = parts.join('/');
      }
      return '';
    };

    const restoredBrowseDir = resolveBrowseDir(cached.browseDir);
    const restoredSelectedAssetPath = cached.selectedAssetPath && assetPathSet.has(cached.selectedAssetPath)
      ? cached.selectedAssetPath
      : null;
    const restoredPreviewAssetPath = cached.previewAssetPath && assetPathSet.has(cached.previewAssetPath)
      ? cached.previewAssetPath
      : null;
    const restoredExpandedDirs = new Set(
      cached.expandedDirs.filter((dir) => availableDirSet.has(dir)),
    );

    setBrowseDir(restoredBrowseDir);
    setSelectedAssetPath(restoredSelectedAssetPath);
    setPreviewAssetPath(restoredPreviewAssetPath);
    setExpandedDirs(restoredExpandedDirs);
  }, [assetPathSet, availableDirSet, hasLoadedAssets]);

  useEffect(() => {
    if (!hasLoadedAssets || !hasRestoredSessionRef.current) return;
    writeImageManagerSessionState({
      browseDir,
      selectedAssetPath,
      previewAssetPath,
      expandedDirs: Array.from(expandedDirs),
    });
  }, [browseDir, selectedAssetPath, previewAssetPath, expandedDirs, hasLoadedAssets]);

  // ═══════════════════════════════════════════════════════
  // Shared helpers
  // ═══════════════════════════════════════════════════════

  const flash = (msg: string) => { setMessage(msg); setTimeout(() => setMessage(null), 3000); };

  const expandPathChain = (dir: string) => {
    if (!dir) return;
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      const parts = dir.split('/');
      for (let i = 0; i < parts.length; i++) next.add(parts.slice(0, i + 1).join('/'));
      return next;
    });
  };

  async function runWriteOp<T extends { ok: boolean; error?: string }>(
    label: string, fn: () => Promise<T>, onOk?: (result: T) => void,
  ): Promise<T> {
    setLoading(true);
    try {
      const result = await fn();
      if (result.ok) {
        flash(`${label}成功`);
        await loadAssets();
        onOk?.(result);
      } else {
        flash(result.error || `${label}失败`);
      }
      return result;
    } catch (err) {
      flash(`${label}失败: ${err instanceof Error ? err.message : '未知错误'}`);
      throw err;
    } finally {
      setLoading(false);
    }
  }

  // ═══════════════════════════════════════════════════════
  // Operations — page only calls bridge, bridge handles IO
  // ═══════════════════════════════════════════════════════

  // ── Import (ribbon) ──

  const handleImport = async () => {
    if (!isDesktop) { flash('浏览器端不支持导入'); return; }
    const writeDir = normalizeDir(browseDir);
    await runWriteOp('导入', () => imageBridge.importToDir(toManagedRelative(writeDir)), () => {
      expandPathChain(writeDir);
    });
  };

  // ── Import to dir (context menu) ──

  const handleImportToDir = async (dir: string) => {
    if (!isDesktop) { flash('浏览器端不支持导入'); setCtxMenu(null); return; }
    setCtxMenu(null);
    const writeDir = dir;
    await runWriteOp('导入', () => imageBridge.importToDir(toManagedRelative(writeDir)), () => {
      expandPathChain(writeDir);
    });
  };

  // ── Rename file ──

  const startRename = (target?: CtxTarget) => {
    const t = target || (previewAsset ? { kind: 'file' as const, relativePath: previewAsset.relativePath, fileName: previewAsset.fileName, isManaged: previewAsset.writable } : null);
    if (!t || t.kind !== 'file') return;
    setCtxMenu(null);
    setRenameTarget(t);
    setRenameValue(t.relativePath.split('/').pop()!.replace(/\.[^.]+$/, ''));
    setIsRenaming(true);
    setTimeout(() => renameInputRef.current?.select(), 50);
  };

  const commitRename = async () => {
    const target = renameTarget;
    if (!target || target.kind !== 'file' || !caps.canRename || !renameValue.trim()) {
      setIsRenaming(false); setRenameTarget(null); return;
    }
    const oldRelativePath = target.relativePath;
    const ext = oldRelativePath.split('/').pop()!.match(/\.[^.]+$/)?.[0] || '';
    const newFullName = `${renameValue.trim()}${ext}`;

    await runWriteOp('重命名', () => imageBridge.renameFile(oldRelativePath, newFullName), () => {
      setIsRenaming(false); setRenameTarget(null);
      const newPath = `${oldRelativePath.replace(/\/[^/]+$/, '')}/${newFullName}`;
      if (selectedAssetPath === oldRelativePath) setSelectedAssetPath(newPath);
      if (previewAssetPath === oldRelativePath) setPreviewAssetPath(newPath);
    });
  };

  const cancelRename = () => { setIsRenaming(false); setRenameTarget(null); setRenameValue(''); };
  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitRename();
    if (e.key === 'Escape') cancelRename();
  };

  // ── Rename directory ──

  const startRenameDir = (target: CtxTarget) => {
    if (target.kind !== 'dir') return;
    setCtxMenu(null); setRenameTarget(target);
    const norm = normalizeDir(target.dir);
    setRenameValue(norm.split('/').pop() || norm);
    setIsRenaming(true);
    setTimeout(() => renameInputRef.current?.select(), 50);
  };

  const commitRenameDir = async () => {
    const target = renameTarget;
    if (!target || target.kind !== 'dir' || !caps.canRenameDir || !renameValue.trim()) {
      setIsRenaming(false); setRenameTarget(null); return;
    }
    const norm = normalizeDir(target.dir);
    const dirPath = toManagedRelative(norm);
    if (!dirPath) { flash('无法重命名根目录'); setIsRenaming(false); setRenameTarget(null); return; }

    const newName = renameValue.trim();
    const oldFrontend = norm;

    await runWriteOp('重命名目录', () => imageBridge.renameDirectory(dirPath, newName), (result) => {
      setIsRenaming(false); setRenameTarget(null);
      if (!result.newPath) return;
      const newFrontend = fromManagedRelative(result.newPath);
      setBrowseDir((prev) => replaceDirPrefix(prev, oldFrontend, newFrontend));
      setExpandedDirs((prev) => {
        const next = new Set<string>();
        for (const d of prev) {
          next.add(d === oldFrontend || d.startsWith(oldFrontend + '/') ? replaceDirPrefix(d, oldFrontend, newFrontend) : d);
        }
        return next;
      });
      if (selectedAssetPath && isPathUnderDir(selectedAssetPath, oldFrontend)) {
        setSelectedAssetPath(replaceAssetDirPrefix(selectedAssetPath, oldFrontend, newFrontend));
      }
      if (previewAssetPath && isPathUnderDir(previewAssetPath, oldFrontend)) {
        setPreviewAssetPath(replaceAssetDirPrefix(previewAssetPath, oldFrontend, newFrontend));
      }
    });
  };

  // ── Delete file ──

  const handleDeleteFile = (target: CtxTarget) => { if (target.kind !== 'file') return; setCtxMenu(null); setConfirmDelete(target); };

  const handleDeleteFileConfirm = async () => {
    const target = confirmDelete;
    if (!target || target.kind !== 'file' || !caps.canDeleteFile) { setConfirmDelete(null); return; }
    const delPath = target.relativePath;
    await runWriteOp('删除', () => imageBridge.deleteFile(delPath), () => {
      setConfirmDelete(null);
      if (selectedAssetPath === delPath) setSelectedAssetPath(null);
      if (previewAssetPath === delPath) setPreviewAssetPath(null);
    });
  };

  const handleDeleteFileCancel = () => setConfirmDelete(null);

  // ── Create folder ──

  const openCreateFolder = (dir: string) => {
    if (!isManagedDir(dir)) { flash('非管理目录不可新建文件夹'); return; }
    setFolderParentViewDir(browseDir);
    setFolderParentWriteDir(dir);
    setFolderName('');
    setIsCreatingFolder(true);
    setCtxMenu(null);
    setTimeout(() => folderInputRef.current?.focus(), 50);
  };

  const commitCreateFolder = async () => {
    if (!caps.canCreateDir || !folderName.trim()) { setIsCreatingFolder(false); return; }
    const writeDir = folderParentWriteDir;
    const viewDir = folderParentViewDir;
    const parentBackend = toManagedRelative(writeDir);
    if (parentBackend === undefined && writeDir !== MANAGED_ROOT) { setIsCreatingFolder(false); return; }

    await runWriteOp('创建文件夹', () => imageBridge.createDirectory(folderName.trim(), parentBackend), (result) => {
      setIsCreatingFolder(false); setFolderName('');
      const newDir = fromManagedRelative(result.createdPath || undefined);
      expandPathChain(writeDir);
      expandPathChain(newDir);
      setBrowseDir(viewDir);
    });
  };

  const cancelCreateFolder = () => { setIsCreatingFolder(false); setFolderName(''); };
  const handleCreateFolderKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitCreateFolder();
    if (e.key === 'Escape') cancelCreateFolder();
  };

  // ── Delete folder ──

  const openDeleteFolder = (dir: string) => {
    const norm = normalizeDir(dir);
    if (!isManagedDir(norm) || norm === MANAGED_ROOT) return;
    setDeleteFolderDir(norm); setDeleteFolderError(null);
    setIsDeletingFolder(true); setCtxMenu(null);
  };

  const commitDeleteFolder = async () => {
    if (!caps.canDeleteDir || !deleteFolderDir) return;
    const backendPath = toManagedRelative(deleteFolderDir);
    if (!backendPath) { setDeleteFolderError('无法删除根目录'); return; }
    setDeleteFolderError(null);
    const delDir = deleteFolderDir;

    setLoading(true);
    try {
      const result = await imageBridge.deleteDirectory(backendPath);
      if (result.ok) {
        flash('删除目录成功');
        await loadAssets();
        setIsDeletingFolder(false); setDeleteFolderDir('');
        if (browseDir === delDir || browseDir.startsWith(delDir + '/')) {
          const parts = delDir.split('/'); parts.pop();
          setBrowseDir(parts.join('/'));
        }
        setExpandedDirs((prev) => {
          const next = new Set(prev);
          for (const d of prev) { if (d === delDir || d.startsWith(delDir + '/')) next.delete(d); }
          return next;
        });
        if (selectedAssetPath && isPathUnderDir(selectedAssetPath, delDir)) setSelectedAssetPath(null);
        if (previewAssetPath && isPathUnderDir(previewAssetPath, delDir)) setPreviewAssetPath(null);
      } else {
        setDeleteFolderError(result.error || '删除失败');
      }
    } catch (err) {
      setDeleteFolderError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setLoading(false);
    }
  };

  const cancelDeleteFolder = () => { setIsDeletingFolder(false); setDeleteFolderDir(''); setDeleteFolderError(null); };

  // ── Reveal ──

  const handleReveal = async (target: CtxTarget) => {
    setCtxMenu(null);
    if (target.kind === 'dir') {
      const result = await imageBridge.revealDirectory(normalizeDir(target.dir));
      if (!result.ok) flash(result.error || '打开目录失败');
    } else {
      const result = await imageBridge.revealFile(target.relativePath);
      if (!result.ok) flash(result.error || '显示文件失败');
    }
  };

  // ── Copy path ──

  const handleCopyPath = (target: CtxTarget) => {
    setCtxMenu(null);
    const path = target.kind === 'file' ? target.relativePath : normalizeDir(target.dir);
    navigator.clipboard.writeText(path).then(() => flash('路径已复制'));
  };

  // ═══════════════════════════════════════════════════════
  // UI event handlers
  // ═══════════════════════════════════════════════════════

  const handleOpenWorkbench = () => navigateToAppPath(APP_ROUTE_PATHS.home);
  const handleOpenOperatorDraft = () => navigateToAppPath(APP_ROUTE_PATHS.draft);
  const handleOpenBuffDraft = () => navigateToAppPath(APP_ROUTE_PATHS.buffDraft);

  const previewIndex = previewAsset ? filteredAssets.findIndex((a) => a.relativePath === previewAsset.relativePath) : -1;

  const goNext = () => {
    if (filteredAssets.length === 0) return;
    const next = (previewIndex + 1) % filteredAssets.length;
    setPreviewAssetPath(filteredAssets[next].relativePath);
    setSelectedAssetPath(filteredAssets[next].relativePath);
  };

  const goPrev = () => {
    if (filteredAssets.length === 0) return;
    const prev = (previewIndex - 1 + filteredAssets.length) % filteredAssets.length;
    setPreviewAssetPath(filteredAssets[prev].relativePath);
    setSelectedAssetPath(filteredAssets[prev].relativePath);
  };

  const toggleViewMode = () => setViewMode((prev) => (prev === 'list' ? 'grid' : 'list'));

  const handleSelectDir = (dir: string) => { setBrowseDir(dir); setSelectedAssetPath(null); };

  const handleToggleExpanded = (dir: string) => {
    setExpandedDirs((prev) => { const next = new Set(prev); if (next.has(dir)) next.delete(dir); else next.add(dir); return next; });
  };

  const handleSelectAsset = (path: string) => { setSelectedAssetPath(path); setPreviewAssetPath(path); };

  const handleDirContextMenu = (e: React.MouseEvent, dir: string) => {
    e.preventDefault(); e.stopPropagation();
    const norm = normalizeDir(dir);
    const isRoot = norm === MANAGED_ROOT;
    setCtxMenu({
      x: e.clientX, y: e.clientY,
      target: { kind: 'dir', dir: norm, label: dir === '' ? '全部图片' : isRoot ? 'images（根目录）' : norm, isRoot, isManaged: isManagedDir(norm) },
    });
  };

  const handleFileContextMenu = (e: React.MouseEvent, asset: ImageAssetEntry) => {
    e.preventDefault(); e.stopPropagation();
    setCtxMenu({
      x: e.clientX, y: e.clientY,
      target: { kind: 'file', relativePath: asset.relativePath, fileName: asset.fileName, isManaged: asset.writable },
    });
  };

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    document.addEventListener('click', close, { once: true });
    document.addEventListener('contextmenu', close, { once: true });
    return () => { document.removeEventListener('click', close); document.removeEventListener('contextmenu', close); };
  }, [ctxMenu]);

  const commitRenameDispatcher = () => {
    if (renameTarget?.kind === 'dir') commitRenameDir(); else commitRename();
  };

  // ═══════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════

  return (
    <main className="damage-sheet-page buff-sheet-page">
      <header className="damage-sheet-topbar">
        <div className="damage-sheet-topbar-left">
          <button className="damage-sheet-back-button" type="button" onClick={handleOpenWorkbench}>返回主界面</button>
          <div className="damage-sheet-title-block"><h1>图片资源管理</h1></div>
        </div>
        <div className="damage-sheet-topbar-right">
          <button className="damage-sheet-action-button" type="button" onClick={handleOpenOperatorDraft}>编辑干员</button>
          <button className="damage-sheet-action-button" type="button" onClick={handleOpenBuffDraft}>编辑BUFF</button>
        </div>
      </header>

      <ImageManagerRibbon
        isDesktop={isDesktop} canImport={caps.canImport} canRename={caps.canRename}
        canDeleteFile={caps.canDeleteFile} loading={loading} searchQuery={searchQuery}
        viewMode={viewMode} selectedAsset={previewAsset}
        onSearchChange={setSearchQuery} onImport={handleImport}
        onRename={() => startRename()}
        onDelete={() => { if (previewAsset) setConfirmDelete({ kind: 'file', relativePath: previewAsset.relativePath, fileName: previewAsset.fileName, isManaged: previewAsset.writable }); }}
        onRefresh={loadAssets} onToggleViewMode={toggleViewMode}
      />

      {message && <div className="image-manager-toast">{message}</div>}

      <div className="damage-sheet-workspace image-manager-workspace">
        <ImageManagerExplorer
          dirTree={dirTree} currentDir={browseDir} expandedDirs={expandedDirs}
          totalCount={assets.length} backendLabel={caps.backendLabel}
          onSelectDir={handleSelectDir} onToggleExpanded={handleToggleExpanded}
          onContextMenu={handleDirContextMenu} footer={<ImageManagerHostStatus />}
        />
        <ImageManagerAssetList
          assets={filteredAssets} selectedPath={selectedAssetPath} searchQuery={searchQuery}
          loading={loading} viewMode={viewMode} assetUrl={assetUrl}
          onSelectAsset={handleSelectAsset} onContextMenu={handleFileContextMenu}
        />
        <ImageManagerPreviewPanel
          selectedAsset={previewAsset} selectedIndex={previewIndex}
          filteredCount={filteredAssets.length} canRename={caps.canRename}
          assetUrl={assetUrl} formatBytes={formatBytes}
          onGoPrev={goPrev} onGoNext={goNext} onStartRename={() => startRename()}
        />
      </div>

      {/* Context menu */}
      {ctxMenu && (() => {
        if (ctxMenu.target.kind === 'dir') {
          const t = ctxMenu.target; const actions = computeDirActions(t.dir);
          return (
            <div className="image-manager-ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }} onClick={(e) => e.stopPropagation()}>
              <div className="image-manager-ctx-menu-header">{t.label}</div>
              <button type="button" disabled={!actions.canCreateDir} title={!actions.canCreateDir ? (actions.reason || '不可用') : `在 ${t.label} 下新建文件夹`} onClick={() => openCreateFolder(t.dir)}>新建文件夹</button>
              <button type="button" disabled={!actions.canImport} title={!actions.canImport ? (actions.reason || '不可用') : `导入图片到 ${t.label}`} onClick={() => handleImportToDir(t.dir)}>导入图片到此处</button>
              <button type="button" disabled={!actions.canRenameDir} title={!actions.canRenameDir ? (actions.reason || '根目录不可重命名') : `重命名 ${t.label}`} onClick={() => startRenameDir(ctxMenu.target)}>重命名文件夹</button>
              <button type="button" disabled={!actions.canDeleteDir} title={!actions.canDeleteDir ? '根目录或非管理目录不可删除' : `删除 ${t.label}`} onClick={() => openDeleteFolder(t.dir)}>删除文件夹</button>
              <button type="button" disabled={!actions.canReveal} title={!actions.canReveal ? (actions.reason || '不可用') : '在系统资源管理器中打开'} onClick={() => handleReveal(ctxMenu.target)}>在资源管理器中打开</button>
            </div>
          );
        }
        const t = ctxMenu.target; const asset = assets.find(a => a.relativePath === t.relativePath);
        const actions = asset ? computeFileActions(asset) : { canRename: false, canDelete: false, canReveal: false, canCopyPath: true, reason: '文件未找到' };
        return (
          <div className="image-manager-ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }} onClick={(e) => e.stopPropagation()}>
            <div className="image-manager-ctx-menu-header">{t.fileName}</div>
            <button type="button" disabled={!actions.canRename} title={!actions.canRename ? (actions.reason || '不可用') : `重命名 ${t.fileName}`} onClick={() => startRename(ctxMenu.target)}>重命名</button>
            <button type="button" disabled={!actions.canDelete} title={!actions.canDelete ? (actions.reason || '不可用') : `删除 ${t.fileName}`} onClick={() => handleDeleteFile(ctxMenu.target)}>删除</button>
            <button type="button" disabled={!actions.canReveal} title={!actions.canReveal ? (actions.reason || '不可用') : '在系统资源管理器中显示'} onClick={() => handleReveal(ctxMenu.target)}>在资源管理器中显示</button>
            <button type="button" disabled={!actions.canCopyPath} title="复制相对路径到剪贴板" onClick={() => handleCopyPath(ctxMenu.target)}>复制相对路径</button>
          </div>
        );
      })()}

      <ImageManagerRenameModal
        isOpen={isRenaming}
        currentName={renameTarget?.kind === 'dir' ? normalizeDir(renameTarget.dir) : renameTarget?.kind === 'file' ? renameTarget.fileName : ''}
        renameValue={renameValue} renameInputRef={renameInputRef}
        onRenameValueChange={setRenameValue} onCommit={commitRenameDispatcher}
        onCancel={cancelRename} onKeyDown={handleRenameKeyDown}
        title={renameTarget?.kind === 'dir' ? '重命名文件夹' : '重命名文件'}
        hint={renameTarget?.kind === 'dir' ? '输入新的文件夹名' : '输入基础名，不改变扩展名'}
      />

      <ImageManagerCreateFolderModal
        isOpen={isCreatingFolder}
        parentLabel={folderParentWriteDir ? `"${folderParentWriteDir}"` : '根目录'}
        folderName={folderName} inputRef={folderInputRef}
        onFolderNameChange={setFolderName} onCommit={commitCreateFolder}
        onCancel={cancelCreateFolder} onKeyDown={handleCreateFolderKeyDown}
      />

      <ImageManagerDeleteFolderModal
        isOpen={isDeletingFolder} dirLabel={deleteFolderDir} error={deleteFolderError}
        onConfirm={commitDeleteFolder} onCancel={cancelDeleteFolder}
      />

      {confirmDelete && confirmDelete.kind === 'file' && (
        <div className="operator-draft-modal-overlay" onClick={handleDeleteFileCancel}>
          <div className="operator-draft-modal operator-draft-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="operator-draft-section-header"><div><h3>确认删除</h3><p>此操作不可撤销。</p></div></div>
            <div className="operator-draft-confirm-body"><p>确定要删除 <strong>{confirmDelete.fileName}</strong> 吗？</p></div>
            <div className="operator-draft-modal-actions">
              <button className="operator-draft-ghost-button" type="button" onClick={handleDeleteFileCancel}>取消</button>
              <button className="operator-draft-copy-button operator-draft-danger-button" type="button" onClick={handleDeleteFileConfirm}>确认删除</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default ImageManagerPage;
