const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { atomicWriteJson } = require('./revision-controller.cjs');
const { normalizeEvidenceRef } = require('./context.cjs');
const { TransactionTraceStore } = require('./trace.cjs');

const TRANSACTION_STATUSES = new Set([
  'active',
  'awaiting-confirmation',
  'completed',
  'aborted',
  'superseded',
  'stale',
  'revoked',
]);
const TERMINAL_STATUSES = new Set(['completed', 'aborted', 'superseded', 'stale', 'revoked']);

function emptyStore() {
  return { schemaVersion: 1, transactions: [] };
}

function readStore(storePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    return parsed?.schemaVersion === 1 && Array.isArray(parsed.transactions) ? parsed : emptyStore();
  } catch {
    return emptyStore();
  }
}

function clone(value) {
  return structuredClone(value);
}

class BusinessTransactionStore {
  constructor({ sessionDirectory, storePath, traceStore } = {}) {
    const resolvedStorePath = storePath || (
      sessionDirectory
        ? path.join(sessionDirectory, '.def-harness-manager', 'transactions.json')
        : ''
    );
    if (!resolvedStorePath) throw new Error('BusinessTransactionStore requires sessionDirectory or storePath.');
    this.storePath = path.resolve(resolvedStorePath);
    this.sessionDirectory = sessionDirectory || path.dirname(path.dirname(this.storePath));
    this.store = readStore(this.storePath);
    this.trace = traceStore || new TransactionTraceStore({ sessionDirectory: this.sessionDirectory });
  }

  persist() {
    atomicWriteJson(this.storePath, this.store);
  }

  reload() {
    this.store = readStore(this.storePath);
    return this.store;
  }

  list({ statuses, businessId } = {}) {
    const statusSet = Array.isArray(statuses) ? new Set(statuses) : null;
    return this.store.transactions
      .filter((transaction) => !statusSet || statusSet.has(transaction.status))
      .filter((transaction) => !businessId || transaction.businessId === businessId)
      .map(clone);
  }

  get(transactionId) {
    const transaction = this.store.transactions.find((candidate) => candidate.transactionId === transactionId);
    return transaction ? clone(transaction) : null;
  }

  require(transactionId) {
    const transaction = this.get(transactionId);
    if (!transaction) {
      const error = new Error(`Business transaction not found: ${transactionId}`);
      error.code = 'HARNESS_TRANSACTION_NOT_FOUND';
      throw error;
    }
    return transaction;
  }

  create({
    context,
    businessId,
    operation,
    harnessRevision,
    target,
    constraints,
    phase,
    planId,
    planStepIndex,
  }) {
    if (!context?.sessionId || !context?.timelineId || !context?.checkoutId || !context?.schemeVersion) {
      const error = new Error('Transaction context is incomplete.');
      error.code = 'HARNESS_TRANSACTION_CONTEXT_INVALID';
      throw error;
    }
    if (!harnessRevision?.version || !harnessRevision?.contentHash) {
      const error = new Error('Transaction must pin a validated Harness Revision.');
      error.code = 'HARNESS_TRANSACTION_REVISION_INVALID';
      throw error;
    }
    const now = Date.now();
    const transaction = {
      transactionId: crypto.randomUUID(),
      sessionId: context.sessionId,
      timelineId: context.timelineId,
      axisBindingId: context.axisBindingId || '',
      checkoutId: context.checkoutId,
      checkoutType: context.checkoutType || '',
      startingSchemeVersion: context.schemeVersion,
      currentSchemeVersion: context.schemeVersion,
      formulaVersion: context.formulaVersion || '',
      serviceEpoch: context.serviceEpoch || '',
      businessId,
      operation,
      harnessRevision: {
        version: harnessRevision.version,
        contentHash: harnessRevision.contentHash,
      },
      target: target || '',
      constraints: Array.isArray(constraints) ? constraints : [],
      phase: phase || 'context',
      evidenceRefs: [],
      evidenceLockedAt: null,
      proposal: null,
      artifact: null,
      capability: null,
      workNodeRef: null,
      planId: planId || null,
      planStepIndex: Number.isInteger(planStepIndex) ? planStepIndex : null,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    this.store = { ...this.store, transactions: [...this.store.transactions, transaction] };
    this.persist();
    this.trace.append(transaction.transactionId, 'transaction-created', {
      route: { businessId, operation, target: transaction.target },
      harnessRevision: transaction.harnessRevision,
      context: {
        sessionId: transaction.sessionId,
        timelineId: transaction.timelineId,
        checkoutId: transaction.checkoutId,
        schemeVersion: transaction.startingSchemeVersion,
      },
      phase: transaction.phase,
    });
    return clone(transaction);
  }

  update(transactionId, updater, traceType = 'transaction-updated', traceDetails = {}) {
    const index = this.store.transactions.findIndex((candidate) => candidate.transactionId === transactionId);
    if (index < 0) {
      const error = new Error(`Business transaction not found: ${transactionId}`);
      error.code = 'HARNESS_TRANSACTION_NOT_FOUND';
      throw error;
    }
    const current = clone(this.store.transactions[index]);
    const next = updater(current);
    if (!TRANSACTION_STATUSES.has(next.status)) {
      const error = new Error(`Invalid transaction status: ${next.status}`);
      error.code = 'HARNESS_TRANSACTION_STATUS_INVALID';
      throw error;
    }
    next.updatedAt = Date.now();
    this.store = {
      ...this.store,
      transactions: this.store.transactions.map((transaction, transactionIndex) => (
        transactionIndex === index ? next : transaction
      )),
    };
    this.persist();
    this.trace.append(transactionId, traceType, {
      previousPhase: current.phase,
      phase: next.phase,
      previousStatus: current.status,
      status: next.status,
      ...traceDetails,
    });
    return clone(next);
  }

  transition(transactionId, { phase, status, currentSchemeVersion, formulaVersion, proposal, artifact, capability, workNodeRef } = {}) {
    return this.update(transactionId, (transaction) => ({
      ...transaction,
      ...(phase ? { phase } : {}),
      ...(status ? { status } : {}),
      ...(currentSchemeVersion ? { currentSchemeVersion } : {}),
      ...(formulaVersion ? { formulaVersion } : {}),
      ...(proposal !== undefined ? { proposal } : {}),
      ...(artifact !== undefined ? { artifact } : {}),
      ...(capability !== undefined ? { capability } : {}),
      ...(workNodeRef !== undefined ? { workNodeRef } : {}),
    }), 'phase-transition');
  }

  addEvidence(transactionId, evidence) {
    const normalized = normalizeEvidenceRef(evidence);
    return this.update(transactionId, (transaction) => {
      if (transaction.evidenceLockedAt) {
        const error = new Error('Evidence is locked for this proposal/confirmation chain.');
        error.code = 'HARNESS_EVIDENCE_LOCKED';
        throw error;
      }
      const duplicate = transaction.evidenceRefs.some((candidate) => (
        candidate.source === normalized.source
        && candidate.referenceId === normalized.referenceId
        && candidate.sectionId === normalized.sectionId
        && candidate.contentHash === normalized.contentHash
      ));
      return duplicate
        ? transaction
        : { ...transaction, evidenceRefs: [...transaction.evidenceRefs, normalized] };
    }, 'evidence-added', { evidence: normalized });
  }

  lockForConfirmation(transactionId, { proposal, artifact, capability } = {}) {
    return this.update(transactionId, (transaction) => ({
      ...transaction,
      proposal: proposal ?? transaction.proposal,
      artifact: artifact ?? transaction.artifact,
      capability: capability ?? transaction.capability,
      evidenceLockedAt: Date.now(),
      status: 'awaiting-confirmation',
      phase: 'awaiting-confirmation',
    }), 'confirmation-awaiting');
  }

  supersede(transactionId, replacementInput = undefined) {
    const prior = this.update(transactionId, (transaction) => ({
      ...transaction,
      status: 'superseded',
      phase: 'superseded',
      supersededAt: Date.now(),
    }), 'transaction-superseded');
    if (!replacementInput) return { superseded: prior, replacement: null };
    const replacement = this.create(replacementInput);
    this.update(transactionId, (transaction) => ({ ...transaction, replacementTransactionId: replacement.transactionId }), 'replacement-linked');
    return { superseded: this.get(transactionId), replacement };
  }

  markTerminal(transactionId, status, reason = '') {
    if (!TERMINAL_STATUSES.has(status)) throw new Error(`Not a terminal transaction status: ${status}`);
    return this.update(transactionId, (transaction) => ({
      ...transaction,
      status,
      phase: status,
      terminalReason: String(reason || ''),
      completedAt: Date.now(),
    }), 'transaction-terminal', { reason: String(reason || '') });
  }

  recordToolCall(transactionId, { callId, toolId, inputRef } = {}) {
    return this.trace.append(transactionId, 'tool-call', { callId, toolId, inputRef });
  }

  recordToolResult(transactionId, { callId, toolId, state, resultRef, error } = {}) {
    return this.trace.append(transactionId, 'tool-result', { callId, toolId, state, resultRef, error });
  }

  async recover({
    context,
    isRevisionRevoked = () => false,
    referenceAvailable = async () => true,
  } = {}) {
    const now = Date.now();
    const recovered = [];
    for (const candidate of this.list()) {
      if (TERMINAL_STATUSES.has(candidate.status)) {
        recovered.push(candidate);
        continue;
      }
      let terminalStatus = '';
      let reason = '';
      if (isRevisionRevoked(candidate.businessId, candidate.harnessRevision.version)) {
        terminalStatus = 'revoked';
        reason = 'harness-revision-revoked';
      } else if (!context
        || candidate.sessionId !== context.sessionId
        || candidate.timelineId !== context.timelineId
        || candidate.checkoutId !== context.checkoutId) {
        terminalStatus = 'stale';
        reason = 'bound-context-changed';
      } else if (candidate.currentSchemeVersion !== context.schemeVersion) {
        terminalStatus = 'stale';
        reason = 'scheme-version-changed';
      } else if ((candidate.proposal || candidate.capability?.required)
        && context.serviceEpoch
        && candidate.serviceEpoch !== context.serviceEpoch) {
        terminalStatus = candidate.capability?.required ? 'aborted' : 'stale';
        reason = candidate.serviceEpoch
          ? 'ephemeral-reference-service-restarted'
          : 'ephemeral-reference-service-epoch-missing';
      } else if (candidate.proposal?.expiresAt && Number(candidate.proposal.expiresAt) <= now) {
        terminalStatus = 'stale';
        reason = 'proposal-reference-expired';
      } else if (candidate.capability?.expiresAt && Number(candidate.capability.expiresAt) <= now) {
        terminalStatus = 'aborted';
        reason = 'capability-reference-expired';
      } else if (candidate.proposal && (!candidate.proposal.token || !(await referenceAvailable('proposal', candidate.proposal)))) {
        terminalStatus = 'stale';
        reason = 'proposal-reference-unavailable';
      } else if (candidate.capability?.required && (!candidate.capability.token || !(await referenceAvailable('capability', candidate.capability)))) {
        terminalStatus = 'aborted';
        reason = 'capability-reference-unavailable';
      } else if (candidate.workNodeRef?.required && (!candidate.workNodeRef.nodeId || !(await referenceAvailable('work-node', candidate.workNodeRef)))) {
        terminalStatus = 'stale';
        reason = 'work-node-reference-unavailable';
      } else {
        const evidenceAvailable = await Promise.all(candidate.evidenceRefs.map((evidence) => referenceAvailable('evidence', evidence)));
        if (evidenceAvailable.some((available) => !available)) {
          terminalStatus = 'stale';
          reason = 'evidence-reference-unavailable';
        }
      }
      recovered.push(terminalStatus
        ? this.markTerminal(candidate.transactionId, terminalStatus, reason)
        : candidate);
    }
    return recovered;
  }
}

module.exports = {
  BusinessTransactionStore,
  TERMINAL_STATUSES,
  TRANSACTION_STATUSES,
};
