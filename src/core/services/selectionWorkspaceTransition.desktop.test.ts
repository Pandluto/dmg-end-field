import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PreparedWorkNodeAtomicApplyError } from '../../platform/agent/preparedWorkNodeProposal';
import {
  runPreparedSelectionActivationTransaction,
  snapshotContentRevisionFromPayload,
  snapshotContentRevisionFromDigest,
  validatePreparedSelectionSemantics,
} from './selectionWorkspaceTransition';

{
  const events: string[] = [];
  const result = await runPreparedSelectionActivationTransaction({
    applyTarget: async () => { events.push('apply-target'); },
    verifyVisibleTarget: async () => {
      events.push('verify-visible');
      return { pass: true };
    },
    persistCheckout: async () => { events.push('persist-checkout'); },
    persistAppliedLedger: async () => {
      events.push('persist-ledger');
      return { applied: true };
    },
    verifyPersistedTarget: async () => {
      events.push('verify-persisted');
      return { pass: true };
    },
    restorePreviousState: async () => { events.push('unexpected-rollback'); },
    verifyPreviousState: async () => {
      events.push('unexpected-rollback-verify');
      return { pass: true };
    },
    cleanupPreviousTemporary: async () => {
      events.push('cleanup-old-temp');
      throw new Error('simulated cleanup failure');
    },
  });
  assert.deepEqual(events, [
    'apply-target',
    'verify-visible',
    'persist-checkout',
    'persist-ledger',
    'verify-persisted',
    'cleanup-old-temp',
  ]);
  assert.match(result.cleanupWarning ?? '', /新 candidate 已成功激活/u);
  // Cleanup is outside the commit point: a post-commit cleanup failure must
  // remain a successful activation with a warning.
  assert.equal(result.cleanupWarning !== null, true);
}

{
  const events: string[] = [];
  await assert.rejects(
    runPreparedSelectionActivationTransaction({
      applyTarget: async () => { events.push('apply-target'); },
      verifyVisibleTarget: async () => {
        events.push('verify-visible');
        return { pass: false, reason: 'target is not visible' };
      },
      persistCheckout: async () => { events.push('unexpected-persist-checkout'); },
      persistAppliedLedger: async () => {
        events.push('unexpected-persist-ledger');
        return { applied: true };
      },
      verifyPersistedTarget: async () => {
        events.push('unexpected-verify-persisted');
        return { pass: true };
      },
      restorePreviousState: async () => { events.push('restore-source'); },
      verifyPreviousState: async () => {
        events.push('verify-source');
        return { pass: true };
      },
      cleanupPreviousTemporary: async () => { events.push('unexpected-cleanup'); },
    }),
    (error: unknown) => error instanceof PreparedWorkNodeAtomicApplyError
      && error.rollbackError === null,
  );
  assert.deepEqual(events, [
    'apply-target',
    'verify-visible',
    'restore-source',
    'verify-source',
  ]);
}

const sourcePath = fileURLToPath(new URL('./selectionWorkspaceTransition.desktop.ts', import.meta.url));
const source = fs.readFileSync(sourcePath, 'utf8');
const prepareStart = source.indexOf('export async function prepareReviewedSelectionProposal');
const applyStart = source.indexOf('export async function applyReviewedSelectionProposal');
const abandonStart = source.indexOf('export async function abandonReviewedSelectionProposal');
assert.ok(prepareStart >= 0 && applyStart > prepareStart && abandonStart > applyStart);
const prepareSource = source.slice(prepareStart, applyStart);
const applySource = source.slice(applyStart, abandonStart);
const abandonSource = source.slice(abandonStart);

assert.match(prepareSource, /buildPreparedSelectionPayload\(\{/);
assert.doesNotMatch(
  prepareSource,
  /applyTimelineSnapshotPayload|setSelectedCharacterIds|activateTimelineSession/,
  'selection prepare must never synthesize a candidate by mutating live state',
);
assert.match(prepareSource, /destination === 'new-temporary-workspace'/);
assert.match(prepareSource, /candidateCheckout !== null/);
assert.match(prepareSource, /sourceAfter\.contentRevision !== source\.contentRevision/);
assert.match(prepareSource, /liveCheckoutTouched: false as const/);
assert.match(prepareSource, /reviewComplete: true/);

assert.match(applySource, /binding\.contentRevision !== candidate\.sourceRevision/);
assert.match(applySource, /source\.checkoutRef\.updatedAt !== binding\.checkoutUpdatedAt/);
assert.match(applySource, /prepared-selection-document-drift/);
assert.match(applySource, /validatePreparedWorkNodeCandidate\(candidate/);
assert.match(applySource, /runPreparedSelectionActivationTransaction\(\{/);
assert.match(applySource, /cleanupPreviousTemporary/);
assert.match(applySource, /selectedCharacters: resolved\.characters\.map/);
assert.match(applySource, /nodeReview: review/);
const commitStart = applySource.indexOf('const committed = await client.commit');
assert.ok(commitStart >= 0);
const projectionStart = applySource.indexOf('// From this point onward the live checkout', commitStart);
assert.ok(projectionStart > commitStart);
assert.doesNotMatch(
  applySource.slice(projectionStart),
  /client\.(list|get)\(/,
  'after the final transaction verification, result projection must use commit-stage facts instead of database reads',
);
assert.match(applySource, /const candidateTimelineNodeCount = \(await client\.list\(\)\)/);
assert.match(applySource, /appliedNode = marked\.node/);

assert.match(abandonSource, /candidate\.destination === 'new-temporary-workspace'/);
assert.match(abandonSource, /bundle\.snapshots\.length !== 0/);
assert.match(abandonSource, /historicalCheckout/);
assert.match(abandonSource, /selectionCleanupAudit\(candidate, 'deleted'/);

assert.match(
  source,
  /sourceNode\s*\? authoritativeNodeRevision\(sourceNode\)\s*:\s*sourceSnapshot/,
  'source CAS must use Work Node contentRevision or a payload-derived snapshot revision',
);
assert.match(source, /snapshotContentRevisionFromDigest/);
assert.doesNotMatch(source, /return snapshot\.createdAt/);
assert.doesNotMatch(source, /contentRevision:\s*source\.checkoutRef\.updatedAt/);
assert.doesNotMatch(
  source.slice(0, prepareStart),
  /contentRevision\s*\|\|/,
  'revision=0 must not be rejected through truthiness fallback',
);

// Snapshot IDs and timestamps are metadata, not content identity. Two
// payloads under the same snapshot id/createdAt must produce different CAS
// revisions, while the same payload remains stable across reads.
const sameIdentitySnapshotA = {
  id: 'snapshot-same-identity',
  createdAt: 1700000000000,
  payload: { selectedCharacters: ['operator-a'], version: 1 },
};
const sameIdentitySnapshotB = {
  ...sameIdentitySnapshotA,
  payload: { selectedCharacters: ['operator-b'], version: 1 },
};
const [revisionA, revisionB, revisionAAgain] = await Promise.all([
  snapshotContentRevisionFromPayload(sameIdentitySnapshotA.payload),
  snapshotContentRevisionFromPayload(sameIdentitySnapshotB.payload),
  snapshotContentRevisionFromPayload(sameIdentitySnapshotA.payload),
]);
assert.notEqual(revisionA, revisionB, 'same snapshot id/createdAt with changed payload must change contentRevision');
assert.equal(revisionA, revisionAAgain, 'the same snapshot payload must keep a stable contentRevision');
assert.equal(Number.isSafeInteger(revisionA), true);
assert.equal(Number.isSafeInteger(revisionB), true);
assert.equal(
  snapshotContentRevisionFromDigest('sha256:' + 'a'.repeat(64)),
  snapshotContentRevisionFromDigest('sha256:' + 'a'.repeat(64)),
);

const semanticCases = [
  ['selection.add', ['a', 'b'], ['a', 'b', 'c'], true],
  ['selection.add', ['a', 'b'], ['b', 'a', 'c'], false],
  ['selection.add', ['a', 'b'], ['a', 'c'], false],
  ['selection.remove', ['a', 'b', 'c'], ['a', 'c'], true],
  ['selection.remove', ['a', 'b', 'c'], ['c', 'a'], false],
  ['selection.remove', ['a', 'b'], ['a', 'c'], false],
  ['selection.replace', ['a', 'b', 'c'], ['a', 'd', 'c'], true],
  ['selection.replace', ['a', 'b', 'c'], ['d', 'a', 'c'], false],
  ['selection.replace', ['a', 'b'], ['c', 'd'], false],
  ['selection.reorder', ['a', 'b', 'c'], ['c', 'a', 'b'], true],
  ['selection.reorder', ['a', 'b'], ['a', 'c'], false],
  ['selection.reorder', ['a', 'b'], ['a', 'b'], false],
  ['selection.apply', ['a', 'b'], ['c'], true],
  ['selection.unknown', ['a'], ['b'], false],
] as const;
for (const [operation, currentIds, nextIds, expectedPass] of semanticCases) {
  assert.equal(
    validatePreparedSelectionSemantics(operation, currentIds, nextIds).pass,
    expectedPass,
    operation,
  );
}
assert.match(prepareSource, /validatePreparedSelectionSemantics\(/);

console.log('Prepared selection workspace transaction contract: PASS');
