import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import harness from '../agent/harness/def-harness.cjs';
import { runNativeScenario } from './def-harness-native-runner.mjs';

const runtimeRoot = path.resolve(process.cwd(), '.runtime/def-harness');
const blockedStates = new Set(['BLOCKED_ENVIRONMENT', 'ERROR_PROTOCOL', 'ERROR_VERIFIER', 'INCOMPLETE']);

export const G5_NATIVE_SCENARIO_IDS = Object.freeze([
  'skill-reference-readable-v1',
  'support-weapon-convention-v1',
  'operator-config-preview-v1',
  'equipment-full-catalog-asr-v1',
]);

function writeG5NativeSuite(result) {
  const directory = path.join(runtimeRoot, 'runs', result.id);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(directory, 'g5-native-suite.json'), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
}

export async function runNativeG5Suite({
  harnessSelector = 'stable',
  scenarioDirectory = path.resolve(process.cwd(), 'agent/harness/scenarios'),
  runScenario = runNativeScenario,
  persist = true,
} = {}) {
  const scenarios = G5_NATIVE_SCENARIO_IDS.map((scenarioId) => (
    harness.loadScenario(path.join(scenarioDirectory, `${scenarioId}.json`))
  ));
  const runs = [];
  for (const scenario of scenarios) {
    runs.push(await runScenario({ scenario, harnessSelector }));
  }
  const outcomes = runs.map((run, index) => ({
    scenarioId: scenarios[index].id,
    scenarioVersion: Number(scenarios[index].version || 1),
    runId: run?.runId || null,
    status: run?.status || 'INCOMPLETE',
    verificationStatus: run?.verification?.status || null,
  }));
  const complete = outcomes.length === G5_NATIVE_SCENARIO_IDS.length
    && outcomes.every((outcome) => !blockedStates.has(outcome.status));
  const passed = complete && outcomes.every((outcome) => (
    outcome.status === 'EXECUTED' && outcome.verificationStatus === 'PASS'
  ));
  const result = {
    kind: 'DefHarnessG5NativeSuiteV1',
    schemaVersion: 1,
    id: `native-g5-suite-${crypto.randomUUID()}`,
    source: 'harness',
    createdAt: Date.now(),
    harnessSelector,
    scenarioIds: [...G5_NATIVE_SCENARIO_IDS],
    outcomes,
    runs: outcomes.map(({ scenarioId, runId }) => ({ scenarioId, runId })),
    complete,
    promotion: {
      eligible: false,
      reason: 'diagnostic-native-suite-only',
    },
    status: passed
      ? 'PASS'
      : outcomes.find((outcome) => blockedStates.has(outcome.status))?.status || 'FAIL_AGENT',
  };
  if (persist) writeG5NativeSuite(result);
  return result;
}
