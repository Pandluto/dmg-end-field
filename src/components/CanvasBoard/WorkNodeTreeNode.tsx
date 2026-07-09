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

export function WorkNodeTreeNode({ node, isRoot = false }: { node: WorkNodeTreeNodeModel; isRoot?: boolean }) {
  const childCount = node.children.length;
  const hasChildren = childCount > 0;
  const childrenClassName = childCount > 1
    ? 'work-node-tree-children is-fork'
    : 'work-node-tree-children is-linear';

  return (
    <div className={`work-node-flow-node${isRoot ? ' is-root' : ''}`}>
      <article
        className={`work-node-tree-node is-${node.status}`}
        title={`${node.title}\n${node.diffSummary}\n${node.summary}`}
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
