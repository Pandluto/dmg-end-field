import { hashDefStableValue } from './stable-json.mjs';

const ABILITY_TYPE_KEYS = Object.freeze({
  力量: 'strengthBoost',
  strength: 'strengthBoost',
  敏捷: 'agilityBoost',
  agility: 'agilityBoost',
  智识: 'intelligenceBoost',
  intelligence: 'intelligenceBoost',
  意志: 'willBoost',
  will: 'willBoost',
});

const ELEMENT_DAMAGE_GROUPS = Object.freeze({
  ice: { key: 'ice-damage', label: '寒冷伤害', acceptedTypeKeys: ['iceDmgBonus', 'iceElectricDmgBonus'] },
  cold: { key: 'ice-damage', label: '寒冷伤害', acceptedTypeKeys: ['iceDmgBonus', 'iceElectricDmgBonus'] },
  寒冷: { key: 'ice-damage', label: '寒冷伤害', acceptedTypeKeys: ['iceDmgBonus', 'iceElectricDmgBonus'] },
  fire: { key: 'fire-damage', label: '灼热伤害', acceptedTypeKeys: ['fireDmgBonus'] },
  火: { key: 'fire-damage', label: '灼热伤害', acceptedTypeKeys: ['fireDmgBonus'] },
  electric: { key: 'electric-damage', label: '电磁伤害', acceptedTypeKeys: ['electricDmgBonus', 'iceElectricDmgBonus'] },
  电磁: { key: 'electric-damage', label: '电磁伤害', acceptedTypeKeys: ['electricDmgBonus', 'iceElectricDmgBonus'] },
  nature: { key: 'nature-damage', label: '自然伤害', acceptedTypeKeys: ['natureDmgBonus'] },
  自然: { key: 'nature-damage', label: '自然伤害', acceptedTypeKeys: ['natureDmgBonus'] },
  physical: { key: 'physical-damage', label: '物理伤害', acceptedTypeKeys: ['physicalDmgBonus'] },
  物理: { key: 'physical-damage', label: '物理伤害', acceptedTypeKeys: ['physicalDmgBonus'] },
});

const SKILL_DAMAGE_GROUPS = Object.freeze({
  Q: { key: 'ultimate-damage', label: '终结技伤害', acceptedTypeKeys: ['ultimateDmgBonus'] },
  E: { key: 'chain-skill-damage', label: '连携技伤害', acceptedTypeKeys: ['chainSkillDmgBonus'] },
  B: { key: 'battle-skill-damage', label: '战技伤害', acceptedTypeKeys: ['skillDmgBonus'] },
  A: { key: 'normal-attack-damage', label: '普通攻击伤害', acceptedTypeKeys: ['normalAttackDmgBonus'] },
});

const GUIDE_PREFERENCE_PATTERNS = Object.freeze([
  { key: 'ultimate-damage', label: '终结技伤害', kind: 'skill-damage', acceptedTypeKeys: ['ultimateDmgBonus'], pattern: /终结技(?:伤害|增伤|倍率|优先|核心)?|大招(?:伤害|增伤|倍率|优先|核心)?/g },
  { key: 'all-skill-damage', label: '所有技能伤害', kind: 'general-damage', acceptedTypeKeys: ['allSkillDmgBonus'], pattern: /所有技能(?:伤害|增伤)?|全技能(?:伤害|增伤)?/g },
  { key: 'chain-skill-damage', label: '连携技伤害', kind: 'skill-damage', acceptedTypeKeys: ['chainSkillDmgBonus'], pattern: /连携技(?:伤害|增伤|倍率|优先|核心)?/g },
  { key: 'battle-skill-damage', label: '战技伤害', kind: 'skill-damage', acceptedTypeKeys: ['skillDmgBonus'], pattern: /战技(?:伤害|增伤|倍率|优先|核心|专三|主加)/g },
  { key: 'normal-attack-damage', label: '普通攻击伤害', kind: 'skill-damage', acceptedTypeKeys: ['normalAttackDmgBonus'], pattern: /普通攻击(?:伤害|增伤|倍率|优先|核心)?|普攻(?:伤害|增伤|倍率|优先|核心)?|重击(?:伤害|输出|爆发)/g },
  { key: 'ice-damage', label: '寒冷伤害', kind: 'elemental-damage', acceptedTypeKeys: ['iceDmgBonus', 'iceElectricDmgBonus'], pattern: /寒冷(?:伤害|输出|增伤)|冰伤/g },
  { key: 'fire-damage', label: '灼热伤害', kind: 'elemental-damage', acceptedTypeKeys: ['fireDmgBonus'], pattern: /灼热(?:伤害|输出|增伤)|火伤/g },
  { key: 'electric-damage', label: '电磁伤害', kind: 'elemental-damage', acceptedTypeKeys: ['electricDmgBonus', 'iceElectricDmgBonus'], pattern: /电磁(?:伤害|输出|增伤)|电伤/g },
  { key: 'nature-damage', label: '自然伤害', kind: 'elemental-damage', acceptedTypeKeys: ['natureDmgBonus', 'fireNatureDmgBonus'], pattern: /自然(?:伤害|输出|增伤)/g },
  { key: 'physical-damage', label: '物理伤害', kind: 'elemental-damage', acceptedTypeKeys: ['physicalDmgBonus'], pattern: /物理(?:伤害|输出|增伤|爆发)/g },
  { key: 'source-skill', label: '源石技艺强度', kind: 'general-damage', acceptedTypeKeys: ['sourceSkillBoost'], pattern: /源石技艺(?:强度)?/g },
  { key: 'primary-strength', label: '力量', kind: 'primary-attribute', acceptedTypeKeys: ['strengthBoost'], pattern: /力量/g },
  { key: 'primary-agility', label: '敏捷', kind: 'primary-attribute', acceptedTypeKeys: ['agilityBoost'], pattern: /敏捷/g },
  { key: 'primary-intelligence', label: '智识', kind: 'primary-attribute', acceptedTypeKeys: ['intelligenceBoost'], pattern: /智识/g },
  { key: 'secondary-will', label: '意志', kind: 'secondary-attribute', acceptedTypeKeys: ['willBoost'], pattern: /意志/g },
]);

const GUIDE_NEGATIVE_PREFIX = /(?:不推荐|不建议|无需|不需要|不要|避免|舍弃|不吃|不优先|低优先|非核心|不适合)[^，。；\n]{0,12}$/;
const GUIDE_NEGATIVE_SUFFIX = /^[^，。；\n]{0,8}(?:收益低|优先级低|不推荐|不建议|无需|不需要|不优先|不适合|不吃)/;

function normalized(value) {
  return String(value || '').normalize('NFKC').trim().toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function objectValues(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function maximumNumericLevel(levels) {
  const values = Object.values(levels && typeof levels === 'object' ? levels : {})
    .map((value) => Number(value && typeof value === 'object' ? value.value : value))
    .filter(Number.isFinite);
  return values.length ? Math.max(...values) : null;
}

function summarizeSkill(skill, skillId) {
  if (!skill || typeof skill !== 'object') return null;
  const skillType = String(skill.buttonType || skill.type || '').trim().toUpperCase();
  const displayName = String(skill.displayName || skill.name || skillId || '').trim();
  if (!['A', 'B', 'E', 'Q'].includes(skillType) || !displayName) return null;
  const hits = objectValues(skill.hitMeta).map((hit) => ({
    displayName: String(hit?.displayName || '').trim(),
    skillType: ['A', 'B', 'E', 'Q'].includes(String(hit?.skillType || '').trim().toUpperCase())
      ? String(hit.skillType).trim().toUpperCase()
      : skillType,
    peakMultiplier: maximumNumericLevel(hit?.levels),
  })).filter((hit) => Number.isFinite(hit.peakMultiplier));
  const peakLevelTotalMultiplierBySkillType = Object.fromEntries(['A', 'B', 'E', 'Q'].flatMap((type) => {
    const typedHits = hits.filter((hit) => hit.skillType === type);
    return typedHits.length
      ? [[type, Number(typedHits.reduce((total, hit) => total + hit.peakMultiplier, 0).toFixed(8))]]
      : [];
  }));
  return {
    skillId: String(skillId || skill.id || '').trim() || null,
    skillType,
    displayName,
    hitCount: hits.length,
    peakLevelTotalMultiplier: hits.length
      ? Number(hits.reduce((total, hit) => total + hit.peakMultiplier, 0).toFixed(8))
      : null,
    peakLevelTotalMultiplierBySkillType,
    hits,
  };
}

function flattenOperatorEffects(rawOperator) {
  const effects = [];
  for (const [groupKey, group] of Object.entries(rawOperator?.buffs && typeof rawOperator.buffs === 'object' ? rawOperator.buffs : {})) {
    for (const [effectKey, effect] of Object.entries(group?.effects && typeof group.effects === 'object' ? group.effects : {})) {
      if (!effect || typeof effect !== 'object') continue;
      const text = [effect.name, effect.displayName, effect.description, effect.raw].filter(Boolean).join(' ');
      const linkedSkillTypes = [];
      if (/终结技|大招/.test(text)) linkedSkillTypes.push('Q');
      if (/连携技|连携/.test(text)) linkedSkillTypes.push('E');
      if (/战技/.test(text)) linkedSkillTypes.push('B');
      if (/普通攻击|普攻|重击/.test(text)) linkedSkillTypes.push('A');
      effects.push({
        evidenceRef: `operator.buffs.${groupKey}.effects.${effectKey}`,
        name: String(effect.name || effect.displayName || effectKey),
        typeKey: String(effect.typeKey || effect.type || ''),
        linkedSkillTypes,
        damageRelevant: /伤害|倍率|增伤|脆弱/.test(text),
      });
    }
  }
  return effects.slice(0, 16);
}

function abilityGroup(label, role) {
  const typeKey = ABILITY_TYPE_KEYS[String(label || '').trim()] || ABILITY_TYPE_KEYS[normalized(label)];
  if (!typeKey) return null;
  return {
    key: role === 'primary' ? 'primary-attribute' : 'secondary-attribute',
    label: String(label || '').trim(),
    kind: role === 'primary' ? 'primary-attribute' : 'secondary-attribute',
    acceptedTypeKeys: [typeKey],
    evidenceRefs: [`operator.${role === 'primary' ? 'mainStat' : 'subStat'}`],
  };
}

function uniqueGroups(groups) {
  const seen = new Set();
  return groups.filter((group) => {
    if (!group || seen.has(group.key)) return false;
    seen.add(group.key);
    return true;
  });
}

function conventionSkillTypes(conventionBundle) {
  const facts = [];
  const collect = (value) => {
    if (typeof value === 'string') facts.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  for (const rule of Array.isArray(conventionBundle?.rules) ? conventionBundle.rules : []) {
    collect(rule?.when);
    collect(rule?.then);
  }
  const mentioned = new Set(facts.flatMap((fact) => [...String(fact).matchAll(/\.skill\.([ABEQ])(?:\.|$)/g)]
    .map((match) => match[1])));
  return ['Q', 'B', 'E', 'A'].filter((skillType) => mentioned.has(skillType));
}

function referenceSectionText(reference, section) {
  if (!reference || !section) return '';
  const start = reference.lineOffsets?.[section.lineStart] || 0;
  const end = reference.lineOffsets?.[section.lineEnd] || reference.text?.length || 0;
  return String(reference.text || '').slice(start, end);
}

function compactSection(section) {
  return section ? {
    sectionId: section.sectionId,
    heading: section.heading,
    level: section.level,
    parentSectionId: section.parentSectionId || null,
  } : null;
}

function sectionAncestors(reference, section) {
  const byId = new Map((reference?.index?.headings || []).map((entry) => [entry.sectionId, entry]));
  const ancestors = [];
  let current = section;
  while (current?.parentSectionId) {
    current = byId.get(current.parentSectionId) || null;
    if (current) ancestors.push(current);
  }
  return ancestors;
}

function sectionHasBuildStrategy(reference, section) {
  const text = referenceSectionText(reference, section);
  return /装备|配装|养成|武器|套装|词条/.test(`${section?.heading || ''}\n${text}`)
    && /推荐|优先|选择|适合|方案|词条|套装|武器|装备/.test(text);
}

function findOperatorBuildSection(reference, identityNeedles) {
  const headings = reference?.index?.headings || [];
  const buildHeading = (entry) => Number(entry?.level) > 1
    && /装备|配装|养成|武器|套装|词条/.test(String(entry?.heading || ''));
  const headingHasIdentity = (entry) => {
    const heading = normalized(entry?.heading);
    return identityNeedles.some((needle) => heading.includes(needle));
  };
  const operatorSubsections = headings
    .filter((entry) => headingHasIdentity(entry))
    .filter((entry) => buildHeading(entry) || sectionAncestors(reference, entry).some(buildHeading))
    .filter((entry) => sectionHasBuildStrategy(reference, entry))
    .sort((left, right) => right.level - left.level || left.lineStart - right.lineStart);
  if (operatorSubsections[0]) return operatorSubsections[0];

  const titleHasIdentity = identityNeedles.some((needle) => normalized(reference?.title).includes(needle));
  if (!titleHasIdentity) return null;
  return headings
    .filter((entry) => buildHeading(entry) && sectionHasBuildStrategy(reference, entry))
    .sort((left, right) => left.level - right.level || left.lineStart - right.lineStart)[0] || null;
}

export function extractGuideBuildStrategy(content, { evidenceRef = '', setQuery = '' } = {}) {
  const text = String(content || '');
  const matches = [];
  const excludedMatches = [];
  for (const definition of GUIDE_PREFERENCE_PATTERNS) {
    const pattern = new RegExp(definition.pattern.source, definition.pattern.flags);
    for (const match of text.matchAll(pattern)) {
      const clausePrefix = text.slice(Math.max(0, match.index - 24), match.index).split(/[，。；\n]/).at(-1) || '';
      const matchEnd = match.index + match[0].length;
      const clauseSuffix = text.slice(matchEnd, matchEnd + 24).split(/[，。；\n]/)[0] || '';
      if (GUIDE_NEGATIVE_PREFIX.test(clausePrefix) || GUIDE_NEGATIVE_SUFFIX.test(clauseSuffix)) {
        excludedMatches.push({
          key: definition.key,
          label: definition.label,
          matchedText: match[0],
          reason: 'negative-or-low-priority-context',
        });
        continue;
      }
      matches.push({
        index: match.index,
        group: {
          key: definition.key,
          label: definition.label,
          kind: definition.kind,
          acceptedTypeKeys: definition.acceptedTypeKeys,
          evidenceRefs: evidenceRef ? [evidenceRef] : [],
          matchedText: match[0],
        },
      });
      break;
    }
  }
  matches.sort((left, right) => left.index - right.index || left.group.key.localeCompare(right.group.key));
  const preferenceGroups = uniqueGroups(matches.map((entry) => entry.group)).slice(0, 12);
  const normalizedSetQuery = normalized(setQuery);
  return {
    preferenceGroups,
    keywordLabels: preferenceGroups.map((group) => group.label),
    excludedMatches,
    requestedSetMentioned: normalizedSetQuery ? normalized(text).includes(normalizedSetQuery) : null,
    sufficientForPlanner: preferenceGroups.length >= 2,
  };
}

export function discoverOperatorBuildGuides(references, operator, { goal = 'damage', setQuery = '' } = {}) {
  const operatorId = String(operator?.id || '').trim();
  const operatorName = String(operator?.name || '').trim();
  const identityNeedles = [operatorName, operatorId].map(normalized).filter(Boolean);
  const candidates = [];
  for (const reference of Array.isArray(references) ? references : []) {
    const title = String(reference?.title || reference?.id || '');
    const text = String(reference?.text || '');
    const normalizedTitle = normalized(title);
    const normalizedBody = normalized(text);
    const matchedIdentity = identityNeedles.find((needle) => normalizedTitle.includes(needle) || normalizedBody.includes(needle));
    if (!matchedIdentity) continue;
    const buildSections = (reference?.index?.headings || []).filter((section) => /装备|配装|养成|武器|套装|词条/.test(String(section?.heading || '')));
    const operatorSpecificSection = findOperatorBuildSection(reference, identityNeedles);
    const exact = Boolean(operatorSpecificSection);
    const strategy = operatorSpecificSection
      ? extractGuideBuildStrategy(referenceSectionText(reference, operatorSpecificSection), {
        evidenceRef: `guide:${reference.id}#${operatorSpecificSection.sectionId}`,
        setQuery,
      })
      : null;
    const titleLooksLikeTeamComposition = /[x×+＋]/i.test(title);
    const titleIsOperatorGuide = identityNeedles.some((needle) => normalizedTitle.includes(needle))
      && !titleLooksLikeTeamComposition;
    candidates.push({
      referenceId: reference.id,
      title,
      source: `game-knowledge/references/${reference.id}`,
      identityMatch: {
        operatorId,
        operatorName,
        matchedInTitle: identityNeedles.some((needle) => normalizedTitle.includes(needle)),
        matchedInBody: identityNeedles.some((needle) => normalizedBody.includes(needle)),
      },
      relevance: exact ? 'operator-build-section' : 'operator-mention-only',
      contextScope: titleLooksLikeTeamComposition ? 'team-composition' : 'operator-general',
      recommendedSection: compactSection(operatorSpecificSection || buildSections[0] || null),
      exactReadPolicy: operatorSpecificSection ? {
        mode: 'single-exact-section',
        maxSectionReads: 1,
        requiredSectionId: operatorSpecificSection.sectionId,
        reason: 'This is the operator-specific build section discovered before any skill-derived fallback.',
      } : null,
      strategy,
      requestCoverage: {
        goal: String(goal || ''),
        setQuery: String(setQuery || ''),
        requestedSetMentioned: strategy?.requestedSetMentioned ?? null,
      },
      score: (exact ? 20 : 0)
        + (identityNeedles.some((needle) => normalizedTitle.includes(needle)) ? 8 : 0)
        + (titleIsOperatorGuide ? 12 : 0)
        + (operatorSpecificSection && normalized(operatorSpecificSection.heading).includes(normalized(operatorName)) ? 3 : 0)
        + (strategy?.preferenceGroups?.length || 0)
        + (buildSections.length ? 2 : 0),
    });
  }
  candidates.sort((left, right) => right.score - left.score || left.referenceId.localeCompare(right.referenceId, 'zh-Hans-CN'));
  const exact = candidates.filter((candidate) => candidate.relevance === 'operator-build-section');
  const complete = exact.filter((candidate) => candidate.contextScope === 'operator-general' && candidate.strategy?.sufficientForPlanner);
  const state = complete.length ? 'GUIDE_FOUND' : exact.length ? 'PARTIAL_GUIDE_FOUND' : 'GUIDE_NOT_FOUND';
  return {
    state,
    exhaustive: true,
    truncated: candidates.length > 3,
    candidates: (complete.length ? complete : exact.length ? exact : candidates).slice(0, 3).map(({ score: _score, ...candidate }) => candidate),
  };
}

export function resolveOperatorCatalogRecord(library, rawQuery) {
  const query = normalized(rawQuery);
  const entries = Object.entries(library && typeof library === 'object' && !Array.isArray(library) ? library : {})
    .map(([fallbackId, raw]) => ({ fallbackId, raw }))
    .filter(({ raw }) => raw && typeof raw === 'object');
  const exact = entries.filter(({ fallbackId, raw }) => [fallbackId, raw.id, raw.name].some((value) => normalized(value) === query));
  if (exact.length === 1) return { ok: true, id: String(exact[0].raw.id || exact[0].fallbackId), operator: exact[0].raw };
  const contained = exact.length ? exact : entries.filter(({ fallbackId, raw }) => normalized(`${fallbackId}${raw.id || ''}${raw.name || ''}`).includes(query));
  return {
    ok: false,
    code: contained.length ? 'operator-build-operator-ambiguous' : 'operator-build-operator-not-found',
    // Return complete resolver facts.  Consumers that expose this result to a
    // user are responsible for the protocol's bounded display list.
    candidates: contained.map(({ fallbackId, raw }) => ({ id: String(raw.id || fallbackId), name: String(raw.name || '') })),
    candidateCount: contained.length,
  };
}

export function deriveOperatorBuildProfile(rawOperator, {
  guideState,
  guideResolutionId,
  goal = 'damage',
  conventionBundle = null,
} = {}) {
  const skills = Object.entries(rawOperator?.skills && typeof rawOperator.skills === 'object' ? rawOperator.skills : {})
    .map(([skillId, skill]) => summarizeSkill(skill, skillId))
    .filter(Boolean);
  const effects = flattenOperatorEffects(rawOperator || {});
  const maxByType = new Map();
  for (const skill of skills) {
    for (const [hitSkillType, multiplier] of Object.entries(skill.peakLevelTotalMultiplierBySkillType || {})) {
      const current = maxByType.get(hitSkillType);
      if (!current || Number(multiplier || 0) > Number(current.peakLevelTotalMultiplier || 0)) {
        maxByType.set(hitSkillType, { ...skill, skillType: hitSkillType, peakLevelTotalMultiplier: multiplier });
      }
    }
  }
  const rankedTypes = [...maxByType.values()]
    .filter((skill) => Number.isFinite(skill.peakLevelTotalMultiplier))
    .sort((left, right) => right.peakLevelTotalMultiplier - left.peakLevelTotalMultiplier);
  const supportRole = /辅助|support/.test(normalized(rawOperator?.profession));
  const linkedDamageTypes = new Set(effects.filter((effect) => effect.damageRelevant).flatMap((effect) => effect.linkedSkillTypes));
  const linkedUtilityTypes = new Set(effects.filter((effect) => !effect.damageRelevant).flatMap((effect) => effect.linkedSkillTypes));
  const focusSkillTypes = [];
  if (supportRole) {
    for (const type of conventionSkillTypes(conventionBundle)) {
      if (!focusSkillTypes.includes(type)) focusSkillTypes.push(type);
    }
    for (const type of ['Q', 'B', 'E', 'A']) {
      if (linkedUtilityTypes.has(type) && !focusSkillTypes.includes(type)) focusSkillTypes.push(type);
    }
  } else {
    if (rankedTypes[0]?.skillType) focusSkillTypes.push(rankedTypes[0].skillType);
    for (const type of ['Q', 'E', 'B', 'A']) {
      if (linkedDamageTypes.has(type) && !focusSkillTypes.includes(type)) focusSkillTypes.push(type);
    }
  }
  const elementKey = normalized(rawOperator?.element);
  const elementGroup = ELEMENT_DAMAGE_GROUPS[elementKey] || null;
  const primaryFocus = SKILL_DAMAGE_GROUPS[focusSkillTypes[0]] || null;
  const damagePreferenceGroups = uniqueGroups([
    primaryFocus ? {
      ...primaryFocus,
      kind: 'skill-damage',
      evidenceRefs: rankedTypes[0]?.skillType === focusSkillTypes[0]
        ? [`operator.skills.${rankedTypes[0].skillId}`]
        : effects.filter((effect) => effect.linkedSkillTypes.includes(focusSkillTypes[0])).map((effect) => effect.evidenceRef),
    } : null,
    normalized(goal).includes('damage') || normalized(goal).includes('伤害') || normalized(goal).includes('输出') ? {
      key: 'all-skill-damage',
      label: '所有技能伤害',
      kind: 'general-damage',
      acceptedTypeKeys: ['allSkillDmgBonus'],
      evidenceRefs: ['buildGoal.damage'],
    } : null,
    elementGroup ? { ...elementGroup, kind: 'elemental-damage', evidenceRefs: ['operator.element'] } : null,
    abilityGroup(rawOperator?.mainStat, 'primary'),
    abilityGroup(rawOperator?.subStat, 'secondary'),
  ]);
  const conventionPreferenceGroups = Array.isArray(conventionBundle?.profilePreferences)
    ? conventionBundle.profilePreferences.map((group) => ({
      key: String(group?.key || ''),
      label: String(group?.label || ''),
      kind: String(group?.kind || 'other'),
      acceptedTypeKeys: Array.isArray(group?.acceptedTypeKeys) ? group.acceptedTypeKeys.map(String) : [],
      evidenceRefs: Array.isArray(group?.evidenceRefs) ? group.evidenceRefs.map(String) : [],
    })).filter((group) => group.key && group.label && group.acceptedTypeKeys.length)
    : [];
  const preferenceGroups = supportRole ? uniqueGroups(conventionPreferenceGroups) : damagePreferenceGroups;
  const missing = [];
  if (!String(rawOperator?.mainStat || '').trim()) missing.push({ code: 'operator-main-attribute-missing', field: 'mainStat' });
  if (!String(rawOperator?.subStat || '').trim()) missing.push({ code: 'operator-secondary-attribute-missing', field: 'subStat' });
  if (!String(rawOperator?.element || '').trim()) missing.push({ code: 'operator-element-missing', field: 'element' });
  if (!skills.length) missing.push({ code: 'operator-skill-evidence-missing', field: 'skills' });
  if (supportRole && conventionBundle?.state !== 'READY') {
    missing.push({ code: 'operator-combat-convention-required', field: 'conventionBundle' });
  }
  if (supportRole && !conventionPreferenceGroups.length) {
    missing.push({ code: 'operator-utility-preference-unresolved', field: 'conventionBundle.profilePreferences' });
  }
  if (supportRole && effects.some((effect) => !effect.damageRelevant) && !focusSkillTypes.length) {
    missing.push({ code: 'operator-utility-focus-unresolved', field: 'skillEvidence.focusSkillTypes' });
  }
  const derivationKind = supportRole
    ? 'combat-convention-and-skill-analysis'
    : guideState === 'PARTIAL_GUIDE_FOUND'
      ? 'guide-and-skill-analysis'
      : 'skill-analysis';
  const evidenceRefs = [...new Set(preferenceGroups.flatMap((group) => group.evidenceRefs || []))];
  const plannerProfile = {
    characterId: String(rawOperator?.id || ''),
    derivation: derivationKind,
    evidenceRefs,
    keywords: preferenceGroups.map((group) => group.label),
    preferenceGroups: preferenceGroups.map(({ evidenceRefs: _evidenceRefs, ...group }) => group),
  };
  return {
    contract: 'DefOperatorBuildProfileV1',
    state: missing.length ? 'INSUFFICIENT_OPERATOR_EVIDENCE' : 'PROFILE_READY',
    character: {
      id: String(rawOperator?.id || ''),
      name: String(rawOperator?.name || ''),
      element: String(rawOperator?.element || ''),
      profession: String(rawOperator?.profession || ''),
      mainAttribute: String(rawOperator?.mainStat || ''),
      secondaryAttribute: String(rawOperator?.subStat || ''),
    },
    derivation: {
      guideState: String(guideState || 'GUIDE_NOT_FOUND'),
      guideResolutionId: String(guideResolutionId || ''),
      goal: String(goal || ''),
      source: 'active-game-catalog-skill-fallback',
    },
    skillEvidence: {
      comparisonScope: supportRole
        ? 'reviewed combat conventions plus linked structured utility effects; personal damage multipliers are excluded unless a convention makes them team-relevant'
        : 'peak-level base hit multipliers plus linked structured operator effects; not a full rotation DPS calculation',
      skills,
      linkedEffects: effects,
      focusSkillTypes,
    },
    conventionEvidence: supportRole ? {
      required: true,
      state: conventionBundle?.state || 'NOT_PROVIDED',
      bundleHash: conventionBundle?.bundleHash || null,
      ruleIds: Array.isArray(conventionBundle?.rules) ? conventionBundle.rules.map((rule) => rule.ruleId) : [],
      ignoredTypeKeys: Array.isArray(conventionBundle?.ignoredTypeKeys) ? conventionBundle.ignoredTypeKeys : [],
    } : { required: false },
    preferenceGroups,
    keywordLabels: preferenceGroups.map((group) => group.label),
    plannerProfile: missing.length ? null : plannerProfile,
    missing,
    nextAction: missing.length
      ? 'Do not rank equipment until the missing operator evidence is supplied.'
      : supportRole
        ? 'Call def_data_weapon_fit_plan directly with this unchanged plannerProfile/capability and convention bundle hash. Do not call generic skill/operator, native catalog materialization, weapon summaries, or loadout candidates.'
        : 'Use these evidence-backed effect groups as character preferences. Do not reinterpret equipment fixedStat as the operator main or secondary attribute.',
  };
}

/** True when a structured operator profile needs reviewed combat conventions. */
export function operatorRequiresCombatConvention(operator = {}) {
  return /辅助|support/.test(normalized(operator?.profession));
}

/** Compile guide evidence into the planner's pure profile shape. */
export function compileGuidePlannerProfile(operatorId, guideStrategy, guideContentHash) {
  const claimedTypeKeys = new Set();
  const preferenceGroups = (guideStrategy?.preferenceGroups || []).flatMap((group) => {
    const acceptedTypeKeys = [...new Set((group?.acceptedTypeKeys || [])
      .map((value) => String(value || '').trim())
      .filter((value) => value && !claimedTypeKeys.has(value)))];
    acceptedTypeKeys.forEach((value) => claimedTypeKeys.add(value));
    return acceptedTypeKeys.length && String(group?.key || '').trim() && String(group?.label || '').trim()
      ? [{ key: String(group.key).trim(), label: String(group.label).trim(), kind: String(group.kind || 'other'), acceptedTypeKeys }]
      : [];
  });
  return {
    characterId: String(operatorId || '').trim(),
    derivation: 'guide',
    evidenceRefs: [`guide-sha256:${String(guideContentHash || '').trim()}`],
    keywords: preferenceGroups.map((group) => group.label),
    preferenceGroups,
  };
}

/**
 * Keep guide-proven groups while supplementing only missing profile evidence.
 * Inputs are plain evidence values; no capability, token, or server state is
 * accepted by this core helper.
 */
export function mergePartialGuidePlannerProfile(profile, {
  guideState,
  guidePreferenceGroups = [],
  guideContextScope = null,
  guideContentHash = null,
} = {}) {
  if (!profile?.plannerProfile || guideState !== 'PARTIAL_GUIDE_FOUND') return profile;
  const ignoredTypeKeys = new Set(profile?.conventionEvidence?.ignoredTypeKeys || []);
  const claimedTypeKeys = new Set();
  const guideGroups = guidePreferenceGroups.flatMap((group) => {
    const acceptedTypeKeys = [...new Set((group?.acceptedTypeKeys || [])
      .map((value) => String(value || '').trim())
      .filter((value) => value && !ignoredTypeKeys.has(value) && !claimedTypeKeys.has(value)))];
    acceptedTypeKeys.forEach((value) => claimedTypeKeys.add(value));
    return acceptedTypeKeys.length && String(group?.key || '').trim() && String(group?.label || '').trim()
      ? [{ key: String(group.key).trim(), label: String(group.label).trim(), kind: String(group.kind || 'other'), acceptedTypeKeys }]
      : [];
  });
  const teamScopedGuide = guideContextScope === 'team-composition';
  const derivedTypeKeys = new Set(profile.plannerProfile.preferenceGroups.flatMap((group) => group.acceptedTypeKeys));
  const coveredTypeKeys = new Set(guideGroups.flatMap((group) => group.acceptedTypeKeys));
  const derivedGroups = profile.plannerProfile.preferenceGroups.filter((group) => teamScopedGuide || !group.acceptedTypeKeys.some((typeKey) => coveredTypeKeys.has(typeKey)));
  const scopedGuideGroups = teamScopedGuide
    ? guideGroups.filter((group) => !group.acceptedTypeKeys.some((typeKey) => derivedTypeKeys.has(typeKey)))
    : guideGroups;
  const preferenceGroups = teamScopedGuide ? [...derivedGroups, ...scopedGuideGroups] : [...scopedGuideGroups, ...derivedGroups];
  const guideEvidence = guideContentHash ? [`guide-sha256:${guideContentHash}`] : [];
  const plannerProfile = {
    ...profile.plannerProfile,
    derivation: 'guide-and-skill-analysis',
    evidenceRefs: [...new Set([...guideEvidence, ...profile.plannerProfile.evidenceRefs])],
    keywords: preferenceGroups.map((group) => group.label),
    preferenceGroups,
  };
  return {
    ...profile,
    preferenceGroups: preferenceGroups.map((group) => ({
      ...group,
      evidenceRefs: scopedGuideGroups.includes(group)
        ? guideEvidence
        : profile.preferenceGroups.find((entry) => entry.key === group.key)?.evidenceRefs || [],
    })),
    keywordLabels: plannerProfile.keywords,
    plannerProfile,
    derivation: { ...profile.derivation, source: 'partial-guide-plus-active-game-catalog-skill-fallback' },
  };
}

export function hashDefOperatorBuildPlannerProfile(plannerProfile) {
  return hashDefStableValue(plannerProfile);
}
