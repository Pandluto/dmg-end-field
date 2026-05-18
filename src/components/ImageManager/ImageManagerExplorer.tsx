import { isManagedDir } from '../../utils/assetHostApi';

interface DirGroup {
  topDir: string;
  subDirs: { name: string; count: number }[];
  totalCount: number;
}

interface ImageManagerExplorerProps {
  dirTree: DirGroup[];
  currentDir: string;
  expandedDirs: Set<string>;
  totalCount: number;
  backendLabel: string;
  onSelectDir: (dir: string) => void;
  onToggleExpanded: (topDir: string) => void;
  onContextMenu: (e: React.MouseEvent, dir: string) => void;
}

export function ImageManagerExplorer(props: ImageManagerExplorerProps) {
  const { dirTree, currentDir, expandedDirs, totalCount, backendLabel, onSelectDir, onToggleExpanded, onContextMenu } = props;

  return (
    <aside className="damage-sheet-sidebar buff-sheet-explorer">
      <div className="damage-sheet-sidebar-title">资源管理器</div>

      <div className="buff-sheet-explorer-tree">
        {/* All images — always shows context menu, maps to images root for operations */}
        <div className="buff-sheet-explorer-node">
          <button
            className={`buff-sheet-explorer-row ${currentDir === '' ? 'is-active' : ''}`}
            type="button"
            onClick={() => onSelectDir('')}
            onContextMenu={(e) => onContextMenu(e, '')}
          >
            <span className="buff-sheet-explorer-label">全部图片</span>
            <span className="buff-sheet-explorer-count">{totalCount}</span>
          </button>
        </div>

        {/* Directory groups */}
        {dirTree.map((group) => {
          const isExpanded = expandedDirs.has(group.topDir);
          const isGroupActive = currentDir === group.topDir || currentDir.startsWith(group.topDir + '/');
          const isGroupManaged = isManagedDir(group.topDir);

          return (
            <div className="buff-sheet-explorer-node" key={group.topDir}>
              <button
                className={`buff-sheet-explorer-row ${isGroupActive ? 'is-active' : ''}`}
                type="button"
                onClick={() => {
                  onToggleExpanded(group.topDir);
                  onSelectDir(group.topDir);
                }}
                onContextMenu={(e) => onContextMenu(e, group.topDir)}
              >
                <span className="buff-sheet-explorer-toggle damage-sheet-row-toggle">
                  {isExpanded ? '[-]' : '[+]'}
                </span>
                <span className="buff-sheet-explorer-label">
                  {group.topDir}
                  {isGroupManaged ? '' : ' ↗'}
                </span>
                <span className="buff-sheet-explorer-count">{group.totalCount}</span>
              </button>

              {isExpanded && group.subDirs.length > 0 && (
                <div className="buff-sheet-explorer-children">
                  {group.subDirs.map((sub) => {
                    const subDir = `${group.topDir}/${sub.name}`;
                    const subManaged = isManagedDir(subDir);
                    return (
                      <div className="buff-sheet-explorer-node" key={subDir}>
                        <button
                          className={`buff-sheet-explorer-child ${currentDir === subDir ? 'is-active' : ''}`}
                          type="button"
                          onClick={() => onSelectDir(subDir)}
                          onContextMenu={(e) => onContextMenu(e, subDir)}
                        >
                          <span className="buff-sheet-explorer-label">
                            {sub.name}
                            {subManaged ? '' : ' ↗'}
                          </span>
                          <span className="buff-sheet-explorer-count">{sub.count}</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="image-manager-sidebar-hint">{backendLabel}</p>
    </aside>
  );
}
