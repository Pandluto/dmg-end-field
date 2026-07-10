import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
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
  activePathNodeIds: Set<string>;
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
  activePathNodeIds,
  isRoot = false,
  onSelect,
  onDelete,
  onAddChild,
  onAddSibling,
}: WorkNodeTreeNodeProps) {
  const nodeShellRef = useRef<HTMLElement>(null);
  const childrenRef = useRef<HTMLDivElement>(null);
  const [nodeOffset, setNodeOffset] = useState(0);
  const childCount = node.children.length;
  const hasChildren = childCount > 0;
  const isActive = activeNodeId === node.nodeId;
  const isInActivePath = activePathNodeIds.has(node.nodeId);
  const canDelete = !isInActivePath;
  const pathClassName = isActive ? ' is-active' : isInActivePath ? ' is-path' : ' is-muted';
  const childrenClassName = childCount > 1
    ? 'work-node-tree-children is-fork'
    : 'work-node-tree-children is-linear';

  useLayoutEffect(() => {
    const childrenElement = childrenRef.current;
    const parentElement = nodeShellRef.current;
    if (!childrenElement || !parentElement || childCount < 2) {
      setNodeOffset((current) => (current === 0 ? current : 0));
      return;
    }

    const childShells = Array.from(childrenElement.children)
      .map((child) => child.querySelector<HTMLElement>(':scope > .work-node-tree-node-shell'))
      .filter((shell): shell is HTMLElement => Boolean(shell));
    if (childShells.length < 2) return;

    const containerRect = childrenElement.getBoundingClientRect();
    const centers = childShells.map((shell) => {
      const rect = shell.getBoundingClientRect();
      return rect.left + rect.width / 2 - containerRect.left;
    });
    const left = centers[0];
    const right = centers[centers.length - 1];
    const middle = (left + right) / 2;
    const parentRect = parentElement.getBoundingClientRect();
    const parentCenter = parentRect.left + parentRect.width / 2 - containerRect.left;
    childrenElement.style.setProperty('--branch-left', `${left}px`);
    childrenElement.style.setProperty('--branch-width', `${right - left}px`);
    childrenElement.style.setProperty('--branch-middle', `${middle}px`);
    const nextOffset = middle - parentCenter;
    setNodeOffset((current) => Math.abs(current - nextOffset) < 0.5 ? current : nextOffset);
  }, [childCount, node.children]);

  return (
    <div
      className={`work-node-flow-node${isRoot ? ' is-root' : ''}`}
      style={nodeOffset ? { '--node-offset': `${nodeOffset}px` } as CSSProperties : undefined}
    >
      <article
        ref={nodeShellRef}
        className="work-node-tree-node-shell"
        style={nodeOffset ? { transform: `translateX(${nodeOffset}px)` } : undefined}
      >
        <div
          className={`work-node-tree-node is-${node.status}${pathClassName}`}
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
        </div>
        <div className="work-node-tree-actions" aria-label="节点操作">
          <button
            type="button"
            title={canDelete ? '删除节点及其子树' : '当前路径节点不能删除'}
            disabled={!canDelete}
            onClick={(event) => stopAction(event, () => canDelete && onDelete(node))}
          >
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
        <div ref={childrenRef} className={childrenClassName}>
          {node.children.map((child) => (
            <WorkNodeTreeNode
              key={child.nodeId}
              node={child}
              activeNodeId={activeNodeId}
              activePathNodeIds={activePathNodeIds}
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
