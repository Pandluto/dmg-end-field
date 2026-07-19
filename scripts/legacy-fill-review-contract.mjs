import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-fill-review-'));
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'docs/specs/legacy-ai-cli-mcp-extraction/fixtures/legacy-fill-wire-v1.json'), 'utf8'));
const port = 18724;
const baseUrl = `http://127.0.0.1:${port}`;
const hostToken = 'legacy-fill-review-host-token';
const ownerNamespace = 'legacy-rest:compat';
let child;
let stderr = '';

function start() {
  child = spawn(process.execPath, ['scripts/legacy-fill-service.mjs'], {
    cwd: root,
    env: {
      ...process.env,
      LEGACY_FILL_SERVICE_PORT: String(port),
      LEGACY_FILL_HOST_TOKEN: hostToken,
      LEGACY_FILL_DATABASE_PATH: path.join(tempRoot, 'legacy-fill.sqlite3'),
      LEGACY_FILL_REGISTRY_PATH: path.join(tempRoot, 'registry.json'),
      LEGACY_FILL_DOMAIN_RUNTIME_PATH: path.join(root, 'dist/legacy-fill/domain-runtime.mjs'),
      LEGACY_FILL_FIXTURE_PATH: path.join(root, 'docs/specs/legacy-ai-cli-mcp-extraction/fixtures/legacy-fill-wire-v1.json'),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
}

async function waitForHealth() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      const body = await response.json();
      if (response.ok && body.pid === child.pid && body.domainRuntime.ready) return;
    } catch { /* service starts asynchronously */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Legacy Fill review service timeout: ${stderr}`);
}

async function request(method, pathname, body, authority = false) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(authority ? { 'x-legacy-fill-host-token': hostToken } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

function snapshotPayload(suffix, changedDomain = '') {
  return {
    contract: 'LegacyFillSnapshotV1',
    snapshotId: `review-contract-${suffix}`,
    publishedAt: `2026-07-19T00:00:0${suffix}.000Z`,
    domains: Object.fromEntries(Object.keys(fixture.domains).map((domain) => [domain, {
      domain,
      schemaVersion: 1,
      revision: 1,
      contentHash: `sha256:review-${domain}-${domain === changedDomain ? suffix : 'base'}`,
      current: null,
      library: domain === 'equipment' ? { schemaVersion: 1, gearSets: {} } : {},
    }])),
  };
}

async function create(domain, requestId) {
  const result = await request('POST', `/api/${domain}/fill/apply?client=review-contract`, {
    requestId,
    draft: fixture.domains[domain].draft,
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body.proposal.id;
}

async function inspect(proposalId) {
  const result = await request('GET', `/internal/proposals/${encodeURIComponent(proposalId)}?ownerNamespace=${encodeURIComponent(ownerNamespace)}`, undefined, true);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
}

async function hostAction(pathname, payload, expectedStatus = 200) {
  const result = await request('POST', pathname, payload, true);
  assert.equal(result.status, expectedStatus, JSON.stringify(result.body));
  return result.body;
}

try {
  start();
  await waitForHealth();
  assert.equal((await request('GET', '/internal/proposals')).status, 403, 'ordinary transport cannot access Host proposal aggregation');
  assert.equal((await request('POST', '/internal/proposals/claim', {})).status, 403, 'ordinary transport cannot claim');
  await hostAction('/internal/snapshots/publish', snapshotPayload('1'));

  const savedId = await create('weapon', 'review-saved');
  const pending = await inspect(savedId);
  assert.equal(pending.proposal.review.manifestVersion, 1);
  assert.equal(pending.proposal.review.review.status, 'pending');
  assert.equal(pending.proposal.review.persistence.status, 'not-requested');
  assert.equal(Array.isArray(pending.proposal.review.diff), true);
  assert.equal(pending.proposal.review.normalizedDraft.id, 'fixture-weapon');
  assert.equal(pending.proposal.review.requestedWrites[0].targetId, 'fixture-weapon');
  const savedSession = 'review-session-saved';
  const claimed = await hostAction('/internal/proposals/claim', {
    ownerNamespace, proposalId: savedId, expectedRevision: 1,
    expectedManifestDigest: pending.proposal.manifestDigest, reviewSessionId: savedSession,
  });
  assert.equal(claimed.proposal.revision, 2);
  assert.equal((await hostAction('/internal/proposals/save/begin', {
    ownerNamespace, proposalId: savedId, expectedRevision: 2,
    expectedManifestDigest: pending.proposal.manifestDigest, reviewSessionId: savedSession,
  }, 409)).error.code, 'proposal-not-approved');
  assert.equal((await hostAction('/internal/proposals/decision', {
    ownerNamespace, proposalId: savedId, expectedRevision: 1,
    expectedManifestDigest: pending.proposal.manifestDigest, reviewSessionId: savedSession, decision: 'approved',
  }, 409)).error.code, 'proposal-review-cas-conflict');
  const approved = await hostAction('/internal/proposals/decision', {
    ownerNamespace, proposalId: savedId, expectedRevision: 2,
    expectedManifestDigest: pending.proposal.manifestDigest, reviewSessionId: savedSession, decision: 'approved',
  });
  assert.equal(approved.proposal.review.review.status, 'approved');
  assert.equal(approved.proposal.review.persistence.status, 'not-requested');
  const saving = await hostAction('/internal/proposals/save/begin', {
    ownerNamespace, proposalId: savedId, expectedRevision: approved.proposal.revision,
    expectedManifestDigest: pending.proposal.manifestDigest, reviewSessionId: savedSession,
  });
  assert.equal(saving.proposal.review.persistence.status, 'pending');
  const saved = await hostAction('/internal/proposals/save/result', {
    ownerNamespace, proposalId: savedId, expectedRevision: saving.proposal.revision,
    expectedManifestDigest: pending.proposal.manifestDigest, reviewSessionId: savedSession, ok: true,
    result: { postcondition: 'verified' },
  });
  assert.equal(saved.proposal.lifecycleStatus, 'applied');
  assert.equal(saved.proposal.review.persistence.status, 'saved');
  const retried = await request('POST', '/api/weapon/fill/apply?client=review-contract', { requestId: 'review-saved', draft: fixture.domains.weapon.draft });
  assert.equal(retried.body.proposal.id, savedId);
  assert.equal(retried.body.proposal.save, 'Yes', 'retry cannot reuse an old confirmation to create new content');

  const rejectedId = await create('operator', 'review-rejected');
  const rejectedPending = (await inspect(rejectedId)).proposal;
  const rejectedSession = 'review-session-rejected';
  const rejectedClaim = await hostAction('/internal/proposals/claim', {
    ownerNamespace, proposalId: rejectedId, expectedRevision: rejectedPending.revision,
    expectedManifestDigest: rejectedPending.manifestDigest, reviewSessionId: rejectedSession,
  });
  const rejected = await hostAction('/internal/proposals/decision', {
    ownerNamespace, proposalId: rejectedId, expectedRevision: rejectedClaim.proposal.revision,
    expectedManifestDigest: rejectedPending.manifestDigest, reviewSessionId: rejectedSession, decision: 'rejected',
  });
  assert.equal(rejected.proposal.review.review.status, 'rejected');
  assert.equal(rejected.proposal.review.persistence.status, 'not-requested');

  const staleId = await create('buff', 'review-stale');
  const stalePending = (await inspect(staleId)).proposal;
  const staleSession = 'review-session-stale';
  const staleClaim = await hostAction('/internal/proposals/claim', {
    ownerNamespace, proposalId: staleId, expectedRevision: stalePending.revision,
    expectedManifestDigest: stalePending.manifestDigest, reviewSessionId: staleSession,
  });
  const staleApproved = await hostAction('/internal/proposals/decision', {
    ownerNamespace, proposalId: staleId, expectedRevision: staleClaim.proposal.revision,
    expectedManifestDigest: stalePending.manifestDigest, reviewSessionId: staleSession, decision: 'approved',
  });
  await hostAction('/internal/snapshots/publish', snapshotPayload('2', 'buff'));
  const stale = await hostAction('/internal/proposals/save/begin', {
    ownerNamespace, proposalId: staleId, expectedRevision: staleApproved.proposal.revision,
    expectedManifestDigest: stalePending.manifestDigest, reviewSessionId: staleSession,
  });
  assert.equal(stale.proposal.lifecycleStatus, 'stale');
  assert.equal(stale.proposal.staleBase, true);

  const failedId = await create('equipment', 'review-failed');
  const failedPending = (await inspect(failedId)).proposal;
  const failedSession = 'review-session-failed';
  const failedClaim = await hostAction('/internal/proposals/claim', {
    ownerNamespace, proposalId: failedId, expectedRevision: failedPending.revision,
    expectedManifestDigest: failedPending.manifestDigest, reviewSessionId: failedSession,
  });
  const failedApproved = await hostAction('/internal/proposals/decision', {
    ownerNamespace, proposalId: failedId, expectedRevision: failedClaim.proposal.revision,
    expectedManifestDigest: failedPending.manifestDigest, reviewSessionId: failedSession, decision: 'approved',
  });
  const failedSaving = await hostAction('/internal/proposals/save/begin', {
    ownerNamespace, proposalId: failedId, expectedRevision: failedApproved.proposal.revision,
    expectedManifestDigest: failedPending.manifestDigest, reviewSessionId: failedSession,
  });
  const failed = await hostAction('/internal/proposals/save/result', {
    ownerNamespace, proposalId: failedId, expectedRevision: failedSaving.proposal.revision,
    expectedManifestDigest: failedPending.manifestDigest, reviewSessionId: failedSession, ok: false,
    result: { code: 'host-write-postcondition-failed' },
  });
  assert.equal(failed.proposal.review.persistence.status, 'failed');
  assert.equal(failed.proposal.lifecycleStatus, 'approved');

  const audit = await inspect(savedId);
  assert.deepEqual(audit.audit.map((event) => event.eventType), [
    'proposal.created', 'proposal.review-claimed', 'proposal.review-approved', 'proposal.save-started', 'proposal.saved',
  ]);
  process.stdout.write('[legacy-fill-review-contract] passed\n');
} finally {
  if (child && child.exitCode === null) child.kill('SIGTERM');
  if (child && child.exitCode === null) await Promise.race([new Promise((resolve) => child.once('exit', resolve)), new Promise((resolve) => setTimeout(resolve, 3000))]);
  fs.rmSync(tempRoot, { recursive: true, force: true });
  if (stderr.trim()) process.stderr.write(stderr);
}
