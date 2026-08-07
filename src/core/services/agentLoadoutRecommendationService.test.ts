import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildAgentProductCatalog,
  readAgentProductCatalogInput,
  type AgentProductCatalogInput,
} from './agentProductCatalogService';
import {
  AGENT_LOADOUT_CANONICAL_TYPE_KEY_MAP,
  compare,
  compareCandidateLoadouts,
  compareCurrentWithCandidate,
  deriveProfile,
  evaluateCurrent,
  recommendDiscoveredSets,
  recommendNamedSet,
  recommend,
  recommendWeapons,
  type AgentLoadoutCapsule,
} from './agentLoadoutRecommendationService';

const makeHit = (key: string, element = 'physical', skillType = 'A') => ({
  displayName: key,
  element,
  skillType,
  levels: { M3: 1 },
});

const makeSkill = (buttonType: string, skillId: string, element = 'physical') => ({
  displayName: `${buttonType} skill`,
  buttonType,
  iconUrl: '',
  hitCount: 1,
  hitMeta: { [`${skillId}-hit`]: makeHit(`${skillId}-hit`, element, buttonType) },
});

const operator = {
  id: 'operator-luoxi',
  name: '洛茜',
  avatarUrl: '',
  rarity: 6,
  profession: '近卫',
  weapon: '单手剑',
  element: 'physical',
  mainStat: '敏捷',
  subStat: '智识',
  level: 90,
  attributes: {
    strength: { level90: 10 },
    agility: { level90: 20 },
    intelligence: { level90: 8 },
    will: { level90: 6 },
    atk: { level90: 300 },
    hp: { level90: 5000 },
  },
  buffs: { talent: { effects: {} }, potential: { effects: {} }, skill: { effects: {} } },
  skills: {
    'skill-a': makeSkill('A', 'skill-a'),
    'skill-b': makeSkill('B', 'skill-b'),
    'skill-e': makeSkill('E', 'skill-e'),
    'skill-q': makeSkill('Q', 'skill-q'),
    'skill-dot': makeSkill('Dot', 'skill-dot'),
  },
};

const effect = (name: string, type: string, category = 'passive', valueMode?: string) => ({
  name,
  type,
  category,
  unit: 'percent',
  ...(valueMode ? { valueMode } : {}),
  levels: { '0': 0.1, '3': 0.2 },
});

const equipmentEffect = (name: string, typeKey: string, category = 'buff') => ({
  effectId: 'effect1',
  label: name,
  typeKey,
  category,
  unit: 'percent',
  levels: { '0': 0.1, '3': 0.2 },
});

const weapon = (
  id: string,
  name: string,
  type: string,
  effects: Record<string, unknown>,
  statTypes: readonly [string, string] = ['atk', 'agility'],
) => ({
  id,
  name,
  rarity: 6,
  type,
  attackGrowth: { '90': 100 },
  skills: {
    skill1: { name: '能力', statType: statTypes[0], effects: {} },
    skill2: { name: '属性', statType: statTypes[1], effects: {} },
    skill3: { name: '特效', statType: '', effects },
  },
});

const gearPiece = (
  id: string,
  name: string,
  part: '护甲' | '护手' | '配件',
  effects: Record<string, unknown> = {},
  fixedStat?: { label: string; typeKey: string; value: number; unit: string },
) => ({
  equipmentId: id,
  name,
  part,
  effects,
  ...(fixedStat ? { fixedStat } : {}),
});

const targetSet = {
  schemaVersion: 2,
  gearSetId: 'set-alpha',
  name: '精准套',
  threePieceBuffs: {
    alphaPhysical: {
      effectId: 'alphaPhysical',
      name: '物理易伤',
      category: 'passive',
      typeKey: 'physicalFragile',
      value: 0.2,
      unit: 'percent',
    },
    alphaConditional: {
      effectId: 'alphaConditional',
      name: '条件增益',
      category: 'condition',
      typeKey: 'agilityBoost',
      value: 10,
      unit: 'flat',
    },
  },
  equipments: {
    armor: gearPiece('alpha-armor', '精准护甲', '护甲', {
      effect1: equipmentEffect('敏捷', 'agilityBoost', 'ability'),
    }, { label: '攻击力', typeKey: 'flatAtk', value: 88, unit: 'flat' }),
    glove: gearPiece('alpha-glove', '精准护手', '护手', {
      effect1: equipmentEffect('全技能', 'allSkillDmgBonus', 'buff'),
    }),
    accessoryA: gearPiece('alpha-accessory-a', '精准配件甲', '配件', {
      effect1: equipmentEffect('普通攻击', 'normalAttackDmgBonus', 'buff'),
    }),
    accessoryB: gearPiece('alpha-accessory-b', '精准配件乙', '配件', {
      effect1: equipmentEffect('物理', 'physicalDmgBonus', 'buff'),
    }),
  },
};

const secondSet = {
  schemaVersion: 2,
  gearSetId: 'set-beta',
  name: '对照套',
  threePieceBuffs: {
    betaIntelligence: {
      effectId: 'betaIntelligence',
      name: '智识增益',
      category: 'passive',
      typeKey: 'intelligenceBoost',
      value: 0.2,
      unit: 'percent',
    },
  },
  equipments: {
    armor: gearPiece('beta-armor', '对照护甲', '护甲', {
      effect1: equipmentEffect('智识', 'intelligenceBoost', 'ability'),
    }, { label: '防御力', typeKey: 'defense', value: 999, unit: 'flat' }),
    glove: gearPiece('beta-glove', '对照护手', '护手'),
    accessoryA: gearPiece('beta-accessory-a', '对照配件甲', '配件'),
    accessoryB: gearPiece('beta-accessory-b', '对照配件乙', '配件'),
  },
};

const input: AgentProductCatalogInput = {
  operators: { [operator.id]: operator },
  weapons: {
    'weapon-alpha': weapon('weapon-alpha', '甲剑', '单手剑', {
      effect1: effect('敏捷', 'agilityBoost', 'passive'),
      effect2: effect('物理', 'physicalDmgBonus', 'passive'),
      effect3: effect('全伤害', 'allDmgBonus', 'passive'),
      effect4: effect('全元素', 'allElementDmgBonus', 'passive'),
      effect5: effect('技能伤害', 'skillDmgBonus', 'passive'),
    }),
    'weapon-beta': weapon('weapon-beta', '乙剑', '单手剑', {
      effect1: effect('敏捷', 'agilityBoost', 'passive'),
      effect2: effect('物理', 'physicalDmgBonus', 'passive'),
      effect3: effect('全伤害', 'allDmgBonus', 'passive'),
      effect4: effect('全元素', 'allElementDmgBonus', 'passive'),
      effect5: effect('技能伤害', 'skillDmgBonus', 'passive'),
    }, ['攻击提升', '敏捷提升']),
    'weapon-conditional': weapon('weapon-conditional', '条件剑', '单手剑', {
      effect1: effect('物理', 'physicalDmgBonus', 'condition'),
    }),
    'weapon-wrong-type': weapon('weapon-wrong-type', '重剑', '双手剑', {
      effect1: effect('敏捷', 'agilityBoost', 'passive'),
      effect2: effect('物理', 'physicalDmgBonus', 'passive'),
    }),
    'weapon-unknown': weapon('weapon-unknown', '未知词条剑', '单手剑', {
      effect1: effect('未知', 'futureTypeKey', 'passive'),
    }),
    'weapon-stat-only': weapon('weapon-stat-only', '纯属性剑', '单手剑', {}),
  },
  equipment: {
    schemaVersion: 2,
    gearSets: {
      'set-alpha': targetSet,
      'set-beta': secondSet,
    },
  },
};

const inputSnapshot = JSON.stringify(input);

const catalog = buildAgentProductCatalog(input, { limit: 256 });
const normalizedTargetSetId = catalog.gearSets.results.find((set) => set.name === '精准套')?.id;
assert.ok(normalizedTargetSetId);
const normalizedSecondSetId = catalog.gearSets.results.find((set) => set.name === '对照套')?.id;
const equipmentIdByName = (name: string) => catalog.equipment.results.find((item) => item.name === name)?.id;
const alphaArmorCatalogId = equipmentIdByName('精准护甲');
const alphaGloveCatalogId = equipmentIdByName('精准护手');
const alphaAccessoryACatalogId = equipmentIdByName('精准配件甲');
const alphaAccessoryBCatalogId = equipmentIdByName('精准配件乙');
const betaArmorCatalogId = equipmentIdByName('对照护甲');
const betaGloveCatalogId = equipmentIdByName('对照护手');
const betaAccessoryACatalogId = equipmentIdByName('对照配件甲');
const betaAccessoryBCatalogId = equipmentIdByName('对照配件乙');
assert.ok(normalizedSecondSetId);
assert.ok(alphaArmorCatalogId && alphaGloveCatalogId && alphaAccessoryACatalogId && alphaAccessoryBCatalogId);
assert.ok(betaArmorCatalogId && betaGloveCatalogId && betaAccessoryACatalogId && betaAccessoryBCatalogId);

const profile = deriveProfile(input, '洛茜');
assert.equal(profile.status, 'READY');
assert.equal(profile.resolution.matchMode, 'exact');
assert.deepEqual(profile.priorityKeys, [
  'agilityBoost',
  'allCorrosion',
  'allDmgBonus',
  'allResistanceIgnore',
  'allSkillDmgBonus',
  'allStatBoost',
  'atk',
  'atkPercentBoost',
  'chainSkillDmgBonus',
  'critDmgBonusBoost',
  'critRateBoost',
  'dotDmgBonus',
  'flatAtk',
  'intelligenceBoost',
  'mainStatBoost',
  'multiplierBonus',
  'normalAttackDmgBonus',
  'physicalAmplify',
  'physicalCorrosion',
  'physicalDmgBonus',
  'physicalFragile',
  'physicalResistanceIgnore',
  'physicalVulnerability',
  'skillDmgBonus',
  'subStatBoost',
  'ultimateDmgBonus',
]);
assert.deepEqual(profile.skillButtonDistribution, { A: 1, B: 1, Dot: 1, E: 1, Q: 1 });
profile.priorities.forEach((priority) => {
  assert.ok(priority.weight > 0);
  assert.ok(priority.reason.length > 0);
  assert.ok(priority.evidence.path.length > 0);
  assert.ok(priority.evidence.paths.length > 0);
});
assert.equal(profile.priorities.find((priority) => priority.key === 'agilityBoost')?.evidence.path, 'operators[operator-luoxi].mainStat');
assert.equal(profile.priorities.find((priority) => priority.key === 'physicalDmgBonus')?.evidence.path, 'operators[operator-luoxi].element');
assert.equal(profile.priorityKeys.includes('allElementDmgBonus'), false, 'physical operators must not receive the magic-only all-element dimension');
assert.equal(profile.priorityKeys.includes('sourceSkillBoost'), false, 'B skills must not be conflated with source-skill strength');
assert.equal(AGENT_LOADOUT_CANONICAL_TYPE_KEY_MAP.weaponStatTypes['攻击提升'], 'atkPercentBoost');
assert.equal(AGENT_LOADOUT_CANONICAL_TYPE_KEY_MAP.equipmentFixedStats.flatAtk, 'flatAtk');

const currentRawStatTypeExpected = {
  atkPercent: 'atkPercentBoost',
  mainStat: 'mainStatBoost',
  critRate: 'critRateBoost',
  memoryStrength: 'sourceSkillBoost',
  burnDmgBonus: 'fireDmgBonus',
  '强攻·武装整备': 'flatAtk',
} as const;
assert.deepEqual(
  Object.fromEntries(Object.keys(currentRawStatTypeExpected).map((rawType) => [
    rawType,
    AGENT_LOADOUT_CANONICAL_TYPE_KEY_MAP.weaponStatTypes[rawType as keyof typeof AGENT_LOADOUT_CANONICAL_TYPE_KEY_MAP.weaponStatTypes],
  ])),
  currentRawStatTypeExpected,
  'current public/data/weapons statType values use the existing audited canonical aliases',
);

const defaultArchive = JSON.parse(readFileSync(
  new URL('../../../public/data/default-local-data.json', import.meta.url),
  'utf8',
)) as {
  storage: { local: Record<string, unknown> };
};
const archivedWeaponLibrary = defaultArchive.storage.local['def.weapon-sheet.library.v1'] as Record<string, {
  skills?: Record<string, { statType?: string }>;
}>;
const realStatTypes = [...new Set(Object.values(archivedWeaponLibrary).flatMap((entry) => (
  Object.values(entry.skills ?? {}).map((skill) => skill.statType ?? '')
)))].filter((statType) => statType && statType !== 'special').sort();
const unmappedRealStatTypes = realStatTypes.filter((statType) => !Object.keys(
  AGENT_LOADOUT_CANONICAL_TYPE_KEY_MAP.weaponStatTypes,
).includes(statType));
assert.deepEqual(unmappedRealStatTypes, [], `all real 1.8 non-special statTypes must use the closed map: ${unmappedRealStatTypes.join(', ')}`);

const makeCurrentStatTypeWeapon = (
  id: string,
  statTypes: readonly [string, string, string],
  rawLevelValue: number,
) => ({
  id,
  name: id,
  rarity: 6,
  type: '单手剑',
  attackGrowth: { '90': 100 },
  skills: {
    skill1: {
      name: '当前字段一',
      statType: statTypes[0],
      effects: {},
      levels: { '1': { value: rawLevelValue, description: 'raw value must not score' } },
    },
    skill2: {
      name: '当前字段二',
      statType: statTypes[1],
      effects: {},
      levels: { '1': { value: rawLevelValue, description: 'raw value must not score' } },
    },
    skill3: {
      name: '当前字段三',
      statType: statTypes[2],
      effects: {},
      levels: { '1': { value: rawLevelValue, description: 'raw value must not score' } },
    },
  },
});
const buildCurrentStatTypeInput = (rawLevelValue: number): AgentProductCatalogInput => ({
  operators: {
    'operator-current-stat-types': {
      ...operator,
      id: 'operator-current-stat-types',
      name: '当前词条测试干员',
      element: 'fire',
      skills: {
        'skill-a': makeSkill('A', 'skill-a', 'fire'),
        'skill-b': makeSkill('B', 'skill-b', 'fire'),
        'skill-e': makeSkill('E', 'skill-e', 'fire'),
        'skill-q': makeSkill('Q', 'skill-q', 'fire'),
        'skill-dot': makeSkill('Dot', 'skill-dot', 'fire'),
      },
    },
  },
  weapons: {
    'weapon-current-stat-a': makeCurrentStatTypeWeapon(
      'weapon-current-stat-a',
      ['atkPercent', 'mainStat', 'critRate'],
      rawLevelValue,
    ),
    'weapon-current-stat-b': makeCurrentStatTypeWeapon(
      'weapon-current-stat-b',
      ['memoryStrength', 'burnDmgBonus', ''],
      rawLevelValue,
    ),
  },
  equipment: { schemaVersion: 2, gearSets: {} },
});
const currentStatTypeRecommendation = recommendWeapons(
  buildCurrentStatTypeInput(0.000001),
  '当前词条测试干员',
);
assert.equal(currentStatTypeRecommendation.status, 'PARTIAL');
assert.equal(
  currentStatTypeRecommendation.candidates.find((candidate) => candidate.id === 'weapon-current-stat-a')?.unresolved.length,
  0,
);
assert.equal(
  currentStatTypeRecommendation.candidates.find((candidate) => candidate.id === 'weapon-current-stat-b')?.unresolved.some(
    (item) => item.value === 'sourceSkillBoost' && item.reason.includes('not established'),
  ),
  true,
  'source-skill strength is mapped exactly but remains partial without anomaly applicability facts',
);
const scoredCurrentCanonicalTypes = new Set(
  currentStatTypeRecommendation.candidates.flatMap((candidate) => (
    candidate.scoreComponents.map((component) => component.typeKey)
  )),
);
['atkPercentBoost', 'mainStatBoost', 'critRateBoost', 'fireDmgBonus'].forEach((typeKey) => {
  assert.equal(scoredCurrentCanonicalTypes.has(typeKey), true);
});
assert.equal(scoredCurrentCanonicalTypes.has('sourceSkillBoost'), false);
const fireProfile = deriveProfile(buildCurrentStatTypeInput(1), '当前词条测试干员');
['magicDmgBonus', 'allElementDmgBonus', 'fireDmgBonus', 'magicFragile', 'magicVulnerability'].forEach((typeKey) => {
  assert.equal(fireProfile.priorityKeys.includes(typeKey), true, `fire profile should include ${typeKey}`);
});
assert.equal(fireProfile.priorityKeys.includes('physicalDmgBonus'), false);
assert.deepEqual(
  recommendWeapons(buildCurrentStatTypeInput(999999999), '当前词条测试干员'),
  currentStatTypeRecommendation,
  'changing raw skill level values must not alter fact-key scoring',
);

const withLegacyGuide = {
  ...input,
  guide: '旧 1.2 guide：把这把武器写成必选。',
} as AgentProductCatalogInput & { guide: string };
assert.deepEqual(deriveProfile(withLegacyGuide, '洛茜'), profile, 'legacy guide text must not enter the service input or output');

const normalizedProfile = deriveProfile(input, ' 洛-茜 ');
assert.equal(normalizedProfile.resolution.matchMode, 'normalized');
const ambiguousInput: AgentProductCatalogInput = {
  ...input,
  operators: {
    ...(input.operators as Record<string, unknown>),
    duplicate: { ...operator, id: 'duplicate', name: '重名干员' },
    duplicate2: { ...operator, id: 'duplicate2', name: '重名干员' },
  },
};
const ambiguousProfile = deriveProfile(ambiguousInput, '重名干员');
assert.equal(ambiguousProfile.status, 'OPERATOR_AMBIGUOUS');
assert.deepEqual(ambiguousProfile.priorityKeys, []);

const weaponRecommendations = recommendWeapons(input, profile);
assert.equal(weaponRecommendations.compatibleCount, 5);
assert.equal(weaponRecommendations.excludedIncompatibleCount, 1);
assert.deepEqual(weaponRecommendations.candidates.map((candidate) => candidate.id), [
  'weapon-alpha',
  'weapon-beta',
  'weapon-conditional',
  'weapon-stat-only',
  'weapon-unknown',
]);
assert.equal(weaponRecommendations.status, 'PARTIAL', 'unmapped effect typeKey makes the catalog result incomplete');
assert.equal(weaponRecommendations.candidates[0]?.score, weaponRecommendations.candidates[1]?.score);
assert.equal(weaponRecommendations.candidates[0]?.tied, true);
assert.equal(weaponRecommendations.candidates[1]?.tied, true);
assert.deepEqual(weaponRecommendations.candidates.map((candidate) => candidate.rank), [1, 1, 3, 4, 4]);
assert.equal(weaponRecommendations.candidates[3]?.tied, true, 'a lower equal-score group also shares rank and tied=true');
assert.equal(weaponRecommendations.candidates[4]?.tied, true);
assert.equal(weaponRecommendations.candidates[2]?.conditional, true);
assert.match(weaponRecommendations.candidates[2]?.tradeoffs[0] ?? '', /条件效果/u);
assert.equal(weaponRecommendations.candidates.some((candidate) => candidate.id === 'weapon-wrong-type'), false);
assert.equal(
  weaponRecommendations.candidates[0]?.scoreComponents.some((component) => component.evidencePath.endsWith('.statType') && component.typeKey === 'atkPercentBoost'),
  true,
  JSON.stringify(weaponRecommendations.candidates[0]?.scoreComponents),
);
assert.equal(weaponRecommendations.candidates[0]?.scoreComponents.some((component) => component.evidencePath.endsWith('.statType') && component.typeKey === 'agilityBoost'), true);
assert.deepEqual(
  ['allDmgBonus', 'allElementDmgBonus', 'skillDmgBonus'].map((typeKey) => (
    weaponRecommendations.candidates[0]?.scoreComponents.some((component) => component.typeKey === typeKey)
  )),
  [true, false, true],
  'physical operators score generic damage/skill facts but not the magic-only all-element dimension',
);
assert.equal(JSON.stringify(weaponRecommendations).includes('0.2'), false, 'raw effect values must not enter scoring output');

const renamedAndReclassifiedInput: AgentProductCatalogInput = {
  ...input,
  operators: {
    [operator.id]: { ...operator, profession: '不参与评分的职业' },
  },
  weapons: {
    ...(input.weapons as Record<string, ReturnType<typeof weapon>>),
    'weapon-alpha': {
      ...(input.weapons as Record<string, ReturnType<typeof weapon>>)['weapon-alpha']!,
      name: 'ZZZ 展示名',
      rarity: 1,
    },
    'weapon-beta': {
      ...(input.weapons as Record<string, ReturnType<typeof weapon>>)['weapon-beta']!,
      name: 'AAA 展示名',
      rarity: 99,
    },
  },
};
const renamedRecommendations = recommendWeapons(renamedAndReclassifiedInput, '洛茜');
assert.deepEqual(
  renamedRecommendations.candidates.map(({ id, rank, tied, score }) => ({ id, rank, tied, score })),
  weaponRecommendations.candidates.map(({ id, rank, tied, score }) => ({ id, rank, tied, score })),
  'name, rarity and profession changes must not alter scoring or ID order',
);

const namedRecommendation = recommendNamedSet(input, profile, '精准 套');
assert.equal(namedRecommendation.targetSet?.id, normalizedTargetSetId);
assert.equal(namedRecommendation.candidates.length > 0, true);
assert.equal(namedRecommendation.candidates.every((candidate) => Object.values(candidate.pieces).filter((piece) => piece.gearSetId === normalizedTargetSetId).length === 3), true);
assert.equal(namedRecommendation.candidates.every((candidate) => Object.values(candidate.pieces).filter((piece) => piece.gearSetId !== normalizedTargetSetId).length === 1), true);
assert.equal(
  namedRecommendation.candidates[0]?.conditional,
  namedRecommendation.candidates[0]?.scoreComponents.some((component) => component.condition === 'conditional'),
  'conditional state must describe selected evidence rather than merely present duplicate facts',
);
assert.equal(namedRecommendation.candidates[0]?.scoreComponents.some((component) => component.source === 'setBuff'), true);
assert.equal(namedRecommendation.candidates[0]?.scoreComponents.some((component) => component.source === 'equipment'), true);
assert.equal(
  namedRecommendation.candidates.some((candidate) => candidate.scoreComponents.some((component) => (
    component.evidencePath.endsWith('.fixedStat.typeKey') && component.typeKey === 'flatAtk'
  ))),
  true,
);
assert.equal(namedRecommendation.status, 'READY');
assert.equal((namedRecommendation.candidates[0]?.score ?? 0) > (namedRecommendation.candidates[1]?.score ?? 0), true);
assert.equal(namedRecommendation.combinationsExhaustive, true);
assert.equal(namedRecommendation.totalCombinationCount, namedRecommendation.enumeratedCombinationCount);
assert.equal(namedRecommendation.combinationLimit, 512);

const discovered = recommendDiscoveredSets(input, profile);
assert.equal(discovered.evaluatedSetCount, 2);
assert.equal(discovered.candidateSetCount, 2);
assert.equal(discovered.traversalExhaustive, true);
assert.equal(discovered.status, 'READY');
assert.deepEqual(discovered.candidates.map((candidate) => candidate.name), ['精准套', '对照套']);

const truncationWeapons = Object.fromEntries(Array.from({ length: 257 }, (_, index) => {
  const id = `zz-truncation-${String(index).padStart(3, '0')}`;
  return [id, weapon(id, `截断样本 ${index}`, '单手剑', {})];
}));
const truncatedInput: AgentProductCatalogInput = {
  ...input,
  weapons: {
    ...(input.weapons as Record<string, ReturnType<typeof weapon>>),
    ...truncationWeapons,
  },
};
assert.equal(deriveProfile(truncatedInput, '洛茜').status, 'PARTIAL');
const truncatedWeapons = recommendWeapons(truncatedInput, '洛茜');
assert.equal(truncatedWeapons.catalogCoverage.domains.weapons.exhaustive, false);
assert.equal(truncatedWeapons.status, 'PARTIAL');
assert.equal(truncatedWeapons.catalogCoverage.domains.weapons.truncated, true);
const truncatedDiscovered = recommendDiscoveredSets(truncatedInput, '洛茜');
assert.equal(truncatedDiscovered.status, 'PARTIAL');
assert.equal(
  truncatedDiscovered.traversalExhaustive,
  true,
  'weapon-directory truncation degrades the shared profile but does not make gear-set traversal non-exhaustive',
);

const missingOffSet: AgentProductCatalogInput = {
  ...input,
  equipment: { gearSets: { 'set-alpha': targetSet } },
};
const noPlan = recommendNamedSet(missingOffSet, '洛茜', '精准套');
assert.equal(noPlan.status, 'NO_PLAN');
assert.equal(noPlan.candidates.length, 0);

const stressTargetEquipments = Object.fromEntries([
  ...Array.from({ length: 4 }, (_, index) => {
    const id = `stress-armor-${index}`;
    return [id, gearPiece(id, `压力护甲${index}`, '护甲')];
  }),
  ...Array.from({ length: 4 }, (_, index) => {
    const id = `stress-glove-${index}`;
    return [id, gearPiece(id, `压力护手${index}`, '护手')];
  }),
  ...Array.from({ length: 16 }, (_, index) => {
    const id = `stress-accessory-${index}`;
    return [id, gearPiece(id, `压力配件${index}`, '配件')];
  }),
]);
const stressOffEquipments = Object.fromEntries([
  ...Array.from({ length: 8 }, (_, index) => {
    const id = `off-armor-${index}`;
    return [id, gearPiece(id, `散件护甲${index}`, '护甲')];
  }),
  ...Array.from({ length: 8 }, (_, index) => {
    const id = `off-glove-${index}`;
    return [id, gearPiece(id, `散件护手${index}`, '护手')];
  }),
  ...Array.from({ length: 32 }, (_, index) => {
    const id = `off-accessory-${index}`;
    return [id, gearPiece(id, `散件配件${index}`, '配件')];
  }),
]);
const stressInput: AgentProductCatalogInput = {
  operators: { [operator.id]: operator },
  weapons: { 'weapon-alpha': (input.weapons as Record<string, ReturnType<typeof weapon>>)['weapon-alpha']! },
  equipment: {
    schemaVersion: 2,
    gearSets: {
      'set-stress': {
        schemaVersion: 2,
        gearSetId: 'set-stress',
        name: '压力套',
        threePieceBuffs: {
          stressBuff: {
            effectId: 'stressBuff',
            name: '压力物理增益',
            category: 'passive',
            typeKey: 'physicalDmgBonus',
            value: 100000,
            unit: 'percent',
          },
        },
        equipments: stressTargetEquipments,
      },
      'set-stress-off': {
        schemaVersion: 2,
        gearSetId: 'set-stress-off',
        name: '压力散件套',
        threePieceBuffs: {},
        equipments: stressOffEquipments,
      },
    },
  },
};
const stressSnapshot = JSON.stringify(stressInput);
const boundedCombinations = recommendNamedSet(stressInput, '洛茜', '压力套', {
  limit: 7,
  allowDuplicateCompatibleAccessories: true,
});
assert.equal(boundedCombinations.status, 'PARTIAL');
assert.equal(boundedCombinations.combinationLimit, 7);
assert.equal(boundedCombinations.enumeratedCombinationCount, 7);
assert.equal(boundedCombinations.candidates.length, 7, 'bounded traversal never allocates beyond the requested leaf limit');
assert.equal(boundedCombinations.totalCombinationCount, null);
assert.equal(boundedCombinations.combinationsExhaustive, false);
const boundedDiscovered = recommendDiscoveredSets(stressInput, '洛茜', {
  combinationLimit: 5,
  allowDuplicateCompatibleAccessories: true,
});
assert.equal(boundedDiscovered.status, 'PARTIAL');
assert.equal(boundedDiscovered.traversalExhaustive, false);
assert.equal(boundedDiscovered.candidates.every((candidate) => candidate.combinationLimit === 5), true);
assert.equal(boundedDiscovered.candidates.every((candidate) => candidate.combinationsEvaluated <= 5), true);

const capsuleA: AgentLoadoutCapsule = {
  contract: 'DefTeamLoadoutsV1',
  complete: false,
  missingCharacterIds: ['operator-other'],
  operators: [
    {
      character: {
        id: 'operator-other',
        name: '其他干员',
        element: null,
        profession: null,
        librarySource: null,
      },
      weapon: null,
      equipment: [],
      setBuffs: [],
      operatorSkillLevels: null,
      configured: false,
    },
    {
      character: {
        id: 'operator-luoxi',
        name: '洛茜',
        element: 'physical',
        profession: '近卫',
        librarySource: 'browser-sqlite-mirror',
      },
      weapon: {
        id: 'weapon-alpha',
        name: '甲剑',
        level: 90,
        potential: '5',
        attack: 99999,
        skillLevels: { skill1: 9, skill2: 9, skill3: 9 },
      },
      equipment: [
        {
          slotKey: 'armor',
          equipmentId: alphaArmorCatalogId,
          name: '精准护甲',
          part: '护甲',
          effects: [{ effectId: 'effect1', label: '敏捷', typeKey: 'agilityBoost', level: 3, value: 113 }],
        },
        {
          slotKey: 'glove',
          equipmentId: alphaGloveCatalogId,
          name: '精准护手',
          part: '护手',
          effects: [{ effectId: 'effect1', label: '全技能', typeKey: 'allSkillDmgBonus', level: 3, value: 0.2 }],
        },
        {
          slotKey: 'accessory1',
          equipmentId: alphaAccessoryACatalogId,
          name: '精准配件甲',
          part: '配件',
          effects: [{ effectId: 'effect1', label: '源石技艺', typeKey: 'sourceSkillBoost', level: 3, value: 777 }],
        },
        {
          slotKey: 'accessory2',
          equipmentId: alphaAccessoryBCatalogId,
          name: '精准配件乙',
          part: '配件',
          effects: [{ effectId: 'effect1', label: '物理', typeKey: 'physicalDmgBonus', level: 3, value: 0.99 }],
        },
      ],
      setBuffs: [
        {
          gearSetId: normalizedTargetSetId,
          gearSetName: '精准套',
          effectId: 'alphaPhysical',
          label: '物理易伤',
          typeKey: 'physicalFragile',
          value: 999,
          category: 'passive',
        },
        {
          gearSetId: normalizedTargetSetId,
          gearSetName: '精准套',
          effectId: 'alphaConditional',
          label: '条件增益',
          typeKey: 'agilityBoost',
          value: 999,
          category: 'condition',
        },
      ],
      operatorSkillLevels: { A: 'M3' },
      configured: true,
    },
  ],
};
const capsuleB: AgentLoadoutCapsule = {
  contract: 'DefTeamLoadoutsV1',
  complete: true,
  missingCharacterIds: [],
  operators: [{
    character: {
      id: 'operator-luoxi',
      name: '洛茜',
      element: 'physical',
      profession: '近卫',
      librarySource: 'browser-sqlite-mirror',
    },
    weapon: { id: 'weapon-conditional', name: '条件剑', level: 90, potential: '0', attack: 1 },
    equipment: [
      { slotKey: 'armor', equipmentId: betaArmorCatalogId, name: '对照护甲', part: '护甲', effects: [] },
      { slotKey: 'glove', equipmentId: betaGloveCatalogId, name: '对照护手', part: '护手', effects: [] },
      { slotKey: 'accessory1', equipmentId: betaAccessoryACatalogId, name: '对照配件甲', part: '配件', effects: [] },
      { slotKey: 'accessory2', equipmentId: betaAccessoryBCatalogId, name: '对照配件乙', part: '配件', effects: [] },
    ],
    setBuffs: [{
      gearSetId: normalizedSecondSetId,
      gearSetName: '对照套',
      effectId: 'betaIntelligence',
      label: '智识增益',
      typeKey: 'intelligenceBoost',
      value: 12345,
      category: 'passive',
    }],
    operatorSkillLevels: {},
    configured: true,
  }],
};
const capsuleASnapshot = JSON.stringify(capsuleA);
const evaluationA = evaluateCurrent(input, '洛茜', capsuleA);
assert.equal(evaluationA.status, 'READY');
assert.equal(evaluationA.matches.some((match) => match.path === 'weapons[weapon-alpha].skills[skill1].statType'), true);
assert.equal(evaluationA.matches.some((match) => match.path === `equipment[${alphaArmorCatalogId}].fixedStat.typeKey`), true);
assert.equal(evaluationA.matches.some((match) => match.path === `gearSets[${normalizedTargetSetId}].threePieceBuffs[alphaPhysical]`), true);
assert.equal(evaluationA.conflicts.length, 0);
assert.equal(evaluationA.unresolved.length, 0);
const directProjectedEvaluation = evaluateCurrent(input, '洛茜', capsuleA.operators![1]!);
assert.equal(directProjectedEvaluation.status, 'PARTIAL');
assert.equal(directProjectedEvaluation.score, 0, 'direct projected operators are rejected instead of bypassing Host validation');
assert.equal(directProjectedEvaluation.unresolved[0]?.path, 'capsule');

const magnitudeChangedCapsule = JSON.parse(JSON.stringify(capsuleA)) as AgentLoadoutCapsule;
magnitudeChangedCapsule.operators![1]!.weapon!.attack = -123456;
magnitudeChangedCapsule.operators![1]!.equipment![0]!.effects![0]!.value = -999;
magnitudeChangedCapsule.operators![1]!.setBuffs![0]!.value = -999;
assert.equal(
  evaluateCurrent(input, '洛茜', magnitudeChangedCapsule).score,
  evaluationA.score,
  'projected raw values are not added across effect types',
);

const missingEvaluation = evaluateCurrent(input, '洛茜', { weapon: { id: 'weapon-alpha' } });
assert.equal(missingEvaluation.status, 'PARTIAL');
assert.equal(missingEvaluation.score, 0);
assert.equal(missingEvaluation.unresolved.some((item) => item.path === 'capsule'), true);

const unknownIdsComparison = compareCurrentWithCandidate(input, '洛茜', capsuleA, {
  weaponId: 'missing-weapon',
  equipment: [
    { slotKey: 'armor', equipmentId: 'missing-armor' },
    { slotKey: 'glove', equipmentId: 'missing-glove' },
    { slotKey: 'accessory1', equipmentId: 'missing-accessory-1' },
    { slotKey: 'accessory2', equipmentId: 'missing-accessory-2' },
  ],
});
assert.equal(unknownIdsComparison.b.status, 'PARTIAL');
assert.equal(unknownIdsComparison.b.score, 0, 'unknown stable ids cannot gain score from caller-authored facts');
assert.equal(unknownIdsComparison.b.unresolved.length, 5);

const conflictComparison = compareCurrentWithCandidate(input, '洛茜', capsuleA, {
  weaponId: 'weapon-wrong-type',
});
assert.equal(
  conflictComparison.b.conflicts[0]?.reason,
  'catalog weapon type does not match the resolved operator weaponType',
);

const duplicateEquipmentCapsule = JSON.parse(JSON.stringify(capsuleA)) as AgentLoadoutCapsule;
duplicateEquipmentCapsule.operators![1]!.equipment![3]!.equipmentId = alphaAccessoryACatalogId;
const duplicateEquipmentEvaluation = evaluateCurrent(input, '洛茜', duplicateEquipmentCapsule);
assert.equal(duplicateEquipmentEvaluation.status, 'PARTIAL');
assert.equal(duplicateEquipmentEvaluation.unresolved.some((item) => item.reason.includes('duplicate equipment stable id')), true);
assert.equal(duplicateEquipmentEvaluation.score <= evaluationA.score, true, 'duplicate ids must never multiply fact coverage');

const duplicateSlotCapsule = JSON.parse(JSON.stringify(capsuleA)) as AgentLoadoutCapsule;
duplicateSlotCapsule.operators![1]!.equipment![3]!.slotKey = 'accessory1';
const duplicateSlotEvaluation = evaluateCurrent(input, '洛茜', duplicateSlotCapsule);
assert.equal(duplicateSlotEvaluation.status, 'PARTIAL');
assert.equal(duplicateSlotEvaluation.score, 0, 'strict capsule validation rejects duplicate slots before scoring');

const mismatchedSetCapsule = JSON.parse(JSON.stringify(capsuleA)) as AgentLoadoutCapsule;
mismatchedSetCapsule.operators![1]!.setBuffs = [];
const mismatchedSetEvaluation = evaluateCurrent(input, '洛茜', mismatchedSetCapsule);
assert.equal(mismatchedSetEvaluation.status, 'PARTIAL');
assert.equal(mismatchedSetEvaluation.conflicts.some((item) => item.reason.includes('set Buff')), true);

const alphaCatalogWeapon = catalog.weapons.results.find((item) => item.id === 'weapon-alpha');
assert.ok(alphaCatalogWeapon);
const duplicateWeaponCount = catalog.weapons.results.length + 1;
const ambiguousWeaponCatalog = {
  ...catalog,
  weapons: {
    ...catalog.weapons,
    catalogCount: duplicateWeaponCount,
    queryCount: duplicateWeaponCount,
    resultCount: duplicateWeaponCount,
    results: [...catalog.weapons.results, { ...alphaCatalogWeapon }],
  },
};
const ambiguousWeaponEvaluation = evaluateCurrent(ambiguousWeaponCatalog, '洛茜', capsuleA);
assert.equal(ambiguousWeaponEvaluation.status, 'NO_PROFILE');
assert.equal(ambiguousWeaponEvaluation.score, 0, 'externally forged prebuilt catalogs are never trusted as service-owned catalogs');

const duplicateRawInput: AgentProductCatalogInput = {
  ...input,
  weapons: {
    ...(input.weapons as Record<string, ReturnType<typeof weapon>>),
    duplicateAlpha: {
      ...(input.weapons as Record<string, ReturnType<typeof weapon>>)['weapon-alpha']!,
    },
  },
};
const duplicateRawProfile = deriveProfile(duplicateRawInput, '洛茜');
const duplicateRawRecommendation = recommendWeapons(duplicateRawInput, '洛茜');
assert.equal(duplicateRawRecommendation.status, 'PARTIAL');
assert.equal(duplicateRawProfile.unresolved.some((item) => item.reason.includes('stable catalog id is duplicated')), true);
assert.equal(duplicateRawRecommendation.candidates.some((candidate) => candidate.id === 'weapon-alpha'), false);

const comparison = compare(input, '洛茜', capsuleA, capsuleB);
assert.equal(comparison.status, 'A');
assert.equal(comparison.delta > 0, true);
assert.deepEqual(comparison.deltaComponents.map((component) => component.key), profile.priorityKeys);
assert.equal(comparison.a.status, 'READY');
assert.equal(comparison.b.status, 'READY');

const currentVsCandidate = compareCurrentWithCandidate(input, '洛茜', capsuleA, {
  weaponId: 'weapon-conditional',
});
assert.equal(currentVsCandidate.a.status, 'READY');
assert.equal(currentVsCandidate.b.status, 'READY');
assert.equal(currentVsCandidate.status, 'A');
const candidateVsCandidate = compareCandidateLoadouts(
  input,
  '洛茜',
  capsuleA,
  { weaponId: 'weapon-alpha' },
  { weaponId: 'weapon-conditional' },
);
assert.equal(candidateVsCandidate.status, 'A');

const reorderedInput: AgentProductCatalogInput = {
  operators: Object.fromEntries(Object.entries(input.operators as Record<string, unknown>).reverse()),
  weapons: Object.fromEntries(Object.entries(input.weapons as Record<string, unknown>).reverse()),
  equipment: {
    schemaVersion: 2,
    gearSets: Object.fromEntries(Object.entries((input.equipment as { gearSets: Record<string, unknown> }).gearSets).reverse()),
  },
};
assert.deepEqual(
  recommendWeapons(reorderedInput, '洛茜'),
  weaponRecommendations,
  'catalog insertion order must not alter ranks, evidence, or stable-id ordering',
);

const generic = recommend(input, '洛茜');
assert.equal(generic.profile.policy, 'deterministic-fact-coverage-v1');
assert.equal(generic.weapons.operator.operator?.id, 'operator-luoxi');
assert.equal(generic.discoveredSets.candidates.length, 2);

const archiveStorage = {
  getItem(key: string): string | null {
    const value = defaultArchive.storage.local[key];
    return value === undefined ? null : JSON.stringify(value);
  },
};
const realArchiveInput = {
  ...readAgentProductCatalogInput(archiveStorage),
  operators: input.operators,
};
const realArchiveCatalog = buildAgentProductCatalog(realArchiveInput, { limit: 256 });
const realArchiveOperator = realArchiveCatalog.operators.results[0];
assert.ok(realArchiveOperator, 'the shipped 1.8 archive must expose at least one operator');
const realRecommendationStartedAt = performance.now();
const realArchiveDiscovered = recommendDiscoveredSets(realArchiveInput, realArchiveOperator.name, {
  limit: 256,
  combinationLimit: 4_096,
});
const realRecommendationElapsedMs = performance.now() - realRecommendationStartedAt;
assert.equal(realArchiveDiscovered.evaluatedSetCount, realArchiveCatalog.gearSets.catalogCount);
assert.equal(
  realArchiveDiscovered.candidates.every((candidate) => (
    candidate.inspectedLeafCount >= candidate.combinationsEvaluated
    && candidate.combinationsEvaluated <= candidate.combinationLimit
  )),
  true,
  'real 1.8 traversal must expose and honor its deterministic inspection bounds',
);
assert.equal(realRecommendationElapsedMs < 10_000, true, `real 1.8 recommendation took ${realRecommendationElapsedMs.toFixed(1)}ms`);

assert.doesNotThrow(() => JSON.parse(JSON.stringify({
  profile,
  weaponRecommendations,
  namedRecommendation,
  discovered,
  boundedCombinations,
  boundedDiscovered,
  evaluationA,
  comparison,
  realArchiveDiscovered,
})));
assert.equal(JSON.stringify(input), inputSnapshot, 'catalog input was not mutated');
assert.equal(JSON.stringify(capsuleA), capsuleASnapshot, 'projected DefTeamLoadoutsV1-like capsule was not mutated');
assert.equal(JSON.stringify(stressInput), stressSnapshot, 'stress fixture was not mutated');

console.log('Agent loadout recommendation service contract: PASS');
