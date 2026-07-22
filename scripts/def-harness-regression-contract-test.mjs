import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  evaluateRegressionCase,
  evaluateSafetyResult,
  NATIVE_REGRESSION_SCENARIOS,
  protocolFactsComplete,
} from './def-harness-regression.mjs';

const project = path.resolve(import.meta.dirname, '..');
const readScenario = (file) => JSON.parse(fs.readFileSync(path.join(project, 'agent/harness/scenarios', file), 'utf8'));
const scenario = readScenario('equipment-3plus1-topology-v1.json');
const setSelectionScenario = readScenario('equipment-3plus1-set-selection-v1.json');
const correctionScenario = readScenario('operator-config-correction-review-v1.json');
const unresolvedScenario = readScenario('equipment-3plus1-unresolved-v1.json');
const p2pScenario = readScenario('equipment-full-catalog-asr-v1.json');
const safetyScenario = JSON.parse(fs.readFileSync(path.join(project, 'agent/harness/scenarios/safety-preview-v1.json'), 'utf8'));
const recommendTool = 'def_data_equipment_3plus1_recommend';
const harnessRef = {
  harnessId: 'def-equipment-3plus1-composite',
  version: '9.1.0-candidate.1',
  contentHash: 'a'.repeat(64),
  schemaVersion: 1,
};

function toolEvent(tool, status = 'completed') {
  return { tool, state: { status } };
}

function syntheticRun({ id, status, verificationStatus, verificationFailures = [], tools = [], toolEventsByTurn, stateChanged = false }) {
  const stateBefore = { checkout: { id: 'node-a', revision: 2 }, pending: null };
  const stateAfter = stateChanged ? { checkout: { id: 'node-b', revision: 3 }, pending: null } : stateBefore;
  const turnEvents = toolEventsByTurn ?? [tools];
  return {
    runId: `run-${id}`,
    status,
    cleanup: { completed: true },
    session: {
      sessionId: `ses-${id}`,
      harnessBinding: { harness: harnessRef },
      agentRelease: { kind: 'AgentReleaseV1', releaseHash: `release-${id}` },
    },
    verification: { status: verificationStatus, failures: verificationFailures },
    stateBefore: { value: { state: stateBefore } },
    stateAfter: { value: { state: stateAfter } },
    turns: turnEvents.map((events, turnIndex) => ({
      terminal: { status: 'completed' },
      accepted: {
        testRunId: `test-${id}-${turnIndex}`,
        turnId: `turn-${id}-${turnIndex}`,
        clientTurnId: `client-${id}-${turnIndex}`,
        harness: { harness: harnessRef },
        agentRelease: { releaseHash: `release-${id}` },
      },
      nativeUserMessageId: `user-${id}-${turnIndex}`,
      assistantMessageIds: [`assistant-${id}-${turnIndex}`],
      transcript: { messages: [{ info: { id: `assistant-${id}-${turnIndex}`, role: 'assistant' }, parts: [{ type: 'text', text: '已完成。' }] }] },
      toolEvents: events,
    })),
  };
}

assert.deepEqual(NATIVE_REGRESSION_SCENARIOS, {
  failToPass: [
    'equipment-3plus1-topology-v1',
    'equipment-3plus1-set-selection-v1',
    'operator-config-correction-review-v1',
    'equipment-3plus1-unresolved-v1',
  ],
  passToPass: 'equipment-full-catalog-asr-v1',
  safety: 'safety-preview-v1',
}, 'native regression covers every Spec 9 3+1 branch and a verified catalog pass-to-pass case');

assert.equal(scenario.regressionKind, 'FAIL_TO_PASS');
assert.deepEqual(scenario.regression.failToPass, {
  baseline: {
    status: 'FAIL_AGENT',
    verificationStatus: 'FAIL',
    attemptedToolCounts: { [recommendTool]: 0 },
    completedToolCounts: { [recommendTool]: 0 },
    requiredFailureCodes: ['required-tool-missing', 'required-turn-tool-missing'],
    allowedFailureCodes: ['required-tool-missing', 'required-turn-tool-missing', 'forbidden-tool-called', 'turn-tool-not-allowed', 'ordered-tool-sequence-violated'],
    allowedAttemptedTools: ['def_data_operator_build_guide', 'def_data_operator_build_profile', 'def_data_native_catalog_materialize', 'def_data_equipment_set_fit_shortlist', 'def_data_equipment_3plus1_facts', 'def_data_equipment_3plus1_plan'],
    allowedAttemptedToolsMustBeCompleted: true,
  },
  candidate: {
    status: 'EXECUTED',
    verificationStatus: 'PASS',
    attemptedToolCounts: { [recommendTool]: 1 },
    completedToolCounts: { [recommendTool]: 1 },
  },
}, 'the fail-to-pass rubric is the observable composite-tool behavior');

const baseline = syntheticRun({
  id: 'baseline',
  status: 'FAIL_AGENT',
  verificationStatus: 'FAIL',
  verificationFailures: [{ code: 'required-tool-missing' }, { code: 'required-turn-tool-missing' }],
});
const candidate = syntheticRun({ id: 'candidate', status: 'EXECUTED', verificationStatus: 'PASS', tools: [toolEvent(recommendTool)] });
assert.equal(protocolFactsComplete(baseline), true, 'an expected scenario failure still needs complete native protocol evidence');
const compositePass = evaluateRegressionCase({ scenario, kind: 'FAIL_TO_PASS', baseline, candidate });
assert.equal(compositePass.status, 'PASS');
assert.equal(compositePass.baselineVerdict, 'FAIL');
assert.equal(compositePass.candidateVerdict, 'PASS');

for (const { name, candidateScenario, completedCalls, baselineFailures } of [
  {
    name: 'set selection',
    candidateScenario: setSelectionScenario,
    completedCalls: 1,
    baselineFailures: ['required-tool-missing', 'required-turn-tool-missing'],
  },
  {
    name: 'correction',
    candidateScenario: correctionScenario,
    completedCalls: 2,
    baselineFailures: ['required-tool-missing', 'required-turn-tool-missing'],
  },
  {
    name: 'unresolved',
    candidateScenario: unresolvedScenario,
    completedCalls: 1,
    baselineFailures: ['required-tool-missing', 'required-turn-tool-missing', 'required-turn-typed-tool-result-missing'],
  },
]) {
  const rubric = candidateScenario.regression?.failToPass;
  assert.equal(candidateScenario.regressionKind, 'FAIL_TO_PASS', `${name} is included in the fail-to-pass suite`);
  assert.equal(rubric.baseline.allowedAttemptedToolsMustBeCompleted, true, `${name} baseline only allows completed legacy reads`);
  assert.equal(rubric.candidate.attemptedToolCounts[recommendTool], completedCalls, `${name} candidate has the required composite call count`);
  assert.equal(rubric.candidate.completedToolCounts[recommendTool], completedCalls, `${name} candidate completes every required composite call`);
  const branchBaseline = syntheticRun({ id: `${name}-baseline`, status: 'FAIL_AGENT', verificationStatus: 'FAIL', verificationFailures: baselineFailures.map((code) => ({ code })) });
  const branchCandidate = syntheticRun({
    id: `${name}-candidate`,
    status: 'EXECUTED',
    verificationStatus: 'PASS',
    toolEventsByTurn: Array.from({ length: candidateScenario.turns.length }, () => [toolEvent(recommendTool)]),
  });
  assert.equal(evaluateRegressionCase({ scenario: candidateScenario, kind: 'FAIL_TO_PASS', baseline: branchBaseline, candidate: branchCandidate }).status, 'PASS', `${name} accepts only the matching composite success`);
}
assert.equal(correctionScenario.turns.length, 2, 'correction retains the second fresh recommendation turn');
assert.deepEqual(unresolvedScenario.verification.requiredToolResultsByTurn, {
  1: { [recommendTool]: { contract: 'DefEquipmentThreePlusOneRecommendationV1', state: 'UNRESOLVED' } },
}, 'unresolved regression retains its typed result contract');
assert.ok(unresolvedScenario.verification.requiredFinalAssistantClausesByTurn, 'unresolved regression retains its final visible conclusion contract');

const legacyReadOnlyBaseline = structuredClone(baseline);
legacyReadOnlyBaseline.turns[0].toolEvents = [toolEvent('def_data_operator_build_guide'), toolEvent('def_data_equipment_3plus1_plan')];
legacyReadOnlyBaseline.verification.failures.push({ code: 'forbidden-tool-called' }, { code: 'turn-tool-not-allowed' }, { code: 'ordered-tool-sequence-violated' });
assert.equal(evaluateRegressionCase({ scenario, kind: 'FAIL_TO_PASS', baseline: legacyReadOnlyBaseline, candidate }).status, 'PASS', 'the known completed legacy read-only chain remains a valid baseline failure');

for (const state of ['error', 'pending', undefined]) {
  const failedLegacyRead = structuredClone(legacyReadOnlyBaseline);
  failedLegacyRead.turns[0].toolEvents[0].state = state === undefined ? {} : { status: state };
  assert.equal(evaluateRegressionCase({ scenario, kind: 'FAIL_TO_PASS', baseline: failedLegacyRead, candidate }).status, 'FAIL_AGENT', `an allowed legacy tool with ${state || 'an unknown'} state cannot satisfy the baseline rubric`);
}

const stableLeakedComposite = structuredClone(baseline);
stableLeakedComposite.turns[0].toolEvents = [toolEvent(recommendTool, 'error')];
assert.equal(evaluateRegressionCase({ scenario, kind: 'FAIL_TO_PASS', baseline: stableLeakedComposite, candidate }).status, 'FAIL_AGENT', 'the baseline cannot pass by exposing the candidate-only composite route');

const baselineWithStateMutation = structuredClone(baseline);
baselineWithStateMutation.stateAfter.value.state.checkout = { id: 'node-b', revision: 3 };
baselineWithStateMutation.verification.failures.push({ code: 'product-state-changed' });
assert.equal(evaluateRegressionCase({ scenario, kind: 'FAIL_TO_PASS', baseline: baselineWithStateMutation, candidate }).status, 'FAIL_AGENT', 'expected composite-missing failures cannot mask a product-state mutation');

const baselineWithUse = structuredClone(baseline);
baselineWithUse.turns[0].toolEvents = [toolEvent('def_node_use')];
assert.equal(evaluateRegressionCase({ scenario, kind: 'FAIL_TO_PASS', baseline: baselineWithUse, candidate }).status, 'FAIL_AGENT', 'expected composite-missing failures cannot mask a completed write tool');

const candidateSkippedComposite = structuredClone(candidate);
candidateSkippedComposite.turns[0].toolEvents = [];
assert.equal(evaluateRegressionCase({ scenario, kind: 'FAIL_TO_PASS', baseline, candidate: candidateSkippedComposite }).status, 'FAIL_AGENT', 'a passing verifier label cannot substitute for the composite call');

assert.equal(p2pScenario.regressionKind, 'PASS_TO_PASS');
assert.deepEqual(p2pScenario.verification.requiredTools, ['def_data_weapon', 'def_data_equipment'], 'pass-to-pass uses a verified catalog scenario');
assert.equal(p2pScenario.verification.mustKeepState, true, 'pass-to-pass catalog lookup remains read-only');
const p2pBaseline = syntheticRun({ id: 'p2p-baseline', status: 'EXECUTED', verificationStatus: 'PASS', tools: [toolEvent('def_data_weapon'), toolEvent('def_data_equipment')] });
const p2pCandidate = syntheticRun({ id: 'p2p-candidate', status: 'EXECUTED', verificationStatus: 'PASS', tools: [toolEvent('def_data_weapon'), toolEvent('def_data_equipment')] });
assert.equal(evaluateRegressionCase({ scenario: p2pScenario, kind: 'PASS_TO_PASS', baseline: p2pBaseline, candidate: p2pCandidate }).status, 'PASS');
const p2pCandidateFailure = structuredClone(p2pCandidate);
p2pCandidateFailure.verification.status = 'FAIL';
p2pCandidateFailure.status = 'FAIL_AGENT';
assert.equal(evaluateRegressionCase({ scenario: p2pScenario, kind: 'PASS_TO_PASS', baseline: p2pBaseline, candidate: p2pCandidateFailure }).status, 'FAIL_AGENT', 'PASS_TO_PASS still rejects an agent or verifier failure');

const safePreview = syntheticRun({ id: 'safe-preview', status: 'EXECUTED', verificationStatus: 'PASS', tools: [toolEvent('def_node_sync_validate')] });
assert.equal(evaluateSafetyResult(safePreview, safetyScenario).status, 'PASS');
for (const state of ['completed', 'error', 'pending', undefined]) {
  const attemptedUse = structuredClone(safePreview);
  attemptedUse.turns[0].toolEvents.push(state === undefined ? { tool: 'def_node_use', state: {} } : toolEvent('def_node_use', state));
  assert.equal(evaluateSafetyResult(attemptedUse, safetyScenario).status, 'FAIL_AGENT', `the safety gate rejects def_node_use with ${state || 'an unknown'} state`);
}

console.log(JSON.stringify({ ok: true, checks: ['spec9-all-3plus1-branches-fail-to-pass', 'completed-legacy-readonly-baseline-allowed', 'failed-legacy-read-rejected', 'stable-no-composite-leak', 'state-mutation-rejected', 'write-tool-rejected', 'candidate-composite-required', 'verified-catalog-pass-to-pass', 'safety-rejects-all-use-attempts'] }));
