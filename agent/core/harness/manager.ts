import { createHash } from 'node:crypto';
import {
  DEF_AGENT_IN_MEMORY_LIMITS,
  canonicalJson,
  type DefHarnessBusinessId,
  type DefHarnessCompletedPlanStep,
  type DefHarnessOperationDefinition,
  type DefHarnessOperationId,
  type DefHarnessPhaseDefinition,
  type DefHarnessPlanSnapshot,
  type DefHarnessPlanStep,
  type DefHarnessPlanTraceEvent,
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

type ResolvedPlanStep = DefHarnessPlanStep & {
  readonly revision: DefHarnessRevisionRef;
  readonly operationDefinition: DefHarnessOperationDefinition;
};

type TransactionPlanRecord = {
  readonly steps: readonly ResolvedPlanStep[];
  currentIndex: number;
  readonly completedSteps: DefHarnessCompletedPlanStep[];
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
  plan: TransactionPlanRecord | null;
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

const MIN_HARNESS_PLAN_STEPS = 1;
const MAX_HARNESS_PLAN_STEPS = 8;

const routePhase: DefHarnessPhaseDefinition = {
  id: 'route',
  kind: 'route',
  tools: [DEF_HARNESS_ROUTE_TOOL_NAME],
  writes: [],
  instructions: `Choose one allowlisted business operation, or submit one ordered ${MIN_HARNESS_PLAN_STEPS}-${MAX_HARNESS_PLAN_STEPS} step plan when the same user Turn clearly requires multiple business operations. Validate the entire plan before any business Tool runs.`,
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
    this.#catalog = validateCatalog(
      cloneCatalog(options.catalog ?? PHASE3_READONLY_HARNESS_CATALOG),
      this.#resolveToolDescriptor,
    );
    const businessIds = [...this.#catalog.keys()];
    const operationIds = [...new Set(
      [...this.#catalog.values()].flatMap((entry) => (
        entry.definition.operations.map((operation) => operation.operation)
      )),
    )];
    this.#routeDescriptor = {
      name: DEF_HARNESS_ROUTE_TOOL_NAME,
      description: 'Route this Turn to one allowlisted DEF business operation. For an ordered cross-business Turn, submit one bounded plan.',
      risk: 'read',
      inputSchema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['businessId', 'operation'],
            properties: {
              businessId: { enum: businessIds },
              operation: { enum: operationIds },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['steps'],
            properties: {
              steps: {
                type: 'array',
                minItems: MIN_HARNESS_PLAN_STEPS,
                maxItems: MAX_HARNESS_PLAN_STEPS,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['businessId', 'operation'],
                  properties: {
                    businessId: { enum: businessIds },
                    operation: { enum: operationIds },
                  },
                },
              },
            },
          },
        ],
      },
    };
    this.#catalogRevision = `def-harness:${sha256(canonicalJson(
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
    const interactive = [...this.#catalog.values()].some(({ definition }) => definition.writeScope.length > 0);
    return [
      `You are running inside the DEF Harness ${interactive ? 'interactive' : 'read-only'} phase.`,
      `Call ${DEF_HARNESS_ROUTE_TOOL_NAME} before any business Tool.`,
      'For a single business action, submit {businessId, operation}. When one user Turn clearly requires two or more ordered business actions, submit one {steps:[...]} plan up front; the Harness will advance it deterministically without another route guess.',
      `Plans contain ${MIN_HARNESS_PLAN_STEPS}-${MAX_HARNESS_PLAN_STEPS} allowlisted steps. Do not repeat a step, mix conversation.respond with business work, or put ask inside a multi-step plan. If clarification is needed, route one ask first, then submit the resolved plan after the answer.`,
      'Use conversation.respond for greetings, acknowledgements, capability questions, prior-result questions, or any direct response that needs no business Tool.',
      ...(interactive ? [
        'Mutation Tools never apply directly: the DEF Host pauses for an explicit user approval bound to the exact proposal and browser snapshot.',
        'If the target is ambiguous, choose the ask operation instead of guessing.',
      ] : ['Mutation is unavailable in this catalog.']),
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
      plan: null,
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
    const initialRoute = record.status === 'routing';
    const clarificationReroute = record.status === 'active'
      && record.operation === 'ask'
      && record.phase.tools.includes(DEF_HARNESS_ROUTE_TOOL_NAME);
    if (!initialRoute && !clarificationReroute) {
      throw new DefHarnessError('HARNESS_ROUTE_INVALID', 'Harness route is not available in the current phase');
    }
    this.assertToolProjected(transactionId, DEF_HARNESS_ROUTE_TOOL_NAME);
    const input = parseRouteInput(rawInput);
    const requestedSteps = routeInputSteps(input);
    validatePlanShape(requestedSteps);
    if (clarificationReroute && requestedSteps.some((step) => step.operation === 'ask')) {
      throw new DefHarnessError('HARNESS_ROUTE_INVALID', 'A clarification answer must reroute to a concrete operation, not another ask step');
    }
    // Resolve every route before cloning or staging the transaction. A bad
    // later step therefore cannot leave a partially accepted plan behind.
    const resolvedSteps = this.#resolvePlanSteps(requestedSteps);
    const candidate = cloneTransactionRecord(record);
    const traceOffset = candidate.trace.length;
    candidate.projectionRevision += 1;
    if (initialRoute) {
      candidate.plan = {
        steps: resolvedSteps,
        currentIndex: 0,
        completedSteps: [],
      };
      this.#activatePlanStep(candidate, 0, [planCreatedEvent(candidate.plan)]);
    } else {
      const priorPlan = requirePlan(candidate);
      const completedAsk = completedCurrentPlanStep(priorPlan);
      const completedSteps = [...priorPlan.completedSteps, completedAsk];
      const steps = [
        ...priorPlan.steps.slice(0, priorPlan.currentIndex + 1),
        ...resolvedSteps,
      ];
      candidate.plan = {
        steps,
        currentIndex: priorPlan.currentIndex + 1,
        completedSteps,
      };
      this.#activatePlanStep(candidate, candidate.plan.currentIndex, [
        { type: 'step.completed', step: completedAsk },
        planCreatedEvent(candidate.plan),
      ]);
    }
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
    const operationDefinition = record.operationDefinition;
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
    const targetPhase = requirePhase(operationDefinition, target);
    candidate.projectionRevision += 1;
    if (input.status === 'failed' || targetPhase.terminalState === 'aborted') {
      candidate.phase = targetPhase;
      candidate.status = 'aborted';
      candidate.terminalState = 'aborted';
      this.#recordPhaseAndProjection(candidate);
      this.#recordTerminal(candidate, undefined, [failedCurrentPlanStepEvent(requirePlan(candidate))]);
      return this.#stage(record, candidate, traceOffset);
    }

    if (targetPhase.terminalState === 'completed') {
      const plan = requirePlan(candidate);
      const completedStep = completedCurrentPlanStep(plan);
      plan.completedSteps.push(completedStep);
      const nextIndex = plan.currentIndex + 1;
      if (nextIndex < plan.steps.length) {
        this.#activatePlanStep(candidate, nextIndex, [{ type: 'step.completed', step: completedStep }]);
      } else {
        plan.currentIndex = plan.steps.length;
        candidate.phase = targetPhase;
        candidate.status = 'completed';
        candidate.terminalState = 'completed';
        this.#recordPhaseAndProjection(candidate);
        this.#recordTerminal(candidate, undefined, [{ type: 'step.completed', step: completedStep }]);
      }
      return this.#stage(record, candidate, traceOffset);
    }

    candidate.phase = targetPhase;
    this.#recordPhaseAndProjection(candidate);
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
    const planEvents = candidate.plan && candidate.plan.currentIndex < candidate.plan.steps.length
      ? [failedCurrentPlanStepEvent(candidate.plan, code)]
      : [];
    this.#recordTerminal(candidate, code, planEvents);
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

  #resolvePlanSteps(steps: readonly DefHarnessPlanStep[]): readonly ResolvedPlanStep[] {
    return steps.map((step) => {
      const catalog = this.#catalog.get(step.businessId);
      const operationDefinition = catalog?.operations.get(step.operation);
      if (!catalog || !operationDefinition) {
        throw new DefHarnessError(
          'HARNESS_ROUTE_UNSUPPORTED',
          `Unsupported Harness route: ${step.businessId}.${step.operation}`,
        );
      }
      return {
        businessId: step.businessId,
        operation: step.operation,
        revision: catalog.revision,
        operationDefinition,
      };
    });
  }

  #activatePlanStep(
    record: TransactionRecord,
    index: number,
    planEvents: readonly DefHarnessPlanTraceEvent[] = [],
  ): void {
    const plan = requirePlan(record);
    let nextIndex = index;
    let nextPlanEvents = planEvents;
    while (true) {
      const step = plan.steps[nextIndex];
      if (!step) {
        throw new DefHarnessError('HARNESS_CATALOG_INVALID', `Harness plan step is missing at index ${nextIndex}`);
      }
      plan.currentIndex = nextIndex;
      record.status = 'active';
      record.terminalState = null;
      record.businessId = step.businessId;
      record.operation = step.operation;
      record.revision = step.revision;
      record.operationDefinition = step.operationDefinition;
      record.phase = requirePhase(step.operationDefinition, step.operationDefinition.entryPhase);
      record.trace.push({
        sequence: ++record.traceSequence,
        type: 'harness.routed',
        businessId: step.businessId,
        operation: step.operation,
        revision: step.revision,
        ...(nextPlanEvents.length > 0 ? { planEvents: clonePlanTraceEvents(nextPlanEvents) } : {}),
      });
      if (!record.phase.terminalState) {
        this.#recordPhaseAndProjection(record);
        return;
      }
      if (record.phase.terminalState === 'aborted') {
        record.status = 'aborted';
        record.terminalState = 'aborted';
        this.#recordPhaseAndProjection(record);
        this.#recordTerminal(record, undefined, [failedCurrentPlanStepEvent(plan)]);
        return;
      }
      const completedStep = completedCurrentPlanStep(plan);
      plan.completedSteps.push(completedStep);
      nextIndex += 1;
      if (nextIndex >= plan.steps.length) {
        plan.currentIndex = plan.steps.length;
        record.status = 'completed';
        record.terminalState = 'completed';
        this.#recordPhaseAndProjection(record);
        this.#recordTerminal(record, undefined, [{ type: 'step.completed', step: completedStep }]);
        return;
      }
      nextPlanEvents = [{ type: 'step.completed', step: completedStep }];
    }
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

  #recordTerminal(
    record: TransactionRecord,
    code?: string,
    planEvents: readonly DefHarnessPlanTraceEvent[] = [],
  ): void {
    record.trace.push({
      sequence: ++record.traceSequence,
      type: 'harness.terminal',
      businessId: record.businessId,
      operation: record.operation,
      phaseId: record.phase.id,
      terminalState: record.terminalState ?? 'aborted',
      ...(code ? { code } : {}),
      ...(planEvents.length > 0 ? { planEvents: clonePlanTraceEvents(planEvents) } : {}),
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
      plan: record.plan ? immutablePlanSnapshot(record.plan) : null,
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
  if (keys.length === 2 && keys.includes('businessId') && keys.includes('operation')) {
    return parseRouteStep(value, 'Harness route');
  }
  if (keys.length === 1 && keys[0] === 'steps') {
    if (
      !Array.isArray(value.steps)
      || value.steps.length < MIN_HARNESS_PLAN_STEPS
      || value.steps.length > MAX_HARNESS_PLAN_STEPS
    ) {
      throw new DefHarnessError(
        'HARNESS_ROUTE_INVALID',
        `Harness plan steps must contain ${MIN_HARNESS_PLAN_STEPS}-${MAX_HARNESS_PLAN_STEPS} items`,
      );
    }
    return {
      steps: value.steps.map((step, index) => parseRouteStep(step, `Harness plan step ${index}`)),
    };
  }
  throw new DefHarnessError(
    'HARNESS_ROUTE_INVALID',
    'Harness route accepts only {businessId, operation} or {steps:[{businessId, operation}]}',
  );
}

function parseRouteStep(value: JsonValue, label: string): DefHarnessPlanStep {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DefHarnessError('HARNESS_ROUTE_INVALID', `${label} must be an object`);
  }
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes('businessId') || !keys.includes('operation')) {
    throw new DefHarnessError('HARNESS_ROUTE_INVALID', `${label} accepts only businessId and operation`);
  }
  if (
    typeof value.businessId !== 'string'
    || value.businessId.length < 1
    || value.businessId.length > 80
    || typeof value.operation !== 'string'
    || value.operation.length < 1
    || value.operation.length > 120
  ) {
    throw new DefHarnessError('HARNESS_ROUTE_INVALID', `${label} businessId and operation must be bounded strings`);
  }
  return {
    businessId: value.businessId as DefHarnessBusinessId,
    operation: value.operation as DefHarnessOperationId,
  };
}

function routeInputSteps(input: DefHarnessRouteInput): readonly DefHarnessPlanStep[] {
  return 'steps' in input ? input.steps : [input];
}

function validatePlanShape(steps: readonly DefHarnessPlanStep[]): void {
  if (steps.length < MIN_HARNESS_PLAN_STEPS || steps.length > MAX_HARNESS_PLAN_STEPS) {
    throw new DefHarnessError(
      'HARNESS_ROUTE_INVALID',
      `Harness plan must contain ${MIN_HARNESS_PLAN_STEPS}-${MAX_HARNESS_PLAN_STEPS} steps`,
    );
  }
  const seen = new Set<string>();
  for (const step of steps) {
    const key = `${step.businessId}\u0000${step.operation}`;
    if (seen.has(key)) {
      throw new DefHarnessError(
        'HARNESS_ROUTE_INVALID',
        `Harness plan repeats ${step.businessId}.${step.operation}`,
      );
    }
    seen.add(key);
  }
  if (steps.length > 1 && steps.some((step) => step.businessId === 'conversation' || step.operation === 'respond')) {
    throw new DefHarnessError('HARNESS_ROUTE_INVALID', 'conversation.respond must be the only step in its plan');
  }
  if (steps.length > 1 && steps.some((step) => step.operation === 'ask')) {
    throw new DefHarnessError('HARNESS_ROUTE_INVALID', 'ask must be routed alone before submitting a resolved plan');
  }
}

function validateCatalog(
  definitions: readonly DefHarnessRevisionDefinition[],
  resolveTool: ToolDescriptorResolver,
): ReadonlyMap<DefHarnessBusinessId, CatalogRecord> {
  const expected: readonly DefHarnessBusinessId[] = ['buff', 'calculation', 'loadout', 'selection', 'timeline'];
  const actual = definitions.map((definition) => definition.businessId).sort();
  const extras = actual.filter((businessId) => !expected.includes(businessId) && businessId !== 'conversation');
  if (expected.some((businessId) => !actual.includes(businessId)) || extras.length > 0) {
    throw new DefHarnessError('HARNESS_CATALOG_INVALID', 'Harness catalog must contain the five DEF businesses and may include direct conversation');
  }
  const result = new Map<DefHarnessBusinessId, CatalogRecord>();
  for (const definition of definitions) {
    if (definition.operations.length === 0) {
      throw new DefHarnessError('HARNESS_CATALOG_INVALID', `${definition.businessId} must be non-empty`);
    }
    const operations = new Map<DefHarnessOperationId, DefHarnessOperationDefinition>();
    for (const operation of definition.operations) {
      if (operations.has(operation.operation)) {
        throw new DefHarnessError('HARNESS_CATALOG_INVALID', `Duplicate operation ${definition.businessId}.${operation.operation}`);
      }
      validateOperation(definition.businessId, operation, definition.writeScope, resolveTool);
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
  writeScope: readonly string[],
  resolveTool: ToolDescriptorResolver,
): void {
  const phases = new Map<string, DefHarnessPhaseDefinition>();
  for (const phase of operation.phases) {
    if (phases.has(phase.id)) {
      throw new DefHarnessError('HARNESS_CATALOG_INVALID', `Duplicate phase ${businessId}.${operation.operation}.${phase.id}`);
    }
    for (const toolName of phase.tools) {
      const descriptor = toolName === DEF_HARNESS_ROUTE_TOOL_NAME
        ? {
            name: DEF_HARNESS_ROUTE_TOOL_NAME,
            description: 'Route this Turn to one allowlisted DEF business operation.',
            risk: 'read' as const,
            inputSchema: { type: 'object' } as const,
          }
        : resolveTool(toolName);
      if (!descriptor) {
        throw new DefHarnessError('HARNESS_CATALOG_INVALID', `Phase ${phase.id} has an unknown Tool: ${toolName}`);
      }
      if (descriptor.risk === 'mutate' && phase.writes.length === 0) {
        throw new DefHarnessError('HARNESS_CATALOG_INVALID', `Mutation phase ${phase.id} must declare a write scope`);
      }
      if (descriptor.risk !== 'mutate' && phase.writes.length > 0) {
        throw new DefHarnessError('HARNESS_CATALOG_INVALID', `Non-mutation phase ${phase.id} cannot declare writes`);
      }
    }
    for (const write of phase.writes) {
      if (!writeScope.includes(write)) {
        throw new DefHarnessError(
          'HARNESS_CATALOG_INVALID',
          `Phase ${phase.id} writes outside ${businessId} scope: ${write}`,
        );
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

function requirePlan(record: TransactionRecord): TransactionPlanRecord {
  if (!record.plan) {
    throw new DefHarnessError('HARNESS_CATALOG_INVALID', 'Active Harness transaction has no plan');
  }
  return record.plan;
}

function completedCurrentPlanStep(plan: TransactionPlanRecord): DefHarnessCompletedPlanStep {
  const step = plan.steps[plan.currentIndex];
  if (!step) {
    throw new DefHarnessError('HARNESS_CATALOG_INVALID', `Harness plan has no current step at ${plan.currentIndex}`);
  }
  return {
    index: plan.currentIndex,
    businessId: step.businessId,
    operation: step.operation,
    revision: { ...step.revision },
  };
}

function failedCurrentPlanStepEvent(
  plan: TransactionPlanRecord,
  code?: string,
): DefHarnessPlanTraceEvent {
  const step = plan.steps[plan.currentIndex];
  if (!step) {
    throw new DefHarnessError('HARNESS_CATALOG_INVALID', `Harness plan has no failed step at ${plan.currentIndex}`);
  }
  return {
    type: 'step.failed',
    stepIndex: plan.currentIndex,
    step: { businessId: step.businessId, operation: step.operation },
    revision: { ...step.revision },
    ...(code ? { code } : {}),
  };
}

function planCreatedEvent(plan: TransactionPlanRecord): DefHarnessPlanTraceEvent {
  return {
    type: 'plan.created',
    steps: plan.steps.map((step, index) => ({
      index,
      businessId: step.businessId,
      operation: step.operation,
      revision: { ...step.revision },
    })),
    currentIndex: plan.currentIndex,
  };
}

function immutablePlanSnapshot(plan: TransactionPlanRecord): DefHarnessPlanSnapshot {
  const steps = Object.freeze(plan.steps.map((step, index) => Object.freeze({
    index,
    businessId: step.businessId,
    operation: step.operation,
    revision: Object.freeze({ ...step.revision }),
  })));
  const completedSteps = Object.freeze(plan.completedSteps.map((step) => Object.freeze({
    index: step.index,
    businessId: step.businessId,
    operation: step.operation,
    revision: Object.freeze({ ...step.revision }),
  })));
  return Object.freeze({
    steps,
    currentIndex: plan.currentIndex,
    completedSteps,
  });
}

function clonePlanTraceEvents(
  events: readonly DefHarnessPlanTraceEvent[],
): readonly DefHarnessPlanTraceEvent[] {
  return events.map((event) => {
    if (event.type === 'plan.created') {
      return {
        type: event.type,
        steps: event.steps.map((step) => ({
          ...step,
          revision: { ...step.revision },
        })),
        currentIndex: event.currentIndex,
      };
    }
    if (event.type === 'step.completed') {
      return {
        type: event.type,
        step: {
          ...event.step,
          revision: { ...event.step.revision },
        },
      };
    }
    return {
      type: event.type,
      stepIndex: event.stepIndex,
      step: { ...event.step },
      revision: { ...event.revision },
      ...(event.code ? { code: event.code } : {}),
    };
  });
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
    plan: record.plan ? {
      steps: record.plan.steps.map((step) => ({
        ...step,
        revision: { ...step.revision },
      })),
      currentIndex: record.plan.currentIndex,
      completedSteps: record.plan.completedSteps.map((step) => ({
        ...step,
        revision: { ...step.revision },
      })),
    } : null,
    trace: [...record.trace],
  };
}
