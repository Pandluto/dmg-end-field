import type { ImageAssetEntry } from './types';

interface ImageManagerRibbonProps {
  canImport: boolean;
  canRename: boolean;
  canDeleteFile: boolean;
  loading: boolean;
  searchQuery: string;
  viewMode: 'list' | 'grid';
  selectedAsset: ImageAssetEntry | null;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onSearchChange: (q: string) => void;
  onImport: () => void;
  onBrowserFileSelected: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRename: () => void;
  onDelete: () => void;
  onRefresh: () => void;
  onToggleViewMode: () => void;
}

export function ImageManagerRibbon(props: ImageManagerRibbonProps) {
  const {
    canImport, canRename, canDeleteFile, loading, searchQuery, viewMode,
    selectedAsset, fileInputRef,
    onSearchChange, onImport,
    onBrowserFileSelected, onRename, onDelete,
    onRefresh, onToggleViewMode,
  } = props;

  const renameDisabled = !selectedAsset || !canRename || !selectedAsset.writable;
  const deleteDisabled = !selectedAsset || !canDeleteFile || !selectedAsset.writable;

  return (
    <section className="damage-sheet-ribbon buff-sheet-ribbon">
      <div className="buff-sheet-ribbon-actions">
        {/* Import */}
        <button
          className="buff-sheet-tool-button"
          type="button"
          disabled={loading || !canImport}
          onClick={onImport}
          title={canImport ? '导入图片' : '当前环境不支持导入'}
        >
          <span className="buff-sheet-tool-icon" aria-hidden="true">
            <svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false">
              <path d="M2.5 4.5l2-1.5h3l2 1.5h4v7.5H2.5z" />
              <path d="M8 7v4.5M6 9l2-2 2 2" />
            </svg>
          </span>
          <span className="buff-sheet-tool-text">导入</span>
        </button>

        {/* Rename */}
        <button
          className="buff-sheet-tool-button"
          type="button"
          disabled={renameDisabled}
          onClick={onRename}
        >
          <span className="buff-sheet-tool-icon" aria-hidden="true">
            <svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false">
              <path d="M3.5 12.5h1.5l7-7-1.5-1.5-7 7z" />
              <path d="M11 3l1.5 1.5" />
            </svg>
          </span>
          <span className="buff-sheet-tool-text">重命名</span>
        </button>

        {/* Delete */}
        <button
          className="buff-sheet-tool-button"
          type="button"
          disabled={deleteDisabled}
          onClick={onDelete}
        >
          <span className="buff-sheet-tool-icon" aria-hidden="true">
            <svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false">
              <path d="M4.25 5.25h7.5M6.25 2.75h3.5M5.25 5.25v6.5M8 5.25v6.5M10.75 5.25v6.5M4.75 5.25l.5 7h5.5l.5-7" />
            </svg>
          </span>
          <span className="buff-sheet-tool-text">删除</span>
        </button>

        {/* Refresh */}
        <button className="buff-sheet-tool-button" type="button" onClick={onRefresh} disabled={loading}>
          <span className="buff-sheet-tool-icon" aria-hidden="true">
            <svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false">
              <path d="M4 3A5.5 5.5 0 0113 8M12 13A5.5 5.5 0 013 8" />
              <path d="M6 1.5L4 3l2 1.5M10 14.5l2-1.5-2-1.5" />
            </svg>
          </span>
          <span className="buff-sheet-tool-text">刷新</span>
        </button>

        {/* View toggle */}
        <button className={`buff-sheet-tool-button ${viewMode === 'grid' ? 'is-active' : ''}`} type="button" onClick={onToggleViewMode}>
          <span className="buff-sheet-tool-icon" aria-hidden="true">
            <svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false">
              <path d="M3 2.5h4v4H3zM9 2.5h4v4H9zM3 9.5h4v4H3zM9 9.5h4v4H9z" />
            </svg>
          </span>
          <span className="buff-sheet-tool-text">{viewMode === 'list' ? '宫格' : '列表'}</span>
        </button>
      </div>

      {/* Search */}
      <div className="damage-sheet-formula-bar" style={{ gridTemplateColumns: 'minmax(0, 1fr)', gap: 0 }}>
        <input
          className="buff-sheet-search-input"
          type="text"
          placeholder="搜索文件名…"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          style={{ width: '100%', maxWidth: 320 }}
        />
      </div>

      {/* Hidden file input for browser import */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        multiple
        className="operator-draft-file-input"
        onChange={onBrowserFileSelected}
      />
    </section>
  );
}
