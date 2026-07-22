import { createHash } from 'node:crypto';
import {
  compileGuidePlannerProfile,
  deriveOperatorBuildProfile,
  discoverOperatorBuildGuides,
  extractGuideBuildStrategy,
  mergePartialGuidePlannerProfile,
  operatorRequiresCombatConvention,
  resolveOperatorCatalogRecord,
} from './operator-build-evidence.mjs';
import {
  buildDefEquipmentCatalogSnapshot,
  buildDefEquipmentPlanDigest,
  buildDefEquipmentSetFitShortlist,
  buildDefEquipmentThreePlusOnePlan,
  createDefEquipmentPlanId,
  evaluateDefEquipmentThreePlusOneRequirement,
  resolveDefEquipmentEntity,
  resolveDefEquipmentGearSet,
  validateDefEquipmentCatalogSnapshot,
} from './equipment-3plus1-domain.mjs';
import { hashDefStableValue } from './stable-json.mjs';

const SUCCESS_CONTRACT = 'DefEquipmentThreePlusOneRecommendationV1';
const ERROR_CONTRACT = 'DefEquipmentThreePlusOneRecommendationErrorV1';
const SLOTS = ['armor', 'glove', 'accessory1', 'accessory2'];
const HASH_RE = /^sha256:[0-9a-f]{64}$/;
const ROOT_KEYS = new Set(['operatorQuery', 'setQuery', 'constraints', 'requirements', 'shortlistLimit', 'priorPlanDigest']);
const CONSTRAINT_KEYS = new Set(['requiredEquipmentQueries', 'excludedEquipmentQueries', 'compareEquipmentQueries', 'duplicateAccessoryPolicy', 'minimumSetPieces']);
const COMPARE_KEYS = new Set(['query', 'slot']);
const REQUIREMENT_KEYS = new Set(['kind', 'setEffect']);

function normalizeText(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sortSourceRefs(refs) {
  return refs.sort((left, right) => [left.kind, left.id, left.revision || '', left.sectionId || ''].join('\u0000')
    .localeCompare([right.kind, right.id, right.revision || '', right.sectionId || ''].join('\u0000')));
}

function failure({ code, failureStage, message, status = 500, retryable = false, sourceRevision, nextAction } = {}) {
  return {
    contract: ERROR_CONTRACT,
    code: code || 'equipment-3plus1-internal-error',
    failureStage: failureStage || 'build-evidence',
    retryable: retryable === true,
    nextAction: nextAction || (status === 400 ? 'FIX_INPUT' : retryable ? 'RETRY_FRESH_TURN' : 'REPORT_AND_STOP'),
    message: message || 'The evidence-backed equipment recommendation could not be completed.',
    ...(sourceRevision ? { sourceRevision } : {}),
    status,
  };
}

function businessEnvelope({ requestDigest, state, sourceRefs, completeness, missing = [], ambiguities = [], result = null, nextQuestion, supersedesPlanDigest } = {}) {
  return {
    protocolVersion: 1,
    contract: SUCCESS_CONTRACT,
    state,
    requestDigest,
    sourceRefs: sortSourceRefs(sourceRefs || []),
    completeness,
    missing,
    ambiguities,
    result,
    ...(nextQuestion ? { nextQuestion } : {}),
    ...(supersedesPlanDigest ? { supersedesPlanDigest } : {}),
  };
}

function normalizeQuery(value, field) {
  if (typeof value !== 'string') throw new Error(`${field} must be a string.`);
  const normalized = normalizeText(value);
  if (!normalized || normalized.length > 160) throw new Error(`${field} must contain 1-160 characters after normalization.`);
  return normalized;
}

function unique(values, keyFor = (value) => value) {
  const seen = new Set();
  return values.filter((value) => {
    const key = keyFor(value);
    return !seen.has(key) && (seen.add(key) || true);
  });
}

function parseInput(input) {
  if (!plainObject(input)) throw new Error('input must be an object.');
  for (const key of Object.keys(input)) if (!ROOT_KEYS.has(key)) throw new Error(`input.${key} is not supported.`);
  const operatorQuery = normalizeQuery(input.operatorQuery, 'operatorQuery');
  const setQuery = input.setQuery === undefined ? null : normalizeQuery(input.setQuery, 'setQuery');
  if (input.constraints !== undefined && !plainObject(input.constraints)) throw new Error('constraints must be an object.');
  const rawConstraints = input.constraints || {};
  for (const key of Object.keys(rawConstraints)) if (!CONSTRAINT_KEYS.has(key)) throw new Error(`constraints.${key} is not supported.`);
  const parseArray = (key, maximum) => {
    const raw = rawConstraints[key] === undefined ? [] : rawConstraints[key];
    if (!Array.isArray(raw) || raw.length > maximum) throw new Error(`constraints.${key} must contain 0-${maximum} items.`);
    return unique(raw.map((value, index) => normalizeQuery(value, `constraints.${key}[${index}]`)));
  };
  const requiredEquipmentQueries = parseArray('requiredEquipmentQueries', 4);
  const excludedEquipmentQueries = parseArray('excludedEquipmentQueries', 8);
  const rawCompare = rawConstraints.compareEquipmentQueries === undefined ? [] : rawConstraints.compareEquipmentQueries;
  if (!Array.isArray(rawCompare) || rawCompare.length > 8) throw new Error('constraints.compareEquipmentQueries must contain 0-8 items.');
  const compareEquipmentQueries = unique(rawCompare.map((entry, index) => {
    if (!plainObject(entry)) throw new Error(`constraints.compareEquipmentQueries[${index}] must be an object.`);
    for (const key of Object.keys(entry)) if (!COMPARE_KEYS.has(key)) throw new Error(`constraints.compareEquipmentQueries[${index}].${key} is not supported.`);
    const query = normalizeQuery(entry.query, `constraints.compareEquipmentQueries[${index}].query`);
    const slot = entry.slot === undefined ? null : entry.slot;
    if (slot !== null && !SLOTS.includes(slot)) throw new Error(`constraints.compareEquipmentQueries[${index}].slot is invalid.`);
    return { query, slot };
  }), (entry) => `${entry.query}\u0000${entry.slot || ''}`);
  const allQueryCount = new Set([...requiredEquipmentQueries, ...excludedEquipmentQueries, ...compareEquipmentQueries.map((entry) => entry.query)]).size;
  if (allQueryCount > 16) throw new Error('The normalized equipment query arrays may contain at most 16 distinct queries.');
  const duplicateAccessoryPolicy = rawConstraints.duplicateAccessoryPolicy === undefined ? 'catalog-default' : rawConstraints.duplicateAccessoryPolicy;
  if (!['catalog-default', 'allow', 'forbid'].includes(duplicateAccessoryPolicy)) throw new Error('constraints.duplicateAccessoryPolicy is invalid.');
  const minimumSetPieces = rawConstraints.minimumSetPieces === undefined ? 3 : rawConstraints.minimumSetPieces;
  if (!Number.isInteger(minimumSetPieces) || ![3, 4].includes(minimumSetPieces)) throw new Error('constraints.minimumSetPieces must be integer 3 or 4.');
  const rawRequirements = input.requirements === undefined ? [] : input.requirements;
  if (!Array.isArray(rawRequirements) || rawRequirements.length > 1) throw new Error('requirements must contain 0-1 controlled items.');
  const requirements = rawRequirements.map((requirement, index) => {
    if (!plainObject(requirement)) throw new Error(`requirements[${index}] must be an object.`);
    for (const key of Object.keys(requirement)) if (!REQUIREMENT_KEYS.has(key)) throw new Error(`requirements[${index}].${key} is not supported.`);
    if (requirement.kind !== 'operator-element-damage-triggers-set-effect') throw new Error(`requirements[${index}].kind is invalid.`);
    if (requirement.setEffect !== 'secondary') throw new Error(`requirements[${index}].setEffect is invalid.`);
    return { kind: requirement.kind, setEffect: requirement.setEffect };
  });
  const shortlistLimit = input.shortlistLimit === undefined ? 3 : input.shortlistLimit;
  if (!Number.isInteger(shortlistLimit) || ![1, 2, 3].includes(shortlistLimit)) throw new Error('shortlistLimit must be integer 1, 2, or 3.');
  const priorPlanDigest = input.priorPlanDigest === undefined ? null : input.priorPlanDigest;
  if (priorPlanDigest !== null && (typeof priorPlanDigest !== 'string' || !HASH_RE.test(priorPlanDigest))) throw new Error('priorPlanDigest must be sha256: followed by 64 lowercase hexadecimal characters.');
  const normalized = {
    operatorQuery, setQuery,
    constraints: { requiredEquipmentQueries, excludedEquipmentQueries, compareEquipmentQueries, duplicateAccessoryPolicy, minimumSetPieces },
    requirements,
    shortlistLimit, priorPlanDigest,
  };
  const requestIdentity = {
    contract: SUCCESS_CONTRACT, operatorQuery, setQuery,
    requiredEquipmentQueries: [...requiredEquipmentQueries].sort(), excludedEquipmentQueries: [...excludedEquipmentQueries].sort(),
    compareEquipmentQueries: compareEquipmentQueries.map(({ query, slot }) => ({ query, slot })),
    duplicateAccessoryPolicy, minimumSetPieces, shortlistLimit,
    ...(requirements.length ? { requirements } : {}),
  };
  const requestDigest = `sha256:${hashDefStableValue(requestIdentity)}`;
  return { input: normalized, requestDigest };
}

function ambiguity(field, candidates, kind) {
  const all = Array.isArray(candidates) ? candidates : [];
  return {
    field, candidateCount: all.length, truncated: all.length > 8,
    candidates: all.slice(0, 8).map((candidate) => ({ id: candidate.id, label: candidate.label || candidate.name || candidate.id, kind: candidate.kind || kind })),
  };
}

function question(field, candidates, prompt) {
  return { field, prompt, options: candidates.slice(0, 8).map((candidate) => ({ id: candidate.id, label: candidate.label || candidate.name || candidate.id })) };
}

function profileEvidenceRefs(profile, sourceRefs) {
  const refs = [
    ...(Array.isArray(profile?.evidenceRefs) ? profile.evidenceRefs.map((ref) => String(ref || '').trim()).filter(Boolean) : []),
    ...sortSourceRefs([...(sourceRefs || [])]).map((ref) => [
      ref.kind,
      ref.id,
      ref.sectionId,
      ref.revision,
    ].filter(Boolean).join(':')),
  ];
  return [...new Set(refs)].sort();
}

function missing(code, field, message) {
  return { code, field, message };
}

function guideContentHash(content) {
  return createHash('sha256').update(String(content || '')).digest('hex');
}

function portFailure(stage, value, sourceRevision) {
  return failure({
    code: value?.code || 'equipment-3plus1-port-result-invalid', failureStage: stage,
    message: value?.message || `The trusted ${stage} source returned an invalid result.`,
    status: value?.status === 409 ? 409 : 500, sourceRevision,
  });
}

function activeCatalogReaderFailure(error) {
  const code = typeof error?.code === 'string' ? error.code.trim() : '';
  if (code !== 'BLOCKED_DATA_CONTRACT' && !/^(?:active-game-catalog-|catalog-)/.test(code)) return null;
  return failure({
    code,
    failureStage: 'capture-catalog',
    message: error instanceof Error ? error.message : 'The selected game catalog could not be read.',
    status: 409,
    retryable: error?.retryable === true,
    nextAction: error?.nextAction,
  });
}

async function resolveProfile(ports, operator, setQuery) {
  const references = await ports.loadGuideReferences();
  if (!Array.isArray(references)) return { error: portFailure('resolve-profile') };
  const discovery = discoverOperatorBuildGuides(references, { id: operator.id, name: operator.name }, { goal: 'damage', setQuery: setQuery || '' });
  let guide = null;
  let strategy = null;
  let effectiveState = discovery.state;
  let guideRef = null;
  if (effectiveState === 'GUIDE_FOUND' || effectiveState === 'PARTIAL_GUIDE_FOUND') {
    const candidate = discovery.candidates?.[0];
    const sectionId = candidate?.exactReadPolicy?.requiredSectionId || candidate?.recommendedSection?.sectionId;
    if (!candidate?.referenceId || !sectionId) return { error: portFailure('resolve-profile', { code: 'operator-build-guide-shape-invalid', message: 'Guide discovery did not produce one exact readable section.' }) };
    const section = await ports.readGuideSection({ referenceId: candidate.referenceId, sectionId });
    if (!plainObject(section) || section.ok === false || typeof section.content !== 'string') return { error: portFailure('resolve-profile', section) };
    const contentHash = guideContentHash(section.content);
    strategy = extractGuideBuildStrategy(section.content, { evidenceRef: `guide-sha256:${contentHash}`, setQuery: setQuery || '' });
    if (section.truncated || !strategy.sufficientForPlanner) effectiveState = 'PARTIAL_GUIDE_FOUND';
    guide = { contentHash, strategy, contextScope: candidate.contextScope || 'operator-general' };
    guideRef = { kind: 'guide', id: String(section.referenceId || candidate.referenceId), sectionId: String(section.section?.sectionId || sectionId), revision: `sha256:${contentHash}` };
  }
  if (effectiveState === 'GUIDE_FOUND') {
    const plannerProfile = compileGuidePlannerProfile(operator.id, strategy, guide.contentHash);
    if (plannerProfile.preferenceGroups.length < 2) return { unresolved: [missing('operator-build-guide-profile-incomplete', 'profile.preferenceGroups', 'The exact guide does not prove at least two independent preference groups.')], sourceRefs: guideRef ? [guideRef] : [] };
    return { profile: plannerProfile, guideState: effectiveState, sourceRefs: guideRef ? [guideRef] : [] };
  }
  let conventionBundle = null;
  const sourceRefs = guideRef ? [guideRef] : [];
  if (operatorRequiresCombatConvention(operator)) {
    conventionBundle = await ports.resolveCombatConventions({ entities: [operator.id, operator.name, operator.profession], intents: ['operator-fit', 'weapon-fit'], terms: ['damage'] });
    if (!plainObject(conventionBundle) || conventionBundle.ok === false) return { error: portFailure('resolve-profile', conventionBundle) };
    if (conventionBundle.state !== 'READY') return { unresolved: [missing('operator-combat-convention-required', 'conventionBundle', 'Reviewed combat conventions are insufficient for this support-role profile.')], sourceRefs };
    for (const rule of conventionBundle.rules || []) sourceRefs.push({ kind: 'convention', id: String(rule.ruleId || rule.id || 'reviewed-convention'), revision: conventionBundle.bundleHash || undefined });
  }
  let profile = deriveOperatorBuildProfile(operator, { guideState: effectiveState, guideResolutionId: '', goal: 'damage', conventionBundle });
  if (effectiveState === 'PARTIAL_GUIDE_FOUND') profile = mergePartialGuidePlannerProfile(profile, {
    guideState: effectiveState, guidePreferenceGroups: strategy?.preferenceGroups || [], guideContextScope: guide?.contextScope || null, guideContentHash: guide?.contentHash || null,
  });
  if (profile.state !== 'PROFILE_READY' || !profile.plannerProfile || profile.plannerProfile.preferenceGroups.length < 2) {
    return { unresolved: (profile.missing || []).map((entry) => missing(entry.code || 'operator-profile-unresolved', entry.field || 'profile', 'The current trusted operator sources cannot prove this preference.')), sourceRefs };
  }
  return { profile: profile.plannerProfile, guideState: effectiveState, sourceRefs };
}

function resolveSelectionConstraint(snapshot, query, field) {
  const resolved = resolveDefEquipmentEntity({ snapshot, query });
  if (resolved.ok) return { resolved: resolved.entity };
  if (resolved.code === 'equipment-query-ambiguous') return { ambiguity: ambiguity(field, resolved.candidates, 'equipment') };
  return { unresolved: missing('equipment-query-unresolved', field, `No trusted catalog entity resolves “${query}”.`) };
}

function comparisonsFor(compareQueries, snapshot, firstPlan) {
  const comparisons = [];
  let partial = false;
  for (const entry of compareQueries) {
    const resolved = resolveDefEquipmentEntity({ snapshot, query: entry.query });
    if (!resolved.ok) {
      comparisons.push({ query: entry.query, candidate: null, slot: null, decision: 'unresolved', reasons: [resolved.code === 'equipment-query-ambiguous' ? 'comparison-ambiguous' : 'comparison-candidate-unresolved'], missing: [missing(resolved.code, 'constraints.compareEquipmentQueries', 'The comparison candidate cannot be resolved in the frozen catalog.')] });
      partial = true;
      continue;
    }
    const slots = entry.slot ? [entry.slot] : SLOTS.filter((slot) => resolved.entity.availableSlots.includes(slot));
    if (!slots.length) {
      comparisons.push({ query: entry.query, candidate: { stableId: resolved.entity.id, name: resolved.entity.name }, slot: entry.slot || null, decision: 'unresolved', reasons: ['comparison-slot-incompatible'], missing: [missing('comparison-slot-incompatible', 'constraints.compareEquipmentQueries', 'The comparison candidate is incompatible with the requested physical slot.')] });
      partial = true;
      continue;
    }
    for (const slot of slots) {
      const selected = firstPlan.items.find((item) => item.slot === slot);
      const compatible = resolved.entity.availableSlots.includes(slot);
      const selectedCandidate = selected?.stableId === resolved.entity.id;
      comparisons.push({
        query: entry.query, candidate: { stableId: resolved.entity.id, name: resolved.entity.name }, slot,
        ...(selectedCandidate ? { decision: 'selected', reasons: ['comparison-candidate-selected'] }
          : compatible ? { decision: 'not-selected', selectedStableId: selected?.stableId, reasons: ['comparison-candidate-ranked-below-selected'] }
            : { decision: 'unresolved', reasons: ['comparison-slot-incompatible'] }),
        missing: compatible ? [] : [missing('comparison-slot-incompatible', 'constraints.compareEquipmentQueries', 'The comparison candidate is incompatible with the requested physical slot.')],
      });
      if (!compatible) partial = true;
    }
  }
  return { comparisons, partial };
}

/**
 * Create the Spec 9 one-turn, read-only 3+1 recommendation service.  The
 * ports are trusted source readers only; they never accept plans, tokens,
 * provider prose, or model-facing Tool exports.
 */
export function createDefEquipment3Plus1RecommendationService(ports = {}) {
  const requiredPorts = ['readOperatorCatalog', 'loadGuideReferences', 'readGuideSection', 'resolveCombatConventions', 'readEquipmentLibrarySource', 'readGearSetAliasIndex'];
  for (const key of requiredPorts) if (typeof ports[key] !== 'function') throw new TypeError(`Recommendation Service requires ports.${key}().`);
  return {
    async recommend({ sessionId, turnId, input } = {}) {
      let requestDigest = null;
      let catalogRevision = null;
      try {
        let parsed;
        try { parsed = parseInput(input); } catch (error) { return failure({ code: 'equipment-3plus1-input-invalid', failureStage: 'validate-input', message: error instanceof Error ? error.message : String(error), status: 400 }); }
        ({ requestDigest } = parsed);
        if (!normalizeText(sessionId) || !normalizeText(turnId)) return failure({ code: 'equipment-3plus1-session-identity-required', failureStage: 'authorize-session', message: 'A registered session id and current turn id are required.', status: 403 });
        const normalizedInput = parsed.input;
        const operatorCatalog = await ports.readOperatorCatalog();
        if (!plainObject(operatorCatalog)) return portFailure('resolve-operator');
        const resolvedOperator = resolveOperatorCatalogRecord(operatorCatalog, normalizedInput.operatorQuery);
        if (!resolvedOperator.ok) {
          if (resolvedOperator.code === 'operator-build-operator-ambiguous') {
            const candidates = resolvedOperator.candidates || [];
            const item = ambiguity('operatorQuery', candidates.map((entry) => ({ ...entry, label: entry.name, kind: 'operator' })), 'operator');
            return businessEnvelope({ requestDigest, state: 'NEEDS_INPUT', completeness: 'partial', ambiguities: [item], nextQuestion: question('operatorQuery', item.candidates, 'Which operator did you mean?'), sourceRefs: [] });
          }
          return businessEnvelope({ requestDigest, state: 'UNRESOLVED', completeness: 'partial', missing: [missing(resolvedOperator.code || 'operator-unresolved', 'operatorQuery', 'The trusted operator catalog cannot resolve this operator.')], sourceRefs: [] });
        }
        const operator = { ...resolvedOperator.operator, id: String(resolvedOperator.id || resolvedOperator.operator.id || ''), name: String(resolvedOperator.operator.name || '') };
        const profileResolution = await resolveProfile(ports, operator, normalizedInput.setQuery);
        if (profileResolution.error) return profileResolution.error;
        if (profileResolution.unresolved) return businessEnvelope({ requestDigest, state: 'UNRESOLVED', completeness: 'partial', missing: profileResolution.unresolved, sourceRefs: profileResolution.sourceRefs || [] });
        const source = await ports.readEquipmentLibrarySource();
        if (!plainObject(source) || !plainObject(source.library) || typeof source.storageKey !== 'string') return portFailure('capture-catalog');
        const snapshot = buildDefEquipmentCatalogSnapshot({ library: source.library, storageKey: source.storageKey, capturedAt: 0 });
        if (!snapshot.ok) return failure({ code: snapshot.code, failureStage: 'capture-catalog', message: snapshot.message, status: 409 });
        catalogRevision = snapshot.source.revision;
        const catalogValidation = validateDefEquipmentCatalogSnapshot(snapshot);
        if (!catalogValidation.ok) return failure({ code: catalogValidation.code, failureStage: 'capture-catalog', message: catalogValidation.message, status: 409, sourceRevision: catalogRevision });
        const aliasIndex = await ports.readGearSetAliasIndex();
        if (!(aliasIndex instanceof Map) && !plainObject(aliasIndex)) return portFailure('capture-catalog', null, catalogRevision);
        // Explicit set identity precedes required/excluded identity under the
        // one-question contract: operator, set, required, excluded.
        let selectedSet = null;
        if (normalizedInput.setQuery) {
          const resolved = resolveDefEquipmentGearSet({ snapshot, query: normalizedInput.setQuery, aliasIndex });
          if (!resolved.ok) {
            if (resolved.code === 'equipment-3plus1-set-ambiguous') {
              const item = ambiguity('setQuery', resolved.candidates, 'gear-set');
              return businessEnvelope({ requestDigest, state: 'NEEDS_INPUT', completeness: 'partial', ambiguities: [item], nextQuestion: question('setQuery', item.candidates, 'Which equipment set did you mean?'), sourceRefs: profileResolution.sourceRefs });
            }
            return businessEnvelope({ requestDigest, state: 'UNRESOLVED', completeness: 'partial', missing: [missing(resolved.code, 'setQuery', resolved.message)], sourceRefs: profileResolution.sourceRefs });
          }
          selectedSet = resolved.set;
        }
        const required = [];
        const excluded = [];
        for (const query of normalizedInput.constraints.requiredEquipmentQueries) {
          const entry = resolveSelectionConstraint(snapshot, query, 'constraints.requiredEquipmentQueries');
          if (entry.ambiguity) return businessEnvelope({ requestDigest, state: 'NEEDS_INPUT', completeness: 'partial', ambiguities: [entry.ambiguity], nextQuestion: question(entry.ambiguity.field, entry.ambiguity.candidates, 'Which required equipment did you mean?'), sourceRefs: profileResolution.sourceRefs });
          if (entry.unresolved) return businessEnvelope({ requestDigest, state: 'UNRESOLVED', completeness: 'partial', missing: [entry.unresolved], sourceRefs: profileResolution.sourceRefs });
          required.push(entry.resolved);
        }
        for (const query of normalizedInput.constraints.excludedEquipmentQueries) {
          const entry = resolveSelectionConstraint(snapshot, query, 'constraints.excludedEquipmentQueries');
          if (entry.ambiguity) return businessEnvelope({ requestDigest, state: 'NEEDS_INPUT', completeness: 'partial', ambiguities: [entry.ambiguity], nextQuestion: question(entry.ambiguity.field, entry.ambiguity.candidates, 'Which excluded equipment did you mean?'), sourceRefs: profileResolution.sourceRefs });
          if (entry.unresolved) return businessEnvelope({ requestDigest, state: 'UNRESOLVED', completeness: 'partial', missing: [entry.unresolved], sourceRefs: profileResolution.sourceRefs });
          excluded.push(entry.resolved);
        }
        const requiredIds = [...new Set(required.map((entry) => entry.id))];
        const excludedIds = [...new Set(excluded.map((entry) => entry.id))];
        const conflict = requiredIds.find((id) => excludedIds.includes(id));
        if (conflict) return failure({ code: 'equipment-3plus1-required-excluded-conflict', failureStage: 'resolve-constraints', message: `Equipment ${conflict} is both required and excluded.`, status: 400, sourceRevision: catalogRevision });
        const planConstraints = { requiredStableIds: requiredIds, excludedStableIds: excludedIds, duplicateAccessoryPolicy: normalizedInput.constraints.duplicateAccessoryPolicy };
        if (!selectedSet) {
          const setChoice = buildDefEquipmentSetFitShortlist({ snapshot, profile: profileResolution.profile, constraints: planConstraints, minimumSetPieces: normalizedInput.constraints.minimumSetPieces, shortlistLimit: normalizedInput.shortlistLimit });
          if (!setChoice.ok) return failure({ code: setChoice.code, failureStage: 'resolve-set', message: setChoice.message, status: 409, sourceRevision: catalogRevision });
          if (!setChoice.shortlist.length) return businessEnvelope({ requestDigest, state: 'UNRESOLVED', completeness: 'partial', missing: [missing('no-eligible-equipment-set', 'setQuery', 'No catalog set can prove a legal 3+1 topology for the current evidence and constraints.')], sourceRefs: profileResolution.sourceRefs });
          if (setChoice.tieCandidateCount > 1) {
            const item = ambiguity('setQuery', setChoice.tieCandidates, 'gear-set');
            return businessEnvelope({ requestDigest, state: 'NEEDS_INPUT', completeness: 'partial', ambiguities: [item], nextQuestion: question('setQuery', item.candidates, 'These equipment sets are tied under the declared evidence. Which one should be used?'), sourceRefs: profileResolution.sourceRefs });
          }
          selectedSet = snapshot.gearSets.find((entry) => entry.id === setChoice.shortlist[0].id);
        }
        const catalogSourceRef = { kind: 'catalog', id: source.storageKey, revision: catalogRevision };
        const requirementSourceRefs = normalizedInput.requirements.map((requirement) => ({
          kind: 'user-constraint',
          id: `requirement:${requirement.kind}:${requirement.setEffect}`,
        }));
        const requirementEvidence = [];
        for (const requirement of normalizedInput.requirements) {
          const evaluation = evaluateDefEquipmentThreePlusOneRequirement({ operator, gearSet: selectedSet, requirement });
          if (!evaluation.ok) {
            return businessEnvelope({
              requestDigest,
              state: 'UNRESOLVED',
              completeness: 'partial',
              missing: [missing(evaluation.code, evaluation.field, evaluation.message)],
              sourceRefs: [...profileResolution.sourceRefs, catalogSourceRef, ...requirementSourceRefs],
            });
          }
          requirementEvidence.push(evaluation.evidence);
        }
        const planned = buildDefEquipmentThreePlusOnePlan({ snapshot, targetSetId: selectedSet.id, profile: profileResolution.profile, constraints: planConstraints, shortlistLimit: normalizedInput.shortlistLimit, minimumSetPieces: normalizedInput.constraints.minimumSetPieces });
        if (!planned.ok) return failure({ code: planned.code, failureStage: planned.code === 'equipment-3plus1-search-space-too-large' ? 'solve-plan' : 'validate-facts', message: planned.message, status: 409, sourceRevision: catalogRevision });
        if (!planned.shortlist.length || planned.missing.length) return businessEnvelope({ requestDigest, state: 'UNRESOLVED', completeness: 'partial', missing: planned.missing.map((entry) => missing(entry.code, entry.slot || entry.preferenceKey || 'plan', entry.message || 'The current catalog and profile cannot prove a complete legal plan.')), sourceRefs: profileResolution.sourceRefs });
        const profileHash = `sha256:${hashDefStableValue(profileResolution.profile)}`;
        const selectedSetEvidence = {
          id: selectedSet.id, name: selectedSet.name,
          matchKeys: planned.shortlist[0].setBonusMatches.map((entry) => entry.preferenceKey),
          rankingBasis: planned.shortlist[0].setBonusMatches,
        };
        const plans = planned.shortlist.map((candidate) => ({
          planId: createDefEquipmentPlanId({ targetSetId: selectedSet.id, pieces: candidate.pieces }),
          items: SLOTS.map((slot) => candidate.pieces.find((piece) => piece.slot === slot)).map((piece) => ({
            stableId: piece.stableId, name: piece.name, slot: piece.slot, setId: piece.gearSet?.id || null,
            matchKeys: [...piece.matchKeys].sort(), rankingBasis: piece.rankingBasis,
          })),
          setMembershipCount: candidate.setMembershipCount,
          missing: candidate.missing.map((entry) => missing(entry.code, entry.slot || entry.preferenceKey || 'plan', entry.message || 'A ranking fact is missing.')),
          ambiguities: candidate.ambiguity.map((entry) => ({
            field: 'plan',
            candidateCount: Number.isInteger(entry.candidateCount) && entry.candidateCount >= 0 ? entry.candidateCount : 0,
            truncated: entry.truncated === true,
            candidates: Array.from({ length: Math.min(Number.isInteger(entry.candidateCount) && entry.candidateCount >= 0 ? entry.candidateCount : 0, 8) }, (_, index) => ({ id: String(index + 1), label: 'Tied plan', kind: 'plan' })),
          })),
        }));
        const comparisons = comparisonsFor(normalizedInput.constraints.compareEquipmentQueries, snapshot, plans[0]);
        const planAmbiguities = plans.flatMap((plan) => plan.ambiguities);
        const sourceRefs = [
          ...profileResolution.sourceRefs,
          catalogSourceRef,
          ...requirementSourceRefs,
          ...requiredIds.map((id) => ({ kind: 'user-constraint', id: `required:${id}` })),
          ...excludedIds.map((id) => ({ kind: 'user-constraint', id: `excluded:${id}` })),
        ];
        const result = {
          operator: { id: operator.id, name: operator.name },
          profileEvidence: {
            state: profileResolution.guideState,
            profileHash,
            preferenceGroups: profileResolution.profile.preferenceGroups,
            evidenceRefs: profileEvidenceRefs(profileResolution.profile, profileResolution.sourceRefs),
          },
          catalogEvidence: { revision: catalogRevision, exhaustive: true }, selectedSet: selectedSetEvidence, plans, comparisons: comparisons.comparisons,
          ...(requirementEvidence.length ? { requirementEvidence } : {}),
          planDigest: null,
        };
        result.planDigest = buildDefEquipmentPlanDigest({ requestDigest, operatorId: operator.id, profileHash, catalogRevision, selectedSet: selectedSetEvidence, plans });
        return businessEnvelope({ requestDigest, state: 'READY', completeness: comparisons.partial || planAmbiguities.length ? 'partial' : 'complete', sourceRefs, ambiguities: planAmbiguities, result, supersedesPlanDigest: normalizedInput.priorPlanDigest || undefined });
      } catch (error) {
        const catalogFailure = activeCatalogReaderFailure(error);
        if (catalogFailure) return catalogFailure;
        return failure({ code: 'equipment-3plus1-internal-error', failureStage: catalogRevision ? 'build-evidence' : 'resolve-profile', message: error instanceof Error ? error.message : String(error), sourceRevision: catalogRevision });
      }
    },
  };
}
