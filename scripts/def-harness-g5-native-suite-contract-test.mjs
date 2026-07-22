import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import harness from '../agent/harness/def-harness.cjs';
import {
  G5_NATIVE_SCENARIO_IDS,
  runNativeG5Suite,
} from './def-harness-g5-native-suite.mjs';
import { NATIVE_REGRESSION_SCENARIOS } from './def-harness-regression.mjs';

const project = path.resolve(import.meta.dirname, '..');
const scenarioDirectory = path.join(project, 'agent/harness/scenarios');
const expectedScenarioIds = [
  'skill-reference-readable-v1',
  'support-weapon-convention-v1',
  'operator-config-preview-v1',
  'equipment-full-catalog-asr-v1',
];

assert.deepEqual(G5_NATIVE_SCENARIO_IDS, expectedScenarioIds, 'the explicit G5 native suite contains all four required scenarios');
assert.equal(new Set(G5_NATIVE_SCENARIO_IDS).size, expectedScenarioIds.length, 'the G5 native suite has no duplicate scenario');
for (const scenarioId of G5_NATIVE_SCENARIO_IDS) {
  const scenario = harness.loadScenario(path.join(scenarioDirectory, `${scenarioId}.json`));
  assert.equal(scenario.id, scenarioId, `${scenarioId} resolves to its declared scenario`);
}

function passingPackageCheck({ scenarioFile, selector }) {
  const scenario = harness.loadScenario(scenarioFile);
  return {
    kind: 'DefHarnessPackageCheckV1',
    packageCheckId: `package-check-${scenario.id}`,
    scenarioId: scenario.id,
    scenarioVersion: Number(scenario.version || 1),
    selector,
    harness: { harnessId: 'test-harness', version: '1.0.0', contentHash: 'a'.repeat(64) },
    slot: scenario.expect?.slot || 'responsePolicy',
    status: 'PACKAGE_CHECK_PASS',
  };
}

const observedScenarioIds = [];
const passingInvocationOrder = [];
const passingSuite = await runNativeG5Suite({
  harnessSelector: 'stable',
  scenarioDirectory,
  persist: false,
  packageSelfCheck: (input) => {
    const result = passingPackageCheck(input);
    passingInvocationOrder.push(`check:${result.scenarioId}`);
    return result;
  },
  runScenario: async ({ scenario, harnessSelector }) => {
    assert.equal(
      passingInvocationOrder.filter((entry) => entry.startsWith('check:')).length,
      expectedScenarioIds.length,
      'all package checks finish before every provider-backed scenario',
    );
    passingInvocationOrder.push(`run:${scenario.id}`);
    observedScenarioIds.push(scenario.id);
    assert.equal(harnessSelector, 'stable');
    return {
      runId: `run-${scenario.id}`,
      status: 'EXECUTED',
      verification: { status: 'PASS' },
    };
  },
});
assert.deepEqual(observedScenarioIds, expectedScenarioIds, 'one G5 invocation executes every required scenario exactly once');
assert.deepEqual(passingInvocationOrder.slice(0, expectedScenarioIds.length), expectedScenarioIds.map((id) => `check:${id}`));
assert.equal(passingSuite.status, 'PASS');
assert.equal(passingSuite.complete, true);
assert.equal(passingSuite.kind, 'DefHarnessG5NativeSuiteV1');
assert.notEqual(passingSuite.kind, harness.REGRESSION_SCHEMA, 'G5 output cannot be consumed as a promotion regression');
assert.deepEqual(passingSuite.promotion, { eligible: false, reason: 'diagnostic-native-suite-only' });
assert.deepEqual(passingSuite.packageChecks.map(({ scenarioId, status }) => ({ scenarioId, status })), expectedScenarioIds.map((scenarioId) => ({
  scenarioId,
  status: 'PACKAGE_CHECK_PASS',
})), 'the suite records one successful package-check evidence item per scenario');
assert.deepEqual(passingSuite.runs, expectedScenarioIds.map((scenarioId) => ({
  scenarioId,
  runId: `run-${scenarioId}`,
})), 'the suite report links individual redacted native-run artifacts without duplicating raw transcripts');
assert.equal(Object.hasOwn(passingSuite, 'failToPassPassed'), false);
assert.equal(Object.hasOwn(passingSuite, 'passToPassPassed'), false);
assert.equal(Object.hasOwn(passingSuite, 'safetyPassed'), false);

const failedScenarioIds = [];
const failingSuite = await runNativeG5Suite({
  harnessSelector: 'stable',
  scenarioDirectory,
  persist: false,
  packageSelfCheck: passingPackageCheck,
  runScenario: async ({ scenario }) => {
    failedScenarioIds.push(scenario.id);
    const failed = scenario.id === 'support-weapon-convention-v1';
    return {
      runId: `run-${scenario.id}`,
      status: failed ? 'FAIL_AGENT' : 'EXECUTED',
      verification: { status: failed ? 'FAIL' : 'PASS' },
    };
  },
});
assert.deepEqual(failedScenarioIds, expectedScenarioIds, 'one failed case cannot silently skip another G5 scenario');
assert.equal(failingSuite.status, 'FAIL_AGENT');
assert.equal(failingSuite.promotion.eligible, false);

let providerCallCount = 0;
const packageCheckedScenarioIds = [];
const packageFailureSuite = await runNativeG5Suite({
  harnessSelector: 'candidate/spec9-3plus1-composite-v1',
  scenarioDirectory,
  persist: false,
  packageSelfCheck: (input) => {
    const result = passingPackageCheck(input);
    packageCheckedScenarioIds.push(result.scenarioId);
    return result.scenarioId === 'equipment-full-catalog-asr-v1'
      ? { ...result, status: 'PACKAGE_CHECK_FAIL', slot: 'toolGuidance' }
      : result;
  },
  runScenario: async () => {
    providerCallCount += 1;
    throw new Error('provider must not run after package preflight failure');
  },
});
assert.deepEqual(packageCheckedScenarioIds, expectedScenarioIds, 'G5 checks every scenario package before deciding whether to call the provider');
assert.equal(providerCallCount, 0, 'candidateContains/package-check failure makes zero provider calls');
assert.equal(packageFailureSuite.status, 'ERROR_VERIFIER');
assert.equal(packageFailureSuite.complete, false);
assert.equal(packageFailureSuite.packageChecks.length, expectedScenarioIds.length);
assert.equal(
  packageFailureSuite.packageChecks.find((check) => check.scenarioId === 'equipment-full-catalog-asr-v1')?.status,
  'PACKAGE_CHECK_FAIL',
  'suite evidence preserves the failing candidateContains package check',
);
assert.equal(
  packageFailureSuite.outcomes.find((outcome) => outcome.scenarioId === 'equipment-full-catalog-asr-v1')?.status,
  'ERROR_VERIFIER',
);

assert.deepEqual(NATIVE_REGRESSION_SCENARIOS, {
  failToPass: [
    'equipment-3plus1-topology-v1',
    'equipment-3plus1-set-selection-v1',
    'operator-config-correction-review-v1',
    'equipment-3plus1-unresolved-v1',
  ],
  passToPass: 'equipment-full-catalog-asr-v1',
  safety: 'safety-preview-v1',
}, 'G5 leaves the promotion regression F2P/P2P/safety suite unchanged');

const packageJson = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8'));
assert.equal(packageJson.scripts['harness:g5'], 'node scripts/def-harness-cli.mjs g5', 'G5 has one package-script entry point');
assert.equal(packageJson.scripts['test:def-harness-g5'], 'node scripts/def-harness-g5-native-suite-contract-test.mjs');
const cliSource = fs.readFileSync(path.join(project, 'scripts/def-harness-cli.mjs'), 'utf8');
assert.ok(cliSource.includes("command === 'g5'"), 'the Harness CLI routes the G5 command');
assert.ok(cliSource.includes('g5 --harness stable|candidate/<name>'), 'the Harness CLI usage documents the G5 command');

console.log(JSON.stringify({
  ok: true,
  checks: [
    'g5-four-scenarios-explicit-and-complete',
    'g5-one-invocation-runs-every-scenario',
    'g5-all-package-checks-precede-provider',
    'g5-package-check-failure-is-error-verifier-with-zero-provider-calls',
    'g5-suite-records-package-check-evidence',
    'g5-failure-does-not-skip-later-scenarios',
    'g5-result-never-promotion-eligible',
    'promotion-regression-semantics-unchanged',
    'g5-package-and-cli-entrypoint-present',
  ],
}));
