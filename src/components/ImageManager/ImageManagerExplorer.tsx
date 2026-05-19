import type { TreeNode } from './types';

interface ImageManagerExplorerProps {
  dirTree: TreeNode[];
  currentDir: string;
  expandedDirs: Set<string>;
  totalCount: number;
  backendLabel: string;
  onSelectDir: (dir: string) => void;
  onToggleExpanded: (dir: string) => void;
  onContextMenu: (e: React.MouseEvent, dir: string) => void;
  footer?: React.ReactNode;
}

function TreeNodeRow({
  node,
  depth,
  currentDir,
  expandedDirs,
  onSelectDir,
  onToggleExpanded,
  onContextMenu,
}: {
  node: TreeNode;
  depth: number;
  currentDir: string;
  expandedDirs: Set<string>;
  onSelectDir: (dir: string) => void;
  onToggleExpanded: (dir: string) => void;
  onContextMenu: (e: React.MouseEvent, dir: string) => void;
}) {
  const isExpanded = expandedDirs.has(node.path);
  const isActive = currentDir === node.path;
  const hasChildren = node.children.length > 0;

  return (
    <div className="buff-sheet-explorer-node">
      <button
        className={`buff-sheet-explorer-row ${isActive ? 'is-active' : ''}`}
        type="button"
        style={{ paddingLeft: 4 + depth * 14 }}
        onClick={() => {
          if (hasChildren) onToggleExpanded(node.path);
          onSelectDir(node.path);
        }}
        onContextMenu={(e) => onContextMenu(e, node.path)}
      >
        {hasChildren ? (
          <span className="buff-sheet-explorer-toggle damage-sheet-row-toggle">
            {isExpanded ? '[-]' : '[+]'}
          </span>
        ) : (
          <span className="buff-sheet-explorer-toggle damage-sheet-row-toggle" style={{ visibility: 'hidden' }}>
            [·]
          </span>
        )}
        <span className="buff-sheet-explorer-label">
          {node.name}
          {node.isManaged ? '' : ' ↗'}
        </span>
        <span className="buff-sheet-explorer-count">{node.count}</span>
      </button>

      {isExpanded && hasChildren && (
        <div className="buff-sheet-explorer-children">
          {node.children.map((child) => (
            <TreeNodeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              currentDir={currentDir}
              expandedDirs={expandedDirs}
              onSelectDir={onSelectDir}
              onToggleExpanded={onToggleExpanded}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ImageManagerExplorer(props: ImageManagerExplorerProps) {
  const { dirTree, currentDir, expandedDirs, totalCount, backendLabel, onSelectDir, onToggleExpanded, onContextMenu, footer } = props;

  return (
    <aside className="damage-sheet-sidebar buff-sheet-explorer">
      <div className="damage-sheet-sidebar-title">资源管理器</div>

      <div className="buff-sheet-explorer-tree">
        {/* All images root */}
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

        {/* Recursive tree */}
        {dirTree.map((node) => (
          <TreeNodeRow
            key={node.path}
            node={node}
            depth={0}
            currentDir={currentDir}
            expandedDirs={expandedDirs}
            onSelectDir={onSelectDir}
            onToggleExpanded={onToggleExpanded}
            onContextMenu={onContextMenu}
          />
        ))}
      </div>

      <p className="image-manager-sidebar-hint">{backendLabel}</p>
      {footer}
    </aside>
  );
}
