import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { BUSINESS_IDS, BusinessHarnessRegistry } = require('./registry.cjs');
const businessRoot = path.resolve('agent/harness/business');

const expectedOperations = {
  selection: ['inspect', 'search', 'add', 'remove', 'replace', 'reorder', 'analyze', 'apply'],
  loadout: ['inspect', 'resolve', 'recommend', 'recommend_weapon', 'recommend_equipment', 'compare', 'preview', 'apply', 'restore'],
  timeline: ['inspect', 'add', 'remove', 'move', 'replace', 'copy', 'validate', 'preview', 'apply', 'restore'],
  buff: ['inspect', 'resolve', 'source', 'add', 'remove', 'replace', 'batch', 'stack', 'coverage', 'apply', 'restore'],
  calculation: ['calculate', 'aggregate', 'compare', 'attribute', 'diagnose', 'export', 'explain'],
};

test('loads five real default V1 Harnesses independently', async () => {
  const statePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'def-five-business-')), 'revisions.json');
  const registry = new BusinessHarnessRegistry({ businessRoot, statePath });
  for (const businessId of BUSINESS_IDS) {
    const revision = await registry.resolveActive(businessId);
    assert.equal(revision.version, 'v1', businessId);
    assert.deepEqual(
      Object.keys(revision.manifest.operations).sort(),
      [...expectedOperations[businessId]].sort(),
      businessId,
    );
    assert(revision.instructions.length > 500, `${businessId} instructions must be real content`);
    const definition = (await registry.inspect(businessId)).definition;
    assert.deepEqual([...definition.operations].sort(), [...expectedOperations[businessId]].sort(), businessId);
    for (const operation of Object.values(revision.manifest.operations)) {
      for (const phase of operation.phases) {
        assert(phase.tools.length < definition.toolCeiling.length || definition.toolCeiling.length <= 1,
          `${businessId}.${phase.id} must not expose its whole capability pool`);
      }
    }
  }
});

test('keeps business write domains disjoint and calculation read-only', () => {
  const definitions = Object.fromEntries(BUSINESS_IDS.map((businessId) => [
    businessId,
    JSON.parse(fs.readFileSync(path.join(businessRoot, businessId, 'definition.json'), 'utf8')),
  ]));
  const owners = new Map();
  for (const businessId of BUSINESS_IDS) {
    for (const field of definitions[businessId].writeScope) {
      assert.equal(owners.has(field), false, `${field} is already owned by ${owners.get(field)}`);
      owners.set(field, businessId);
    }
  }
  assert.deepEqual(definitions.calculation.writeScope, []);
  assert(definitions.timeline.writeScope.every((field) => field.startsWith('timeline.')));
  assert(definitions.buff.writeScope.every((field) => field.startsWith('buff.')));
});

test('business Harness sources do not import each other', () => {
  for (const businessId of BUSINESS_IDS) {
    const directory = path.join(businessRoot, businessId);
    const sources = [
      fs.readFileSync(path.join(directory, 'definition.json'), 'utf8'),
      fs.readFileSync(path.join(directory, 'revisions', 'v1', 'manifest.json'), 'utf8'),
      fs.readFileSync(path.join(directory, 'revisions', 'v1', 'instructions.md'), 'utf8'),
    ].join('\n');
    assert.doesNotMatch(sources, /\b(?:import|require)\s*\(/);
    assert.doesNotMatch(sources, /\.\.\/(?:selection|loadout|timeline|buff|calculation)\//);
  }
});

test('damage Tool exposes a product-owned formula hash', () => {
  const restSource = fs.readFileSync(path.resolve('scripts/ai-cli-rest-server.mjs'), 'utf8');
  const nativeToolSource = fs.readFileSync(path.resolve('agent/runtime/def-tools/opencode/def.js'), 'utf8');
  assert.match(restSource, /DEF_DAMAGE_FORMULA_VERSION = `sha256:/);
  assert.match(restSource, /formulaVersion: DEF_DAMAGE_FORMULA_VERSION/);
  assert.match(nativeToolSource, /formulaVersion: result\.formulaVersion/);
});
