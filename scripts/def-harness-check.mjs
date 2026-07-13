import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import harness from '../agent/harness/def-harness.cjs';
import { evaluatorOnlyInputLeaks, runNativeRegression } from './def-harness-regression.mjs';

const project = path.resolve(import.meta.dirname, '..');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'def-harness-check-'));
const builds = path.join(runtime, 'builds');
const stableSource = path.join(project, 'agent/harness/baseline/stable-v0');
const candidateSource = path.join(project, 'agent/harness/examples/candidate-v1');
const stableBuild = harness.buildPackage(stableSource, builds);
const stableAgain = harness.buildPackage(stableSource, builds);
assert.equal(stableBuild.package.contentHash, stableAgain.package.contentHash, 'package hash must be deterministic for identical Git evidence');
assert.equal(stableBuild.package.sourceCommit, execFileSync('git', ['rev-parse', 'HEAD'], { cwd: project, encoding: 'utf8' }).trim(), 'source commit comes from Git, not manifest');
assert.equal(stableBuild.package.dirty, Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: project, encoding: 'utf8' }).trim()), 'dirty comes from Git, not manifest');
const stableRef = harness.registerPackage(runtime, stableBuild.directory, 'stable');
const candidateBuild = harness.buildPackage(candidateSource, builds);
const candidateRef = harness.registerPackage(runtime, candidateBuild.directory, 'candidate/v1');
const loader = harness.createLoader(runtime);
const stable = loader.resolve('stable');
const candidate = loader.resolve('candidate/v1');
assert.notEqual(stable.ref.contentHash, candidate.ref.contentHash, 'stable and candidate cannot share content');
for (const slot of harness.SLOT_NAMES) {
  const stableHashes = stable.package.slots[slot].map((artifact) => artifact.hash);
  const candidateHashes = candidate.package.slots[slot].map((artifact) => artifact.hash);
  if (slot === 'responsePolicy') assert.notDeepEqual(candidateHashes, stableHashes, 'candidate changes only responsePolicy');
  else assert.deepEqual(candidateHashes, stableHashes, `candidate materializes the stable ${slot} slot unchanged`);
}
const stableBinding = harness.createSessionBinding({ sessionId: 'ses_existing_stable', resolved: stable });
harness.setChannel(runtime, 'stable', candidateRef);
assert.equal(stableBinding.harness.contentHash, stableRef.contentHash, 'existing bindings cannot drift after a channel change');
assert.equal(loader.resolve('stable').ref.contentHash, candidateRef.contentHash, 'a new resolution sees the new pointer');
harness.setChannel(runtime, 'stable', stableRef);
assert.equal(harness.runPackageSelfCheck({ runtimeRoot: runtime, scenarioFile: path.join(project, 'agent/harness/scenarios/single-profile-v1.json'), selector: 'stable' }).status, 'PACKAGE_CHECK_PASS');
assert.equal(harness.inspectPackageScenario({ runtimeRoot: runtime, scenarioFile: path.join(project, 'agent/harness/scenarios/single-profile-v1.json'), selector: 'candidate/v1' }).status, 'PACKAGE_CHECK_PASS');
assert.throws(() => harness.promote(runtime, candidateRef, {
  kind: harness.REGRESSION_SCHEMA, schemaVersion: 1, status: 'PASS', complete: true,
  candidate: stableRef, baseline: stableRef, suite: [{ scenarioId: 'single-profile-v1', scenarioVersion: 1, status: 'PASS' }],
  failToPassPassed: true, passToPassPassed: true, safetyPassed: true,
}, 'reviewer'), (caught) => caught.code === 'HARNESS_PROMOTION_BLOCKED', 'a regression for another candidate can never promote this candidate');
assert.throws(() => harness.resolveSelector(runtime, 'candidate/missing'), (caught) => caught.code === 'BLOCKED_HARNESS_LOAD', 'missing candidates fail closed');
const unsafe = fs.mkdtempSync(path.join(os.tmpdir(), 'def-harness-unsafe-'));
fs.writeFileSync(path.join(unsafe, 'manifest.json'), JSON.stringify({ schemaVersion: 1, harnessId: 'unsafe-test', version: '1.0.0', slots: { agentContract: { path: '../escape.js', capability: 'hotSwappable' } } }));
assert.throws(() => harness.buildPackage(unsafe, builds), (caught) => caught.code === 'HARNESS_UNSAFE_PATH');
fs.writeFileSync(path.join(unsafe, 'code.js'), 'export default 1;');
fs.writeFileSync(path.join(unsafe, 'manifest.json'), JSON.stringify({ schemaVersion: 1, harnessId: 'unsafe-test', version: '1.0.0', slots: { agentContract: { path: 'code.js', capability: 'hotSwappable' } } }));
assert.throws(() => harness.buildPackage(unsafe, builds), (caught) => caught.code === 'HARNESS_EXECUTABLE_REJECTED');
fs.writeFileSync(path.join(unsafe, 'artifact.md'), 'safe');
fs.writeFileSync(path.join(unsafe, 'manifest.json'), JSON.stringify({ schemaVersion: 2, harnessId: 'unsafe-test', version: '1.0.0', slots: { agentContract: { path: 'artifact.md', capability: 'hotSwappable' } } }));
assert.throws(() => harness.buildPackage(unsafe, builds), (caught) => caught.code === 'HARNESS_UNKNOWN_SCHEMA');
assert.equal(typeof runNativeRegression, 'function', 'native regression keeps evaluator-only input outside package checks');
const evaluatorOnlySentinel = 'evaluator-only-sentinel-9ce6dd5a';
assert.equal(evaluatorOnlyInputLeaks({ source: 'evaluator', outcome: 'PASS' }, evaluatorOnlySentinel), false, 'evaluator-only input is absent from an ordinary public result');
assert.equal(evaluatorOnlyInputLeaks({ source: 'evaluator', accidental: evaluatorOnlySentinel }, evaluatorOnlySentinel), true, 'the evaluator leak guard detects public-result disclosure');
fs.rmSync(runtime, { recursive: true, force: true });
fs.rmSync(unsafe, { recursive: true, force: true });
console.log(JSON.stringify({ ok: true, checks: ['git-provenance', 'immutable-registry', 'pinned-bindings', 'materialized-candidate', 'package-self-check-only', 'cross-candidate-promotion-rejected', 'fail-closed-selector', 'traversal', 'executable', 'schema', 'evaluator-only-leak-guard'] }));
