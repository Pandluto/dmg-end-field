import assert from 'node:assert/strict';
import path from 'node:path';
import {
  loadCombatConventionRules,
  resolveCombatConventionBundle,
} from './def-core/combat-conventions.mjs';

const root = path.join(import.meta.dirname, '..', 'agent', 'runtime', 'def', 'skills', 'game-knowledge', 'conventions');
const library = loadCombatConventionRules(root);
assert.equal(library.contract, 'DefCombatConventionLibraryV1');
assert.match(library.sourceHash, /^[a-f0-9]{64}$/);
assert.equal(library.rules.length, 11);

const bundle = resolveCombatConventionBundle(library, {
  entities: ['saixi', '赛希'],
  intents: ['weapon-fit', 'operator-fit'],
  terms: ['骑士精神', '爆破单元'],
});
assert.equal(bundle.ok, true);
assert.equal(bundle.state, 'READY');
assert.equal(bundle.exhaustive, true);
assert.equal(bundle.truncated, false);
assert.match(bundle.bundleHash, /^[a-f0-9]{64}$/);
assert.deepEqual(bundle.missingEdges, []);
assert.deepEqual(bundle.conflicts, []);
assert.ok(bundle.rules.some((rule) => rule.ruleId === 'saixi.combo-after-two-heavy' && rule.certainty === 'deterministic'));
assert.ok(bundle.rules.some((rule) => rule.ruleId === 'saixi.ice-application-creates-arts-attachment' && rule.certainty === 'deterministic'));
assert.ok(bundle.rules.some((rule) => rule.ruleId === 'saixi.ice-application-high-probability-magic-burst' && rule.certainty === 'high-probability'));
assert.ok(bundle.rules.some((rule) => rule.ruleId === 'saixi.ice-application-low-probability-magic-anomaly' && rule.certainty === 'low-probability'));
assert.ok(bundle.rules.some((rule) => rule.ruleId === 'saixi.explosive-unit-substat-maps-intelligence'));
assert.deepEqual(bundle.profilePreferences.map((preference) => preference.key), [
  'reachable-team-buff',
  'ultimate-charge',
  'secondary-intelligence',
]);
assert.ok(bundle.ignoredTypeKeys.includes('willBoost'));
assert.equal(JSON.stringify(bundle).includes('75%'), false, 'qualitative probability must not acquire an invented percentage');

const repeated = resolveCombatConventionBundle(library, {
  entities: ['赛希'],
  intent: 'weapon-fit',
});
assert.equal(repeated.bundleHash, bundle.bundleHash, 'query wording may not change the canonical selected-rule bundle');

const unknown = resolveCombatConventionBundle(library, {
  entities: ['unknown-operator'],
  intent: 'weapon-fit',
});
assert.equal(unknown.state, 'NOT_FOUND');
assert.deepEqual(unknown.rules, []);

const missingQuery = resolveCombatConventionBundle(library, {});
assert.equal(missingQuery.ok, false);
assert.equal(missingQuery.code, 'combat-convention-query-required');

console.log(JSON.stringify({
  ok: true,
  checks: [
    'reviewed-markdown-rule-parser',
    'stable-rule-bundle-hash',
    'connected-dependency-closure',
    'qualitative-certainty-preserved',
    'support-profile-preferences',
    'unknown-entity-fails-closed',
  ],
}));
