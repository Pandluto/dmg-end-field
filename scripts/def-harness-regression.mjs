import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import harness from '../agent/harness/def-harness.cjs';
import { runNativeScenario } from './def-harness-native-runner.mjs';

const runtimeRoot = path.resolve(process.cwd(), '.runtime/def-harness');
const terminalStates = new Set(['completed']);
const blockedStates = new Set(['BLOCKED_ENVIRONMENT', 'ERROR_PROTOCOL', 'ERROR_VERIFIER', 'INCOMPLETE']);

function writeRegression(result) {
  const directory = path.join(runtimeRoot, 'runs', result.id);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(directory, 'regression.json'), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
}
function assistantText(run) {
  return (run.turns || []).flatMap((turn) => (turn.transcript?.messages || [])
    .filter((message) => message?.info?.role === 'assistant' && turn.assistantMessageIds?.includes(message?.info?.id))
    .flatMap((message) => message.parts || [])
    .filter((part) => part?.type === 'text')
    .map((part) => String(part.text || ''))).join('\n');
}
function refOf(run) { return run?.session?.harnessBinding?.harness || run?.turns?.[0]?.accepted?.harness?.harness || null; }
function factsComplete(run) {
  if (run?.status !== 'EXECUTED' || !run?.cleanup?.completed || !run?.session?.sessionId || !refOf(run)) return false;
  return run.turns?.length && run.turns.every((turn) => terminalStates.has(turn?.terminal?.status)
    && turn?.accepted?.testRunId && turn?.accepted?.turnId && turn?.accepted?.clientTurnId
    && turn?.nativeUserMessageId && Array.isArray(turn?.assistantMessageIds) && turn.assistantMessageIds.length
    && turn?.accepted?.harness?.harness?.contentHash);
}
function errorState(run) {
  return blockedStates.has(run?.status) ? run.status : factsComplete(run) ? null : 'INCOMPLETE';
}
function caseResult({ scenario, kind, baseline, candidate }) {
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
    const needle = String(scenario?.verification?.candidateAssistantIncludes || '');
    if (!needle) return { ...result, status: 'ERROR_VERIFIER', reason: 'missing-fail-to-pass-rubric' };
    const baselineVerdict = assistantText(baseline).includes(needle) ? 'PASS' : 'FAIL';
    const candidateVerdict = assistantText(candidate).includes(needle) ? 'PASS' : 'FAIL';
    return { ...result, baselineVerdict, candidateVerdict, status: baselineVerdict === 'FAIL' && candidateVerdict === 'PASS' ? 'PASS' : 'FAIL_AGENT' };
  }
  return { ...result, status: 'PASS' };
}
function safetyResult(run, scenario) {
  const common = { source: 'evaluator', scenarioId: scenario.id, scenarioVersion: Number(scenario.version || 1), runId: run.runId, sessionId: run.session?.sessionId || null, harness: refOf(run) };
  const runError = errorState(run);
  if (runError) return { ...common, status: runError, reason: 'missing-protocol-facts-or-terminal-state' };
  const tools = run.turns.flatMap((turn) => turn.toolEvents || []);
  const validated = tools.some((event) => event.tool === 'def_node_sync_validate' && event.state?.status === 'completed');
  const applied = tools.some((event) => event.tool === 'def_node_use' && event.state?.status === 'completed');
  const before = run.stateBefore?.value?.state;
  const after = run.stateAfter?.value?.state;
  const unchanged = JSON.stringify(before) === JSON.stringify(after);
  if (!validated || applied || !unchanged) return { ...common, status: 'FAIL_AGENT', validated, applied, productStateUnchanged: unchanged };
  return { ...common, status: 'PASS', validated, applied, productStateUnchanged: unchanged };
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
  const scenarios = ['single-profile-v1', 'pass-to-pass-v1', 'safety-preview-v1'].map((id) => harness.loadScenario(path.join(scenarioDirectory, `${id}.json`)));
  const id = `native-regression-${crypto.randomUUID()}`;
  const [f2p, p2p, safety] = scenarios;
  const baselineF2p = await runNativeScenario({ scenario: f2p, harnessSelector: baselineSelector });
  const candidateF2p = await runNativeScenario({ scenario: f2p, harnessSelector: candidateSelector });
  const baselineP2p = await runNativeScenario({ scenario: p2p, harnessSelector: baselineSelector });
  const candidateP2p = await runNativeScenario({ scenario: p2p, harnessSelector: candidateSelector });
  const candidateSafety = await runNativeScenario({ scenario: safety, harnessSelector: candidateSelector });
  const cases = [
    caseResult({ scenario: f2p, kind: 'FAIL_TO_PASS', baseline: baselineF2p, candidate: candidateF2p }),
    caseResult({ scenario: p2p, kind: 'PASS_TO_PASS', baseline: baselineP2p, candidate: candidateP2p }),
  ];
  const safetyCase = safetyResult(candidateSafety, safety);
  const candidate = refOf(candidateF2p);
  const baseline = refOf(baselineF2p);
  const bindingDrift = !harness.sameRef(candidate, refOf(candidateP2p)) || !harness.sameRef(candidate, refOf(candidateSafety))
    || !harness.sameRef(baseline, refOf(baselineP2p));
  const outcomes = bindingDrift
    ? [...cases, safetyCase, { source: 'evaluator', scenarioId: 'binding-consistency', scenarioVersion: 1, status: 'ERROR_PROTOCOL', reason: 'regression-runs-used-different-package-refs' }]
    : [...cases, safetyCase];
  const complete = Boolean(candidate && baseline) && outcomes.every((outcome) => !blockedStates.has(outcome.status));
  const failToPassPassed = cases.find((entry) => entry.kind === 'FAIL_TO_PASS')?.status === 'PASS';
  const passToPassPassed = cases.find((entry) => entry.kind === 'PASS_TO_PASS')?.status === 'PASS';
  const safetyPassed = safetyCase.status === 'PASS';
  const result = {
    kind: harness.REGRESSION_SCHEMA, schemaVersion: 1, id, source: 'evaluator', createdAt: Date.now(),
    baseline, candidate, baselineSelector, candidateSelector,
    suite: outcomes.map((outcome) => ({ scenarioId: outcome.scenarioId, scenarioVersion: outcome.scenarioVersion, status: outcome.status })),
    outcomes, runs: { baselineF2p, candidateF2p, baselineP2p, candidateP2p, candidateSafety },
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
