import assert from 'node:assert/strict';
import fs from 'node:fs';
import { digestLegacyFillValue } from '../src/legacyFillCore/index.ts';
import { createLegacyFillBrowserHostGateway, LEGACY_FILL_STORAGE_KEYS } from '../src/legacyFillHost/browserGateway.ts';
import { formatWeaponSkillValueRange, normalizeWeaponSkillStatType } from '../src/components/mcpFillResults/weaponResultFormatting.ts';

assert.equal(normalizeWeaponSkillStatType('critRate'), 'critRateBoost');
assert.equal(
  formatWeaponSkillValueRange('critRate', { '1': { value: 0.025 }, '9': { value: 0.195 } }),
  'Lv.1 2.5% → Lv.9 19.5%',
  'weapon skill percentages use product-facing percent values',
);
assert.equal(
  formatWeaponSkillValueRange('agility', { '1': { value: 12 }, '9': { value: 42 } }),
  'Lv.1 12 → Lv.9 42',
  'flat weapon skill stats remain unscaled',
);

class MemoryStorage {
  constructor(entries = {}) { this.values = new Map(Object.entries(entries)); this.failWrites = false; this.corruptWrites = false; this.corruptWritesRemaining = 0; this.flushCount = 0; }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) {
    if (this.failWrites) { this.failWrites = false; throw new Error('injected writer failure'); }
    const corrupt = this.corruptWrites || this.corruptWritesRemaining > 0;
    if (this.corruptWritesRemaining > 0) this.corruptWritesRemaining -= 1;
    this.values.set(key, corrupt ? '{"corrupt":true}' : String(value));
  }
  removeItem(key) { this.values.delete(key); }
  async flush() { this.flushCount += 1; }
}

const storage = new MemoryStorage({
  [LEGACY_FILL_STORAGE_KEYS.buff.current]: JSON.stringify({ id: 'current', name: 'Current', items: {} }),
  [LEGACY_FILL_STORAGE_KEYS.buff.library]: JSON.stringify({ existing: { id: 'existing', name: 'Existing', items: {} } }),
});
const events = [];
let id = 0;
const gateway = createLegacyFillBrowserHostGateway({
  storage,
  now: () => new Date('2026-07-19T00:00:00.000Z'),
  makeId: () => `fixture-${++id}`,
  emit: (event) => events.push(event),
});

const first = await gateway.publishSnapshot();
const stable = await gateway.publishSnapshot();
assert.equal(stable.domains.buff.revision, first.domains.buff.revision);
assert.equal(stable.domains.buff.contentHash, first.domains.buff.contentHash);
assert.equal('timelineId' in first, false);
assert.equal(JSON.stringify(first).includes('sessionId'), false);

const normalized = { id: 'new-buff', name: 'New Buff', items: {} };
const review = {
  contract: 'ProposalReviewManifestV1', domain: 'buff', targetId: 'new-buff', summary: 'buff new-buff',
  baseSnapshot: { snapshotId: first.snapshotId, revision: first.domains.buff.revision, contentHash: first.domains.buff.contentHash },
  payloadDigest: await digestLegacyFillValue(normalized), schemaVersion: 1,
};
const proposal = {
  proposalId: 'proposal-1', ownerNamespace: 'install-a:profile-main', domain: 'buff', revision: 1,
  manifestDigest: await digestLegacyFillValue(review), review, normalized,
  baseRevision: first.domains.buff.revision, baseContentHash: first.domains.buff.contentHash,
};

const reloadedStorage = new MemoryStorage(Object.fromEntries(storage.values));
const reloadedGateway = createLegacyFillBrowserHostGateway({ storage: reloadedStorage, makeId: () => 'reloaded' });
const reloadedSnapshot = await reloadedGateway.publishSnapshot();
const reloadedProposal = {
  ...proposal,
  proposalId: 'proposal-after-browser-reload',
  baseRevision: reloadedSnapshot.domains.buff.revision + 10,
  baseContentHash: reloadedSnapshot.domains.buff.contentHash,
};
const reloadedClaim = reloadedGateway.internal.claimProposal(reloadedGateway.internal.authority, reloadedProposal);
reloadedGateway.internal.recordDecision(reloadedGateway.internal.authority, {
  proposalId: reloadedProposal.proposalId,
  reviewSessionId: reloadedClaim.reviewSessionId,
  decision: 'approved',
});
const reloadedPreparation = await reloadedGateway.internal.prepareReviewedProposalWrite(reloadedGateway.internal.authority, {
  proposal: reloadedProposal,
  reviewSessionId: reloadedClaim.reviewSessionId,
  expectedRevision: reloadedProposal.revision,
  expectedManifestDigest: reloadedProposal.manifestDigest,
});
assert.equal(reloadedPreparation.ok, true);
assert.equal((await reloadedGateway.internal.recoverPreparedWrite(reloadedGateway.internal.authority, {
  domain: 'buff', postconditionDigest: reloadedPreparation.postconditionDigest,
})).ok, false, 'prepared intent alone is not mistaken for a completed product write');
assert.equal((await reloadedGateway.internal.applyReviewedProposal(reloadedGateway.internal.authority, {
  proposal: reloadedProposal,
  reviewSessionId: reloadedClaim.reviewSessionId,
  expectedRevision: reloadedProposal.revision,
  expectedManifestDigest: reloadedProposal.manifestDigest,
  preparedPlanId: reloadedPreparation.planId,
})).ok, true, 'browser reload does not make unchanged durable content stale');
assert.equal((await reloadedGateway.internal.recoverPreparedWrite(reloadedGateway.internal.authority, {
  domain: 'buff', postconditionDigest: reloadedPreparation.postconditionDigest,
})).ok, true, 'a crash after the product write can recover from the durable prepared intent');

assert.throws(() => gateway.internal.claimProposal({}, proposal), /Host authority required/);
const claimed = gateway.internal.claimProposal(gateway.internal.authority, proposal);
assert.equal((await gateway.internal.applyReviewedProposal(gateway.internal.authority, {
  proposal, reviewSessionId: claimed.reviewSessionId, expectedRevision: 1, expectedManifestDigest: proposal.manifestDigest,
})).code, 'host-review-not-approved');
gateway.internal.recordDecision(gateway.internal.authority, { proposalId: proposal.proposalId, reviewSessionId: claimed.reviewSessionId, decision: 'approved' });
assert.equal((await gateway.internal.applyReviewedProposal(gateway.internal.authority, {
  proposal, reviewSessionId: claimed.reviewSessionId, expectedRevision: 2, expectedManifestDigest: proposal.manifestDigest,
})).code, 'proposal-revision-conflict');
const applied = await gateway.internal.applyReviewedProposal(gateway.internal.authority, {
  proposal, reviewSessionId: claimed.reviewSessionId, expectedRevision: 1, expectedManifestDigest: proposal.manifestDigest,
});
assert.equal(applied.ok, true);
assert.ok(storage.flushCount >= 1, 'Host confirms SQLite-backed writes only after a durable flush');
assert.equal(JSON.parse(storage.getItem(LEGACY_FILL_STORAGE_KEYS.buff.library))['new-buff'].name, 'New Buff');
assert.equal(JSON.parse(storage.getItem(LEGACY_FILL_STORAGE_KEYS.buff.current)).id, 'new-buff');
assert.equal(applied.snapshot.domains.buff.revision, first.domains.buff.revision + 1);
assert.equal(applied.snapshot.domains.weapon.revision, first.domains.weapon.revision, 'save changes only the target domain');
assert.equal(events.filter((event) => event.type === 'legacy-fill.library.changed').length, 1);

const assetStorage = new MemoryStorage({
  [LEGACY_FILL_STORAGE_KEYS.weapon.current]: JSON.stringify({ id: 'asset-weapon', imgUrl: 'asset://weapon-current' }),
  [LEGACY_FILL_STORAGE_KEYS.weapon.library]: JSON.stringify({
    'asset-weapon': { id: 'asset-weapon', imgUrl: 'asset://weapon-library' },
  }),
  [LEGACY_FILL_STORAGE_KEYS.operator.current]: JSON.stringify({ id: 'asset-operator', avatarUrl: 'asset://operator-current', skills: {} }),
  [LEGACY_FILL_STORAGE_KEYS.operator.library]: JSON.stringify({
    'asset-operator': {
      id: 'asset-operator', avatarUrl: 'asset://operator-library',
      skills: { 'skill-A-1': { buttonType: 'A', displayName: 'A', iconUrl: 'asset://skill-A' } },
    },
  }),
  [LEGACY_FILL_STORAGE_KEYS.equipment.current]: JSON.stringify({ schemaVersion: 1, gearSets: {} }),
  [LEGACY_FILL_STORAGE_KEYS.equipment.library]: JSON.stringify({
    schemaVersion: 1,
    gearSets: {
      'asset-set': {
        gearSetId: 'asset-set', name: 'Asset Set', imgUrl: 'asset://set',
        equipments: { armor: { equipmentId: 'armor', imgUrl: 'asset://armor', effects: {} } },
      },
    },
  }),
});
const assetGateway = createLegacyFillBrowserHostGateway({ storage: assetStorage, makeId: () => 'asset' });
const assetSnapshot = await assetGateway.publishSnapshot();
async function applyAssetProposal(domain, normalized, targetId) {
  const reviewValue = { domain, target: { id: targetId } };
  const candidate = {
    proposalId: `proposal-${domain}-assets`, ownerNamespace: 'owner', domain, revision: 1,
    manifestDigest: await digestLegacyFillValue(reviewValue), review: reviewValue, normalized,
    baseRevision: assetSnapshot.domains[domain].revision,
    baseContentHash: assetSnapshot.domains[domain].contentHash,
  };
  const claim = assetGateway.internal.claimProposal(assetGateway.internal.authority, candidate);
  assetGateway.internal.recordDecision(assetGateway.internal.authority, {
    proposalId: candidate.proposalId, reviewSessionId: claim.reviewSessionId, decision: 'approved',
  });
  const result = await assetGateway.internal.applyReviewedProposal(assetGateway.internal.authority, {
    proposal: candidate, reviewSessionId: claim.reviewSessionId, expectedRevision: 1,
    expectedManifestDigest: candidate.manifestDigest,
  });
  assert.equal(result.ok, true, `${domain} asset-preserving write succeeds`);
}
await applyAssetProposal('weapon', { id: 'asset-weapon', name: 'Changed', imgUrl: '' }, 'asset-weapon');
await applyAssetProposal('operator', {
  id: 'asset-operator', name: 'Changed', avatarUrl: '',
  skills: { 'skill-A-1': { buttonType: 'A', displayName: 'A', iconUrl: '' } },
}, 'asset-operator');
await applyAssetProposal('equipment', {
  schemaVersion: 1,
  gearSets: {
    'asset-set': {
      gearSetId: 'asset-set', name: 'Changed', imgUrl: '',
      equipments: { armor: { equipmentId: 'armor', imgUrl: '', effects: {} } },
    },
  },
}, 'asset-set');
assert.equal(JSON.parse(assetStorage.getItem(LEGACY_FILL_STORAGE_KEYS.weapon.library))['asset-weapon'].imgUrl, 'asset://weapon-library');
assert.equal(JSON.parse(assetStorage.getItem(LEGACY_FILL_STORAGE_KEYS.operator.library))['asset-operator'].avatarUrl, 'asset://operator-library');
assert.equal(JSON.parse(assetStorage.getItem(LEGACY_FILL_STORAGE_KEYS.operator.library))['asset-operator'].skills['skill-A-1'].iconUrl, 'asset://skill-A');
assert.equal(JSON.parse(assetStorage.getItem(LEGACY_FILL_STORAGE_KEYS.equipment.library)).gearSets['asset-set'].imgUrl, 'asset://set');
assert.equal(JSON.parse(assetStorage.getItem(LEGACY_FILL_STORAGE_KEYS.equipment.library)).gearSets['asset-set'].equipments.armor.imgUrl, 'asset://armor');

const staleClaim = gateway.internal.claimProposal(gateway.internal.authority, { ...proposal, proposalId: 'proposal-stale' });
gateway.internal.recordDecision(gateway.internal.authority, { proposalId: 'proposal-stale', reviewSessionId: staleClaim.reviewSessionId, decision: 'approved' });
assert.equal((await gateway.internal.applyReviewedProposal(gateway.internal.authority, {
  proposal: { ...proposal, proposalId: 'proposal-stale' }, reviewSessionId: staleClaim.reviewSessionId,
  expectedRevision: 1, expectedManifestDigest: proposal.manifestDigest,
})).code, 'proposal-base-stale');

const revokedClaim = gateway.internal.claimProposal(gateway.internal.authority, { ...proposal, proposalId: 'proposal-revoked', approvalStatus: 'Yes' });
const revoked = gateway.internal.recordDecision(gateway.internal.authority, {
  proposalId: 'proposal-revoked', reviewSessionId: revokedClaim.reviewSessionId, decision: 'rejected',
});
assert.equal(revoked.decision, 'rejected', 'an approved proposal can still be explicitly rejected before Host save');

const badDigest = { ...proposal, proposalId: 'proposal-digest', manifestDigest: 'sha256:bad' };
const badClaim = gateway.internal.claimProposal(gateway.internal.authority, badDigest);
gateway.internal.recordDecision(gateway.internal.authority, { proposalId: badDigest.proposalId, reviewSessionId: badClaim.reviewSessionId, decision: 'approved' });
assert.equal((await gateway.internal.applyReviewedProposal(gateway.internal.authority, {
  proposal: badDigest, reviewSessionId: badClaim.reviewSessionId, expectedRevision: 1, expectedManifestDigest: 'sha256:bad',
})).code, 'proposal-manifest-digest-invalid');

const beforeInvalidation = await gateway.publishSnapshot();
gateway.internal.invalidateForNowStorageForceApply(gateway.internal.authority);
const afterInvalidation = await gateway.publishSnapshot();
assert.equal(afterInvalidation.domains.buff.revision, beforeInvalidation.domains.buff.revision + 1);

const failingStorage = new MemoryStorage({
  [LEGACY_FILL_STORAGE_KEYS.operator.current]: JSON.stringify({ id: 'operator-1' }),
  [LEGACY_FILL_STORAGE_KEYS.operator.library]: JSON.stringify({}),
});
const failingGateway = createLegacyFillBrowserHostGateway({ storage: failingStorage, makeId: () => 'fail' });
const failingSnapshot = await failingGateway.publishSnapshot();
const failingNormalized = { id: 'operator-2', name: 'Operator 2' };
const failingReview = { domain: 'operator', targetId: 'operator-2' };
const failingProposal = {
  proposalId: 'proposal-fail', ownerNamespace: 'owner', domain: 'operator', revision: 1,
  manifestDigest: await digestLegacyFillValue(failingReview), review: failingReview, normalized: failingNormalized,
  baseRevision: failingSnapshot.domains.operator.revision, baseContentHash: failingSnapshot.domains.operator.contentHash,
};
const failingClaim = failingGateway.internal.claimProposal(failingGateway.internal.authority, failingProposal);
failingGateway.internal.recordDecision(failingGateway.internal.authority, { proposalId: failingProposal.proposalId, reviewSessionId: failingClaim.reviewSessionId, decision: 'approved' });
failingStorage.failWrites = true;
const failedWrite = await failingGateway.internal.applyReviewedProposal(failingGateway.internal.authority, {
  proposal: failingProposal, reviewSessionId: failingClaim.reviewSessionId, expectedRevision: 1,
  expectedManifestDigest: failingProposal.manifestDigest,
});
assert.equal(failedWrite.code, 'host-write-postcondition-failed');
assert.equal(failingStorage.getItem(LEGACY_FILL_STORAGE_KEYS.operator.library), '{}');

const postconditionStorage = new MemoryStorage({
  [LEGACY_FILL_STORAGE_KEYS.weapon.current]: JSON.stringify({ id: 'weapon-old' }),
  [LEGACY_FILL_STORAGE_KEYS.weapon.library]: JSON.stringify({}),
});
const postconditionGateway = createLegacyFillBrowserHostGateway({ storage: postconditionStorage, makeId: () => 'postcondition' });
const postconditionSnapshot = await postconditionGateway.publishSnapshot();
const postconditionNormalized = { id: 'weapon-new', name: 'Weapon New' };
const postconditionReview = { domain: 'weapon', targetId: 'weapon-new' };
const postconditionProposal = {
  proposalId: 'proposal-postcondition', ownerNamespace: 'owner', domain: 'weapon', revision: 1,
  manifestDigest: await digestLegacyFillValue(postconditionReview), review: postconditionReview, normalized: postconditionNormalized,
  baseRevision: postconditionSnapshot.domains.weapon.revision, baseContentHash: postconditionSnapshot.domains.weapon.contentHash,
};
const postconditionClaim = postconditionGateway.internal.claimProposal(postconditionGateway.internal.authority, postconditionProposal);
postconditionGateway.internal.recordDecision(postconditionGateway.internal.authority, { proposalId: postconditionProposal.proposalId, reviewSessionId: postconditionClaim.reviewSessionId, decision: 'approved' });
postconditionStorage.corruptWritesRemaining = 1;
const postconditionFailed = await postconditionGateway.internal.applyReviewedProposal(postconditionGateway.internal.authority, {
  proposal: postconditionProposal, reviewSessionId: postconditionClaim.reviewSessionId, expectedRevision: 1,
  expectedManifestDigest: postconditionProposal.manifestDigest,
});
assert.equal(postconditionFailed.code, 'host-write-postcondition-failed');
assert.equal(postconditionStorage.getItem(LEGACY_FILL_STORAGE_KEYS.weapon.library), '{}', 'postcondition failure rolls back library');
assert.equal(JSON.parse(postconditionStorage.getItem(LEGACY_FILL_STORAGE_KEYS.weapon.current)).id, 'weapon-old', 'postcondition failure rolls back current draft');

const runtimeSource = fs.readFileSync(new URL('../src/legacyFillHost/runtime.ts', import.meta.url), 'utf8');
const pageSource = fs.readFileSync(new URL('../src/components/McpFillPage.tsx', import.meta.url), 'utf8');
const resultPreviewSources = [
  '../src/components/mcpFillResults/WeaponResultPreview.tsx',
  '../src/components/mcpFillResults/OperatorResultPreview.tsx',
  '../src/components/mcpFillResults/BuffResultPreview.tsx',
  '../src/components/mcpFillResults/EquipmentResultPreview.tsx',
].map((path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8'));
const electronMainSource = fs.readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
const electronRuntimeSource = fs.readFileSync(new URL('../electron/legacy-fill-runtime.cjs', import.meta.url), 'utf8');
const browserBridgeSource = fs.readFileSync(new URL('../src/platform/runtime/desktopMcpBridge.ts', import.meta.url), 'utf8');
const preloadSource = fs.readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
assert.match(runtimeSource, /event\?\.isTrusted/, 'approve/reject/save require trusted product UI events');
assert.match(electronRuntimeSource, /function issueAction/, 'Web Host bridge issues short-lived action capabilities');
assert.match(electronRuntimeSource, /function consumeAction/, 'decision/save bridge consumes a one-shot Web UI capability');
for (const bindingField of ['reviewSessionId', 'expectedRevision', 'expectedManifestDigest']) {
  assert.match(
    electronRuntimeSource,
    new RegExp(`value\\.${bindingField} !== binding\\.${bindingField}`),
    `Web action capability binds ${bindingField}`,
  );
}
assert.match(electronRuntimeSource, /saveContinuations/, 'save result requires a short-lived continuation from save begin');
assert.match(runtimeSource, /LegacyFillSaveOutboxV1/, 'successful product writes persist a recovery outbox before audit completion');
assert.ok(
  runtimeSource.indexOf('await writeSaveOutbox(preparedOutbox)')
    < runtimeSource.indexOf('preparedPlanId: preparation.planId'),
  'the durable recovery intent is flushed before the product write starts',
);
assert.match(runtimeSource, /persistentLocalStorage/, 'review writes use the Slim browser SQLite-backed storage');
assert.match(electronRuntimeSource, /proposals\/save\/reconcile/, 'authorized Web bootstrap can reconcile a durable successful write');
assert.match(electronRuntimeSource, /publisherCapability/, 'ordinary workspace receives only a snapshot publisher capability');
assert.match(electronRuntimeSource, /reviewLaunchGrants/, 'review authority starts from a short-lived one-time launch grant');
assert.match(electronRuntimeSource, /exchangeReviewLaunchGrant/, 'one-time review launch grant is exchanged before proposal access');
assert.match(browserBridgeSource, /x-dmg-mcp-fill-capability/, 'system browser sends the MCP bridge capability');
assert.match(browserBridgeSource, /__mcp_fill_review_grant/, 'review launch grant is captured from the hidden Shell URL');
assert.doesNotMatch(browserBridgeSource, /__mcp_fill_capability/, 'retired all-powerful browser capability is not used');
assert.match(electronMainSource, /buildBrowserUrl\('\/mcp-fill'\)/, 'Electron opens the hidden MCP review route');
assert.doesNotMatch(preloadSource, /confirmAndBeginSaveLegacyFillProposal/, 'MCP Fill is not exposed as a desktop preload product surface');
for (const visibleField of ['处理结果', '内容检查通过']) {
  assert.equal(pageSource.includes(visibleField), true, `review UI exposes ${visibleField}`);
}
for (const componentName of ['WeaponResultPreview', 'OperatorResultPreview', 'BuffResultPreview', 'EquipmentResultPreview']) {
  assert.equal(pageSource.includes(`<${componentName}`), true, `review UI routes ${componentName}`);
}
assert.equal(resultPreviewSources.every((source) => source.includes('mcp-domain-result')), true, 'each fill domain has a reusable read-only result component');
assert.equal(resultPreviewSources[0].includes("sword: '单手剑'"), true, 'weapon result uses product weapon type labels');
assert.equal(pageSource.includes('<MarkdownRenderer'), false, 'review UI no longer exposes a generic Markdown/JSON field tree');
assert.equal(pageSource.includes('MCP 填表'), true, 'review UI has a dedicated MCP product identity');
assert.equal(pageSource.includes('确认变更'), true, 'review UI uses an interactive product confirmation');
assert.equal(pageSource.includes('确认并写入'), true, 'review UI does not expose internal approve/save steps as separate user work');
assert.equal(pageSource.includes('Y/Y'), false, 'review UI does not expose the retired Y/Y interaction');
assert.equal(pageSource.includes('DefOpenCodeView'), false, 'Legacy Fill review UI is not hosted by DEF OpenCode');
process.stdout.write('[legacy-fill-host-gateway-contract] passed\n');
