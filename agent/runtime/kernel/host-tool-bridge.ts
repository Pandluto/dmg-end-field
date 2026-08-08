/**
 * Adapter-side Host bridge for the pure Runtime Tool port.
 *
 * The bridge deliberately does not know about Harness or ProductGateway.  It
 * owns one pending Runtime invocation, exposes that invocation to the future
 * DEF Runtime adapter, forwards Host progress to P2, and accepts one atomic
 * result/projection settlement from the adapter.
 */
import type {
  EngineAbortReason,
  EngineToolProjectionInput,
  EngineToolResultInput,
} from '../../core/contracts/engine.ts';
import type { JsonObject, JsonValue } from '../../core/contracts/json.ts';
import type { ToolCallId } from '../../core/contracts/ids.ts';
import type {
  RuntimeToolCallBlock,
  RuntimeToolResultPayload,
} from './messages.ts';
import type {
  RuntimeToolBridge,
  RuntimeToolInvocation,
  RuntimeToolProjection,
  RuntimeToolSettlement,
  RuntimeToolUpdate,
  RuntimeToolUpdateListener,
} from './tool.ts';
import {
  RuntimeToolProjectionError,
  RuntimeToolProjectionState,
  toRuntimeToolProjection,
  type HostToolProjectionSource,
} from './tool-projection.ts';

const MAX_RESULT_DEPTH = 16;
const MAX_RESULT_NODES = 16_384;
const MAX_RESULT_CONTAINER_ITEMS = 4_096;
const MAX_RESULT_STRING_CODE_UNITS = 64 * 1024;
const MAX_RESULT_TOTAL_CODE_UNITS = 256 * 1024;
const MAX_RESULT_MESSAGE_CODE_UNITS = 4 * 1024;

export type HostToolBridgeErrorCode =
  | 'RUNTIME_TOOL_BRIDGE_CLOSED'
  | 'RUNTIME_TOOL_REQUEST_UNAVAILABLE'
  | 'RUNTIME_TOOL_PARALLEL_UNSUPPORTED'
  | 'RUNTIME_TOOL_DUPLICATE_CALL'
  | 'RUNTIME_TOOL_NOT_PROJECTED'
  | 'RUNTIME_TOOL_PROJECTION_STALE'
  | 'RUNTIME_TOOL_RESULT_LATE'
  | 'RUNTIME_TOOL_RESULT_CORRELATION'
  | 'RUNTIME_TOOL_RESULT_INVALID'
  | 'RUNTIME_TOOL_RESULT_TOO_LARGE'
  | 'RUNTIME_TOOL_PROJECTION_INVALID'
  | 'RUNTIME_TOOL_PROJECTION_CONFLICT'
  | 'RUNTIME_TOOL_UPDATE_INVALID'
  | 'RUNTIME_TOOL_UPDATE_LATE'
  | 'RUNTIME_TOOL_BRIDGE_FAILED'
  | 'RUNTIME_TOOL_ABORTED';

export class HostToolBridgeError extends Error {
  readonly code: HostToolBridgeErrorCode;

  constructor(code: HostToolBridgeErrorCode, message: string) {
    super(message);
    this.name = 'HostToolBridgeError';
    this.code = code;
  }
}

/** The request exposed to the future DEF Runtime adapter. */
export interface HostToolBridgeRequest {
  readonly invocation: RuntimeToolInvocation;
  /** Forward a Host/Harness progress update into the P2 Runtime event stream. */
  readonly update: RuntimeToolUpdateListener;
  /** Ordinary Host result path: retain the current immutable projection snapshot. */
  readonly submitResult: (input: EngineToolResultInput) => Promise<void>;
  /** Harness phase path: settle with an explicitly newer Host projection. */
  readonly settle: (settlement: HostToolSettlementInput) => Promise<void>;
}

export type HostToolRequestListener = (
  request: HostToolBridgeRequest,
) => void | Promise<void>;

export interface HostToolRequestPort {
  readonly emitRequest: HostToolRequestListener;
}

export type HostToolSettlementInput = {
  readonly toolCallId: ToolCallId;
  readonly result: RuntimeToolResultPayload;
  readonly nextProjection: RuntimeToolProjection | EngineToolProjectionInput;
};

export interface HostToolBridgeOptions {
  readonly initialProjection?: HostToolProjectionSource | RuntimeToolProjection;
  readonly emitRequest?: HostToolRequestListener;
  readonly requestPort?: HostToolRequestPort;
  /** Called when Runtime aborts while a Host request is pending. */
  readonly onAbort?: (reason: EngineAbortReason) => void | Promise<void>;
  /** Called once when the bridge is explicitly closed. */
  readonly onClose?: () => void | Promise<void>;
}

type PendingInvocation = {
  readonly invocation: RuntimeToolInvocation;
  readonly onUpdate: RuntimeToolUpdateListener;
  readonly abortSignal: AbortSignal;
  readonly resolve: (settlement: RuntimeToolSettlement) => void;
  readonly reject: (error: unknown) => void;
  readonly abortListener: () => void;
  settled: boolean;
};

/**
 * Sequential Runtime Tool bridge.
 *
 * `invoke()` creates the pending request and calls `emitRequest`.  The
 * adapter/Host later calls either `submitToolResult()` to retain the current
 * projection or `submitToolResultAndUpdateProjection()`/`settle()` to advance
 * it.  Result and selected projection are released together, so P2 cannot
 * enter its next provider turn early.
 */
export class HostToolBridge implements RuntimeToolBridge {
  readonly #projectionState: RuntimeToolProjectionState;
  readonly #emitRequest: HostToolRequestListener | null;
  readonly #onAbort: ((reason: EngineAbortReason) => void | Promise<void>) | null;
  readonly #onClose: (() => void | Promise<void>) | null;
  readonly #settledCallIds = new Set<ToolCallId>();
  #pending: PendingInvocation | null = null;
  #closed = false;

  constructor(options: HostToolBridgeOptions = {}) {
    this.#projectionState = new RuntimeToolProjectionState(options.initialProjection);
    this.#emitRequest = options.emitRequest
      ?? options.requestPort?.emitRequest
      ?? null;
    this.#onAbort = options.onAbort ?? null;
    this.#onClose = options.onClose ?? null;
  }

  get projection(): RuntimeToolProjection {
    return this.#projectionState.current;
  }

  get pendingToolCallId(): ToolCallId | null {
    return this.#pending?.invocation.call.toolCallId ?? null;
  }

  get isClosed(): boolean {
    return this.#closed;
  }

  invoke(
    input: RuntimeToolInvocation,
    signal: AbortSignal,
    onUpdate: RuntimeToolUpdateListener,
  ): Promise<RuntimeToolSettlement> {
    try {
      this.#assertInvocation(input, signal);
    } catch (error) {
      return Promise.reject(error);
    }
    if (!this.#emitRequest) {
      return Promise.reject(requestUnavailable());
    }

    const invocation = snapshotInvocation(input);
    let resolvePromise!: (settlement: RuntimeToolSettlement) => void;
    let rejectPromise!: (error: unknown) => void;
    const promise = new Promise<RuntimeToolSettlement>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const pending = {} as PendingInvocation;
    const abortListener = (): void => {
      void this.abort(toAbortReason(signal.reason));
    };
    Object.assign(pending, {
      invocation,
      onUpdate,
      abortSignal: signal,
      resolve: resolvePromise,
      reject: rejectPromise,
      abortListener,
      settled: false,
    });
    this.#pending = pending;
    this.#settledCallIds.add(invocation.call.toolCallId);
    signal.addEventListener('abort', abortListener, { once: true });

    const request: HostToolBridgeRequest = Object.freeze({
      invocation,
      update: (update: RuntimeToolUpdate) => this.submitToolUpdate(update),
      submitResult: (input: EngineToolResultInput) => this.submitToolResult(input),
      settle: (settlement: HostToolSettlementInput) => this.settle(settlement),
    });
    // Do not await an adapter callback that may itself wait for the Host
    // result.  Its rejection still fails the pending Runtime invocation.
    void Promise.resolve()
      .then(() => this.#emitRequest!(request))
      .catch(() => {
        this.#failPending(pending, bridgeFailed());
      });
    return promise;
  }

  /** Forward one Host/Harness progress event while the matching call waits. */
  async submitToolUpdate(update: RuntimeToolUpdate): Promise<void> {
    const pending = this.#pending;
    if (!pending || pending.settled) throw updateLate();
    if (update.toolCallId !== pending.invocation.call.toolCallId) {
      throw updateInvalid();
    }
    const normalized = normalizeUpdate(update);
    try {
      await pending.onUpdate(normalized);
    } catch {
      const error = updateInvalid();
      this.#failPending(pending, error);
      throw error;
    }
  }

  /** Resolve with an explicitly newer Host projection (Harness phase path). */
  settle(settlement: HostToolSettlementInput): Promise<void> {
    return this.#settleAtomic(settlement, 'advance');
  }

  /** Existing EngineTurnHandle ordinary result path; projection stays unchanged. */
  submitToolResult(input: EngineToolResultInput): Promise<void> {
    return this.#settleAtomic({
      toolCallId: input.toolCallId,
      result: engineResultToRuntimeResult(input),
      nextProjection: this.#projectionState.current,
    }, 'current');
  }

  /** Existing EngineTurnHandle Harness path; projection must move forward. */
  submitToolResultAndUpdateProjection(
    input: EngineToolResultInput,
    projection: EngineToolProjectionInput,
  ): Promise<void> {
    return this.#settleAtomic({
      toolCallId: input.toolCallId,
      result: engineResultToRuntimeResult(input),
      nextProjection: projection,
    }, 'advance');
  }

  async #settleAtomic(
    settlement: HostToolSettlementInput,
    projectionMode: 'current' | 'advance',
  ): Promise<void> {
    const pending = this.#pending;
    if (!pending || pending.settled) throw resultLate();
    if (settlement.toolCallId !== pending.invocation.call.toolCallId) {
      throw resultCorrelation();
    }

    let normalized: RuntimeToolSettlement;
    try {
      normalized = normalizeSettlement(settlement, this.#projectionState.current.revision);
      if (projectionMode === 'advance') {
        if (normalized.nextProjection.revision <= this.#projectionState.current.revision) {
          throw projectionStale();
        }
        this.#projectionState.apply(normalized.nextProjection);
      } else if (normalized.nextProjection.revision !== this.#projectionState.current.revision) {
        // The ordinary entry point supplies the accepted current snapshot; it
        // never manufactures or accepts a caller-provided revision.
        throw projectionStale();
      }
    } catch (error) {
      const bridgeError = error instanceof HostToolBridgeError
        ? error
        : error instanceof RuntimeToolProjectionError
          ? projectionError(error)
          : resultInvalid();
      this.#failPending(pending, bridgeError);
      throw bridgeError;
    }

    // `apply()` above is synchronous and completes before this Promise yields.
    // Only now is the Runtime settlement released to P2.
    this.#finishPending(pending);
    pending.resolve(normalized);
  }

  /** Explicitly abort the current wait and reject every late Host settlement. */
  async abort(reason: EngineAbortReason = { code: 'RUNTIME_ABORTED', message: 'Runtime Tool wait was aborted.' }): Promise<void> {
    this.#closed = true;
    const pending = this.#pending;
    if (pending) this.#failPending(pending, abortedError());
    try {
      await this.#onAbort?.(reason);
    } catch {
      // Abort liveness belongs to the Runtime.  A Host abort transport failure
      // must not leave invoke() pending or make a late result acceptable.
    }
  }

  /** Close the bridge; unlike abort this is a lifecycle shutdown, not a Tool result. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    const pending = this.#pending;
    if (pending) this.#failPending(pending, bridgeClosed());
    try {
      await this.#onClose?.();
    } catch {
      // Closing is fail-closed and idempotent even when an adapter cleanup hook
      // cannot complete.
    }
  }

  #assertInvocation(input: RuntimeToolInvocation, signal: AbortSignal): void {
    if (this.#closed) throw bridgeClosed();
    if (this.#pending) {
      if (this.#pending.invocation.call.toolCallId === input.call.toolCallId) {
        throw duplicateCall();
      }
      throw parallelUnsupported();
    }
    if (this.#settledCallIds.has(input.call.toolCallId)) throw duplicateCall();
    if (signal.aborted) throw abortedError();
    if (input.projectionRevision !== this.#projectionState.current.revision) {
      throw projectionStale();
    }
    const descriptor = this.#projectionState.current.tools.find((tool) => tool.name === input.call.name);
    if (!descriptor) throw notProjected();
    if (!isPlainJsonObject(input.call.arguments)) throw resultInvalid();
    if (typeof input.call.toolCallId !== 'string' || input.call.toolCallId.length === 0) {
      throw resultCorrelation();
    }
  }

  #failPending(pending: PendingInvocation, error: HostToolBridgeError): void {
    if (this.#pending !== pending || pending.settled) return;
    this.#finishPending(pending);
    pending.reject(error);
  }

  #finishPending(pending: PendingInvocation): void {
    if (this.#pending !== pending || pending.settled) return;
    pending.settled = true;
    this.#pending = null;
    // The signal may be a shared Run signal and must remain usable by the
    // caller; only this bridge listener is removed.
    pending.abortSignal.removeEventListener('abort', pending.abortListener);
  }
}

function normalizeSettlement(
  settlement: HostToolSettlementInput,
  currentRevision: number,
): RuntimeToolSettlement {
  if (!isPlainJsonObject(settlement)) throw resultInvalid();
  const result = normalizeResult(settlement.result);
  let nextProjection: RuntimeToolProjection;
  try {
    nextProjection = toRuntimeToolProjection(settlement.nextProjection, currentRevision + 1);
  } catch (error) {
    if (error instanceof RuntimeToolProjectionError) throw error;
    throw resultInvalid();
  }
  return Object.freeze({
    toolCallId: settlement.toolCallId,
    result,
    nextProjection,
  });
}

function normalizeResult(value: RuntimeToolResultPayload): RuntimeToolResultPayload {
  if (!isPlainJsonObject(value)) throw resultInvalid();
  if (value.status === 'succeeded') {
    if (!Object.prototype.hasOwnProperty.call(value, 'output')) throw resultInvalid();
    return Object.freeze({
      status: 'succeeded',
      output: cloneBoundedJson(value.output),
    });
  }
  if (
    value.status !== 'failed'
    || typeof value.code !== 'string'
    || !/^[A-Za-z0-9._-]{1,128}$/u.test(value.code)
    || typeof value.message !== 'string'
    || value.message.length > MAX_RESULT_MESSAGE_CODE_UNITS
  ) {
    throw resultInvalid();
  }
  const details = value.details === undefined ? undefined : cloneBoundedJson(value.details);
  return Object.freeze({
    status: 'failed',
    code: value.code,
    message: value.message,
    ...(details === undefined ? {} : { details }),
  });
}

function normalizeUpdate(update: RuntimeToolUpdate): RuntimeToolUpdate {
  if (!isPlainJsonObject(update) || typeof update.toolCallId !== 'string') throw updateInvalid();
  return Object.freeze({
    toolCallId: update.toolCallId,
    detail: cloneBoundedJson(update.detail),
  });
}

function engineResultToRuntimeResult(input: EngineToolResultInput): RuntimeToolResultPayload {
  if (input.status === 'succeeded') {
    return { status: 'succeeded', output: input.result };
  }
  return {
    status: 'failed',
    code: input.code,
    message: input.message,
    ...(input.details === undefined ? {} : { details: input.details }),
  };
}

function snapshotInvocation(input: RuntimeToolInvocation): RuntimeToolInvocation {
  const call = input.call;
  const argumentsValue = cloneBoundedJson(call.arguments);
  if (!isPlainJsonObject(argumentsValue)) throw resultInvalid();
  const snapshotCall: RuntimeToolCallBlock = Object.freeze({
    type: 'tool-call',
    id: call.id,
    toolCallId: call.toolCallId,
    name: call.name,
    arguments: argumentsValue,
  });
  return Object.freeze({
    sessionId: input.sessionId,
    defTurnId: input.defTurnId,
    runId: input.runId,
    turnId: input.turnId,
    call: snapshotCall,
    projectionRevision: input.projectionRevision,
  });
}

function cloneBoundedJson(value: unknown): JsonValue {
  const budget = { nodes: 0, codeUnits: 0 };
  try {
    return cloneJson(value, 0, budget, new WeakSet<object>());
  } catch (error) {
    if (error instanceof SerializationLimitError) {
      throw resultTooLarge();
    }
    throw resultInvalid();
  }
}

function cloneJson(
  value: unknown,
  depth: number,
  budget: { nodes: number; codeUnits: number },
  active: WeakSet<object>,
): JsonValue {
  budget.nodes += 1;
  if (depth > MAX_RESULT_DEPTH || budget.nodes > MAX_RESULT_NODES) throw new SerializationLimitError();
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    budget.codeUnits += value.length;
    if (value.length > MAX_RESULT_STRING_CODE_UNITS || budget.codeUnits > MAX_RESULT_TOTAL_CODE_UNITS) {
      throw new SerializationLimitError();
    }
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-json number');
    return value;
  }
  if (typeof value !== 'object' || active.has(value)) throw new Error('non-json object');
  active.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_RESULT_CONTAINER_ITEMS) throw new SerializationLimitError();
      const output: JsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) throw new Error('sparse array');
        output.push(cloneJson(value[index], depth + 1, budget, active));
      }
      return Object.freeze(output) as unknown as JsonValue;
    }
    if (!isPlainJsonObject(value)) throw new Error('non-plain object');
    const keys = Object.keys(value);
    if (keys.length > MAX_RESULT_CONTAINER_ITEMS) throw new SerializationLimitError();
    const output: JsonObject = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor) || descriptor.value === undefined) {
        throw new Error('accessor or undefined');
      }
      budget.codeUnits += key.length;
      if (budget.codeUnits > MAX_RESULT_TOTAL_CODE_UNITS) throw new SerializationLimitError();
      Object.defineProperty(output, key, {
        value: cloneJson(descriptor.value, depth + 1, budget, active),
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    return Object.freeze(output);
  } finally {
    active.delete(value);
  }
}

class SerializationLimitError extends Error {}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function toAbortReason(value: unknown): EngineAbortReason {
  if (isPlainJsonObject(value) && typeof value.code === 'string') {
    return {
      code: value.code.slice(0, 128),
      ...(typeof value.message === 'string' ? { message: value.message.slice(0, MAX_RESULT_MESSAGE_CODE_UNITS) } : {}),
    };
  }
  return { code: 'RUNTIME_ABORTED', message: 'Runtime Tool wait was aborted.' };
}

function bridgeError(code: HostToolBridgeErrorCode, message: string): HostToolBridgeError {
  return new HostToolBridgeError(code, message);
}

function bridgeClosed(): HostToolBridgeError {
  return bridgeError('RUNTIME_TOOL_BRIDGE_CLOSED', 'The Runtime Tool bridge is closed.');
}

function requestUnavailable(): HostToolBridgeError {
  return bridgeError('RUNTIME_TOOL_REQUEST_UNAVAILABLE', 'No Host Tool request port is attached.');
}

function parallelUnsupported(): HostToolBridgeError {
  return bridgeError('RUNTIME_TOOL_PARALLEL_UNSUPPORTED', 'Parallel Tool execution is not supported.');
}

function duplicateCall(): HostToolBridgeError {
  return bridgeError('RUNTIME_TOOL_DUPLICATE_CALL', 'The Tool call was already accepted or settled.');
}

function notProjected(): HostToolBridgeError {
  return bridgeError('RUNTIME_TOOL_NOT_PROJECTED', 'The Tool is not present in the current projection.');
}

function projectionStale(): HostToolBridgeError {
  return bridgeError('RUNTIME_TOOL_PROJECTION_STALE', 'The Tool call or projection used a stale revision.');
}

function projectionError(error: RuntimeToolProjectionError): HostToolBridgeError {
  return bridgeError(error.code, error.message);
}

function resultLate(): HostToolBridgeError {
  return bridgeError('RUNTIME_TOOL_RESULT_LATE', 'The Tool result arrived after the pending wait ended.');
}

function resultCorrelation(): HostToolBridgeError {
  return bridgeError('RUNTIME_TOOL_RESULT_CORRELATION', 'The Tool result does not match the pending call.');
}

function resultInvalid(): HostToolBridgeError {
  return bridgeError('RUNTIME_TOOL_RESULT_INVALID', 'The Host Tool result was malformed.');
}

function resultTooLarge(): HostToolBridgeError {
  return bridgeError('RUNTIME_TOOL_RESULT_TOO_LARGE', 'The Host Tool result exceeded the bounded serialization contract.');
}

function updateInvalid(): HostToolBridgeError {
  return bridgeError('RUNTIME_TOOL_UPDATE_INVALID', 'The Host Tool update was malformed or could not be delivered.');
}

function updateLate(): HostToolBridgeError {
  return bridgeError('RUNTIME_TOOL_UPDATE_LATE', 'The Host Tool update arrived after the pending wait ended.');
}

function bridgeFailed(): HostToolBridgeError {
  return bridgeError('RUNTIME_TOOL_BRIDGE_FAILED', 'The Host Tool request could not be emitted.');
}

function abortedError(): HostToolBridgeError {
  return bridgeError('RUNTIME_TOOL_ABORTED', 'The Runtime Tool wait was aborted.');
}
