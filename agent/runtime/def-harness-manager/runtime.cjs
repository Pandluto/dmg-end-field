const crypto = require('crypto');
const path = require('path');
const { BusinessHarnessRegistry } = require('./registry.cjs');
const { BusinessPlanStore } = require('./plans.cjs');
const { beginRoutePhase, validateRouteSubmission } = require('./router.cjs');
const { BusinessTransactionStore, TERMINAL_STATUSES } = require('./transactions.cjs');
const { MutationCommitCoordinator } = require('./commit-coordinator.cjs');
const { applyDownstreamEffects } = require('./downstream.cjs');
const { analyzeBusinessMutation } = require('./semantic-write-scope.cjs');
const {
  assertProjectedTool,
  bindRuntimeTurn,
  readRuntimeBridge,
  writeRuntimeBridge,
} = require('./bridge.cjs');

function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(require('fs').readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readNodeSource(sessionDirectory, layer) {
  const root = path.join(sessionDirectory, 'node', layer);
  const selection = readJsonIfPresent(path.join(root, 'selection.json'));
  const timeline = readJsonIfPresent(path.join(root, 'timeline.json'));
  const buffs = readJsonIfPresent(path.join(root, 'buffs.json'));
  const inputs = readJsonIfPresent(path.join(root, 'inputs.json'));
  if (!selection || !timeline || !buffs || !inputs) return null;
  return { schemaVersion: 1, selection, timeline, buffs, inputs };
}

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

function parsedToolOutput(output) {
  if (output?.metadata?.typedResult && typeof output.metadata.typedResult === 'object') return output.metadata.typedResult;
  try {
    return typeof output?.output === 'string' ? JSON.parse(output.output) : (output?.output || {});
  } catch {
    return {};
  }
}

function valueAtPath(value, pathExpression) {
  return String(pathExpression || '').split('.').filter(Boolean).reduce(
    (current, key) => current && typeof current === 'object' ? current[key] : undefined,
    value,
  );
}

function transitionForResult(phase, output) {
  if (!resultSucceeded(output)) return phase.transitions?.onFailure;
  const parsed = parsedToolOutput(output);
  const matched = (Array.isArray(phase.resultTransitions) ? phase.resultTransitions : [])
    .find((transition) => valueAtPath(parsed, transition.path) === transition.equals);
  return matched?.target || phase.transitions?.onSuccess;
}

function firstString(value, paths) {
  for (const expression of paths) {
    const candidate = valueAtPath(value, expression);
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return '';
}

function evidenceFromToolResult({ transaction, phase, canonicalToolId, callId, output, typedOutput }) {
  if (phase.kind !== 'evidence' || !resultSucceeded(output)) return null;
  const referenceId = firstString(typedOutput, [
    'referenceId',
    'artifact.artifactId',
    'artifactId',
    'operator.id',
    'character.id',
    'source.id',
    'reportId',
  ]) || String(output?.metadata?.artifactId || output?.metadata?.resultRef || callId || canonicalToolId);
  const sectionId = firstString(typedOutput, ['section.sectionId', 'sectionId']);
  const contentHash = firstString(typedOutput, [
    'contentHash',
    'source.revision',
    'sourceRevision',
    'bundleHash',
    'planHash',
    'formulaVersion',
  ]) || `sha256:${crypto.createHash('sha256').update(JSON.stringify(typedOutput || {})).digest('hex')}`;
  return {
    source: canonicalToolId,
    referenceId,
    sectionId,
    contentHash,
    applicability: `${transaction.businessId}.${transaction.operation}:${transaction.target || ''}`,
    conditions: transaction.constraints,
  };
}

function resultBindings(output, typedOutput) {
  const artifactId = firstString(typedOutput, ['artifact.artifactId', 'artifactId'])
    || String(output?.metadata?.artifactId || '');
  const capabilityToken = firstString(typedOutput, [
    'plannerProfileCapability',
    'approvalCapability',
    'capability.token',
    'fallbackToken',
  ]);
  const capabilityType = capabilityToken
    ? ['plannerProfileCapability', 'approvalCapability', 'capability.token', 'fallbackToken']
      .find((expression) => firstString(typedOutput, [expression]) === capabilityToken)
    : '';
  const expiresAt = Number(
    valueAtPath(typedOutput, 'capability.expiresAt')
    || typedOutput?.expiresAt
    || output?.metadata?.expiresAt
    || 0,
  ) || undefined;
  const nodeId = firstString(typedOutput, ['node.id', 'nodeId'])
    || String(output?.metadata?.nodeId || '');
  const nodeRevision = valueAtPath(typedOutput, 'node.contentRevision')
    ?? valueAtPath(typedOutput, 'node.updatedAt')
    ?? typedOutput?.revision
    ?? output?.metadata?.revision;
  const workingHash = firstString(typedOutput, [
    'node.workingHash',
    'workingHash',
  ]) || String(output?.metadata?.workingHash || '');
  return {
    artifact: output?.metadata?.artifact
      || (typedOutput?.artifact && typeof typedOutput.artifact === 'object' ? typedOutput.artifact : null)
      || (artifactId ? { id: artifactId, sourceRevision: firstString(typedOutput, ['source.revision', 'sourceRevision']) } : undefined),
    capability: output?.metadata?.capability
      || (capabilityToken ? {
        required: true,
        type: capabilityType,
        token: capabilityToken,
        ...(expiresAt ? { expiresAt } : {}),
      } : undefined),
    workNodeRef: nodeId ? {
      required: true,
      nodeId,
      ...(nodeRevision !== undefined && nodeRevision !== null
        ? { revision: Number(nodeRevision) || String(nodeRevision) }
        : {}),
      ...(workingHash ? { workingHash } : {}),
    } : undefined,
  };
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
    this.commits = new MutationCommitCoordinator({ sessionDirectory: this.sessionDirectory });
    this.mutationLeases = new Map();
  }

  refreshFromDisk() {
    this.registry.controller.reload();
    this.transactions.reload();
    this.plans.reload();
    return this;
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
    if (value.mode === 'clarify' && !allowedToolBindings.includes('question')) {
      allowedToolBindings.push('question');
    }
    const current = readRuntimeBridge(this.sessionDirectory);
    return writeRuntimeBridge(this.sessionDirectory, {
      ...value,
      allowedToolIds,
      allowedToolBindings,
      projectionRevision: current?.projectionRevision || 0,
    });
  }

  async prepareRoute({ context, userText, definitions, turnId = '' }) {
    let unfinished = this.transactions.list({ statuses: ['active', 'awaiting-confirmation'] });
    let route = beginRoutePhase({ userText, transactions: unfinished, definitions });
    if (route.kind === 'continue' && route.intent === 'correct') {
      this.transactions.supersede(route.transactionId);
      unfinished = this.transactions.list({ statuses: ['active', 'awaiting-confirmation'] });
      route = beginRoutePhase({ userText, transactions: unfinished, definitions });
    }
    if (route.kind === 'continue') return this.resumeTransaction(route.transactionId, route.intent, { context, turnId });
    if (route.kind === 'new-business' && route.deterministic === true) {
      return this.beginBusinessTransaction(route, context, { turnId });
    }
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
        routeDefinitions: definitions,
        userText,
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

  async resumeTransaction(transactionId, intent, { context, turnId = '' } = {}) {
    const transaction = this.transactions.require(transactionId);
    if (transaction.status !== 'awaiting-confirmation') {
      return this.projectTransaction(transactionId, { turnId });
    }
    if (context
      && (transaction.sessionId !== context.sessionId
        || transaction.timelineId !== context.timelineId
        || transaction.checkoutId !== context.checkoutId
        || transaction.currentSchemeVersion !== context.schemeVersion)) {
      this.transactions.markTerminal(transactionId, 'stale', 'confirmation-context-changed');
      const error = new Error('The confirmed proposal no longer matches the current scheme.');
      error.code = 'HARNESS_CONFIRMATION_STALE';
      throw error;
    }
    if (intent === 'reject') {
      this.transactions.markTerminal(transactionId, 'aborted', 'user-rejected');
      return this.writeProjection({
        mode: 'complete',
        sessionId: transaction.sessionId,
        turnId,
        transactionId,
        businessId: transaction.businessId,
        operation: transaction.operation,
        phase: 'rejected',
        instructions: 'The user rejected the proposal. Confirm that no mutation was applied.',
        context,
        allowedToolIds: [],
      });
    }
    if (intent !== 'confirm') {
      const error = new Error('A correction must supersede this proposal and start a fresh route.');
      error.code = 'HARNESS_CONFIRMATION_CORRECTION_REQUIRES_REPLAN';
      throw error;
    }
    const revision = await this.registry.resolveRevision(transaction.businessId, transaction.harnessRevision);
    const operation = revision.manifest.operations[transaction.operation];
    const awaiting = operation.phases.find((phase) => phase.id === transaction.phase);
    const nextId = awaiting?.transitions?.onConfirm;
    if (!nextId || !operation.phases.some((phase) => phase.id === nextId)) {
      const error = new Error(`Harness operation ${transaction.operation} has no confirmation continuation.`);
      error.code = 'HARNESS_CONFIRMATION_UNSUPPORTED';
      throw error;
    }
    this.transactions.transition(transactionId, { phase: nextId, status: 'active' });
    return this.projectTransaction(transactionId, { turnId });
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

  async finalizeTerminalPhase(transaction, phase, { context, turnId = '' } = {}) {
    const status = phase.terminalState === 'completed' ? 'completed' : 'aborted';
    const completed = TERMINAL_STATUSES.has(transaction.status)
      ? transaction
      : this.transactions.markTerminal(transaction.transactionId, status, phase.terminalState);
    let plan = null;
    if (completed.planId) {
      if (status === 'completed' && completed.sessionDetached) {
        plan = this.plans.stop(completed.planId, 'workbench-session-detached-after-selection');
      } else if (status === 'completed') {
        plan = this.plans.completeCurrentStep(completed.planId, completed.currentSchemeVersion);
        if (plan.status === 'active') {
          const nextStep = plan.steps[plan.currentIndex];
          return this.beginBusinessTransaction(nextStep, {
            ...context,
            sessionId: completed.sessionId,
            timelineId: completed.timelineId,
            checkoutId: completed.checkoutId,
            checkoutType: completed.checkoutType,
            schemeVersion: completed.currentSchemeVersion,
            serviceEpoch: completed.serviceEpoch,
          }, {
            planId: plan.planId,
            planStepIndex: plan.currentIndex,
            turnId,
          });
        }
      } else {
        plan = this.plans.stop(completed.planId, `${completed.businessId}.${completed.operation}:${phase.terminalState}`);
      }
    }
    return this.writeProjection({
      mode: 'complete',
      sessionId: completed.sessionId,
      turnId,
      transactionId: completed.transactionId,
      businessId: completed.businessId,
      operation: completed.operation,
      phase: phase.id,
      phaseKind: phase.kind,
      instructions: [
        phase.instructions || '',
        plan?.status === 'completed' ? `Cross-business plan completed: ${plan.goal}` : '',
        plan?.status === 'stopped' ? `Cross-business plan stopped: ${plan.stopReason}` : '',
      ].filter(Boolean).join('\n'),
      context,
      plan,
      allowedToolIds: [],
    });
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
    if (phase.terminalState && phase.terminalState !== 'awaiting-confirmation') {
      return this.finalizeTerminalPhase(transaction, phase, {
        turnId,
        context: {
          sessionId: transaction.sessionId,
          timelineId: transaction.timelineId,
          checkoutId: transaction.checkoutId,
          schemeVersion: transaction.currentSchemeVersion,
          serviceEpoch: transaction.serviceEpoch,
          target: transaction.target,
          constraints: transaction.constraints,
          evidenceRefs: transaction.evidenceRefs,
        },
      });
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
        serviceEpoch: transaction.serviceEpoch,
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

  async beforeTool({ sessionId, turnId, callId, toolBinding, canonicalToolId, args }) {
    const bridge = this.assertTool({ sessionId, turnId, toolBinding, canonicalToolId });
    if (bridge?.transactionId) {
      this.transactions.recordToolCall(bridge.transactionId, {
        callId,
        toolId: canonicalToolId,
        inputRef: args,
      });
    }
    if (bridge?.phaseKind === 'mutation' && bridge.transactionId) {
      const transaction = this.transactions.require(bridge.transactionId);
      let semantic = null;
      if (['timeline', 'buff'].includes(transaction.businessId)
        && ['def_node_use', 'def_node_restore'].includes(toolBinding)) {
        const binding = readJsonIfPresent(path.join(this.sessionDirectory, '.def-node.json'));
        const expected = transaction.workNodeRef;
        const referenceMismatch = expected?.required && (
          !binding
          || binding.nodeId !== expected.nodeId
          || (expected.revision !== undefined && String(binding.revision) !== String(expected.revision))
          || (expected.workingHash && binding.workingHash !== expected.workingHash)
        );
        if (referenceMismatch) {
          this.transactions.markTerminal(
            transaction.transactionId,
            'stale',
            'work-node-reference-changed-before-commit',
          );
          const error = new Error('The reviewed Work Node revision changed before commit.');
          error.code = 'HARNESS_WORK_NODE_REFERENCE_STALE';
          error.details = {
            expected,
            actual: binding
              ? { nodeId: binding.nodeId, revision: binding.revision, workingHash: binding.workingHash }
              : null,
          };
          throw error;
        }
        const baseSource = readNodeSource(this.sessionDirectory, 'base');
        const workingSource = readNodeSource(this.sessionDirectory, 'working');
        if (!baseSource || !workingSource) {
          const error = new Error('Harness mutation preflight requires complete node/base and node/working sources.');
          error.code = 'HARNESS_MUTATION_SOURCE_UNAVAILABLE';
          throw error;
        }
        semantic = analyzeBusinessMutation({
          businessId: transaction.businessId,
          beforePayload: toolBinding === 'def_node_restore' ? workingSource : baseSource,
          afterPayload: toolBinding === 'def_node_restore' ? baseSource : workingSource,
        });
        if (!semantic.pass) {
          const error = new Error(`Harness mutation exceeds ${transaction.businessId} write scope before commit.`);
          error.code = 'HARNESS_MUTATION_WRITE_SCOPE_VIOLATION';
          error.details = semantic;
          throw error;
        }
      }
      const lease = await this.commits.acquire({
        transactionId: transaction.transactionId,
        timelineId: transaction.timelineId,
        checkoutId: transaction.checkoutId,
      });
      this.mutationLeases.set(callId, { lease, semantic });
    }
    return bridge;
  }

  async afterTool(input) {
    try {
      return await this.advanceAfterTool(input);
    } finally {
      const pendingMutation = this.mutationLeases.get(input.callId);
      if (pendingMutation?.lease) this.commits.release(pendingMutation.lease);
      this.mutationLeases.delete(input.callId);
    }
  }

  async advanceAfterTool({ sessionId, turnId, callId, toolBinding, canonicalToolId, output }) {
    const bridge = this.assertTool({ sessionId, turnId, toolBinding, canonicalToolId });
    if (bridge.mode === 'route') {
      if (!resultSucceeded(output)) {
        return this.writeProjection({
          ...bridge,
          turnId,
          instructions: `${bridge.instructions || ''}\nThe previous route submission failed validation. Submit one corrected structured route; do not answer the business request directly.`.trim(),
        });
      }
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
    if (bridge.mode === 'clarify') {
      if (toolBinding !== 'question') {
        const error = new Error('Manager clarification only permits the native question interaction.');
        error.code = 'HARNESS_CLARIFICATION_TOOL_INVALID';
        throw error;
      }
      if (!resultSucceeded(output)) {
        return this.writeProjection({
          ...bridge,
          turnId,
          instructions: `${bridge.instructions || ''}\nThe native question did not return an answer. Keep this request unresolved and do not guess.`.trim(),
        });
      }
      return this.writeProjection({
        ...bridge,
        mode: 'route',
        phase: 'route',
        phaseKind: 'route',
        turnId,
        instructions: 'Use the user answer returned by the native question interaction to submit one structured route through def_harness_route.',
        question: null,
        allowedToolIds: ['def.harness.route'],
      });
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
    const typedOutput = parsedToolOutput(output);
    const bindings = resultBindings(output, typedOutput);
    if (bindings.artifact !== undefined || bindings.capability !== undefined || bindings.workNodeRef !== undefined) {
      this.transactions.transition(transaction.transactionId, bindings);
    }
    const evidence = evidenceFromToolResult({
      transaction,
      phase,
      canonicalToolId,
      callId,
      output,
      typedOutput,
    });
    if (evidence) this.transactions.addEvidence(transaction.transactionId, evidence);
    if (transaction.businessId === 'calculation'
      && canonicalToolId === 'def.data.resource.damage'
      && typeof typedOutput.formulaVersion === 'string'
      && typedOutput.formulaVersion) {
      this.transactions.transition(transaction.transactionId, { formulaVersion: typedOutput.formulaVersion });
    }
    const semanticMutation = output?.metadata?.semanticMutation;
    const preflightSemantic = this.mutationLeases.get(callId)?.semantic || null;
    let semantic = phase.kind === 'mutation' && semanticMutation?.beforePayload && semanticMutation?.afterPayload
      ? analyzeBusinessMutation({
        businessId: transaction.businessId,
        beforePayload: semanticMutation.beforePayload,
        afterPayload: semanticMutation.afterPayload,
      })
      : preflightSemantic;
    if (!semantic && phase.kind === 'mutation'
      && ['timeline', 'buff'].includes(transaction.businessId)
      && ['edit', 'apply_patch'].includes(toolBinding)
      && resultSucceeded(output)) {
      const baseSource = readNodeSource(this.sessionDirectory, 'base');
      const workingSource = readNodeSource(this.sessionDirectory, 'working');
      if (baseSource && workingSource) {
        semantic = analyzeBusinessMutation({
          businessId: transaction.businessId,
          beforePayload: baseSource,
          afterPayload: workingSource,
        });
      }
    }
    if (semantic && !semantic.pass) {
      this.transactions.markTerminal(transaction.transactionId, 'aborted', 'write-scope-violation');
      const error = new Error(`Harness mutation exceeds ${transaction.businessId} write scope.`);
      error.code = 'HARNESS_MUTATION_WRITE_SCOPE_VIOLATION';
      error.details = semantic;
      throw error;
    }
    if (phase.kind === 'mutation' && resultSucceeded(output) && output?.metadata?.currentCheckoutTouched === true) {
      const newSchemeVersion = output?.metadata?.schemeVersion || output?.metadata?.postcondition?.schemeVersion || '';
      const sessionDetached = output?.metadata?.sessionDetached === true;
      if (sessionDetached) {
        this.transactions.update(transaction.transactionId, (current) => ({
          ...current,
          sessionDetached: true,
        }), 'session-detached', {
          transition: typedOutput.transition || output?.metadata?.transition || '',
        });
      } else if (!newSchemeVersion) {
        applyDownstreamEffects({
          transactionStore: this.transactions,
          sourceTransactionId: transaction.transactionId,
          sourceBusiness: transaction.businessId,
          effects: semantic?.cascadeDetails || output?.metadata?.semanticEffects || {},
          newSchemeVersion: '',
        });
        this.transactions.markTerminal(
          transaction.transactionId,
          'stale',
          'mutation-scheme-version-unavailable',
        );
        if (transaction.planId) {
          this.plans.stop(transaction.planId, 'mutation-scheme-version-unavailable');
        }
        const error = new Error('The mutation reached the product, but Harness Manager could not bind its resulting scheme version.');
        error.code = 'HARNESS_MUTATION_SCHEME_VERSION_REQUIRED';
        throw error;
      } else {
        this.transactions.transition(transaction.transactionId, { currentSchemeVersion: newSchemeVersion });
      }
      applyDownstreamEffects({
        transactionStore: this.transactions,
        sourceTransactionId: transaction.transactionId,
        sourceBusiness: transaction.businessId,
        effects: semantic?.cascadeDetails || output?.metadata?.semanticEffects || {},
        newSchemeVersion,
      });
    }
    const nextId = transitionForResult(phase, output);
    const next = revision.manifest.operations[transaction.operation].phases.find((candidate) => candidate.id === nextId);
    if (!next) {
      const error = new Error(`Harness phase transition target not found: ${nextId}`);
      error.code = 'HARNESS_PHASE_TRANSITION_INVALID';
      throw error;
    }
    if (next.terminalState) {
      if (next.terminalState === 'awaiting-confirmation') {
        const parsed = parsedToolOutput(output);
        this.transactions.lockForConfirmation(transaction.transactionId, {
          proposal: output?.metadata?.proposal || (
            parsed?.proposalToken
              ? {
                id: parsed.proposalId || parsed.planId || parsed.proposalToken,
                token: parsed.proposalToken,
                ...(Number(parsed.expiresAt) ? { expiresAt: Number(parsed.expiresAt) } : {}),
              }
              : transaction.proposal
          ),
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
      return this.finalizeTerminalPhase(transaction, next, {
        context: bridge.context,
        turnId,
      });
    }
    this.transactions.transition(transaction.transactionId, { phase: next.id });
    return this.projectTransaction(transaction.transactionId, { turnId });
  }
}

module.exports = { HarnessTransactionRuntime, resultSucceeded };
