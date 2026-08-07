import {
  asCommandId,
  asTimelineId,
  type CommandId,
} from '../../../agent/core/contracts/ids.ts';
import { AGENT_LAUNCH_GRANT_FRAGMENT_KEY } from '../../../agent/core/contracts/browser-protocol.ts';
import type { JsonObject, JsonValue } from '../../../agent/core/contracts/json.ts';
import type {
  ApprovalCapabilityClaims,
  ApprovalCapabilityVerificationKey,
  Phase2ProductCommand,
  ProductBinding,
  ProductCommandResult,
} from '../../../agent/core/contracts/index.ts';
import { canonicalJson } from '../../../agent/core/contracts/json.ts';
import type {
  MainWorkbenchCommand,
  MainWorkbenchSnapshot,
  QueuedMainWorkbenchCommand,
} from '../../utils/mainWorkbenchControl';
import { workspaceLease } from '../runtime/workspaceLease';
import {
  browserProductStore,
  type BrowserProductStore,
} from './browserProductStore';
import {
  createDesktopAgentBridge,
  createDesktopAgentConsumerController,
  DESKTOP_AGENT_COMMAND_LONG_POLL_WAIT_MS,
  DESKTOP_AGENT_MODE_PATH,
  requestDesktopAgentModeLaunch,
  type DesktopAgentBridge,
  type DesktopAgentConsumerController,
} from './desktopAgentBridge';
import { parseAgentWorkbenchCommand } from './agentWorkbenchCommand';

const AGENT_COMMAND_SOURCE = 'agent-host';
const PHASE2_ALLOWED_OPERATIONS = new Set([
  'workbench.refresh-snapshot',
  'workbench.execute-command',
]);
const MUTATING_MAIN_COMMANDS = new Set<MainWorkbenchCommand['op']>([
  'selectCharacters',
  'clearTimeline',
  'addSkillButton',
  'removeSkillButton',
  'addBuff',
  'addBuffToButtons',
  'removeBuff',
  'setTargetResistance',
  'saveTimelineSnapshot',
  'restoreTimelineSnapshot',
  'createAiTimelineWorkNodeFromCurrent',
  'deleteAiTimelineWorkNode',
  'patchAiTimelineWorkNode',
  'patchAndValidateAiTimelineWorkNode',
  'applyApprovedWorkNodePatch',
  'checkoutAiTimelineWorkNode',
  'restoreAiTimelineWorkNodeBase',
  'applyPreparedOperatorConfigProposal',
]);
const DESKTOP_AGENT_BOOT_QUERY_KEY = '__agent_mode';
export const AGENT_SELECTION_WORKSPACE_TIMELINE_ID = 'workspace-selection';

type EnqueueCommand = (command: MainWorkbenchCommand, id: string) => void;
type RecoverCommandResult = (commandId: string) => QueuedMainWorkbenchCommand | null;

type SnapshotPublishWaiter = {
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
};

type PendingSnapshotPublish = {
  snapshot: MainWorkbenchSnapshot;
  readonly waiters: SnapshotPublishWaiter[];
};

export interface BrowserAgentRuntimeOptions {
  readonly bridge: Pick<
    DesktopAgentBridge,
    | 'isAgentModeRoute'
    | 'getSessionCapability'
    | 'getApprovalVerificationKey'
    | 'publishSnapshot'
    | 'nextCommand'
    | 'submitCommandResult'
  >;
  readonly consumerController: Pick<
    DesktopAgentConsumerController,
    'getState' | 'refreshEligibility'
  >;
  readonly store: BrowserProductStore;
  readonly postCommandSnapshotTimeoutMs?: number;
  readonly commandLongPollWaitMs?: number;
}

export class BrowserAgentRuntime {
  readonly #bridge: BrowserAgentRuntimeOptions['bridge'];
  readonly #consumerController: BrowserAgentRuntimeOptions['consumerController'];
  readonly #store: BrowserProductStore;
  readonly #postCommandSnapshotTimeoutMs: number;
  readonly #commandLongPollWaitMs: number;
  readonly #pendingHostResults = new Set<CommandId>();
  #binding: ProductBinding | null = null;
  #latestSnapshot: MainWorkbenchSnapshot | null = null;
  #commandCursor = 0;
  #consumerRegistrationKey = '';
  #pendingSnapshot: PendingSnapshotPublish | null = null;
  #publishPromise: Promise<void> | null = null;
  #resultChain = Promise.resolve();
  #pullPromise: Promise<void> | null = null;

  constructor(options: BrowserAgentRuntimeOptions) {
    this.#bridge = options.bridge;
    this.#consumerController = options.consumerController;
    this.#store = options.store;
    this.#postCommandSnapshotTimeoutMs = options.postCommandSnapshotTimeoutMs ?? 1_500;
    this.#commandLongPollWaitMs = Number.isSafeInteger(options.commandLongPollWaitMs)
      ? Math.max(0, options.commandLongPollWaitMs as number)
      : DESKTOP_AGENT_COMMAND_LONG_POLL_WAIT_MS;
  }

  isActive(): boolean {
    return this.#bridge.isAgentModeRoute() && Boolean(this.#bridge.getSessionCapability());
  }

  getBinding(): ProductBinding | null {
    return this.#binding;
  }

  async initializeWorkspace(): Promise<void> {
    if (!this.isActive()) return;
    await this.#store.initialize();
  }

  publishMainWorkbenchSnapshot(snapshot: MainWorkbenchSnapshot): Promise<void> {
    if (!this.isActive()) return Promise.resolve();
    const promise = new Promise<void>((resolve, reject) => {
      const pending = this.#pendingSnapshot;
      if (!pending) {
        this.#pendingSnapshot = { snapshot, waiters: [{ resolve, reject }] };
      } else {
        // A snapshot that has not started its network/store transaction is
        // only a projection hint. Keep the newest binding/revision/digest
        // candidate, while resolving every caller after that newest snapshot
        // has actually been accepted by the Host.
        if (shouldReplacePendingSnapshot(pending.snapshot, snapshot)) {
          pending.snapshot = snapshot;
        }
        pending.waiters.push({ resolve, reject });
      }
    });
    this.#startSnapshotPublishLoop();
    return promise;
  }

  pullRemoteCommands(
    enqueue: EnqueueCommand,
    recoverCommandResult: RecoverCommandResult = () => null,
  ): Promise<void> {
    if (!this.isActive()) return Promise.resolve();
    if (this.#pullPromise) return this.#pullPromise;
    this.#pullPromise = this.#pull(enqueue, recoverCommandResult).finally(() => {
      this.#pullPromise = null;
    });
    return this.#pullPromise;
  }

  pushCommandResult(entry: QueuedMainWorkbenchCommand): Promise<void> {
    if (!this.isActive() || entry.source !== AGENT_COMMAND_SOURCE) return Promise.resolve();
    this.#resultChain = this.#resultChain
      .catch(() => undefined)
      .then(() => this.#recordAndSubmitResult(entry));
    return this.#resultChain;
  }

  async #publishSnapshot(snapshot: MainWorkbenchSnapshot): Promise<void> {
    const timelineId = (
      snapshot.activeTimelineId
      || snapshot.timelineId
      || AGENT_SELECTION_WORKSPACE_TIMELINE_ID
    ).trim();
    const checkoutUpdatedAt = snapshot.checkout?.updatedAt ?? snapshot.updatedAt;
    const contentRevision = snapshot.checkout?.updatedAt ?? snapshot.updatedAt;
    if (
      !Number.isSafeInteger(checkoutUpdatedAt)
      || checkoutUpdatedAt < 0
      || !Number.isSafeInteger(contentRevision)
      || contentRevision < 0
    ) return;
    const runtimeSnapshot = await this.#store.createRuntimeSnapshot({
      timelineId: asTimelineId(timelineId),
      checkoutTargetId: snapshot.checkout?.targetId ?? null,
      checkoutUpdatedAt,
      contentRevision,
      payload: toJsonObject(snapshot),
      capturedAt: new Date(snapshot.updatedAt).toISOString(),
    });
    const currentConsumer = this.#consumerController.getState().consumer;
    const requiresRegistration = !currentConsumer
      || !sameConsumerScope(currentConsumer.binding, runtimeSnapshot.binding);
    if (requiresRegistration) {
      this.#binding = runtimeSnapshot.binding;
      try {
        await this.#consumerController.refreshEligibility();
      } catch (error) {
        this.#binding = null;
        throw error;
      }
    }
    const consumer = this.#consumerController.getState().consumer;
    if (!consumer) {
      if (requiresRegistration) this.#binding = null;
      return;
    }
    try {
      await this.#bridge.publishSnapshot({
        consumerId: consumer.consumerId,
        executorLeaseId: consumer.executorLeaseId,
        snapshot: runtimeSnapshot,
      });
    } catch (error) {
      this.#binding = null;
      await this.#consumerController.refreshEligibility().catch(() => undefined);
      throw error;
    }
    this.#binding = runtimeSnapshot.binding;
    this.#latestSnapshot = cloneSnapshot(snapshot);
    await this.#consumerController.refreshEligibility();
  }

  #startSnapshotPublishLoop(): void {
    if (this.#publishPromise) return;
    const loop = this.#drainSnapshotPublishes();
    this.#publishPromise = loop;
    void loop.then(
      () => this.#finishSnapshotPublishLoop(loop),
      () => this.#finishSnapshotPublishLoop(loop),
    );
  }

  async #drainSnapshotPublishes(): Promise<void> {
    while (this.#pendingSnapshot) {
      const pending = this.#pendingSnapshot;
      this.#pendingSnapshot = null;
      try {
        await this.#publishSnapshot(pending.snapshot);
        for (const waiter of pending.waiters) waiter.resolve();
      } catch (error) {
        for (const waiter of pending.waiters) waiter.reject(error);
      }
    }
  }

  #finishSnapshotPublishLoop(loop: Promise<void>): void {
    if (this.#publishPromise !== loop) return;
    this.#publishPromise = null;
    if (this.#pendingSnapshot) this.#startSnapshotPublishLoop();
  }

  async #pull(enqueue: EnqueueCommand, recoverCommandResult: RecoverCommandResult): Promise<void> {
    const consumer = this.#currentConsumer();
    if (!consumer) return;
    await this.#flushPendingResults(consumer.consumerId, consumer.executorLeaseId);
    if (!this.#isCurrentConsumer(consumer)) return;
    const delivery = await this.#bridge.nextCommand({
      consumerId: consumer.consumerId,
      executorLeaseId: consumer.executorLeaseId,
      afterCursor: this.#commandCursor,
      waitMs: this.#commandLongPollWaitMs,
    });
    if (!this.#isCurrentConsumer(consumer)) return;
    if (!delivery) return;
    const command = delivery.command;
    if ((delivery.mode ?? 'execute') === 'reconcile') {
      await this.#reconcileDelivery(
        command,
        consumer.consumerId,
        consumer.executorLeaseId,
        recoverCommandResult,
      );
      this.#commandCursor = delivery.cursor;
      return;
    }
    const claim = await this.#store.claimCommand(command, consumer.executorLeaseId);
    if (claim.kind === 'rejected') {
      await this.#bridge.submitCommandResult({
        consumerId: consumer.consumerId,
        executorLeaseId: consumer.executorLeaseId,
        result: claim.result,
      });
      this.#commandCursor = delivery.cursor;
      return;
    }
    if (claim.kind === 'already-terminal') {
      const existing = await this.#store.reconcileCommand(command.commandId);
      if (existing) {
        await this.#bridge.submitCommandResult({
          consumerId: consumer.consumerId,
          executorLeaseId: consumer.executorLeaseId,
          result: existing,
        });
      }
      this.#commandCursor = delivery.cursor;
      return;
    }
    if (claim.kind === 'already-claimed' || claim.kind === 'already-pending') {
      // A renderer restart can see a browser journal row that was accepted by
      // an earlier renderer but never received a terminal receipt. Treat it
      // exactly like a recovered command: never enqueue the business
      // mutation a second time.
      await this.#reconcileDelivery(
        command,
        consumer.consumerId,
        consumer.executorLeaseId,
        recoverCommandResult,
      );
      this.#commandCursor = delivery.cursor;
      return;
    }
    if (!PHASE2_ALLOWED_OPERATIONS.has(command.command.op)) {
      const result = await this.#store.recordCommandResult(command.commandId, {
        status: 'rejected',
        code: 'AGENT_OPERATION_NOT_ALLOWED',
        message: `Phase 2 does not allow ${command.command.op}`,
        beforeRevision: command.expected.contentRevision,
        afterRevision: command.expected.contentRevision,
        executorLeaseId: consumer.executorLeaseId,
      });
      await this.#bridge.submitCommandResult({
        consumerId: consumer.consumerId,
        executorLeaseId: consumer.executorLeaseId,
        result,
      });
      this.#commandCursor = delivery.cursor;
      return;
    }
    let localCommand: MainWorkbenchCommand;
    try {
      localCommand = toMainWorkbenchCommand(command);
      await validateCommandApproval(command, localCommand, this.#bridge.getApprovalVerificationKey());
    } catch (error) {
      const result = await this.#store.recordCommandResult(command.commandId, {
        status: 'rejected',
        code: error instanceof AgentCommandValidationError
          ? error.code
          : 'AGENT_COMMAND_INVALID',
        message: error instanceof Error ? error.message : String(error),
        beforeRevision: command.expected.contentRevision,
        afterRevision: command.expected.contentRevision,
        executorLeaseId: consumer.executorLeaseId,
      });
      await this.#bridge.submitCommandResult({
        consumerId: consumer.consumerId,
        executorLeaseId: consumer.executorLeaseId,
        result,
      });
      this.#commandCursor = delivery.cursor;
      return;
    }
    enqueue(localCommand, command.commandId);
    this.#commandCursor = delivery.cursor;
  }

  async #reconcileDelivery(
    command: Phase2ProductCommand,
    consumerId: string,
    executorLeaseId: string,
    recoverCommandResult: RecoverCommandResult,
  ): Promise<void> {
    // A recovered Host command is read-only from the browser's perspective.
    // In particular, do not call claimCommand: that path is allowed to enqueue
    // a fresh Canvas mutation. Only an already durable browser receipt/result
    // can be sent back to the Host.
    const existingResult = await this.#store.reconcileCommand(command.commandId);
    if (existingResult) {
      await this.#bridge.submitCommandResult({
        consumerId,
        executorLeaseId,
        result: existingResult,
      });
      return;
    }

    // Canvas writes its terminal business result to the persistent Main
    // Workbench result log before the asynchronous Agent receipt is stored.
    // A renderer crash in that small window must recover this durable result,
    // never relabel an already-applied mutation as "not executed".
    const recoveredEntry = recoverCommandResult(command.commandId);
    if (
      recoveredEntry?.id === command.commandId
      && recoveredEntry.source === AGENT_COMMAND_SOURCE
      && (recoveredEntry.status === 'done' || recoveredEntry.status === 'error')
    ) {
      await this.#recordAndSubmitResult(recoveredEntry);
      return;
    }

    const journal = await this.#store.getCommand(command.commandId);
    const result: ProductCommandResult = {
      commandId: command.commandId,
      status: 'not-executed',
      code: journal ? 'AGENT_COMMAND_RECONCILE_NO_RECEIPT' : 'AGENT_COMMAND_RECONCILE_UNKNOWN',
      message: journal
        ? '重启后只允许核对已有回执；浏览器没有找到终态回执，因此不会再次执行此命令。'
        : '重启后只允许核对已有回执；浏览器没有找到此命令，因此明确标记为未执行。',
      beforeRevision: journal?.beforeRevision ?? command.expected.contentRevision,
      afterRevision: journal?.beforeRevision ?? command.expected.contentRevision,
      executorLeaseId,
      completedAt: new Date().toISOString(),
    };
    let reconciledResult = result;
    if (journal) {
      // Persist the fail-closed decision in the browser journal before the Host
      // acknowledgement. A later poll must observe the same terminal result.
      // Keep the lease that owns the existing journal row; the current browser
      // lease is a different observation session after a renderer restart and
      // must not be used to rewrite that durable row.
      const persisted = await this.#store.recordCommandResult(command.commandId, {
        ...result,
        ...(journal.executorLeaseId ? { executorLeaseId: journal.executorLeaseId } : {}),
      });
      reconciledResult = persisted;
    }
    await this.#bridge.submitCommandResult({
      consumerId,
      executorLeaseId,
      result: reconciledResult,
    });
  }

  async #recordAndSubmitResult(entry: QueuedMainWorkbenchCommand): Promise<void> {
    const commandId = asCommandId(entry.id);
    const journal = await this.#store.getCommand(commandId);
    if (!journal) return;
    const expectedVisiblePostcondition = expectedVisiblePostconditionFromJournal(journal.command);
    const requiresObservation = entry.status === 'done'
      && (
        MUTATING_MAIN_COMMANDS.has(entry.command.op)
        || expectedVisiblePostcondition !== null
      );
    const observation: PostconditionObservation = entry.status === 'done'
      ? await this.#waitForPostCommandObservation({
          expectedDigest: journal.expectedDigest,
          expectedRevision: journal.expectedRevision,
          requiresNewSnapshot: requiresObservation,
          expectedVisiblePostcondition,
          entry,
        })
      : { pass: false, reason: entry.error || 'Main Workbench command failed.' };
    const currentRevision = this.#binding?.contentRevision ?? journal.expectedRevision;
    const succeeded = entry.status === 'done' && observation.pass;
    const result = await this.#store.recordCommandResult(commandId, {
      status: succeeded ? 'succeeded' : 'error',
      ...(entry.status === 'error'
        ? { code: 'MAIN_WORKBENCH_COMMAND_FAILED', message: entry.error || 'Main Workbench command failed' }
        : !observation.pass
          ? {
              code: 'AGENT_POSTCONDITION_NOT_OBSERVED',
              message: `工作台命令已经返回，但精确业务后置条件未成立；为避免误报，本次不标记为成功。${observation.reason ? ` ${observation.reason}` : ''}`,
            }
          : {}),
      beforeRevision: journal.expectedRevision,
      afterRevision: currentRevision,
      browserResult: toJsonValue(entry.result),
      visiblePostcondition: {
        pass: observation.pass,
        expected: expectedVisiblePostcondition,
        observed: observation.observed ?? null,
        contentRevision: currentRevision,
        snapshotDigest: this.#binding?.snapshotDigest ?? journal.expectedDigest,
        binding: this.#binding ? { ...this.#binding } : null,
      },
      executorLeaseId: journal.executorLeaseId || undefined,
    });
    this.#pendingHostResults.add(commandId);
    const consumer = this.#currentConsumer();
    if (consumer) await this.#flushPendingResults(consumer.consumerId, consumer.executorLeaseId);
    void result;
  }

  async #waitForPostCommandObservation(input: {
    readonly expectedDigest: string;
    readonly expectedRevision: number;
    readonly requiresNewSnapshot: boolean;
    readonly expectedVisiblePostcondition: JsonObject | null;
    readonly entry: QueuedMainWorkbenchCommand;
  }): Promise<PostconditionObservation> {
    const observe = (): PostconditionObservation => {
      const binding = this.#binding;
      const snapshot = this.#latestSnapshot;
      if (!binding || !snapshot) {
        return { pass: false, reason: '浏览器尚未发布可验证的工作台快照。' };
      }
      if (
        input.requiresNewSnapshot
        && binding.snapshotDigest === input.expectedDigest
        && binding.contentRevision === input.expectedRevision
      ) {
        return { pass: false, reason: '浏览器持久化快照没有更新。' };
      }
      const resultObservation = evaluateCommandResultPostcondition(input.entry, snapshot);
      if (!resultObservation.pass) return resultObservation;
      if (input.expectedVisiblePostcondition) {
        const projection = buildVisiblePostconditionProjection(snapshot, binding, input.entry.result);
        if (!isJsonSubset(input.expectedVisiblePostcondition, projection)) {
          return {
            pass: false,
            reason: '工具声明的可见后置条件与最新工作台快照不一致。',
            observed: projection,
          };
        }
        return { pass: true, observed: projection };
      }
      return {
        pass: true,
        observed: resultObservation.observed
          ?? buildVisiblePostconditionProjection(snapshot, binding, input.entry.result),
      };
    };
    const first = observe();
    if (first.pass) return first;
    const deadline = Date.now() + this.#postCommandSnapshotTimeoutMs;
    while (Date.now() < deadline) {
      const current = observe();
      if (current.pass) return current;
      await new Promise<void>((resolve) => setTimeout(resolve, 16));
    }
    return observe();
  }

  async #flushPendingResults(consumerId: string, executorLeaseId: string): Promise<void> {
    for (const commandId of [...this.#pendingHostResults]) {
      const result = await this.#store.reconcileCommand(commandId);
      if (!result) continue;
      try {
        await this.#bridge.submitCommandResult({ consumerId, executorLeaseId, result });
        this.#pendingHostResults.delete(commandId);
      } catch {
        return;
      }
    }
  }

  #currentConsumer() {
    const consumer = this.#consumerController.getState().consumer;
    if (!consumer) {
      this.#consumerRegistrationKey = '';
      return null;
    }
    const key = `${consumer.consumerId}:${consumer.executorLeaseId}:${consumer.registeredAt}`;
    if (key !== this.#consumerRegistrationKey) {
      this.#consumerRegistrationKey = key;
      this.#commandCursor = 0;
    }
    return consumer;
  }

  #isCurrentConsumer(expected: {
    readonly consumerId: string;
    readonly executorLeaseId: string;
    readonly registeredAt: number;
  }): boolean {
    const current = this.#consumerController.getState().consumer;
    return Boolean(
      current
      && current.consumerId === expected.consumerId
      && current.executorLeaseId === expected.executorLeaseId
      && current.registeredAt === expected.registeredAt,
    );
  }
}

type PostconditionObservation = {
  readonly pass: boolean;
  readonly reason?: string;
  readonly observed?: JsonValue;
};

function expectedVisiblePostconditionFromJournal(command: JsonObject): JsonObject | null {
  if (command.op !== 'workbench.execute-command') return null;
  const payload = asJsonObject(command.payload);
  const expected = asJsonObject(payload?.visiblePostcondition);
  return expected ? structuredClone(expected) : null;
}

function evaluateCommandResultPostcondition(
  entry: QueuedMainWorkbenchCommand,
  snapshot: MainWorkbenchSnapshot,
): PostconditionObservation {
  const result = asJsonObject(entry.result);
  if (!result) {
    return entry.command.op === 'refreshSnapshot'
      ? { pass: true }
      : { pass: false, reason: `命令 ${entry.command.op} 没有返回可验证的业务结果。` };
  }

  const localVisiblePostcondition = asJsonObject(result.visiblePostcondition)
    ?? asJsonObject(asJsonObject(result.checkout)?.visiblePostcondition);
  if (localVisiblePostcondition?.pass !== undefined && localVisiblePostcondition.pass !== true) {
    return {
      pass: false,
      reason: 'Canvas 返回的可见按钮后置检查没有通过。',
      observed: localVisiblePostcondition,
    };
  }

  if (entry.command.op === 'selectCharacters') {
    const selected = jsonObjectArray(result.selectedCharacters);
    // Roster order is product data. Sorting here used to let a failed reorder
    // pass as long as the member set stayed the same.
    const expectedIds = selected.map((character) => character.id).filter(isString);
    const expectedNames = selected.map((character) => character.name).filter(isString);
    const actualIds = snapshot.selectedCharacters.map((character) => character.id);
    const actualNames = snapshot.selectedCharacters.map((character) => character.name);
    const pass = expectedIds.length > 0
      && expectedIds.length === selected.length
      && expectedNames.length === selected.length
      && sameStringArray(expectedIds, actualIds)
      && sameStringArray(expectedNames, actualNames);
    return {
      pass,
      ...(pass ? {} : { reason: '当前工作台队伍或成员顺序与选择命令返回的精确队伍不一致。' }),
      observed: { selectedCharacterIds: actualIds, selectedCharacterNames: actualNames },
    };
  }

  if (entry.command.op === 'addSkillButton') {
    const buttonId = isString(result.buttonId) ? result.buttonId : '';
    const pass = Boolean(buttonId) && snapshot.skillButtons.some((button) => button.id === buttonId);
    return { pass, ...(pass ? {} : { reason: '新增技能按钮没有出现在工作台快照中。' }) };
  }

  if (entry.command.op === 'removeSkillButton') {
    const buttonId = isString(result.buttonId) ? result.buttonId : '';
    const pass = Boolean(buttonId) && snapshot.skillButtons.every((button) => button.id !== buttonId);
    return { pass, ...(pass ? {} : { reason: '已删除技能按钮仍出现在工作台快照中。' }) };
  }

  if (entry.command.op === 'addBuff') {
    const buttonId = isString(result.buttonId) ? result.buttonId : '';
    const buffId = isString(result.buffId) ? result.buffId : '';
    const button = snapshot.skillButtons.find((candidate) => candidate.id === buttonId);
    const pass = Boolean(button && buffId && button.selectedBuffIds.includes(buffId));
    return { pass, ...(pass ? {} : { reason: '新增 Buff 没有附着到目标按钮快照。' }) };
  }

  if (entry.command.op === 'removeBuff') {
    const buttonId = isString(result.buttonId) ? result.buttonId : '';
    const removedBuffIds = stringArrayValue(result.removedBuffIds);
    const button = snapshot.skillButtons.find((candidate) => candidate.id === buttonId);
    const pass = Boolean(button && removedBuffIds.length)
      && removedBuffIds.every((buffId) => !button?.selectedBuffIds.includes(buffId));
    return { pass, ...(pass ? {} : { reason: '已移除 Buff 仍出现在目标按钮快照中。' }) };
  }

  if (entry.command.op === 'applyApprovedWorkNodePatch') {
    const prepared = asJsonObject(result.prepared);
    const checkout = asJsonObject(result.checkout);
    const visible = asJsonObject(result.visiblePostcondition) ?? asJsonObject(checkout?.visiblePostcondition);
    const patchLength = Array.isArray(entry.command.patch) ? entry.command.patch.length : 0;
    const expectedIds = stringArrayValue(visible?.expected);
    const actualIds = snapshot.skillButtons.map((button) => button.id).sort();
    const nodeId = isString(checkout?.nodeId)
      ? checkout.nodeId
      : isString(prepared?.nodeId)
        ? prepared.nodeId
        : '';
    const pass = prepared?.ok === true
      && prepared.patchApplied === true
      && prepared.operationsApplied === patchLength
      && checkout?.checkoutApplied === true
      && visible?.pass === true
      && expectedIds.length === actualIds.length
      && sameStringArray([...expectedIds].sort(), actualIds)
      && Boolean(nodeId)
      && snapshot.checkout?.targetType === 'work-node'
      && snapshot.checkout.targetId === nodeId;
    return {
      pass,
      ...(pass ? {} : { reason: 'Work Node 的补丁、检出记录或精确可见按钮集合没有同时成立。' }),
      observed: {
        checkoutTargetId: snapshot.checkout?.targetId ?? null,
        visibleButtonIdsExact: actualIds,
      },
    };
  }

  if (entry.command.op === 'applyPreparedOperatorConfigProposal') {
    const visible = asJsonObject(result.visiblePostcondition);
    const finalConfig = asJsonObject(result.finalConfig);
    const nodeId = isString(result.nodeId) ? result.nodeId : '';
    const commitId = isString(result.commitId) ? result.commitId : '';
    const operatorConfigObserved = finalConfig
      ? snapshotOperatorConfigMatches(snapshot, finalConfig)
      : false;
    const pass = result.ok === true
      && result.applied === true
      && result.checkoutApplied === true
      && result.finalized === true
      && visible?.pass === true
      && Boolean(nodeId)
      && Boolean(commitId)
      && snapshot.checkout?.targetType === 'work-node'
      && snapshot.checkout.targetId === nodeId
      && operatorConfigObserved;
    return {
      pass,
      ...(pass ? {} : {
        reason: '配装候选、commit、checkout、finalize 或 live 配置没有同时通过精确后置检查。',
      }),
      observed: {
        checkoutTargetId: snapshot.checkout?.targetId ?? null,
        nodeId,
        commitId,
        operatorConfigObserved,
        finalConfig: finalConfig ?? null,
        visiblePostcondition: visible ?? null,
      },
    };
  }

  if (entry.command.op === 'restoreAiTimelineWorkNodeBase') {
    const visible = asJsonObject(result.visiblePostcondition);
    const expected = asJsonObject(visible?.expected);
    const observed = asJsonObject(visible?.observed);
    const checkout = asJsonObject(result.checkout);
    const expectedCheckout = asJsonObject(expected?.checkout);
    const observedCheckout = asJsonObject(observed?.checkout);
    const expectedButtonIds = stringArrayValue(expected?.visibleButtonIds).sort();
    const observedButtonIds = stringArrayValue(observed?.visibleButtonIds).sort();
    const actualButtonIds = snapshot.skillButtons.map((button) => button.id).sort();
    const digestFields = [
      'payloadDigest',
      'timelineDigest',
      'buttonDigest',
      'buffDigest',
      'resistanceDigest',
      'operatorConfigDigest',
    ];
    const receiptDigestsAreExact = digestFields.every((field) => (
      isString(expected?.[field])
      && isString(observed?.[field])
      && expected?.[field] === observed?.[field]
    ));
    const checkoutIsExact = Boolean(
      checkout
      && expectedCheckout
      && observedCheckout
      && checkout.targetType === expectedCheckout.targetType
      && checkout.targetId === expectedCheckout.targetId
      && checkout.targetType === observedCheckout.targetType
      && checkout.targetId === observedCheckout.targetId
      && snapshot.checkout?.targetType === checkout.targetType
      && snapshot.checkout.targetId === checkout.targetId
      && snapshot.checkout.updatedAt === checkout.updatedAt,
    );
    const checkoutRevisionIsExact = Number.isSafeInteger(result.checkoutTargetRevision)
      && Number.isSafeInteger(expected?.nodeRevision)
      && result.checkoutTargetRevision === expected?.nodeRevision;
    const pass = result.ok === true
      && result.done === true
      && result.rollbackApplied === true
      && result.rollbackMarkError === null
      && visible?.pass === true
      && Array.isArray(visible.failures)
      && visible.failures.length === 0
      && receiptDigestsAreExact
      && expectedButtonIds.length === actualButtonIds.length
      && sameStringArray(expectedButtonIds, actualButtonIds)
      && observedButtonIds.length === actualButtonIds.length
      && sameStringArray(observedButtonIds, actualButtonIds)
      && checkoutIsExact
      && checkoutRevisionIsExact
      && isString(result.basePayloadDigest)
      && result.basePayloadDigest === observed?.payloadDigest
      && result.nodeId === entry.command.nodeId
      && Number.isSafeInteger(result.nodeRevision);
    return {
      pass,
      ...(pass ? {} : { reason: 'Work Node restore 没有同时满足 rollback ledger、checkout revision、payload digest 和可见状态精确后置条件。' }),
      observed: {
        checkout: snapshot.checkout ?? null,
        visibleButtonIds: actualButtonIds,
        payloadDigest: observed?.payloadDigest ?? null,
        nodeRevision: result.nodeRevision ?? null,
        checkoutTargetRevision: result.checkoutTargetRevision ?? null,
      },
    };
  }

  if (entry.command.op === 'deleteAiTimelineWorkNode') {
    const ledger = asJsonObject(result.ledgerPostcondition);
    const deletedNodeIds = stringArrayValue(result.deletedNodeIds).sort();
    const ledgerDeletedNodeIds = stringArrayValue(ledger?.deletedNodeIds).sort();
    const ledgerRemainingNodeIds = stringArrayValue(ledger?.remainingNodeIds).sort();
    const checkoutStillPointsToDeletedNode = Boolean(
      snapshot.checkout?.targetType === 'work-node'
      && deletedNodeIds.includes(snapshot.checkout.targetId),
    );
    const pass = result.ok === true
      && result.deleted === true
      && ledger?.pass === true
      && deletedNodeIds.length > 0
      && sameStringArray(deletedNodeIds, ledgerDeletedNodeIds)
      && Number(result.remainingNodeCount) === ledgerRemainingNodeIds.length
      && !checkoutStillPointsToDeletedNode;
    return {
      pass,
      ...(pass ? {} : { reason: 'Work Node 删除没有提供完整子树已从 SQLite ledger 消失的证据。' }),
      observed: {
        deletedNodeIds,
        ledgerDeletedNodeIds,
        remainingNodeIds: ledgerRemainingNodeIds,
        checkout: snapshot.checkout ?? null,
      },
    };
  }

  if (entry.command.op === 'checkoutAiTimelineWorkNode') {
    const visible = asJsonObject(result.visiblePostcondition);
    const expected = asJsonObject(visible?.expected);
    const observed = asJsonObject(visible?.observed);
    const checkout = asJsonObject(result.checkout);
    const expectedCheckout = asJsonObject(expected?.checkout);
    const observedCheckout = asJsonObject(observed?.checkout);
    const expectedButtonIds = stringArrayValue(expected?.visibleButtonIds).sort();
    const observedButtonIds = stringArrayValue(observed?.visibleButtonIds).sort();
    const actualButtonIds = snapshot.skillButtons.map((button) => button.id).sort();
    const exactPathDigests = ['payloadDigest', 'timelineDigest', 'buttonDigest', 'buffDigest', 'resistanceDigest', 'operatorConfigDigest']
      .every((field) => isString(expected?.[field]) && expected?.[field] === observed?.[field]);
    const pass = result.ok === true
      && result.done === true
      && result.checkoutApplied === true
      && visible?.pass === true
      && Array.isArray(visible.failures)
      && visible.failures.length === 0
      && exactPathDigests
      && expectedButtonIds.length === actualButtonIds.length
      && sameStringArray(expectedButtonIds, actualButtonIds)
      && observedButtonIds.length === actualButtonIds.length
      && sameStringArray(observedButtonIds, actualButtonIds)
      && isString(result.nodeId)
      && Number.isSafeInteger(result.nodeRevision)
      && checkout?.targetType === 'work-node'
      && checkout.targetId === result.nodeId
      && expectedCheckout?.targetType === checkout.targetType
      && expectedCheckout?.targetId === checkout.targetId
      && observedCheckout?.targetType === checkout.targetType
      && observedCheckout?.targetId === checkout.targetId
      && snapshot.checkout?.targetType === checkout.targetType
      && snapshot.checkout.targetId === checkout.targetId
      && snapshot.checkout.updatedAt === checkout.updatedAt
      && Number.isSafeInteger(result.checkoutTargetRevision)
      && result.checkoutTargetRevision === expected?.nodeRevision
      && result.nodeId === entry.command.nodeId;
    return {
      pass,
      ...(pass ? {} : { reason: 'Work Node use/checkout 没有同时满足 checkout、revision、payload digest 和可见状态精确后置条件。' }),
      observed: {
        checkout: snapshot.checkout ?? null,
        visibleButtonIds: actualButtonIds,
        nodeRevision: result.nodeRevision ?? null,
        checkoutTargetRevision: result.checkoutTargetRevision ?? null,
      },
    };
  }

  if (result.ok === false) {
    return { pass: false, reason: `命令 ${entry.command.op} 返回 ok:false。`, observed: result };
  }
  if (result.validation && asJsonObject(result.validation)?.ok === false) {
    return { pass: false, reason: `命令 ${entry.command.op} 的业务校验失败。`, observed: result.validation };
  }
  if (result.checkoutApplied === false || result.patchApplied === false) {
    return { pass: false, reason: `命令 ${entry.command.op} 的持久化应用步骤没有完成。`, observed: result };
  }
  return { pass: true };
}

function buildVisiblePostconditionProjection(
  snapshot: MainWorkbenchSnapshot,
  binding: ProductBinding,
  commandResult: unknown,
): JsonObject {
  return {
    ...toJsonObject(snapshot),
    contentRevision: binding.contentRevision,
    snapshotDigest: binding.snapshotDigest,
    binding: { ...binding },
    selectedCharacterIds: snapshot.selectedCharacters.map((character) => character.id).sort(),
    selectedCharacterNames: snapshot.selectedCharacters.map((character) => character.name).sort(),
    visibleButtonIdsExact: snapshot.skillButtons.map((button) => button.id).sort(),
    checkoutTargetId: snapshot.checkout?.targetId ?? null,
    commandResult: toJsonValue(commandResult),
  };
}

function isJsonSubset(expected: JsonValue, actual: JsonValue): boolean {
  if (Array.isArray(expected)) {
    return Array.isArray(actual)
      && expected.length === actual.length
      && expected.every((entry, index) => isJsonSubset(entry, actual[index] as JsonValue));
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
    return Object.entries(expected).every(([key, value]) => (
      Object.prototype.hasOwnProperty.call(actual, key)
      && isJsonSubset(value, (actual as JsonObject)[key] as JsonValue)
    ));
  }
  return Object.is(expected, actual);
}

function asJsonObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function jsonObjectArray(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.map(asJsonObject).filter((entry): entry is JsonObject => Boolean(entry)) : [];
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isString) : [];
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function snapshotOperatorConfigMatches(snapshot: MainWorkbenchSnapshot, finalConfig: JsonObject): boolean {
  const characterId = finalConfig.characterId;
  if (!isString(characterId)) return false;
  const actual = snapshot.operatorConfigs?.find((config) => config.characterId === characterId);
  if (!actual) return false;
  if (isString(finalConfig.characterName) && finalConfig.characterName !== actual.characterName) return false;
  const expectedWeapon = asJsonObject(finalConfig.weapon);
  if (!expectedWeapon || !actual.weapon) return false;
  for (const key of ['id', 'name', 'level', 'potential'] as const) {
    if (!Object.is(expectedWeapon[key], actual.weapon[key])) return false;
  }
  const expectedWeaponSkills = asJsonObject(expectedWeapon.skillLevels);
  const actualWeaponSkills = actual.weapon.skillLevels ?? {};
  const actualWeaponSkillRecord = actualWeaponSkills as Record<string, unknown>;
  if (!expectedWeaponSkills
    || !Object.keys(expectedWeaponSkills).every((key) => Object.is(expectedWeaponSkills[key], actualWeaponSkillRecord[key]))
    || !Object.keys(actualWeaponSkillRecord).every((key) => Object.prototype.hasOwnProperty.call(expectedWeaponSkills, key))) {
    return false;
  }
  const expectedEquipment = Array.isArray(finalConfig.equipment) ? finalConfig.equipment : null;
  if (!expectedEquipment || expectedEquipment.length !== actual.equipment.length) return false;
  const expectedEquipmentEntries = expectedEquipment
    .map(asJsonObject)
    .filter((entry): entry is JsonObject => Boolean(entry));
  const expectedEquipmentIds = expectedEquipmentEntries
    .map((entry) => `${String(entry.slotKey ?? '')}:${String(entry.equipmentId ?? '')}`)
    .sort();
  const actualEquipmentIds = actual.equipment
    .map((entry) => `${entry.slotKey}:${entry.equipmentId}`)
    .sort();
  if (!sameStringArray(expectedEquipmentIds, actualEquipmentIds)) return false;
  for (const expectedEquipmentEntry of expectedEquipmentEntries) {
    const actualEquipment = actual.equipment.find((entry) => (
      entry.slotKey === expectedEquipmentEntry.slotKey
      && entry.equipmentId === expectedEquipmentEntry.equipmentId
    ));
    if (!actualEquipment || expectedEquipmentEntry.name !== actualEquipment.name) return false;
    const expectedEffects = Array.isArray(expectedEquipmentEntry.effects)
      ? expectedEquipmentEntry.effects.map(asJsonObject).filter((entry): entry is JsonObject => Boolean(entry))
      : [];
    if (expectedEffects.length !== actualEquipment.effects.length) return false;
    const expectedEffectKeys = expectedEffects.map((effect) => (
      `${String(effect.effectId ?? '')}:${String(effect.label ?? '')}:${String(effect.level ?? '')}:${String(effect.value ?? '')}`
    )).sort();
    const actualEffectKeys = actualEquipment.effects.map((effect) => (
      `${effect.effectId}:${effect.label}:${effect.level}:${effect.value}`
    )).sort();
    if (!sameStringArray(expectedEffectKeys, actualEffectKeys)) return false;
  }
  const expectedSkills = asJsonObject(finalConfig.operatorSkillLevels);
  if (!expectedSkills) return false;
  const actualSkills = actual.operatorSkillLevels ?? {};
  const actualSkillRecord = actualSkills as Record<string, unknown>;
  return Object.keys(expectedSkills).every((key) => Object.is(expectedSkills[key], actualSkillRecord[key]))
    && Object.keys(actualSkills).every((key) => Object.prototype.hasOwnProperty.call(expectedSkills, key));
}

function cloneSnapshot(snapshot: MainWorkbenchSnapshot): MainWorkbenchSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as MainWorkbenchSnapshot;
}

function snapshotMergeKey(snapshot: MainWorkbenchSnapshot): string {
  const timelineId = (
    snapshot.activeTimelineId
    || snapshot.timelineId
    || AGENT_SELECTION_WORKSPACE_TIMELINE_ID
  ).trim();
  const checkout = snapshot.checkout;
  const revision = checkout?.updatedAt ?? snapshot.updatedAt;
  let digestHint = '';
  try {
    digestHint = canonicalJson(JSON.parse(JSON.stringify(snapshot)) as JsonObject);
  } catch {
    digestHint = String(snapshot.updatedAt);
  }
  return [
    timelineId,
    checkout?.targetType ?? 'none',
    checkout?.targetId ?? '',
    String(revision),
    digestHint,
  ].join('|');
}

function shouldReplacePendingSnapshot(
  current: MainWorkbenchSnapshot,
  next: MainWorkbenchSnapshot,
): boolean {
  // The caller order is the renderer's authoritative projection order. A
  // checkout can legitimately move to a lower numeric revision, so never
  // retain an older projection merely because its revision compares larger.
  return snapshotMergeKey(current) !== snapshotMergeKey(next);
}

function sameConsumerScope(left: ProductBinding, right: ProductBinding): boolean {
  return left.workspaceId === right.workspaceId
    && left.databaseGeneration === right.databaseGeneration
    && left.timelineId === right.timelineId;
}

function toMainWorkbenchCommand(command: Phase2ProductCommand): MainWorkbenchCommand {
  if (command.command.op === 'workbench.refresh-snapshot') return { op: 'refreshSnapshot' };
  if (command.command.op === 'workbench.execute-command') {
    return parseAgentWorkbenchCommand(command.command.payload.command);
  }
  throw new Error('Unsupported Phase 2 operation');
}

class AgentCommandValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AgentCommandValidationError';
    this.code = code;
  }
}

async function validateCommandApproval(
  command: Phase2ProductCommand,
  localCommand: MainWorkbenchCommand,
  verificationKey: ApprovalCapabilityVerificationKey | null,
): Promise<void> {
  const mutating = MUTATING_MAIN_COMMANDS.has(localCommand.op);
  if (!mutating) {
    if (command.approvalCapability) {
      throw new AgentCommandValidationError(
        'AGENT_APPROVAL_UNEXPECTED',
        `非写入命令 ${localCommand.op} 不应携带批准凭据。`,
      );
    }
    return;
  }
  if (!command.approvalCapability) {
    throw new AgentCommandValidationError(
      'AGENT_APPROVAL_REQUIRED',
      `写入命令 ${localCommand.op} 缺少用户批准凭据。`,
    );
  }
  if (!verificationKey) {
    throw new AgentCommandValidationError(
      'AGENT_APPROVAL_KEY_REQUIRED',
      '当前 AI 页面缺少可信的批准验签公钥。',
    );
  }
  const claims = await decodeApprovalCapability(command.approvalCapability, verificationKey);
  if (
    claims.commandId !== command.commandId
    || claims.defSessionId !== command.defSessionId
    || claims.defTurnId !== command.defTurnId
    || claims.toolCallId !== command.toolCallId
  ) {
    throw new AgentCommandValidationError(
      'AGENT_APPROVAL_CORRELATION_MISMATCH',
      '批准凭据与当前 Agent 命令不匹配。',
    );
  }
  if (!sameProductBinding(claims.binding, command.expected)) {
    throw new AgentCommandValidationError(
      'AGENT_APPROVAL_BINDING_MISMATCH',
      '批准凭据绑定的工作区版本与当前命令不一致。',
    );
  }
  const expiresAt = Date.parse(claims.expiresAt);
  const issuedAt = Date.parse(claims.issuedAt);
  if (
    !Number.isFinite(expiresAt)
    || !Number.isFinite(issuedAt)
    || issuedAt > expiresAt
    || expiresAt <= Date.now()
  ) {
    throw new AgentCommandValidationError(
      'AGENT_APPROVAL_EXPIRED',
      '批准凭据已经过期。',
    );
  }
  const proposal = {
    command: command.command.op === 'workbench.execute-command'
      ? command.command.payload.command
      : null,
    scope: [...claims.scope],
  };
  const proposalHash = await sha256Hex(canonicalJson(proposal));
  if (proposalHash !== claims.proposalHash) {
    throw new AgentCommandValidationError(
      'AGENT_APPROVAL_PROPOSAL_MISMATCH',
      '批准凭据对应的提案与当前浏览器命令不一致。',
    );
  }
}

async function decodeApprovalCapability(
  value: string,
  verificationKey: ApprovalCapabilityVerificationKey,
): Promise<ApprovalCapabilityClaims> {
  if (value.length > 32_000) {
    throw new AgentCommandValidationError('AGENT_APPROVAL_INVALID', '批准凭据格式无效。');
  }
  const segments = value.split('.');
  if (
    segments.length !== 3
    || segments[0] !== 'v1'
    || !/^[A-Za-z0-9_-]+$/u.test(segments[1] ?? '')
    || !/^[A-Za-z0-9_-]+$/u.test(segments[2] ?? '')
  ) {
    throw new AgentCommandValidationError('AGENT_APPROVAL_INVALID', '批准凭据格式无效。');
  }
  if (
    verificationKey.algorithm !== 'Ed25519'
    || !/^[A-Za-z0-9_-]{16,128}$/u.test(verificationKey.keyEpoch)
    || !/^[A-Za-z0-9_-]{32,1000}$/u.test(verificationKey.publicKeySpki)
  ) {
    throw new AgentCommandValidationError('AGENT_APPROVAL_KEY_INVALID', '批准验签公钥无效。');
  }
  if (!globalThis.crypto?.subtle) {
    throw new AgentCommandValidationError('AGENT_APPROVAL_CRYPTO_UNAVAILABLE', '浏览器无法校验批准凭据。');
  }
  let signatureValid = false;
  try {
    const publicKey = await globalThis.crypto.subtle.importKey(
      'spki',
      decodeBase64Url(verificationKey.publicKeySpki),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    signatureValid = await globalThis.crypto.subtle.verify(
      { name: 'Ed25519' },
      publicKey,
      decodeBase64Url(segments[2]!),
      new TextEncoder().encode(`v1.${segments[1]}`),
    );
  } catch {
    throw new AgentCommandValidationError('AGENT_APPROVAL_SIGNATURE_INVALID', '批准凭据签名无法校验。');
  }
  if (!signatureValid) {
    throw new AgentCommandValidationError('AGENT_APPROVAL_SIGNATURE_INVALID', '批准凭据签名无效。');
  }
  let decoded: unknown;
  let payload = '';
  try {
    payload = new TextDecoder().decode(decodeBase64Url(segments[1]!));
    decoded = JSON.parse(payload);
  } catch {
    throw new AgentCommandValidationError('AGENT_APPROVAL_INVALID', '批准凭据无法解析。');
  }
  if (!isApprovalCapabilityClaims(decoded)) {
    throw new AgentCommandValidationError('AGENT_APPROVAL_INVALID', '批准凭据内容无效。');
  }
  if (
    decoded.keyEpoch !== verificationKey.keyEpoch
    || canonicalJson(decoded as unknown as JsonValue) !== payload
  ) {
    throw new AgentCommandValidationError(
      'AGENT_APPROVAL_KEY_MISMATCH',
      '批准凭据不属于当前 Agent Host 或载荷不是规范编码。',
    );
  }
  return decoded;
}

function decodeBase64Url(value: string): ArrayBuffer {
  const normalized = value.replace(/-/gu, '+').replace(/_/gu, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer as ArrayBuffer;
}

function isApprovalCapabilityClaims(value: unknown): value is ApprovalCapabilityClaims {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const expectedKeys = [
    'schemaVersion',
    'audience',
    'keyEpoch',
    'nonce',
    'issuedAt',
    'expiresAt',
    'interactionId',
    'commandId',
    'defSessionId',
    'defTurnId',
    'toolCallId',
    'proposalHash',
    'binding',
    'scope',
  ];
  return Object.keys(candidate).length === expectedKeys.length
    && expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(candidate, key))
    && candidate.schemaVersion === 1
    && candidate.audience === 'browser-product-gateway'
    && ['keyEpoch', 'nonce', 'issuedAt', 'expiresAt', 'interactionId', 'commandId', 'defSessionId', 'defTurnId', 'toolCallId', 'proposalHash']
      .every((key) => typeof candidate[key] === 'string' && Boolean((candidate[key] as string).trim()))
    && isProductBinding(candidate.binding)
    && Array.isArray(candidate.scope)
    && candidate.scope.length > 0
    && candidate.scope.every((entry) => typeof entry === 'string' && Boolean(entry.trim()));
}

function isProductBinding(value: unknown): value is ProductBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const binding = value as Record<string, unknown>;
  return typeof binding.workspaceId === 'string'
    && typeof binding.databaseGeneration === 'string'
    && typeof binding.timelineId === 'string'
    && (binding.checkoutTargetId === null || typeof binding.checkoutTargetId === 'string')
    && Number.isSafeInteger(binding.checkoutUpdatedAt)
    && Number.isSafeInteger(binding.contentRevision)
    && typeof binding.snapshotDigest === 'string';
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

async function sha256Hex(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new AgentCommandValidationError('AGENT_APPROVAL_CRYPTO_UNAVAILABLE', '浏览器无法校验批准凭据。');
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function toJsonObject(value: unknown): JsonObject {
  const normalized = JSON.parse(JSON.stringify(value)) as unknown;
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    throw new TypeError('Main Workbench snapshot must serialize to a JSON object');
  }
  return normalized as JsonObject;
}

function toJsonValue(value: unknown): JsonValue {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

export const desktopAgentBridge = createDesktopAgentBridge();
let browserAgentRuntimeRef: BrowserAgentRuntime | null = null;
export const desktopAgentConsumerController = createDesktopAgentConsumerController({
  bridge: desktopAgentBridge,
  workspaceLease,
  getBinding: () => browserAgentRuntimeRef?.getBinding() ?? null,
});
export const browserAgentRuntime = new BrowserAgentRuntime({
  bridge: desktopAgentBridge,
  consumerController: desktopAgentConsumerController,
  store: browserProductStore,
});
browserAgentRuntimeRef = browserAgentRuntime;

/**
 * Re-enter through a full document navigation so WebBootstrap can acquire the
 * writer lease and initialize the ProductGateway before the AI panel mounts.
 * A hash-only route change would leave the ordinary-workbench bootstrap alive.
 */
export async function enterDesktopAgentModeFromWorkbench(): Promise<void> {
  if (typeof window === 'undefined') return;
  const launch = await requestDesktopAgentModeLaunch();
  // A previous Agent Host may have exited while this browser tab retained its
  // sessionStorage. Never let that stale capability suppress exchange of the
  // fresh one-time launch grant.
  desktopAgentBridge.clearSessionCapability();
  const url = new URL(window.location.href);
  // Changing only the hash is a same-document navigation. WebBootstrap would
  // therefore keep the ordinary-workbench lifecycle and never initialize the
  // Agent writer/ProductGateway. The harmless query marker forces a real page
  // load while the launch secret itself stays in the fragment.
  url.searchParams.set(DESKTOP_AGENT_BOOT_QUERY_KEY, '1');
  const query = new URLSearchParams({
    [AGENT_LAUNCH_GRANT_FRAGMENT_KEY]: launch.grant,
  });
  url.hash = `#${DESKTOP_AGENT_MODE_PATH}?${query.toString()}`;
  window.location.assign(url.href);
}

/** Close the registered browser consumer before dropping its tab capability. */
export async function exitDesktopAgentModeToWorkbench(): Promise<void> {
  if (typeof window === 'undefined') return;
  await desktopAgentConsumerController.stop().catch(() => undefined);
  desktopAgentBridge.clearSessionCapability();
  const url = new URL(window.location.href);
  url.searchParams.delete(DESKTOP_AGENT_BOOT_QUERY_KEY);
  url.hash = '#/timeline';
  window.location.assign(url.href);
}
