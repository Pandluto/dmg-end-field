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
  isElectron: boolean;
  onSelectDir: (dir: string) => void;
  onToggleExpanded: (topDir: string) => void;
}

export function ImageManagerExplorer(props: ImageManagerExplorerProps) {
  const { dirTree, currentDir, expandedDirs, totalCount, isElectron, onSelectDir, onToggleExpanded } = props;

  return (
    <aside className="damage-sheet-sidebar buff-sheet-explorer">
      <div className="damage-sheet-sidebar-title">资源管理器</div>

      <div className="buff-sheet-explorer-tree">
        {/* All images root node */}
        <div className="buff-sheet-explorer-node">
          <button
            className={`buff-sheet-explorer-row ${currentDir === '' ? 'is-active' : ''}`}
            type="button"
            onClick={() => onSelectDir('')}
          >
            <span className="buff-sheet-explorer-label">全部图片</span>
            <span className="buff-sheet-explorer-count">{totalCount}</span>
          </button>
        </div>

        {/* Directory groups */}
        {dirTree.map((group) => {
          const isExpanded = expandedDirs.has(group.topDir);
          const isGroupActive = currentDir === group.topDir || currentDir.startsWith(group.topDir + '/');

          return (
            <div className="buff-sheet-explorer-node" key={group.topDir}>
              <button
                className={`buff-sheet-explorer-row ${isGroupActive ? 'is-active' : ''}`}
                type="button"
                onClick={() => {
                  onToggleExpanded(group.topDir);
                  onSelectDir(group.topDir);
                }}
              >
                <span className="buff-sheet-explorer-toggle damage-sheet-row-toggle">
                  {isExpanded ? '[-]' : '[+]'}
                </span>
                <span className="buff-sheet-explorer-label">{group.topDir}</span>
                <span className="buff-sheet-explorer-count">{group.totalCount}</span>
              </button>

              {isExpanded && group.subDirs.length > 0 && (
                <div className="buff-sheet-explorer-children">
                  {group.subDirs.map((sub) => {
                    const subDir = `${group.topDir}/${sub.name}`;
                    return (
                      <div className="buff-sheet-explorer-node" key={subDir}>
                        <button
                          className={`buff-sheet-explorer-child ${currentDir === subDir ? 'is-active' : ''}`}
                          type="button"
                          onClick={() => onSelectDir(subDir)}
                        >
                          <span className="buff-sheet-explorer-label">{sub.name}</span>
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

      {!isElectron && (
        <p className="image-manager-sidebar-hint">浏览器模式 · 写操作仅桌面端可用</p>
      )}
    </aside>
  );
}
