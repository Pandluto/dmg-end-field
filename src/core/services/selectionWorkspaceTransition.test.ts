import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PreparedWorkNodeAtomicApplyError } from '../../platform/agent/preparedWorkNodeProposal';
import { runPreparedSelectionActivationTransaction } from './selectionWorkspaceTransition';

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

const sourcePath = fileURLToPath(new URL('./selectionWorkspaceTransition.ts', import.meta.url));
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

assert.match(abandonSource, /candidate\.destination === 'new-temporary-workspace'/);
assert.match(abandonSource, /bundle\.snapshots\.length !== 0/);
assert.match(abandonSource, /historicalCheckout/);
assert.match(abandonSource, /selectionCleanupAudit\(candidate, 'deleted'/);

assert.match(
  source,
  /sourceNode\s*\? authoritativeNodeRevision\(sourceNode\)\s*:\s*sourceSnapshot/,
  'source CAS must use Work Node contentRevision or snapshot createdAt',
);
assert.doesNotMatch(
  source.slice(0, prepareStart),
  /contentRevision\s*\|\|/,
  'revision=0 must not be rejected through truthiness fallback',
);

console.log('Prepared selection workspace transaction contract: PASS');
