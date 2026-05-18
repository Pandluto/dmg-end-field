import { useEffect, useMemo, useRef, useState } from 'react';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../utils/appRoute';
import { resolvePublicPath } from '../utils/assetResolver';
import { assetHostApi, isManagedDir, toManagedRelative, fromManagedRelative, managedDirLabel } from '../utils/assetHostApi';
import './ImageManagerPage.css';
import { ImageManagerRibbon } from './ImageManager/ImageManagerRibbon';
import { ImageManagerExplorer } from './ImageManager/ImageManagerExplorer';
import { ImageManagerAssetList } from './ImageManager/ImageManagerAssetList';
import { ImageManagerPreviewPanel } from './ImageManager/ImageManagerPreviewPanel';
import { ImageManagerRenameModal } from './ImageManager/ImageManagerRenameModal';
import { ImageManagerCreateFolderModal } from './ImageManager/ImageManagerCreateFolderModal';
import { ImageManagerDeleteFolderModal } from './ImageManager/ImageManagerDeleteFolderModal';
import type { ImageAssetEntry, DirGroup } from './ImageManager/types';

export { managedDirLabel };

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

function buildDirTree(assets: ImageAssetEntry[]): DirGroup[] {
  const map = new Map<string, Map<string, number>>();
  for (const a of assets) {
    const parts = a.relativePath.replace(/^assets\//, '').split('/');
    const topDir = parts[0];
    if (!topDir) continue;
    if (!map.has(topDir)) map.set(topDir, new Map());
    const subMap = map.get(topDir)!;
    const subDir = parts.length > 2 ? parts[1] : '';
    subMap.set(subDir, (subMap.get(subDir) || 0) + 1);
  }
  const groups: DirGroup[] = [];
  for (const [topDir, subMap] of map.entries()) {
    let total = 0;
    const subDirs: { name: string; count: number }[] = [];
    for (const [name, count] of subMap.entries()) {
      total += count;
      if (name) subDirs.push({ name, count });
    }
    subDirs.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    groups.push({ topDir, subDirs, totalCount: total });
  }
  groups.sort((a, b) => a.topDir.localeCompare(b.topDir));
  return groups;
}

interface DirActionSet {
  canCreate: boolean;
  canImport: boolean;
  canDelete: boolean;
  label: string;
  reason?: string;
}

/** Determine contextual actions for a given Explorer dir node. */
function dirActions(dir: string): DirActionSet {
  const api = assetHostApi;

  // "" (全部图片) and "images" both map to managed root
  if (dir === '' || dir === 'images') {
    return {
      canCreate: api.canCreateDir,
      canImport: api.canImport,
      canDelete: false,
      label: 'images（管理根目录）',
      reason: api.canCreateDir ? undefined : '未接入宿主写入通道',
    };
  }

  // Managed subdirectory
  if (isManagedDir(dir)) {
    return {
      canCreate: api.canCreateDir,
      canImport: api.canImport,
      canDelete: api.canDeleteDir,
      label: dir,
      reason: api.canCreateDir ? undefined : '未接入宿主写入通道',
    };
  }

  // Non-managed — show disabled menu
  return {
    canCreate: false,
    canImport: false,
    canDelete: false,
    label: `${dir}（只读）`,
    reason: '非管理目录，不可写入',
  };
}

/** Resolve a frontend dir to the actual managed parent for create/import operations. */
function resolveManagedParent(dir: string): string {
  if (dir === '') return 'images';
  if (!isManagedDir(dir)) return dir; // guarded by callers
  return dir;
}

// ── Route guard ──

export function isImageManagerPath(path: string): boolean {
  return path === APP_ROUTE_PATHS.imageManager;
}

// ── Component ──

export function ImageManagerPage() {
  const [assets, setAssets] = useState<ImageAssetEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentDir, setCurrentDir] = useState('');
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

  const [dirCtxMenu, setDirCtxMenu] = useState<{ x: number; y: number; dir: string } | null>(null);

  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [folderParentDir, setFolderParentDir] = useState('');

  const [isDeletingFolder, setIsDeletingFolder] = useState(false);
  const [deleteFolderDir, setDeleteFolderDir] = useState('');
  const [deleteFolderError, setDeleteFolderError] = useState<string | null>(null);

  const renameInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initialDirSet = useRef(false);
  const importTargetDirRef = useRef<string | undefined>(undefined);

  // ── Load assets ──

  const loadAssets = async () => {
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
  };

  useEffect(() => {
    loadAssets();
  }, []);

  // ── Derived data ──

  const dirTree = useMemo(() => buildDirTree(assets), [assets]);

  useEffect(() => {
    if (!initialDirSet.current && dirTree.length > 0) {
      initialDirSet.current = true;
      const first = dirTree[0];
      const firstSub = first.subDirs.length > 0 ? `${first.topDir}/${first.subDirs[0].name}` : first.topDir;
      setCurrentDir(firstSub);
      setExpandedDirs(new Set([first.topDir]));
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

  // ── Unified write-op helper ──

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

  const getImportTargetDir = (): string | undefined => {
    const raw = importTargetDirRef.current !== undefined ? importTargetDirRef.current : currentDir;
    importTargetDirRef.current = undefined;
    return toManagedRelative(raw);
  };

  const handleImport = () => {
    importTargetDirRef.current = undefined;
    fileInputRef.current?.click();
  };

  const handleImportToDir = (dir: string) => {
    importTargetDirRef.current = resolveManagedParent(dir);
    setDirCtxMenu(null);
    fileInputRef.current?.click();
  };

  const handleBrowserFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    if (!assetHostApi.canImport) {
      flash('当前环境不支持导入');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const targetDir = getImportTargetDir();

    const items = await Promise.all(
      Array.from(files).map(async (file) => {
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        return { fileName: file.name, data: btoa(binary) };
      }),
    );

    await runWriteOp('导入', () => assetHostApi.importFiles(items, targetDir));

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── Rename ──

  const startRename = () => {
    if (!selectedAsset) return;
    setRenameValue(selectedAsset.baseName);
    setIsRenaming(true);
    setTimeout(() => renameInputRef.current?.select(), 50);
  };

  const commitRename = async () => {
    if (!selectedAsset || !assetHostApi.canRename || !renameValue.trim()) {
      setIsRenaming(false);
      return;
    }
    await runWriteOp('重命名', () =>
      assetHostApi.renameFile(selectedAsset.relativePath, renameValue.trim()),
      () => {
        setIsRenaming(false);
        setSelectedPath(null);
      },
    );
  };

  const cancelRename = () => {
    setIsRenaming(false);
    setRenameValue('');
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitRename();
    if (e.key === 'Escape') cancelRename();
  };

  // ── Delete file ──

  const handleDeleteRequest = () => {
    if (!selectedAsset) return;
    setConfirmDelete(true);
  };

  const handleDeleteConfirm = async () => {
    if (!selectedAsset || !assetHostApi.canDeleteFile) {
      setConfirmDelete(false);
      return;
    }
    await runWriteOp('删除', () => assetHostApi.deleteFile(selectedAsset.relativePath), () => {
      setConfirmDelete(false);
      setSelectedPath(null);
    });
  };

  const handleDeleteCancel = () => setConfirmDelete(false);

  // ── Create folder ──

  const openCreateFolder = (dir: string) => {
    const parent = resolveManagedParent(dir);
    if (!isManagedDir(parent)) return;
    setFolderParentDir(parent);
    setFolderName('');
    setIsCreatingFolder(true);
    setDirCtxMenu(null);
    setTimeout(() => folderInputRef.current?.focus(), 50);
  };

  const commitCreateFolder = async () => {
    if (!assetHostApi.canCreateDir || !folderName.trim()) {
      setIsCreatingFolder(false);
      return;
    }
    const parentBackend = toManagedRelative(folderParentDir);
    if (parentBackend === undefined && folderParentDir !== 'images') {
      setIsCreatingFolder(false);
      return;
    }
    await runWriteOp('创建文件夹', () =>
      assetHostApi.createDirectory(folderName.trim(), parentBackend),
      (result) => {
        const createdBackendPath = result.createdPath || '';
        setIsCreatingFolder(false);
        setFolderName('');

        const frontendDir = fromManagedRelative(createdBackendPath || undefined);

        const topDir = folderParentDir.split('/')[0];
        setExpandedDirs((prev) => {
          const next = new Set(prev);
          next.add(topDir);
          return next;
        });
        setCurrentDir(frontendDir);
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
    if (!isManagedDir(dir) || dir === 'images') return;
    setDeleteFolderDir(dir);
    setDeleteFolderError(null);
    setIsDeletingFolder(true);
    setDirCtxMenu(null);
  };

  const commitDeleteFolder = async () => {
    if (!assetHostApi.canDeleteDir || !deleteFolderDir) return;

    const backendPath = toManagedRelative(deleteFolderDir);
    if (!backendPath) {
      setDeleteFolderError('无法删除根目录');
      return;
    }

    setDeleteFolderError(null);
    setLoading(true);
    try {
      const result = await assetHostApi.deleteDirectory(backendPath);
      if (result.ok) {
        flash('删除目录成功');
        await loadAssets();
        setIsDeletingFolder(false);
        setDeleteFolderDir('');

        if (currentDir === deleteFolderDir || currentDir.startsWith(deleteFolderDir + '/')) {
          const parts = deleteFolderDir.split('/');
          parts.pop();
          setCurrentDir(parts.join('/'));
        }
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

  // ── Directory context menu ──

  const handleDirContextMenu = (e: React.MouseEvent, dir: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDirCtxMenu({ x: e.clientX, y: e.clientY, dir });
  };

  useEffect(() => {
    if (!dirCtxMenu) return;
    const close = () => setDirCtxMenu(null);
    document.addEventListener('click', close, { once: true });
    return () => document.removeEventListener('click', close);
  }, [dirCtxMenu]);

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
        canImport={api.canImport}
        canRename={api.canRename}
        canDeleteFile={api.canDeleteFile}
        loading={loading}
        searchQuery={searchQuery}
        viewMode={viewMode}
        selectedAsset={selectedAsset}
        fileInputRef={fileInputRef}
        onSearchChange={setSearchQuery}
        onImport={handleImport}
        onBrowserFileSelected={handleBrowserFileSelected}
        onRename={startRename}
        onDelete={handleDeleteRequest}
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
        />

        <ImageManagerAssetList
          assets={filteredAssets}
          selectedPath={selectedPath}
          searchQuery={searchQuery}
          loading={loading}
          viewMode={viewMode}
          assetUrl={assetUrl}
          onSelectAsset={setSelectedPath}
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
          onStartRename={startRename}
        />
      </div>

      {/* ── Directory context menu ── */}
      {dirCtxMenu && (() => {
        const actions = dirActions(dirCtxMenu.dir);
        return (
          <div
            className="image-manager-ctx-menu"
            style={{ left: dirCtxMenu.x, top: dirCtxMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="image-manager-ctx-menu-header">{actions.label}</div>

            <button
              type="button"
              disabled={!actions.canCreate}
              title={!actions.canCreate ? (actions.reason || '不可用') : `在 ${actions.label} 下新建文件夹`}
              onClick={() => openCreateFolder(dirCtxMenu.dir)}
            >
              新建文件夹
            </button>

            <button
              type="button"
              disabled={!actions.canImport}
              title={!actions.canImport ? (actions.reason || '不可用') : `导入图片到 ${actions.label}`}
              onClick={() => handleImportToDir(dirCtxMenu.dir)}
            >
              导入图片到此处
            </button>

            <button
              type="button"
              disabled={!actions.canDelete}
              title={!actions.canDelete ? '根目录或非管理目录不可删除' : `删除 ${actions.label}`}
              onClick={() => openDeleteFolder(dirCtxMenu.dir)}
            >
              删除文件夹
            </button>
          </div>
        );
      })()}

      {/* ── Rename modal ── */}
      <ImageManagerRenameModal
        isOpen={isRenaming}
        currentName={selectedAsset?.fileName ?? ''}
        renameValue={renameValue}
        renameInputRef={renameInputRef}
        onRenameValueChange={setRenameValue}
        onCommit={commitRename}
        onCancel={cancelRename}
        onKeyDown={handleRenameKeyDown}
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
      {confirmDelete && selectedAsset && (
        <div className="operator-draft-modal-overlay" onClick={handleDeleteCancel}>
          <div className="operator-draft-modal operator-draft-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="operator-draft-section-header">
              <div>
                <h3>确认删除</h3>
                <p>此操作不可撤销。</p>
              </div>
            </div>
            <div className="operator-draft-confirm-body">
              <p>确定要删除 <strong>{selectedAsset.fileName}</strong> 吗？</p>
            </div>
            <div className="operator-draft-modal-actions">
              <button className="operator-draft-ghost-button" type="button" onClick={handleDeleteCancel}>
                取消
              </button>
              <button className="operator-draft-copy-button operator-draft-danger-button" type="button" onClick={handleDeleteConfirm}>
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
