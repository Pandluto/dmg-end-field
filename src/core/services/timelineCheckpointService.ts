import { createTimelineRepositoryClient } from '../../agentKernel/timelineRepository/localTimelineClient';
import { activateTimelineSession } from '../../agentKernel/timelineRepository/timelineSession';
import { createAiTimelineWorkNodeClient } from '../../agentKernel/timelineWorktree/localNodeClient';
import { validateTimelinePayload } from '../../agentKernel/timelineWorktree/validator';
import type { TimelineCheckoutRef } from '../domain/timeline';
import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';
import { flushUserWorkspaceState } from '../../utils/userWorkspaceBridge';

/**
 * Checkpoint 只记录内容变化；createdAt / updatedAt 的落盘噪声不应制造重复节点。
 */
function serializeCheckpointPayload(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(serializeCheckpointPayload).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.entries(value)
    .filter(([key]) => key !== 'createdAt' && key !== 'updatedAt')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${serializeCheckpointPayload(entry)}`)
    .join(',')}}`;
}

export function hasTimelineCheckpointPayloadChanged(
  previousPayload: TimelineSnapshotPayload,
  nextPayload: TimelineSnapshotPayload,
): boolean {
  return serializeCheckpointPayload(previousPayload) !== serializeCheckpointPayload(nextPayload);
}

export type TimelineCheckpointResult = {
  status: 'saved' | 'unchanged';
  checkoutRef: TimelineCheckoutRef | null;
  nodeId?: string;
  hasParent: boolean;
};

/**
 * 在没有前台 Canvas 的场景保存当前工作区，例如选人页切换队伍或新建存档。
 * 前台 Canvas 仍负责自己的可见性校验；两条路径共享同一份去重规则。
 */
export async function saveTimelineCheckpoint(input: {
  timelineId: string;
  timelineLabel: string;
  payload: TimelineSnapshotPayload;
  reason: string;
}): Promise<TimelineCheckpointResult> {
  const validation = validateTimelinePayload(input.payload);
  if (!validation.ok) {
    throw new Error(`当前排轴无法保存：${validation.issues.map((issue) => issue.message).join('；')}`);
  }

  await flushUserWorkspaceState();
  const repository = createTimelineRepositoryClient();
  const existingDocument = (await repository.listDocuments())
    .find((document) => document.id === input.timelineId);
  const document = existingDocument || await repository.ensureDocument({
    id: input.timelineId,
    label: input.timelineLabel,
  });
  const [documentBundle, checkoutRef] = await Promise.all([
    repository.exportDocumentBundle(input.timelineId),
    repository.getCheckoutRef(input.timelineId),
  ]);
  const nodes = documentBundle.workNodes;
  const checkoutNode = checkoutRef?.targetType === 'work-node'
    ? nodes.find((node) => node.id === checkoutRef.targetId)
    : undefined;
  const checkoutPayload = checkoutRef?.targetType === 'work-node'
    ? checkoutNode?.workingPayload
    : checkoutRef?.targetType === 'snapshot'
      ? documentBundle.snapshots.find((snapshot) => snapshot.id === checkoutRef.targetId)?.payload
      : undefined;

  if (
    nodes.length > 0
    && checkoutPayload
    && !hasTimelineCheckpointPayloadChanged(checkoutPayload, input.payload)
  ) {
    return {
      status: 'unchanged',
      checkoutRef,
      hasParent: Boolean(checkoutNode),
    };
  }

  const baselineParent = [...nodes]
    .filter((node) => !node.parentNodeId)
    .sort((left, right) => left.createdAt - right.createdAt)[0];
  const latestParent = [...nodes].sort((left, right) => right.updatedAt - left.updatedAt)[0];
  const parent = checkoutNode || baselineParent || latestParent;
  const createdAt = Date.now();
  const workNodeClient = createAiTimelineWorkNodeClient();
  let createdNodeId = '';
  let checkoutApplied = false;

  try {
    const created = await workNodeClient.create({
      timelineId: input.timelineId,
      ...(parent ? { parentNodeId: parent.id } : { parentNodeId: null }),
      branchId: `automatic-save-${createdAt}`,
      label: parent
        ? `[auto-save] ${new Date(createdAt).toLocaleString('zh-CN', { hour12: false })}`
        : `[auto-save] ${input.timelineLabel} ${new Date(createdAt).toLocaleString('zh-CN', { hour12: false })}`,
      description: input.reason,
      basePayload: parent?.workingPayload || input.payload,
      workingPayload: input.payload,
      approvalPolicy: 'auto-low-risk',
      riskFlags: [],
    });
    createdNodeId = created.node.id;
    const committed = await workNodeClient.commit(created.node.id, {
      label: `Checkout ${created.node.label}`,
      approval: {
        mode: 'manual',
        approvedAt: createdAt,
        approvedBy: 'user',
        rationale: input.reason,
      },
    });
    const appliedAt = Date.now();
    await workNodeClient.markCheckoutApplied(created.node.id, {
      commitId: committed.commit.id,
      appliedAt,
      appliedBy: 'user',
      rationale: input.reason,
    });
    checkoutApplied = true;

    const nextCheckoutRef: TimelineCheckoutRef = {
      timelineId: input.timelineId,
      targetType: 'work-node',
      targetId: created.node.id,
      updatedAt: appliedAt,
    };
    activateTimelineSession({
      document,
      checkoutRef: nextCheckoutRef,
      workingPayload: input.payload,
    });
    return {
      status: 'saved',
      checkoutRef: nextCheckoutRef,
      nodeId: created.node.id,
      hasParent: Boolean(parent),
    };
  } catch (error) {
    if (createdNodeId && !checkoutApplied) {
      await workNodeClient.delete(createdNodeId).catch(() => undefined);
    }
    throw error;
  }
}
