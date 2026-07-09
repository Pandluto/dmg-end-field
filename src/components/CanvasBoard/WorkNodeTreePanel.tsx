import { useEffect, useMemo, useState } from 'react';
import { createAiTimelineWorkNodeClient, probeAiTimelineWorkNodeRuntime } from '../../agentKernel/timelineWorktree/localNodeClient';
import type { AiTimelineWorkNode, AiTimelineWorkNodeCommit } from '../../agentKernel/timelineWorktree/types';
import { getLocalAgentHealth, requestOpenAiCliRest } from '../../utils/localAgent';
import {
  MAIN_WORKBENCH_CONTROL_EVENT,
  readMainWorkbenchCommandQueue,
  type MainWorkbenchCommand,
  type QueuedMainWorkbenchCommand,
} from '../../utils/mainWorkbenchControl';
import { buildWorkNodeTreeViewModel } from './workNodeTreeModel';
import { WorkNodeTreeNode } from './WorkNodeTreeNode';
import type { WorkNodeTreeViewModel } from './workNodeTreeTypes';
import './WorkNodeTreePanel.css';

type WorkNodeTreePanelProps = {
  refreshKey: number;
  onSummaryChange?: (summary: WorkNodeTreeViewModel) => void;
};

type WorkNodeQueueItem = {
  id: string;
  label: string;
  status: QueuedMainWorkbenchCommand['status'];
  source: string;
  createdAt: number;
  updatedAt: number;
  nodeId?: string;
  error?: string;
};

const WORK_NODE_COMMAND_OPS = new Set<MainWorkbenchCommand['op']>([
  'createAiTimelineWorkNodeFromCurrent',
  'diffAiTimelineWorkNode',
  'patchAiTimelineWorkNode',
  'patchAndValidateAiTimelineWorkNode',
  'checkoutAiTimelineWorkNode',
  'restoreAiTimelineWorkNodeBase',
]);

async function ensureWorkNodeReadRuntime() {
  if (typeof window !== 'undefined' && window.desktopRuntime?.listAiTimelineWorkNodes) return;
  const health = await getLocalAgentHealth();
  if (!health.aiCliRest?.running) {
    await requestOpenAiCliRest();
  }
}

function readStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object' || !(key in value)) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' && field.trim() ? field : undefined;
}

function formatQueueTime(value: number): string {
  if (!Number.isFinite(value)) return '';
  return new Date(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function getCommandLabel(entry: QueuedMainWorkbenchCommand): string {
  const command = entry.command;
  const resultNodeId = readStringField(entry.result, 'nodeId');
  const label = readStringField(command, 'label');
  const nodeId = readStringField(command, 'nodeId') || resultNodeId;
  if (label) return label;
  if (nodeId) return `${command.op} ${nodeId}`;
  return command.op;
}

function buildWorkNodeQueueItems(): WorkNodeQueueItem[] {
  return readMainWorkbenchCommandQueue()
    .filter((entry) => WORK_NODE_COMMAND_OPS.has(entry.command.op))
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, 12)
    .map((entry) => ({
      id: entry.id,
      label: getCommandLabel(entry),
      status: entry.status,
      source: entry.source,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      nodeId: readStringField(entry.command, 'nodeId') || readStringField(entry.result, 'nodeId'),
      error: entry.error,
    }));
}

export function WorkNodeTreePanel({ refreshKey, onSummaryChange }: WorkNodeTreePanelProps) {
  const [nodes, setNodes] = useState<AiTimelineWorkNode[]>([]);
  const [commits, setCommits] = useState<AiTimelineWorkNodeCommit[]>([]);
  const [queueItems, setQueueItems] = useState<WorkNodeQueueItem[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const viewModel = useMemo(() => buildWorkNodeTreeViewModel(nodes, commits), [nodes, commits]);

  useEffect(() => {
    const refreshQueue = () => setQueueItems(buildWorkNodeQueueItems());
    refreshQueue();
    window.addEventListener(MAIN_WORKBENCH_CONTROL_EVENT, refreshQueue);
    const timer = window.setInterval(refreshQueue, 1500);
    return () => {
      window.removeEventListener(MAIN_WORKBENCH_CONTROL_EVENT, refreshQueue);
      window.clearInterval(timer);
    };
  }, [refreshKey]);

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
      {queueItems.length > 0 ? (
        <section className="work-node-tree-queue" aria-label="Work node 命令队列">
          <div className="work-node-tree-section-title">命令队列</div>
          {queueItems.map((item) => (
            <article key={item.id} className={`work-node-tree-queue-item is-${item.status}`}>
              <div className="work-node-tree-queue-head">
                <strong>{item.label}</strong>
                <span>{item.status}</span>
              </div>
              <div className="work-node-tree-queue-meta">
                <span>{item.source}</span>
                <span>{formatQueueTime(item.updatedAt || item.createdAt)}</span>
                {item.nodeId ? <span>{item.nodeId}</span> : null}
              </div>
              {item.error ? <small>{item.error}</small> : null}
            </article>
          ))}
        </section>
      ) : null}
      {error ? <div className="work-node-tree-empty">读取归档失败：{error}</div> : null}
      {!error && loading && viewModel.nodeCount === 0 ? <div className="work-node-tree-empty">正在读取节点</div> : null}
      {!error && !loading && viewModel.nodeCount === 0 && queueItems.length === 0 ? (
        <div className="work-node-tree-empty">暂无可见节点</div>
      ) : null}
      <div className="work-node-tree-list">
        {viewModel.nodes.map((node) => (
          <WorkNodeTreeNode key={node.nodeId} node={node} />
        ))}
      </div>
    </aside>
  );
}
