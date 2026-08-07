import { createHash } from 'node:crypto';
import {
  DEF_AGENT_IN_MEMORY_LIMITS,
  canonicalJson,
  type DefHarnessBusinessId,
  type DefHarnessOperationDefinition,
  type DefHarnessOperationId,
  type DefHarnessPhaseDefinition,
  type DefHarnessRevisionDefinition,
  type DefHarnessRevisionRef,
  type DefHarnessRouteInput,
  type DefHarnessTraceEntry,
  type DefHarnessTransactionSnapshot,
  type DefHarnessTransition,
  type DefSessionId,
  type DefToolDescriptor,
  type DefTurnId,
  type EngineToolProjectionInput,
  type JsonValue,
} from '../contracts/index.ts';
import {
  DEF_HARNESS_ROUTE_TOOL_NAME,
  PHASE3_READONLY_HARNESS_CATALOG,
} from './catalog.ts';

export type DefHarnessErrorCode =
  | 'HARNESS_CATALOG_INVALID'
  | 'HARNESS_TRANSACTION_NOT_FOUND'
  | 'HARNESS_TRANSACTION_TERMINAL'
  | 'HARNESS_TRANSITION_CONFLICT'
  | 'HARNESS_ROUTE_INVALID'
  | 'HARNESS_ROUTE_UNSUPPORTED'
  | 'HARNESS_TOOL_NOT_PROJECTED'
  | 'HARNESS_TRANSACTION_CAPACITY';

export class DefHarnessError extends Error {
  readonly code: DefHarnessErrorCode;

  constructor(code: DefHarnessErrorCode, message: string) {
    super(message);
    this.name = 'DefHarnessError';
    this.code = code;
  }
}

type CatalogRecord = {
  readonly definition: DefHarnessRevisionDefinition;
  readonly revision: DefHarnessRevisionRef;
  readonly operations: ReadonlyMap<DefHarnessOperationId, DefHarnessOperationDefinition>;
};

type TransactionRecord = {
  readonly transactionId: string;
  readonly defSessionId: DefSessionId;
  readonly defTurnId: DefTurnId;
  status: DefHarnessTransactionSnapshot['status'];
  businessId: DefHarnessBusinessId | null;
  operation: DefHarnessOperationId | null;
  revision: DefHarnessRevisionRef | null;
  operationDefinition: DefHarnessOperationDefinition | null;
  phase: DefHarnessPhaseDefinition;
  projectionRevision: number;
  terminalState: DefHarnessTransactionSnapshot['terminalState'];
  traceSequence: number;
  readonly trace: DefHarnessTraceEntry[];
};

type ToolDescriptorResolver = (name: string) => DefToolDescriptor | null;

export interface DefHarnessPreparedTransition {
  readonly preparedId: string;
  readonly transactionId: string;
  readonly transition: DefHarnessTransition;
}

type PreparedTransitionRecord = {
  readonly preparedId: string;
  readonly baseRecord: TransactionRecord;
  readonly baseProjectionRevision: number;
  readonly baseStatus: DefHarnessTransactionSnapshot['status'];
  readonly candidate: TransactionRecord;
  readonly transition: DefHarnessTransition;
};

const routePhase: DefHarnessPhaseDefinition = {
  id: 'route',
  kind: 'route',
  tools: [DEF_HARNESS_ROUTE_TOOL_NAME],
  writes: [],
  instructions: 'Choose exactly one allowlisted business and operation. Do not combine businesses or request a mutation.',
};

export class DefHarnessManager {
  readonly #catalog: ReadonlyMap<DefHarnessBusinessId, CatalogRecord>;
  readonly #resolveToolDescriptor: ToolDescriptorResolver;
  readonly #transactions = new Map<string, TransactionRecord>();
  readonly #preparedTransitions = new Map<string, PreparedTransitionRecord>();
  readonly #routeDescriptor: DefToolDescriptor;
  readonly #catalogRevision: string;
  #preparedSequence = 0;

  constructor(options: {
    readonly resolveToolDescriptor: ToolDescriptorResolver;
    readonly catalog?: readonly DefHarnessRevisionDefinition[];
  }) {
    this.#resolveToolDescriptor = options.resolveToolDescriptor;
    this.#routeDescriptor = {
      name: DEF_HARNESS_ROUTE_TOOL_NAME,
      description: 'Route this Turn to one allowlisted DEF business operation.',
      risk: 'read',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['businessId', 'operation'],
        properties: {
          businessId: { enum: ['selection', 'loadout', 'timeline', 'buff', 'calculation'] },
          operation: { enum: ['inspect', 'current', 'resolve', 'calculate'] },
        },
      },
    };
    this.#catalog = validateCatalog(
      cloneCatalog(options.catalog ?? PHASE3_READONLY_HARNESS_CATALOG),
      this.#resolveToolDescriptor,
    );
    this.#catalogRevision = `phase3-readonly:${sha256(canonicalJson(
      [...this.#catalog.values()].map((record) => record.revision) as unknown as JsonValue,
    ))}`;
  }

  get catalogRevision(): string {
    return this.#catalogRevision;
  }

  listRevisions(): readonly DefHarnessRevisionRef[] {
    return [...this.#catalog.values()].map((record) => ({ ...record.revision }));
  }

  buildRoutingSystemContext(): string {
    const routes = [...this.#catalog.values()]
      .map(({ definition }) => (
        `${definition.businessId}: ${definition.operations.map((entry) => entry.operation).join(', ')}`
      ))
      .join('\n');
    return [
      'You are running inside the DEF Harness read-only phase.',
      `Call ${DEF_HARNESS_ROUTE_TOOL_NAME} before any business Tool.`,
      'Choose one business and one operation. Mutation, cross-business routing and unlisted tools are unavailable.',
      routes,
    ].join('\n');
  }

  beginTurn(input: {
    readonly defSessionId: DefSessionId;
    readonly defTurnId: DefTurnId;
  }): DefHarnessTransition {
    const transactionId = `harness:${input.defTurnId}`;
    if (this.#transactions.has(transactionId)) {
      throw new DefHarnessError('HARNESS_CATALOG_INVALID', `Harness transaction already exists: ${transactionId}`);
    }
    this.#pruneTerminalTransactions();
    if (this.#transactions.size >= DEF_AGENT_IN_MEMORY_LIMITS.maxHarnessTransactionsPerHost) {
      throw new DefHarnessError(
        'HARNESS_TRANSACTION_CAPACITY',
        'Harness transaction retention is full',
      );
    }
    const record: TransactionRecord = {
      transactionId,
      defSessionId: input.defSessionId,
      defTurnId: input.defTurnId,
      status: 'routing',
      businessId: null,
      operation: null,
      revision: null,
      operationDefinition: null,
      phase: routePhase,
      projectionRevision: 1,
      terminalState: null,
      traceSequence: 0,
      trace: [],
    };
    this.#transactions.set(transactionId, record);
    const trace = this.#recordPhaseAndProjection(record);
    return { transaction: this.#snapshot(record), trace };
  }

  route(transactionId: string, rawInput: JsonValue): DefHarnessTransition {
    return this.commitPrepared(this.prepareRoute(transactionId, rawInput));
  }

  prepareRoute(transactionId: string, rawInput: JsonValue): DefHarnessPreparedTransition {
    const record = this.#requireTransaction(transactionId);
    this.#assertLive(record);
    if (record.status !== 'routing') {
      throw new DefHarnessError('HARNESS_ROUTE_INVALID', 'Harness route can only be selected once');
    }
    this.assertToolProjected(transactionId, DEF_HARNESS_ROUTE_TOOL_NAME);
    const input = parseRouteInput(rawInput);
    const catalog = this.#catalog.get(input.businessId);
    const operation = catalog?.operations.get(input.operation);
    if (!catalog || !operation) {
      throw new DefHarnessError(
        'HARNESS_ROUTE_UNSUPPORTED',
        `Unsupported Phase 3 route: ${input.businessId}.${input.operation}`,
      );
    }
    const candidate = cloneTransactionRecord(record);
    const traceOffset = candidate.trace.length;
    candidate.status = 'active';
    candidate.businessId = input.businessId;
    candidate.operation = input.operation;
    candidate.revision = catalog.revision;
    candidate.operationDefinition = operation;
    candidate.phase = requirePhase(operation, operation.entryPhase);
    candidate.projectionRevision += 1;
    candidate.trace.push({
      sequence: ++candidate.traceSequence,
      type: 'harness.routed',
      businessId: input.businessId,
      operation: input.operation,
      revision: catalog.revision,
    });
    this.#recordPhaseAndProjection(candidate);
    return this.#stage(record, candidate, traceOffset);
  }

  completeTool(
    transactionId: string,
    input: { readonly toolName: string; readonly status: 'succeeded' | 'failed' },
  ): DefHarnessTransition {
    return this.commitPrepared(this.prepareToolCompletion(transactionId, input));
  }

  prepareToolCompletion(
    transactionId: string,
    input: { readonly toolName: string; readonly status: 'succeeded' | 'failed' },
  ): DefHarnessPreparedTransition {
    const record = this.#requireTransaction(transactionId);
    this.#assertLive(record);
    if (record.status !== 'active' || !record.operationDefinition) {
      throw new DefHarnessError('HARNESS_TOOL_NOT_PROJECTED', 'Business Tool requested before Harness routing');
    }
    this.assertToolProjected(transactionId, input.toolName);
    const target = input.status === 'succeeded' ? record.phase.onSuccess : record.phase.onFailure;
    if (!target) {
      throw new DefHarnessError(
        'HARNESS_CATALOG_INVALID',
        `Harness phase ${record.phase.id} has no ${input.status} transition`,
      );
    }
    const candidate = cloneTransactionRecord(record);
    const traceOffset = candidate.trace.length;
    candidate.phase = requirePhase(candidate.operationDefinition!, target);
    candidate.projectionRevision += 1;
    if (candidate.phase.terminalState) {
      candidate.terminalState = candidate.phase.terminalState;
      candidate.status = candidate.phase.terminalState === 'completed' ? 'completed' : 'aborted';
    }
    this.#recordPhaseAndProjection(candidate);
    if (candidate.terminalState) this.#recordTerminal(candidate);
    return this.#stage(record, candidate, traceOffset);
  }

  abort(transactionId: string, code: string): DefHarnessTransition {
    const record = this.#requireTransaction(transactionId);
    this.#preparedTransitions.delete(transactionId);
    if (record.terminalState) return { transaction: this.#snapshot(record), trace: [] };
    return this.commitPrepared(this.prepareAbort(transactionId, code));
  }

  prepareAbort(transactionId: string, code: string): DefHarnessPreparedTransition {
    const record = this.#requireTransaction(transactionId);
    this.#assertLive(record);
    const candidate = cloneTransactionRecord(record);
    const traceOffset = candidate.trace.length;
    candidate.status = 'aborted';
    candidate.terminalState = 'aborted';
    candidate.projectionRevision += 1;
    candidate.trace.push({
      sequence: ++candidate.traceSequence,
      type: 'harness.tool.projected',
      projectionRevision: candidate.projectionRevision,
      tools: [],
    });
    this.#recordTerminal(candidate, code);
    return this.#stage(record, candidate, traceOffset);
  }

  commitPrepared(prepared: DefHarnessPreparedTransition): DefHarnessTransition {
    const staged = this.#preparedTransitions.get(prepared.transactionId);
    const current = this.#requireTransaction(prepared.transactionId);
    if (
      !staged
      || staged.preparedId !== prepared.preparedId
      || staged.baseRecord !== current
      || staged.baseProjectionRevision !== current.projectionRevision
      || staged.baseStatus !== current.status
    ) {
      throw new DefHarnessError(
        'HARNESS_TRANSITION_CONFLICT',
        `Prepared Harness transition is stale: ${prepared.preparedId}`,
      );
    }
    this.#preparedTransitions.delete(prepared.transactionId);
    this.#transactions.set(prepared.transactionId, staged.candidate);
    return {
      transaction: this.#snapshot(staged.candidate),
      trace: staged.transition.trace,
    };
  }

  assertToolProjected(transactionId: string, toolName: string): void {
    const record = this.#requireTransaction(transactionId);
    this.#assertLive(record);
    if (!record.phase.tools.includes(toolName)) {
      throw new DefHarnessError(
        'HARNESS_TOOL_NOT_PROJECTED',
        `Tool ${toolName} is not projected in Harness phase ${record.phase.id}`,
      );
    }
  }

  getTransaction(transactionId: string): DefHarnessTransactionSnapshot {
    return this.#snapshot(this.#requireTransaction(transactionId));
  }

  getTrace(transactionId: string): readonly DefHarnessTraceEntry[] {
    return [...this.#requireTransaction(transactionId).trace];
  }

  #pruneTerminalTransactions(): void {
    if (this.#transactions.size < DEF_AGENT_IN_MEMORY_LIMITS.maxHarnessTransactionsPerHost) return;
    for (const [transactionId, record] of this.#transactions) {
      if (!record.terminalState) continue;
      this.#preparedTransitions.delete(transactionId);
      this.#transactions.delete(transactionId);
      if (this.#transactions.size < DEF_AGENT_IN_MEMORY_LIMITS.maxHarnessTransactionsPerHost) return;
    }
  }

  #stage(
    baseRecord: TransactionRecord,
    candidate: TransactionRecord,
    traceOffset: number,
  ): DefHarnessPreparedTransition {
    if (this.#preparedTransitions.has(baseRecord.transactionId)) {
      throw new DefHarnessError(
        'HARNESS_TRANSITION_CONFLICT',
        `Harness transaction already has a prepared transition: ${baseRecord.transactionId}`,
      );
    }
    const preparedId = `${baseRecord.transactionId}:prepared:${++this.#preparedSequence}`;
    const transition: DefHarnessTransition = {
      transaction: this.#snapshot(candidate),
      trace: candidate.trace.slice(traceOffset),
    };
    this.#preparedTransitions.set(baseRecord.transactionId, {
      preparedId,
      baseRecord,
      baseProjectionRevision: baseRecord.projectionRevision,
      baseStatus: baseRecord.status,
      candidate,
      transition,
    });
    return { preparedId, transactionId: baseRecord.transactionId, transition };
  }

  #recordPhaseAndProjection(record: TransactionRecord): DefHarnessTraceEntry[] {
    const offset = record.trace.length;
    record.trace.push({
      sequence: ++record.traceSequence,
      type: 'harness.phase.entered',
      businessId: record.businessId,
      operation: record.operation,
      phaseId: record.phase.id,
      phaseKind: record.phase.kind,
    });
    record.trace.push({
      sequence: ++record.traceSequence,
      type: 'harness.tool.projected',
      projectionRevision: record.projectionRevision,
      tools: record.phase.tools,
    });
    return record.trace.slice(offset);
  }

  #recordTerminal(record: TransactionRecord, code?: string): void {
    record.trace.push({
      sequence: ++record.traceSequence,
      type: 'harness.terminal',
      businessId: record.businessId,
      operation: record.operation,
      phaseId: record.phase.id,
      terminalState: record.terminalState ?? 'aborted',
      ...(code ? { code } : {}),
    });
  }

  #snapshot(record: TransactionRecord): DefHarnessTransactionSnapshot {
    return {
      transactionId: record.transactionId,
      defSessionId: record.defSessionId,
      defTurnId: record.defTurnId,
      status: record.status,
      businessId: record.businessId,
      operation: record.operation,
      revision: record.revision ? { ...record.revision } : null,
      phaseId: record.phase.id,
      phaseKind: record.phase.kind,
      projection: this.#projection(record),
      terminalState: record.terminalState,
    };
  }

  #projection(record: TransactionRecord): EngineToolProjectionInput {
    const projectedNames = record.terminalState ? [] : record.phase.tools;
    const tools = projectedNames.map((name) => {
      const descriptor = name === DEF_HARNESS_ROUTE_TOOL_NAME
        ? this.#routeDescriptor
        : this.#resolveToolDescriptor(name);
      if (!descriptor) {
        throw new DefHarnessError('HARNESS_CATALOG_INVALID', `Harness Tool is not registered: ${name}`);
      }
      return {
        ...descriptor,
        description: `${descriptor.description}\nCurrent Harness phase: ${record.phase.instructions}`,
      };
    });
    return { revision: record.projectionRevision, tools };
  }

  #requireTransaction(transactionId: string): TransactionRecord {
    const record = this.#transactions.get(transactionId);
    if (!record) {
      throw new DefHarnessError('HARNESS_TRANSACTION_NOT_FOUND', `Harness transaction not found: ${transactionId}`);
    }
    return record;
  }

  #assertLive(record: TransactionRecord): void {
    if (record.terminalState) {
      throw new DefHarnessError(
        'HARNESS_TRANSACTION_TERMINAL',
        `Harness transaction ${record.transactionId} is already ${record.terminalState}`,
      );
    }
  }
}

function parseRouteInput(value: JsonValue): DefHarnessRouteInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DefHarnessError('HARNESS_ROUTE_INVALID', 'Harness route input must be an object');
  }
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes('businessId') || !keys.includes('operation')) {
    throw new DefHarnessError('HARNESS_ROUTE_INVALID', 'Harness route accepts only businessId and operation');
  }
  if (typeof value.businessId !== 'string' || typeof value.operation !== 'string') {
    throw new DefHarnessError('HARNESS_ROUTE_INVALID', 'Harness route businessId and operation must be strings');
  }
  return {
    businessId: value.businessId as DefHarnessBusinessId,
    operation: value.operation as DefHarnessOperationId,
  };
}

function validateCatalog(
  definitions: readonly DefHarnessRevisionDefinition[],
  resolveTool: ToolDescriptorResolver,
): ReadonlyMap<DefHarnessBusinessId, CatalogRecord> {
  const expected = ['buff', 'calculation', 'loadout', 'selection', 'timeline'];
  const actual = definitions.map((definition) => definition.businessId).sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new DefHarnessError('HARNESS_CATALOG_INVALID', 'Phase 3 catalog must contain exactly five businesses');
  }
  const result = new Map<DefHarnessBusinessId, CatalogRecord>();
  for (const definition of definitions) {
    if (definition.writeScope.length > 0 || definition.operations.length === 0) {
      throw new DefHarnessError('HARNESS_CATALOG_INVALID', `${definition.businessId} must be read-only and non-empty`);
    }
    const operations = new Map<DefHarnessOperationId, DefHarnessOperationDefinition>();
    for (const operation of definition.operations) {
      if (operations.has(operation.operation)) {
        throw new DefHarnessError('HARNESS_CATALOG_INVALID', `Duplicate operation ${definition.businessId}.${operation.operation}`);
      }
      validateOperation(definition.businessId, operation, resolveTool);
      operations.set(operation.operation, operation);
    }
    const contentHash = `sha256:${sha256(canonicalJson(definition as unknown as JsonValue))}`;
    result.set(definition.businessId, {
      definition,
      revision: Object.freeze({
        businessId: definition.businessId,
        revision: definition.revision,
        sourceLineage: definition.sourceLineage,
        contentHash,
      }),
      operations,
    });
  }
  return result;
}

function validateOperation(
  businessId: DefHarnessBusinessId,
  operation: DefHarnessOperationDefinition,
  resolveTool: ToolDescriptorResolver,
): void {
  const phases = new Map<string, DefHarnessPhaseDefinition>();
  for (const phase of operation.phases) {
    if (phases.has(phase.id)) {
      throw new DefHarnessError('HARNESS_CATALOG_INVALID', `Duplicate phase ${businessId}.${operation.operation}.${phase.id}`);
    }
    if (phase.writes.length > 0) {
      throw new DefHarnessError('HARNESS_CATALOG_INVALID', `Phase ${phase.id} is not read-only`);
    }
    for (const toolName of phase.tools) {
      const descriptor = resolveTool(toolName);
      if (!descriptor || descriptor.risk !== 'read') {
        throw new DefHarnessError('HARNESS_CATALOG_INVALID', `Phase ${phase.id} has an unknown or non-read Tool: ${toolName}`);
      }
    }
    phases.set(phase.id, phase);
  }
  if (!phases.has(operation.entryPhase)) {
    throw new DefHarnessError('HARNESS_CATALOG_INVALID', `Missing entry phase ${operation.entryPhase}`);
  }
  for (const phase of phases.values()) {
    if (phase.terminalState) {
      if (phase.tools.length > 0 || phase.onSuccess || phase.onFailure) {
        throw new DefHarnessError('HARNESS_CATALOG_INVALID', `Terminal phase ${phase.id} cannot expose Tools or transitions`);
      }
      continue;
    }
    if (phase.tools.length !== 1 || !phase.onSuccess || !phase.onFailure) {
      throw new DefHarnessError('HARNESS_CATALOG_INVALID', `Active phase ${phase.id} must expose one Tool and two transitions`);
    }
    if (!phases.has(phase.onSuccess) || !phases.has(phase.onFailure)) {
      throw new DefHarnessError('HARNESS_CATALOG_INVALID', `Phase ${phase.id} contains an unknown transition`);
    }
  }
  if (!reachesTerminal(operation.entryPhase, phases, new Set())) {
    throw new DefHarnessError('HARNESS_CATALOG_INVALID', `${businessId}.${operation.operation} has no terminal path`);
  }
}

function reachesTerminal(
  phaseId: string,
  phases: ReadonlyMap<string, DefHarnessPhaseDefinition>,
  visiting: ReadonlySet<string>,
): boolean {
  const phase = phases.get(phaseId);
  if (!phase) return false;
  if (phase.terminalState) return true;
  if (visiting.has(phaseId)) return false;
  const next = new Set(visiting);
  next.add(phaseId);
  return Boolean(
    phase.onSuccess
    && phase.onFailure
    && reachesTerminal(phase.onSuccess, phases, next)
    && reachesTerminal(phase.onFailure, phases, next)
  );
}

function requirePhase(
  operation: DefHarnessOperationDefinition,
  phaseId: string,
): DefHarnessPhaseDefinition {
  const phase = operation.phases.find((candidate) => candidate.id === phaseId);
  if (!phase) {
    throw new DefHarnessError('HARNESS_CATALOG_INVALID', `Harness phase not found: ${operation.operation}.${phaseId}`);
  }
  return phase;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function cloneCatalog(
  definitions: readonly DefHarnessRevisionDefinition[],
): readonly DefHarnessRevisionDefinition[] {
  return JSON.parse(JSON.stringify(definitions)) as DefHarnessRevisionDefinition[];
}

function cloneTransactionRecord(record: TransactionRecord): TransactionRecord {
  return {
    ...record,
    revision: record.revision ? { ...record.revision } : null,
    trace: [...record.trace],
  };
}
