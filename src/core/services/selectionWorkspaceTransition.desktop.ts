import type { Character } from '../../types';
import type { TimelineCheckoutRef, TimelineDocument } from '../domain/timeline';
import {
  applyTimelineSnapshotPayload,
  getCurrentTimelineSnapshotPayload,
  type TimelineSnapshotPayload,
} from '../../utils/timelineSnapshotStorage';
import { getSelectedCharacterIds, setSelectedCharacterIds } from '../../utils/storage';
import { flushUserWorkspaceState } from '../../utils/userWorkspaceBridge';
import { createTimelineRepositoryClient } from '../../agentKernel/timelineRepository/localTimelineClient';
import {
  activateTimelineSession,
  getTimelineSessionSnapshot,
  refreshTimelineSessionDocument,
} from '../../agentKernel/timelineRepository/timelineSession';
import { createAiTimelineWorkNodeClient } from '../../agentKernel/timelineWorktree/localNodeClient';
import { validateTimelinePayload } from '../../agentKernel/timelineWorktree/validator';
import { buildAiTimelineNodeReviewProjection } from '../../agentKernel/timelineWorktree/nodeReview';
import { createEmptyTimelineData, reconcileSelectionChange } from './timelineService';
import { saveTimelineCheckpoint } from './timelineCheckpointService';
import {
  buildPreparedSelectionPayload,
  resolvePreparedSelectionRoster,
  type PreparedSelectionRosterRequest,
} from '../../platform/agent/selectionPayloadCandidate';
import {
  classifySelectionWorkspaceTransition,
  resolveSelectionHorizontalParentId,
  type SelectionWorkspaceTransition,
} from './selectionWorkspacePolicy';
import {
  buildPreparedWorkNodeProposal,
  checkPreparedScope,
  diffPreparedPayloads,
  preparedWorkNodeCandidateRefFromProposal,
  runAtomicPreparedWorkNodeApply,
  sha256Json,
  validatePreparedWorkNodeCandidate,
  validatePreparedWorkNodeProposal,
  PreparedWorkNodeAtomicApplyError,
} from '../../platform/agent/preparedWorkNodeProposal';
import type {
  DefPreparedWorkNodeCandidateRefV1,
  DefPreparedWorkNodeCleanupAuditV1,
  PreparedWorkNodeScope,
} from '../../../agent/core/contracts/prepared-work-node.ts';
import type { ProductBinding } from '../../../agent/core/contracts/product.ts';
import { generateId } from '../../utils/helpers';

type SelectionTransitionActor = 'user' | 'ai';

export const PREPARED_SELECTION_PROPOSAL_SCOPE = Object.freeze([
  'selection.roster',
  'timeline.structure',
  'buff.attachments',
  'buff.resistance',
  'loadout.config',
] as const satisfies readonly PreparedWorkNodeScope[]);

const PREPARED_SELECTION_DOCUMENT_PREFIX = 'prepared-selection-document-';
const PREPARED_SELECTION_BRANCH_SUFFIX = '-selection-';

export type PersistedWorkspaceCheckout = {
  readonly document: TimelineDocument;
  readonly checkoutRef: TimelineCheckoutRef;
  readonly payload: TimelineSnapshotPayload;
  readonly contentRevision: number;
  readonly sourceNode: Awaited<ReturnType<ReturnType<typeof createAiTimelineWorkNodeClient>['get']>>['node'] | null;
  readonly sourceSnapshot: {
    readonly id: string;
    readonly timelineId: string;
    readonly createdAt: number;
    readonly payload?: TimelineSnapshotPayload;
  } | null;
};

function exactCheckout(left: TimelineCheckoutRef | null, right: TimelineCheckoutRef | null): boolean {
  return left?.timelineId === right?.timelineId
    && left?.targetType === right?.targetType
    && left?.targetId === right?.targetId
    && left?.updatedAt === right?.updatedAt;
}

function authoritativeNodeRevision(node: { readonly contentRevision?: number }): number {
  if (!Number.isSafeInteger(node.contentRevision) || Number(node.contentRevision) < 0) {
    throw new Error('prepared-source-revision-invalid: Work Node 没有权威 contentRevision。');
  }
  return Number(node.contentRevision);
}

const SNAPSHOT_REVISION_MASK = (1n << 52n) - 1n;

/**
 * ProductBinding keeps contentRevision as a safe integer, while snapshots
 * already have a stable SHA-256 content identity. Fold the full digest into
 * that protocol-sized integer; the full digest remains the snapshot digest.
 */
export function snapshotContentRevisionFromDigest(payloadHash: string): number {
  const match = /^sha256:([0-9a-f]{64})$/iu.exec(payloadHash.trim());
  if (!match) throw new Error('prepared-source-revision-invalid: snapshot payload digest 无效。');
  let revision = 0n;
  const hex = match[1]!;
  for (let index = 0; index < hex.length; index += 13) {
    revision = ((revision << 7n) ^ BigInt(`0x${hex.slice(index, index + 13)}`)) & SNAPSHOT_REVISION_MASK;
  }
  return Number(revision);
}

export async function snapshotContentRevisionFromPayload(
  payload: TimelineSnapshotPayload,
): Promise<number> {
  return snapshotContentRevisionFromDigest(await sha256Json(payload));
}

async function authoritativeSnapshotRevision(snapshot: {
  readonly createdAt: number;
  readonly payload?: TimelineSnapshotPayload;
}): Promise<number> {
  if (!Number.isSafeInteger(snapshot.createdAt) || snapshot.createdAt < 0) {
    throw new Error('prepared-source-revision-invalid: snapshot createdAt 无效。');
  }
  // Re-hash the validated payload so a stale/missing stored hash cannot make
  // two different payloads share one source revision.
  if (!snapshot.payload) {
    throw new Error('prepared-source-revision-invalid: snapshot payload 缺失。');
  }
  return snapshotContentRevisionFromPayload(snapshot.payload);
}

/** Read one exact persisted checkout and its authoritative target CAS revision. */
export async function readPersistedWorkspaceCheckout(
  timelineId: string,
  expectedCheckoutRef?: TimelineCheckoutRef | null,
): Promise<PersistedWorkspaceCheckout> {
  if (!timelineId.trim()) throw new Error('prepared-timeline-invalid: timelineId 不能为空。');
  const repository = createTimelineRepositoryClient();
  const bundle = await repository.exportDocumentBundle(timelineId);
  const checkoutRef = bundle.checkoutRef;
  if (!checkoutRef) throw new Error('prepared-checkout-unavailable: 当前 SQLite 没有正式 checkout。');
  if (expectedCheckoutRef !== undefined && !exactCheckout(checkoutRef, expectedCheckoutRef)) {
    throw new Error('prepared-checkout-drift: 正式 checkout 在读取期间发生变化。');
  }
  const sourceNode = checkoutRef.targetType === 'work-node'
    ? bundle.workNodes.find((node) => node.id === checkoutRef.targetId) ?? null
    : null;
  const sourceSnapshot = checkoutRef.targetType === 'snapshot'
    ? bundle.snapshots.find((snapshot) => snapshot.id === checkoutRef.targetId) ?? null
    : null;
  const payload = sourceNode?.workingPayload ?? sourceSnapshot?.payload;
  if (!payload) throw new Error('prepared-source-payload-missing: checkout target payload 不存在。');
  const validation = validateTimelinePayload(payload);
  if (!validation.ok) {
    throw new Error(`prepared-source-payload-invalid: ${validation.issues.map((issue) => issue.message).join('；')}`);
  }
  const contentRevision = sourceNode
    ? authoritativeNodeRevision(sourceNode)
    : sourceSnapshot
      ? await authoritativeSnapshotRevision(sourceSnapshot)
      : (() => { throw new Error('prepared-source-target-missing: checkout target 不存在。'); })();
  return {
    document: bundle.document,
    checkoutRef,
    payload: structuredClone(payload),
    contentRevision,
    sourceNode,
    sourceSnapshot,
  };
}

export function buildSelectionBootstrapPayload(characters: readonly Character[]): TimelineSnapshotPayload {
  return buildEmptySelectionPayload([...characters]);
}

const SELECTION_CHECKOUT_NOT_PUBLISHABLE =
  'selection live draft differs from the formal checkout; writable binding is suspended.';

function sameOrderedCharacterIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((characterId, index) => characterId === right[index]);
}

/**
 * Keep Agent publication bound to the exact persisted checkout. An empty
 * selection is the sole representation exception: timelineSnapshotStorage
 * intentionally exposes it as `null`, even after the checkout payload was
 * applied to sessionStorage. `ensureSelectionWorkspaceSourceCheckout` has
 * already restored that persisted payload immediately before this guard.
 */
export function assertSelectionWorkspaceCheckoutPublishable(input: {
  readonly sourcePayload: TimelineSnapshotPayload;
  readonly runtimePayload: TimelineSnapshotPayload | null;
  readonly storedCharacterIds: readonly string[];
  readonly currentCharacterIds: readonly string[];
}): void {
  const sourceCharacterIds = input.sourcePayload.selectedCharacters;
  if (
    !sameOrderedCharacterIds(input.storedCharacterIds, sourceCharacterIds)
    || !sameOrderedCharacterIds(input.currentCharacterIds, sourceCharacterIds)
  ) {
    throw new Error(SELECTION_CHECKOUT_NOT_PUBLISHABLE);
  }
  if (!input.runtimePayload) {
    if (sourceCharacterIds.length === 0) return;
    throw new Error(SELECTION_CHECKOUT_NOT_PUBLISHABLE);
  }
  if (diffPreparedPayloads(input.sourcePayload, input.runtimePayload).changes.length !== 0) {
    throw new Error(SELECTION_CHECKOUT_NOT_PUBLISHABLE);
  }
}

/**
 * Normal Product bootstrap for the selection page. It runs before Agent
 * publication and creates a stable initial snapshot only when the active
 * document genuinely has no checkout.
 */
export async function ensureSelectionWorkspaceSourceCheckout(
  selectedCharacters: readonly Character[],
): Promise<PersistedWorkspaceCheckout> {
  await refreshTimelineSessionDocument();
  let session = getTimelineSessionSnapshot();
  const repository = createTimelineRepositoryClient();
  let persistedCheckout = await repository.getCheckoutRef(session.activeTimelineId);
  let createdInitialCheckout = false;
  if (!persistedCheckout) {
    const expectedIds = selectedCharacters.map((character) => character.id);
    const runtimeCandidates = [session.workingPayload, getCurrentTimelineSnapshotPayload()];
    const reusable = runtimeCandidates.find((payload): payload is TimelineSnapshotPayload => {
      if (!payload || JSON.stringify(payload.selectedCharacters) !== JSON.stringify(expectedIds)) return false;
      return validateTimelinePayload(payload).ok;
    });
    const payload = structuredClone(reusable ?? buildSelectionBootstrapPayload(selectedCharacters));
    const createdAt = Date.now();
    const saved = await repository.saveSnapshot({
      id: `${session.activeTimelineId}-initial`,
      timelineId: session.activeTimelineId,
      label: '初始排轴',
      payload,
      createdAt,
    });
    persistedCheckout = await repository.setCheckoutRef({
      timelineId: session.activeTimelineId,
      targetType: 'snapshot',
      targetId: saved.snapshot.id,
      updatedAt: saved.snapshot.createdAt,
    });
    createdInitialCheckout = true;
  }
  const source = await readPersistedWorkspaceCheckout(session.activeTimelineId, persistedCheckout);
  let runtimePayload = getCurrentTimelineSnapshotPayload();
  const runtimeIsValid = Boolean(runtimePayload && validateTimelinePayload(runtimePayload).ok);
  if (createdInitialCheckout || !runtimeIsValid) {
    applyTimelineSnapshotPayload(source.payload);
    setSelectedCharacterIds(source.payload.selectedCharacters);
    await flushUserWorkspaceState();
    runtimePayload = structuredClone(source.payload);
  }
  session = getTimelineSessionSnapshot();
  if (!exactCheckout(session.checkoutRef, source.checkoutRef)
    || session.activeTimelineId !== source.document.id
    || !session.workingPayload) {
    activateTimelineSession({
      document: source.document,
      checkoutRef: source.checkoutRef,
      workingPayload: runtimePayload ?? source.payload,
    });
  }
  return source;
}

function sameProductBinding(left: ProductBinding, right: ProductBinding): boolean {
  return left.workspaceId === right.workspaceId
    && left.databaseGeneration === right.databaseGeneration
    && left.timelineId === right.timelineId
    && left.checkoutTargetId === right.checkoutTargetId
    && left.checkoutUpdatedAt === right.checkoutUpdatedAt
    && left.contentRevision === right.contentRevision
    && left.snapshotDigest === right.snapshotDigest;
}

function exactScope(left: readonly PreparedWorkNodeScope[], right: readonly PreparedWorkNodeScope[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function preparedSelectionBranchId(proposalId: string, openCanvas: boolean): string {
  return `prepared-${proposalId}${PREPARED_SELECTION_BRANCH_SUFFIX}${openCanvas ? 'canvas' : 'selection'}`;
}

function parsePreparedSelectionBranchId(
  proposalId: string,
  branchId: string,
): { readonly openCanvas: boolean } | null {
  if (branchId === preparedSelectionBranchId(proposalId, true)) return { openCanvas: true };
  if (branchId === preparedSelectionBranchId(proposalId, false)) return { openCanvas: false };
  return null;
}

function preparedSelectionMarker(candidate: Pick<DefPreparedWorkNodeCandidateRefV1, 'proposalId' | 'proposalDigest'>): string {
  return `[prepared-selection:v1:${candidate.proposalId}:${candidate.proposalDigest}]`;
}

function preparedSelectionDocumentId(proposalId: string): string {
  return `${PREPARED_SELECTION_DOCUMENT_PREFIX}${proposalId}`;
}

function preparedSelectionFailure(
  operation: string,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
) {
  return {
    ok: false as const,
    applied: false as const,
    operation,
    code,
    message,
    liveCheckoutTouched: false as boolean,
    rollbackApplied: false as boolean,
    candidatePreserved: false as boolean,
    postcondition: {
      pass: true,
      checkoutUnchanged: true,
      liveCheckoutTouched: false,
      reason: message,
    },
    ...extra,
  };
}

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

async function saveCurrentWorkspaceBeforeSelectionTransition(
  input: ApplySelectionWorkspaceTransitionInput,
): Promise<void> {
  const expectedCharacterIds = input.previousCharacters.map((character) => character.id);
  if (expectedCharacterIds.length === 0) return;

  const currentPayload = getCurrentTimelineSnapshotPayload();
  if (!currentPayload) {
    throw new Error('当前排轴尚未准备完成，未切换队伍或新建存档。');
  }
  if (JSON.stringify(currentPayload.selectedCharacters) !== JSON.stringify(expectedCharacterIds)) {
    throw new Error('当前排轴与已选干员不一致，未切换队伍或新建存档。请返回排轴界面刷新后重试。');
  }

  const timelineSession = getTimelineSessionSnapshot();
  if (timelineSession.activeTimelineId !== input.activeTimelineId) {
    throw new Error('当前 SQLite 工作区已发生变化，未切换队伍或新建存档。');
  }
  await saveTimelineCheckpoint({
    timelineId: input.activeTimelineId,
    timelineLabel: timelineSession.activeTimelineLabel,
    payload: currentPayload,
    reason: '在选人界面继续排轴或新建存档前，自动保存原工作区。',
  });
}

async function createNewTemporaryWorkspace(
  input: ApplySelectionWorkspaceTransitionInput,
  options: { preserveActiveWorkspace?: boolean; labelPrefix?: string } = {},
): Promise<ApplySelectionWorkspaceTransitionResult> {
  if (input.nextCharacters.length === 0) {
    throw new Error('请先选择至少一位干员。');
  }
  const repository = createTimelineRepositoryClient();
  const createdAt = Date.now();
  const nonce = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : Math.random().toString(36).slice(2, 12);
  const timelineId = `timeline-${createdAt}-${nonce}`;
  const snapshotId = `${timelineId}-initial`;
  const documentLabel = `${options.labelPrefix || '排轴'} ${new Date(createdAt).toLocaleString('zh-CN', { hour12: false })}`;
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

  if (input.activeTimelineIsTemporary && !options.preserveActiveWorkspace) {
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

export async function createDetachedSelectionWorkspace(
  input: ApplySelectionWorkspaceTransitionInput,
): Promise<ApplySelectionWorkspaceTransitionResult> {
  if (input.actor === 'ai' && (input.approval?.mode !== 'manual' || input.approval.approvedBy !== 'user')) {
    throw new Error('AI 选人必须取得用户手动审批后才能应用。');
  }
  await saveCurrentWorkspaceBeforeSelectionTransition(input);
  return createNewTemporaryWorkspace(input, {
    preserveActiveWorkspace: true,
    labelPrefix: '独立存档',
  });
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
    if (input.actor === 'user') {
      await saveCurrentWorkspaceBeforeSelectionTransition(input);
    }
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
  await saveCurrentWorkspaceBeforeSelectionTransition(input);
  return transition === 'new-temporary-workspace'
    ? createNewTemporaryWorkspace(input)
    : createHorizontalSelectionBranch(input);
}

export type PrepareReviewedSelectionProposalInput = {
  readonly operation: string;
  readonly scope: readonly PreparedWorkNodeScope[];
  readonly sourceBinding: ProductBinding;
  readonly currentBinding: ProductBinding | null;
  readonly roster: PreparedSelectionRosterRequest;
  readonly availableCharacters: readonly Character[];
};

export type PreparedSelectionOperation =
  | 'selection.add'
  | 'selection.remove'
  | 'selection.replace'
  | 'selection.reorder'
  | 'selection.apply';

export type PreparedSelectionSemanticGate =
  | { readonly pass: true }
  | { readonly pass: false; readonly code: string; readonly reason: string };

function sameStringSequence(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Product-layer semantic gate; prompts and approval text are not authority. */
export function validatePreparedSelectionSemantics(
  operation: string,
  currentIds: readonly string[],
  nextIds: readonly string[],
): PreparedSelectionSemanticGate {
  const fail = (reason: string): PreparedSelectionSemanticGate => ({
    pass: false,
    code: 'prepared-selection-operation-mismatch',
    reason,
  });
  if (new Set(currentIds).size !== currentIds.length || new Set(nextIds).size !== nextIds.length) {
    return fail('selection roster contains duplicate stable operator ids.');
  }
  if (sameStringSequence(currentIds, nextIds)) {
    return fail('selection operation must produce a non-empty roster change.');
  }
  const currentSet = new Set(currentIds);
  const nextSet = new Set(nextIds);
  const added = nextIds.filter((id) => !currentSet.has(id));
  const removed = currentIds.filter((id) => !nextSet.has(id));
  const retainedBefore = currentIds.filter((id) => nextSet.has(id));
  const retainedAfter = nextIds.filter((id) => currentSet.has(id));
  switch (operation as PreparedSelectionOperation) {
    case 'selection.add':
      return added.length === 1
        && removed.length === 0
        && nextIds.length === currentIds.length + 1
        && sameStringSequence(retainedBefore, retainedAfter)
        ? { pass: true }
        : fail('selection.add must add exactly one operator without removing or reordering retained operators.');
    case 'selection.remove':
      return removed.length === 1
        && added.length === 0
        && nextIds.length + 1 === currentIds.length
        && sameStringSequence(retainedBefore, retainedAfter)
        ? { pass: true }
        : fail('selection.remove must remove exactly one operator without adding or reordering retained operators.');
    case 'selection.replace': {
      const changedSlots = currentIds.filter((id, index) => id !== nextIds[index]).length;
      return currentIds.length === nextIds.length
        && added.length === 1
        && removed.length === 1
        && changedSlots === 1
        ? { pass: true }
        : fail('selection.replace must replace exactly one operator in the same roster slot.');
    }
    case 'selection.reorder':
      return currentIds.length === nextIds.length
        && added.length === 0
        && removed.length === 0
        ? { pass: true }
        : fail('selection.reorder must preserve the exact stable member set and only change order.');
    case 'selection.apply':
      return { pass: true };
    default:
      return fail(`unsupported selection operation: ${operation}`);
  }
}

async function cleanupFailedPreparedSelectionCreation(input: {
  readonly proposalId: string;
  readonly candidateTimelineId: string | null;
  readonly candidateNodeId: string | null;
  readonly destination: 'current-timeline' | 'new-temporary-workspace' | null;
  readonly sourceTimelineId: string;
}): Promise<{ readonly status: 'deleted' | 'preserved' | 'failed'; readonly reason: string }> {
  if (!input.candidateTimelineId) {
    return { status: 'deleted', reason: 'candidate 尚未创建。' };
  }
  try {
    const repository = createTimelineRepositoryClient();
    const client = createAiTimelineWorkNodeClient();
    if (input.destination === 'new-temporary-workspace') {
      const documents = await repository.listDocuments();
      const document = documents.find((entry) => entry.id === input.candidateTimelineId);
      if (!document) return { status: 'deleted', reason: 'candidate temporary document 已不存在。' };
      const bundle = await repository.exportDocumentBundle(document.id);
      const commits = (await client.list()).commits.filter((commit) => commit.timelineId === document.id);
      const nodeIsExpected = bundle.workNodes.length === 0 || (
        bundle.workNodes.length === 1
        && bundle.workNodes[0]?.id === input.candidateNodeId
        && (
          bundle.workNodes[0]?.branchId === preparedSelectionBranchId(input.proposalId, true)
          || bundle.workNodes[0]?.branchId === preparedSelectionBranchId(input.proposalId, false)
        )
      );
      if (document.isTemporary
        && document.id === preparedSelectionDocumentId(input.proposalId)
        && !bundle.checkoutRef
        && bundle.snapshots.length === 0
        && commits.length === 0
        && nodeIsExpected) {
        await repository.deleteDocument(document.id);
        return { status: 'deleted', reason: 'prepare 失败后删除了未激活的 candidate temporary document。' };
      }
      return { status: 'preserved', reason: 'candidate document 的 checkout/内容无法完整证明，按 fail-closed 保留。' };
    }
    if (!input.candidateNodeId || input.candidateTimelineId !== input.sourceTimelineId) {
      return { status: 'preserved', reason: 'candidate node 身份不完整，按 fail-closed 保留。' };
    }
    const list = await client.list();
    const node = list.nodes.find((entry) => entry.id === input.candidateNodeId);
    if (!node) return { status: 'deleted', reason: 'candidate node 已不存在。' };
    const checkout = await repository.getCheckoutRef(input.candidateTimelineId);
    const descendants = list.nodes.filter((entry) => entry.parentNodeId === node.id);
    const commits = list.commits.filter((entry) => entry.nodeId === node.id);
    if (node.timelineId === input.candidateTimelineId
      && parsePreparedSelectionBranchId(input.proposalId, node.branchId)
      && descendants.length === 0
      && commits.length === 0
      && checkout?.targetId !== node.id) {
      await client.delete(node.id);
      return { status: 'deleted', reason: 'prepare 失败后删除了未 checkout 的 candidate node。' };
    }
    return { status: 'preserved', reason: 'candidate node 存在 lineage/checkout/commit 证据，按 fail-closed 保留。' };
  } catch (error) {
    return {
      status: 'failed',
      reason: `prepare 失败后的 candidate cleanup 失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function prepareReviewedSelectionProposal(
  input: PrepareReviewedSelectionProposalInput,
) {
  const proposalId = `prepared-${generateId()}`;
  let candidateTimelineId: string | null = null;
  let candidateNodeId: string | null = null;
  let destination: 'current-timeline' | 'new-temporary-workspace' | null = null;
  try {
    if (!input.currentBinding || !sameProductBinding(input.currentBinding, input.sourceBinding)) {
      return preparedSelectionFailure(
        input.operation,
        'prepared-source-binding-mismatch',
        'Host sourceBinding 与当前 Product binding 不完全一致；未创建 selection candidate。',
      );
    }
    if (!exactScope(input.scope, PREPARED_SELECTION_PROPOSAL_SCOPE)) {
      return preparedSelectionFailure(
        input.operation,
        'prepared-selection-scope-invalid',
        'selection proposal 必须使用固定顺序的完整五项 scope。',
      );
    }
    const session = getTimelineSessionSnapshot();
    if (session.activeTimelineId !== input.sourceBinding.timelineId) {
      return preparedSelectionFailure(
        input.operation,
        'prepared-source-timeline-mismatch',
        '当前 active timeline 与 sourceBinding 不一致。',
      );
    }
    const source = await readPersistedWorkspaceCheckout(
      input.sourceBinding.timelineId,
      session.checkoutRef,
    );
    if (input.sourceBinding.checkoutTargetId !== source.checkoutRef.targetId
      || input.sourceBinding.checkoutUpdatedAt !== source.checkoutRef.updatedAt
      || input.sourceBinding.contentRevision !== source.contentRevision) {
      return preparedSelectionFailure(
        input.operation,
        'prepared-source-revision-mismatch',
        'sourceBinding 没有精确绑定正式 checkout target/contentRevision。',
      );
    }
    const resolved = resolvePreparedSelectionRoster({
      roster: input.roster,
      availableCharacters: input.availableCharacters,
    });
    const semanticGate = validatePreparedSelectionSemantics(
      input.operation,
      source.payload.selectedCharacters,
      resolved.characters.map((character) => character.id),
    );
    if (!semanticGate.pass) {
      return preparedSelectionFailure(
        input.operation,
        semanticGate.code,
        semanticGate.reason,
      );
    }
    const preparedPayload = buildPreparedSelectionPayload({
      basePayload: source.payload,
      nextCharacters: resolved.characters,
    });
    destination = preparedPayload.destination;
    const diff = diffPreparedPayloads(source.payload, preparedPayload.payload);
    if (diff.changes.length === 0) {
      return preparedSelectionFailure(
        input.operation,
        'prepared-empty-diff',
        'selection request 没有产生可审阅变化；未创建空 candidate。',
      );
    }
    const scopeGate = checkPreparedScope(diff, input.scope);
    if (!scopeGate.pass) {
      return preparedSelectionFailure(
        input.operation,
        'prepared-scope-overreach',
        'selection candidate 的真实 diff 超出完整声明 scope。',
        { scopeGate },
      );
    }

    const repository = createTimelineRepositoryClient();
    const client = createAiTimelineWorkNodeClient();
    let candidateDocument = source.document;
    let structuralParentNodeId = resolveSelectionHorizontalParentId(
      source.sourceNode?.id ?? null,
      source.sourceNode?.parentNodeId,
    );
    if (destination === 'new-temporary-workspace') {
      candidateTimelineId = preparedSelectionDocumentId(proposalId);
      const existingCandidateDocument = (await repository.listDocuments())
        .find((document) => document.id === candidateTimelineId);
      if (existingCandidateDocument) {
        throw new Error('prepared-selection-document-collision: candidate temporary document ID 已存在。');
      }
      candidateDocument = await repository.ensureDocument({
        id: candidateTimelineId,
        label: `[prepared-selection:${proposalId}] ${resolved.nodeTitle}`,
        isTemporary: true,
      });
      structuralParentNodeId = null;
    } else {
      candidateTimelineId = source.document.id;
    }
    const branchId = preparedSelectionBranchId(proposalId, resolved.openCanvas);
    const created = await client.create({
      timelineId: candidateTimelineId,
      parentNodeId: structuralParentNodeId,
      branchId,
      label: resolved.nodeTitle,
      description: resolved.nodeDescription,
      basePayload: source.payload,
      workingPayload: preparedPayload.payload,
      approvalPolicy: 'manual',
      riskFlags: [],
    });
    candidateNodeId = created.node.id;
    const ready = await client.update(created.node.id, { status: 'ready' });
    let candidateNode = ready.node;
    const nodeRevision = authoritativeNodeRevision(candidateNode);
    if (candidateNode.timelineId !== candidateDocument.id
      || candidateNode.branchId !== branchId
      || (candidateNode.parentNodeId ?? null) !== structuralParentNodeId
      || candidateNode.status !== 'ready') {
      throw new Error('prepared-selection-candidate-proof-failed: candidate identity/status 无法证明。');
    }
    const payloadDigest = await sha256Json(source.payload);
    const proposal = await buildPreparedWorkNodeProposal({
      operation: input.operation,
      proposalId,
      intent: 'selection',
      destination,
      sourceTargetId: source.checkoutRef.targetId,
      sourceRevision: source.contentRevision,
      candidateTimelineId: candidateDocument.id,
      nodeId: candidateNode.id,
      nodeRevision,
      scope: [...PREPARED_SELECTION_PROPOSAL_SCOPE],
      sourceBinding: input.sourceBinding,
      sourceCheckout: {
        timelineId: source.document.id,
        targetType: source.checkoutRef.targetType,
        targetId: source.checkoutRef.targetId,
        revision: source.contentRevision,
        payloadDigest,
      },
      structuralParentNodeId,
      basePayload: candidateNode.basePayload,
      workingPayload: candidateNode.workingPayload,
    });
    const proposalValidation = await validatePreparedWorkNodeProposal(proposal, {
      operation: input.operation,
      basePayload: candidateNode.basePayload,
      workingPayload: candidateNode.workingPayload,
    });
    if (!proposalValidation.ok) {
      throw new Error(`prepared-selection-proposal-proof-failed: ${proposalValidation.issues.join('；')}`);
    }
    const candidate = preparedWorkNodeCandidateRefFromProposal(proposal);
    candidateNode = (await client.update(candidateNode.id, {
      status: 'ready',
      description: `${preparedSelectionMarker(candidate)} ${resolved.nodeDescription}`,
    })).node;
    const sourceAfter = await readPersistedWorkspaceCheckout(source.document.id, source.checkoutRef);
    const candidateCheckout = await repository.getCheckoutRef(candidateDocument.id);
    if (sourceAfter.contentRevision !== source.contentRevision
      || authoritativeNodeRevision(candidateNode) !== candidate.nodeRevision
      || !candidateNode.description.startsWith(preparedSelectionMarker(candidate))
      || (destination === 'new-temporary-workspace' && candidateCheckout !== null)
      || (destination === 'current-timeline' && !exactCheckout(candidateCheckout, source.checkoutRef))) {
      throw new Error('prepared-selection-postcondition-failed: prepare 触碰了 checkout 或 provenance 漂移。');
    }
    return {
      ok: true as const,
      kind: 'prepared-work-node-proposal' as const,
      operation: input.operation,
      liveCheckoutTouched: false as const,
      candidate,
      proposal,
      destination,
      selectedCharacters: resolved.characters.map((character) => ({ id: character.id, name: character.name })),
      currentView: resolved.openCanvas ? 'canvas' as const : 'selection' as const,
      candidateNode: {
        nodeId: candidateNode.id,
        nodeRevision: candidate.nodeRevision,
        timelineId: candidateNode.timelineId,
        status: candidateNode.status,
        branchId: candidateNode.branchId,
      },
      postcondition: {
        pass: true,
        liveCheckoutTouched: false,
        checkoutUnchanged: true,
        candidateStored: true,
        reviewComplete: true,
        diffEntries: proposal.review.changes.length,
        sourceTargetId: source.checkoutRef.targetId,
        sourceRevision: source.contentRevision,
      },
    };
  } catch (error) {
    const cleanup = await cleanupFailedPreparedSelectionCreation({
      proposalId,
      candidateTimelineId,
      candidateNodeId,
      destination,
      sourceTimelineId: input.sourceBinding.timelineId,
    });
    return preparedSelectionFailure(
      input.operation,
      'prepared-selection-proposal-failed',
      error instanceof Error ? error.message : String(error),
      { cleanup },
    );
  }
}

export type PreparedSelectionProjectionTarget = {
  readonly characters: readonly Character[];
  readonly currentView: 'selection' | 'canvas';
  readonly timelineId: string;
  readonly nodeId: string;
  readonly nodeRevision: number;
  readonly payload: TimelineSnapshotPayload;
};

export type PreparedSelectionProjectionVerification = {
  readonly pass: boolean;
  readonly reason?: string;
  readonly observed?: unknown;
};

export type PreparedSelectionProjectionCallbacks = {
  readonly apply: (target: PreparedSelectionProjectionTarget) => void | Promise<void>;
  readonly verify: (target: PreparedSelectionProjectionTarget) => Promise<PreparedSelectionProjectionVerification>;
  readonly restore: (target: PreparedSelectionProjectionTarget) => void | Promise<void>;
};

/** Atomic candidate activation plus non-transactional old-temp cleanup warning. */
export async function runPreparedSelectionActivationTransaction(input: {
  readonly applyTarget: () => Promise<void>;
  readonly verifyVisibleTarget: () => Promise<PreparedSelectionProjectionVerification>;
  readonly persistCheckout: () => Promise<void>;
  readonly persistAppliedLedger: () => Promise<{ readonly applied: boolean }>;
  readonly verifyPersistedTarget: () => Promise<PreparedSelectionProjectionVerification>;
  readonly restorePreviousState: () => Promise<void>;
  readonly verifyPreviousState: () => Promise<PreparedSelectionProjectionVerification>;
  readonly cleanupPreviousTemporary?: () => Promise<void>;
}): Promise<{ readonly cleanupWarning: string | null }> {
  await runAtomicPreparedWorkNodeApply({
    applyTarget: input.applyTarget,
    verifyVisibleTarget: input.verifyVisibleTarget,
    persistCheckout: input.persistCheckout,
    persistAppliedLedger: input.persistAppliedLedger,
    verifyPersistedTarget: input.verifyPersistedTarget,
    restorePreviousState: input.restorePreviousState,
    verifyPreviousState: input.verifyPreviousState,
  });
  if (!input.cleanupPreviousTemporary) return { cleanupWarning: null };
  try {
    await input.cleanupPreviousTemporary();
    return { cleanupWarning: null };
  } catch (error) {
    return {
      cleanupWarning: `新 candidate 已成功激活，但旧临时工作区清理失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export type ApplyReviewedSelectionProposalInput = {
  readonly operation: string;
  readonly candidate: DefPreparedWorkNodeCandidateRefV1;
  readonly currentBinding: ProductBinding | null;
  readonly availableCharacters: readonly Character[];
  readonly previousView: 'selection' | 'canvas';
  readonly projection: PreparedSelectionProjectionCallbacks;
};

async function verifySelectionRuntimeTarget(input: {
  readonly target: PreparedSelectionProjectionTarget;
  readonly checkoutRef: TimelineCheckoutRef;
  readonly projection: PreparedSelectionProjectionCallbacks;
}): Promise<PreparedSelectionProjectionVerification> {
  const [payloadDigest, expectedDigest, projection] = await Promise.all([
    sha256Json(getCurrentTimelineSnapshotPayload()),
    sha256Json(input.target.payload),
    input.projection.verify(input.target),
  ]);
  const selectedIds = getSelectedCharacterIds();
  const expectedIds = input.target.characters.map((character) => character.id);
  const session = getTimelineSessionSnapshot();
  const pass = projection.pass
    && payloadDigest === expectedDigest
    && JSON.stringify(selectedIds) === JSON.stringify(expectedIds)
    && session.activeTimelineId === input.target.timelineId
    && exactCheckout(session.checkoutRef, input.checkoutRef);
  return pass
    ? {
        pass: true,
        observed: {
          payloadDigest,
          selectedCharacterIds: selectedIds,
          currentView: input.target.currentView,
          timelineId: session.activeTimelineId,
          checkout: session.checkoutRef,
          projection: projection.observed ?? null,
        },
      }
    : {
        pass: false,
        reason: projection.reason || 'selection runtime payload/roster/timeline/checkout 后置条件不精确。',
        observed: {
          payloadDigest,
          expectedDigest,
          selectedCharacterIds: selectedIds,
          expectedCharacterIds: expectedIds,
          timelineId: session.activeTimelineId,
          checkout: session.checkoutRef,
          projection: projection.observed ?? null,
        },
      };
}

export async function applyReviewedSelectionProposal(
  input: ApplyReviewedSelectionProposalInput,
) {
  const candidate = input.candidate;
  let liveCheckoutTouched = false;
  let rollbackApplied = false;
  let commitId: string | null = null;
  let targetCheckoutRef: TimelineCheckoutRef | null = null;
  let finalPostcondition: PreparedSelectionProjectionVerification | null = null;
  let rollbackPostcondition: PreparedSelectionProjectionVerification | null = null;
  let candidatePreserved = true;
  try {
    if (candidate.intent !== 'selection'
      || !exactScope(candidate.scope, PREPARED_SELECTION_PROPOSAL_SCOPE)
      || (candidate.destination !== 'current-timeline'
        && candidate.destination !== 'new-temporary-workspace')) {
      return preparedSelectionFailure(
        input.operation,
        'prepared-selection-candidate-unsupported',
        'candidate intent/destination/scope 不是受支持的 selection prepared 组合。',
        { candidate, candidatePreserved: true },
      );
    }
    const binding = input.currentBinding;
    if (!binding
      || binding.checkoutTargetId !== candidate.sourceTargetId
      || binding.contentRevision !== candidate.sourceRevision) {
      return preparedSelectionFailure(
        input.operation,
        'prepared-source-binding-mismatch',
        '当前 Product binding 不再精确绑定 candidate source target/revision。',
        { candidate, candidatePreserved: true },
      );
    }
    const destinationMatches = candidate.destination === 'current-timeline'
      ? candidate.candidateTimelineId === binding.timelineId
      : candidate.candidateTimelineId !== binding.timelineId;
    if (!destinationMatches) {
      return preparedSelectionFailure(
        input.operation,
        'prepared-selection-destination-mismatch',
        'candidate timeline 与声明 destination 不一致。',
        { candidate, candidatePreserved: true },
      );
    }
    const session = getTimelineSessionSnapshot();
    if (session.activeTimelineId !== binding.timelineId) {
      return preparedSelectionFailure(
        input.operation,
        'prepared-source-timeline-mismatch',
        '当前 active timeline 已离开 candidate source。',
        { candidate, candidatePreserved: true },
      );
    }
    const source = await readPersistedWorkspaceCheckout(binding.timelineId, session.checkoutRef);
    if (source.checkoutRef.targetId !== candidate.sourceTargetId
      || source.checkoutRef.updatedAt !== binding.checkoutUpdatedAt
      || source.contentRevision !== candidate.sourceRevision) {
      return preparedSelectionFailure(
        input.operation,
        'prepared-source-revision-mismatch',
        '正式 source checkout target/revision 已变化。',
        { candidate, candidatePreserved: true },
      );
    }
    const livePayload = getCurrentTimelineSnapshotPayload();
    const [liveDigest, sourceDigest] = await Promise.all([
      sha256Json(livePayload),
      sha256Json(source.payload),
    ]);
    if (liveDigest !== sourceDigest
      || JSON.stringify(getSelectedCharacterIds()) !== JSON.stringify(source.payload.selectedCharacters)) {
      return preparedSelectionFailure(
        input.operation,
        'prepared-live-source-mismatch',
        '当前 live payload/roster 与正式 source checkout 不一致。',
        { candidate, candidatePreserved: true },
      );
    }

    const repository = createTimelineRepositoryClient();
    const client = createAiTimelineWorkNodeClient();
    const candidateDocument = (await repository.listDocuments())
      .find((document) => document.id === candidate.candidateTimelineId);
    if (!candidateDocument) {
      return preparedSelectionFailure(
        input.operation,
        'prepared-selection-document-missing',
        'candidate document 不存在。',
        { candidate, candidatePreserved: true },
      );
    }
    if (candidate.destination === 'new-temporary-workspace'
      && (!candidateDocument.isTemporary
        || candidateDocument.id !== preparedSelectionDocumentId(candidate.proposalId))) {
      return preparedSelectionFailure(
        input.operation,
        'prepared-selection-document-identity-mismatch',
        'new-temporary candidate document 身份无法证明。',
        { candidate, candidatePreserved: true },
      );
    }
    if (candidate.destination === 'new-temporary-workspace') {
      const candidateBundle = await repository.exportDocumentBundle(candidate.candidateTimelineId);
      if (candidateBundle.checkoutRef !== null
        || candidateBundle.snapshots.length !== 0
        || candidateBundle.workNodes.length !== 1
        || candidateBundle.workNodes[0]?.id !== candidate.nodeId) {
        return preparedSelectionFailure(
          input.operation,
          'prepared-selection-document-drift',
          'new-temporary candidate document 已含 checkout、snapshot 或额外节点；拒绝激活。',
          { candidate, candidatePreserved: true },
        );
      }
    }
    const candidateNode = (await client.get(candidate.nodeId)).node;
    const branch = parsePreparedSelectionBranchId(candidate.proposalId, candidateNode.branchId);
    const expectedParentNodeId = candidate.destination === 'current-timeline'
      ? resolveSelectionHorizontalParentId(source.sourceNode?.id ?? null, source.sourceNode?.parentNodeId)
      : null;
    const nodeRevision = authoritativeNodeRevision(candidateNode);
    if (!branch
      || candidateNode.timelineId !== candidate.candidateTimelineId
      || candidateNode.id !== candidate.nodeId
      || (candidateNode.parentNodeId ?? null) !== expectedParentNodeId
      || nodeRevision !== candidate.nodeRevision
      || candidateNode.status !== 'ready'
      || !candidateNode.description.startsWith(preparedSelectionMarker(candidate))) {
      return preparedSelectionFailure(
        input.operation,
        'prepared-candidate-identity-mismatch',
        'candidate document/node/branch/parent/revision/status/provenance 已漂移。',
        { candidate, candidatePreserved: true, observedNodeRevision: nodeRevision },
      );
    }
    const validation = validateTimelinePayload(candidateNode.workingPayload);
    if (!validation.ok) {
      return preparedSelectionFailure(
        input.operation,
        'prepared-candidate-payload-invalid',
        validation.issues.map((issue) => issue.message).join('；'),
        { candidate, candidatePreserved: true, validation },
      );
    }
    const selectedIds = candidateNode.workingPayload.selectedCharacters;
    const resolved = resolvePreparedSelectionRoster({
      roster: {
        characterIds: [...selectedIds],
        nodeTitle: candidateNode.label,
        nodeDescription: '重新验证 prepared selection candidate 的浏览器可信 roster。',
        openCanvas: branch.openCanvas,
      },
      availableCharacters: input.availableCharacters,
    });
    const candidateNow = candidate.destination === 'new-temporary-workspace'
      ? candidateNode.workingPayload.timelineData.createdAt
      : candidateNode.workingPayload.timelineData.updatedAt;
    const rebuilt = buildPreparedSelectionPayload({
      basePayload: source.payload,
      nextCharacters: resolved.characters,
      now: candidateNow,
    });
    const [rebuiltDigest, candidateWorkingDigest] = await Promise.all([
      sha256Json(rebuilt.payload),
      sha256Json(candidateNode.workingPayload),
    ]);
    if (rebuilt.destination !== candidate.destination || rebuiltDigest !== candidateWorkingDigest) {
      return preparedSelectionFailure(
        input.operation,
        'prepared-selection-rebuild-mismatch',
        'candidate roster 重新计算后不再产生同一 destination/payload。',
        { candidate, candidatePreserved: true },
      );
    }
    const diff = diffPreparedPayloads(candidateNode.basePayload, candidateNode.workingPayload);
    const scopeGate = checkPreparedScope(diff, candidate.scope);
    if (diff.changes.length === 0 || !scopeGate.pass) {
      return preparedSelectionFailure(
        input.operation,
        'prepared-scope-overreach',
        'candidate 为空或真实 diff 超出声明 scope。',
        { candidate, candidatePreserved: true, scopeGate },
      );
    }
    const proof = await validatePreparedWorkNodeCandidate(candidate, {
      operation: input.operation,
      basePayload: candidateNode.basePayload,
      workingPayload: candidateNode.workingPayload,
      sourceTargetId: source.checkoutRef.targetId,
      sourceRevision: source.contentRevision,
      candidateTimelineId: candidateNode.timelineId,
      nodeId: candidateNode.id,
      nodeRevision,
    });
    const baseDigest = await sha256Json(candidateNode.basePayload);
    if (!proof.ok || baseDigest !== sourceDigest) {
      return preparedSelectionFailure(
        input.operation,
        'prepared-candidate-digest-mismatch',
        proof.ok ? 'candidate base payload 不等于正式 source。' : proof.issues.join('；'),
        { candidate, candidatePreserved: true, issues: proof.ok ? [] : proof.issues },
      );
    }

    // The node count is only a non-authoritative summary. Read it before the
    // commit point so a later summary read can never turn a successful apply
    // into an error.
    const candidateTimelineNodeCount = (await client.list()).nodes
      .filter((node) => node.timelineId === candidate.candidateTimelineId)
      .length;
    // markCheckoutApplied returns the authoritative node/commit facts. Keep
    // those facts for the result projection instead of reading them back
    // after the atomic transaction has committed.
    let appliedNode = candidateNode;
    const committed = await client.commit(candidateNode.id, {
      label: candidateNode.label,
      riskFlags: candidateNode.riskFlags,
      approval: {
        mode: 'manual',
        approvedAt: Date.now(),
        approvedBy: 'user',
        rationale: 'V2 selection candidate 已通过 exact binding/revision/roster/scope/digest 校验。',
      },
    });
    commitId = committed.commit.id;
    const [commitBaseDigest, commitAppliedDigest] = await Promise.all([
      sha256Json(committed.commit.basePayload),
      sha256Json(committed.commit.appliedPayload),
    ]);
    if (commitBaseDigest !== candidate.basePayloadDigest
      || commitAppliedDigest !== candidate.workingPayloadDigest) {
      return preparedSelectionFailure(
        input.operation,
        'prepared-commit-payload-mismatch',
        'candidate commit payload 与已批准 digest 不一致；live checkout 未触碰。',
        { candidate, candidatePreserved: true, commitId },
      );
    }

    const targetView = branch.openCanvas ? 'canvas' as const : 'selection' as const;
    const target: PreparedSelectionProjectionTarget = {
      characters: resolved.characters,
      currentView: targetView,
      timelineId: candidate.candidateTimelineId,
      nodeId: candidate.nodeId,
      nodeRevision: candidate.nodeRevision,
      payload: candidateNode.workingPayload,
    };
    const sourceCharacters = source.payload.selectedCharacters.map((characterId) => {
      const matches = input.availableCharacters.filter((character) => character.id === characterId);
      if (matches.length !== 1) throw new Error(`source roster operator 无法精确恢复：${characterId}`);
      return matches[0]!;
    });
    const sourceTarget: PreparedSelectionProjectionTarget = {
      characters: sourceCharacters,
      currentView: input.previousView,
      timelineId: source.document.id,
      nodeId: source.checkoutRef.targetId,
      nodeRevision: source.contentRevision,
      payload: source.payload,
    };
    const targetUpdatedAt = Date.now();
    targetCheckoutRef = {
      timelineId: candidate.candidateTimelineId,
      targetType: 'work-node',
      targetId: candidate.nodeId,
      updatedAt: targetUpdatedAt,
    };
    liveCheckoutTouched = true;
    const activation = await runPreparedSelectionActivationTransaction({
      applyTarget: async () => {
        applyTimelineSnapshotPayload(candidateNode.workingPayload);
        setSelectedCharacterIds(resolved.characters.map((character) => character.id));
        await flushUserWorkspaceState();
        activateTimelineSession({
          document: candidateDocument,
          checkoutRef: targetCheckoutRef,
          workingPayload: candidateNode.workingPayload,
        });
        await input.projection.apply(target);
      },
      verifyVisibleTarget: async () => verifySelectionRuntimeTarget({
        target,
        checkoutRef: targetCheckoutRef!,
        projection: input.projection,
      }),
      persistCheckout: async () => {
        await repository.setCheckoutRef(targetCheckoutRef!);
      },
      persistAppliedLedger: async () => {
        const marked = await client.markCheckoutApplied(candidate.nodeId, {
          commitId: commitId!,
          appliedAt: targetUpdatedAt,
          appliedBy: 'user',
          rationale: 'selection candidate 可见后置条件已通过，应用正式 checkout。',
        });
        appliedNode = marked.node;
        return {
          applied: marked.commit.id === commitId
            && marked.commit.checkoutApplied
            && authoritativeNodeRevision(marked.node) === candidate.nodeRevision,
        };
      },
      verifyPersistedTarget: async () => {
        const [persistedCheckout, persistedNode] = await Promise.all([
          repository.getCheckoutRef(candidate.candidateTimelineId),
          client.get(candidate.nodeId),
        ]);
        const runtime = await verifySelectionRuntimeTarget({
          target,
          checkoutRef: targetCheckoutRef!,
          projection: input.projection,
        });
        const pass = runtime.pass
          && exactCheckout(persistedCheckout, targetCheckoutRef)
          && persistedNode.node.status === 'applied'
          && authoritativeNodeRevision(persistedNode.node) === candidate.nodeRevision;
        finalPostcondition = pass
          ? { pass: true, observed: { runtime: runtime.observed, checkout: persistedCheckout } }
          : { pass: false, reason: runtime.reason || 'candidate persisted checkout/node 后置条件失败。' };
        return finalPostcondition;
      },
      restorePreviousState: async () => {
        const failures: string[] = [];
        try {
          await repository.setCheckoutRef(source.checkoutRef);
        } catch (error) {
          failures.push(`恢复 source checkout 失败：${error instanceof Error ? error.message : String(error)}`);
        }
        try {
          applyTimelineSnapshotPayload(source.payload);
          setSelectedCharacterIds(source.payload.selectedCharacters);
          await flushUserWorkspaceState();
          activateTimelineSession({
            document: source.document,
            checkoutRef: source.checkoutRef,
            workingPayload: source.payload,
          });
          await input.projection.restore(sourceTarget);
        } catch (error) {
          failures.push(`恢复 source live projection 失败：${error instanceof Error ? error.message : String(error)}`);
        }
        try {
          if (candidate.destination === 'new-temporary-workspace') {
            await repository.deleteDocument(candidate.candidateTimelineId);
            candidatePreserved = false;
          } else {
            await client.markRollbackApplied(candidate.nodeId, {
              appliedAt: Date.now(),
              appliedBy: 'system',
              rationale: 'selection candidate apply 失败，已恢复 source checkout。',
              checkout: source.checkoutRef,
              basePayloadDigest: candidate.basePayloadDigest,
              baseRevision: source.contentRevision,
            });
          }
        } catch (error) {
          failures.push(`selection rollback audit/cleanup 失败：${error instanceof Error ? error.message : String(error)}`);
        }
        if (failures.length > 0) throw new Error(failures.join('；'));
      },
      verifyPreviousState: async () => {
        const persistedCheckout = await repository.getCheckoutRef(source.document.id);
        const runtime = await verifySelectionRuntimeTarget({
          target: sourceTarget,
          checkoutRef: source.checkoutRef,
          projection: input.projection,
        });
        rollbackPostcondition = runtime.pass && exactCheckout(persistedCheckout, source.checkoutRef)
          ? { pass: true, observed: { runtime: runtime.observed, checkout: persistedCheckout } }
          : { pass: false, reason: runtime.reason || 'source rollback checkout 后置条件失败。' };
        if (rollbackPostcondition.pass) rollbackApplied = true;
        return rollbackPostcondition;
      },
      ...(source.document.isTemporary && source.document.id !== candidate.candidateTimelineId
        ? {
            cleanupPreviousTemporary: async () => {
              await repository.deleteDocument(source.document.id);
            },
          }
        : {}),
    });
    // From this point onward the live checkout, applied ledger and final
    // postcondition are already committed. Do not perform another client
    // list/get here: the projection is built from the facts returned by the
    // commit-stage writes above.
    const review = buildAiTimelineNodeReviewProjection(appliedNode, targetCheckoutRef);
    return {
      ok: true as const,
      applied: true as const,
      operation: input.operation,
      liveCheckoutTouched: true as const,
      rollbackApplied: false as const,
      candidate,
      nodeId: candidate.nodeId,
      nodeRevision: candidate.nodeRevision,
      commitId,
      basePayloadDigest: candidate.basePayloadDigest,
      workingPayloadDigest: candidate.workingPayloadDigest,
      diffDigest: candidate.diffDigest,
      proposalDigest: candidate.proposalDigest,
      checkout: targetCheckoutRef,
      checkoutApplied: true as const,
      selectedCharacters: resolved.characters.map((character) => ({ id: character.id, name: character.name })),
      currentView: targetView,
      timelineId: candidate.candidateTimelineId,
      transition: candidate.destination === 'current-timeline' ? 'horizontal-branch' as const : 'new-temporary-workspace' as const,
      nodeCount: candidateTimelineNodeCount,
      nodeReview: review,
      cleanupWarning: activation.cleanupWarning,
      postcondition: {
        ...(finalPostcondition ?? { pass: false, reason: 'selection final postcondition missing.' }),
        exactRoster: resolved.characters.map((character) => ({ id: character.id, name: character.name })),
        currentView: targetView,
        timelineId: candidate.candidateTimelineId,
        nodeId: candidate.nodeId,
        nodeRevision: candidate.nodeRevision,
        cleanupWarning: activation.cleanupWarning,
      },
    };
  } catch (error) {
    const atomic = error instanceof PreparedWorkNodeAtomicApplyError ? error : null;
    const rollbackReceipt = rollbackPostcondition as PreparedSelectionProjectionVerification | null;
    rollbackApplied = Boolean(atomic && !atomic.rollbackError && rollbackReceipt?.pass);
    return preparedSelectionFailure(
      input.operation,
      atomic?.rollbackError
        ? 'prepared-selection-rollback-failed'
        : atomic
          ? 'prepared-selection-atomic-apply-failed'
          : 'prepared-selection-apply-preflight-failed',
      error instanceof Error ? error.message : String(error),
      {
        candidate,
        liveCheckoutTouched,
        rollbackApplied,
        candidatePreserved,
        commitId,
        postcondition: atomic
          ? (rollbackReceipt ?? {
              pass: rollbackApplied,
              checkoutRestored: rollbackApplied,
              liveCheckoutTouched,
              reason: atomic.message,
            })
          : {
              pass: true,
              checkoutUnchanged: !liveCheckoutTouched,
              liveCheckoutTouched,
              reason: error instanceof Error ? error.message : String(error),
            },
      },
    );
  }
}

function selectionCleanupAudit(
  candidate: DefPreparedWorkNodeCandidateRefV1,
  status: DefPreparedWorkNodeCleanupAuditV1['status'],
  reason: string,
): DefPreparedWorkNodeCleanupAuditV1 {
  return {
    contract: 'DefPreparedWorkNodeCleanupAuditV1',
    schemaVersion: 1,
    proposalId: candidate.proposalId,
    nodeId: candidate.nodeId,
    candidateTimelineId: candidate.candidateTimelineId,
    status,
    reason,
  };
}

export async function abandonReviewedSelectionProposal(input: {
  readonly candidate: DefPreparedWorkNodeCandidateRefV1;
  readonly currentBinding: ProductBinding | null;
  readonly reason: string;
}) {
  const candidate = input.candidate;
  const preserved = (reason: string, status: 'preserved' | 'failed' = 'preserved') => ({
    ok: false as const,
    liveCheckoutTouched: false as const,
    deleted: false as const,
    candidate,
    cleanup: selectionCleanupAudit(candidate, status, reason),
    postcondition: { pass: true, liveCheckoutTouched: false, candidatePreserved: true },
  });
  try {
    if (candidate.intent !== 'selection'
      || !exactScope(candidate.scope, PREPARED_SELECTION_PROPOSAL_SCOPE)
      || !input.currentBinding) {
      return preserved('candidate intent/scope 或当前 source binding 无法证明，按 fail-closed 保留。');
    }
    const destinationMatches = candidate.destination === 'current-timeline'
      ? candidate.candidateTimelineId === input.currentBinding.timelineId
      : candidate.destination === 'new-temporary-workspace'
        && candidate.candidateTimelineId !== input.currentBinding.timelineId
        && candidate.candidateTimelineId === preparedSelectionDocumentId(candidate.proposalId);
    if (!destinationMatches) {
      return preserved('candidate destination/timeline 无法证明，按 fail-closed 保留。');
    }
    const repository = createTimelineRepositoryClient();
    const client = createAiTimelineWorkNodeClient();
    const documents = await repository.listDocuments();
    const document = documents.find((entry) => entry.id === candidate.candidateTimelineId);
    if (!document) return preserved('candidate document 已不存在，无法形成删除证据。', 'failed');
    const [bundle, list, checkout, audits] = await Promise.all([
      repository.exportDocumentBundle(document.id),
      client.list(),
      repository.getCheckoutRef(document.id),
      repository.listAuditEvents(document.id, 500),
    ]);
    const node = bundle.workNodes.find((entry) => entry.id === candidate.nodeId);
    if (!node) return preserved('candidate node 已不存在，无法形成删除证据。', 'failed');
    const branch = parsePreparedSelectionBranchId(candidate.proposalId, node.branchId);
    const nodeRevision = authoritativeNodeRevision(node);
    const diff = diffPreparedPayloads(node.basePayload, node.workingPayload);
    const scopeGate = checkPreparedScope(diff, candidate.scope);
    const [baseDigest, workingDigest, diffDigest] = await Promise.all([
      sha256Json(node.basePayload),
      sha256Json(node.workingPayload),
      sha256Json(diff.changes),
    ]);
    const commits = list.commits.filter((commit) => commit.nodeId === node.id);
    const descendants = list.nodes.filter((entry) => entry.parentNodeId === node.id);
    const historicalCheckout = audits.some((event) => (
      event.subjectId === node.id
      && (event.subjectType === 'checkout'
        || event.eventType === 'checkout.updated'
        || event.eventType === 'work-node.base-restored')
    ));
    const auditWindowComplete = audits.length < 500;
    if (!branch
      || node.timelineId !== candidate.candidateTimelineId
      || nodeRevision !== candidate.nodeRevision
      || node.status !== 'ready'
      || !node.description.startsWith(preparedSelectionMarker(candidate))
      || baseDigest !== candidate.basePayloadDigest
      || workingDigest !== candidate.workingPayloadDigest
      || diffDigest !== candidate.diffDigest
      || !scopeGate.pass
      || commits.length > 0
      || descendants.length > 0
      || checkout?.targetId === node.id
      || historicalCheckout
      || !auditWindowComplete) {
      return preserved('candidate provenance/digest/revision/scope 或 never-live 证据不完整，绝不删除。');
    }
    if (candidate.destination === 'new-temporary-workspace') {
      if (!document.isTemporary
        || bundle.snapshots.length !== 0
        || bundle.workNodes.length !== 1
        || checkout !== null) {
        return preserved('candidate temporary document 含有额外 snapshot/node/checkout，绝不整库删除。');
      }
      await repository.deleteDocument(document.id);
      const remains = (await repository.listDocuments()).some((entry) => entry.id === document.id);
      if (remains) return preserved('candidate document 删除后仍存在。', 'failed');
    } else {
      const sourceBundle = await repository.exportDocumentBundle(input.currentBinding.timelineId);
      const sourceNode = sourceBundle.workNodes.find((entry) => entry.id === candidate.sourceTargetId);
      const sourceSnapshot = sourceBundle.snapshots.find((entry) => entry.id === candidate.sourceTargetId);
      const sourceRevision = sourceNode
        ? authoritativeNodeRevision(sourceNode)
        : sourceSnapshot
          ? authoritativeSnapshotRevision(sourceSnapshot)
          : null;
      const expectedParent = resolveSelectionHorizontalParentId(
        sourceNode?.id ?? null,
        sourceNode?.parentNodeId,
      );
      if (sourceRevision !== candidate.sourceRevision
        || (node.parentNodeId ?? null) !== expectedParent) {
        return preserved('candidate source revision/structural parent 无法证明，绝不删除。');
      }
      await client.delete(node.id);
      if ((await client.list()).nodes.some((entry) => entry.id === node.id)) {
        return preserved('candidate node 删除后仍存在。', 'failed');
      }
    }
    return {
      ok: true as const,
      liveCheckoutTouched: false as const,
      deleted: true as const,
      candidate,
      cleanup: selectionCleanupAudit(candidate, 'deleted', input.reason),
      postcondition: { pass: true, liveCheckoutTouched: false, candidateDeleted: true },
    };
  } catch (error) {
    return preserved(
      error instanceof Error ? error.message : String(error),
      'failed',
    );
  }
}
