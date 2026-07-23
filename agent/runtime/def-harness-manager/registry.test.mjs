import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { BusinessHarnessRegistry } = require('./registry.cjs');
const { RevisionController } = require('./revision-controller.cjs');

const toolIds = ['def.read', 'def.preview', 'def.apply', 'def.verify'];

function definition(businessId) {
  return {
    schemaVersion: 1,
    businessId,
    summary: `${businessId} business`,
    operations: ['inspect', 'apply'],
    toolCeiling: toolIds,
    writeScope: businessId === 'calculation' ? [] : [`${businessId}.value`],
    completion: { verification: 'visible' },
    downstream: { calculation: 'recompute' },
  };
}

function manifest(businessId, version, overrides = {}) {
  const writeScope = businessId === 'calculation' ? [] : [`${businessId}.value`];
  return {
    schemaVersion: 1,
    businessId,
    version,
    writeScope,
    operations: {
      inspect: {
        entryPhase: 'read',
        phases: [
          { id: 'read', kind: 'context', tools: ['def.read'], writes: [], transitions: { onSuccess: 'done', onFailure: 'failed' } },
          { id: 'done', kind: 'response', tools: [], writes: [], terminalState: 'completed' },
          { id: 'failed', kind: 'response', tools: [], writes: [], terminalState: 'aborted' },
        ],
      },
      apply: {
        entryPhase: 'preview',
        phases: [
          { id: 'preview', kind: 'proposal', tools: ['def.preview'], writes: [], transitions: { onSuccess: 'apply', onFailure: 'failed' } },
          { id: 'apply', kind: 'mutation', tools: ['def.apply'], writes: writeScope, transitions: { onSuccess: 'verify', onFailure: 'failed' } },
          { id: 'verify', kind: 'verification', tools: ['def.verify'], writes: [], transitions: { onSuccess: 'done', onFailure: 'failed' } },
          { id: 'done', kind: 'response', tools: [], writes: [], terminalState: 'completed' },
          { id: 'failed', kind: 'response', tools: [], writes: [], terminalState: 'aborted' },
        ],
      },
    },
    ...overrides,
  };
}

function writeBusiness(root, businessId, versions) {
  const business = path.join(root, businessId);
  fs.mkdirSync(business, { recursive: true });
  fs.writeFileSync(path.join(business, 'definition.json'), JSON.stringify(definition(businessId), null, 2));
  for (const [version, value] of Object.entries(versions)) {
    const revision = path.join(business, 'revisions', version);
    fs.mkdirSync(revision, { recursive: true });
    fs.writeFileSync(path.join(revision, 'manifest.json'), JSON.stringify(value, null, 2));
    fs.writeFileSync(path.join(revision, 'instructions.md'), `# ${businessId} ${version}\n`);
  }
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'def-business-registry-'));
  writeBusiness(root, 'selection', { v1: manifest('selection', 'v1'), v2: manifest('selection', 'v2') });
  writeBusiness(root, 'loadout', { v1: manifest('loadout', 'v1'), v2: manifest('loadout', 'v2') });
  return {
    root,
    registry: new BusinessHarnessRegistry({
      businessRoot: root,
      statePath: path.join(root, '.state', 'revisions.json'),
      toolIds,
    }),
  };
}

test('activates and rolls back one business without changing another', async () => {
  const { registry } = fixture();
  await registry.register('selection', 'v1');
  await registry.activate('selection');
  await registry.register('loadout', 'v1');
  await registry.activate('loadout');
  await registry.reloadBusiness('loadout', 'v2');
  assert.equal((await registry.resolveActive('loadout')).version, 'v2');
  assert.equal((await registry.resolveActive('selection')).version, 'v1');
  await registry.rollback('loadout');
  assert.equal((await registry.resolveActive('loadout')).version, 'v1');
  assert.equal((await registry.resolveActive('selection')).version, 'v1');
});

test('merges revision updates written by separate runtime controllers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'def-harness-controller-merge-'));
  try {
    const statePath = path.join(root, 'revisions.json');
    const first = new RevisionController({ statePath });
    const second = new RevisionController({ statePath });
    first.registerCandidate('selection', { version: 'v1', contentHash: 'selection-v1' });
    second.registerCandidate('loadout', { version: 'v1', contentHash: 'loadout-v1' });
    const recovered = new RevisionController({ statePath });
    assert.equal(recovered.businessState('selection').candidate.contentHash, 'selection-v1');
    assert.equal(recovered.businessState('loadout').candidate.contentHash, 'loadout-v1');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects invalid Tool, expanded write scope, dead end and mutation without verification', async () => {
  const cases = [
    ['unknown-tool', { operations: { inspect: { entryPhase: 'read', phases: [
      { id: 'read', kind: 'context', tools: ['def.unknown'], writes: [], transitions: { onSuccess: 'done', onFailure: 'done' } },
      { id: 'done', kind: 'response', tools: [], writes: [], terminalState: 'completed' },
    ] } } }],
    ['expanded-write', { writeScope: ['selection.value', 'timeline.value'] }],
    ['dead-end', { operations: { inspect: { entryPhase: 'read', phases: [
      { id: 'read', kind: 'context', tools: ['def.read'], writes: [], transitions: { onSuccess: 'read', onFailure: 'read' } },
    ] } } }],
    ['no-verification', { operations: { apply: { entryPhase: 'apply', phases: [
      { id: 'apply', kind: 'mutation', tools: ['def.apply'], writes: ['selection.value'], transitions: { onSuccess: 'done', onFailure: 'done' } },
      { id: 'done', kind: 'response', tools: [], writes: [], terminalState: 'completed' },
    ] } } }],
  ];
  for (const [name, overrides] of cases) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `def-business-${name}-`));
    writeBusiness(root, 'selection', { v1: manifest('selection', 'v1', overrides) });
    const registry = new BusinessHarnessRegistry({ businessRoot: root, statePath: path.join(root, 'state.json'), toolIds });
    await assert.rejects(() => registry.validate('selection', 'v1'), { code: 'HARNESS_REVISION_INVALID' }, name);
  }
});

test('keeps last-known-good active when reload validation fails', async () => {
  const { root, registry } = fixture();
  await registry.reloadBusiness('loadout', 'v1');
  const invalidPath = path.join(root, 'loadout', 'revisions', 'v2', 'manifest.json');
  const invalid = manifest('loadout', 'v2');
  invalid.operations.inspect.phases[0].tools = ['def.missing'];
  fs.writeFileSync(invalidPath, JSON.stringify(invalid, null, 2));
  const result = await registry.reloadBusiness('loadout', 'v2');
  assert.equal(result.ok, false);
  assert.equal((await registry.resolveActive('loadout')).version, 'v1');
});

test('revocation prevents an active revision from resolving', async () => {
  const { registry } = fixture();
  await registry.reloadBusiness('selection', 'v1');
  registry.revoke('selection', 'v1');
  assert.equal(await registry.resolveActive('selection'), null);
  await assert.rejects(() => registry.activate('selection', 'v1'), { code: 'HARNESS_REVISION_REVOKED' });
});
