import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const RULE_BLOCK_PATTERN = /```def-convention\s*\n([\s\S]*?)\n```/g;
const CERTAINTY_VALUES = new Set(['deterministic', 'high-probability', 'low-probability', 'unknown']);
const MAX_RULES = 64;
const MAX_BUNDLE_RULES = 24;
const SUPPORT_BUILD_INTENT_FAMILY = Object.freeze(['operator-fit', 'weapon-fit', 'support-build']);

function normalized(value) {
  return String(value || '').normalize('NFKC').trim().toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function stringList(value, maximum = 32) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => String(entry || '').trim()).filter(Boolean))].slice(0, maximum);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().flatMap((key) => (
    value[key] === undefined ? [] : [[key, canonicalize(value[key])]]
  )));
}

function canonicalHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function compactPreference(raw = {}, ruleId = '') {
  const acceptedTypeKeys = stringList(raw.acceptedTypeKeys, 8);
  const key = String(raw.key || '').trim();
  const label = String(raw.label || '').trim();
  if (!key || !label || !acceptedTypeKeys.length) return null;
  return {
    key,
    label,
    kind: String(raw.kind || 'other').trim() || 'other',
    acceptedTypeKeys,
    priority: Number.isFinite(Number(raw.priority)) ? Number(raw.priority) : 100,
    evidenceRefs: [`convention:${ruleId}`],
  };
}

function normalizeRule(raw, source) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${source}: convention rule must be one JSON object`);
  const ruleId = String(raw.ruleId || '').trim();
  const title = String(raw.title || '').trim();
  const entities = stringList(raw.entities);
  const intents = stringList(raw.intents, 16);
  const whenAllOf = stringList(raw.when?.allOf);
  const then = stringList(raw.then);
  const certainty = String(raw.certainty || '').trim();
  if (!/^[a-z0-9][a-z0-9._-]{2,119}$/i.test(ruleId)) throw new Error(`${source}: invalid ruleId ${ruleId || '<empty>'}`);
  if (!title || !entities.length || !intents.length || !then.length || !CERTAINTY_VALUES.has(certainty)) {
    throw new Error(`${source}#${ruleId}: title, entities, intents, then, and canonical certainty are required`);
  }
  const profilePreferences = (Array.isArray(raw.profilePreferences) ? raw.profilePreferences : [])
    .map((entry) => compactPreference(entry, ruleId))
    .filter(Boolean);
  const catalogMatchers = (Array.isArray(raw.catalogMatchers) ? raw.catalogMatchers : []).map((matcher) => ({
    weaponId: String(matcher?.weaponId || '').trim(),
    skillKey: String(matcher?.skillKey || '').trim(),
    effectType: String(matcher?.effectType || '').trim(),
    requiredFact: String(matcher?.requiredFact || '').trim(),
    utilityKey: String(matcher?.utilityKey || '').trim(),
  })).filter((matcher) => matcher.weaponId && matcher.skillKey && matcher.effectType && matcher.utilityKey);
  return {
    ruleId,
    title,
    entities,
    intents,
    when: { allOf: whenAllOf },
    then,
    certainty,
    dependsOn: stringList(raw.dependsOn),
    conflictsWith: stringList(raw.conflictsWith),
    profilePreferences,
    catalogMatchers,
    ignoredTypeKeys: stringList(raw.ignoredTypeKeys),
    nonImplications: stringList(raw.nonImplications),
    notes: String(raw.notes || '').trim(),
    provenance: String(raw.provenance || 'teacher-curated').trim(),
    versionScope: String(raw.versionScope || 'current-local-catalog').trim(),
    source,
  };
}

export function loadCombatConventionRules(rootDirectory) {
  const root = fs.realpathSync(rootDirectory);
  const files = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'));
  const rules = [];
  for (const entry of files) {
    const target = fs.realpathSync(path.join(root, entry.name));
    if (!target.startsWith(`${root}${path.sep}`)) continue;
    const text = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
    for (const match of text.matchAll(RULE_BLOCK_PATTERN)) {
      let raw;
      try {
        raw = JSON.parse(match[1]);
      } catch (error) {
        throw new Error(`${entry.name}: invalid def-convention JSON: ${error.message}`);
      }
      rules.push(normalizeRule(raw, `game-knowledge/conventions/${entry.name}`));
    }
  }
  if (!rules.length) throw new Error('combat convention library is empty');
  if (rules.length > MAX_RULES) throw new Error(`combat convention library exceeds ${MAX_RULES} rules`);
  const byId = new Map();
  for (const rule of rules) {
    if (byId.has(rule.ruleId)) throw new Error(`duplicate combat convention ruleId: ${rule.ruleId}`);
    byId.set(rule.ruleId, rule);
  }
  for (const rule of rules) {
    for (const dependency of rule.dependsOn) {
      if (!byId.has(dependency)) throw new Error(`${rule.ruleId}: missing dependency ${dependency}`);
    }
    for (const conflict of rule.conflictsWith) {
      if (!byId.has(conflict)) throw new Error(`${rule.ruleId}: missing conflict target ${conflict}`);
    }
  }
  return {
    contract: 'DefCombatConventionLibraryV1',
    rules,
    sourceHash: canonicalHash(rules),
  };
}

function ruleSearchText(rule) {
  return normalized([
    rule.ruleId,
    rule.title,
    ...rule.entities,
    ...rule.intents,
    ...rule.when.allOf,
    ...rule.then,
    ...rule.nonImplications,
    rule.notes,
  ].join(' '));
}

function seedScore(rule, entityTerms, intentTerms, queryTerms) {
  const normalizedEntities = rule.entities.map(normalized);
  const entityMatches = entityTerms.filter((term) => normalizedEntities.some((entity) => entity === term || entity.includes(term) || term.includes(entity)));
  if (entityTerms.length && !entityMatches.length) return 0;
  const normalizedIntents = rule.intents.map(normalized);
  const intentMatches = intentTerms.filter((term) => normalizedIntents.some((intent) => intent === term || intent.includes(term) || term.includes(intent)));
  if (intentTerms.length && !intentMatches.length) return 0;
  const text = ruleSearchText(rule);
  const termMatches = queryTerms.filter((term) => text.includes(term));
  return entityMatches.length * 10 + intentMatches.length * 4 + termMatches.length;
}

export function resolveCombatConventionBundle(library, input = {}) {
  const rules = Array.isArray(library?.rules) ? library.rules : [];
  const entities = stringList(input.entities, 16);
  const requestedIntents = stringList(Array.isArray(input.intents) ? input.intents : [input.intent], 8);
  const intents = requestedIntents.some((intent) => SUPPORT_BUILD_INTENT_FAMILY.includes(intent))
    ? stringList([...requestedIntents, ...SUPPORT_BUILD_INTENT_FAMILY], 8)
    : requestedIntents;
  const terms = stringList(Array.isArray(input.terms) ? input.terms : [input.query], 16);
  const entityTerms = entities.map(normalized).filter(Boolean);
  const intentTerms = intents.map(normalized).filter(Boolean);
  const queryTerms = terms.map(normalized).filter(Boolean);
  if (!entityTerms.length && !queryTerms.length) {
    return { ok: false, code: 'combat-convention-query-required', message: 'At least one entity or query term is required.' };
  }
  const byId = new Map(rules.map((rule) => [rule.ruleId, rule]));
  const scored = rules.map((rule) => ({ rule, score: seedScore(rule, entityTerms, intentTerms, queryTerms) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.rule.ruleId.localeCompare(right.rule.ruleId));
  const selected = new Map();
  let overflow = false;
  const include = (rule, depth = 0) => {
    if (!rule || selected.has(rule.ruleId)) return;
    if (selected.size >= MAX_BUNDLE_RULES) {
      overflow = true;
      return;
    }
    selected.set(rule.ruleId, rule);
    if (depth >= 4) return;
    rule.dependsOn.forEach((dependency) => include(byId.get(dependency), depth + 1));
  };
  scored.forEach(({ rule }) => include(rule));
  const bundleRules = [...selected.values()].sort((left, right) => left.ruleId.localeCompare(right.ruleId));
  const selectedIds = new Set(bundleRules.map((rule) => rule.ruleId));
  const missingEdges = bundleRules.flatMap((rule) => rule.dependsOn
    .filter((dependency) => !selectedIds.has(dependency))
    .map((dependency) => ({ ruleId: rule.ruleId, missingRuleId: dependency })));
  const conflicts = bundleRules.flatMap((rule) => rule.conflictsWith
    .filter((conflict) => selectedIds.has(conflict))
    .map((conflict) => ({ ruleId: rule.ruleId, conflictRuleId: conflict })));
  const producedFacts = new Set(bundleRules.flatMap((rule) => rule.then));
  const externalPrerequisites = [...new Set(bundleRules.flatMap((rule) => rule.when.allOf).filter((fact) => !producedFacts.has(fact)))];
  const preferenceMap = new Map();
  for (const preference of bundleRules.flatMap((rule) => rule.profilePreferences)) {
    const prior = preferenceMap.get(preference.key);
    if (!prior || preference.priority < prior.priority) preferenceMap.set(preference.key, preference);
  }
  const profilePreferences = [...preferenceMap.values()]
    .sort((left, right) => left.priority - right.priority || left.key.localeCompare(right.key));
  const ignoredTypeKeys = [...new Set(bundleRules.flatMap((rule) => rule.ignoredTypeKeys))];
  const payload = {
    rules: bundleRules,
    profilePreferences,
    ignoredTypeKeys,
    externalPrerequisites,
    missingEdges,
    conflicts,
    overflow,
  };
  return {
    ok: true,
    protocolVersion: 1,
    contract: 'DefCombatConventionBundleV1',
    state: !bundleRules.length ? 'NOT_FOUND' : missingEdges.length || conflicts.length || overflow ? 'INCOMPLETE' : 'READY',
    query: { entities, requestedIntents, effectiveIntents: intents, terms },
    scope: 'teacher-curated-combat-conventions',
    source: 'game-knowledge/conventions',
    sourceHash: library?.sourceHash || canonicalHash(rules),
    bundleHash: canonicalHash(payload),
    exhaustive: !overflow,
    truncated: overflow,
    ...payload,
    nextAction: !bundleRules.length
      ? 'Report that no reviewed combat convention covers this entity/intent; do not infer a trigger chain.'
      : missingEdges.length || conflicts.length || overflow
        ? 'Report the returned missing/conflicting edges and stop before ranking.'
        : 'Use only these reviewed condition edges together with current typed operator/weapon facts; do not invent an unlisted causal edge.',
  };
}
