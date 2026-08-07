import { createHash } from 'node:crypto';
import {
  DEF_AGENT_IN_MEMORY_LIMITS,
  canonicalJson,
  DEF_HARNESS_PERSISTED_TRANSACTION_VERSION,
  DEF_HARNESS_PERSISTENCE_LIMITS,
  type DefHarnessBusinessId,
  type DefHarnessCompletedPlanStep,
  type DefHarnessInterruption,
  type DefHarnessOperationDefinition,
  type DefHarnessOperationId,
  type DefHarnessPhaseKind,
  type DefHarnessPhaseDefinition,
  type DefHarnessPlanSnapshot,
  type DefHarnessPlanStep,
  type DefHarnessPlanTraceEvent,
  type DefHarnessPersistedTransaction,
  type DefHarnessPersistedTransactionStatus,
  type DefHarnessRevisionDefinition,
  type DefHarnessRevisionRef,
  type DefHarnessResumeInput,
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
  | 'HARNESS_PERSISTED_INVALID'
  | 'HARNESS_PERSISTED_CATALOG_MISMATCH'
  | 'HARNESS_PERSISTED_LIMIT'
  | 'HARNESS_RESUME_INVALID'
  | 'HARNESS_RESUME_BINDING_MISMATCH'
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
  interruption: DefHarnessInterruption | null;
  bindingSnapshotDigest: string | null;
  resumedFromTransactionId: string | null;
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
  readonly #prunedSessionIds = new Set<DefSessionId>();
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

  /**
   * Export only the bounded JSON facts needed to rebuild the live manager.
   * Operation definitions and Tool callbacks are intentionally absent.
   */
  exportPersistedTransactions(
    defSessionId?: DefSessionId,
  ): readonly DefHarnessPersistedTransaction[] {
    const records = [...this.#transactions.values()]
      .filter((record) => defSessionId === undefined || record.defSessionId === defSessionId)
      .sort((left, right) => left.transactionId.localeCompare(right.transactionId));
    if (records.length > DEF_HARNESS_PERSISTENCE_LIMITS.maxTransactionsPerSession && defSessionId) {
      throw new DefHarnessError(
        'HARNESS_PERSISTED_LIMIT',
        `Harness Session ${defSessionId} has too many persisted transactions`,
      );
    }
    const persisted = records.map((record) => this.#persistedSnapshot(record));
    const size = JSON.stringify(persisted).length;
    if (size > DEF_HARNESS_PERSISTENCE_LIMITS.maxSessionCodeUnits) {
      throw new DefHarnessError(
        'HARNESS_PERSISTED_LIMIT',
        `Harness Session persistence exceeds ${DEF_HARNESS_PERSISTENCE_LIMITS.maxSessionCodeUnits} code units`,
      );
    }
    return Object.freeze(persisted);
  }

  /**
   * Restore is two-phase: every snapshot is parsed and resolved against the
   * current catalog before any transaction is inserted into the manager.
   * This prevents a stale later step from causing a half-restored manager.
   */
  restorePersistedTransactions(
    input: readonly DefHarnessPersistedTransaction[],
  ): readonly DefHarnessTransactionSnapshot[] {
    if (!Array.isArray(input)) {
      throw new DefHarnessError('HARNESS_PERSISTED_INVALID', 'Persisted Harness transactions must be an array');
    }
    if (input.length > DEF_AGENT_IN_MEMORY_LIMITS.maxHarnessTransactionsPerHost) {
      throw new DefHarnessError(
        'HARNESS_PERSISTED_LIMIT',
        `Persisted Harness transactions exceed ${DEF_AGENT_IN_MEMORY_LIMITS.maxHarnessTransactionsPerHost}`,
      );
    }
    const restored: TransactionRecord[] = [];
    const seen = new Set<string>();
    for (const raw of input) {
      const parsed = validateDefHarnessPersistedTransaction(raw);
      if (seen.has(parsed.transactionId)) {
        throw new DefHarnessError('HARNESS_PERSISTED_INVALID', `Duplicate persisted transaction ${parsed.transactionId}`);
      }
      seen.add(parsed.transactionId);
      const existing = this.#transactions.get(parsed.transactionId);
      const candidate = this.#restorePersistedTransaction(parsed);
      if (existing) {
        if (canonicalJson(this.#persistedSnapshot(existing) as unknown as JsonValue)
          !== canonicalJson(parsed as unknown as JsonValue)) {
          throw new DefHarnessError(
            'HARNESS_PERSISTED_INVALID',
            `Persisted Harness transaction conflicts with live state: ${parsed.transactionId}`,
          );
        }
        continue;
      }
      restored.push(candidate);
    }
    if (
      this.#transactions.size + restored.length
      > DEF_AGENT_IN_MEMORY_LIMITS.maxHarnessTransactionsPerHost
    ) {
      throw new DefHarnessError(
        'HARNESS_PERSISTED_LIMIT',
        'Restored Harness transactions exceed the Host retention limit',
      );
    }
    for (const record of restored) this.#transactions.set(record.transactionId, record);
    return Object.freeze(restored.map((record) => this.#snapshot(record)));
  }

  restorePersistedTransaction(input: DefHarnessPersistedTransaction): DefHarnessTransactionSnapshot {
    const restored = this.restorePersistedTransactions([input]);
    const snapshot = restored[0];
    if (!snapshot) {
      throw new DefHarnessError('HARNESS_PERSISTED_INVALID', 'Persisted Harness transaction was not restored');
    }
    return snapshot;
  }

  consumePrunedSessionIds(): readonly DefSessionId[] {
    const sessionIds = [...this.#prunedSessionIds];
    this.#prunedSessionIds.clear();
    return sessionIds;
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
    readonly bindingSnapshotDigest?: string;
  }): DefHarnessTransition {
    const bindingSnapshotDigest = input.bindingSnapshotDigest === undefined
      ? null
      : boundedString(input.bindingSnapshotDigest, 'begin.bindingSnapshotDigest');
    const transactionId = `harness:${input.defTurnId}`;
    if (this.#transactions.has(transactionId)) {
      throw new DefHarnessError('HARNESS_CATALOG_INVALID', `Harness transaction already exists: ${transactionId}`);
    }
    this.#pruneTerminalTransactions(input.defSessionId);
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
      interruption: null,
      bindingSnapshotDigest,
      resumedFromTransactionId: null,
      plan: null,
      traceSequence: 0,
      trace: [],
    };
    this.#transactions.set(transactionId, record);
    const trace = this.#recordPhaseAndProjection(record);
    return { transaction: this.#snapshot(record), trace };
  }

  /**
   * Explicitly resume an interrupted transaction into a new Engine Turn.
   * This only creates the new Harness transaction and projection; it never
   * invokes a business Tool or mutates browser state. The caller must start a
   * fresh Engine Turn and let its normal approval path run again.
   */
  resumeFromInterrupted(input: DefHarnessResumeInput): DefHarnessTransition {
    const sourceTransactionId = boundedString(input.sourceTransactionId, 'resume.sourceTransactionId');
    const defSessionId = boundedString(input.defSessionId, 'resume.defSessionId') as DefSessionId;
    const defTurnId = boundedString(input.defTurnId, 'resume.defTurnId') as DefTurnId;
    const expectedCatalogRevision = boundedString(input.expectedCatalogRevision, 'resume.expectedCatalogRevision');
    const expectedBindingSnapshotDigest = boundedString(
      input.expectedBindingSnapshotDigest,
      'resume.expectedBindingSnapshotDigest',
    );
    const source = this.#requireTransaction(sourceTransactionId);
    if (expectedCatalogRevision !== this.#catalogRevision) {
      throw new DefHarnessError(
        'HARNESS_PERSISTED_CATALOG_MISMATCH',
        `Resume catalog ${expectedCatalogRevision} does not match ${this.#catalogRevision}`,
      );
    }
    if (source.defSessionId !== defSessionId) {
      throw new DefHarnessError(
        'HARNESS_RESUME_INVALID',
        `Interrupted Harness transaction ${source.transactionId} belongs to another Session`,
      );
    }
    if (
      source.status !== 'aborted'
      || source.terminalState !== 'aborted'
      || source.interruption === null
    ) {
      throw new DefHarnessError(
        'HARNESS_RESUME_INVALID',
        `Harness transaction ${source.transactionId} is not an interrupted transaction`,
      );
    }
    if (
      source.bindingSnapshotDigest === null
      || source.bindingSnapshotDigest !== expectedBindingSnapshotDigest
    ) {
      throw new DefHarnessError(
        'HARNESS_RESUME_BINDING_MISMATCH',
        `Harness transaction ${source.transactionId} does not match the current browser binding`,
      );
    }
    const transactionId = `harness:${defTurnId}`;
    if (source.defTurnId === defTurnId || this.#transactions.has(transactionId)) {
      throw new DefHarnessError(
        'HARNESS_RESUME_INVALID',
        `Resume Turn would reuse an existing Harness transaction: ${transactionId}`,
      );
    }

    // Revalidate the complete source snapshot immediately before resuming.
    // This catches catalog/revision drift even when the source record was
    // created by an older in-memory caller rather than restored from disk.
    const sourceSnapshot = validateDefHarnessPersistedTransaction(this.#persistedSnapshot(source));
    const validatedSource = this.#restorePersistedTransaction(sourceSnapshot);
    this.#pruneTerminalTransactions(defSessionId, source.transactionId);
    if (this.#transactions.size >= DEF_AGENT_IN_MEMORY_LIMITS.maxHarnessTransactionsPerHost) {
      throw new DefHarnessError(
        'HARNESS_TRANSACTION_CAPACITY',
        'Harness transaction retention is full; the interrupted evidence is being retained',
      );
    }

    const record: TransactionRecord = {
      transactionId,
      defSessionId,
      defTurnId,
      status: 'routing',
      businessId: null,
      operation: null,
      revision: null,
      operationDefinition: null,
      phase: routePhase,
      projectionRevision: 1,
      terminalState: null,
      interruption: null,
      bindingSnapshotDigest: expectedBindingSnapshotDigest,
      resumedFromTransactionId: source.transactionId,
      plan: null,
      traceSequence: 0,
      trace: [],
    };
    record.trace.push({
      sequence: ++record.traceSequence,
      type: 'harness.resumed',
      sourceTransactionId: source.transactionId,
      sourceDefTurnId: source.defTurnId,
    });

    if (!validatedSource.plan) {
      this.#recordPhaseAndProjection(record);
    } else {
      if (validatedSource.plan.currentIndex >= validatedSource.plan.steps.length) {
        throw new DefHarnessError(
          'HARNESS_RESUME_INVALID',
          `Harness transaction ${source.transactionId} has no unfinished plan step`,
        );
      }
      const currentPlan = validatedSource.plan;
      const resolvedSteps = currentPlan.steps.map((step) => {
        const catalog = this.#catalog.get(step.businessId);
        const operationDefinition = catalog?.operations.get(step.operation);
        if (!catalog || !operationDefinition) {
          throw new DefHarnessError(
            'HARNESS_PERSISTED_CATALOG_MISMATCH',
            `Resume plan step ${step.businessId}.${step.operation} is no longer in the catalog`,
          );
        }
        assertRevisionMatches(step.revision, catalog.revision, `${step.businessId}.${step.operation}`);
        return {
          businessId: step.businessId,
          operation: step.operation,
          revision: { ...step.revision },
          operationDefinition,
        };
      });
      record.plan = {
        steps: resolvedSteps,
        currentIndex: currentPlan.currentIndex,
        completedSteps: currentPlan.completedSteps.map((step) => ({
          ...step,
          revision: { ...step.revision },
        })),
      };
      this.#activatePlanStep(record, record.plan.currentIndex, [
        planCreatedEvent(record.plan),
        ...record.plan.completedSteps.map((step) => ({
          type: 'step.completed' as const,
          step: {
            ...step,
            revision: { ...step.revision },
          },
        })),
      ]);
    }
    this.#transactions.set(transactionId, record);
    return { transaction: this.#snapshot(record), trace: record.trace.map(cloneTraceEntry) };
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

  /**
   * Convert a crash-or-restart survivor into a terminal, explicitly marked
   * interrupted transaction. No business Tool is executed and the plan is
   * retained for later inspection or an explicit future resume policy.
   */
  interrupt(
    transactionId: string,
    input: { readonly code: string; readonly message: string; readonly occurredAt?: string },
  ): DefHarnessTransition {
    const record = this.#requireTransaction(transactionId);
    this.#assertLive(record);
    const candidate = cloneTransactionRecord(record);
    const traceOffset = candidate.trace.length;
    candidate.status = 'aborted';
    candidate.terminalState = 'aborted';
    candidate.interruption = {
      code: boundedString(input.code, 'interruption.code'),
      message: boundedString(input.message, 'interruption.message'),
      occurredAt: input.occurredAt ?? new Date().toISOString(),
    };
    candidate.projectionRevision += 1;
    candidate.trace.push({
      sequence: ++candidate.traceSequence,
      type: 'harness.tool.projected',
      projectionRevision: candidate.projectionRevision,
      tools: [],
    });
    const planEvents = candidate.plan && candidate.plan.currentIndex < candidate.plan.steps.length
      ? [failedCurrentPlanStepEvent(candidate.plan, input.code)]
      : [];
    this.#recordTerminal(candidate, input.code, planEvents);
    const transition = this.#stage(record, candidate, traceOffset);
    return this.commitPrepared(transition);
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

  #pruneTerminalTransactions(defSessionId?: DefSessionId, protectedTransactionId?: string): void {
    if (defSessionId) {
      let sessionCount = [...this.#transactions.values()]
        .filter((record) => record.defSessionId === defSessionId).length;
      if (sessionCount >= DEF_HARNESS_PERSISTENCE_LIMITS.maxTransactionsPerSession) {
        for (const [transactionId, record] of this.#transactions) {
          if (record.defSessionId !== defSessionId || !record.terminalState) continue;
          if (record.transactionId === protectedTransactionId) continue;
          this.#preparedTransitions.delete(transactionId);
          this.#transactions.delete(transactionId);
          this.#prunedSessionIds.add(record.defSessionId);
          sessionCount -= 1;
          if (sessionCount < DEF_HARNESS_PERSISTENCE_LIMITS.maxTransactionsPerSession) break;
        }
      }
    }
    if (this.#transactions.size < DEF_AGENT_IN_MEMORY_LIMITS.maxHarnessTransactionsPerHost) return;
    for (const [transactionId, record] of this.#transactions) {
      if (!record.terminalState) continue;
      if (record.transactionId === protectedTransactionId) continue;
      this.#preparedTransitions.delete(transactionId);
      this.#transactions.delete(transactionId);
      this.#prunedSessionIds.add(record.defSessionId);
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

  #persistedSnapshot(record: TransactionRecord): DefHarnessPersistedTransaction {
    const persisted: DefHarnessPersistedTransaction = {
      schemaVersion: DEF_HARNESS_PERSISTED_TRANSACTION_VERSION,
      catalogRevision: this.#catalogRevision,
      bindingSnapshotDigest: record.bindingSnapshotDigest,
      transactionId: record.transactionId,
      defSessionId: record.defSessionId,
      defTurnId: record.defTurnId,
      status: record.interruption ? 'interrupted' : record.status,
      businessId: record.businessId,
      operation: record.operation,
      revision: record.revision ? { ...record.revision } : null,
      phaseId: record.phase.id,
      phaseKind: record.phase.kind,
      projectionRevision: record.projectionRevision,
      terminalState: record.terminalState,
      interruption: record.interruption ? { ...record.interruption } : null,
      resumedFromTransactionId: record.resumedFromTransactionId,
      plan: record.plan ? immutablePlanSnapshot(record.plan) : null,
      trace: record.trace.map(cloneTraceEntry),
    };
    const traceLimit = DEF_HARNESS_PERSISTENCE_LIMITS.maxTraceEntriesPerTransaction;
    if (persisted.trace.length > traceLimit) {
      throw new DefHarnessError(
        'HARNESS_PERSISTED_LIMIT',
        `Harness transaction ${record.transactionId} has too many trace entries`,
      );
    }
    if (JSON.stringify(persisted).length > DEF_HARNESS_PERSISTENCE_LIMITS.maxSnapshotCodeUnits) {
      throw new DefHarnessError(
        'HARNESS_PERSISTED_LIMIT',
        `Harness transaction ${record.transactionId} exceeds the persistence size limit`,
      );
    }
    return deepFreeze(persisted);
  }

  #restorePersistedTransaction(input: DefHarnessPersistedTransaction): TransactionRecord {
    if (input.catalogRevision !== this.#catalogRevision) {
      throw new DefHarnessError(
        'HARNESS_PERSISTED_CATALOG_MISMATCH',
        `Persisted Harness catalog ${input.catalogRevision} does not match ${this.#catalogRevision}`,
      );
    }
    const plan = input.plan
      ? restorePlan(input.plan, this.#catalog)
      : null;
    const resolvedCurrent = resolveCurrentPersistedStep(input, plan, this.#catalog);
    validatePersistedTrace(input, this.#catalogRevision);
    const operationDefinition = resolvedCurrent?.operationDefinition ?? null;
    const phase = resolvedCurrent
      ? requirePhase(operationDefinition!, input.phaseId)
      : routePhase;
    if (phase.kind !== input.phaseKind) {
      throw new DefHarnessError(
        'HARNESS_PERSISTED_INVALID',
        `Persisted Harness phase kind does not match ${input.phaseId}`,
      );
    }
    const status = input.status === 'interrupted' ? 'aborted' : input.status;
    validatePersistedLifecycle(input, plan, phase, status);
    const record: TransactionRecord = {
      transactionId: input.transactionId,
      defSessionId: input.defSessionId,
      defTurnId: input.defTurnId,
      status,
      businessId: input.businessId,
      operation: input.operation,
      revision: input.revision ? { ...input.revision } : null,
      operationDefinition,
      phase,
      projectionRevision: input.projectionRevision,
      terminalState: input.terminalState,
      interruption: input.interruption ? { ...input.interruption } : null,
      bindingSnapshotDigest: input.bindingSnapshotDigest,
      resumedFromTransactionId: input.resumedFromTransactionId,
      plan: plan ? {
        steps: plan.steps.map((step) => ({
          ...step,
          operationDefinition: this.#catalog.get(step.businessId)!.operations.get(step.operation)!,
          revision: { ...step.revision },
        })),
        currentIndex: plan.currentIndex,
        completedSteps: plan.completedSteps.map((step) => ({
          ...step,
          revision: { ...step.revision },
        })),
      } : null,
      traceSequence: input.trace.at(-1)?.sequence ?? 0,
      trace: input.trace.map(cloneTraceEntry),
    };
    return record;
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
    interruption: record.interruption ? { ...record.interruption } : null,
    bindingSnapshotDigest: record.bindingSnapshotDigest,
    resumedFromTransactionId: record.resumedFromTransactionId,
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

function boundedString(value: unknown, label: string, max = 512): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > max
    || value !== value.trim()
    || value.includes('\u0000')
  ) {
    throw new DefHarnessError('HARNESS_PERSISTED_INVALID', `${label} must be bounded text`);
  }
  return value;
}

function safeInteger(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || typeof value !== 'number' || value < minimum) {
    throw new DefHarnessError('HARNESS_PERSISTED_INVALID', `${label} must be a safe integer >= ${minimum}`);
  }
  return value;
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DefHarnessError('HARNESS_PERSISTED_INVALID', `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new DefHarnessError('HARNESS_PERSISTED_INVALID', `${label} contains unexpected field ${key}`);
    }
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new DefHarnessError('HARNESS_PERSISTED_INVALID', `${label} is missing ${key}`);
    }
  }
}

function parseRevisionRef(value: unknown, label: string): DefHarnessRevisionRef {
  const object = objectValue(value, label);
  exactKeys(object, ['businessId', 'revision', 'sourceLineage', 'contentHash'], [], label);
  return {
    businessId: boundedString(object.businessId, `${label}.businessId`) as DefHarnessBusinessId,
    revision: boundedString(object.revision, `${label}.revision`),
    sourceLineage: boundedString(object.sourceLineage, `${label}.sourceLineage`),
    contentHash: boundedString(object.contentHash, `${label}.contentHash`),
  };
}

function parsePlanStep(value: unknown, label: string): DefHarnessCompletedPlanStep {
  const object = objectValue(value, label);
  exactKeys(object, ['index', 'businessId', 'operation', 'revision'], [], label);
  return {
    index: safeInteger(object.index, `${label}.index`),
    businessId: boundedString(object.businessId, `${label}.businessId`) as DefHarnessBusinessId,
    operation: boundedString(object.operation, `${label}.operation`) as DefHarnessOperationId,
    revision: parseRevisionRef(object.revision, `${label}.revision`),
  };
}

function parsePlanStepReference(value: unknown, label: string): DefHarnessPlanStep {
  const object = objectValue(value, label);
  exactKeys(object, ['businessId', 'operation'], [], label);
  return {
    businessId: boundedString(object.businessId, `${label}.businessId`) as DefHarnessBusinessId,
    operation: boundedString(object.operation, `${label}.operation`) as DefHarnessOperationId,
  };
}

function parsePlan(value: unknown): DefHarnessPlanSnapshot | null {
  if (value === null) return null;
  const object = objectValue(value, 'persisted.plan');
  exactKeys(object, ['steps', 'currentIndex', 'completedSteps'], [], 'persisted.plan');
  if (!Array.isArray(object.steps) || !Array.isArray(object.completedSteps)) {
    throw new DefHarnessError('HARNESS_PERSISTED_INVALID', 'persisted.plan steps must be arrays');
  }
  if (
    object.steps.length < MIN_HARNESS_PLAN_STEPS
    || object.steps.length > MAX_HARNESS_PLAN_STEPS
    || object.completedSteps.length > object.steps.length
  ) {
    throw new DefHarnessError('HARNESS_PERSISTED_LIMIT', 'Persisted Harness plan length is outside the bounded range');
  }
  const steps = object.steps.map((step, index) => {
    const parsed = parsePlanStep(step, `persisted.plan.steps[${index}]`);
    if (parsed.index !== index) {
      throw new DefHarnessError('HARNESS_PERSISTED_INVALID', 'Persisted Harness plan step indexes must be contiguous');
    }
    return parsed;
  });
  const completedSteps = object.completedSteps.map((step, index) => {
    const parsed = parsePlanStep(step, `persisted.plan.completedSteps[${index}]`);
    if (parsed.index >= steps.length) {
      throw new DefHarnessError('HARNESS_PERSISTED_INVALID', 'Persisted completed step index is outside the plan');
    }
    return parsed;
  });
  const currentIndex = safeInteger(object.currentIndex, 'persisted.plan.currentIndex');
  if (currentIndex > steps.length) {
    throw new DefHarnessError('HARNESS_PERSISTED_INVALID', 'Persisted plan currentIndex is outside the plan');
  }
  const completedIndexes = completedSteps.map((step) => step.index);
  if (new Set(completedIndexes).size !== completedIndexes.length) {
    throw new DefHarnessError('HARNESS_PERSISTED_INVALID', 'Persisted plan repeats a completed step');
  }
  if (
    completedSteps.length !== currentIndex
    || completedSteps.some((step, index) => step.index !== index)
  ) {
    throw new DefHarnessError(
      'HARNESS_PERSISTED_INVALID',
      'Persisted completed steps must be the contiguous prefix before currentIndex',
    );
  }
  return {
    steps,
    currentIndex,
    completedSteps,
  };
}

function parsePlanTraceEvent(value: unknown, label: string): DefHarnessPlanTraceEvent {
  const object = objectValue(value, label);
  const type = boundedString(object.type, `${label}.type`);
  if (type === 'plan.created') {
    exactKeys(object, ['type', 'steps', 'currentIndex'], [], label);
    if (!Array.isArray(object.steps)) {
      throw new DefHarnessError('HARNESS_PERSISTED_INVALID', `${label}.steps must be an array`);
    }
    const steps = object.steps.map((step, index) => parsePlanStep(step, `${label}.steps[${index}]`));
    return {
      type,
      steps,
      currentIndex: safeInteger(object.currentIndex, `${label}.currentIndex`),
    };
  }
  if (type === 'step.completed') {
    exactKeys(object, ['type', 'step'], [], label);
    return { type, step: parsePlanStep(object.step, `${label}.step`) };
  }
  if (type === 'step.failed') {
    exactKeys(object, ['type', 'stepIndex', 'step', 'revision'], ['code'], label);
    return {
      type,
      stepIndex: safeInteger(object.stepIndex, `${label}.stepIndex`),
      step: parsePlanStepReference(object.step, `${label}.step`),
      revision: parseRevisionRef(object.revision, `${label}.revision`),
      ...(object.code === undefined ? {} : { code: boundedString(object.code, `${label}.code`) }),
    };
  }
  throw new DefHarnessError('HARNESS_PERSISTED_INVALID', `${label} has unknown plan trace type ${type}`);
}

function parseTraceEntry(value: unknown, index: number): DefHarnessTraceEntry {
  const label = `persisted.trace[${index}]`;
  const object = objectValue(value, label);
  const type = boundedString(object.type, `${label}.type`);
  const sequence = safeInteger(object.sequence, `${label}.sequence`, 1);
  if (type === 'harness.routed') {
    exactKeys(object, ['sequence', 'type', 'businessId', 'operation', 'revision'], ['planEvents'], label);
    return {
      sequence,
      type,
      businessId: boundedString(object.businessId, `${label}.businessId`) as DefHarnessBusinessId,
      operation: boundedString(object.operation, `${label}.operation`) as DefHarnessOperationId,
      revision: parseRevisionRef(object.revision, `${label}.revision`),
      ...(object.planEvents === undefined
        ? {}
        : {
            planEvents: parsePlanEvents(object.planEvents, `${label}.planEvents`),
          }),
    };
  }
  if (type === 'harness.resumed') {
    exactKeys(object, ['sequence', 'type', 'sourceTransactionId', 'sourceDefTurnId'], [], label);
    return {
      sequence,
      type,
      sourceTransactionId: boundedString(object.sourceTransactionId, `${label}.sourceTransactionId`),
      sourceDefTurnId: boundedString(object.sourceDefTurnId, `${label}.sourceDefTurnId`) as DefTurnId,
    };
  }
  if (type === 'harness.phase.entered') {
    exactKeys(object, ['sequence', 'type', 'businessId', 'operation', 'phaseId', 'phaseKind'], [], label);
    return {
      sequence,
      type,
      businessId: object.businessId === null ? null : boundedString(object.businessId, `${label}.businessId`) as DefHarnessBusinessId,
      operation: object.operation === null ? null : boundedString(object.operation, `${label}.operation`) as DefHarnessOperationId,
      phaseId: boundedString(object.phaseId, `${label}.phaseId`),
      phaseKind: boundedString(object.phaseKind, `${label}.phaseKind`) as DefHarnessPhaseKind,
    };
  }
  if (type === 'harness.tool.projected') {
    exactKeys(object, ['sequence', 'type', 'projectionRevision', 'tools'], [], label);
    if (!Array.isArray(object.tools) || object.tools.length > 128) {
      throw new DefHarnessError('HARNESS_PERSISTED_INVALID', `${label}.tools is invalid`);
    }
    return {
      sequence,
      type,
      projectionRevision: safeInteger(object.projectionRevision, `${label}.projectionRevision`, 1),
      tools: object.tools.map((tool, toolIndex) => boundedString(tool, `${label}.tools[${toolIndex}]`, 256)),
    };
  }
  if (type === 'harness.terminal') {
    exactKeys(object, ['sequence', 'type', 'businessId', 'operation', 'phaseId', 'terminalState'], ['code', 'planEvents'], label);
    if (object.terminalState !== 'completed' && object.terminalState !== 'aborted') {
      throw new DefHarnessError('HARNESS_PERSISTED_INVALID', `${label}.terminalState is invalid`);
    }
    return {
      sequence,
      type,
      businessId: object.businessId === null ? null : boundedString(object.businessId, `${label}.businessId`) as DefHarnessBusinessId,
      operation: object.operation === null ? null : boundedString(object.operation, `${label}.operation`) as DefHarnessOperationId,
      phaseId: boundedString(object.phaseId, `${label}.phaseId`),
      terminalState: object.terminalState,
      ...(object.code === undefined ? {} : { code: boundedString(object.code, `${label}.code`) }),
      ...(object.planEvents === undefined
        ? {}
        : { planEvents: parsePlanEvents(object.planEvents, `${label}.planEvents`) }),
    };
  }
  throw new DefHarnessError('HARNESS_PERSISTED_INVALID', `${label} has unknown trace type ${type}`);
}

function parsePlanEvents(value: unknown, label: string): readonly DefHarnessPlanTraceEvent[] {
  if (!Array.isArray(value) || value.length > MAX_HARNESS_PLAN_STEPS + 2) {
    throw new DefHarnessError('HARNESS_PERSISTED_INVALID', `${label} is invalid`);
  }
  return value.map((event, index) => parsePlanTraceEvent(event, `${label}[${index}]`));
}

export function validateDefHarnessPersistedTransaction(value: unknown): DefHarnessPersistedTransaction {
  const object = objectValue(value, 'persisted Harness transaction');
  exactKeys(
    object,
    [
      'schemaVersion', 'catalogRevision', 'bindingSnapshotDigest', 'transactionId', 'defSessionId', 'defTurnId',
      'status', 'businessId', 'operation', 'revision', 'phaseId', 'phaseKind',
      'projectionRevision', 'terminalState', 'interruption', 'resumedFromTransactionId', 'plan', 'trace',
    ],
    [],
    'persisted Harness transaction',
  );
  if (object.schemaVersion !== DEF_HARNESS_PERSISTED_TRANSACTION_VERSION) {
    throw new DefHarnessError('HARNESS_PERSISTED_INVALID', 'Unsupported persisted Harness transaction schema');
  }
  const status = boundedString(object.status, 'persisted.status');
  if (!['routing', 'active', 'completed', 'aborted', 'interrupted'].includes(status)) {
    throw new DefHarnessError('HARNESS_PERSISTED_INVALID', 'Persisted Harness status is invalid');
  }
  const interruption = object.interruption === null
    ? null
    : (() => {
        const interruptionObject = objectValue(object.interruption, 'persisted.interruption');
        exactKeys(interruptionObject, ['code', 'message', 'occurredAt'], [], 'persisted.interruption');
        return {
          code: boundedString(interruptionObject.code, 'persisted.interruption.code'),
          message: boundedString(interruptionObject.message, 'persisted.interruption.message'),
          occurredAt: boundedString(interruptionObject.occurredAt, 'persisted.interruption.occurredAt'),
        };
      })();
  if (!Array.isArray(object.trace) || object.trace.length > DEF_HARNESS_PERSISTENCE_LIMITS.maxTraceEntriesPerTransaction) {
    throw new DefHarnessError('HARNESS_PERSISTED_LIMIT', 'Persisted Harness trace exceeds the bounded limit');
  }
  const trace = object.trace.map((entry, index) => parseTraceEntry(entry, index));
  for (let index = 0; index < trace.length; index += 1) {
    if (trace[index]!.sequence !== index + 1) {
      throw new DefHarnessError('HARNESS_PERSISTED_INVALID', 'Persisted Harness trace sequence is not contiguous');
    }
  }
  const parsed: DefHarnessPersistedTransaction = {
    schemaVersion: DEF_HARNESS_PERSISTED_TRANSACTION_VERSION,
    catalogRevision: boundedString(object.catalogRevision, 'persisted.catalogRevision'),
    bindingSnapshotDigest: object.bindingSnapshotDigest === null
      ? null
      : boundedString(object.bindingSnapshotDigest, 'persisted.bindingSnapshotDigest'),
    transactionId: boundedString(object.transactionId, 'persisted.transactionId'),
    defSessionId: boundedString(object.defSessionId, 'persisted.defSessionId') as DefSessionId,
    defTurnId: boundedString(object.defTurnId, 'persisted.defTurnId') as DefTurnId,
    status: status as DefHarnessPersistedTransactionStatus,
    businessId: object.businessId === null ? null : boundedString(object.businessId, 'persisted.businessId') as DefHarnessBusinessId,
    operation: object.operation === null ? null : boundedString(object.operation, 'persisted.operation') as DefHarnessOperationId,
    revision: object.revision === null ? null : parseRevisionRef(object.revision, 'persisted.revision'),
    phaseId: boundedString(object.phaseId, 'persisted.phaseId'),
    phaseKind: boundedString(object.phaseKind, 'persisted.phaseKind') as DefHarnessPersistedTransaction['phaseKind'],
    projectionRevision: safeInteger(object.projectionRevision, 'persisted.projectionRevision', 1),
    terminalState: object.terminalState === null ? null : object.terminalState as 'completed' | 'aborted',
    interruption,
    resumedFromTransactionId: object.resumedFromTransactionId === null
      ? null
      : boundedString(object.resumedFromTransactionId, 'persisted.resumedFromTransactionId'),
    plan: parsePlan(object.plan),
    trace,
  };
  if (parsed.terminalState !== null && parsed.terminalState !== 'completed' && parsed.terminalState !== 'aborted') {
    throw new DefHarnessError('HARNESS_PERSISTED_INVALID', 'Persisted Harness terminalState is invalid');
  }
  if (JSON.stringify(parsed).length > DEF_HARNESS_PERSISTENCE_LIMITS.maxSnapshotCodeUnits) {
    throw new DefHarnessError('HARNESS_PERSISTED_LIMIT', 'Persisted Harness transaction exceeds the size limit');
  }
  return parsed;
}

function validatePersistedTrace(
  input: DefHarnessPersistedTransaction,
  catalogRevision: string,
): void {
  const projections = input.trace.filter((entry) => entry.type === 'harness.tool.projected');
  if (projections.length === 0 || projections.at(-1)!.projectionRevision !== input.projectionRevision) {
    throw new DefHarnessError('HARNESS_PERSISTED_INVALID', 'Persisted Harness projection revision does not match its trace');
  }
  for (const entry of input.trace) {
    if (entry.type === 'harness.routed' && entry.revision.contentHash.length === 0) {
      throw new DefHarnessError('HARNESS_PERSISTED_INVALID', 'Persisted Harness route has no content hash');
    }
  }
  for (let index = 1; index < projections.length; index += 1) {
    if (projections[index]!.projectionRevision <= projections[index - 1]!.projectionRevision) {
      throw new DefHarnessError('HARNESS_PERSISTED_INVALID', 'Persisted Harness projection revisions must increase');
    }
  }
  if (!catalogRevision) {
    throw new DefHarnessError('HARNESS_PERSISTED_INVALID', 'Harness catalog revision is empty');
  }
}

function restorePlan(
  input: DefHarnessPlanSnapshot,
  catalog: ReadonlyMap<DefHarnessBusinessId, CatalogRecord>,
): DefHarnessPlanSnapshot {
  const steps = input.steps.map((step, index) => {
    const catalogRecord = catalog.get(step.businessId);
    const operationDefinition = catalogRecord?.operations.get(step.operation);
    if (!catalogRecord || !operationDefinition) {
      throw new DefHarnessError('HARNESS_PERSISTED_CATALOG_MISMATCH', `Persisted plan step ${step.businessId}.${step.operation} is no longer in the catalog`);
    }
    assertRevisionMatches(step.revision, catalogRecord.revision, `${step.businessId}.${step.operation}`);
    if (step.index !== index) {
      throw new DefHarnessError('HARNESS_PERSISTED_INVALID', 'Persisted plan step indexes are not contiguous');
    }
    return {
      index,
      businessId: step.businessId,
      operation: step.operation,
      revision: { ...step.revision },
    };
  });
  const completedSteps = input.completedSteps.map((step) => {
    const current = steps[step.index];
    if (!current || current.businessId !== step.businessId || current.operation !== step.operation) {
      throw new DefHarnessError('HARNESS_PERSISTED_INVALID', 'Persisted completed step does not match its plan step');
    }
    assertRevisionMatches(step.revision, current.revision, `completed step ${step.index}`);
    return { ...step, revision: { ...step.revision } };
  });
  return {
    steps,
    currentIndex: input.currentIndex,
    completedSteps,
  };
}

function resolveCurrentPersistedStep(
  input: DefHarnessPersistedTransaction,
  plan: DefHarnessPlanSnapshot | null,
  catalog: ReadonlyMap<DefHarnessBusinessId, CatalogRecord>,
): { readonly operationDefinition: DefHarnessOperationDefinition } | null {
  if (input.businessId === null || input.operation === null || input.revision === null) {
    if (input.businessId !== null || input.operation !== null || input.revision !== null) {
      throw new DefHarnessError('HARNESS_PERSISTED_INVALID', 'Persisted current Harness operation fields must be all null or all set');
    }
    if (plan !== null) {
      throw new DefHarnessError('HARNESS_PERSISTED_INVALID', 'Persisted plan cannot omit its current operation');
    }
    return null;
  }
  const catalogRecord = catalog.get(input.businessId);
  const operationDefinition = catalogRecord?.operations.get(input.operation);
  if (!catalogRecord || !operationDefinition) {
    throw new DefHarnessError('HARNESS_PERSISTED_CATALOG_MISMATCH', `Persisted operation ${input.businessId}.${input.operation} is no longer in the catalog`);
  }
  assertRevisionMatches(input.revision, catalogRecord.revision, `${input.businessId}.${input.operation}`);
  if (!plan || plan.steps.length === 0) {
    throw new DefHarnessError('HARNESS_PERSISTED_INVALID', 'Persisted operation has no plan step');
  }
  const stepIndex = plan.currentIndex >= plan.steps.length
    ? plan.steps.length - 1
    : plan.currentIndex;
  const current = plan.steps[stepIndex];
  if (current.businessId !== input.businessId || current.operation !== input.operation) {
    throw new DefHarnessError('HARNESS_PERSISTED_INVALID', 'Persisted current operation does not match plan.currentIndex');
  }
  assertRevisionMatches(current.revision, input.revision, 'persisted current operation');
  return { operationDefinition };
}

function assertRevisionMatches(
  actual: DefHarnessRevisionRef,
  expected: DefHarnessRevisionRef,
  label: string,
): void {
  if (
    actual.businessId !== expected.businessId
    || actual.revision !== expected.revision
    || actual.sourceLineage !== expected.sourceLineage
    || actual.contentHash !== expected.contentHash
  ) {
    throw new DefHarnessError('HARNESS_PERSISTED_CATALOG_MISMATCH', `${label} revision does not match the current catalog`);
  }
}

function validatePersistedLifecycle(
  input: DefHarnessPersistedTransaction,
  plan: DefHarnessPlanSnapshot | null,
  phase: DefHarnessPhaseDefinition,
  internalStatus: DefHarnessTransactionSnapshot['status'],
): void {
  if (input.transactionId !== `harness:${input.defTurnId}`) {
    throw new DefHarnessError('HARNESS_PERSISTED_INVALID', 'Persisted transaction and turn IDs do not correlate');
  }
  if (input.status === 'interrupted' && (!input.interruption || input.terminalState !== 'aborted')) {
    throw new DefHarnessError('HARNESS_PERSISTED_INVALID', 'Interrupted Harness transactions must have an aborted terminal state');
  }
  if (input.status !== 'interrupted' && input.interruption !== null) {
    throw new DefHarnessError('HARNESS_PERSISTED_INVALID', 'Only interrupted Harness transactions may carry interruption metadata');
  }
  if (internalStatus === 'routing') {
    if (plan !== null || input.businessId !== null || input.operation !== null || input.revision !== null || input.terminalState !== null || input.phaseId !== 'route' || phase.kind !== 'route') {
      throw new DefHarnessError('HARNESS_PERSISTED_INVALID', 'Persisted routing transaction has inconsistent state');
    }
    return;
  }
  const terminalTrace = input.trace.filter((entry) => entry.type === 'harness.terminal');
  if (internalStatus === 'active') {
    if (!plan || plan.currentIndex >= plan.steps.length || input.terminalState !== null || phase.terminalState || terminalTrace.length > 0) {
      throw new DefHarnessError('HARNESS_PERSISTED_INVALID', 'Persisted active transaction has inconsistent state');
    }
    return;
  }
  if (internalStatus === 'completed') {
    if (!plan || plan.currentIndex !== plan.steps.length || input.terminalState !== 'completed' || phase.terminalState !== 'completed' || terminalTrace.at(-1)?.terminalState !== 'completed') {
      throw new DefHarnessError('HARNESS_PERSISTED_INVALID', 'Persisted completed transaction has inconsistent state');
    }
    return;
  }
  if (input.terminalState !== 'aborted' || terminalTrace.at(-1)?.terminalState !== 'aborted') {
    throw new DefHarnessError('HARNESS_PERSISTED_INVALID', 'Persisted aborted transaction has no aborted terminal state');
  }
  if (phase.terminalState === 'completed') {
    throw new DefHarnessError('HARNESS_PERSISTED_INVALID', 'Persisted aborted transaction points to a completed phase');
  }
}

function cloneTraceEntry(entry: DefHarnessTraceEntry): DefHarnessTraceEntry {
  if (entry.type === 'harness.routed') {
    return {
      ...entry,
      revision: { ...entry.revision },
      ...(entry.planEvents ? { planEvents: clonePlanTraceEvents(entry.planEvents) } : {}),
    };
  }
  if (entry.type === 'harness.resumed') return { ...entry };
  if (entry.type === 'harness.phase.entered') return { ...entry };
  if (entry.type === 'harness.tool.projected') return { ...entry, tools: [...entry.tools] };
  return {
    ...entry,
    ...(entry.planEvents ? { planEvents: clonePlanTraceEvents(entry.planEvents) } : {}),
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}
