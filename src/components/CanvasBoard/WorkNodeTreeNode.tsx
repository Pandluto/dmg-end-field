import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, MouseEvent } from 'react';
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
  x: number;
  y: number;
  onSelect: (node: WorkNodeTreeNodeModel) => void;
  onDelete: (node: WorkNodeTreeNodeModel) => void;
  onAddChild: (node: WorkNodeTreeNodeModel) => void;
  onAddSibling: (node: WorkNodeTreeNodeModel) => void;
  onRename: (node: WorkNodeTreeNodeModel, title: string) => Promise<void>;
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
  x,
  y,
  onSelect,
  onDelete,
  onAddChild,
  onAddSibling,
  onRename,
}: WorkNodeTreeNodeProps) {
  const childCount = node.children.length;
  const [isRenaming, setIsRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState(node.title);
  const [showDetails, setShowDetails] = useState(false);
  const clickTimerRef = useRef<number | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const isActive = activeNodeId === node.nodeId;
  const isInActivePath = activePathNodeIds.has(node.nodeId);
  const canDelete = !isInActivePath;
  const pathClassName = isActive ? ' is-active' : isInActivePath ? ' is-path' : ' is-muted';
  useEffect(() => () => {
    if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current);
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
  }, []);

  const scheduleDetails = () => {
    if (!node.parentNodeId || hoverTimerRef.current !== null) return;
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null;
      setShowDetails(true);
    }, 550);
  };

  const hideDetails = () => {
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
    setShowDetails(false);
  };

  const selectNode = () => {
    if (isRenaming) return;
    if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current);
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null;
      onSelect(node);
    }, 220);
  };

  const startRename = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current);
    clickTimerRef.current = null;
    setTitleDraft(node.title);
    setIsRenaming(true);
  };

  const saveRename = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextTitle = titleDraft.trim();
    if (!nextTitle || nextTitle === node.title) {
      setIsRenaming(false);
      return;
    }
    await onRename(node, nextTitle);
    setIsRenaming(false);
  };
  return (
    <article
      className="work-node-tree-node-shell"
      style={{ left: x, top: y } as CSSProperties}
      onPointerEnter={scheduleDetails}
      onPointerLeave={hideDetails}
    >
        <div
          className={`work-node-tree-node is-${node.status}${pathClassName}`}
          title={`${node.title}\n${node.diffSummary}\n${node.summary}`}
          onClick={selectNode}
        >
          <div className="work-node-tree-node-top">
            <span className="work-node-tree-source">{SOURCE_LABELS[node.source]}</span>
            <span className="work-node-tree-status">{STATUS_LABELS[node.status]}</span>
          </div>
          {isRenaming ? (
            <form className="work-node-tree-title-form" onSubmit={(event) => void saveRename(event)}>
              <input
                autoFocus
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={() => setIsRenaming(false)}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setIsRenaming(false);
                }}
                aria-label="节点名称"
              />
            </form>
          ) : (
            <strong title="双击重命名" onDoubleClick={startRename}>{compactTitle(node.title)}</strong>
          )}
          <div className="work-node-tree-meta">
            <span>{formatTime(node.createdAt)}</span>
            <span>{node.buttonCount} 按钮</span>
            <span>{node.buffCount} Buff</span>
            {childCount > 1 ? <span>{childCount} 分支</span> : null}
            {node.riskFlags.length > 0 ? <span>{node.riskFlags.length} 风险</span> : null}
          </div>
        </div>
        {showDetails ? (
          <div className="work-node-tree-hover-card" role="tooltip">
            <strong>{node.title}</strong>
            <span>{node.description || '暂无描述'}</span>
          </div>
        ) : null}
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
  );
}
