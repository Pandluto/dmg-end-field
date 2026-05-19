import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../utils/appRoute';
import { resolvePublicPath } from '../utils/assetResolver';
import { assetHostApi, isManagedDir, toManagedRelative, fromManagedRelative, managedDirLabel, getHostStatus } from '../utils/assetHostApi';
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

// ── Normalize empty dir to managed root ──

const MANAGED_ROOT = 'images';

function normalizeDir(dir: string): string {
  return dir === '' ? MANAGED_ROOT : dir;
}

// ── Local helpers ──

function assetUrl(relativePath: string): string {
  const isFileProtocol = window.location.protocol === 'file:';
  const path = isFileProtocol
    ? relativePath
    : relativePath.split('/').map(encodeURIComponent).join('/');
  return resolvePublicPath(path);
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '--';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(2)} MB`;
}

/** Build a recursive tree from flat asset entries (files + empty dirs). */
function buildTree(assets: ImageAssetEntry[]): TreeNode[] {
  const files = assets.filter((a) => a.kind !== 'dir');
  const emptyDirs = assets.filter((a) => a.kind === 'dir');

  // Count files per directory
  const dirCounts = new Map<string, number>();
  for (const a of files) {
    const parts = a.relativePath.replace(/^assets\//, '').split('/');
    parts.pop();
    for (let i = 1; i <= parts.length; i++) {
      const dirPath = parts.slice(0, i).join('/');
      dirCounts.set(dirPath, (dirCounts.get(dirPath) || 0) + 1);
    }
  }

  // Ensure empty managed dirs have count 0
  for (const d of emptyDirs) {
    const dirPath = d.relativePath.replace(/^assets\//, '');
    if (!dirCounts.has(dirPath)) {
      dirCounts.set(dirPath, 0);
    }
  }

  const treeMap = new Map<string, TreeNode>();

  // Create nodes from file parent directories
  for (const a of files) {
    const parts = a.relativePath.replace(/^assets\//, '').split('/');
    for (let i = 0; i < parts.length - 1; i++) {
      const dirPath = parts.slice(0, i + 1).join('/');
      if (!treeMap.has(dirPath)) {
        treeMap.set(dirPath, {
          name: parts[i],
          path: dirPath,
          isManaged: isManagedDir(dirPath),
          count: dirCounts.get(dirPath) || 0,
          children: [],
        });
      }
    }
  }

  // Create nodes from empty directory entries
  for (const d of emptyDirs) {
    const dirPath = d.relativePath.replace(/^assets\//, '');
    if (!treeMap.has(dirPath)) {
      treeMap.set(dirPath, {
        name: d.fileName,
        path: dirPath,
        isManaged: true,
        count: 0,
        children: [],
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

/** Compute action capabilities for a directory (dir is already normalized). */
function computeDirActions(dir: string): DirActions {
  const api = assetHostApi;
  const status = getHostStatus();
  const isRoot = dir === MANAGED_ROOT;

  if (!isManagedDir(dir)) {
    return {
      canCreateDir: false, canImport: false, canRenameDir: false,
      canDeleteDir: false, canReveal: false,
      reason: '非管理目录，只读',
    };
  }

  const missing: string[] = [];
  if (!status.methods.createDir) missing.push('createImageDirectory');
  if (!status.methods.importToDir) missing.push('importImageAssetsToDir');
  if (!status.methods.renameDir) missing.push('renameImageDirectory');
  if (!status.methods.deleteDir) missing.push('deleteImageDirectory');
  if (!status.methods.reveal) missing.push('revealInExplorer');

  return {
    canCreateDir: api.canCreateDir,
    canImport: api.canImport,
    canRenameDir: api.canRenameDir && !isRoot,
    canDeleteDir: api.canDeleteDir && !isRoot,
    canReveal: api.canReveal,
    reason: missing.length > 0 ? `缺少: ${missing.join(', ')}` : undefined,
  };
}

/** Compute action capabilities for a file. */
function computeFileActions(asset: ImageAssetEntry): FileActions {
  const api = assetHostApi;
  if (!asset.writable) {
    return { canRename: false, canDelete: false, canReveal: false, canCopyPath: true, reason: '非管理目录，只读' };
  }
  const missing: string[] = [];
  if (!api.canRename) missing.push('renameImageAsset');
  if (!api.canDeleteFile) missing.push('deleteImageAsset');
  if (!api.canReveal) missing.push('revealInExplorer');
  return {
    canRename: api.canRename,
    canDelete: api.canDeleteFile,
    canReveal: api.canReveal,
    canCopyPath: true,
    reason: missing.length > 0 ? `缺少: ${missing.join(', ')}` : undefined,
  };
}

// ── Route guard ──

export function isImageManagerPath(path: string): boolean {
  return path === APP_ROUTE_PATHS.imageManager;
}

// ── Component ──

export function ImageManagerPage() {
  // ── Data state ──
  const [assets, setAssets] = useState<ImageAssetEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentDir, setCurrentDir] = useState('');
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

  // ── Modal / menu state ──
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; target: CtxTarget } | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameTarget, setRenameTarget] = useState<CtxTarget | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CtxTarget | null>(null);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [folderParentDir, setFolderParentDir] = useState('');
  const [isDeletingFolder, setIsDeletingFolder] = useState(false);
  const [deleteFolderDir, setDeleteFolderDir] = useState('');
  const [deleteFolderError, setDeleteFolderError] = useState<string | null>(null);

  const renameInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const initialDirSet = useRef(false);

  // ── Host status ──
  const host = getHostStatus();
  const isDesktop = host.isElectronLike;

  // ── Load assets ──

  const loadAssets = useCallback(async () => {
    setLoading(true);
    try {
      const list = await assetHostApi.listAssets();
      const sorted = [...list].sort((a, b) =>
        a.fileName.localeCompare(b.fileName, undefined, { numeric: true }),
      );
      setAssets(sorted);
    } catch (err) {
      setMessage(`加载失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  // ── Derived data ──

  const dirTree = useMemo(() => buildTree(assets), [assets]);

  useEffect(() => {
    if (!initialDirSet.current && dirTree.length > 0) {
      initialDirSet.current = true;
      setCurrentDir(dirTree[0].path);
      setExpandedDirs(new Set([dirTree[0].path]));
    }
  }, [dirTree]);

  const filteredAssets = useMemo(() => {
    let list = assets;
    if (currentDir) {
      const prefix = `assets/${currentDir}/`;
      list = list.filter((a) => a.relativePath.startsWith(prefix));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((a) => a.fileName.toLowerCase().includes(q));
    }
    return list;
  }, [assets, currentDir, searchQuery]);

  const selectedAsset = useMemo(
    () => filteredAssets.find((a) => a.relativePath === selectedPath) ?? null,
    [filteredAssets, selectedPath],
  );

  useEffect(() => {
    if (selectedPath && !filteredAssets.some((a) => a.relativePath === selectedPath)) {
      setSelectedPath(null);
    }
  }, [filteredAssets, selectedPath]);

  // ── Flash message ──

  const flash = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(null), 3000);
  };

  // ── Helper: expand a directory path chain ──

  const expandPathChain = (dir: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      const parts = dir.split('/');
      for (let i = 0; i < parts.length; i++) {
        next.add(parts.slice(0, i + 1).join('/'));
      }
      return next;
    });
  };

  // ── Unified write-op helper (IO only, no state restore) ──

  async function runWriteOp<T extends { ok: boolean; error?: string }>(
    label: string,
    fn: () => Promise<T>,
    onOk?: (result: T) => void,
  ): Promise<T> {
    setLoading(true);
    try {
      const result = await fn();
      if (result.ok) {
        flash(`${label}成功`);
        await loadAssets();
        // onOk runs AFTER loadAssets completes — callers set state here
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

  // ── Import ──

  const handleImport = async () => {
    if (!isDesktop) { flash('浏览器端不支持导入'); return; }
    const dir = normalizeDir(currentDir);
    const targetRel = toManagedRelative(dir);
    await runWriteOp('导入', () => assetHostApi.importToDir(targetRel), () => {
      expandPathChain(dir);
    });
  };

  const handleImportToDir = async (dir: string) => {
    if (!isDesktop) { flash('浏览器端不支持导入'); setCtxMenu(null); return; }
    setCtxMenu(null);
    const norm = normalizeDir(dir);
    const targetRel = toManagedRelative(norm);
    await runWriteOp('导入', () => assetHostApi.importToDir(targetRel), () => {
      setCurrentDir(norm);
      expandPathChain(norm);
    });
  };

  // ── Rename (file) ──

  const startRename = (target?: CtxTarget) => {
    const t = target || (selectedAsset ? { kind: 'file' as const, relativePath: selectedAsset.relativePath, fileName: selectedAsset.fileName, isManaged: selectedAsset.writable } : null);
    if (!t || t.kind !== 'file') return;
    setCtxMenu(null);
    setRenameTarget(t);
    setRenameValue(t.relativePath.split('/').pop()!.replace(/\.[^.]+$/, ''));
    setIsRenaming(true);
    setTimeout(() => renameInputRef.current?.select(), 50);
  };

  const commitRename = async () => {
    const target = renameTarget;
    if (!target || target.kind !== 'file' || !assetHostApi.canRename || !renameValue.trim()) {
      setIsRenaming(false);
      setRenameTarget(null);
      return;
    }

    const oldRelativePath = target.relativePath;
    const ext = oldRelativePath.split('/').pop()!.match(/\.[^.]+$/)?.[0] || '';
    const newFullName = `${renameValue.trim()}${ext}`;
    const dir = oldRelativePath.replace(/\/[^/]+$/, '');
    const newPath = `${dir}/${newFullName}`;

    await runWriteOp('重命名', () =>
      assetHostApi.renameFile(oldRelativePath, newFullName),
      () => {
        setIsRenaming(false);
        setRenameTarget(null);
        setSelectedPath(newPath);
        // Keep current dir — extract frontend path from asset prefix
        const dirFrontend = dir.replace(/^assets\//, '');
        setCurrentDir(dirFrontend);
        expandPathChain(dirFrontend);
      },
    );
  };

  const cancelRename = () => {
    setIsRenaming(false);
    setRenameTarget(null);
    setRenameValue('');
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitRename();
    if (e.key === 'Escape') cancelRename();
  };

  // ── Rename directory ──

  const startRenameDir = (target: CtxTarget) => {
    if (target.kind !== 'dir') return;
    setCtxMenu(null);
    setRenameTarget(target);
    const norm = normalizeDir(target.dir);
    setRenameValue(norm.split('/').pop() || norm);
    setIsRenaming(true);
    setTimeout(() => renameInputRef.current?.select(), 50);
  };

  const commitRenameDir = async () => {
    const target = renameTarget;
    if (!target || target.kind !== 'dir' || !assetHostApi.canRenameDir || !renameValue.trim()) {
      setIsRenaming(false);
      setRenameTarget(null);
      return;
    }

    const norm = normalizeDir(target.dir);
    const dirPath = toManagedRelative(norm);
    if (!dirPath) {
      flash('无法重命名根目录');
      setIsRenaming(false);
      setRenameTarget(null);
      return;
    }

    const newName = renameValue.trim();
    const oldFrontend = norm;

    await runWriteOp('重命名目录', () =>
      assetHostApi.renameDirectory(dirPath, newName),
      (result) => {
        setIsRenaming(false);
        setRenameTarget(null);
        if (result.newPath) {
          const newFrontend = fromManagedRelative(result.newPath);
          setCurrentDir(newFrontend);
          setExpandedDirs((prev) => {
            const next = new Set(prev);
            next.delete(oldFrontend);
            next.add(newFrontend);
            return next;
          });
        }
      },
    );
  };

  // ── Delete file ──

  const handleDeleteFile = (target: CtxTarget) => {
    if (target.kind !== 'file') return;
    setCtxMenu(null);
    setConfirmDelete(target);
  };

  const handleDeleteFileConfirm = async () => {
    const target = confirmDelete;
    if (!target || target.kind !== 'file' || !assetHostApi.canDeleteFile) {
      setConfirmDelete(null);
      return;
    }
    const delPath = target.relativePath;
    await runWriteOp('删除', () => assetHostApi.deleteFile(delPath), () => {
      setConfirmDelete(null);
      if (selectedPath === delPath) setSelectedPath(null);
    });
  };

  const handleDeleteFileCancel = () => setConfirmDelete(null);

  // ── Create folder ──

  const openCreateFolder = (dir: string) => {
    const parent = normalizeDir(dir);
    if (!isManagedDir(parent)) {
      flash('非管理目录不可新建文件夹');
      return;
    }
    setFolderParentDir(parent);
    setFolderName('');
    setIsCreatingFolder(true);
    setCtxMenu(null);
    setTimeout(() => folderInputRef.current?.focus(), 50);
  };

  const commitCreateFolder = async () => {
    if (!assetHostApi.canCreateDir || !folderName.trim()) {
      setIsCreatingFolder(false);
      return;
    }
    const parentBackend = toManagedRelative(folderParentDir);
    if (parentBackend === undefined && folderParentDir !== MANAGED_ROOT) {
      setIsCreatingFolder(false);
      return;
    }

    const parent = folderParentDir;

    await runWriteOp('创建文件夹', () =>
      assetHostApi.createDirectory(folderName.trim(), parentBackend),
      (result) => {
        setIsCreatingFolder(false);
        setFolderName('');
        const createdBackendPath = result.createdPath || '';
        const newDir = fromManagedRelative(createdBackendPath || undefined);
        expandPathChain(parent);
        expandPathChain(newDir);
        // Stay in parent dir so the user can see existing files; the new
        // empty folder now appears in the tree via directory entries.
        setCurrentDir(parent);
        setSelectedPath(null);
      },
    );
  };

  const cancelCreateFolder = () => {
    setIsCreatingFolder(false);
    setFolderName('');
  };

  const handleCreateFolderKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitCreateFolder();
    if (e.key === 'Escape') cancelCreateFolder();
  };

  // ── Delete folder ──

  const openDeleteFolder = (dir: string) => {
    const norm = normalizeDir(dir);
    if (!isManagedDir(norm) || norm === MANAGED_ROOT) return;
    setDeleteFolderDir(norm);
    setDeleteFolderError(null);
    setIsDeletingFolder(true);
    setCtxMenu(null);
  };

  const commitDeleteFolder = async () => {
    if (!assetHostApi.canDeleteDir || !deleteFolderDir) return;
    const backendPath = toManagedRelative(deleteFolderDir);
    if (!backendPath) {
      setDeleteFolderError('无法删除根目录');
      return;
    }

    setDeleteFolderError(null);
    const delDir = deleteFolderDir;

    setLoading(true);
    try {
      const result = await assetHostApi.deleteDirectory(backendPath);
      if (result.ok) {
        flash('删除目录成功');
        await loadAssets();
        setIsDeletingFolder(false);
        setDeleteFolderDir('');
        // State recovery AFTER loadAssets
        if (currentDir === delDir || currentDir.startsWith(delDir + '/')) {
          const parts = delDir.split('/');
          parts.pop();
          setCurrentDir(parts.join('/'));
        }
        setExpandedDirs((prev) => {
          const next = new Set(prev);
          next.delete(delDir);
          return next;
        });
        setSelectedPath(null);
      } else {
        setDeleteFolderError(result.error || '删除失败');
      }
    } catch (err) {
      setDeleteFolderError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setLoading(false);
    }
  };

  const cancelDeleteFolder = () => {
    setIsDeletingFolder(false);
    setDeleteFolderDir('');
    setDeleteFolderError(null);
  };

  // ── Reveal in Explorer ──

  const handleReveal = async (target: CtxTarget) => {
    setCtxMenu(null);
    if (target.kind === 'dir') {
      const dir = normalizeDir(target.dir);
      const result = await assetHostApi.revealDirectory(dir);
      if (!result.ok) flash(result.error || '打开目录失败');
    } else {
      const result = await assetHostApi.revealFile(target.relativePath);
      if (!result.ok) flash(result.error || '显示文件失败');
    }
  };

  // ── Copy path ──

  const handleCopyPath = (target: CtxTarget) => {
    setCtxMenu(null);
    const path = target.kind === 'file' ? target.relativePath : normalizeDir(target.dir);
    navigator.clipboard.writeText(path).then(() => flash('路径已复制'));
  };

  // ── Navigation ──

  const handleOpenWorkbench = () => navigateToAppPath(APP_ROUTE_PATHS.home);
  const handleOpenOperatorDraft = () => navigateToAppPath(APP_ROUTE_PATHS.draft);
  const handleOpenBuffDraft = () => navigateToAppPath(APP_ROUTE_PATHS.buffDraft);

  // ── Preview nav ──

  const selectedIndex = selectedAsset
    ? filteredAssets.findIndex((a) => a.relativePath === selectedAsset.relativePath)
    : -1;

  const goNext = () => {
    if (filteredAssets.length === 0) return;
    const next = (selectedIndex + 1) % filteredAssets.length;
    setSelectedPath(filteredAssets[next].relativePath);
  };

  const goPrev = () => {
    if (filteredAssets.length === 0) return;
    const prev = (selectedIndex - 1 + filteredAssets.length) % filteredAssets.length;
    setSelectedPath(filteredAssets[prev].relativePath);
  };

  // ── View mode ──

  const toggleViewMode = () => setViewMode((prev) => (prev === 'list' ? 'grid' : 'list'));

  // ── Explorer callbacks ──

  const handleSelectDir = (dir: string) => {
    setCurrentDir(dir);
    setSelectedPath(null);
  };

  const handleToggleExpanded = (dir: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });
  };

  // ── Context menu ──

  const handleDirContextMenu = (e: React.MouseEvent, dir: string) => {
    e.preventDefault();
    e.stopPropagation();
    const norm = normalizeDir(dir);
    const isRoot = norm === MANAGED_ROOT;
    const managed = isManagedDir(norm);
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      target: {
        kind: 'dir',
        dir: norm,
        label: dir === '' ? '全部图片' : isRoot ? 'images（根目录）' : norm,
        isRoot,
        isManaged: managed,
      },
    });
  };

  const handleFileContextMenu = (e: React.MouseEvent, asset: ImageAssetEntry) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      target: {
        kind: 'file',
        relativePath: asset.relativePath,
        fileName: asset.fileName,
        isManaged: asset.writable,
      },
    });
  };

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    document.addEventListener('click', close, { once: true });
    document.addEventListener('contextmenu', close, { once: true });
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('contextmenu', close);
    };
  }, [ctxMenu]);

  // ── Commit rename dispatcher ──
  const commitRenameDispatcher = () => {
    if (renameTarget?.kind === 'dir') commitRenameDir();
    else commitRename();
  };

  // ── Render ──

  const api = assetHostApi;

  return (
    <main className="damage-sheet-page buff-sheet-page">
      {/* ── Topbar ── */}
      <header className="damage-sheet-topbar">
        <div className="damage-sheet-topbar-left">
          <button className="damage-sheet-back-button" type="button" onClick={handleOpenWorkbench}>
            返回主界面
          </button>
          <div className="damage-sheet-title-block">
            <h1>图片资源管理</h1>
          </div>
        </div>
        <div className="damage-sheet-topbar-right">
          <button className="damage-sheet-action-button" type="button" onClick={handleOpenOperatorDraft}>
            编辑干员
          </button>
          <button className="damage-sheet-action-button" type="button" onClick={handleOpenBuffDraft}>
            编辑BUFF
          </button>
        </div>
      </header>

      {/* ── Ribbon ── */}
      <ImageManagerRibbon
        isDesktop={isDesktop}
        canImport={api.canImport}
        canRename={api.canRename}
        canDeleteFile={api.canDeleteFile}
        loading={loading}
        searchQuery={searchQuery}
        viewMode={viewMode}
        selectedAsset={selectedAsset}
        onSearchChange={setSearchQuery}
        onImport={handleImport}
        onRename={() => startRename()}
        onDelete={() => {
          if (selectedAsset) {
            setConfirmDelete({
              kind: 'file',
              relativePath: selectedAsset.relativePath,
              fileName: selectedAsset.fileName,
              isManaged: selectedAsset.writable,
            });
          }
        }}
        onRefresh={loadAssets}
        onToggleViewMode={toggleViewMode}
      />

      {/* ── Toast ── */}
      {message && <div className="image-manager-toast">{message}</div>}

      {/* ── Workspace ── */}
      <div className="damage-sheet-workspace image-manager-workspace">
        <ImageManagerExplorer
          dirTree={dirTree}
          currentDir={currentDir}
          expandedDirs={expandedDirs}
          totalCount={assets.length}
          backendLabel={api.backendLabel}
          onSelectDir={handleSelectDir}
          onToggleExpanded={handleToggleExpanded}
          onContextMenu={handleDirContextMenu}
          footer={<ImageManagerHostStatus />}
        />

        <ImageManagerAssetList
          assets={filteredAssets}
          selectedPath={selectedPath}
          searchQuery={searchQuery}
          loading={loading}
          viewMode={viewMode}
          assetUrl={assetUrl}
          onSelectAsset={setSelectedPath}
          onContextMenu={handleFileContextMenu}
        />

        <ImageManagerPreviewPanel
          selectedAsset={selectedAsset}
          selectedIndex={selectedIndex}
          filteredCount={filteredAssets.length}
          canRename={api.canRename}
          assetUrl={assetUrl}
          formatBytes={formatBytes}
          onGoPrev={goPrev}
          onGoNext={goNext}
          onStartRename={() => startRename()}
        />
      </div>

      {/* ── Context menu ── */}
      {ctxMenu && (() => {
        if (ctxMenu.target.kind === 'dir') {
          const t = ctxMenu.target;
          const actions = computeDirActions(t.dir);
          return (
            <div
              className="image-manager-ctx-menu"
              style={{ left: ctxMenu.x, top: ctxMenu.y }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="image-manager-ctx-menu-header">{t.label}</div>

              <button type="button" disabled={!actions.canCreateDir}
                title={!actions.canCreateDir ? (actions.reason || '不可用') : `在 ${t.label} 下新建文件夹`}
                onClick={() => openCreateFolder(t.dir)}>
                新建文件夹
              </button>

              <button type="button" disabled={!actions.canImport}
                title={!actions.canImport ? (actions.reason || '不可用') : `导入图片到 ${t.label}`}
                onClick={() => handleImportToDir(t.dir)}>
                导入图片到此处
              </button>

              <button type="button" disabled={!actions.canRenameDir}
                title={!actions.canRenameDir ? (actions.reason || '根目录不可重命名') : `重命名 ${t.label}`}
                onClick={() => startRenameDir(ctxMenu.target)}>
                重命名文件夹
              </button>

              <button type="button" disabled={!actions.canDeleteDir}
                title={!actions.canDeleteDir ? '根目录或非管理目录不可删除' : `删除 ${t.label}`}
                onClick={() => openDeleteFolder(t.dir)}>
                删除文件夹
              </button>

              <button type="button" disabled={!actions.canReveal}
                title={!actions.canReveal ? (actions.reason || '不可用') : '在系统资源管理器中打开'}
                onClick={() => handleReveal(ctxMenu.target)}>
                在资源管理器中打开
              </button>
            </div>
          );
        }

        // File context menu
        const t = ctxMenu.target;
        const asset = assets.find(a => a.relativePath === t.relativePath);
        const actions = asset ? computeFileActions(asset) : { canRename: false, canDelete: false, canReveal: false, canCopyPath: true, reason: '文件未找到' };

        return (
          <div
            className="image-manager-ctx-menu"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="image-manager-ctx-menu-header">{t.fileName}</div>

            <button type="button" disabled={!actions.canRename}
              title={!actions.canRename ? (actions.reason || '不可用') : `重命名 ${t.fileName}`}
              onClick={() => startRename(ctxMenu.target)}>
              重命名
            </button>

            <button type="button" disabled={!actions.canDelete}
              title={!actions.canDelete ? (actions.reason || '不可用') : `删除 ${t.fileName}`}
              onClick={() => handleDeleteFile(ctxMenu.target)}>
              删除
            </button>

            <button type="button" disabled={!actions.canReveal}
              title={!actions.canReveal ? (actions.reason || '不可用') : '在系统资源管理器中显示'}
              onClick={() => handleReveal(ctxMenu.target)}>
              在资源管理器中显示
            </button>

            <button type="button" disabled={!actions.canCopyPath}
              title="复制相对路径到剪贴板"
              onClick={() => handleCopyPath(ctxMenu.target)}>
              复制相对路径
            </button>
          </div>
        );
      })()}

      {/* ── Rename modal ── */}
      <ImageManagerRenameModal
        isOpen={isRenaming}
        currentName={renameTarget?.kind === 'dir' ? normalizeDir(renameTarget.dir) : renameTarget?.kind === 'file' ? renameTarget.fileName : ''}
        renameValue={renameValue}
        renameInputRef={renameInputRef}
        onRenameValueChange={setRenameValue}
        onCommit={commitRenameDispatcher}
        onCancel={cancelRename}
        onKeyDown={handleRenameKeyDown}
        title={renameTarget?.kind === 'dir' ? '重命名文件夹' : '重命名文件'}
        hint={renameTarget?.kind === 'dir' ? '输入新的文件夹名' : '输入基础名，不改变扩展名'}
      />

      {/* ── Create folder modal ── */}
      <ImageManagerCreateFolderModal
        isOpen={isCreatingFolder}
        parentLabel={folderParentDir ? `"${folderParentDir}"` : '根目录'}
        folderName={folderName}
        inputRef={folderInputRef}
        onFolderNameChange={setFolderName}
        onCommit={commitCreateFolder}
        onCancel={cancelCreateFolder}
        onKeyDown={handleCreateFolderKeyDown}
      />

      {/* ── Delete folder modal ── */}
      <ImageManagerDeleteFolderModal
        isOpen={isDeletingFolder}
        dirLabel={deleteFolderDir}
        error={deleteFolderError}
        onConfirm={commitDeleteFolder}
        onCancel={cancelDeleteFolder}
      />

      {/* ── Delete file confirmation modal ── */}
      {confirmDelete && confirmDelete.kind === 'file' && (
        <div className="operator-draft-modal-overlay" onClick={handleDeleteFileCancel}>
          <div className="operator-draft-modal operator-draft-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="operator-draft-section-header">
              <div>
                <h3>确认删除</h3>
                <p>此操作不可撤销。</p>
              </div>
            </div>
            <div className="operator-draft-confirm-body">
              <p>确定要删除 <strong>{confirmDelete.fileName}</strong> 吗？</p>
            </div>
            <div className="operator-draft-modal-actions">
              <button className="operator-draft-ghost-button" type="button" onClick={handleDeleteFileCancel}>
                取消
              </button>
              <button className="operator-draft-copy-button operator-draft-danger-button" type="button" onClick={handleDeleteFileConfirm}>
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default ImageManagerPage;
