import type { CSSProperties } from 'react';
import type { WorkNodeTreeNode as WorkNodeTreeNodeModel } from './workNodeTreeTypes';

const SOURCE_LABELS: Record<WorkNodeTreeNodeModel['source'], string> = {
  'manual-checkpoint': '人工基线',
  'ai-turn': 'AI 对话',
  checkout: '应用',
  restore: '回退',
  discard: '丢弃',
};

const STATUS_LABELS: Record<WorkNodeTreeNodeModel['status'], string> = {
  draft: '草稿',
  validated: '已校验',
  blocked: '阻塞',
  'checked-out': '已应用',
  restored: '已回退',
  discarded: '已丢弃',
};

function formatTime(timestamp: number) {
  if (!timestamp) return '未知时间';
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function WorkNodeTreeNode({
  node,
  depth = 0,
}: {
  node: WorkNodeTreeNodeModel;
  depth?: number;
}) {
  const hasChildren = node.children.length > 0;

  const branchClassName = depth === 0
    ? 'work-node-tree-branch is-root'
    : 'work-node-tree-branch';

  return (
    <div className={branchClassName} style={{ '--work-node-depth': depth } as CSSProperties}>
      <article className={`work-node-tree-node is-${node.status}`}>
        <div className="work-node-tree-node-header">
          <span className="work-node-tree-source">{SOURCE_LABELS[node.source]}</span>
          <span className="work-node-tree-status">{STATUS_LABELS[node.status]}</span>
        </div>
        <strong title={node.nodeId}>{node.title}</strong>
        <div className="work-node-tree-meta">
          <span>{formatTime(node.createdAt)}</span>
          <span>{node.nodeId.slice(0, 8)}</span>
          {node.parentNodeId ? <span>父节点 {node.parentNodeId.slice(0, 8)}</span> : <span>根节点</span>}
          {hasChildren ? <span>{node.children.length} 分支</span> : null}
          {node.checkoutTouched ? <span>已触碰当前排轴</span> : <span>未触碰当前排轴</span>}
        </div>
        <p>{node.diffSummary}</p>
        <small>{node.summary}</small>
        {node.riskFlags.length > 0 && (
          <div className="work-node-tree-risks">
            {node.riskFlags.slice(0, 3).map((risk) => (
              <span key={risk}>{risk}</span>
            ))}
          </div>
        )}
      </article>
      {hasChildren ? (
        <div className="work-node-tree-children">
          {node.children.map((child) => (
            <WorkNodeTreeNode key={child.nodeId} node={child} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
