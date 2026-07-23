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
  loadout: ['inspect', 'evaluate', 'resolve', 'recommend', 'recommend_weapon', 'recommend_equipment', 'compare', 'preview', 'apply', 'restore'],
  timeline: ['inspect', 'current', 'add', 'remove', 'move', 'replace', 'copy', 'validate', 'preview', 'apply', 'restore'],
  buff: ['inspect', 'resolve', 'source', 'add', 'remove', 'replace', 'batch', 'stack', 'coverage', 'apply', 'restore'],
  calculation: ['calculate', 'aggregate', 'compare', 'attribute', 'diagnose', 'export', 'explain', 'skill_fact'],
};

const expectedDefaultVersions = {
  selection: 'v1',
  loadout: 'v2',
  timeline: 'v13',
  buff: 'v1',
  calculation: 'v1',
};

test('loads five real default Harnesses independently', async () => {
  const statePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'def-five-business-')), 'revisions.json');
  const registry = new BusinessHarnessRegistry({ businessRoot, statePath });
  for (const businessId of BUSINESS_IDS) {
    const revision = await registry.resolveActive(businessId);
    assert.equal(revision.version, expectedDefaultVersions[businessId], businessId);
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
    const definition = JSON.parse(fs.readFileSync(path.join(directory, 'definition.json'), 'utf8'));
    const sources = [
      fs.readFileSync(path.join(directory, 'definition.json'), 'utf8'),
      fs.readFileSync(path.join(directory, 'revisions', definition.defaultRevision, 'manifest.json'), 'utf8'),
      fs.readFileSync(path.join(directory, 'revisions', definition.defaultRevision, 'instructions.md'), 'utf8'),
    ].join('\n');
    assert.doesNotMatch(sources, /\b(?:import|require)\s*\(/);
    assert.doesNotMatch(sources, /\.\.\/(?:selection|loadout|timeline|buff|calculation)\//);
  }
});

test('selection action operations reach the formal mutation and visible verification', () => {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(businessRoot, 'selection', 'revisions', 'v1', 'manifest.json'),
    'utf8',
  ));
  for (const operationId of ['add', 'remove', 'replace', 'reorder', 'apply']) {
    const phases = manifest.operations[operationId].phases;
    const mutationIndex = phases.findIndex((phase) => phase.tools.includes('def.team.selection.apply'));
    const verificationIndex = phases.findIndex((phase) => (
      phase.kind === 'verification' && phase.tools.includes('def.node.crud.context')
    ));
    assert(mutationIndex >= 0, `${operationId} must call the formal selection mutation`);
    assert(verificationIndex > mutationIndex, `${operationId} must verify the visible selection after mutation`);
  }
});

test('selection catalog and replacement phases fail closed on incomplete identity evidence', () => {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(businessRoot, 'selection', 'revisions', 'v1', 'manifest.json'),
    'utf8',
  ));
  const searchPhases = manifest.operations.search.phases;
  const search = searchPhases.find((phase) => phase.id === 'resolve-operator');
  assert(search.resultTransitions.some((transition) => (
    transition.path === 'truncated'
    && transition.equals === true
    && transition.target === 'catalog-incomplete'
  )));
  assert.equal(
    searchPhases.find((phase) => phase.id === 'catalog-incomplete').terminalState,
    'aborted',
  );

  const replacePhases = manifest.operations.replace.phases;
  const resolve = replacePhases.find((phase) => phase.id === 'resolve-operator');
  assert(resolve.resultTransitions.some((transition) => (
    transition.path === 'ambiguity'
    && transition.equals === true
    && transition.target === 'identity-unresolved'
  )));
  assert.equal(
    replacePhases.find((phase) => phase.id === 'identity-unresolved').terminalState,
    'aborted',
  );
  assert.match(
    replacePhases.find((phase) => phase.id === 'failed').instructions,
    /Do not retry the same mutation/,
  );
  assert.match(
    replacePhases.find((phase) => phase.id === 'read-current').instructions,
    /no separate selection getter exists/,
  );
  assert.match(resolve.instructions, /never call a selection getter or repeat the catalog/);
  assert.match(
    replacePhases.find((phase) => phase.id === 'apply-selection').instructions,
    /Do not re-read context or catalog/,
  );
});

test('timeline action operations use the validated Work Node and then verify the visible checkout', () => {
  const definition = JSON.parse(fs.readFileSync(
    path.join(businessRoot, 'timeline', 'definition.json'),
    'utf8',
  ));
  const manifest = JSON.parse(fs.readFileSync(
    path.join(businessRoot, 'timeline', 'revisions', definition.defaultRevision, 'manifest.json'),
    'utf8',
  ));
  for (const operationId of ['add', 'remove', 'move', 'replace', 'copy']) {
    const phases = manifest.operations[operationId].phases;
    const diffIndex = phases.findIndex((phase) => phase.tools.includes('def.node.crud.diff'));
    const useIndex = phases.findIndex((phase) => phase.tools.includes('def.node.crud.use'));
    const visibleIndex = phases.findIndex((phase) => (
      phase.kind === 'verification' && phase.tools.includes('def.node.crud.context')
    ));
    assert(diffIndex >= 0, `${operationId} must review a semantic diff`);
    assert(useIndex > diffIndex, `${operationId} must use only the validated draft`);
    assert(visibleIndex > useIndex, `${operationId} must verify the visible checkout after use`);
  }
});

test('damage Tool exposes a product-owned formula hash', () => {
  const restSource = fs.readFileSync(path.resolve('scripts/ai-cli-rest-server.mjs'), 'utf8');
  const nativeToolSource = fs.readFileSync(path.resolve('agent/runtime/def-tools/opencode/def.js'), 'utf8');
  assert.match(restSource, /DEF_DAMAGE_FORMULA_VERSION = `sha256:/);
  assert.match(restSource, /formulaVersion: DEF_DAMAGE_FORMULA_VERSION/);
  assert.match(nativeToolSource, /formulaVersion: result\.formulaVersion/);
});

test('selection catalog browse and mutation validation share the complete local library', () => {
  const restSource = fs.readFileSync(path.resolve('scripts/ai-cli-rest-server.mjs'), 'utf8');
  const nativeToolSource = fs.readFileSync(path.resolve('agent/runtime/def-tools/opencode/def.js'), 'utf8');
  assert.match(restSource, /function readDefOperatorCatalogEntries\(\)/);
  assert.match(restSource, /new Map\(readDefOperatorCatalogEntries\(\)\.map/);
  assert.doesNotMatch(restSource, /listDefOperatorCatalog\(\{ limit: 24 \}\)/);
  assert.match(nativeToolSource, /contract: 'DefOperatorCatalogV2'/);
  assert.match(nativeToolSource, /preserveContract: true/);
  assert.match(nativeToolSource, /limit: normalizedQuery \? 12 : 200/);
});
