import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { BUSINESS_IDS } = require('./router.cjs');
const { HarnessTransactionRuntime } = require('./runtime.cjs');

const sourceBusinessRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'harness',
  'business',
);

function makeLoadoutV2(businessRoot) {
  const v1 = path.join(businessRoot, 'loadout', 'revisions', 'v1');
  const v2 = path.join(businessRoot, 'loadout', 'revisions', 'v2');
  fs.cpSync(v1, v2, { recursive: true });
  const manifestPath = path.join(v2, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.version = 'v2';
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  fs.appendFileSync(path.join(v2, 'instructions.md'), '\nV2 hot-reload contract marker.\n', 'utf8');
}

test('hot-reloads only loadout while pinning old transactions in the same Session', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'def-harness-hot-reload-'));
  try {
    const businessRoot = path.join(root, 'business');
    const sessionDirectory = path.join(root, 'session');
    const revisionStatePath = path.join(root, 'revisions.json');
    fs.cpSync(sourceBusinessRoot, businessRoot, { recursive: true });
    fs.mkdirSync(sessionDirectory, { recursive: true });
    makeLoadoutV2(businessRoot);

    const runtime = new HarnessTransactionRuntime({
      sessionDirectory,
      businessRoot,
      revisionStatePath,
    });
    const context = {
      sessionId: 'session-hot-reload',
      timelineId: 'timeline-hot-reload',
      checkoutId: 'node-hot-reload',
      checkoutType: 'work-node',
      schemeVersion: 'scheme-v1',
    };
    const before = new Map();
    for (const businessId of BUSINESS_IDS) {
      const active = await runtime.registry.resolveActive(businessId);
      before.set(businessId, {
        version: active.version,
        contentHash: active.contentHash,
      });
    }

    const route = {
      businessId: 'loadout',
      operation: 'preview',
      target: '别礼 3+1 潮涌套',
      constraints: ['explicit-target-set'],
    };
    const firstProjection = await runtime.beginBusinessTransaction(route, context, { turnId: 'turn-old-continue' });
    runtime.transactions.lockForConfirmation(firstProjection.transactionId, {
      proposal: { id: 'proposal-old-continue', token: 'token-old-continue' },
    });
    const secondProjection = await runtime.beginBusinessTransaction(route, context, { turnId: 'turn-old-revoke' });
    runtime.transactions.lockForConfirmation(secondProjection.transactionId, {
      proposal: { id: 'proposal-old-revoke', token: 'token-old-revoke' },
    });

    const reload = await runtime.registry.reloadBusiness('loadout', 'v2');
    assert.equal(reload.ok, true);
    assert.equal((await runtime.registry.resolveActive('loadout')).version, 'v2');
    for (const businessId of BUSINESS_IDS.filter((candidate) => candidate !== 'loadout')) {
      const active = await runtime.registry.resolveActive(businessId);
      assert.deepEqual(
        { version: active.version, contentHash: active.contentHash },
        before.get(businessId),
        `${businessId} must not change when loadout reloads`,
      );
    }

    const resumed = await runtime.resumeTransaction(firstProjection.transactionId, 'confirm', {
      context,
      turnId: 'turn-old-confirmed',
    });
    assert.equal(resumed.phase, 'apply-config');
    const resumedTransaction = runtime.transactions.get(firstProjection.transactionId);
    assert.equal(resumedTransaction.sessionId, context.sessionId);
    assert.equal(resumedTransaction.harnessRevision.version, 'v1');

    const newProjection = await runtime.beginBusinessTransaction(route, context, { turnId: 'turn-new-v2' });
    const newTransaction = runtime.transactions.get(newProjection.transactionId);
    assert.equal(newTransaction.sessionId, context.sessionId);
    assert.equal(newTransaction.harnessRevision.version, 'v2');
    assert.notEqual(
      newTransaction.harnessRevision.contentHash,
      resumedTransaction.harnessRevision.contentHash,
    );

    runtime.registry.revoke('loadout', 'v1');
    await runtime.transactions.recover({
      context,
      isRevisionRevoked: (businessId, version) => runtime.registry.isRevoked(businessId, version),
    });
    assert.equal(runtime.transactions.get(firstProjection.transactionId).status, 'revoked');
    assert.equal(runtime.transactions.get(secondProjection.transactionId).status, 'revoked');
    assert.equal(runtime.transactions.get(newProjection.transactionId).status, 'active');
    await assert.rejects(
      () => runtime.resumeTransaction(secondProjection.transactionId, 'confirm', { context }),
      { code: 'HARNESS_TRANSACTION_TERMINAL' },
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('same-version hot reload preserves the pinned content for a fresh runtime', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'def-harness-same-version-reload-'));
  try {
    const businessRoot = path.join(root, 'business');
    const sessionDirectory = path.join(root, 'session');
    const revisionStatePath = path.join(root, 'revisions.json');
    fs.cpSync(sourceBusinessRoot, businessRoot, { recursive: true });
    fs.mkdirSync(sessionDirectory, { recursive: true });
    const firstRuntime = new HarnessTransactionRuntime({
      sessionDirectory,
      businessRoot,
      revisionStatePath,
    });
    const context = {
      sessionId: 'session-same-version',
      timelineId: 'timeline-same-version',
      checkoutId: 'node-same-version',
      checkoutType: 'work-node',
      schemeVersion: 'scheme-v1',
    };
    const route = {
      businessId: 'loadout',
      operation: 'preview',
      target: '别礼 3+1 潮涌套',
      constraints: ['same-version-reload'],
    };
    const oldProjection = await firstRuntime.beginBusinessTransaction(route, context);
    const oldTransaction = firstRuntime.transactions.get(oldProjection.transactionId);
    const oldRecord = await firstRuntime.registry.resolveRevision('loadout', oldTransaction.harnessRevision);
    assert.doesNotMatch(oldRecord.instructions, /same-version hot reload marker/);

    const reloadResult = await new Promise((resolve, reject) => {
      let stop = () => {};
      const timeout = setTimeout(() => {
        stop();
        reject(new Error('same-version hot reload watcher timed out'));
      }, 5000);
      stop = firstRuntime.registry.watchBusinessRevisions('loadout', {
        debounceMs: 20,
        onReload(result) {
          clearTimeout(timeout);
          stop();
          resolve(result);
        },
      });
      setTimeout(() => {
        fs.appendFileSync(
          path.join(businessRoot, 'loadout', 'revisions', 'v1', 'instructions.md'),
          '\nsame-version hot reload marker\n',
          'utf8',
        );
      }, 50);
    });
    assert.equal(reloadResult.ok, true, reloadResult.error?.message);
    assert.equal(reloadResult.record.version, 'v1');
    assert.notEqual(reloadResult.record.contentHash, oldTransaction.harnessRevision.contentHash);

    const recoveredRuntime = new HarnessTransactionRuntime({
      sessionDirectory,
      businessRoot,
      revisionStatePath,
    });
    const pinned = await recoveredRuntime.registry.resolveRevision('loadout', oldTransaction.harnessRevision);
    assert.equal(pinned.contentHash, oldTransaction.harnessRevision.contentHash);
    assert.doesNotMatch(pinned.instructions, /same-version hot reload marker/);
    assert(pinned.immutableCachePath);

    const freshProjection = await recoveredRuntime.beginBusinessTransaction(route, context);
    const freshTransaction = recoveredRuntime.transactions.get(freshProjection.transactionId);
    assert.equal(freshTransaction.harnessRevision.version, 'v1');
    assert.notEqual(freshTransaction.harnessRevision.contentHash, oldTransaction.harnessRevision.contentHash);
    const fresh = await recoveredRuntime.registry.resolveRevision('loadout', freshTransaction.harnessRevision);
    assert.match(fresh.instructions, /same-version hot reload marker/);

    const rolledBack = await recoveredRuntime.registry.rollback('loadout');
    assert.equal(rolledBack.record.contentHash, oldTransaction.harnessRevision.contentHash);
    assert.doesNotMatch(rolledBack.record.instructions, /same-version hot reload marker/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
