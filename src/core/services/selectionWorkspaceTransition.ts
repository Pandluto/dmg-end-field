import type { Character } from '../../types';
import type { TimelineCheckoutRef } from '../domain/timeline';
import {
  applyTimelineSnapshotPayload,
  getCurrentTimelineSnapshotPayload,
  type TimelineSnapshotPayload,
} from '../../utils/timelineSnapshotStorage';
import { setSelectedCharacterIds } from '../../utils/storage';
import { flushUserWorkspaceState } from '../../utils/userWorkspaceBridge';
import { createTimelineRepositoryClient } from '../../agentKernel/timelineRepository/localTimelineClient';
import { activateTimelineSession } from '../../agentKernel/timelineRepository/timelineSession';
import { createAiTimelineWorkNodeClient } from '../../agentKernel/timelineWorktree/localNodeClient';
import { validateTimelinePayload } from '../../agentKernel/timelineWorktree/validator';
import { createEmptyTimelineData, reconcileSelectionChange } from './timelineService';
import {
  classifySelectionWorkspaceTransition,
  resolveSelectionHorizontalParentId,
  type SelectionWorkspaceTransition,
} from './selectionWorkspacePolicy';

type SelectionTransitionActor = 'user' | 'ai';

export type ApplySelectionWorkspaceTransitionInput = {
  activeTimelineId: string;
  activeTimelineIsTemporary: boolean;
  previousCharacters: Character[];
  nextCharacters: Character[];
  actor: SelectionTransitionActor;
  nodeTitle?: string;
  nodeDescription?: string;
  approval?: {
    mode: 'manual';
    approvedBy: 'user';
    rationale?: string;
  };
};

export type ApplySelectionWorkspaceTransitionResult = {
  transition: SelectionWorkspaceTransition;
  timelineId: string;
  checkoutRef: TimelineCheckoutRef | null;
  workingPayload: TimelineSnapshotPayload | null;
  nodeId?: string;
};

function buildEmptySelectionPayload(characters: Character[]): TimelineSnapshotPayload {
  return {
    selectedCharacters: characters.map((character) => character.id),
    timelineData: createEmptyTimelineData(characters),
    skillButtonTable: {},
    allBuffList: [],
    anomalyStateSnapshots: [],
    characterInputMap: {},
    characterComputedMap: {},
    characterDisplayCacheMap: {},
    operatorConfigPageCache: {},
  };
}

function buildSelectionBranchMetadata(
  previousCharacters: Character[],
  nextCharacters: Character[],
  input: Pick<ApplySelectionWorkspaceTransitionInput, 'actor' | 'nodeTitle' | 'nodeDescription'>,
) {
  const previousNames = new Set(previousCharacters.map((character) => character.name));
  const nextNames = new Set(nextCharacters.map((character) => character.name));
  const retainedNames = nextCharacters.filter((character) => previousNames.has(character.name)).map((character) => character.name);
  const addedNames = nextCharacters.filter((character) => !previousNames.has(character.name)).map((character) => character.name);
  const removedNames = previousCharacters.filter((character) => !nextNames.has(character.name)).map((character) => character.name);
  const fallbackTitle = addedNames.length > 0 ? `调整阵容：加入${addedNames.join('、')}` : '调整阵容顺序';
  const descriptionParts = [
    retainedNames.length > 0 ? `保留${retainedNames.join('、')}` : '',
    removedNames.length > 0 ? `移出${removedNames.join('、')}` : '',
    addedNames.length > 0 ? `加入${addedNames.join('、')}` : '',
  ].filter(Boolean);
  const fallbackDescription = `${descriptionParts.join('；')}。沿用当前 SQLite，并保存为当前 checkout 的水平分支。`;

  if (input.actor === 'ai') {
    const title = input.nodeTitle?.trim() || '';
    const description = input.nodeDescription?.trim() || '';
    if (!title || !description || /^\[ai\]/i.test(title)) {
      throw new Error('AI 换人必须提供简洁的节点标题和修改描述，且标题不能使用 [ai] 固定前缀。');
    }
    return { title, description };
  }

  return {
    title: input.nodeTitle?.trim() || fallbackTitle,
    description: input.nodeDescription?.trim() || fallbackDescription,
  };
}

async function createNewTemporaryWorkspace(
  input: ApplySelectionWorkspaceTransitionInput,
): Promise<ApplySelectionWorkspaceTransitionResult> {
  const repository = createTimelineRepositoryClient();
  const createdAt = Date.now();
  const nonce = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : Math.random().toString(36).slice(2, 12);
  const timelineId = `timeline-${createdAt}-${nonce}`;
  const snapshotId = `${timelineId}-initial`;
  const documentLabel = `排轴 ${new Date(createdAt).toLocaleString('zh-CN', { hour12: false })}`;
  const payload = buildEmptySelectionPayload(input.nextCharacters);
  const imported = await repository.importDocumentBundle({
    document: { id: timelineId, label: documentLabel, isTemporary: true, createdAt },
    snapshots: [{ id: snapshotId, label: '初始排轴', createdAt, payload }],
    checkoutRef: { targetType: 'snapshot', targetId: snapshotId, updatedAt: createdAt },
  });
  const checkoutRef: TimelineCheckoutRef = {
    timelineId: imported.document.id,
    targetType: 'snapshot',
    targetId: snapshotId,
    updatedAt: createdAt,
  };

  if (input.activeTimelineIsTemporary) {
    try {
      await repository.deleteDocument(input.activeTimelineId);
    } catch (error) {
      await repository.deleteDocument(imported.document.id).catch(() => undefined);
      throw error;
    }
  }

  applyTimelineSnapshotPayload(payload);
  setSelectedCharacterIds(input.nextCharacters.map((character) => character.id));
  await flushUserWorkspaceState();
  activateTimelineSession({ document: imported.document, checkoutRef, workingPayload: payload });
  return { transition: 'new-temporary-workspace', timelineId: imported.document.id, checkoutRef, workingPayload: payload };
}

async function createHorizontalSelectionBranch(
  input: ApplySelectionWorkspaceTransitionInput,
): Promise<ApplySelectionWorkspaceTransitionResult> {
  const repository = createTimelineRepositoryClient();
  const workNodeClient = createAiTimelineWorkNodeClient();
  const [documentBundle, checkoutRef] = await Promise.all([
    repository.exportDocumentBundle(input.activeTimelineId),
    repository.getCheckoutRef(input.activeTimelineId),
  ]);
  if (!checkoutRef) throw new Error('当前 SQLite 没有权威 checkout，无法创建换人分支。');

  const checkoutNode = checkoutRef.targetType === 'work-node'
    ? documentBundle.workNodes.find((node) => node.id === checkoutRef.targetId)
    : null;
  const basePayload = checkoutRef.targetType === 'work-node'
    ? checkoutNode?.workingPayload
    : documentBundle.snapshots.find((snapshot) => snapshot.id === checkoutRef.targetId)?.payload;
  if (!basePayload) throw new Error('当前 checkout payload 不可用，请刷新工作树后重试。');

  const currentCharacterIds = input.previousCharacters.map((character) => character.id);
  if (JSON.stringify(basePayload.selectedCharacters) !== JSON.stringify(currentCharacterIds)) {
    throw new Error('当前选人状态与 SQLite checkout 不一致，请刷新到权威节点后重试。');
  }

  const previousRuntimePayload = getCurrentTimelineSnapshotPayload();
  const nextCharacterIds = input.nextCharacters.map((character) => character.id);
  let createdNodeId = '';
  let checkoutMoved = false;
  try {
    applyTimelineSnapshotPayload(basePayload);
    reconcileSelectionChange(input.previousCharacters, input.nextCharacters);
    setSelectedCharacterIds(nextCharacterIds);
    const workingPayload = getCurrentTimelineSnapshotPayload();
    if (!workingPayload) throw new Error('换人后的工作副本没有生成有效 payload。');
    const validation = validateTimelinePayload(workingPayload);
    if (!validation.ok) {
      throw new Error(`换人后的工作副本校验失败：${validation.issues.map((issue) => issue.message).join('；')}`);
    }

    const createdAt = Date.now();
    const horizontalParentId = resolveSelectionHorizontalParentId(checkoutNode?.id || null, checkoutNode?.parentNodeId);
    const metadata = buildSelectionBranchMetadata(input.previousCharacters, input.nextCharacters, input);
    const created = await workNodeClient.create({
      timelineId: input.activeTimelineId,
      parentNodeId: horizontalParentId,
      branchId: `selection-${createdAt}`,
      label: metadata.title,
      description: metadata.description,
      basePayload,
      workingPayload,
      approvalPolicy: input.actor === 'ai' ? 'manual' : 'auto-low-risk',
      riskFlags: [],
    });
    createdNodeId = created.node.id;
    const committed = await workNodeClient.commit(created.node.id, {
      label: metadata.title,
      approval: {
        mode: 'manual',
        approvedAt: createdAt,
        approvedBy: 'user',
        rationale: input.actor === 'ai'
          ? (input.approval?.rationale?.trim() || '用户批准了 AI 提议的阵容调整。')
          : '用户在选人界面确认了本次阵容调整。',
      },
    });
    const appliedAt = Date.now();
    await workNodeClient.markCheckoutApplied(created.node.id, {
      commitId: committed.commit.id,
      appliedAt,
      appliedBy: 'user',
      rationale: '选人结果已写入当前 SQLite 的水平工作节点。',
    });
    checkoutMoved = true;

    const nextCheckoutRef: TimelineCheckoutRef = {
      timelineId: input.activeTimelineId,
      targetType: 'work-node',
      targetId: created.node.id,
      updatedAt: appliedAt,
    };
    activateTimelineSession({ document: documentBundle.document, checkoutRef: nextCheckoutRef, workingPayload });
    await flushUserWorkspaceState();
    return {
      transition: 'horizontal-branch',
      timelineId: input.activeTimelineId,
      checkoutRef: nextCheckoutRef,
      workingPayload,
      nodeId: created.node.id,
    };
  } catch (error) {
    const rollbackPayload = previousRuntimePayload || basePayload;
    applyTimelineSnapshotPayload(rollbackPayload);
    setSelectedCharacterIds(currentCharacterIds);
    await flushUserWorkspaceState().catch(() => undefined);
    let rollbackError: unknown = null;
    if (checkoutMoved) {
      try {
        await repository.setCheckoutRef(checkoutRef);
        activateTimelineSession({ document: documentBundle.document, checkoutRef, workingPayload: basePayload });
      } catch (restoreError) {
        rollbackError = restoreError;
      }
    }
    if (createdNodeId && !rollbackError) await workNodeClient.delete(createdNodeId).catch(() => undefined);
    if (rollbackError) {
      const cause = error instanceof Error ? error.message : String(error);
      const rollbackCause = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      throw new Error(`${cause}；checkout 回滚失败：${rollbackCause}`);
    }
    throw error;
  }
}

export async function applySelectionWorkspaceTransition(
  input: ApplySelectionWorkspaceTransitionInput,
): Promise<ApplySelectionWorkspaceTransitionResult> {
  const transition = classifySelectionWorkspaceTransition(
    input.previousCharacters.map((character) => character.id),
    input.nextCharacters.map((character) => character.id),
  );
  if (transition === 'unchanged') {
    return {
      transition,
      timelineId: input.activeTimelineId,
      checkoutRef: null,
      workingPayload: getCurrentTimelineSnapshotPayload(),
    };
  }
  if (input.actor === 'ai' && (input.approval?.mode !== 'manual' || input.approval.approvedBy !== 'user')) {
    throw new Error('AI 选人必须取得用户手动审批后才能应用。');
  }
  return transition === 'new-temporary-workspace'
    ? createNewTemporaryWorkspace(input)
    : createHorizontalSelectionBranch(input);
}
