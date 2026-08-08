/**
 * The Runtime never owns the DEF tool catalogue.  A Host/Harness projection is
 * the only source of Runtime tool descriptors; this module makes that boundary
 * explicit and keeps the projection immutable between turns.
 */
import type {
  EngineToolDescriptor,
  EngineToolProjectionInput,
} from '../../core/contracts/engine.ts';
import { canonicalJson, type JsonObject, type JsonValue } from '../../core/contracts/json.ts';
import type {
  RuntimeToolDescriptor,
  RuntimeToolProjection,
  RuntimeToolRisk,
} from './tool.ts';

const MAX_TOOL_COUNT = 256;
const MAX_TOOL_NAME_CODE_UNITS = 256;
const MAX_TOOL_DESCRIPTION_CODE_UNITS = 16 * 1024;
const MAX_JSON_DEPTH = 16;
const MAX_JSON_NODES = 16_384;
const MAX_JSON_CONTAINER_ITEMS = 4_096;
const MAX_JSON_STRING_CODE_UNITS = 64 * 1024;
const MAX_JSON_TOTAL_CODE_UNITS = 256 * 1024;

export type HostToolCapabilityRegistry = {
  listDescriptors(): readonly EngineToolDescriptor[];
};

export interface HostToolCapabilities {
  readonly tools: readonly EngineToolDescriptor[];
  /** Omit for a registry snapshot; the projection state allocates the next revision. */
  readonly revision?: number;
}

export type HostToolProjectionSource =
  | EngineToolProjectionInput
  | HostToolCapabilities
  | HostToolCapabilityRegistry
  | readonly EngineToolDescriptor[];

export type RuntimeToolProjectionSource =
  | RuntimeToolProjection
  | EngineToolProjectionInput
  | HostToolCapabilities
  | HostToolCapabilityRegistry
  | readonly EngineToolDescriptor[];

export type RuntimeToolProjectionErrorCode =
  | 'RUNTIME_TOOL_PROJECTION_INVALID'
  | 'RUNTIME_TOOL_PROJECTION_STALE'
  | 'RUNTIME_TOOL_PROJECTION_CONFLICT';

export class RuntimeToolProjectionError extends Error {
  readonly code: RuntimeToolProjectionErrorCode;

  constructor(code: RuntimeToolProjectionErrorCode, message: string) {
    super(message);
    this.name = 'RuntimeToolProjectionError';
    this.code = code;
  }
}

/** Map one Host projection without retaining any mutable Host-owned object. */
export function toRuntimeToolProjection(
  source: HostToolProjectionSource | RuntimeToolProjection,
  revision = 0,
): RuntimeToolProjection {
  const normalized = readProjectionSource(source, revision);
  return normalizeProjection(normalized.revision, normalized.tools);
}

/** Alias used by adapters that describe the operation as a projection map. */
export const mapHostToolProjection = toRuntimeToolProjection;

/** Map a Runtime snapshot back to the Host/Engine contract without changing revision or order. */
export function toEngineToolProjection(
  source: RuntimeToolProjection,
): EngineToolProjectionInput {
  const runtime = toRuntimeToolProjection(source);
  return Object.freeze({
    revision: runtime.revision,
    tools: Object.freeze(runtime.tools.map((tool) => Object.freeze({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      risk: tool.risk,
    } satisfies EngineToolDescriptor))),
  });
}

/** Alias for adapters that name the reverse operation explicitly. */
export const mapRuntimeToolProjection = toEngineToolProjection;

/** Build the first Runtime projection from a registry or an Engine projection. */
export function createInitialRuntimeToolProjection(
  source: HostToolProjectionSource | RuntimeToolProjection = { revision: 0, tools: [] },
  revision = 0,
): RuntimeToolProjection {
  return toRuntimeToolProjection(source, revision);
}

/**
 * A small immutable state holder for the current Harness phase projection.
 * Host revisions are authoritative; registry snapshots without a revision are
 * assigned the next local revision.  Equal revisions are idempotent only when
 * their complete descriptor set is equal.
 */
export class RuntimeToolProjectionState {
  #current: RuntimeToolProjection;

  constructor(
    initial: HostToolProjectionSource | RuntimeToolProjection = { revision: 0, tools: [] },
  ) {
    this.#current = createInitialRuntimeToolProjection(initial);
  }

  get current(): RuntimeToolProjection {
    return this.#current;
  }

  get revision(): number {
    return this.#current.revision;
  }

  /** Apply a Host-owned revision, rejecting stale or same-revision conflicts. */
  apply(source: HostToolProjectionSource | RuntimeToolProjection): RuntimeToolProjection {
    const hasRevision = hasExplicitRevision(source);
    const next = toRuntimeToolProjection(source, this.#current.revision + 1);
    if (next.revision < this.#current.revision) {
      throw projectionStale();
    }
    if (next.revision === this.#current.revision) {
      if (projectionFingerprint(next) === projectionFingerprint(this.#current)) return this.#current;
      throw projectionConflict();
    }
    // A registry snapshot is deliberately monotonic even when it repeats the
    // same descriptors: the state transition still represents a new Host
    // phase observation.
    if (!hasRevision && next.revision <= this.#current.revision) {
      throw projectionStale();
    }
    this.#current = next;
    return next;
  }

  /** Apply a descriptor list and allocate current.revision + 1. */
  updateFromCapabilities(
    source: HostToolCapabilityRegistry | readonly EngineToolDescriptor[],
  ): RuntimeToolProjection {
    return this.apply({ tools: readCapabilities(source) });
  }
}

/** Convenience helper for a one-shot Host phase update. */
export function updateRuntimeToolProjection(
  state: RuntimeToolProjectionState,
  source: HostToolProjectionSource | RuntimeToolProjection,
): RuntimeToolProjection {
  return state.apply(source);
}

function readProjectionSource(
  source: HostToolProjectionSource | RuntimeToolProjection,
  fallbackRevision: number,
): { readonly revision: number; readonly tools: readonly EngineToolDescriptor[] } {
  if (Array.isArray(source)) {
    return { revision: fallbackRevision, tools: source };
  }
  if (isRegistry(source)) {
    return { revision: fallbackRevision, tools: readCapabilities(source) };
  }
  if (!isPlainRecord(source)) throw projectionInvalid();
  const revision = source.revision === undefined ? fallbackRevision : source.revision;
  if (!isSafeNonNegativeInteger(revision) || !Array.isArray(source.tools)) throw projectionInvalid();
  return { revision, tools: source.tools as readonly EngineToolDescriptor[] };
}

function readCapabilities(
  source: HostToolCapabilityRegistry | readonly EngineToolDescriptor[],
): readonly EngineToolDescriptor[] {
  if (Array.isArray(source)) return source;
  if (!isRegistry(source)) throw projectionInvalid();
  let descriptors: readonly EngineToolDescriptor[];
  try {
    descriptors = source.listDescriptors();
  } catch {
    throw projectionInvalid();
  }
  if (!Array.isArray(descriptors)) throw projectionInvalid();
  return descriptors;
}

function normalizeProjection(
  revision: number,
  descriptors: readonly EngineToolDescriptor[],
): RuntimeToolProjection {
  if (!isSafeNonNegativeInteger(revision) || !Array.isArray(descriptors) || descriptors.length > MAX_TOOL_COUNT) {
    throw projectionInvalid();
  }
  const names = new Set<string>();
  const tools: RuntimeToolDescriptor[] = [];
  for (let index = 0; index < descriptors.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(descriptors, index)) throw projectionInvalid();
    const descriptor = descriptors[index];
    if (!isPlainRecord(descriptor)) throw projectionInvalid();
    const name = descriptor.name;
    const description = descriptor.description;
    const risk = descriptor.risk;
    if (
      typeof name !== 'string'
      || name.length === 0
      || name.length > MAX_TOOL_NAME_CODE_UNITS
      || name !== name.trim()
      || hasControlCharacter(name)
      || names.has(name)
      || typeof description !== 'string'
      || description.length > MAX_TOOL_DESCRIPTION_CODE_UNITS
      || description.includes('\u0000')
      || !isRuntimeToolRisk(risk)
      || !isPlainJsonObject(descriptor.inputSchema)
    ) {
      throw projectionInvalid();
    }
    names.add(name);
    tools.push(Object.freeze({
      name,
      description,
      inputSchema: cloneJsonObject(descriptor.inputSchema),
      risk,
    } satisfies RuntimeToolDescriptor));
  }
  return Object.freeze({ revision, tools: Object.freeze(tools) });
}

function cloneJsonObject(value: JsonObject): JsonObject {
  const budget = { nodes: 0, codeUnits: 0 };
  const cloned = cloneJson(value, 0, budget, new WeakSet<object>());
  if (!isPlainJsonObject(cloned)) throw projectionInvalid();
  return cloned as JsonObject;
}

function cloneJson(
  value: unknown,
  depth: number,
  budget: { nodes: number; codeUnits: number },
  active: WeakSet<object>,
): JsonValue {
  budget.nodes += 1;
  if (depth > MAX_JSON_DEPTH || budget.nodes > MAX_JSON_NODES) throw projectionInvalid();
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    budget.codeUnits += value.length;
    if (value.length > MAX_JSON_STRING_CODE_UNITS || budget.codeUnits > MAX_JSON_TOTAL_CODE_UNITS) {
      throw projectionInvalid();
    }
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw projectionInvalid();
    return value;
  }
  if (typeof value !== 'object' || active.has(value)) throw projectionInvalid();
  active.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_JSON_CONTAINER_ITEMS) throw projectionInvalid();
      const output: JsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) throw projectionInvalid();
        output.push(cloneJson(value[index], depth + 1, budget, active));
      }
      return Object.freeze(output) as unknown as JsonValue;
    }
    if (!isPlainRecord(value)) throw projectionInvalid();
    const keys = Object.keys(value);
    if (keys.length > MAX_JSON_CONTAINER_ITEMS) throw projectionInvalid();
    const output: JsonObject = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor) || descriptor.value === undefined) {
        throw projectionInvalid();
      }
      budget.codeUnits += key.length;
      if (budget.codeUnits > MAX_JSON_TOTAL_CODE_UNITS) throw projectionInvalid();
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

function hasExplicitRevision(source: HostToolProjectionSource | RuntimeToolProjection): boolean {
  return !Array.isArray(source) && !isRegistry(source) && isPlainRecord(source) && source.revision !== undefined;
}

function hasControlCharacter(value: string): boolean {
  return /[\u0000-\u001f\u007f]/u.test(value);
}

function isRuntimeToolRisk(value: unknown): value is RuntimeToolRisk {
  return value === 'read' || value === 'propose' || value === 'mutate';
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isRegistry(value: unknown): value is HostToolCapabilityRegistry {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && typeof (value as { readonly listDescriptors?: unknown }).listDescriptors === 'function';
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isPlainJsonObject(value: unknown): value is JsonObject {
  return isPlainRecord(value);
}

function projectionFingerprint(projection: RuntimeToolProjection): string {
  return canonicalJson(projection as unknown as JsonValue);
}

function projectionInvalid(): RuntimeToolProjectionError {
  return new RuntimeToolProjectionError(
    'RUNTIME_TOOL_PROJECTION_INVALID',
    'The Host tool projection was malformed.',
  );
}

function projectionStale(): RuntimeToolProjectionError {
  return new RuntimeToolProjectionError(
    'RUNTIME_TOOL_PROJECTION_STALE',
    'The Host tool projection revision was stale.',
  );
}

function projectionConflict(): RuntimeToolProjectionError {
  return new RuntimeToolProjectionError(
    'RUNTIME_TOOL_PROJECTION_CONFLICT',
    'The Host tool projection revision conflicted with the accepted projection.',
  );
}
