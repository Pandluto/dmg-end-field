import {
  canonicalJson,
  type BrowserCommandDelivery,
  type BrowserCommandResultSubmission,
  type BrowserSnapshotPublish,
  type BrowserWorkbenchConsumerState,
  type CommandId,
  type JsonValue,
  type Phase2ProductCommand,
  type Phase2ProductOperationSchema,
  type ProductBinding,
  type ProductCommandReceipt,
  type ProductCommandResult,
  type ProductGateway,
  type ProductSnapshotEnvelope,
  type ProductWaitOptions,
} from '../core/contracts/index.ts';
import type { AgentUiCapabilityClaims } from './token-authority.ts';
import { BrowserConsumerRegistry } from './browser-consumer-registry.ts';
import { DefAgentHostError } from './errors.ts';

type QueuedCommand = {
  readonly cursor: number;
  readonly command: Phase2ProductCommand;
  readonly fingerprint: string;
  readonly acceptedAt: string;
  status: 'queued' | 'dispatched' | 'terminal';
  result: ProductCommandResult | null;
};

type ResultWaiter = {
  readonly resolve: (result: ProductCommandResult) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout> | null;
};

export class RemoteBrowserProductGateway implements ProductGateway<Phase2ProductOperationSchema> {
  readonly #consumers: BrowserConsumerRegistry;
  readonly #clock: () => number;
  readonly #commands = new Map<CommandId, QueuedCommand>();
  readonly #waiters = new Map<CommandId, Set<ResultWaiter>>();
  #snapshot: ProductSnapshotEnvelope | null = null;
  #cursor = 0;

  constructor(
    consumers: BrowserConsumerRegistry,
    options: { readonly clock?: () => number } = {},
  ) {
    this.#consumers = consumers;
    this.#clock = options.clock ?? Date.now;
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
    const acceptedAt = new Date(this.#clock()).toISOString();
    this.#commands.set(command.commandId, {
      cursor: ++this.#cursor,
      command,
      fingerprint,
      acceptedAt,
      status: 'queued',
      result: null,
    });
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
    next.status = 'dispatched';
    return { cursor: next.cursor, command: next.command };
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
    command.status = 'terminal';
    command.result = input.result;
    const waiters = this.#waiters.get(input.result.commandId);
    this.#waiters.delete(input.result.commandId);
    for (const waiter of waiters ?? []) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve(input.result);
    }
    return input.result;
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

  getCommand(commandId: CommandId): {
    readonly cursor: number;
    readonly command: Phase2ProductCommand;
    readonly status: QueuedCommand['status'];
    readonly result: ProductCommandResult | null;
  } | null {
    const entry = this.#commands.get(commandId);
    if (!entry) return null;
    return {
      cursor: entry.cursor,
      command: entry.command,
      status: entry.status,
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
