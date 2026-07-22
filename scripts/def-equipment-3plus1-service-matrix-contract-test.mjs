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

function armorOnlySet(id, effectTypes, armorVariants = 1) {
  return {
    gearSetId: id,
    name: id,
    threePieceBuffs: {},
    equipments: Object.fromEntries(Array.from({ length: armorVariants }, (_, index) => [
      `armor-${index + 1}`,
      equipment(`${id}-armor-${String.fromCharCode(97 + index)}`, PART.armor, effectTypes),
    ])),
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
const threeGroupGuideContent = '## Nova \u88c5\u5907\n\u4f18\u5148\u529b\u91cf\u3001\u610f\u5fd7\u548c\u5bd2\u51b7\u4f24\u5bb3\u3002';
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
const insufficientOperator = Object.freeze({
  id: 'insufficient',
  name: 'Insufficient',
  profession: 'striker',
  mainStat: '\u529b\u91cf',
  subStat: '',
  element: '',
  skills: {},
});

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

// INSUFFICIENT_OPERATOR_EVIDENCE is a business UNRESOLVED, and a profile with
// fewer than two independent groups never reaches catalog capture or planning.
const insufficientFixture = createFixture({
  library: libraryFrom(gearSet('unused-insufficient-catalog')),
  operators: { insufficient: insufficientOperator },
});
const insufficient = await insufficientFixture.invoke({ operatorQuery: 'Insufficient', setQuery: 'unused-insufficient-catalog' });
assert.equal(insufficient.state, 'UNRESOLVED', JSON.stringify(insufficient));
assert.equal(insufficient.result, null);
assert.ok(insufficient.missing.some((entry) => entry.code === 'operator-secondary-attribute-missing'));
assert.equal(insufficientFixture.counters.catalog, 0, 'incomplete profiles must not enter catalog planning');

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

// An incomplete all-target plan can outrank a complete 3+1 plan on high-priority
// weights.  Once a complete plan exists, both explicit and automatic selection
// must rank only complete candidates; tie facts are therefore complete-plan facts.
const sameSetCoverageFixture = createFixture({
  library: libraryFrom(
    gearSet('coverage-target', {
      setEffects: ['strengthBoost'],
      pieceEffects: ['strengthBoost', 'willBoost'],
      accessoryVariants: 1,
    }),
    armorOnlySet('coverage-off-set', ['willBoost', 'iceDmgBonus'], 2),
  ),
  references: [guideReference(threeGroupGuideContent)],
  guideContent: threeGroupGuideContent,
});
const threeGroupProfile = {
  characterId: 'matrix',
  derivation: 'guide',
  evidenceRefs: ['guide-matrix-three-groups'],
  keywords: ['strength', 'will', 'ice'],
  preferenceGroups: [
    { key: 'strength', label: 'strength', kind: 'primary-attribute', acceptedTypeKeys: ['strengthBoost'] },
    { key: 'will', label: 'will', kind: 'secondary-attribute', acceptedTypeKeys: ['willBoost'] },
    { key: 'ice', label: 'ice', kind: 'elemental-damage', acceptedTypeKeys: ['iceDmgBonus'] },
  ],
};
const sameSetCoveragePlan = buildDefEquipmentThreePlusOnePlan({
  snapshot: sameSetCoverageFixture.snapshot(),
  targetSetId: 'coverage-target',
  profile: threeGroupProfile,
  shortlistLimit: 2,
});
assert.ok(sameSetCoveragePlan.completeLegalPlan, 'fixture must contain a lower-scoring complete 3+1 candidate');
assert.equal(sameSetCoveragePlan.shortlist[0].missing.length, 0, 'a complete candidate must outrank an incomplete all-target candidate');
assert.equal(sameSetCoveragePlan.tieCandidateCount, 2, 'tie count must describe complete legal candidates only');
assert.ok(sameSetCoveragePlan.shortlist.every((plan) => plan.missing.length === 0 && plan.ambiguity.some((entry) => entry.code === 'top-ranking-tie' && entry.candidateCount === 2)));
const sameSetExplicit = await sameSetCoverageFixture.invoke({ operatorQuery: 'Nova', setQuery: 'coverage-target', shortlistLimit: 2 });
const sameSetAutomatic = await sameSetCoverageFixture.invoke({ operatorQuery: 'Nova', shortlistLimit: 2 });
for (const response of [sameSetExplicit, sameSetAutomatic]) {
  assert.equal(response.state, 'READY', JSON.stringify(response));
  assert.equal(response.result.selectedSet.id, 'coverage-target');
  assert.equal(response.result.plans.length, 2);
  assert.ok(response.result.plans.every((plan) => plan.items[0].stableId.startsWith('coverage-off-set-armor-')));
  assert.ok(response.result.plans.every((plan) => plan.ambiguities.some((entry) => entry.field === 'plan' && entry.candidateCount === 2 && entry.truncated === false)));
}

// Off-set placement is permitted only when it strictly improves the complete
// plan comparator.  Equal business evidence retains the four-piece topology.
const strictProfile = {
  characterId: 'matrix',
  derivation: 'guide',
  evidenceRefs: ['strict-off-set'],
  keywords: ['strength', 'will', 'ice'],
  preferenceGroups: threeGroupProfile.preferenceGroups,
};
const strictTarget = gearSet('strict-target', {
  setEffects: ['iceDmgBonus'],
  pieceEffects: ['strengthBoost', 'willBoost'],
  accessoryVariants: 1,
});
const neutralOffSetSnapshot = buildDefEquipmentCatalogSnapshot({
  library: libraryFrom(strictTarget, armorOnlySet('strict-off-neutral', ['strengthBoost', 'willBoost'])),
  storageKey: 'strict-off-neutral',
  capturedAt: 0,
});
const neutralOffSetPlan = buildDefEquipmentThreePlusOnePlan({ snapshot: neutralOffSetSnapshot, targetSetId: 'strict-target', profile: strictProfile });
assert.equal(neutralOffSetPlan.shortlist[0].topologyId, 'all-target-set', 'an equal off-set candidate must not displace the four-piece plan');
const improvedOffSetSnapshot = buildDefEquipmentCatalogSnapshot({
  library: libraryFrom(strictTarget, armorOnlySet('strict-off-improved', ['strengthBoost', 'willBoost', 'iceDmgBonus'])),
  storageKey: 'strict-off-improved',
  capturedAt: 0,
});
const improvedOffSetPlan = buildDefEquipmentThreePlusOnePlan({ snapshot: improvedOffSetSnapshot, targetSetId: 'strict-target', profile: strictProfile });
assert.equal(improvedOffSetPlan.shortlist[0].topologyId, 'off-set-armor', 'an off-set candidate may displace four-piece only after a strict comparator improvement');

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

// Explicit set lookup distinguishes no trusted candidate from an actionable
// ambiguity, while catalog identity conflicts fail closed as Tool errors.
const setResolutionFixture = createFixture({
  library: libraryFrom(
    gearSet('near-alpha', { setEffects: ['strengthBoost', 'willBoost'], pieceEffects: ['strengthBoost', 'willBoost'] }),
    gearSet('near-beta', { setEffects: ['strengthBoost', 'willBoost'], pieceEffects: ['strengthBoost', 'willBoost'] }),
  ),
  references: [guideReference(completeGuideContent)],
  guideContent: completeGuideContent,
});
const noSetCandidate = await setResolutionFixture.invoke({ operatorQuery: 'Nova', setQuery: 'does-not-exist' });
assert.equal(noSetCandidate.state, 'UNRESOLVED', JSON.stringify(noSetCandidate));
assert.equal(noSetCandidate.result, null);
assert.ok(noSetCandidate.missing.some((entry) => entry.code === 'equipment-3plus1-set-not-found' && entry.field === 'setQuery'));
const nearSetCandidates = await setResolutionFixture.invoke({ operatorQuery: 'Nova', setQuery: 'near-alpha near-beta' });
assert.equal(nearSetCandidates.state, 'NEEDS_INPUT', JSON.stringify(nearSetCandidates));
assert.equal(nearSetCandidates.nextQuestion.field, 'setQuery');
assert.deepEqual(nearSetCandidates.nextQuestion.options.map((option) => option.id), ['near-alpha', 'near-beta']);

const duplicateIdentityFirst = gearSet('identity-first', { setEffects: ['strengthBoost', 'willBoost'], pieceEffects: ['strengthBoost', 'willBoost'] });
duplicateIdentityFirst.equipments.glove.equipmentId = duplicateIdentityFirst.equipments.armor.equipmentId;
const duplicateIdentityLibrary = libraryFrom(duplicateIdentityFirst);
const duplicateIdentityBefore = structuredClone(duplicateIdentityLibrary);
const identityConflictFixture = createFixture({
  library: duplicateIdentityLibrary,
  references: [guideReference(completeGuideContent)],
  guideContent: completeGuideContent,
  frozen: true,
});
const identityConflict = await identityConflictFixture.invoke({ operatorQuery: 'Nova', setQuery: 'identity-first' });
assert.equal(identityConflict.contract, 'DefEquipmentThreePlusOneRecommendationErrorV1');
assert.equal(identityConflict.failureStage, 'capture-catalog');
assert.equal(identityConflict.status, 409);
assert.deepEqual(duplicateIdentityLibrary, duplicateIdentityBefore, 'catalog errors must not mutate caller-owned trusted inputs');

// Required and excluded misses retain their distinct fields.  A resolved
// excluded item is absent from every physical slot of the returned plan.
const constraintsFixtureFull = createFixture({
  library: libraryFrom(gearSet('constraint-full', { setEffects: ['strengthBoost', 'willBoost'], pieceEffects: ['strengthBoost', 'willBoost'], accessoryVariants: 2 })),
  references: [guideReference(completeGuideContent)],
  guideContent: completeGuideContent,
});
const requiredMissing = await constraintsFixtureFull.invoke({
  operatorQuery: 'Nova', setQuery: 'constraint-full', constraints: { requiredEquipmentQueries: ['missing-required'] },
});
const excludedMissing = await constraintsFixtureFull.invoke({
  operatorQuery: 'Nova', setQuery: 'constraint-full', constraints: { excludedEquipmentQueries: ['missing-excluded'] },
});
for (const [response, field] of [[requiredMissing, 'constraints.requiredEquipmentQueries'], [excludedMissing, 'constraints.excludedEquipmentQueries']]) {
  assert.equal(response.state, 'UNRESOLVED', JSON.stringify(response));
  assert.equal(response.result, null);
  assert.ok(response.missing.some((entry) => entry.code === 'equipment-query-unresolved' && entry.field === field));
}
const excludedEverywhere = await constraintsFixtureFull.invoke({
  operatorQuery: 'Nova',
  setQuery: 'constraint-full',
  constraints: { excludedEquipmentQueries: ['constraint-full-accessory-a'] },
});
assert.equal(excludedEverywhere.state, 'READY', JSON.stringify(excludedEverywhere));
assert.ok(excludedEverywhere.result.plans.every((plan) => plan.items.every((item) => item.stableId !== 'constraint-full-accessory-a')));

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
assert.ok(planTie.result.plans.every((plan) => plan.ambiguities.some((entry) => entry.field === 'plan' && entry.candidateCount === 8 && entry.truncated === true && entry.candidates.length === 8)), 'each tied READY plan must preserve the complete candidate count and the truncation fact');
assert.ok(planTie.ambiguities.every((entry) => entry.field === 'plan' && entry.candidateCount === 8 && entry.truncated === true));

const shortlistBoundFixture = createFixture({
  library: libraryFrom(gearSet('shortlist-bound', { setEffects: ['strengthBoost', 'willBoost'], pieceEffects: ['strengthBoost', 'willBoost'], armorVariants: 4, accessoryVariants: 1 })),
  references: [guideReference(completeGuideContent)],
  guideContent: completeGuideContent,
});
const shortlistBound = await shortlistBoundFixture.invoke({ operatorQuery: 'Nova', setQuery: 'shortlist-bound', shortlistLimit: 3 });
assert.equal(shortlistBound.state, 'READY', JSON.stringify(shortlistBound));
assert.equal(shortlistBound.result.plans.length, 3, 'READY shortlist must obey the maximum output bound');
assert.ok(shortlistBound.result.plans.every((plan) => plan.ambiguities.some((entry) => entry.field === 'plan' && entry.candidateCount === 4 && entry.truncated === true)));

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

const comparisonRankedFixture = createFixture({
  library: libraryFrom(gearSet('comparison-ranked', { setEffects: ['strengthBoost', 'willBoost'], pieceEffects: ['strengthBoost', 'willBoost'], accessoryVariants: 2 })),
  references: [guideReference(completeGuideContent)],
  guideContent: completeGuideContent,
});
const whyNot = await comparisonRankedFixture.invoke({
  operatorQuery: 'Nova',
  setQuery: 'comparison-ranked',
  shortlistLimit: 1,
  constraints: { compareEquipmentQueries: [{ query: 'comparison-ranked-accessory-b', slot: 'accessory1' }] },
});
assert.equal(whyNot.state, 'READY', JSON.stringify(whyNot));
assert.deepEqual(whyNot.result.comparisons, [{
  query: 'comparison-ranked-accessory-b',
  candidate: { stableId: 'comparison-ranked-accessory-b', name: 'comparison-ranked-accessory-b' },
  slot: 'accessory1',
  decision: 'not-selected',
  selectedStableId: 'comparison-ranked-accessory-a',
  reasons: ['comparison-candidate-ranked-below-selected'],
  missing: [],
}]);

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

const readonlyPathsLibrary = libraryFrom(
  gearSet('readonly-path-a', { setEffects: ['strengthBoost', 'willBoost'], pieceEffects: ['strengthBoost', 'willBoost'] }),
  gearSet('readonly-path-b', { setEffects: ['strengthBoost', 'willBoost'], pieceEffects: ['strengthBoost', 'willBoost'] }),
);
const readonlyPathsBefore = structuredClone(readonlyPathsLibrary);
const readonlyPathsFixture = createFixture({
  library: readonlyPathsLibrary,
  references: [guideReference(completeGuideContent)],
  guideContent: completeGuideContent,
  frozen: true,
});
const readonlyPathsReady = await readonlyPathsFixture.invoke({ operatorQuery: 'Nova', setQuery: 'readonly-path-a' });
const readonlyPathsNeedsInput = await readonlyPathsFixture.invoke({ operatorQuery: 'Nova' });
const readonlyPathsUnresolved = await readonlyPathsFixture.invoke({
  operatorQuery: 'Nova',
  setQuery: 'readonly-path-a',
  constraints: { requiredEquipmentQueries: ['readonly-path-required-missing'] },
});
assert.equal(readonlyPathsReady.state, 'READY');
assert.equal(readonlyPathsNeedsInput.state, 'NEEDS_INPUT');
assert.equal(readonlyPathsUnresolved.state, 'UNRESOLVED');
assert.deepEqual(readonlyPathsLibrary, readonlyPathsBefore, 'READY, NEEDS_INPUT, and UNRESOLVED must all preserve trusted source inputs');

console.log(JSON.stringify({
  ok: true,
  checks: [
    'guide-found-no-fallback',
    'partial-guide-preserves-proven-group',
    'guide-not-found-structured-evidence-and-conventions',
    'insufficient-profile-fails-before-planning',
    'automatic-set-skips-incomplete-plan',
    'automatic-set-skips-constraints-emptied-set',
    'complete-plan-filtering-and-tie-semantics',
    'strict-off-set-improvement-only',
    'set-tie-needs-input',
    'set-resolution-and-catalog-conflict-terminals',
    'required-excluded-missing-and-global-exclusion',
    'four-piece-and-duplicate-policies',
    'plan-tie-and-shortlist-bound',
    'prior-digest-fresh-read-and-catalog-revision',
    'cross-session-digest-stability',
    'compare-explicit-implicit-and-why-not-evidence',
    'read-only-inputs-across-terminals',
  ],
}));
