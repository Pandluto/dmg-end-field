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

export function WorkNodeTreeNode({ node, isRoot = false }: { node: WorkNodeTreeNodeModel; isRoot?: boolean }) {
  const childCount = node.children.length;
  const hasChildren = childCount > 0;
  const childrenClassName = childCount > 1
    ? 'work-node-tree-children is-fork'
    : 'work-node-tree-children is-linear';

  return (
    <div className={`work-node-flow-node${isRoot ? ' is-root' : ''}`}>
      <article className={`work-node-tree-node is-${node.status}`}>
        <div className="work-node-tree-node-header">
          <span className="work-node-tree-source">{SOURCE_LABELS[node.source]}</span>
          <span className="work-node-tree-status">{STATUS_LABELS[node.status]}</span>
        </div>
        <strong title={node.nodeId}>{node.title}</strong>
        <div className="work-node-tree-meta">
          <span>{formatTime(node.createdAt)}</span>
          <span>{node.nodeId.slice(0, 8)}</span>
          {node.parentNodeId ? <span>父 {node.parentNodeId.slice(0, 8)}</span> : <span>根</span>}
          {childCount > 1 ? <span>{childCount} 分支</span> : null}
          {node.checkoutTouched ? <span>已应用到当前排轴</span> : <span>未应用到当前排轴</span>}
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
        <div className={childrenClassName}>
          {node.children.map((child) => (
            <WorkNodeTreeNode key={child.nodeId} node={child} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
