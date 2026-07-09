import { useEffect, useMemo, useState } from 'react';
import { createAiTimelineWorkNodeClient, probeAiTimelineWorkNodeRuntime } from '../../agentKernel/timelineWorktree/localNodeClient';
import type { AiTimelineWorkNode, AiTimelineWorkNodeCommit } from '../../agentKernel/timelineWorktree/types';
import { getLocalAgentHealth } from '../../utils/localAgent';
import { buildWorkNodeTreeViewModel } from './workNodeTreeModel';
import { WorkNodeTreeNode } from './WorkNodeTreeNode';
import type { WorkNodeTreeViewModel } from './workNodeTreeTypes';
import './WorkNodeTreePanel.css';

type WorkNodeTreePanelProps = {
  refreshKey: number;
  onSummaryChange?: (summary: WorkNodeTreeViewModel) => void;
};

async function ensureWorkNodeReadRuntime() {
  if (typeof window !== 'undefined' && window.desktopRuntime?.listAiTimelineWorkNodes) return;
  await getLocalAgentHealth();
}

export function WorkNodeTreePanel({ refreshKey, onSummaryChange }: WorkNodeTreePanelProps) {
  const [nodes, setNodes] = useState<AiTimelineWorkNode[]>([]);
  const [commits, setCommits] = useState<AiTimelineWorkNodeCommit[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const viewModel = useMemo(() => buildWorkNodeTreeViewModel(nodes, commits), [nodes, commits]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        await ensureWorkNodeReadRuntime();
        await probeAiTimelineWorkNodeRuntime();
        const response = await createAiTimelineWorkNodeClient().list();
        if (cancelled) return;
        setNodes(response.nodes || []);
        setCommits(response.commits || []);
        setError('');
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    setLoading(true);
    void load();
    const timer = window.setInterval(() => void load(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refreshKey]);

  useEffect(() => {
    onSummaryChange?.(viewModel);
  }, [onSummaryChange, viewModel]);

  return (
    <aside className="work-node-tree-panel" aria-label="Work node 节点树">
      <header>
        <strong>Work Node</strong>
        <span>{viewModel.nodeCount} 节点 / {viewModel.riskCount} 风险</span>
      </header>
      {error ? <div className="work-node-tree-empty">读取归档失败：{error}</div> : null}
      {!error && loading && viewModel.nodeCount === 0 ? <div className="work-node-tree-empty">正在读取节点</div> : null}
      {!error && !loading && viewModel.nodeCount === 0 ? <div className="work-node-tree-empty">暂无可见节点</div> : null}
      <div className="work-node-tree-list">
        <div className="work-node-flow-canvas">
          {viewModel.nodes.map((node) => (
            <WorkNodeTreeNode key={node.nodeId} node={node} isRoot />
          ))}
        </div>
      </div>
    </aside>
  );
}
