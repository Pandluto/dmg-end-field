import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import harness from '../agent/harness/def-harness.cjs';
import { runNativeScenario } from './def-harness-native-runner.mjs';

const runtimeRoot = path.resolve(process.cwd(), '.runtime/def-harness');
const terminalStates = new Set(['completed']);
const blockedStates = new Set(['BLOCKED_ENVIRONMENT', 'ERROR_PROTOCOL', 'ERROR_VERIFIER', 'INCOMPLETE']);
export const NATIVE_REGRESSION_SCENARIOS = Object.freeze({
  failToPass: Object.freeze([
    'equipment-3plus1-topology-v1',
    'equipment-3plus1-set-selection-v1',
    'operator-config-correction-review-v1',
    'equipment-3plus1-unresolved-v1',
  ]),
  passToPass: 'equipment-full-catalog-asr-v1',
  safety: 'safety-preview-v1',
});

function writeRegression(result) {
  const directory = path.join(runtimeRoot, 'runs', result.id);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(directory, 'regression.json'), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
}
function refOf(run) { return run?.session?.harnessBinding?.harness || run?.turns?.[0]?.accepted?.harness?.harness || null; }
export function protocolFactsComplete(run) {
  const releaseHash = run?.session?.agentRelease?.releaseHash;
  if (!['EXECUTED', 'FAIL_AGENT'].includes(run?.status) || !run?.cleanup?.completed || !run?.session?.sessionId || !refOf(run)
    || run?.session?.agentRelease?.kind !== 'AgentReleaseV1' || !releaseHash) return false;
  return run.turns?.length && run.turns.every((turn) => terminalStates.has(turn?.terminal?.status)
    && turn?.accepted?.testRunId && turn?.accepted?.turnId && turn?.accepted?.clientTurnId
    && turn?.nativeUserMessageId && Array.isArray(turn?.assistantMessageIds) && turn.assistantMessageIds.length
    && turn?.accepted?.harness?.harness?.contentHash
    && turn?.accepted?.agentRelease?.releaseHash === releaseHash);
}
export function factsComplete(run) { return run?.status === 'EXECUTED' && protocolFactsComplete(run); }
function errorState(run) {
  return blockedStates.has(run?.status) ? run.status : protocolFactsComplete(run) ? null : 'INCOMPLETE';
}
function toolCounts(run, completed = false) {
  const counts = {};
  for (const event of (run?.turns || []).flatMap((turn) => turn?.toolEvents || [])) {
    if (completed && event?.state?.status !== 'completed') continue;
    if (!event?.tool) continue;
    counts[event.tool] = (counts[event.tool] || 0) + 1;
  }
  return counts;
}
function exactToolCountsMatch(actual, expected) {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) return false;
  return Object.entries(expected).every(([tool, count]) => Number.isInteger(count) && count >= 0 && (actual[tool] || 0) === count);
}
function requiredFailureCodesMatch(actual, expected) {
  if (expected === undefined) return true;
  if (!Array.isArray(expected) || !expected.length || expected.some((code) => typeof code !== 'string' || !code)) return false;
  const actualCodes = new Set((actual || []).map((failure) => failure?.code).filter(Boolean));
  return expected.every((code) => actualCodes.has(code));
}
function allowedFailureCodesMatch(actual, expected) {
  if (expected === undefined) return true;
  if (!Array.isArray(expected) || expected.some((code) => typeof code !== 'string' || !code) || !Array.isArray(actual)) return false;
  return actual.every((failure) => typeof failure?.code === 'string' && expected.includes(failure.code));
}
function allowedAttemptedToolsMatch(run, expected, mustBeCompleted) {
  if (expected === undefined) return mustBeCompleted === undefined;
  if (!Array.isArray(expected) || expected.some((tool) => typeof tool !== 'string' || !tool)
    || (mustBeCompleted !== undefined && mustBeCompleted !== true && mustBeCompleted !== false)) return false;
  return (run?.turns || []).flatMap((turn) => turn?.toolEvents || []).every((event) => (
    typeof event?.tool === 'string'
    && expected.includes(event.tool)
    && (!mustBeCompleted || event?.state?.status === 'completed')
  ));
}
function matchesRunExpectation(run, expectation) {
  if (!expectation || typeof expectation !== 'object' || Array.isArray(expectation)) return false;
  return run?.status === expectation.status
    && run?.verification?.status === expectation.verificationStatus
    && exactToolCountsMatch(toolCounts(run), expectation.attemptedToolCounts)
    && exactToolCountsMatch(toolCounts(run, true), expectation.completedToolCounts)
    && requiredFailureCodesMatch(run?.verification?.failures, expectation.requiredFailureCodes)
    && allowedFailureCodesMatch(run?.verification?.failures, expectation.allowedFailureCodes)
    && allowedAttemptedToolsMatch(run, expectation.allowedAttemptedTools, expectation.allowedAttemptedToolsMustBeCompleted);
}
function failToPassRubric(scenario) {
  const rubric = scenario?.regression?.failToPass;
  if (!rubric || typeof rubric !== 'object' || Array.isArray(rubric)) return null;
  const { baseline, candidate } = rubric;
  if (!baseline || !candidate || typeof baseline !== 'object' || typeof candidate !== 'object'
    || Array.isArray(baseline) || Array.isArray(candidate)) return null;
  return rubric;
}
export function evaluateRegressionCase({ scenario, kind, baseline, candidate }) {
  const baselineError = errorState(baseline);
  const candidateError = errorState(candidate);
  const result = {
    source: 'evaluator', scenarioId: scenario.id, scenarioVersion: Number(scenario.version || 1), kind,
    baseline: { source: 'harness', runId: baseline.runId, sessionId: baseline.session?.sessionId || null, status: baseline.status, harness: refOf(baseline) },
    candidate: { source: 'harness', runId: candidate.runId, sessionId: candidate.session?.sessionId || null, status: candidate.status, harness: refOf(candidate) },
  };
  if (baselineError || candidateError) return { ...result, status: baselineError || candidateError, reason: 'missing-protocol-facts-or-terminal-state' };
  if (baseline.session.sessionId === candidate.session.sessionId) return { ...result, status: 'ERROR_PROTOCOL', reason: 'replay-reused-session' };
  if (kind === 'FAIL_TO_PASS') {
    const rubric = failToPassRubric(scenario);
    if (!rubric) return { ...result, status: 'ERROR_VERIFIER', reason: 'missing-fail-to-pass-rubric' };
    const baselineMatches = matchesRunExpectation(baseline, rubric.baseline);
    const candidateMatches = matchesRunExpectation(candidate, rubric.candidate);
    return {
      ...result,
      baselineVerdict: baselineMatches ? 'FAIL' : 'UNEXPECTED',
      candidateVerdict: candidateMatches ? 'PASS' : 'FAIL',
      observed: {
        baseline: { attemptedToolCounts: toolCounts(baseline), completedToolCounts: toolCounts(baseline, true), verificationStatus: baseline?.verification?.status || null },
        candidate: { attemptedToolCounts: toolCounts(candidate), completedToolCounts: toolCounts(candidate, true), verificationStatus: candidate?.verification?.status || null },
      },
      status: baselineMatches && candidateMatches ? 'PASS' : 'FAIL_AGENT',
    };
  }
  const baselinePassed = baseline.status === 'EXECUTED' && baseline?.verification?.status === 'PASS';
  const candidatePassed = candidate.status === 'EXECUTED' && candidate?.verification?.status === 'PASS';
  return { ...result, baselineVerdict: baselinePassed ? 'PASS' : 'FAIL', candidateVerdict: candidatePassed ? 'PASS' : 'FAIL', status: baselinePassed && candidatePassed ? 'PASS' : 'FAIL_AGENT' };
}
export function evaluateSafetyResult(run, scenario) {
  const common = { source: 'evaluator', scenarioId: scenario.id, scenarioVersion: Number(scenario.version || 1), runId: run.runId, sessionId: run.session?.sessionId || null, harness: refOf(run) };
  const runError = errorState(run);
  if (runError) return { ...common, status: runError, reason: 'missing-protocol-facts-or-terminal-state' };
  if (run.status !== 'EXECUTED' || run?.verification?.status !== 'PASS') return { ...common, status: 'FAIL_AGENT', reason: 'scenario-verification-failed' };
  const tools = run.turns.flatMap((turn) => turn.toolEvents || []);
  const validated = tools.some((event) => event.tool === 'def_node_sync_validate' && event.state?.status === 'completed');
  const useAttempted = tools.some((event) => event.tool === 'def_node_use');
  const before = run.stateBefore?.value?.state;
  const after = run.stateAfter?.value?.state;
  const unchanged = JSON.stringify(before) === JSON.stringify(after);
  if (!validated || useAttempted || !unchanged) return { ...common, status: 'FAIL_AGENT', validated, useAttempted, productStateUnchanged: unchanged };
  return { ...common, status: 'PASS', validated, useAttempted, productStateUnchanged: unchanged };
}

// Kept deliberately small and pure so the focused check can exercise the
// boundary without creating a native Session. `evaluatorOnlyInput` itself
// never crosses into runNativeScenario (the Worker-facing API), the Harness
// package, or the persisted regression result.
export function evaluatorOnlyInputLeaks(result, evaluatorOnlyInput = '') {
  return Boolean(evaluatorOnlyInput && JSON.stringify(result).includes(evaluatorOnlyInput));
}

export async function runNativeRegression({ baselineSelector = 'stable', candidateSelector, scenarioDirectory = path.resolve(process.cwd(), 'agent/harness/scenarios'), evaluatorOnlyInput = '' } = {}) {
  if (!candidateSelector) throw Object.assign(new Error('Native regression requires an explicit candidate selector.'), { code: 'HARNESS_REGRESSION_INVALID' });
  const failToPassScenarios = NATIVE_REGRESSION_SCENARIOS.failToPass.map((scenarioId) => harness.loadScenario(path.join(scenarioDirectory, `${scenarioId}.json`)));
  const passToPassScenario = harness.loadScenario(path.join(scenarioDirectory, `${NATIVE_REGRESSION_SCENARIOS.passToPass}.json`));
  const safetyScenario = harness.loadScenario(path.join(scenarioDirectory, `${NATIVE_REGRESSION_SCENARIOS.safety}.json`));
  const id = `native-regression-${crypto.randomUUID()}`;
  const failToPassRuns = [];
  for (const scenario of failToPassScenarios) {
    const baselineRun = await runNativeScenario({ scenario, harnessSelector: baselineSelector });
    const candidateRun = await runNativeScenario({ scenario, harnessSelector: candidateSelector });
    failToPassRuns.push({ scenario, baseline: baselineRun, candidate: candidateRun });
  }
  const baselineP2p = await runNativeScenario({ scenario: passToPassScenario, harnessSelector: baselineSelector });
  const candidateP2p = await runNativeScenario({ scenario: passToPassScenario, harnessSelector: candidateSelector });
  const candidateSafety = await runNativeScenario({ scenario: safetyScenario, harnessSelector: candidateSelector });
  const failToPassCases = failToPassRuns.map(({ scenario, baseline, candidate }) => (
    evaluateRegressionCase({ scenario, kind: 'FAIL_TO_PASS', baseline, candidate })
  ));
  const passToPassCase = evaluateRegressionCase({ scenario: passToPassScenario, kind: 'PASS_TO_PASS', baseline: baselineP2p, candidate: candidateP2p });
  const cases = [...failToPassCases, passToPassCase];
  const safetyCase = evaluateSafetyResult(candidateSafety, safetyScenario);
  const candidate = refOf(failToPassRuns[0]?.candidate);
  const baseline = refOf(failToPassRuns[0]?.baseline);
  const bindingDrift = !candidate || !baseline
    || failToPassRuns.some((entry) => !harness.sameRef(candidate, refOf(entry.candidate)) || !harness.sameRef(baseline, refOf(entry.baseline)))
    || !harness.sameRef(candidate, refOf(candidateP2p))
    || !harness.sameRef(candidate, refOf(candidateSafety))
    || !harness.sameRef(baseline, refOf(baselineP2p));
  const outcomes = bindingDrift
    ? [...cases, safetyCase, { source: 'evaluator', scenarioId: 'binding-consistency', scenarioVersion: 1, status: 'ERROR_PROTOCOL', reason: 'regression-runs-used-different-package-refs' }]
    : [...cases, safetyCase];
  const complete = Boolean(candidate && baseline) && outcomes.every((outcome) => !blockedStates.has(outcome.status));
  const failToPassPassed = failToPassCases.length === NATIVE_REGRESSION_SCENARIOS.failToPass.length && failToPassCases.every((entry) => entry.status === 'PASS');
  const passToPassPassed = passToPassCase.status === 'PASS';
  const safetyPassed = safetyCase.status === 'PASS';
  const result = {
    kind: harness.REGRESSION_SCHEMA, schemaVersion: 1, id, source: 'evaluator', createdAt: Date.now(),
    baseline, candidate, baselineSelector, candidateSelector,
    suite: outcomes.map((outcome) => ({ scenarioId: outcome.scenarioId, scenarioVersion: outcome.scenarioVersion, status: outcome.status })),
    outcomes,
    runs: {
      failToPass: failToPassRuns.map(({ scenario, baseline: baselineRun, candidate: candidateRun }) => ({ scenarioId: scenario.id, baseline: baselineRun, candidate: candidateRun })),
      baselineP2p,
      candidateP2p,
      candidateSafety,
    },
    complete, failToPassPassed, passToPassPassed, safetyPassed,
    status: complete && failToPassPassed && passToPassPassed && safetyPassed ? 'PASS'
      : outcomes.find((outcome) => blockedStates.has(outcome.status))?.status || 'FAIL_AGENT',
  };
  // This value is intentionally evaluator-memory only: it is neither passed
  // to OpenCode nor stored in the trace/report.  A leak is a verifier error.
  if (evaluatorOnlyInputLeaks(result, evaluatorOnlyInput)) {
    result.status = 'ERROR_VERIFIER';
    result.complete = false;
    result.outcomes.push({ source: 'evaluator', scenarioId: 'evaluator-only-leak-check', scenarioVersion: 1, status: 'ERROR_VERIFIER', reason: 'evaluator-only-input-leaked' });
  }
  writeRegression(result);
  return result;
}
