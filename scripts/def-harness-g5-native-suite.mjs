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

function packageCheckEvidence(scenario, harnessSelector, result, caught = null) {
  return {
    scenarioId: scenario.id,
    scenarioVersion: Number(scenario.version || 1),
    packageCheckId: result?.packageCheckId || null,
    status: result?.status || 'PACKAGE_CHECK_ERROR',
    selector: result?.selector || harnessSelector,
    harness: result?.harness || null,
    slot: result?.slot || scenario?.expect?.slot || null,
    ...(caught ? {
      error: {
        code: caught.code || 'PACKAGE_CHECK_ERROR',
        message: caught.message || String(caught),
      },
    } : {}),
  };
}

export async function runNativeG5Suite({
  harnessSelector = 'stable',
  scenarioDirectory = path.resolve(process.cwd(), 'agent/harness/scenarios'),
  runScenario = runNativeScenario,
  packageSelfCheck = harness.runPackageSelfCheck,
  runtimeDirectory = runtimeRoot,
  persist = true,
} = {}) {
  const scenarioRecords = G5_NATIVE_SCENARIO_IDS.map((scenarioId) => {
    const scenarioFile = path.join(scenarioDirectory, `${scenarioId}.json`);
    return { scenarioFile, scenario: harness.loadScenario(scenarioFile) };
  });
  const scenarios = scenarioRecords.map((record) => record.scenario);
  const packageChecks = [];
  for (const { scenarioFile, scenario } of scenarioRecords) {
    try {
      const result = await packageSelfCheck({
        runtimeRoot: runtimeDirectory,
        scenarioFile,
        selector: harnessSelector,
      });
      packageChecks.push(packageCheckEvidence(scenario, harnessSelector, result));
    } catch (caught) {
      packageChecks.push(packageCheckEvidence(scenario, harnessSelector, null, caught));
    }
  }
  const packagePreflightPassed = packageChecks.every((check) => check.status === 'PACKAGE_CHECK_PASS');
  const runs = [];
  if (packagePreflightPassed) {
    for (const scenario of scenarios) {
      runs.push(await runScenario({ scenario, harnessSelector }));
    }
  }
  const outcomes = packagePreflightPassed
    ? runs.map((run, index) => ({
      scenarioId: scenarios[index].id,
      scenarioVersion: Number(scenarios[index].version || 1),
      packageCheckId: packageChecks[index].packageCheckId,
      packageCheckStatus: packageChecks[index].status,
      runId: run?.runId || null,
      status: run?.status || 'INCOMPLETE',
      verificationStatus: run?.verification?.status || null,
    }))
    : scenarios.map((scenario, index) => ({
      scenarioId: scenario.id,
      scenarioVersion: Number(scenario.version || 1),
      packageCheckId: packageChecks[index].packageCheckId,
      packageCheckStatus: packageChecks[index].status,
      runId: null,
      status: packageChecks[index].status === 'PACKAGE_CHECK_PASS' ? 'INCOMPLETE' : 'ERROR_VERIFIER',
      verificationStatus: null,
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
    packageChecks,
    outcomes,
    runs: outcomes.map(({ scenarioId, runId }) => ({ scenarioId, runId })),
    complete,
    promotion: {
      eligible: false,
      reason: 'diagnostic-native-suite-only',
    },
    status: !packagePreflightPassed
      ? 'ERROR_VERIFIER'
      : passed
      ? 'PASS'
      : outcomes.find((outcome) => blockedStates.has(outcome.status))?.status || 'FAIL_AGENT',
  };
  if (persist) writeG5NativeSuite(result);
  return result;
}
