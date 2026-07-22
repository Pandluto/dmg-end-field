import { hashDefStableValue } from './stable-json.mjs';
import { normalizeDefCatalogIdentity, projectDefCatalogSafeValue } from './native-catalog-value.mjs';

export const DEF_EQUIPMENT_SLOT_FACTS = Object.freeze([
  { slot: 'armor', part: '护甲' },
  { slot: 'glove', part: '护手' },
  { slot: 'accessory1', part: '配件' },
  { slot: 'accessory2', part: '配件' },
]);

export const DEF_EQUIPMENT_THREE_PLUS_ONE_DUPLICATE_POLICY = Object.freeze({
  allowedAcrossDistinctCompatibleAccessorySlots: true,
  neverWithinOneSlot: true,
  rule: 'One stable accessory id may occupy accessory1 and accessory2 when the catalog marks it compatible with both slots. Every physical slot still contributes one set membership.',
});

const MAX_SEARCH_SPACE = 250_000;
const SLOT_ORDER = DEF_EQUIPMENT_SLOT_FACTS.map(({ slot }) => slot);
const PROFILE_DERIVATIONS = new Set(['guide', 'guide-partial', 'skill-analysis', 'guide-and-skill-analysis', 'combat-convention-and-skill-analysis', 'user']);
const PROFILE_KINDS = new Set(['primary-attribute', 'secondary-attribute', 'elemental-damage', 'skill-damage', 'general-damage', 'other']);

function equipmentSlots(part) {
  if (part === '护甲') return ['armor'];
  if (part === '护手') return ['glove'];
  if (part === '配件') return ['accessory1', 'accessory2'];
  return [];
}

function projectEquipment(equipment = {}, gearSet = {}) {
  const equipmentId = String(equipment.equipmentId || '').trim();
  return {
    domain: 'equipment',
    id: equipmentId,
    equipmentId,
    name: String(equipment.name || '').trim(),
    part: String(equipment.part || '').trim(),
    availableSlots: equipmentSlots(String(equipment.part || '')),
    gearSet: { id: String(gearSet.gearSetId || '').trim(), name: String(gearSet.name || '').trim() },
    ...(equipment.imgUrl ? { icon: String(equipment.imgUrl) } : {}),
    ...(equipment.fixedStat && typeof equipment.fixedStat === 'object'
      ? { fixedStat: projectDefCatalogSafeValue(equipment.fixedStat) }
      : {}),
    effects: projectDefCatalogSafeValue(equipment.effects || {}),
  };
}

function projectGearSet(gearSet = {}) {
  return {
    domain: 'equipment',
    kind: 'gear-set',
    id: String(gearSet.gearSetId || '').trim(),
    name: String(gearSet.name || '').trim(),
    ...(gearSet.buffId ? { buffId: String(gearSet.buffId) } : {}),
    ...(gearSet.imgUrl ? { icon: String(gearSet.imgUrl) } : {}),
    equipments: Object.values(gearSet.equipments || {})
      .filter((equipment) => equipment && typeof equipment === 'object')
      .map((equipment) => projectEquipment(equipment, gearSet)),
    threePieceBuffs: projectDefCatalogSafeValue({
      ...(gearSet.threePieceBuff ? { single: gearSet.threePieceBuff } : {}),
      ...(gearSet.threePieceBuffs || {}),
    }),
  };
}

/** Capture one immutable, safe equipment-catalog snapshot. */
export function buildDefEquipmentCatalogSnapshot({ library, storageKey, capturedAt = Date.now() } = {}) {
  let gearSets = Object.values(library?.gearSets || {})
    .filter((gearSet) => gearSet && typeof gearSet === 'object')
    .map(projectGearSet)
    .filter((gearSet) => gearSet.id && gearSet.name)
    .sort((left, right) => left.id.localeCompare(right.id));
  if (!gearSets.length) {
    return { ok: false, code: 'native-catalog-source-unavailable', message: 'The current equipment local library is unavailable or empty.', domain: 'equipment' };
  }
  const rawIdCounts = new Map();
  for (const item of gearSets.flatMap((gearSet) => gearSet.equipments)) {
    const rawId = String(item.equipmentId || '').trim();
    if (rawId) rawIdCounts.set(rawId, (rawIdCounts.get(rawId) || 0) + 1);
  }
  gearSets = gearSets.map((gearSet) => ({
    ...gearSet,
    equipments: gearSet.equipments.map((item) => {
      const rawId = String(item.equipmentId || '').trim();
      return { ...item, id: rawId && rawIdCounts.get(rawId) > 1 ? `${gearSet.id}:${rawId}` : rawId };
    }),
  }));
  const sourceValue = { domain: 'equipment', gearSets };
  return {
    ok: true,
    domain: 'equipment',
    source: {
      storageKey: String(storageKey || ''),
      revision: `sha256:${hashDefStableValue(sourceValue)}`,
      capturedAt,
    },
    gearSets,
    entities: gearSets.flatMap((gearSet) => gearSet.equipments),
  };
}

function candidateSummary(item, kind = 'equipment') {
  return kind === 'gear-set'
    ? { id: item.id, label: item.name, name: item.name, kind }
    : { id: item.id, label: item.name, name: item.name, kind, slots: item.availableSlots };
}

/** Resolve a gear set from the supplied snapshot and an explicit alias map. */
export function resolveDefEquipmentGearSet({ snapshot, query, aliasIndex = new Map() } = {}) {
  const normalized = normalizeDefCatalogIdentity(query);
  if (!normalized) return { ok: false, code: 'equipment-3plus1-set-query-required', message: 'A non-empty exact equipment set query is required.', candidates: [] };
  const aliases = aliasIndex instanceof Map ? aliasIndex : new Map(Object.entries(aliasIndex || {}));
  const aliasedIds = new Set([...aliases.entries()]
    .filter(([term]) => normalized === normalizeDefCatalogIdentity(term) || normalized.includes(normalizeDefCatalogIdentity(term)))
    .map(([, id]) => String(id)));
  const matches = (snapshot?.gearSets || []).filter((gearSet) => {
    const identities = [gearSet.id, gearSet.name].map(normalizeDefCatalogIdentity).filter(Boolean);
    return aliasedIds.has(gearSet.id) || identities.some((identity) => normalized === identity || normalized.includes(identity));
  });
  if (matches.length !== 1) {
    return {
      ok: false,
      code: matches.length ? 'equipment-3plus1-set-ambiguous' : 'equipment-3plus1-set-not-found',
      message: matches.length ? 'The set query resolves to multiple catalog sets; choose one exact set name.' : 'The materialized equipment catalog does not contain one exact matching set.',
      candidates: matches.map((item) => candidateSummary(item, 'gear-set')),
    };
  }
  return { ok: true, set: matches[0] };
}

/** Resolve an equipment entity from exactly one frozen snapshot. */
export function resolveDefEquipmentEntity({ snapshot, query } = {}) {
  const normalized = normalizeDefCatalogIdentity(query);
  if (!normalized) return { ok: false, code: 'equipment-query-required', message: 'A non-empty equipment query is required.', candidates: [] };
  const exact = (snapshot?.entities || []).filter((item) => [item.id, item.equipmentId, item.name]
    .map(normalizeDefCatalogIdentity).some((identity) => identity && identity === normalized));
  const matches = exact.length ? exact : (snapshot?.entities || []).filter((item) => [item.id, item.equipmentId, item.name]
    .map(normalizeDefCatalogIdentity).some((identity) => identity && normalized.includes(identity)));
  if (matches.length !== 1) {
    return {
      ok: false,
      code: matches.length ? 'equipment-query-ambiguous' : 'equipment-query-not-found',
      message: matches.length ? 'The equipment query resolves to multiple catalog entities.' : 'The equipment catalog has no matching entity.',
      candidates: matches.slice(0, 8).map((item) => candidateSummary(item)),
      candidateCount: matches.length,
    };
  }
  return { ok: true, entity: matches[0] };
}

export function validateDefEquipmentCatalogSnapshot(snapshot) {
  const issues = [];
  const ids = new Map();
  for (const item of snapshot?.entities || []) {
    if (!item.id || !item.name || !item.availableSlots?.length) {
      issues.push({
        code: 'equipment-catalog-identity-invalid', stableId: item.id || null, name: item.name || null, part: item.part || null,
        message: 'Every plannable equipment item requires a stable id, name, and canonical compatible slot.',
      });
      continue;
    }
    const prior = ids.get(item.id);
    if (prior) {
      issues.push({
        code: 'equipment-catalog-stable-id-duplicate', stableId: item.id,
        gearSetIds: [prior.gearSet?.id || null, item.gearSet?.id || null],
        message: 'A stable equipment id may identify only one catalog item.',
      });
    } else ids.set(item.id, item);
  }
  return issues.length
    ? { ok: false, code: 'equipment-3plus1-catalog-invalid', message: 'The equipment catalog contains invalid or duplicate typed identities; planning failed closed.', source: snapshot?.source, catalogIssues: issues.slice(0, 24) }
    : { ok: true };
}

/** Validate the legacy planner profile without reintroducing a REST copy. */
export function normalizeDefEquipmentThreePlusOneProfile(input = {}) {
  const raw = input?.characterProfile;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, code: 'equipment-3plus1-character-profile-required', message: 'A sourced characterProfile is required before ranking equipment.' };
  const characterId = typeof raw.characterId === 'string' ? raw.characterId.trim() : '';
  const derivation = typeof raw.derivation === 'string' ? raw.derivation.trim() : '';
  const evidenceRefs = Array.isArray(raw.evidenceRefs) ? [...new Set(raw.evidenceRefs.map((value) => typeof value === 'string' ? value.trim() : '').filter(Boolean))] : [];
  const keywords = Array.isArray(raw.keywords) ? [...new Set(raw.keywords.map((value) => typeof value === 'string' ? value.trim() : '').filter(Boolean))] : [];
  if (!characterId || !PROFILE_DERIVATIONS.has(derivation) || !evidenceRefs.length || !keywords.length) return { ok: false, code: 'equipment-3plus1-character-profile-incomplete', message: 'characterProfile requires characterId, a supported derivation, at least one evidenceRef, and explicit human-readable keywords.' };
  const typeKeys = Array.isArray(raw.preferenceTypeKeys) ? [...new Set(raw.preferenceTypeKeys.map((value) => typeof value === 'string' ? value.trim() : '').filter(Boolean))] : [];
  const rawGroups = Array.isArray(raw.preferenceGroups) ? raw.preferenceGroups : [];
  if ((typeKeys.length > 0) === (rawGroups.length > 0)) return { ok: false, code: 'equipment-3plus1-preference-shape-invalid', message: 'Provide exactly one ordered preference shape: preferenceTypeKeys or preferenceGroups.' };
  const validTypeKey = (value) => /^[A-Za-z][A-Za-z0-9._:-]{1,79}$/.test(value);
  let preferenceGroups;
  if (typeKeys.length) {
    if (typeKeys.length > 12 || typeKeys.some((value) => !validTypeKey(value))) return { ok: false, code: 'equipment-3plus1-preference-type-key-invalid', message: 'preferenceTypeKeys must contain 1-12 canonical effect type keys.' };
    preferenceGroups = typeKeys.map((typeKey) => ({ key: typeKey, label: typeKey, kind: 'other', acceptedTypeKeys: [typeKey] }));
  } else {
    if (rawGroups.length > 12) return { ok: false, code: 'equipment-3plus1-preference-group-invalid', message: 'preferenceGroups may contain at most 12 ordered groups.' };
    preferenceGroups = rawGroups.map((group) => ({ key: typeof group?.key === 'string' ? group.key.trim() : '', label: typeof group?.label === 'string' ? group.label.trim() : '', kind: typeof group?.kind === 'string' ? group.kind.trim() : 'other', acceptedTypeKeys: Array.isArray(group?.acceptedTypeKeys) ? [...new Set(group.acceptedTypeKeys.map((value) => typeof value === 'string' ? value.trim() : '').filter(Boolean))] : [] }));
    const keys = new Set();
    const invalid = preferenceGroups.some((group) => {
      if (!group.key || group.key.length > 80 || !group.label || group.label.length > 80 || !PROFILE_KINDS.has(group.kind) || !group.acceptedTypeKeys.length || group.acceptedTypeKeys.length > 8 || group.acceptedTypeKeys.some((value) => !validTypeKey(value)) || keys.has(group.key)) return true;
      keys.add(group.key);
      return false;
    });
    if (!preferenceGroups.length || invalid) return { ok: false, code: 'equipment-3plus1-preference-group-invalid', message: 'Each ordered preference group requires a unique key, label, supported kind, and 1-8 accepted canonical effect type keys.' };
  }
  const ownerByTypeKey = new Map();
  for (const group of preferenceGroups) for (const typeKey of group.acceptedTypeKeys) {
    const prior = ownerByTypeKey.get(typeKey);
    if (prior && prior !== group.key) return { ok: false, code: 'equipment-3plus1-preference-type-key-overlap', message: `Canonical effect type key ${typeKey} belongs to both ${prior} and ${group.key}; one fact may not count as two preference matches.`, typeKey, preferenceKeys: [prior, group.key] };
    ownerByTypeKey.set(typeKey, group.key);
  }
  return { ok: true, profile: { characterId, derivation, evidenceRefs, keywords, preferenceGroups } };
}

function itemsForSlot(items, slot) {
  return (items || []).filter((item) => item.availableSlots.includes(slot)).sort((left, right) => left.id.localeCompare(right.id));
}

function compactEffect(effect = {}, fallbackId = '') {
  return {
    effectId: String(effect.effectId || fallbackId || ''), label: String(effect.label || effect.name || ''), typeKey: String(effect.typeKey || ''),
    ...(effect.category ? { category: String(effect.category) } : {}), ...(effect.unit ? { unit: String(effect.unit) } : {}), ...(effect.raw ? { raw: String(effect.raw) } : {}),
  };
}

function compactPiece(item, slot = null) {
  return {
    stableId: item.id, equipmentId: item.equipmentId, name: item.name, part: item.part, ...(slot ? { slot } : {}),
    availableSlots: item.availableSlots, gearSet: item.gearSet, fixedStat: item.fixedStat || null,
    effects: Object.entries(item.effects || {}).sort(([left], [right]) => left.localeCompare(right)).map(([effectId, effect]) => compactEffect(effect, effectId)),
  };
}

function compactSet(gearSet) {
  return { id: gearSet.id, name: gearSet.name, ...(gearSet.buffId ? { buffId: gearSet.buffId } : {}) };
}

function topologySummary({ gearSet, entities, offSetSlot = null }) {
  const offSetSlotFact = DEF_EQUIPMENT_SLOT_FACTS.find((entry) => entry.slot === offSetSlot);
  const targetSlots = DEF_EQUIPMENT_SLOT_FACTS.filter((entry) => entry.slot !== offSetSlot);
  const targetCounts = Object.fromEntries(targetSlots.map(({ slot }) => [slot, itemsForSlot(gearSet.equipments, slot).length]));
  const plusOneCandidates = offSetSlot ? itemsForSlot(entities.filter((item) => item.gearSet?.id !== gearSet.id), offSetSlot) : [];
  const missingTargetSlots = targetSlots.filter(({ slot }) => targetCounts[slot] === 0).map(({ slot, part }) => ({ slot, part }));
  const missingOffSet = Boolean(offSetSlot && plusOneCandidates.length === 0);
  const targetCombinationCount = targetSlots.reduce((count, { slot }) => count * targetCounts[slot], 1);
  return {
    id: offSetSlot ? `off-set-${offSetSlot}` : 'all-target-set', status: missingTargetSlots.length || missingOffSet ? 'UNAVAILABLE' : 'AVAILABLE',
    targetSetMembershipCount: targetSlots.length, targetSlots: targetSlots.map(({ slot, part }) => ({ slot, part })),
    offSetSlot: offSetSlot ? { slot: offSetSlot, part: offSetSlotFact.part, excludedGearSetId: gearSet.id } : null,
    candidateCounts: { target: targetCounts, offSet: plusOneCandidates.length, combinations: targetCombinationCount * (offSetSlot ? plusOneCandidates.length : 1) },
    selectionReason: offSetSlot ? 'This topology has three target-set memberships and one off-set physical slot. It is an unranked search-space summary.' : 'This topology has four target-set memberships and therefore also satisfies a minimum-three-set constraint.',
    ...(missingTargetSlots.length ? { missingTargetSlots } : {}),
    ...(missingOffSet ? { missingOffSetCandidates: [{ slot: offSetSlot, part: offSetSlotFact.part, excludedGearSetId: gearSet.id }] } : {}),
  };
}

/** Build legacy facts from the same snapshot used by the recommendation service. */
export function buildDefEquipmentThreePlusOneFacts({ snapshot, targetSetId } = {}) {
  const validation = validateDefEquipmentCatalogSnapshot(snapshot);
  if (!validation.ok) return validation;
  const gearSet = (snapshot?.gearSets || []).find((entry) => entry.id === targetSetId);
  if (!gearSet) return { ok: false, code: 'equipment-3plus1-set-not-found', message: 'The materialized equipment catalog does not contain one exact matching set.' };
  const topologies = [...DEF_EQUIPMENT_SLOT_FACTS.map(({ slot }) => topologySummary({ gearSet, entities: snapshot.entities, offSetSlot: slot })), topologySummary({ gearSet, entities: snapshot.entities })];
  const availableTopologies = topologies.filter((topology) => topology.status === 'AVAILABLE');
  if (!availableTopologies.length) return { ok: false, code: 'equipment-3plus1-slot-structure-unavailable', message: 'The exact set and the remaining catalog cannot satisfy a minimum-three target-set constraint across the four physical slots.', source: snapshot.source, targetSet: compactSet(gearSet), topologies };
  return {
    ok: true, source: snapshot.source, targetSet: compactSet(gearSet), targetSetThreePieceBuffs: gearSet.threePieceBuffs || {},
    targetSetPieces: gearSet.equipments.map((item) => compactPiece(item)),
    targetSetCandidateIdsBySlot: Object.fromEntries(DEF_EQUIPMENT_SLOT_FACTS.map(({ slot }) => [slot, itemsForSlot(gearSet.equipments, slot).map((item) => item.id)])),
    topologyDefinition: 'At least three target-set memberships across armor, glove, accessory1, and accessory2. An item in each compatible physical slot contributes one membership, including the same compatible accessory id in both accessory slots.',
    minimumSupportedSetPieces: 3, duplicatePolicy: DEF_EQUIPMENT_THREE_PLUS_ONE_DUPLICATE_POLICY, topologies, topologiesExhaustive: true,
  };
}

function collectTypedEffects(value, pathPrefix = '', output = []) {
  if (!value || typeof value !== 'object') return output;
  if (!Array.isArray(value) && typeof value.typeKey === 'string' && value.typeKey.trim()) {
    output.push({ path: pathPrefix || 'effect', effectId: String(value.effectId || ''), label: String(value.label || value.name || ''), typeKey: value.typeKey.trim() });
    return output;
  }
  if (Array.isArray(value)) { value.forEach((entry, index) => collectTypedEffects(entry, `${pathPrefix}[${index}]`, output)); return output; }
  Object.keys(value).sort().forEach((key) => collectTypedEffects(value[key], pathPrefix ? `${pathPrefix}.${key}` : key, output));
  return output;
}

function rankFacts(facts, profile) {
  const groups = Array.isArray(profile?.preferenceGroups) ? profile.preferenceGroups : [];
  const matches = groups.flatMap((preference, priorityIndex) => {
    const matchedFacts = facts.filter((fact) => preference.acceptedTypeKeys.includes(fact.typeKey));
    return matchedFacts.length ? [{ key: preference.key, label: preference.label, kind: preference.kind, priorityIndex, weight: groups.length - priorityIndex, matchedFacts }] : [];
  });
  return {
    matchKeys: matches.map((match) => match.key), matchCount: matches.length, weightedScore: matches.reduce((score, match) => score + match.weight, 0),
    rankingBasis: matches.map((match) => ({ preferenceKey: match.key, preferenceLabel: match.label, preferenceKind: match.kind, priorityIndex: match.priorityIndex, weight: match.weight, facts: match.matchedFacts })),
  };
}

function allowsDuplicates(selection, policy) {
  const assignments = new Map();
  for (const entry of selection) assignments.set(entry.item.id, [...(assignments.get(entry.item.id) || []), entry]);
  for (const entries of assignments.values()) {
    if (entries.length < 2) continue;
    const slots = entries.map((entry) => entry.slot);
    const compatibleAccessoryPair = policy !== 'forbid' && entries.length === 2 && slots.includes('accessory1') && slots.includes('accessory2')
      && entries.every((entry) => entry.item.availableSlots.includes('accessory1') && entry.item.availableSlots.includes('accessory2'));
    if (!compatibleAccessoryPair) return false;
  }
  return true;
}

function enumerate(pools, visit, index = 0, selection = []) {
  if (index >= pools.length) { visit(selection); return; }
  const pool = pools[index];
  for (const item of pool.items) { selection.push({ slot: pool.slot, item }); enumerate(pools, visit, index + 1, selection); selection.pop(); }
}

function compareCandidates(left, right) {
  return right.qualifiedPieceCount - left.qualifiedPieceCount || right.weightedScore - left.weightedScore
    || right.coveredPreferenceCount - left.coveredPreferenceCount || right.setMembershipCount - left.setMembershipCount
    || left.stableSortKey.localeCompare(right.stableSortKey);
}

function businessTie(left, right) {
  return left.qualifiedPieceCount === right.qualifiedPieceCount && left.weightedScore === right.weightedScore
    && left.coveredPreferenceCount === right.coveredPreferenceCount && left.setMembershipCount === right.setMembershipCount;
}

function closeAlternative(best, candidate) {
  return candidate.qualifiedPieceCount === best.qualifiedPieceCount && candidate.coveredPreferenceCount === best.coveredPreferenceCount && best.weightedScore - candidate.weightedScore <= 1;
}

function normalizeConstraints(constraints = {}) {
  return {
    requiredStableIds: new Set(Array.isArray(constraints.requiredStableIds) ? constraints.requiredStableIds.map(String) : []),
    excludedStableIds: new Set(Array.isArray(constraints.excludedStableIds) ? constraints.excludedStableIds.map(String) : []),
    duplicateAccessoryPolicy: ['catalog-default', 'allow', 'forbid'].includes(constraints.duplicateAccessoryPolicy) ? constraints.duplicateAccessoryPolicy : 'catalog-default',
  };
}

/**
 * Exhaustively solve one selected set.  It deliberately returns business facts
 * rather than an HTTP or Tool envelope so both legacy primitives and recommend
 * consume this exact algorithm.
 */
export function buildDefEquipmentThreePlusOnePlan({ snapshot, targetSetId, profile, constraints = {}, shortlistLimit = 3, minimumSetPieces = 3 } = {}) {
  const validation = validateDefEquipmentCatalogSnapshot(snapshot);
  if (!validation.ok) return validation;
  const gearSet = (snapshot?.gearSets || []).find((entry) => entry.id === targetSetId);
  if (!gearSet) return { ok: false, code: 'equipment-3plus1-set-not-found', message: 'The materialized equipment catalog does not contain one exact matching set.' };
  const preferences = Array.isArray(profile?.preferenceGroups) ? profile.preferenceGroups : [];
  if (!preferences.length || preferences.length < 2) return { ok: false, code: 'equipment-3plus1-character-profile-incomplete', message: 'A profile with at least two verified preference groups is required before ranking equipment.' };
  if (![3, 4].includes(minimumSetPieces) || ![1, 2, 3].includes(shortlistLimit)) return { ok: false, code: 'equipment-3plus1-plan-constraint-invalid', message: 'minimumSetPieces must be 3 or 4 and shortlistLimit must be 1-3.' };
  const normalizedConstraints = normalizeConstraints(constraints);
  const targetBySlot = Object.fromEntries(SLOT_ORDER.map((slot) => [slot, itemsForSlot(gearSet.equipments, slot)]));
  const offSetBySlot = Object.fromEntries(SLOT_ORDER.map((slot) => [slot, itemsForSlot(snapshot.entities.filter((item) => item.gearSet?.id !== gearSet.id), slot)]));
  const topologies = [];
  if (minimumSetPieces <= 3) for (const offSetSlot of SLOT_ORDER) topologies.push({
    id: `off-set-${offSetSlot}`, setMembershipCount: 3,
    pools: SLOT_ORDER.map((slot) => ({ slot, items: slot === offSetSlot ? offSetBySlot[slot] : targetBySlot[slot] })),
  });
  topologies.push({ id: 'all-target-set', setMembershipCount: 4, pools: SLOT_ORDER.map((slot) => ({ slot, items: targetBySlot[slot] })) });
  const viableTopologies = topologies.filter((topology) => topology.pools.every((pool) => pool.items.length));
  const candidateCombinationCount = viableTopologies.reduce((total, topology) => total + topology.pools.reduce((count, pool) => count * pool.items.length, 1), 0);
  if (candidateCombinationCount > MAX_SEARCH_SPACE) return { ok: false, code: 'equipment-3plus1-search-space-too-large', message: 'The catalog search space exceeds the bounded exhaustive planner budget.', candidateCombinationCount, maximumCandidateCombinationCount: MAX_SEARCH_SPACE };
  const setBonusRank = rankFacts(collectTypedEffects(gearSet.threePieceBuffs || {}, 'targetSet.threePieceBuffs'), profile);
  const itemRanks = new Map(snapshot.entities.map((item) => [item.id, { compact: compactPiece(item), rank: rankFacts(collectTypedEffects(item.effects || {}, `equipment.${item.id}.effects`), profile) }]));
  const candidates = [];
  let enumeratedCandidateCount = 0;
  for (const topology of viableTopologies) enumerate(topology.pools, (selection) => {
    if (!allowsDuplicates(selection, normalizedConstraints.duplicateAccessoryPolicy)) return;
    if (selection.some(({ item }) => normalizedConstraints.excludedStableIds.has(item.id))) return;
    if ([...normalizedConstraints.requiredStableIds].some((id) => !selection.some(({ item }) => item.id === id))) return;
    enumeratedCandidateCount += 1;
    const rankedSelection = selection.map(({ slot, item }) => ({ slot, item, ranked: itemRanks.get(item.id) }));
    const qualifiedPieceCount = rankedSelection.filter((piece) => piece.ranked.rank.matchCount >= 2).length;
    const coveredKeys = new Set([...setBonusRank.matchKeys, ...rankedSelection.flatMap((piece) => piece.ranked.rank.matchKeys)]);
    const missing = [
      ...rankedSelection.filter((piece) => piece.ranked.rank.matchCount < 2).map((piece) => ({ code: 'piece-below-minimum-effect-match', slot: piece.slot, stableId: piece.item.id, actualMatchCount: piece.ranked.rank.matchCount, requiredMatchCount: 2 })),
      ...preferences.filter((group) => !coveredKeys.has(group.key)).map((group) => ({ code: 'profile-preference-unmatched', preferenceKey: group.key, preferenceLabel: group.label })),
    ];
    const duplicateAssignments = [];
    for (const piece of rankedSelection) {
      const slots = rankedSelection.filter((entry) => entry.item.id === piece.item.id).map((entry) => entry.slot);
      if (slots.length > 1 && !duplicateAssignments.some((entry) => entry.stableId === piece.item.id)) {
        duplicateAssignments.push({ stableId: piece.item.id, name: piece.item.name, slots });
      }
    }
    const candidate = {
      topologyId: topology.id, setMembershipCount: topology.setMembershipCount, selection: rankedSelection,
      duplicateAssignments,
      setBonusMatches: setBonusRank.rankingBasis, matchKeys: [...coveredKeys].sort(), coveredPreferenceCount: coveredKeys.size, qualifiedPieceCount,
      weightedScore: rankedSelection.reduce((score, piece) => score + piece.ranked.rank.weightedScore, 0) + setBonusRank.weightedScore,
      rankingBasis: { pieceEffectMatchesCountedPerPhysicalSlot: true, targetSetBonusMatchesCountedOnce: true, equipmentFixedStatUsedForCharacterPreference: false },
      missing, ambiguity: [], stableSortKey: rankedSelection.map((piece) => `${piece.slot}:${piece.item.id}`).join('|'),
    };
    candidates.push(candidate);
  });
  candidates.sort(compareCandidates);
  const leadingCandidate = candidates[0] || null;
  const tieCandidates = leadingCandidate ? candidates.filter((candidate) => businessTie(leadingCandidate, candidate)) : [];
  const chosen = leadingCandidate ? candidates.filter((candidate, index) => index === 0 || businessTie(leadingCandidate, candidate) || closeAlternative(leadingCandidate, candidate)).slice(0, shortlistLimit) : [];
  const tie = tieCandidates.length > 1 ? { code: 'top-ranking-tie', message: 'The leading plans are equal under the declared keyword/type-key scoring; stable ids only make output order deterministic.', candidateCount: tieCandidates.length, truncated: tieCandidates.length > shortlistLimit } : null;
  const shortlist = chosen.map(({ stableSortKey, selection, ...candidate }) => ({
    ...candidate,
    pieces: selection.map(({ slot, item, ranked }) => ({
      ...ranked.compact, slot, setMembership: item.gearSet?.id === gearSet.id, setMembershipContribution: item.gearSet?.id === gearSet.id ? 1 : 0,
      matchKeys: ranked.rank.matchKeys, matchCount: ranked.rank.matchCount, rankingBasis: ranked.rank.rankingBasis,
      missing: ranked.rank.matchCount < 2 ? [{ code: 'piece-below-minimum-effect-match', actualMatchCount: ranked.rank.matchCount, requiredMatchCount: 2 }] : [], ambiguity: [],
      selectionReason: `${item.gearSet?.id === gearSet.id ? 'Target-set' : 'Off-set'} ${slot} candidate matched ${ranked.rank.matchCount} verified profile groups${ranked.rank.matchCount < 2 ? ', below the required two-key acceptable threshold' : ''}.`,
    })),
  }));
  if (tie) shortlist.forEach((plan) => { if (businessTie({ ...plan, stableSortKey: plan.pieces.map((piece) => `${piece.slot}:${piece.stableId}`).join('|') }, leadingCandidate)) plan.ambiguity.push(tie); });
  return {
    ok: true, source: snapshot.source, targetSet: compactSet(gearSet), targetSetThreePieceBuffs: gearSet.threePieceBuffs || {}, profile,
    constraints: { minimumSetPieces, minimumMatchesPerPiece: 2, allowDuplicateCompatibleAccessories: normalizedConstraints.duplicateAccessoryPolicy !== 'forbid', physicalSlots: SLOT_ORDER },
    duplicatePolicy: DEF_EQUIPMENT_THREE_PLUS_ONE_DUPLICATE_POLICY,
    searchSpace: { topologyCount: viableTopologies.length, candidateCombinationCount, enumeratedCandidateCount, exhaustive: true, outputCandidateLimit: shortlistLimit, outputCandidateCount: shortlist.length },
    rankingBasis: { effectTypeKeysOnly: true, orderedPreferenceWeights: preferences.map((group, index) => ({ key: group.key, weight: preferences.length - index })), equipmentFixedStatExcluded: true, closeAlternativeRule: { sameQualifiedPieceCount: true, sameCoveredPreferenceCount: true, maximumWeightedScoreDeficit: 1 }, note: 'This is deterministic profile-keyword coverage, not a damage simulation or an inferred upgrade magnitude.' },
    shortlist, missing: shortlist[0]?.missing || [{ code: 'no-viable-loadout', message: 'No catalog assignment satisfies the requested set-membership and slot constraints.' }], ambiguity: shortlist[0]?.ambiguity || [], tieCandidateCount: tieCandidates.length,
  };
}

/** Rank all legal target sets using the same topology and planner constraints. */
export function buildDefEquipmentSetFitShortlist({ snapshot, profile, constraints = {}, minimumSetPieces = 3, shortlistLimit = 3 } = {}) {
  const validation = validateDefEquipmentCatalogSnapshot(snapshot);
  if (!validation.ok) return validation;
  const rankedSets = (snapshot?.gearSets || []).map((gearSet) => {
    const setBonusFacts = collectTypedEffects(gearSet.threePieceBuffs || {}, `gearSet.${gearSet.id}.threePieceBuffs`);
    const setBonusRank = rankFacts(setBonusFacts, profile);
    const plan = buildDefEquipmentThreePlusOnePlan({ snapshot, targetSetId: gearSet.id, profile, constraints, minimumSetPieces, shortlistLimit });
    const best = plan.ok ? plan.shortlist[0] : null;
    const eligible = Boolean(best && setBonusFacts.length && setBonusRank.matchCount);
    const covered = new Set([...setBonusRank.matchKeys, ...(best?.matchKeys || [])]);
    return {
      id: gearSet.id, name: gearSet.name, eligible,
      reasons: [...(!best ? [{ code: plan.code || 'minimum-three-slot-topology-unavailable' }] : []), ...(!setBonusFacts.length ? [{ code: 'typed-three-piece-buff-unavailable' }] : []), ...(setBonusFacts.length && !setBonusRank.matchCount ? [{ code: 'three-piece-buff-profile-unmatched' }] : [])],
      availableTopologyIds: best ? [best.topologyId] : [], threePieceBuffFacts: setBonusFacts, threePieceBuffMatchKeys: setBonusRank.matchKeys,
      coveredPreferenceKeys: [...covered].sort(), setBonusMatchCount: setBonusRank.matchCount,
      pieceMatchCount: best?.pieces.reduce((total, piece) => total + piece.matchCount, 0) || 0,
      _weightedScore: setBonusRank.weightedScore * 100 + (best?.weightedScore || 0),
    };
  }).sort((left, right) => Number(right.eligible) - Number(left.eligible) || right.setBonusMatchCount - left.setBonusMatchCount || right.coveredPreferenceKeys.length - left.coveredPreferenceKeys.length || right._weightedScore - left._weightedScore || left.id.localeCompare(right.id));
  const eligible = rankedSets.filter((set) => set.eligible);
  const best = eligible[0] || null;
  const ties = best ? eligible.filter((set) => set.setBonusMatchCount === best.setBonusMatchCount && set.coveredPreferenceKeys.length === best.coveredPreferenceKeys.length && set._weightedScore === best._weightedScore) : [];
  return { ok: true, source: snapshot.source, rankedSets: rankedSets.map(({ _weightedScore, ...set }) => set), shortlist: eligible.slice(0, shortlistLimit).map(({ _weightedScore, ...set }) => set), tieCandidates: ties.map((set) => candidateSummary(set, 'gear-set')), tieCandidateCount: ties.length };
}

export function createDefEquipmentPlanId({ targetSetId, pieces } = {}) {
  return `sha256:${hashDefStableValue({ targetSetId, pieces: SLOT_ORDER.map((slot) => ({ slot, stableId: pieces?.find((piece) => piece.slot === slot)?.stableId || null })) })}`;
}

export function buildDefEquipmentPlanDigest(value) {
  return `sha256:${hashDefStableValue(value)}`;
}
