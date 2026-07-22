import assert from 'node:assert/strict';
import {
  buildDefEquipmentCatalogSnapshot,
  buildDefEquipmentSetFitShortlist,
  buildDefEquipmentThreePlusOnePlan,
} from './def-core/equipment-3plus1-domain.mjs';
import { createDefEquipment3Plus1RecommendationService } from './def-core/equipment-3plus1-recommendation.mjs';

const PART = Object.freeze({ armor: '\u62a4\u7532', glove: '\u62a4\u624b', accessory: '\u914d\u4ef6' });
const VALID_DIGEST = 'sha256:'.concat('a'.repeat(64));
const DEFAULT_EFFECTS = Object.freeze(['ultimateDmgBonus', 'allSkillDmgBonus', 'iceDmgBonus', 'strengthBoost', 'willBoost']);

function effect(id, typeKey) {
  return { effectId: id, label: typeKey, typeKey, unit: 'percent', value: 0.2 };
}

function equipment(id, part, effectTypes = DEFAULT_EFFECTS) {
  return {
    equipmentId: id,
    name: id,
    part,
    effects: Object.fromEntries(effectTypes.map((typeKey, index) => [`effect-${index}`, effect(`${id}-${typeKey}`, typeKey)])),
  };
}

function gearSet(id, {
  setEffects = ['allSkillDmgBonus'],
  pieceEffects = DEFAULT_EFFECTS,
  armorVariants = 1,
  accessoryVariants = 2,
} = {}) {
  const equipments = {
    armor: equipment(`${id}-armor-a`, PART.armor, pieceEffects),
    glove: equipment(`${id}-glove`, PART.glove, pieceEffects),
  };
  for (let index = 1; index < armorVariants; index += 1) {
    equipments[`armor-${index + 1}`] = equipment(`${id}-armor-${String.fromCharCode(97 + index)}`, PART.armor, pieceEffects);
  }
  for (let index = 0; index < accessoryVariants; index += 1) {
    equipments[`accessory-${index + 1}`] = equipment(`${id}-accessory-${String.fromCharCode(97 + index)}`, PART.accessory, pieceEffects);
  }
  return {
    gearSetId: id,
    name: id,
    threePieceBuffs: Object.fromEntries(setEffects.map((typeKey, index) => [`bonus-${index}`, effect(`${id}-bonus-${index}`, typeKey)])),
    equipments,
  };
}

function libraryFrom(...sets) {
  return { gearSets: Object.fromEntries(sets.map((set) => [set.gearSetId, set])) };
}

function guideReference(content, { id = 'matrix-guide', sectionId = 'matrix-build' } = {}) {
  return {
    id,
    title: 'Nova \u5e72\u5458\u517b\u6210',
    text: content,
    lineOffsets: [0, content.length],
    index: {
      headings: [{
        sectionId,
        heading: 'Nova \u88c5\u5907',
        level: 2,
        parentSectionId: null,
        lineStart: 0,
        lineEnd: 1,
      }],
    },
  };
}

const completeGuideContent = '## Nova \u88c5\u5907\n\u4f18\u5148\u529b\u91cf\u548c\u610f\u5fd7\u3002';
const partialGuideContent = '## Nova \u88c5\u5907\n\u4f18\u5148\u529b\u91cf\u3002';
const matrixOperator = Object.freeze({
  id: 'matrix',
  name: 'Nova',
  element: 'ice',
  profession: 'striker',
  mainStat: '\u529b\u91cf',
  subStat: '\u610f\u5fd7',
  skills: { q: { displayName: 'Matrix Q', buttonType: 'Q', hitMeta: { hit: { levels: { M3: 8 } } } } },
});
const supportOperator = Object.freeze({ ...matrixOperator, id: 'support-matrix', name: 'Support Nova', profession: 'support' });

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function createFixture({
  library,
  references = [],
  guideContent = null,
  operators = { matrix: matrixOperator },
  combatConventions = { ok: true, state: 'READY', rules: [], bundleHash: 'sha256:'.concat('0'.repeat(64)) },
  frozen = false,
  storageKey = 'service-matrix',
} = {}) {
  const counters = { catalog: 0, guide: 0, conventions: 0 };
  let currentLibrary = frozen ? deepFreeze(structuredClone(library)) : structuredClone(library);
  const currentOperators = frozen ? deepFreeze(structuredClone(operators)) : structuredClone(operators);
  const ports = {
    async readOperatorCatalog() { return frozen ? currentOperators : structuredClone(currentOperators); },
    async loadGuideReferences() { return structuredClone(references); },
    async readGuideSection({ referenceId, sectionId }) {
      counters.guide += 1;
      if (!guideContent) throw new Error('guide section was unexpectedly requested');
      return { ok: true, referenceId, section: { sectionId }, content: guideContent, truncated: false };
    },
    async resolveCombatConventions() {
      counters.conventions += 1;
      return structuredClone(combatConventions);
    },
    async readEquipmentLibrarySource() {
      counters.catalog += 1;
      return { library: frozen ? currentLibrary : structuredClone(currentLibrary), storageKey };
    },
    async readGearSetAliasIndex() {
      return new Map(Object.values(currentLibrary.gearSets).flatMap((set) => [[set.gearSetId, set.gearSetId], [set.name, set.gearSetId]]));
    },
  };
  const service = createDefEquipment3Plus1RecommendationService(ports);
  return {
    counters,
    invoke(input, { sessionId = 'matrix-session-a', turnId = 'matrix-turn' } = {}) {
      return service.recommend({ sessionId, turnId, input });
    },
    snapshot() {
      return buildDefEquipmentCatalogSnapshot({ library: structuredClone(currentLibrary), storageKey, capturedAt: 0 });
    },
    replaceLibrary(nextLibrary) { currentLibrary = frozen ? deepFreeze(structuredClone(nextLibrary)) : structuredClone(nextLibrary); },
  };
}

function planItemIds(response) {
  return response.result.plans[0].items.map((item) => item.stableId);
}

// GUIDE_FOUND owns the complete profile and therefore never consults fallback.
const guideFoundFixture = createFixture({
  library: libraryFrom(gearSet('guide-full')),
  references: [guideReference(completeGuideContent)],
  guideContent: completeGuideContent,
});
const guideFound = await guideFoundFixture.invoke({ operatorQuery: 'Nova', setQuery: 'guide-full' });
assert.equal(guideFound.state, 'READY', JSON.stringify(guideFound));
assert.equal(guideFound.result.profileEvidence.state, 'GUIDE_FOUND');
assert.deepEqual(guideFound.result.profileEvidence.preferenceGroups.map((group) => group.key), ['primary-strength', 'secondary-will']);
assert.equal(guideFoundFixture.counters.guide, 1);
assert.equal(guideFoundFixture.counters.conventions, 0, 'GUIDE_FOUND must not invoke fallback conventions');

// PARTIAL_GUIDE_FOUND keeps the guide-proven strength group and supplements only the missing groups.
const partialFixture = createFixture({
  library: libraryFrom(gearSet('partial-full')),
  references: [guideReference(partialGuideContent)],
  guideContent: partialGuideContent,
});
const partial = await partialFixture.invoke({ operatorQuery: 'Nova', setQuery: 'partial-full' });
assert.equal(partial.state, 'READY', JSON.stringify(partial));
assert.equal(partial.result.profileEvidence.state, 'PARTIAL_GUIDE_FOUND');
assert.equal(partial.result.profileEvidence.preferenceGroups.filter((group) => group.acceptedTypeKeys.includes('strengthBoost')).length, 1, 'fallback may supplement but cannot duplicate or override a guide-proven group');
assert.equal(partial.result.profileEvidence.preferenceGroups[0].key, 'primary-strength');
assert.ok(partial.result.profileEvidence.evidenceRefs.some((ref) => ref.startsWith('guide-sha256:')));

// GUIDE_NOT_FOUND only sees structured operator evidence.  A support role additionally requires reviewed conventions.
const noGuideFixture = createFixture({ library: libraryFrom(gearSet('no-guide-full')) });
const noGuide = await noGuideFixture.invoke({ operatorQuery: 'Nova', setQuery: 'no-guide-full' });
assert.equal(noGuide.state, 'READY', JSON.stringify(noGuide));
assert.equal(noGuide.result.profileEvidence.state, 'GUIDE_NOT_FOUND');
assert.equal(noGuideFixture.counters.guide, 0);
assert.equal(noGuideFixture.counters.conventions, 0, 'non-support fallback must not invent a convention dependency');

const supportFixture = createFixture({
  library: libraryFrom(gearSet('support-full')),
  operators: { 'support-matrix': supportOperator },
  combatConventions: {
    ok: true,
    state: 'READY',
    rules: [{ ruleId: 'reviewed-support-rule' }],
    bundleHash: 'sha256:'.concat('1'.repeat(64)),
    profilePreferences: [
      { key: 'reviewed-strength', label: 'reviewed strength', kind: 'other', acceptedTypeKeys: ['strengthBoost'] },
      { key: 'reviewed-will', label: 'reviewed will', kind: 'other', acceptedTypeKeys: ['willBoost'] },
    ],
  },
});
const support = await supportFixture.invoke({ operatorQuery: 'Support Nova', setQuery: 'support-full' });
assert.equal(support.state, 'READY', JSON.stringify(support));
assert.equal(support.result.profileEvidence.state, 'GUIDE_NOT_FOUND');
assert.equal(supportFixture.counters.conventions, 1, 'support fallback must request the reviewed convention bundle exactly once');
assert.deepEqual(support.result.profileEvidence.preferenceGroups.map((group) => group.key), ['reviewed-strength', 'reviewed-will']);

// The higher set-bonus candidate is incomplete.  The lower set-bonus candidate is complete;
// automatic selection must skip the former instead of terminating UNRESOLVED.
const incompleteLeadingSet = gearSet('incomplete-leading', {
  setEffects: ['strengthBoost', 'willBoost'],
  pieceEffects: ['strengthBoost'],
});
const completeTrailingSet = gearSet('complete-trailing', {
  setEffects: ['strengthBoost'],
  pieceEffects: ['strengthBoost', 'willBoost'],
});
const autoFixture = createFixture({
  library: libraryFrom(incompleteLeadingSet, completeTrailingSet),
  references: [guideReference(completeGuideContent)],
  guideContent: completeGuideContent,
});
const autoSnapshot = autoFixture.snapshot();
const guideProfile = {
  characterId: 'matrix',
  derivation: 'guide',
  evidenceRefs: ['guide-matrix'],
  keywords: ['strength', 'will'],
  preferenceGroups: [
    { key: 'strength', label: 'strength', kind: 'primary-attribute', acceptedTypeKeys: ['strengthBoost'] },
    { key: 'will', label: 'will', kind: 'secondary-attribute', acceptedTypeKeys: ['willBoost'] },
  ],
};
const incompletePlan = buildDefEquipmentThreePlusOnePlan({ snapshot: autoSnapshot, targetSetId: 'incomplete-leading', profile: guideProfile });
const completePlan = buildDefEquipmentThreePlusOnePlan({ snapshot: autoSnapshot, targetSetId: 'complete-trailing', profile: guideProfile });
assert.ok(incompletePlan.missing.length > 0, 'fixture must make the high set-score candidate incomplete');
assert.equal(completePlan.missing.length, 0, 'fixture must provide a complete legal alternative');
const automatic = await autoFixture.invoke({ operatorQuery: 'Nova' });
assert.equal(automatic.state, 'READY', JSON.stringify(automatic));
assert.equal(automatic.result.selectedSet.id, 'complete-trailing', 'automatic selection must consider plan completeness before set score');
const autoSetShortlist = buildDefEquipmentSetFitShortlist({ snapshot: autoSnapshot, profile: guideProfile });
assert.equal(autoSetShortlist.rankedSets.find((set) => set.id === 'incomplete-leading').eligible, false);
assert.equal(autoSetShortlist.rankedSets.find((set) => set.id === 'complete-trailing').eligible, true);

// A set whose every topology is emptied by required constraints is also skipped;
// the service must continue through the full catalog to the remaining legal set.
const constraintsFixture = createFixture({
  library: libraryFrom(
    gearSet('constraints-eliminated', { setEffects: ['strengthBoost', 'willBoost'], pieceEffects: ['strengthBoost', 'willBoost'] }),
    gearSet('constraints-valid', { setEffects: ['strengthBoost', 'willBoost'], pieceEffects: ['strengthBoost', 'willBoost'] }),
  ),
  references: [guideReference(completeGuideContent)],
  guideContent: completeGuideContent,
});
const constraintsSkipped = await constraintsFixture.invoke({
  operatorQuery: 'Nova',
  constraints: {
    requiredEquipmentQueries: [
      'constraints-valid-armor-a',
      'constraints-valid-glove',
      'constraints-valid-accessory-a',
      'constraints-valid-accessory-b',
    ],
  },
});
assert.equal(constraintsSkipped.state, 'READY', JSON.stringify(constraintsSkipped));
assert.equal(constraintsSkipped.result.selectedSet.id, 'constraints-valid');
assert.deepEqual(planItemIds(constraintsSkipped), [
  'constraints-valid-armor-a',
  'constraints-valid-glove',
  'constraints-valid-accessory-a',
  'constraints-valid-accessory-b',
]);

// Equal business scores leave a set decision to the caller.  Stable ids only order the choices.
const setTieFixture = createFixture({
  library: libraryFrom(gearSet('set-tie-a', { setEffects: ['strengthBoost', 'willBoost'], pieceEffects: ['strengthBoost', 'willBoost'] }), gearSet('set-tie-b', { setEffects: ['strengthBoost', 'willBoost'], pieceEffects: ['strengthBoost', 'willBoost'] })),
  references: [guideReference(completeGuideContent)],
  guideContent: completeGuideContent,
});
const setTie = await setTieFixture.invoke({ operatorQuery: 'Nova' });
assert.equal(setTie.state, 'NEEDS_INPUT', JSON.stringify(setTie));
assert.equal(setTie.nextQuestion.field, 'setQuery');
assert.deepEqual(setTie.nextQuestion.options.map((option) => option.id), ['set-tie-a', 'set-tie-b']);

// Four target-set memberships are valid.  Duplicate policy changes only compatible accessory reuse.
const duplicateFixture = createFixture({
  library: libraryFrom(gearSet('duplicate-full', { setEffects: ['strengthBoost', 'willBoost'], pieceEffects: ['strengthBoost', 'willBoost'], accessoryVariants: 2 })),
  references: [guideReference(completeGuideContent)],
  guideContent: completeGuideContent,
});
const duplicateDefault = await duplicateFixture.invoke({ operatorQuery: 'Nova', setQuery: 'duplicate-full' });
const duplicateAllow = await duplicateFixture.invoke({ operatorQuery: 'Nova', setQuery: 'duplicate-full', constraints: { duplicateAccessoryPolicy: 'allow' } });
const duplicateForbid = await duplicateFixture.invoke({ operatorQuery: 'Nova', setQuery: 'duplicate-full', constraints: { duplicateAccessoryPolicy: 'forbid' } });
for (const response of [duplicateDefault, duplicateAllow, duplicateForbid]) assert.equal(response.state, 'READY', JSON.stringify(response));
assert.equal(duplicateDefault.result.plans[0].setMembershipCount, 4);
assert.ok(duplicateDefault.result.plans[0].items.every((item) => item.setId === 'duplicate-full'), 'four same-set physical slots must remain legal');
assert.equal(duplicateDefault.result.plans[0].items[2].stableId, duplicateDefault.result.plans[0].items[3].stableId, 'catalog-default permits a compatible accessory pair');
assert.equal(duplicateAllow.result.plans[0].items[2].stableId, duplicateAllow.result.plans[0].items[3].stableId, 'allow preserves the catalog-default compatible pair behavior');
assert.notEqual(duplicateForbid.result.plans[0].items[2].stableId, duplicateForbid.result.plans[0].items[3].stableId, 'forbid must choose distinct compatible accessories');

// Equal plans remain visible as a READY shortlist with a typed tie ambiguity.
const planTieFixture = createFixture({
  library: libraryFrom(gearSet('plan-tie', { setEffects: ['strengthBoost', 'willBoost'], pieceEffects: ['strengthBoost', 'willBoost'], armorVariants: 2 })),
  references: [guideReference(completeGuideContent)],
  guideContent: completeGuideContent,
});
const planTie = await planTieFixture.invoke({ operatorQuery: 'Nova', setQuery: 'plan-tie', shortlistLimit: 2 });
assert.equal(planTie.state, 'READY', JSON.stringify(planTie));
assert.equal(planTie.completeness, 'partial');
assert.equal(planTie.result.plans.length, 2);
assert.ok(planTie.result.plans.every((plan) => plan.ambiguities.some((entry) => entry.field === 'plan' && entry.candidateCount === 8 && entry.truncated === false)), 'each tied READY plan must carry the complete typed plan ambiguity');

// priorPlanDigest never reads or reuses a prior plan: only provenance changes on the same evidence,
// while a fresh catalog revision changes the freshly recomputed plan digest.
const revisionFixture = createFixture({
  library: libraryFrom(gearSet('revision-full', { setEffects: ['strengthBoost', 'willBoost'], pieceEffects: ['strengthBoost', 'willBoost'] })),
  references: [guideReference(completeGuideContent)],
  guideContent: completeGuideContent,
  storageKey: 'revision-matrix',
});
const baseline = await revisionFixture.invoke({ operatorQuery: 'Nova', setQuery: 'revision-full' }, { sessionId: 'session-one' });
const sameInputWithPrior = await revisionFixture.invoke({ operatorQuery: 'Nova', setQuery: 'revision-full', priorPlanDigest: baseline.result.planDigest }, { sessionId: 'session-two' });
assert.equal(sameInputWithPrior.state, 'READY');
assert.equal(sameInputWithPrior.supersedesPlanDigest, baseline.result.planDigest);
assert.equal(sameInputWithPrior.requestDigest, baseline.requestDigest);
assert.equal(sameInputWithPrior.result.planDigest, baseline.result.planDigest);
assert.deepEqual(sameInputWithPrior.result.plans, baseline.result.plans);
assert.ok(revisionFixture.counters.catalog >= 2, 'a prior digest cannot bypass fresh trusted catalog reads');
const changedInputWithPrior = await revisionFixture.invoke({
  operatorQuery: 'Nova',
  setQuery: 'revision-full',
  shortlistLimit: 1,
  priorPlanDigest: baseline.result.planDigest,
}, { sessionId: 'session-two-changed-input' });
assert.equal(changedInputWithPrior.state, 'READY');
assert.equal(changedInputWithPrior.supersedesPlanDigest, baseline.result.planDigest);
assert.notEqual(changedInputWithPrior.requestDigest, baseline.requestDigest);
assert.notEqual(changedInputWithPrior.result.planDigest, baseline.result.planDigest, 'a changed business input must be planned afresh rather than reusing the prior result');
assert.ok(revisionFixture.counters.catalog >= 3, 'a changed business input with a prior digest still reads fresh trusted evidence');
const revisedLibrary = libraryFrom(gearSet('revision-full', { setEffects: ['strengthBoost', 'willBoost'], pieceEffects: ['strengthBoost', 'willBoost', 'ultimateDmgBonus'] }));
revisionFixture.replaceLibrary(revisedLibrary);
const revised = await revisionFixture.invoke({ operatorQuery: 'Nova', setQuery: 'revision-full', priorPlanDigest: VALID_DIGEST }, { sessionId: 'session-three' });
assert.equal(revised.state, 'READY', JSON.stringify(revised));
assert.notEqual(revised.result.catalogEvidence.revision, baseline.result.catalogEvidence.revision);
assert.notEqual(revised.result.planDigest, baseline.result.planDigest, 'a new catalog revision must produce a fresh plan digest');
const crossSession = await revisionFixture.invoke({ operatorQuery: 'Nova', setQuery: 'revision-full' }, { sessionId: 'session-four' });
const crossSessionAgain = await revisionFixture.invoke({ operatorQuery: 'Nova', setQuery: 'revision-full' }, { sessionId: 'session-five' });
assert.equal(crossSession.requestDigest, crossSessionAgain.requestDigest);
assert.equal(crossSession.result.planDigest, crossSessionAgain.result.planDigest, 'session identity cannot perturb deterministic digests');

// Explicit compare preserves the requested slot; an omitted slot expands once per compatible physical slot.
const compareFixture = createFixture({
  library: libraryFrom(gearSet('compare-full', { setEffects: ['strengthBoost', 'willBoost'], pieceEffects: ['strengthBoost', 'willBoost'] })),
  references: [guideReference(completeGuideContent)],
  guideContent: completeGuideContent,
});
const explicitCompare = await compareFixture.invoke({
  operatorQuery: 'Nova',
  setQuery: 'compare-full',
  constraints: { compareEquipmentQueries: [{ query: 'compare-full-accessory-a', slot: 'accessory2' }] },
});
const implicitCompare = await compareFixture.invoke({
  operatorQuery: 'Nova',
  setQuery: 'compare-full',
  constraints: { compareEquipmentQueries: [{ query: 'compare-full-accessory-a' }] },
});
assert.equal(explicitCompare.state, 'READY');
assert.equal(explicitCompare.result.comparisons.length, 1);
assert.equal(explicitCompare.result.comparisons[0].slot, 'accessory2');
assert.deepEqual(implicitCompare.result.comparisons.map((comparison) => comparison.slot), ['accessory1', 'accessory2']);

// Every branch remains read-only even when its trusted inputs reject mutation.
const readonlyLibrary = libraryFrom(gearSet('readonly-full', { setEffects: ['strengthBoost', 'willBoost'], pieceEffects: ['strengthBoost', 'willBoost'] }));
const readonlyBefore = structuredClone(readonlyLibrary);
const readonlyFixture = createFixture({
  library: readonlyLibrary,
  references: [guideReference(completeGuideContent)],
  guideContent: completeGuideContent,
  frozen: true,
});
const readonly = await readonlyFixture.invoke({ operatorQuery: 'Nova', setQuery: 'readonly-full' });
assert.equal(readonly.state, 'READY', JSON.stringify(readonly));
assert.deepEqual(readonlyLibrary, readonlyBefore, 'service paths must not mutate the caller-owned source value');

console.log(JSON.stringify({
  ok: true,
  checks: [
    'guide-found-no-fallback',
    'partial-guide-preserves-proven-group',
    'guide-not-found-structured-evidence-and-conventions',
    'automatic-set-skips-incomplete-plan',
    'automatic-set-skips-constraints-emptied-set',
    'set-tie-needs-input',
    'four-piece-and-duplicate-policies',
    'plan-tie-ready-shortlist',
    'prior-digest-fresh-read-and-catalog-revision',
    'cross-session-digest-stability',
    'compare-explicit-and-implicit-slots',
    'read-only-inputs',
  ],
}));
