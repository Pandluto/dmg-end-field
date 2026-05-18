import { useEffect, useMemo, useRef, useState } from 'react';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../utils/appRoute';
import { resolvePublicPath } from '../utils/assetResolver';
import './ImageManagerPage.css';
import { ImageManagerRibbon } from './ImageManager/ImageManagerRibbon';
import { ImageManagerExplorer } from './ImageManager/ImageManagerExplorer';
import { ImageManagerAssetList } from './ImageManager/ImageManagerAssetList';
import { ImageManagerPreviewPanel } from './ImageManager/ImageManagerPreviewPanel';
import { ImageManagerRenameModal } from './ImageManager/ImageManagerRenameModal';
import type { ImageAssetEntry, DirGroup } from './ImageManager/types';

// ── Helpers ──

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

  const renameInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initialDirSet = useRef(false);

  const isElectron = !!window.desktopRuntime?.listImageAssets;
  const canWriteAssets = isElectron || !!window.desktopRuntime?.importImageAssetsFromBrowser;
  const canListViaIpc = isElectron;

  // ── Load assets ──

  const loadAssets = async () => {
    setLoading(true);
    try {
      if (canListViaIpc) {
        const list = await window.desktopRuntime!.listImageAssets!();
        const sorted = [...list].sort((a, b) =>
          a.fileName.localeCompare(b.fileName, undefined, { numeric: true }),
        );
        setAssets(sorted);
      } else {
        const manifestUrl = resolvePublicPath('assets/images/_manifest.json');
        const res = await fetch(manifestUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const list: ImageAssetEntry[] = await res.json();
        const sorted = [...list].sort((a, b) =>
          a.fileName.localeCompare(b.fileName, undefined, { numeric: true }),
        );
        setAssets(sorted);
      }
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

  const isWriteDisabled = !canWriteAssets;

  // ── Flash message ──

  const flash = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(null), 3000);
  };

  // ── Import ──

  const refreshAfterWrite = async () => {
    await loadAssets();
    setSelectedPath(null);
  };

  const handleImport = async () => {
    if (isElectron) {
      setLoading(true);
      try {
        const updated = await window.desktopRuntime!.importImageAssets!();
        const sorted = [...updated].sort((a, b) =>
          a.fileName.localeCompare(b.fileName, undefined, { numeric: true }),
        );
        setAssets(sorted);
        flash('导入完成');
      } catch (err) {
        flash(`导入失败: ${err instanceof Error ? err.message : '未知错误'}`);
      } finally {
        setLoading(false);
      }
    } else {
      fileInputRef.current?.click();
    }
  };

  const handleBrowserFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    if (!canWriteAssets) {
      flash('当前环境不支持写入文件');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setLoading(true);
    try {
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

      const result = await window.desktopRuntime!.importImageAssetsFromBrowser!({ items });
      if (result.ok) {
        flash(`导入完成: ${result.results.filter((r) => r.ok).length} 个文件`);
      } else {
        const failed = result.results.filter((r) => !r.ok).map((r) => r.fileName).join(', ');
        flash(result.error || `部分文件导入失败: ${failed}`);
      }
      await refreshAfterWrite();
    } catch (err) {
      flash(`导入失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ── Rename ──

  const startRename = () => {
    if (!selectedAsset) return;
    setRenameValue(selectedAsset.baseName);
    setIsRenaming(true);
    setTimeout(() => renameInputRef.current?.select(), 50);
  };

  const commitRename = async () => {
    if (!selectedAsset || !canWriteAssets || !renameValue.trim()) {
      setIsRenaming(false);
      return;
    }
    const result = await window.desktopRuntime!.renameImageAsset!({
      relativePath: selectedAsset.relativePath,
      newName: renameValue.trim(),
    });
    if (result.ok) {
      flash('重命名成功');
      setIsRenaming(false);
      await loadAssets();
      setSelectedPath(null);
    } else {
      flash(result.error || '重命名失败');
    }
  };

  const cancelRename = () => {
    setIsRenaming(false);
    setRenameValue('');
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitRename();
    if (e.key === 'Escape') cancelRename();
  };

  // ── Delete ──

  const handleDeleteRequest = () => {
    if (!selectedAsset) return;
    setConfirmDelete(true);
  };

  const handleDeleteConfirm = async () => {
    if (!selectedAsset || !canWriteAssets) {
      setConfirmDelete(false);
      return;
    }
    const result = await window.desktopRuntime!.deleteImageAsset!({
      relativePath: selectedAsset.relativePath,
    });
    if (result.ok) {
      flash('删除成功');
      setConfirmDelete(false);
      setSelectedPath(null);
      await loadAssets();
    } else {
      flash(result.error || '删除失败');
      setConfirmDelete(false);
    }
  };

  const handleDeleteCancel = () => {
    setConfirmDelete(false);
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

  // ── Render ──

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
        canWriteAssets={canWriteAssets}
        loading={loading}
        searchQuery={searchQuery}
        viewMode={viewMode}
        selectedAsset={selectedAsset}
        isWriteDisabled={isWriteDisabled}
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
          isElectron={isElectron}
          onSelectDir={handleSelectDir}
          onToggleExpanded={handleToggleExpanded}
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
          canWriteAssets={canWriteAssets}
          assetUrl={assetUrl}
          formatBytes={formatBytes}
          onGoPrev={goPrev}
          onGoNext={goNext}
          onStartRename={startRename}
        />
      </div>

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

      {/* ── Delete confirmation modal ── */}
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
