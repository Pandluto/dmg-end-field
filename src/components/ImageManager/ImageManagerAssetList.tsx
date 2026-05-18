import type { ImageAssetEntry } from './types';

interface ImageManagerAssetListProps {
  assets: ImageAssetEntry[];
  selectedPath: string | null;
  currentDir: string;
  searchQuery: string;
  loading: boolean;
  viewMode: 'list' | 'grid';
  assetUrl: (path: string) => string;
  onSelectAsset: (path: string) => void;
}

export function ImageManagerAssetList(props: ImageManagerAssetListProps) {
  const { assets, selectedPath, currentDir, searchQuery, loading, viewMode, assetUrl, onSelectAsset } = props;

  const displayLabel = currentDir ? currentDir.replace(/^avatars\//, 'avatars / ') : '全部图片';

  return (
    <section className="damage-sheet-excel-shell">
      {/* Panel header  这个样式有问题我已经删了*/}
      {/* Content */}
      {loading && assets.length === 0 ? (
        <div className="image-manager-empty">加载中…</div>
      ) : assets.length === 0 ? (
        <div className="image-manager-empty">
          {searchQuery ? '无匹配结果' : '暂无图片'}
        </div>
      ) : viewMode === 'list' ? (
        <div className="image-manager-asset-table-wrap">
          <table className="image-manager-asset-table">
            <thead>
              <tr>
                <th className="col-thumb">预览</th>
                <th className="col-name">文件名</th>
                <th className="col-dir">目录</th>
                <th className="col-type">类型</th>
                <th className="col-size">大小</th>
                <th className="col-stat">状态</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => (
                <tr
                  key={asset.relativePath}
                  className={selectedPath === asset.relativePath ? 'is-selected' : ''}
                  onClick={() => onSelectAsset(asset.relativePath)}
                  style={{ cursor: 'pointer' }}
                >
                  <td className="col-thumb">
                    <div className="image-manager-table-thumb-box">
                      <img
                        className="image-manager-table-thumb"
                        src={assetUrl(asset.relativePath)}
                        alt={asset.fileName}
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    </div>
                  </td>
                  <td className="col-name" title={asset.fileName}>{asset.fileName}</td>
                  <td className="col-dir" title={asset.relativePath}>
                    {asset.relativePath.split('/')[1] || '--'}
                  </td>
                  <td className="col-type">{asset.ext.toUpperCase().replace('.', '')}</td>
                  <td className="col-size">{formatSize(asset.sizeBytes)}</td>
                  <td className="col-stat">
                    {asset.writable ? (
                      <span className="image-manager-stat-writable">可写</span>
                    ) : (
                      <span className="image-manager-stat-readonly">只读</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        /* Grid view (secondary) */
        <div className="image-manager-asset-grid">
          {assets.map((asset) => (
            <div key={asset.relativePath} className="image-manager-grid-cell">
              <button
                className={`image-manager-grid-item ${selectedPath === asset.relativePath ? 'is-selected' : ''}`}
                type="button"
                onClick={() => onSelectAsset(asset.relativePath)}
                title={asset.fileName}
              >
                <div className="image-manager-grid-thumb">
                  <img
                    src={assetUrl(asset.relativePath)}
                    alt={asset.fileName}
                    onError={(e) => {
                      const el = e.currentTarget as HTMLImageElement;
                      el.style.display = 'none';
                      const fallback = el.parentElement?.querySelector('.image-manager-grid-fallback');
                      if (fallback) (fallback as HTMLElement).style.display = 'flex';
                    }}
                  />
                  <span className="image-manager-grid-fallback">{asset.baseName.slice(0, 3)}</span>
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
  );
}

function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '--';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(2)} MB`;
}
