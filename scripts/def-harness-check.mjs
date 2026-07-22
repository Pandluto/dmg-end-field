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
const spec9CandidateSource = path.join(project, 'agent/harness/examples/spec9-3plus1-composite-v1');
const spec9CandidateBuild = harness.buildPackage(spec9CandidateSource, builds);
assert.equal(spec9CandidateBuild.package.version, '9.1.0-candidate.2', 'catalog guidance uses a new immutable candidate version');

function rewriteBuiltPackage(directory, mutate) {
  const packageFile = path.join(directory, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  mutate(pkg);
  const normalized = { ...pkg };
  delete normalized.contentHash;
  delete normalized.packageHash;
  pkg.contentHash = harness.sha256(harness.stableJson(normalized));
  fs.writeFileSync(packageFile, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  return pkg;
}

const oldSpec9Fixture = path.join(runtime, 'fixtures', 'spec9-candidate-1');
fs.cpSync(spec9CandidateBuild.directory, oldSpec9Fixture, { recursive: true });
rewriteBuiltPackage(oldSpec9Fixture, (pkg) => { pkg.version = '9.1.0-candidate.1'; });
const oldSpec9Ref = harness.registerPackage(runtime, oldSpec9Fixture, 'candidate/spec9-old');
const oldSpec9PackageFile = path.join(
  harness.registryPaths(runtime).packages,
  oldSpec9Ref.harnessId,
  oldSpec9Ref.version,
  'package.json',
);
const oldSpec9Bytes = fs.readFileSync(oldSpec9PackageFile, 'utf8');
const newSpec9Ref = harness.registerPackage(runtime, spec9CandidateBuild.directory, 'candidate/spec9-new');
assert.notEqual(newSpec9Ref.version, oldSpec9Ref.version, 'candidate.2 never reuses candidate.1 identity');
assert.notEqual(newSpec9Ref.contentHash, oldSpec9Ref.contentHash, 'candidate.2 has a distinct immutable content hash');
assert.equal(harness.runPackageSelfCheck({
  runtimeRoot: runtime,
  scenarioFile: path.join(project, 'agent/harness/scenarios/equipment-full-catalog-asr-v1.json'),
  selector: 'candidate/spec9-new',
}).status, 'PACKAGE_CHECK_PASS', 'candidate.2 satisfies the catalog batch candidateContains contract');
assert.equal(fs.readFileSync(oldSpec9PackageFile, 'utf8'), oldSpec9Bytes, 'registering candidate.2 does not overwrite the old package hash');
assert.equal(
  harness.createLoader(runtime).resolve(`${oldSpec9Ref.harnessId}@${oldSpec9Ref.version}`).ref.contentHash,
  oldSpec9Ref.contentHash,
  'the old immutable candidate remains explicitly resolvable',
);

const conflictingOldSpec9Fixture = path.join(runtime, 'fixtures', 'spec9-candidate-1-conflict');
fs.cpSync(oldSpec9Fixture, conflictingOldSpec9Fixture, { recursive: true });
rewriteBuiltPackage(conflictingOldSpec9Fixture, (pkg) => {
  const artifact = pkg.slots.toolGuidance[0];
  const artifactFile = path.join(conflictingOldSpec9Fixture, artifact.path);
  const changed = `${fs.readFileSync(artifactFile, 'utf8')}\nConflicting immutable content.\n`;
  fs.writeFileSync(artifactFile, changed, 'utf8');
  artifact.bytes = Buffer.byteLength(changed);
  artifact.hash = harness.sha256(changed);
});
assert.throws(
  () => harness.registerPackage(runtime, conflictingOldSpec9Fixture),
  (caught) => caught.code === 'HARNESS_IMMUTABLE_CONFLICT',
  'a different hash cannot overwrite the old id/version',
);
assert.equal(fs.readFileSync(oldSpec9PackageFile, 'utf8'), oldSpec9Bytes, 'a rejected conflict leaves the old package untouched');
const loader = harness.createLoader(runtime);
const stable = loader.resolve('stable');
const candidate = loader.resolve('candidate/v1');
assert.notEqual(stable.ref.contentHash, candidate.ref.contentHash, 'stable and candidate cannot share content');
const candidateTeachingSlots = new Set(['skills', 'routingPolicy', 'toolGuidance', 'responsePolicy', 'workflows']);
for (const slot of harness.SLOT_NAMES) {
  const stableHashes = stable.package.slots[slot].map((artifact) => artifact.hash);
  const candidateHashes = candidate.package.slots[slot].map((artifact) => artifact.hash);
  if (candidateTeachingSlots.has(slot)) assert.notDeepEqual(candidateHashes, stableHashes, `candidate changes the ${slot} teaching slot`);
  else assert.deepEqual(candidateHashes, stableHashes, `candidate materializes the stable ${slot} slot unchanged`);
}
assert.match(fs.readFileSync(path.join(candidateSource, 'skills.md'), 'utf8'), /load the native `timeline-workbench` Skill/);
assert.match(fs.readFileSync(path.join(candidateSource, 'tool-guidance.md'), 'utf8'), /Never use `lineIndex` as an action sequence number/);
assert.match(fs.readFileSync(path.join(candidateSource, 'tool-guidance.md'), 'utf8'), /do not send the entire `timeline\.json` as one monolithic `write` call/);
const stableBinding = harness.createSessionBinding({ sessionId: 'ses_existing_stable', resolved: stable });
const recoveredBinding = harness.createSessionBinding({ sessionId: 'ses_recovered', resolved: stable, selector: 'candidate/original' });
assert.equal(recoveredBinding.selector, 'candidate/original', 'recovery preserves the creation-time selector while rebinding the native session id');
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
fs.writeFileSync(path.join(unsafe, 'manifest.json'), JSON.stringify({ schemaVersion: 1, harnessId: 'unsafe-test', version: '1.0.0', slots: { agentContract: { path: 'artifact.md', capability: 'hotSwappable', when: 'task=timeline' } } }));
assert.throws(() => harness.buildPackage(unsafe, builds), (caught) => caught.code === 'HARNESS_UNSUPPORTED_CONDITION', 'schemaVersion 1 must reject conditions instead of silently composing them');
assert.equal(typeof runNativeRegression, 'function', 'native regression keeps evaluator-only input outside package checks');
const evaluatorOnlySentinel = 'evaluator-only-sentinel-9ce6dd5a';
assert.equal(evaluatorOnlyInputLeaks({ source: 'evaluator', outcome: 'PASS' }, evaluatorOnlySentinel), false, 'evaluator-only input is absent from an ordinary public result');
assert.equal(evaluatorOnlyInputLeaks({ source: 'evaluator', accidental: evaluatorOnlySentinel }, evaluatorOnlySentinel), true, 'the evaluator leak guard detects public-result disclosure');
fs.rmSync(runtime, { recursive: true, force: true });
fs.rmSync(unsafe, { recursive: true, force: true });
console.log(JSON.stringify({ ok: true, checks: ['git-provenance', 'immutable-registry', 'spec9-candidate-version-and-old-hash-preservation', 'pinned-bindings', 'recovery-selector-preservation', 'unsupported-condition-rejected', 'materialized-candidate', 'package-self-check-only', 'cross-candidate-promotion-rejected', 'fail-closed-selector', 'traversal', 'executable', 'schema', 'evaluator-only-leak-guard'] }));
