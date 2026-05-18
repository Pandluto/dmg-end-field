import { useEffect, useMemo, useRef, useState } from 'react';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../utils/appRoute';
import { resolvePublicPath } from '../utils/assetResolver';
import './ImageManagerPage.css';

// ── Types ──

interface ImageAssetEntry {
  fileName: string;
  baseName: string;
  ext: string;
  relativePath: string;
  writable: boolean;
  sizeBytes: number;
  updatedAt: number;
}

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

interface DirGroup {
  topDir: string;
  subDirs: { name: string; count: number }[];
  totalCount: number;
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

  const renameInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isElectron = !!window.desktopRuntime?.listImageAssets;

  // ── Load assets ──

  const loadAssets = async () => {
    setLoading(true);
    try {
      if (isElectron) {
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
    () => assets.find((a) => a.relativePath === selectedPath) ?? null,
    [assets, selectedPath],
  );

  const isWriteDisabled = !isElectron;

  // ── Flash message ──

  const flash = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(null), 3000);
  };

  // ── Import ──

  const handleImport = async () => {
    if (!isElectron) return;
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
  };

  const handleBrowserImport = () => {
    fileInputRef.current?.click();
  };

  const handleBrowserFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files || event.target.files.length === 0) return;
    flash('浏览器模式不支持写入文件，仅桌面端可导入到管理目录');
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
    if (!selectedAsset || !isElectron || !renameValue.trim()) {
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
    if (!selectedAsset || !isElectron) {
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

  // ── Render ──

  return (
    <main className="image-manager-page">
      <div className="image-manager-shell">
        {/* ── Top toolbar ── */}
        <header className="image-manager-toolbar">
          <div className="image-manager-toolbar-left">
            <h1 className="image-manager-title">图片资源管理</h1>
          </div>

          <div className="image-manager-toolbar-center">
            <input
              className="image-manager-search"
              type="text"
              placeholder="搜索文件名…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="image-manager-toolbar-right">
            {isElectron ? (
              <button className="image-manager-btn" type="button" onClick={handleImport} disabled={loading}>
                导入图片
              </button>
            ) : (
              <>
                <button className="image-manager-btn is-disabled" type="button" onClick={handleBrowserImport} title="浏览器模式不支持写入，仅桌面端可用">
                  导入图片
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                  multiple
                  className="image-manager-file-input"
                  onChange={handleBrowserFileSelected}
                />
              </>
            )}
            <button
              className="image-manager-btn"
              type="button"
              disabled={!selectedAsset || isWriteDisabled || !selectedAsset.writable}
              onClick={startRename}
              title={isWriteDisabled ? '仅桌面端可用' : !selectedAsset?.writable ? '此文件为只读' : '重命名选中图片'}
            >
              重命名
            </button>
            <button
              className="image-manager-btn image-manager-btn-danger"
              type="button"
              disabled={!selectedAsset || isWriteDisabled || !selectedAsset.writable}
              onClick={handleDeleteRequest}
              title={isWriteDisabled ? '仅桌面端可用' : !selectedAsset?.writable ? '此文件为只读' : '删除选中图片'}
            >
              删除
            </button>
            <button className="image-manager-btn" type="button" onClick={loadAssets} disabled={loading}>
              刷新
            </button>
          </div>
        </header>

        {/* ── Message toast ── */}
        {message && <div className="image-manager-toast">{message}</div>}

        {/* ── Three-column workbench ── */}
        <div className="image-manager-workbench">
          {/* Left: directory sidebar */}
          <aside className="image-manager-sidebar">
            <div className="image-manager-panel-header">
              <h3>目录</h3>
            </div>
            <ul className="image-manager-dir-list">
              <li>
                <button
                  className={`image-manager-dir-item ${currentDir === '' ? 'is-active' : ''}`}
                  type="button"
                  onClick={() => { setCurrentDir(''); setSelectedPath(null); }}
                >
                  全部图片
                  <span className="image-manager-dir-count">{assets.length}</span>
                </button>
              </li>
              {dirTree.map((group) => {
                const groupDir = group.topDir;
                const isExpanded = expandedDirs.has(groupDir);
                const isGroupActive = currentDir === groupDir || (currentDir.startsWith(groupDir + '/'));
                const groupCount = group.totalCount;
                return (
                  <li key={groupDir}>
                    <button
                      className={`image-manager-dir-item image-manager-dir-parent ${isGroupActive ? 'is-active' : ''}`}
                      type="button"
                      onClick={() => {
                        setExpandedDirs((prev) => {
                          const next = new Set(prev);
                          if (next.has(groupDir)) next.delete(groupDir);
                          else next.add(groupDir);
                          return next;
                        });
                        setCurrentDir(groupDir);
                        setSelectedPath(null);
                      }}
                    >
                      <span className="image-manager-dir-arrow">{isExpanded ? '▾' : '▸'}</span>
                      <span className="image-manager-dir-label">{groupDir}</span>
                      <span className="image-manager-dir-count">{groupCount}</span>
                    </button>
                    {isExpanded && group.subDirs.length > 0 && (
                      <ul className="image-manager-dir-sublist">
                        {group.subDirs.map((sub) => {
                          const subDir = `${groupDir}/${sub.name}`;
                          return (
                            <li key={subDir}>
                              <button
                                className={`image-manager-dir-item image-manager-dir-child ${currentDir === subDir ? 'is-active' : ''}`}
                                type="button"
                                onClick={() => { setCurrentDir(subDir); setSelectedPath(null); }}
                              >
                                <span className="image-manager-dir-label">{sub.name}</span>
                                <span className="image-manager-dir-count">{sub.count}</span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
            {isElectron ? null : (
              <p className="image-manager-sidebar-hint">浏览器模式 · 写操作仅桌面端可用</p>
            )}
          </aside>

          {/* Center: image grid */}
          <section className="image-manager-main">
            <div className="image-manager-panel-header">
              <h3>
                {currentDir ? currentDir.replace(/^avatars\//, 'avatars / ') : '全部图片'}
                <span className="image-manager-count">{filteredAssets.length} 个文件</span>
              </h3>
            </div>

            {loading && assets.length === 0 ? (
              <div className="image-manager-empty">加载中…</div>
            ) : filteredAssets.length === 0 ? (
              <div className="image-manager-empty">
                {searchQuery ? '无匹配结果' : '暂无图片'}
              </div>
            ) : (
              <div className="image-manager-grid">
                {filteredAssets.map((asset) => (
                  <div key={asset.relativePath} className="image-manager-grid-cell">
                    <button
                      className={`image-manager-grid-item ${selectedPath === asset.relativePath ? 'is-selected' : ''}`}
                      type="button"
                      onClick={() => setSelectedPath(asset.relativePath)}
                      title={asset.fileName}
                    >
                      <div className="image-manager-thumb">
                        <img
                          src={assetUrl(asset.relativePath)}
                          alt={asset.fileName}
                          onError={(e) => {
                            const el = e.currentTarget;
                            el.style.display = 'none';
                            const fallback = el.parentElement?.querySelector('.image-manager-thumb-fallback');
                            if (fallback) (fallback as HTMLElement).style.display = 'flex';
                          }}
                        />
                        <span className="image-manager-thumb-fallback">{asset.baseName.slice(0, 3)}</span>
                      </div>
                      <div className="image-manager-grid-info">
                        <span className="image-manager-grid-name" title={asset.fileName}>
                          {asset.fileName}
                        </span>
                        {!asset.writable && (
                          <span className="image-manager-grid-lock" title="只读">&#128274;</span>
                        )}
                      </div>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Right: preview panel */}
          <aside className="image-manager-preview">
            <div className="image-manager-panel-header">
              <h3>预览</h3>
            </div>

            {selectedAsset ? (
              <div className="image-manager-preview-body">
                <div className="image-manager-preview-image">
                  <img
                    src={assetUrl(selectedAsset.relativePath)}
                    alt={selectedAsset.fileName}
                    onError={(e) => {
                      const el = e.currentTarget;
                      el.style.display = 'none';
                      const fallback = el.parentElement?.querySelector('.image-manager-preview-fallback');
                      if (fallback) (fallback as HTMLElement).style.display = 'flex';
                    }}
                  />
                  <span className="image-manager-preview-fallback">{selectedAsset.baseName}</span>
                </div>

                <div className="image-manager-preview-nav">
                  <button className="image-manager-btn" type="button" onClick={goPrev} title="上一个">
                    ◂
                  </button>
                  <span className="image-manager-preview-index">
                    {selectedIndex + 1} / {filteredAssets.length}
                  </span>
                  <button className="image-manager-btn" type="button" onClick={goNext} title="下一个">
                    ▸
                  </button>
                </div>

                <div className="image-manager-preview-badge">
                  {selectedAsset.writable ? (
                    <span className="image-manager-badge-writable">可编辑</span>
                  ) : (
                    <span className="image-manager-badge-readonly">只读</span>
                  )}
                </div>

                <dl className="image-manager-preview-info">
                  <dt>目录</dt>
                  <dd>{selectedAsset.relativePath.split('/')[1] || '--'}</dd>

                  <dt>文件名</dt>
                  <dd>
                    {isRenaming ? (
                      <input
                        ref={renameInputRef}
                        className="image-manager-rename-input"
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={handleRenameKeyDown}
                        onBlur={commitRename}
                      />
                    ) : (
                      selectedAsset.fileName
                    )}
                  </dd>

                  <dt>路径</dt>
                  <dd className="image-manager-preview-path">{selectedAsset.relativePath}</dd>

                  <dt>类型</dt>
                  <dd>{selectedAsset.ext.toUpperCase().replace('.', '')}</dd>

                  <dt>大小</dt>
                  <dd>{formatBytes(selectedAsset.sizeBytes)}</dd>
                </dl>
              </div>
            ) : (
              <div className="image-manager-empty">选择一张图片以预览</div>
            )}
          </aside>
        </div>

        {/* ── Bottom nav ── */}
        <footer className="image-manager-footer">
          <button className="image-manager-btn" type="button" onClick={handleOpenWorkbench}>
            主界面
          </button>
          <button className="image-manager-btn" type="button" onClick={handleOpenOperatorDraft}>
            编辑干员
          </button>
          <button className="image-manager-btn" type="button" onClick={handleOpenBuffDraft}>
            编辑BUFF
          </button>
          <button className="image-manager-btn is-active" type="button">
            图片管理
          </button>
        </footer>
      </div>

      {/* ── Delete confirmation modal ── */}
      {confirmDelete && selectedAsset && (
        <div className="image-manager-modal-overlay" onClick={handleDeleteCancel}>
          <div className="image-manager-modal" onClick={(e) => e.stopPropagation()}>
            <div className="image-manager-modal-header">
              <h3>确认删除</h3>
            </div>
            <div className="image-manager-modal-body">
              <p>确定要删除 <strong>{selectedAsset.fileName}</strong> 吗？此操作不可撤销。</p>
            </div>
            <div className="image-manager-modal-actions">
              <button className="image-manager-btn" type="button" onClick={handleDeleteCancel}>
                取消
              </button>
              <button className="image-manager-btn image-manager-btn-danger" type="button" onClick={handleDeleteConfirm}>
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
