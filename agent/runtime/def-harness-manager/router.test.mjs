import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  beginRoutePhase,
  matchContinuation,
  validateRouteSubmission,
} = require('./router.cjs');
const { BusinessPlanStore } = require('./plans.cjs');

const definitions = [
  { businessId: 'selection', operations: ['inspect', 'search', 'replace'], summary: 'selection' },
  { businessId: 'loadout', operations: ['inspect', 'evaluate', 'resolve', 'recommend', 'apply'], summary: 'loadout' },
  { businessId: 'timeline', operations: ['add', 'apply', 'copy', 'current'], summary: 'timeline' },
  { businessId: 'buff', operations: ['add'], summary: 'buff' },
  { businessId: 'calculation', operations: ['calculate', 'skill_fact'], summary: 'calculation' },
];

test('new requests enter a Tool-isolated route phase', () => {
  const route = beginRoutePhase({ userText: '给别礼配置 3+1 潮涌套', definitions });
  assert.equal(route.kind, 'route-phase');
  assert.deepEqual(route.allowedTools, ['def.harness.route']);
  assert.equal(route.definitions.length, 5);
  assert.deepEqual(
    route.definitions.find((item) => item.businessId === 'loadout').operations,
    ['inspect', 'evaluate', 'resolve', 'recommend', 'apply'],
  );
  assert.doesNotMatch(route.instructions, /def_data_|def_node_/);
});

test('moves only narrow deterministic facts directly into a business transaction route', () => {
  const skillFact = beginRoutePhase({
    userText: '图腾下落-2层里的水龙卷算什么伤害',
    definitions,
  });
  assert.equal(skillFact.deterministic, true);
  assert.equal(skillFact.businessId, 'calculation');
  assert.equal(skillFact.operation, 'skill_fact');

  const currentNode = beginRoutePhase({ userText: '当前节点是什么？', definitions });
  assert.equal(currentNode.deterministic, true);
  assert.equal(currentNode.businessId, 'timeline');
  assert.equal(currentNode.operation, 'current');
});

test('keeps direct conversation out of business routing', () => {
  const rawResult = beginRoutePhase({ userText: '工具返回给你的原始 json 是什么', definitions });
  assert.equal(rawResult.kind, 'conversation');
  assert.equal(rawResult.intent, 'previous-result');

  for (const userText of [
    '为什么被截断了',
    '妈的谁设计的',
    '这是你自己找到的，上下文丢了？',
    '意思是你换不了人？',
  ]) {
    const followup = beginRoutePhase({ userText, definitions });
    assert.equal(followup.kind, 'conversation', userText);
    assert.equal(followup.intent, 'previous-result', userText);
  }

  const schemaFollowup = beginRoutePhase({ userText: 'selectedCharacters 不就是队伍吗？', definitions });
  assert.equal(schemaFollowup.kind, 'conversation');
  assert.equal(schemaFollowup.intent, 'previous-result-semantics');

  const capabilities = beginRoutePhase({ userText: '告诉我你所有工具', definitions });
  assert.equal(capabilities.kind, 'conversation');
  assert.equal(capabilities.intent, 'capabilities');

  const sessionId = beginRoutePhase({ userText: '会话 id 给我', definitions });
  assert.equal(sessionId.kind, 'conversation');
  assert.equal(sessionId.intent, 'session-id');
});

test('routes strong vertical-domain requests without an avoidable clarification', () => {
  const evaluation = beginRoutePhase({ userText: '莱万汀这个配装好吗', definitions });
  assert.equal(evaluation.businessId, 'loadout');
  assert.equal(evaluation.operation, 'evaluate');

  const currentRoster = beginRoutePhase({ userText: '现在队伍里有谁', definitions });
  assert.equal(currentRoster.businessId, 'selection');
  assert.equal(currentRoster.operation, 'inspect');

  const exactOperator = beginRoutePhase({ userText: '你知道卡缪吗', definitions });
  assert.equal(exactOperator.businessId, 'selection');
  assert.equal(exactOperator.operation, 'search');

  const localCatalog = beginRoutePhase({ userText: '本地角色库有谁', definitions });
  assert.equal(localCatalog.businessId, 'selection');
  assert.equal(localCatalog.operation, 'search');

  const replacementCandidates = beginRoutePhase({ userText: '如果重新选一个人，能换谁', definitions });
  assert.equal(replacementCandidates.businessId, 'selection');
  assert.equal(replacementCandidates.operation, 'search');

  const weaponCatalog = beginRoutePhase({ userText: '看看本地武器库', definitions });
  assert.equal(weaponCatalog.businessId, 'loadout');
  assert.equal(weaponCatalog.operation, 'resolve');
});

test('validates the required single and cross-business examples', () => {
  const loadout = validateRouteSubmission({
    kind: 'new-business',
    businessId: 'loadout',
    operation: 'recommend',
    target: '别礼',
    requestedEffect: '配置 3+1 潮涌套',
    constraints: ['3+1', '潮涌套'],
  }, { definitions });
  assert.equal(loadout.businessId, 'loadout');
  assert.equal(loadout.target, '别礼');

  const selection = validateRouteSubmission({
    kind: 'new-business',
    businessId: 'selection',
    operation: 'replace',
    target: '别礼',
    requestedEffect: '换成别礼',
  }, { definitions });
  assert.equal(selection.businessId, 'selection');

  const pipeline = validateRouteSubmission({
    kind: 'cross-business',
    goal: '换成别礼，再配 3+1 潮涌套',
    steps: [
      { businessId: 'selection', operation: 'replace', target: '别礼', requestedEffect: '换成别礼' },
      { businessId: 'loadout', operation: 'recommend', target: '别礼', requestedEffect: '配置 3+1 潮涌套' },
    ],
  }, { definitions });
  assert.deepEqual(pipeline.steps.map((step) => step.businessId), ['selection', 'loadout']);

  assert.throws(() => validateRouteSubmission({
    kind: 'cross-business',
    goal: '复制燃烬到第2格并应用',
    steps: [
      {
        businessId: 'timeline',
        operation: 'copy',
        target: '莱万汀第1格',
        requestedEffect: '复制到第2格',
        constraints: ['不带BUFF'],
      },
      {
        businessId: 'timeline',
        operation: 'apply',
        target: '莱万汀第2格',
        requestedEffect: '应用复制结果',
        constraints: ['无BUFF'],
      },
    ],
  }, { definitions }), {
    code: 'HARNESS_ROUTE_INVALID',
    message: /at least two different business ids/,
  });

  const newSelectionWhileAnotherTransactionExists = beginRoutePhase({
    userText: '换成别礼',
    definitions,
    transactions: [
      { transactionId: 'tx-loadout', businessId: 'loadout', operation: 'preview', status: 'awaiting-confirmation' },
    ],
  });
  assert.equal(newSelectionWhileAnotherTransactionExists.kind, 'route-phase');
});

test('continues one pending candidate and clarifies two', () => {
  const one = matchContinuation({
    userText: '确认应用刚才那套',
    transactions: [{ transactionId: 'tx-1', businessId: 'loadout', operation: 'apply', status: 'awaiting-confirmation', target: '别礼' }],
  });
  assert.equal(one.kind, 'continue');
  assert.equal(one.transactionId, 'tx-1');

  const two = matchContinuation({
    userText: '确认',
    transactions: [
      { transactionId: 'tx-1', businessId: 'loadout', operation: 'apply', status: 'awaiting-confirmation' },
      { transactionId: 'tx-2', businessId: 'timeline', operation: 'apply', status: 'awaiting-confirmation' },
    ],
  });
  assert.equal(two.kind, 'clarify');
  assert.equal(two.reason, 'ambiguous-continuation');

  const awaitingWins = matchContinuation({
    userText: '确认',
    transactions: [
      { transactionId: 'tx-active', businessId: 'timeline', operation: 'add', status: 'active' },
      { transactionId: 'tx-awaiting', businessId: 'loadout', operation: 'preview', status: 'awaiting-confirmation' },
    ],
  });
  assert.equal(awaitingWins.kind, 'continue');
  assert.equal(awaitingWins.transactionId, 'tx-awaiting');

  const resume = matchContinuation({
    userText: '继续',
    transactions: [
      { transactionId: 'tx-active', businessId: 'timeline', operation: 'add', status: 'active' },
    ],
  });
  assert.equal(resume.intent, 'resume');
  assert.equal(resume.transactionId, 'tx-active');
});

test('rejects entities and terms used as business ids', () => {
  assert.throws(() => validateRouteSubmission({
    kind: 'new-business',
    businessId: '3+1',
    operation: 'recommend',
    requestedEffect: '配装',
  }), { code: 'HARNESS_ROUTE_INVALID' });
});

test('persists and advances an ordered plan with each new scheme version', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'def-business-plan-'));
  const storePath = path.join(root, 'plans.json');
  const plans = new BusinessPlanStore({ storePath });
  const plan = plans.create({
    sessionId: 'session-a',
    timelineId: 'timeline-a',
    checkoutId: 'node-a',
    schemeVersion: 'scheme-1',
    goal: '换人后配装并计算',
    steps: [
      { businessId: 'selection', operation: 'replace', requestedEffect: '换人' },
      { businessId: 'loadout', operation: 'apply', requestedEffect: '配装' },
      { businessId: 'calculation', operation: 'calculate', requestedEffect: '计算' },
    ],
  });
  plans.bindCurrentTransaction(plan.planId, 'tx-selection', 'scheme-1');
  const afterSelection = plans.completeCurrentStep(plan.planId, 'scheme-2');
  assert.equal(afterSelection.currentIndex, 1);
  assert.equal(afterSelection.steps[1].inputSchemeVersion, 'scheme-2');
  plans.bindCurrentTransaction(plan.planId, 'tx-loadout', 'scheme-2');
  const afterLoadout = plans.completeCurrentStep(plan.planId, 'scheme-3');
  assert.equal(afterLoadout.steps[2].inputSchemeVersion, 'scheme-3');
  const recovered = new BusinessPlanStore({ storePath }).get(plan.planId);
  assert.equal(recovered.currentIndex, 2);
  assert.deepEqual(recovered.schemeVersions, ['scheme-1', 'scheme-2', 'scheme-3']);
});
