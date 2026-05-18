import type { ImageAssetEntry } from './types';

interface ImageManagerPreviewPanelProps {
  selectedAsset: ImageAssetEntry | null;
  selectedIndex: number;
  filteredCount: number;
  isElectron: boolean;
  assetUrl: (path: string) => string;
  formatBytes: (bytes: number) => string;
  onGoPrev: () => void;
  onGoNext: () => void;
  onStartRename: () => void;
}

export function ImageManagerPreviewPanel(props: ImageManagerPreviewPanelProps) {
  const { selectedAsset, selectedIndex, filteredCount, isElectron, assetUrl, formatBytes, onGoPrev, onGoNext, onStartRename } = props;

  return (
    <aside className="damage-sheet-sidebar">
      <div className="damage-sheet-sidebar-title">属性</div>

      {selectedAsset ? (
        <div className="image-manager-preview-body">
          {/* Preview image */}
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

          {/* Nav */}
          <div className="image-manager-preview-nav">
            <button className="buff-sheet-tool-button" type="button" onClick={onGoPrev} title="上一个">
              <span className="buff-sheet-tool-text">&#9664;</span>
            </button>
            <span className="image-manager-preview-index">
              {selectedIndex + 1} / {filteredCount}
            </span>
            <button className="buff-sheet-tool-button" type="button" onClick={onGoNext} title="下一个">
              <span className="buff-sheet-tool-text">&#9654;</span>
            </button>
          </div>

          {/* Meta */}
          <dl className="image-manager-preview-meta">
            <dt>目录</dt>
            <dd>{selectedAsset.relativePath.split('/')[1] || '--'}</dd>

            <dt>文件名</dt>
            <dd>{selectedAsset.fileName}</dd>

            <dt>路径</dt>
            <dd className="image-manager-preview-path">{selectedAsset.relativePath}</dd>

            <dt>类型</dt>
            <dd>{selectedAsset.ext.toUpperCase().replace('.', '')}</dd>

            <dt>大小</dt>
            <dd>{formatBytes(selectedAsset.sizeBytes)}</dd>

            <dt>状态</dt>
            <dd>
              {selectedAsset.writable ? (
                <span className="image-manager-stat-writable">可编辑</span>
              ) : (
                <span className="image-manager-stat-readonly">只读</span>
              )}
            </dd>
          </dl>

          {/* Actions */}
          <div className="image-manager-preview-actions">
            <button
              className="buff-sheet-tool-button"
              type="button"
              disabled={!isElectron || !selectedAsset.writable}
              onClick={onStartRename}
            >
              <span className="buff-sheet-tool-text">重命名</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="image-manager-empty">选择一张图片以预览</div>
      )}
    </aside>
  );
}
