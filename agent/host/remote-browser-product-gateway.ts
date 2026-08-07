import {
  DEF_AGENT_IN_MEMORY_LIMITS,
  canonicalJson,
  type BrowserCommandDelivery,
  type BrowserCommandResultSubmission,
  type BrowserSnapshotPublish,
  type BrowserWorkbenchConsumerState,
  type CommandId,
  type DefTurnId,
  type JsonValue,
  type Phase2ProductCommand,
  type Phase2ProductOperationSchema,
  type ProductBinding,
  type ProductCommandReceipt,
  type ProductCommandCancelOptions,
  type ProductCommandResult,
  type ProductGateway,
  type ProductSnapshotEnvelope,
  type ProductWaitOptions,
} from '../core/contracts/index.ts';
import { dirname, resolve } from 'node:path';
import type { AgentUiCapabilityClaims } from './token-authority.ts';
import { BrowserConsumerRegistry } from './browser-consumer-registry.ts';
import { DefAgentHostError } from './errors.ts';
import {
  createFileProductCommandStore,
  createMemoryProductCommandStore,
  type ProductCommandDeliveryMode,
  type ProductCommandStore,
} from './product-command-store.ts';

type QueuedCommand = {
  readonly cursor: number;
  readonly command: Phase2ProductCommand;
  readonly fingerprint: string;
  readonly acceptedAt: string;
  status: 'queued' | 'dispatched' | 'reconciling' | 'terminal';
  deliveryMode: ProductCommandDeliveryMode;
  result: ProductCommandResult | null;
};

type ResultWaiter = {
  readonly resolve: (result: ProductCommandResult) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout> | null;
};

export type RemoteProductCommandView = {
  readonly cursor: number;
  readonly command: Phase2ProductCommand;
  readonly acceptedAt: string;
  readonly status: QueuedCommand['status'];
  readonly deliveryMode: ProductCommandDeliveryMode;
  readonly result: ProductCommandResult | null;
};

export class RemoteBrowserProductGateway implements ProductGateway<Phase2ProductOperationSchema> {
  readonly #consumers: BrowserConsumerRegistry;
  readonly #clock: () => number;
  readonly #commandStore: ProductCommandStore;
  readonly #onTerminalResult: ((view: RemoteProductCommandView) => void) | null;
  readonly #commands = new Map<CommandId, QueuedCommand>();
  readonly #waiters = new Map<CommandId, Set<ResultWaiter>>();
  #snapshot: ProductSnapshotEnvelope | null = null;
  #cursor = 0;

  constructor(
    consumers: BrowserConsumerRegistry,
    options: {
      readonly clock?: () => number;
      readonly commandStore?: ProductCommandStore;
      /**
       * Durable Host-journal hook. It is deliberately invoked again when the
       * browser retries an identical terminal result, allowing a prior journal
       * write failure to catch up without ever replaying the Product command.
       */
      readonly onTerminalResult?: (view: RemoteProductCommandView) => void;
    } = {},
  ) {
    this.#consumers = consumers;
    this.#clock = options.clock ?? Date.now;
    this.#commandStore = options.commandStore ?? defaultProductCommandStore();
    this.#onTerminalResult = options.onTerminalResult ?? null;
    this.#commandStore.initialize();
    for (const record of this.#commandStore.list()) {
      this.#commands.set(record.command.commandId, {
        cursor: record.cursor,
        command: record.command,
        fingerprint: record.fingerprint,
        acceptedAt: record.acceptedAt,
        status: record.status,
        deliveryMode: record.deliveryMode,
        result: record.result,
      });
      this.#cursor = Math.max(this.#cursor, record.cursor);
    }
  }

  publishSnapshot(
    claims: AgentUiCapabilityClaims,
    input: BrowserSnapshotPublish,
  ): ProductSnapshotEnvelope {
    const consumer = this.#consumers.requireActive(claims);
    assertConsumerIdentity(consumer, input.consumerId, input.executorLeaseId);
    assertStableIdentity(consumer.binding, input.snapshot.binding);
    this.#consumers.heartbeat(claims, {
      consumerId: input.consumerId,
      executorLeaseId: input.executorLeaseId,
      writer: true,
      visible: true,
      binding: input.snapshot.binding,
    });
    this.#snapshot = input.snapshot;
    return input.snapshot;
  }

  async getSnapshot(binding: ProductBinding): Promise<ProductSnapshotEnvelope> {
    this.#consumers.requireActive();
    if (!this.#snapshot || !sameBinding(this.#snapshot.binding, binding)) {
      throw new DefAgentHostError(
        'AGENT_BINDING_CONFLICT',
        'Browser snapshot is missing or stale for the requested binding',
      );
    }
    return this.#snapshot;
  }

  async dispatch(command: Phase2ProductCommand): Promise<ProductCommandReceipt> {
    this.#consumers.requireActive();
    if (!this.#snapshot || !sameBinding(this.#snapshot.binding, command.expected)) {
      throw new DefAgentHostError(
        'AGENT_BINDING_CONFLICT',
        'Product command expected binding does not match the latest browser snapshot',
      );
    }
    const fingerprint = canonicalJson(command as unknown as JsonValue);
    const existing = this.#commands.get(command.commandId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new DefAgentHostError(
          'AGENT_COMMAND_CONFLICT',
          `Product command ${command.commandId} already exists with another payload`,
        );
      }
      return {
        commandId: command.commandId,
        status: existing.status === 'queued' ? 'queued' : existing.status === 'dispatched' ? 'dispatched' : 'reconciling',
        acceptedAt: existing.acceptedAt,
      };
    }
    if (this.#commands.size >= DEF_AGENT_IN_MEMORY_LIMITS.maxProductCommandsPerHost) {
      throw new DefAgentHostError(
        'AGENT_COMMAND_CAPACITY_REACHED',
        `This Agent Host keeps at most ${DEF_AGENT_IN_MEMORY_LIMITS.maxProductCommandsPerHost} Product commands`,
      );
    }
    const acceptedAt = new Date(this.#clock()).toISOString();
    const persisted = this.#commandStore.accept(command, acceptedAt);
    this.#commands.set(command.commandId, {
      cursor: persisted.cursor,
      command: persisted.command,
      fingerprint: persisted.fingerprint,
      acceptedAt: persisted.acceptedAt,
      status: persisted.status,
      deliveryMode: persisted.deliveryMode,
      result: persisted.result,
    });
    this.#cursor = Math.max(this.#cursor, persisted.cursor);
    return { commandId: command.commandId, status: 'queued', acceptedAt };
  }

  nextCommand(
    claims: AgentUiCapabilityClaims,
    input: {
      readonly consumerId: string;
      readonly executorLeaseId: string;
      readonly afterCursor: number;
    },
  ): BrowserCommandDelivery | null {
    const consumer = this.#consumers.requireActive(claims);
    assertConsumerIdentity(consumer, input.consumerId, input.executorLeaseId);
    const next = [...this.#commands.values()]
      .filter((entry) => entry.status !== 'terminal' && entry.cursor > input.afterCursor)
      .sort((left, right) => left.cursor - right.cursor)[0];
    if (!next) return null;
    const persisted = this.#commandStore.markDispatched(next.command.commandId);
    next.status = persisted.status;
    next.deliveryMode = persisted.deliveryMode;
    next.result = persisted.result;
    return {
      cursor: next.cursor,
      command: next.command,
      mode: next.deliveryMode,
    };
  }

  submitResult(
    claims: AgentUiCapabilityClaims,
    input: BrowserCommandResultSubmission,
  ): ProductCommandResult {
    const consumer = this.#consumers.requireActive(claims);
    assertConsumerIdentity(consumer, input.consumerId, input.executorLeaseId);
    const command = this.#commands.get(input.result.commandId);
    if (!command) {
      throw new DefAgentHostError(
        'AGENT_COMMAND_NOT_FOUND',
        `Product command ${input.result.commandId} does not exist`,
        404,
      );
    }
    if (command.result) {
      if (canonicalJson(command.result as unknown as JsonValue) !== canonicalJson(input.result as unknown as JsonValue)) {
        throw new DefAgentHostError(
          'AGENT_COMMAND_CONFLICT',
          `Product command ${input.result.commandId} already has another result`,
        );
      }
      this.#notifyTerminalResult(command);
      return command.result;
    }
    const generationChanged = (
      consumer.binding.workspaceId !== command.command.expected.workspaceId
      || consumer.binding.databaseGeneration !== command.command.expected.databaseGeneration
      || consumer.binding.timelineId !== command.command.expected.timelineId
    );
    if (generationChanged && input.result.status !== 'orphaned') {
      throw new DefAgentHostError(
        'AGENT_BINDING_CONFLICT',
        `Product command ${input.result.commandId} belongs to another browser generation`,
      );
    }
    return this.#recordTerminalResult(command, input.result);
  }

  async cancelPending(
    defTurnId: DefTurnId,
    options: ProductCommandCancelOptions = {},
  ): Promise<readonly ProductCommandResult[]> {
    const results: ProductCommandResult[] = [];
    for (const command of this.#commands.values()) {
      if (
        command.command.defTurnId !== defTurnId
        || command.status !== 'queued'
        || command.result
      ) continue;
      const result: ProductCommandResult = {
        commandId: command.command.commandId,
        status: 'not-executed',
        code: options.code ?? 'AGENT_COMMAND_CANCELLED_BY_TURN',
        message: options.message ?? 'Turn stopped before the Product command was delivered.',
        beforeRevision: command.command.expected.contentRevision,
        afterRevision: command.command.expected.contentRevision,
        browserResult: { cancelledBeforeDelivery: true },
        completedAt: new Date(this.#clock()).toISOString(),
      };
      results.push(this.#recordTerminalResult(command, result));
    }
    return results;
  }

  #recordTerminalResult(command: QueuedCommand, result: ProductCommandResult): ProductCommandResult {
    const persisted = this.#commandStore.recordResult(command.command.commandId, result);
    if (!persisted.result) {
      throw new DefAgentHostError(
        'AGENT_COMMAND_CONFLICT',
        `Product command ${command.command.commandId} has no persisted terminal result`,
      );
    }
    command.status = persisted.status;
    command.deliveryMode = persisted.deliveryMode;
    command.result = persisted.result;
    this.#notifyTerminalResult(command);
    const waiters = this.#waiters.get(command.command.commandId);
    this.#waiters.delete(command.command.commandId);
    for (const waiter of waiters ?? []) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve(persisted.result);
    }
    return persisted.result;
  }

  #notifyTerminalResult(command: QueuedCommand): void {
    if (!command.result || !this.#onTerminalResult) return;
    this.#onTerminalResult({
      cursor: command.cursor,
      command: command.command,
      acceptedAt: command.acceptedAt,
      status: command.status,
      deliveryMode: command.deliveryMode,
      result: command.result,
    });
  }

  async awaitResult(
    commandId: CommandId,
    options: ProductWaitOptions = {},
  ): Promise<ProductCommandResult> {
    const command = this.#commands.get(commandId);
    if (!command) {
      throw new DefAgentHostError('AGENT_COMMAND_NOT_FOUND', `Product command ${commandId} does not exist`, 404);
    }
    if (command.result) return command.result;
    const timeoutMs = options.timeoutMs ?? 30_000;
    return new Promise<ProductCommandResult>((resolve, reject) => {
      const waiters = this.#waiters.get(commandId) ?? new Set<ResultWaiter>();
      const waiter: ResultWaiter = {
        resolve,
        reject,
        timer: timeoutMs > 0
          ? setTimeout(() => {
            waiters.delete(waiter);
            if (waiters.size === 0) this.#waiters.delete(commandId);
            reject(new DefAgentHostError(
              'AGENT_COMMAND_TIMEOUT',
              `Product command ${commandId} did not settle within ${timeoutMs}ms`,
              504,
            ));
          }, timeoutMs)
          : null,
      };
      waiter.timer?.unref?.();
      waiters.add(waiter);
      this.#waiters.set(commandId, waiters);
    });
  }

  async reconcile(commandId: CommandId): Promise<ProductCommandResult | null> {
    const command = this.#commands.get(commandId);
    if (!command) {
      throw new DefAgentHostError('AGENT_COMMAND_NOT_FOUND', `Product command ${commandId} does not exist`, 404);
    }
    return command.result;
  }

  /** Read-only recovery view used by Host diagnostics and await/reconcile code. */
  getCommand(commandId: CommandId): RemoteProductCommandView | null {
    const entry = this.#commands.get(commandId);
    if (!entry) return null;
    return {
      cursor: entry.cursor,
      command: entry.command,
      acceptedAt: entry.acceptedAt,
      status: entry.status,
      deliveryMode: entry.deliveryMode,
      result: entry.result,
    };
  }

  clear(reason = 'Product gateway closed'): void {
    for (const waiters of this.#waiters.values()) {
      for (const waiter of waiters) {
        if (waiter.timer) clearTimeout(waiter.timer);
        waiter.reject(new Error(reason));
      }
    }
    this.#waiters.clear();
    this.#commands.clear();
    this.#snapshot = null;
  }
}

function defaultProductCommandStore(): ProductCommandStore {
  const configuredRoot = process.env.DEF_AGENT_PRODUCT_COMMAND_STORE_ROOT?.trim();
  const readyFile = process.env.DEF_AGENT_READY_FILE?.trim();
  const root = configuredRoot
    || (readyFile ? `${dirname(resolve(readyFile))}/product-commands` : '');
  return root ? createFileProductCommandStore(root) : createMemoryProductCommandStore();
}

function sameBinding(left: ProductBinding, right: ProductBinding): boolean {
  return left.workspaceId === right.workspaceId
    && left.databaseGeneration === right.databaseGeneration
    && left.timelineId === right.timelineId
    && left.checkoutTargetId === right.checkoutTargetId
    && left.checkoutUpdatedAt === right.checkoutUpdatedAt
    && left.contentRevision === right.contentRevision
    && left.snapshotDigest === right.snapshotDigest;
}

function assertStableIdentity(left: ProductBinding, right: ProductBinding): void {
  if (
    left.workspaceId !== right.workspaceId
    || left.databaseGeneration !== right.databaseGeneration
    || left.timelineId !== right.timelineId
  ) {
    throw new DefAgentHostError(
      'AGENT_BINDING_CONFLICT',
      'Published snapshot does not belong to the registered browser workspace',
    );
  }
}

function assertConsumerIdentity(
  consumer: BrowserWorkbenchConsumerState,
  consumerId: string,
  executorLeaseId: string,
): void {
  if (consumer.consumerId !== consumerId || consumer.executorLeaseId !== executorLeaseId) {
    throw new DefAgentHostError('AGENT_CONSUMER_CONFLICT', 'Browser Workbench consumer identity mismatch', 403);
  }
}
