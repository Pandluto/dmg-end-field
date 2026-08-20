import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, MouseEvent } from 'react';
import type { WorkNodeTreeNode as WorkNodeTreeNodeModel } from './workNodeTreeTypes';

const SOURCE_LABELS: Record<WorkNodeTreeNodeModel['source'], string> = {
  'manual-checkpoint': '基线',
  edit: '编辑',
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
  isOmissionMode: boolean;
  isOmissionSelected: boolean;
  canOmit: boolean;
  omitDisabledReason?: string;
  x: number;
  y: number;
  onSelect: (node: WorkNodeTreeNodeModel) => void;
  onDeleteSubtree: (node: WorkNodeTreeNodeModel) => void;
  onOmit: (node: WorkNodeTreeNodeModel) => void;
  onAddChild: (node: WorkNodeTreeNodeModel) => void;
  onAddSibling: (node: WorkNodeTreeNodeModel) => void;
  onForkAsSqlite: (node: WorkNodeTreeNodeModel) => void;
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
    .replace(/^手动检查点\s*/i, '')
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

function DatabaseForkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <ellipse cx="9" cy="5" rx="5" ry="2.5" />
      <path d="M4 5v8c0 1.4 2.2 2.5 5 2.5" />
      <path d="M14 5v5" />
      <path d="M13 14h7" />
      <path d="M17 11l3 3-3 3" />
      <path d="M4 9c0 1.4 2.2 2.5 5 2.5 1.2 0 2.3-.2 3.1-.6" />
    </svg>
  );
}

export function WorkNodeTreeNode({
  node,
  activeNodeId,
  activePathNodeIds,
  isOmissionMode,
  isOmissionSelected,
  canOmit,
  omitDisabledReason,
  x,
  y,
  onSelect,
  onDeleteSubtree,
  onOmit,
  onAddChild,
  onAddSibling,
  onForkAsSqlite,
  onRename,
}: WorkNodeTreeNodeProps) {
  const childCount = node.children.length;
  const [isRenaming, setIsRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState(node.title);
  const [showDetails, setShowDetails] = useState(false);
  const [showDeleteChoices, setShowDeleteChoices] = useState(false);
  const clickTimerRef = useRef<number | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const isActive = activeNodeId === node.nodeId;
  const isInActivePath = activePathNodeIds.has(node.nodeId);
  const pathClassName = isActive ? ' is-active' : isInActivePath ? ' is-path' : ' is-muted';
  const omissionClassName = isOmissionSelected ? ' is-omission-selected' : '';
  useEffect(() => () => {
    if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current);
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
  }, []);

  const scheduleDetails = () => {
    if (hoverTimerRef.current !== null) return;
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null;
      setShowDetails(true);
    }, 420);
  };

  const hideDetails = () => {
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
    setShowDetails(false);
    setShowDeleteChoices(false);
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
    if (isOmissionMode) return;
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
      data-work-node-id={node.nodeId}
      style={{ left: x, top: y } as CSSProperties}
      onPointerEnter={scheduleDetails}
      onPointerLeave={hideDetails}
    >
        <div
          className={`work-node-tree-node is-${node.status}${pathClassName}${omissionClassName}${isOmissionMode ? ' is-omission-mode' : ''}`}
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
            <strong aria-label={`${node.title}，双击重命名`} onDoubleClick={startRename}>{compactTitle(node.title)}</strong>
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
        {!isOmissionMode ? (
          <>
            <div className="work-node-tree-actions" aria-label="节点操作">
              <button
                type="button"
                title="删除或省略节点"
                aria-expanded={showDeleteChoices}
                onClick={(event) => stopAction(event, () => setShowDeleteChoices((current) => !current))}
              >
                <DeleteIcon />
              </button>
              <button type="button" title="新增子节点" onClick={(event) => stopAction(event, () => onAddChild(node))}>
                <AddIcon />
              </button>
              <button type="button" title="新增同级分支" onClick={(event) => stopAction(event, () => onAddSibling(node))}>
                <BranchIcon />
              </button>
              <button
                type="button"
                className="work-node-tree-sqlite-action"
                title="以此节点新建 SQLite"
                aria-label="以此节点新建 SQLite"
                data-tooltip="另存为 SQLite"
                onClick={(event) => stopAction(event, () => onForkAsSqlite(node))}
              >
                <DatabaseForkIcon />
              </button>
            </div>
            {showDeleteChoices ? (
              <div className="work-node-tree-delete-choices" role="menu" aria-label="删除方式">
                <button type="button" role="menuitem" onClick={(event) => stopAction(event, () => onDeleteSubtree(node))}>
                  <strong>删除以下路径</strong>
                  <span>删除节点及全部子节点</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!canOmit}
                  title={canOmit ? '删除当前节点并保留后续路径' : omitDisabledReason}
                  onClick={(event) => stopAction(event, () => canOmit && onOmit(node))}
                >
                  <strong>省略当前节点</strong>
                  <span>{canOmit ? '保留后续节点并重新接线' : omitDisabledReason}</span>
                </button>
              </div>
            ) : null}
          </>
        ) : null}
    </article>
  );
}
