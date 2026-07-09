import type { MouseEvent } from 'react';
import type { WorkNodeTreeNode as WorkNodeTreeNodeModel } from './workNodeTreeTypes';

const SOURCE_LABELS: Record<WorkNodeTreeNodeModel['source'], string> = {
  'manual-checkpoint': '基线',
  'ai-turn': 'AI',
  checkout: '应用',
  restore: '回退',
  discard: '丢弃',
};

const STATUS_LABELS: Record<WorkNodeTreeNodeModel['status'], string> = {
  draft: '草稿',
  validated: '校验',
  blocked: '阻塞',
  'checked-out': '已应用',
  restored: '已回退',
  discarded: '丢弃',
};

type WorkNodeTreeNodeProps = {
  node: WorkNodeTreeNodeModel;
  activeNodeId: string;
  isRoot?: boolean;
  onSelect: (node: WorkNodeTreeNodeModel) => void;
  onDelete: (node: WorkNodeTreeNodeModel) => void;
  onAddChild: (node: WorkNodeTreeNodeModel) => void;
  onAddSibling: (node: WorkNodeTreeNodeModel) => void;
};

function formatTime(timestamp: number) {
  if (!timestamp) return '--:--';
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function compactTitle(title: string) {
  return title
    .replace(/^进入 AI 模式前\s*/i, '')
    .replace(/^\d{4}\/\d{1,2}\/\d{1,2}\s*/, '')
    .trim() || 'checkpoint';
}

function stopAction(event: MouseEvent<HTMLButtonElement>, action: () => void) {
  event.stopPropagation();
  action();
}

function DeleteIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M7 7l1 13h8l1-13" />
    </svg>
  );
}

function AddIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function BranchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 5v5a4 4 0 0 0 4 4h8" />
      <path d="M6 19v-5a4 4 0 0 1 4-4h8" />
      <path d="M15 7l3 3-3 3" />
      <path d="M15 11l3 3-3 3" />
    </svg>
  );
}

export function WorkNodeTreeNode({
  node,
  activeNodeId,
  isRoot = false,
  onSelect,
  onDelete,
  onAddChild,
  onAddSibling,
}: WorkNodeTreeNodeProps) {
  const childCount = node.children.length;
  const hasChildren = childCount > 0;
  const isActive = activeNodeId === node.nodeId;
  const childrenClassName = childCount > 1
    ? 'work-node-tree-children is-fork'
    : 'work-node-tree-children is-linear';

  return (
    <div className={`work-node-flow-node${isRoot ? ' is-root' : ''}`}>
      <article
        className={`work-node-tree-node is-${node.status}${isActive ? ' is-active' : ' is-muted'}`}
        title={`${node.title}\n${node.diffSummary}\n${node.summary}`}
        onClick={() => onSelect(node)}
      >
        <div className="work-node-tree-node-top">
          <span className="work-node-tree-source">{SOURCE_LABELS[node.source]}</span>
          <span className="work-node-tree-status">{STATUS_LABELS[node.status]}</span>
        </div>
        <strong>{compactTitle(node.title)}</strong>
        <div className="work-node-tree-meta">
          <span>{formatTime(node.createdAt)}</span>
          {childCount > 1 ? <span>{childCount} 分支</span> : null}
          {node.checkoutTouched ? <span>应用</span> : null}
          {node.riskFlags.length > 0 ? <span>{node.riskFlags.length} 风险</span> : null}
        </div>
        <div className="work-node-tree-actions" aria-label="节点操作">
          <button type="button" title="删除节点" onClick={(event) => stopAction(event, () => onDelete(node))}>
            <DeleteIcon />
          </button>
          <button type="button" title="新增子节点" onClick={(event) => stopAction(event, () => onAddChild(node))}>
            <AddIcon />
          </button>
          <button type="button" title="新增同级分支" onClick={(event) => stopAction(event, () => onAddSibling(node))}>
            <BranchIcon />
          </button>
        </div>
      </article>
      {hasChildren ? (
        <div className={childrenClassName}>
          {node.children.map((child) => (
            <WorkNodeTreeNode
              key={child.nodeId}
              node={child}
              activeNodeId={activeNodeId}
              onSelect={onSelect}
              onDelete={onDelete}
              onAddChild={onAddChild}
              onAddSibling={onAddSibling}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
