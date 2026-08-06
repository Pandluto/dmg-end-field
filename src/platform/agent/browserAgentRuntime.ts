import {
  asCommandId,
  asTimelineId,
  type CommandId,
} from '../../../agent/core/contracts/ids.ts';
import type { JsonObject, JsonValue } from '../../../agent/core/contracts/json.ts';
import type {
  Phase2ProductCommand,
  ProductBinding,
} from '../../../agent/core/contracts/index.ts';
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
  type DesktopAgentBridge,
  type DesktopAgentConsumerController,
} from './desktopAgentBridge';

const AGENT_COMMAND_SOURCE = 'agent-host';
const PHASE2_ALLOWED_OPERATIONS = new Set(['workbench.refresh-snapshot']);
export const AGENT_SELECTION_WORKSPACE_TIMELINE_ID = 'workspace-selection';

type EnqueueCommand = (command: MainWorkbenchCommand, id: string) => void;

export interface BrowserAgentRuntimeOptions {
  readonly bridge: Pick<
    DesktopAgentBridge,
    | 'isAgentModeRoute'
    | 'getSessionCapability'
    | 'publishSnapshot'
    | 'nextCommand'
    | 'submitCommandResult'
  >;
  readonly consumerController: Pick<
    DesktopAgentConsumerController,
    'getState' | 'refreshEligibility'
  >;
  readonly store: BrowserProductStore;
}

export class BrowserAgentRuntime {
  readonly #bridge: BrowserAgentRuntimeOptions['bridge'];
  readonly #consumerController: BrowserAgentRuntimeOptions['consumerController'];
  readonly #store: BrowserProductStore;
  readonly #pendingHostResults = new Set<CommandId>();
  #binding: ProductBinding | null = null;
  #commandCursor = 0;
  #consumerRegistrationKey = '';
  #publishChain = Promise.resolve();
  #resultChain = Promise.resolve();
  #pullPromise: Promise<void> | null = null;

  constructor(options: BrowserAgentRuntimeOptions) {
    this.#bridge = options.bridge;
    this.#consumerController = options.consumerController;
    this.#store = options.store;
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
    this.#publishChain = this.#publishChain
      .catch(() => undefined)
      .then(() => this.#publishSnapshot(snapshot));
    return this.#publishChain;
  }

  pullRemoteCommands(enqueue: EnqueueCommand): Promise<void> {
    if (!this.isActive()) return Promise.resolve();
    if (this.#pullPromise) return this.#pullPromise;
    this.#pullPromise = this.#pull(enqueue).finally(() => {
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
    this.#binding = runtimeSnapshot.binding;
    await this.#consumerController.refreshEligibility();
    const consumer = this.#consumerController.getState().consumer;
    if (!consumer) return;
    await this.#bridge.publishSnapshot({
      consumerId: consumer.consumerId,
      executorLeaseId: consumer.executorLeaseId,
      snapshot: runtimeSnapshot,
    });
  }

  async #pull(enqueue: EnqueueCommand): Promise<void> {
    const consumer = this.#currentConsumer();
    if (!consumer) return;
    await this.#flushPendingResults(consumer.consumerId, consumer.executorLeaseId);
    const delivery = await this.#bridge.nextCommand({
      consumerId: consumer.consumerId,
      executorLeaseId: consumer.executorLeaseId,
      afterCursor: this.#commandCursor,
    });
    if (!delivery) return;
    const command = delivery.command;
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
    const localCommand = toMainWorkbenchCommand(command);
    enqueue(localCommand, command.commandId);
    this.#commandCursor = delivery.cursor;
  }

  async #recordAndSubmitResult(entry: QueuedMainWorkbenchCommand): Promise<void> {
    const commandId = asCommandId(entry.id);
    const journal = await this.#store.getCommand(commandId);
    if (!journal) return;
    const currentRevision = this.#binding?.contentRevision ?? journal.expectedRevision;
    const result = await this.#store.recordCommandResult(commandId, {
      status: entry.status === 'done' ? 'succeeded' : 'error',
      ...(entry.status === 'error'
        ? { code: 'MAIN_WORKBENCH_COMMAND_FAILED', message: entry.error || 'Main Workbench command failed' }
        : {}),
      beforeRevision: journal.expectedRevision,
      afterRevision: currentRevision,
      browserResult: toJsonValue(entry.result),
      visiblePostcondition: {
        contentRevision: currentRevision,
        snapshotDigest: this.#binding?.snapshotDigest ?? journal.expectedDigest,
      },
      executorLeaseId: journal.executorLeaseId || undefined,
    });
    this.#pendingHostResults.add(commandId);
    const consumer = this.#currentConsumer();
    if (consumer) await this.#flushPendingResults(consumer.consumerId, consumer.executorLeaseId);
    void result;
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
}

function toMainWorkbenchCommand(command: Phase2ProductCommand): MainWorkbenchCommand {
  if (command.command.op === 'workbench.refresh-snapshot') return { op: 'refreshSnapshot' };
  throw new Error(`Unsupported Phase 2 operation: ${command.command.op}`);
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
