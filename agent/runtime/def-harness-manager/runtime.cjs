const path = require('path');
const { BusinessHarnessRegistry } = require('./registry.cjs');
const { BusinessPlanStore } = require('./plans.cjs');
const { beginRoutePhase, validateRouteSubmission } = require('./router.cjs');
const { BusinessTransactionStore, TERMINAL_STATUSES } = require('./transactions.cjs');
const {
  assertProjectedTool,
  bindRuntimeTurn,
  readRuntimeBridge,
  writeRuntimeBridge,
} = require('./bridge.cjs');

function resultSucceeded(output) {
  if (output?.metadata?.ok === false) return false;
  if (output?.metadata?.state === 'error') return false;
  try {
    const parsed = typeof output?.output === 'string' ? JSON.parse(output.output) : output?.output;
    if (parsed?.ok === false || parsed?.error) return false;
  } catch {
    // A Tool-local text result is a successful execution unless metadata says otherwise.
  }
  return true;
}

class HarnessTransactionRuntime {
  constructor({
    sessionDirectory,
    businessRoot,
    revisionStatePath,
    toolTargets,
  } = {}) {
    if (!sessionDirectory) throw new Error('HarnessTransactionRuntime requires sessionDirectory.');
    this.sessionDirectory = path.resolve(sessionDirectory);
    this.toolTargets = Array.isArray(toolTargets) ? toolTargets : null;
    this.registry = new BusinessHarnessRegistry({
      businessRoot,
      statePath: revisionStatePath,
      toolIds: this.toolTargets?.map((target) => target.id),
    });
    this.transactions = new BusinessTransactionStore({ sessionDirectory: this.sessionDirectory });
    this.plans = new BusinessPlanStore({ sessionDirectory: this.sessionDirectory });
  }

  async targets() {
    if (!this.toolTargets) {
      const registry = await import('../def-tools/registry.mjs');
      this.toolTargets = registry.DEF_NATIVE_TARGETS;
    }
    return this.toolTargets;
  }

  async bindingFor(toolId) {
    return (await this.targets()).find((target) => target.id === toolId)?.nativeBinding || '';
  }

  async writeProjection(value) {
    const allowedToolIds = Array.isArray(value.allowedToolIds) ? value.allowedToolIds : [];
    const allowedToolBindings = (await Promise.all(allowedToolIds.map((toolId) => this.bindingFor(toolId)))).filter(Boolean);
    const current = readRuntimeBridge(this.sessionDirectory);
    return writeRuntimeBridge(this.sessionDirectory, {
      ...value,
      allowedToolIds,
      allowedToolBindings,
      projectionRevision: current?.projectionRevision || 0,
    });
  }

  async prepareRoute({ context, userText, definitions, turnId = '' }) {
    const unfinished = this.transactions.list({ statuses: ['active', 'awaiting-confirmation'] });
    const route = beginRoutePhase({ userText, transactions: unfinished, definitions });
    if (route.kind === 'continue') return this.projectTransaction(route.transactionId, { turnId });
    if (route.kind === 'clarify') {
      return this.writeProjection({
        mode: 'clarify',
        sessionId: context.sessionId,
        turnId,
        transactionId: null,
        businessId: null,
        operation: null,
        phase: 'clarify',
        instructions: route.question,
        question: route,
        context,
        allowedToolIds: [],
      });
    }
    return this.writeProjection({
      mode: 'route',
      sessionId: context.sessionId,
      turnId,
      transactionId: null,
      businessId: null,
      operation: null,
      phase: 'route',
      instructions: route.instructions,
      routeDefinitions: route.definitions,
      userText: route.userText,
      context,
      allowedToolIds: route.allowedTools,
    });
  }

  async acceptRouteSubmission(submission, { turnId = '' } = {}) {
    const bridge = readRuntimeBridge(this.sessionDirectory);
    if (!bridge || bridge.mode !== 'route') {
      const error = new Error('Route submission is not allowed outside Manager route phase.');
      error.code = 'HARNESS_ROUTE_PHASE_REQUIRED';
      throw error;
    }
    const route = validateRouteSubmission(submission, { definitions: bridge.routeDefinitions });
    if (route.kind === 'clarify') {
      return this.writeProjection({
        ...bridge,
        mode: 'clarify',
        phase: 'clarify',
        turnId: turnId || bridge.turnId,
        instructions: route.question,
        question: route,
        allowedToolIds: [],
      });
    }
    if (route.kind === 'cross-business') {
      const plan = this.plans.create({
        sessionId: bridge.context.sessionId,
        timelineId: bridge.context.timelineId,
        checkoutId: bridge.context.checkoutId,
        goal: route.goal,
        steps: route.steps,
        schemeVersion: bridge.context.schemeVersion,
      });
      return this.beginBusinessTransaction(route.steps[0], bridge.context, {
        planId: plan.planId,
        planStepIndex: 0,
        turnId: turnId || bridge.turnId,
      });
    }
    return this.beginBusinessTransaction(route, bridge.context, { turnId: turnId || bridge.turnId });
  }

  async beginBusinessTransaction(route, context, { planId = null, planStepIndex = null, turnId = '' } = {}) {
    const revision = await this.registry.resolveActive(route.businessId);
    if (!revision) {
      const error = new Error(`No active Harness Revision for ${route.businessId}.`);
      error.code = 'HARNESS_REVISION_NOT_ACTIVE';
      throw error;
    }
    const operation = revision.manifest.operations[route.operation];
    if (!operation) {
      const error = new Error(`Harness ${route.businessId}@${revision.version} does not support ${route.operation}.`);
      error.code = 'HARNESS_OPERATION_UNSUPPORTED';
      throw error;
    }
    const transaction = this.transactions.create({
      context,
      businessId: route.businessId,
      operation: route.operation,
      harnessRevision: revision,
      target: route.target,
      constraints: route.constraints,
      phase: operation.entryPhase,
      planId,
      planStepIndex,
    });
    if (planId) this.plans.bindCurrentTransaction(planId, transaction.transactionId, context.schemeVersion);
    return this.projectTransaction(transaction.transactionId, { turnId });
  }

  async projectTransaction(transactionId, { turnId = '' } = {}) {
    const transaction = this.transactions.require(transactionId);
    if (TERMINAL_STATUSES.has(transaction.status)) {
      const error = new Error(`Transaction is terminal: ${transaction.status}`);
      error.code = 'HARNESS_TRANSACTION_TERMINAL';
      throw error;
    }
    const revision = await this.registry.resolveRevision(transaction.businessId, transaction.harnessRevision);
    const operation = revision.manifest.operations[transaction.operation];
    const phase = operation?.phases.find((candidate) => candidate.id === transaction.phase);
    if (!phase) {
      const error = new Error(`Transaction phase is absent from its pinned Revision: ${transaction.phase}`);
      error.code = 'HARNESS_TRANSACTION_PHASE_INVALID';
      throw error;
    }
    return this.writeProjection({
      mode: 'business',
      sessionId: transaction.sessionId,
      turnId,
      transactionId,
      businessId: transaction.businessId,
      operation: transaction.operation,
      phase: phase.id,
      phaseKind: phase.kind,
      instructions: `${revision.instructions.trim()}\n\nCURRENT OPERATION PHASE: ${phase.id}\n${phase.instructions || ''}`.trim(),
      context: {
        sessionId: transaction.sessionId,
        timelineId: transaction.timelineId,
        checkoutId: transaction.checkoutId,
        schemeVersion: transaction.currentSchemeVersion,
        target: transaction.target,
        constraints: transaction.constraints,
        evidenceRefs: transaction.evidenceRefs,
      },
      allowedToolIds: phase.tools,
    });
  }

  bindTurn(sessionId, turnId) {
    return bindRuntimeTurn(this.sessionDirectory, sessionId, turnId);
  }

  assertTool({ sessionId, turnId, toolBinding, canonicalToolId }) {
    return assertProjectedTool({
      sessionDirectory: this.sessionDirectory,
      sessionId,
      turnId,
      toolBinding,
      canonicalToolId,
    });
  }

  async afterTool({ sessionId, turnId, callId, toolBinding, canonicalToolId, output }) {
    const bridge = this.assertTool({ sessionId, turnId, toolBinding, canonicalToolId });
    if (bridge.mode === 'route') {
      const route = output?.metadata?.route || (() => {
        try {
          return JSON.parse(output?.output || '{}')?.route;
        } catch {
          return null;
        }
      })();
      if (!route) {
        const error = new Error('Route Tool returned no structured route.');
        error.code = 'HARNESS_ROUTE_RESULT_INVALID';
        throw error;
      }
      return this.acceptRouteSubmission(route, { turnId });
    }
    if (bridge.mode !== 'business' || !bridge.transactionId) return bridge;
    this.transactions.recordToolResult(bridge.transactionId, {
      callId,
      toolId: canonicalToolId,
      state: resultSucceeded(output) ? 'success' : 'failure',
      resultRef: output?.metadata?.resultRef || null,
      error: resultSucceeded(output) ? null : output?.output,
    });
    const transaction = this.transactions.require(bridge.transactionId);
    const revision = await this.registry.resolveRevision(transaction.businessId, transaction.harnessRevision);
    const phase = revision.manifest.operations[transaction.operation].phases.find((candidate) => candidate.id === transaction.phase);
    const nextId = resultSucceeded(output) ? phase.transitions?.onSuccess : phase.transitions?.onFailure;
    const next = revision.manifest.operations[transaction.operation].phases.find((candidate) => candidate.id === nextId);
    if (!next) {
      const error = new Error(`Harness phase transition target not found: ${nextId}`);
      error.code = 'HARNESS_PHASE_TRANSITION_INVALID';
      throw error;
    }
    if (next.terminalState) {
      if (next.terminalState === 'awaiting-confirmation') {
        this.transactions.lockForConfirmation(transaction.transactionId, {
          proposal: output?.metadata?.proposal || transaction.proposal,
          artifact: output?.metadata?.artifact || transaction.artifact,
          capability: output?.metadata?.capability || transaction.capability,
        });
        return this.writeProjection({
          ...bridge,
          phase: next.id,
          phaseKind: next.kind,
          instructions: next.instructions || 'Wait for explicit user confirmation.',
          allowedToolIds: [],
        });
      }
      const status = next.terminalState === 'completed' ? 'completed' : 'aborted';
      this.transactions.markTerminal(transaction.transactionId, status, next.terminalState);
      return this.writeProjection({
        ...bridge,
        mode: 'complete',
        phase: next.id,
        phaseKind: next.kind,
        instructions: next.instructions || '',
        allowedToolIds: [],
      });
    }
    this.transactions.transition(transaction.transactionId, { phase: next.id });
    return this.projectTransaction(transaction.transactionId, { turnId });
  }
}

module.exports = { HarnessTransactionRuntime, resultSucceeded };
