const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { atomicWriteJson } = require('./revision-controller.cjs');

const PLAN_STATUSES = new Set(['active', 'stopped', 'completed']);
const STEP_STATUSES = new Set(['pending', 'active', 'completed', 'stopped']);

function emptyStore() {
  return { schemaVersion: 1, plans: [] };
}

function readStore(storePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    return parsed?.schemaVersion === 1 && Array.isArray(parsed.plans) ? parsed : emptyStore();
  } catch {
    return emptyStore();
  }
}

class BusinessPlanStore {
  constructor({ sessionDirectory, storePath } = {}) {
    const resolvedStorePath = storePath || (
      sessionDirectory
        ? path.join(sessionDirectory, '.def-harness-manager', 'plans.json')
        : ''
    );
    if (!resolvedStorePath) throw new Error('BusinessPlanStore requires sessionDirectory or storePath.');
    this.storePath = path.resolve(resolvedStorePath);
    this.store = readStore(this.storePath);
  }

  persist() {
    atomicWriteJson(this.storePath, this.store);
  }

  reload() {
    this.store = readStore(this.storePath);
    return this.store;
  }

  create({ sessionId, timelineId, checkoutId, goal, steps, schemeVersion }) {
    if (!Array.isArray(steps) || steps.length < 2) throw new Error('A cross-business plan requires at least two steps.');
    const now = Date.now();
    const plan = {
      planId: crypto.randomUUID(),
      sessionId: String(sessionId || ''),
      timelineId: String(timelineId || ''),
      checkoutId: String(checkoutId || ''),
      goal: String(goal || ''),
      status: 'active',
      currentIndex: 0,
      schemeVersions: schemeVersion ? [String(schemeVersion)] : [],
      steps: steps.map((step, index) => ({
        index,
        businessId: step.businessId,
        operation: step.operation,
        target: step.target || '',
        requestedEffect: step.requestedEffect,
        constraints: Array.isArray(step.constraints) ? step.constraints : [],
        status: index === 0 ? 'active' : 'pending',
        transactionId: null,
        inputSchemeVersion: index === 0 && schemeVersion ? String(schemeVersion) : null,
        outputSchemeVersion: null,
      })),
      createdAt: now,
      updatedAt: now,
    };
    this.store = { ...this.store, plans: [...this.store.plans, plan] };
    this.persist();
    return structuredClone(plan);
  }

  get(planId) {
    const plan = this.store.plans.find((candidate) => candidate.planId === planId);
    return plan ? structuredClone(plan) : null;
  }

  update(planId, updater) {
    const index = this.store.plans.findIndex((candidate) => candidate.planId === planId);
    if (index < 0) {
      const error = new Error(`Plan not found: ${planId}`);
      error.code = 'HARNESS_PLAN_NOT_FOUND';
      throw error;
    }
    const next = updater(structuredClone(this.store.plans[index]));
    if (!PLAN_STATUSES.has(next.status)) throw new Error(`Invalid plan status: ${next.status}`);
    if (next.steps.some((step) => !STEP_STATUSES.has(step.status))) throw new Error('Invalid plan step status.');
    next.updatedAt = Date.now();
    this.store = {
      ...this.store,
      plans: this.store.plans.map((plan, planIndex) => planIndex === index ? next : plan),
    };
    this.persist();
    return structuredClone(next);
  }

  bindCurrentTransaction(planId, transactionId, inputSchemeVersion) {
    return this.update(planId, (plan) => {
      if (plan.status !== 'active') throw new Error('Cannot bind a transaction to a stopped plan.');
      const step = plan.steps[plan.currentIndex];
      step.status = 'active';
      step.transactionId = transactionId;
      step.inputSchemeVersion = inputSchemeVersion || step.inputSchemeVersion || null;
      return plan;
    });
  }

  completeCurrentStep(planId, outputSchemeVersion) {
    return this.update(planId, (plan) => {
      const step = plan.steps[plan.currentIndex];
      step.status = 'completed';
      step.outputSchemeVersion = outputSchemeVersion || step.inputSchemeVersion || null;
      if (step.outputSchemeVersion) plan.schemeVersions.push(step.outputSchemeVersion);
      if (plan.currentIndex >= plan.steps.length - 1) {
        plan.status = 'completed';
        return plan;
      }
      plan.currentIndex += 1;
      const next = plan.steps[plan.currentIndex];
      next.status = 'active';
      next.inputSchemeVersion = step.outputSchemeVersion;
      return plan;
    });
  }

  stop(planId, reason) {
    return this.update(planId, (plan) => {
      plan.status = 'stopped';
      plan.stopReason = String(reason || 'stopped');
      const step = plan.steps[plan.currentIndex];
      if (step && step.status !== 'completed') step.status = 'stopped';
      return plan;
    });
  }
}

module.exports = { BusinessPlanStore };
