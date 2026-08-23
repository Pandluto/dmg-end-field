import { buildConfigSnapshot } from '../core/calculators/operatorPanelCalculator';
import type {
  ConfigSnapshot,
  EquipmentPieceInput,
  OperatorPanelInput,
} from '../core/calculators/operatorPanelCalculator';
import { calculateSkillButtonDamageV2 } from '../core/calculators/skillButtonDamageCalculatorV2';
import { calculateBuffTotals } from '../core/calculators/buffCalculator';
import type {
  ResolvedHitTemplate,
  ResolvedSkillDamageTemplate,
  SkillDamagePanelBase,
} from '../core/calculators/skillDamage.types';
import { buildOperatorEquipmentSetBuffs } from '../core/services/operatorEquipmentLibrary';
import {
  buildAnomalyStateDerivedBuffs,
  buildAnomalyStateSnapshotBuffs,
} from '../core/services/anomalyStateBuffs';
import type { DamageReportSourceFilter, RdpsSourceKey } from '../core/services/rdpsAttribution.types';
import { buildRdpsSourceKey, parseRdpsSourceKey } from '../core/services/rdpsAttribution.types';
import {
  computeRdpsAttributionFromApplications,
  type RdpsAttributableApplication,
} from '../core/services/rdpsContributionService';
import {
  buffApplicationKeyOf,
  buildRdpsResolutionContext,
  sourceKeyFromSidecar,
  type RdpsResolutionContext,
} from '../core/services/rdpsSourceResolutionContext';
import type { RdpsSourceSidecar } from '../core/services/rdpsSourceResolution.types';
import { resolveSingleHitMultiplierBonusTargets } from '../core/services/singleHitMultiplierBonus';
import { buildAnomalyDamageSegments } from '../components/CanvasBoard/skillButtonAnomalyDamage';
import type { Character, Skill, SkillType } from '../types';
import type { DamageBonusSnapshot, PersistedSkillButton, SkillButtonBuff } from '../types/storage';
import type {
  MobileCatalog,
  MobileDamageReport,
  MobileDamageReportRow,
  MobileDraft,
  MobileEquipmentSlotKey,
  MobileOperatorConfig,
  MobileRuntimeState,
  MobileSlotCalculation,
  MobileTimelineAction,
} from './model';

const EMPTY_DAMAGE_BONUS: DamageBonusSnapshot = {
  physicalDmgBonus: 0,
  fireDmgBonus: 0,
  electricDmgBonus: 0,
  iceDmgBonus: 0,
  natureDmgBonus: 0,
  magicDmgBonus: 0,
  normalAttackDmgBonus: 0,
  dotDmgBonus: 0,
  skillDmgBonus: 0,
  chainSkillDmgBonus: 0,
  ultimateDmgBonus: 0,
  allSkillDmgBonus: 0,
  imbalanceDmgBonus: 0,
  allDmgBonus: 0,
};

export function resolveMobileRuntimeDamageBonus(
  snapshot: ConfigSnapshot,
  imbalanceEnabled = true,
): DamageBonusSnapshot {
  // `display.damageBonus` is already expanded for presentation (for example,
  // magic/all-skill bonuses are folded into every matching element/skill).
  // Feeding it back into the shared damage calculator applies those broad
  // bonuses a second time. Keep runtime calculation on the raw zone inputs,
  // matching the desktop report and CharacterComputed cache.
  const rawDamageBonus = snapshot.panel.calc.damageBonus ?? EMPTY_DAMAGE_BONUS;
  return imbalanceEnabled
    ? rawDamageBonus
    : { ...rawDamageBonus, imbalanceDmgBonus: 0 };
}

function getCharacterById(catalog: MobileCatalog, characterId: string): Character | null {
  return catalog.characters.find((character) => character.id === characterId) ?? null;
}

function getEquipmentPieces(
  config: MobileOperatorConfig,
  catalog: MobileCatalog,
): EquipmentPieceInput[] {
  const allEquipment = Object.values(catalog.equipment.gearSets)
    .flatMap((gearSet) => Object.values(gearSet.equipments));

  return (Object.entries(config.equipment) as Array<[
    MobileEquipmentSlotKey,
    MobileOperatorConfig['equipment'][MobileEquipmentSlotKey],
  ]>).flatMap(([slotKey, selection]) => {
    if (!selection.equipmentId) return [];
    const item = allEquipment.find((candidate) => candidate.equipmentId === selection.equipmentId);
    if (!item) return [];
    const effects = Object.entries(item.effects).flatMap(([effectId, effect]) => {
      if (!effect) return [];
      const level = selection.effectLevels[effectId as keyof typeof selection.effectLevels] ?? 0;
      const value = effect.levels[String(level) as keyof typeof effect.levels] ?? 0;
      return [{
        effectId,
        label: effect.label,
        typeKey: effect.typeKey,
        level,
        value,
        unit: effect.unit,
        raw: effect.raw,
      }];
    });
    return [{
      slotKey,
      equipmentId: item.equipmentId,
      name: item.name,
      part: item.part,
      imgUrl: item.imgUrl,
      fixedStat: item.fixedStat,
      effects,
    }];
  });
}

export function buildMobileOperatorSnapshot(
  character: Character,
  config: MobileOperatorConfig,
  catalog: MobileCatalog,
): ConfigSnapshot {
  const weapon = catalog.weapons[config.weapon.weaponId];
  const equipmentPieces = getEquipmentPieces(config, catalog);
  const selectedEquipmentIds = equipmentPieces.map((piece) => piece.equipmentId);
  const input: OperatorPanelInput = {
    operator: {
      id: character.id,
      name: character.name,
      level: config.level,
      potential: config.potential,
      element: character.element,
      mainStat: character.mainStat,
      subStat: character.subStat,
      favorValue: config.favorValue,
      mainStatFlatBonus: config.mainStatFlatBonus,
      subStatFlatBonus: config.subStatFlatBonus,
      skillConfig: config.skillLevels,
      attributes: character.attributes,
      buffs: character.operatorBuffs as OperatorPanelInput['operator']['buffs'],
    },
    weapon: {
      id: weapon?.id ?? '',
      name: weapon?.name ?? '',
      config: {
        level: config.weapon.level,
        potential: config.weapon.potential,
        skillLevels: config.weapon.skillLevels,
      },
      data: {
        attackGrowth: weapon?.attackGrowth ?? {},
        skills: weapon?.skills ?? {},
      },
    },
    equipment: {
      pieces: equipmentPieces,
      setBuffs: buildOperatorEquipmentSetBuffs(selectedEquipmentIds, catalog.equipment),
    },
  };
  return buildConfigSnapshot(input);
}

function legacySkillForType(character: Character, skillType: SkillType): Skill | null {
  if (skillType === 'A') return character.skills.normalAttack;
  if (skillType === 'B') return character.skills.skill;
  if (skillType === 'E') return character.skills.chainSkill;
  if (skillType === 'Q') return character.skills.ultimate;
  return null;
}

function buildLegacyHits(
  skill: Skill | null,
  skillType: SkillType,
  character: Character,
  levelKey: string,
): ResolvedHitTemplate[] {
  const multiplier = skill?.multipliers[levelKey]
    ?? skill?.multipliers.M3
    ?? skill?.multipliers.L9
    ?? {};
  return Object.entries(multiplier).flatMap(([key, value]) => (
    typeof value === 'number'
      ? [{
          key,
          displayName: key,
          multiplier: value,
          element: character.element,
          skillType,
        } satisfies ResolvedHitTemplate]
      : []
  ));
}

export function resolveMobileSkillTemplate(
  character: Character,
  config: MobileOperatorConfig,
  action: MobileTimelineAction,
): ResolvedSkillDamageTemplate {
  const sandboxSkill = character.sandboxSkills?.find((skill) => (
    skill.id === action.runtimeSkillId || skill.buttonType === action.skillType
  ));
  const levelKey = config.skillLevels[action.skillType] ?? 'M3';
  const frozenHits = action.customHits?.map((hit) => ({
    key: hit.key,
    displayName: hit.displayName,
    multiplier: hit.levels?.[levelKey] ?? hit.multiplier,
    element: hit.element,
    skillType: hit.skillType,
  })) ?? [];
  const sandboxHits = sandboxSkill?.customHits?.map((hit) => ({
    key: hit.key,
    displayName: hit.displayName,
    multiplier: hit.levels?.[levelKey] ?? hit.multiplier,
    element: hit.element,
    skillType: hit.skillType,
  })) ?? [];
  const legacySkill = legacySkillForType(character, action.skillType);
  const hits = frozenHits.length > 0
    ? frozenHits
    : sandboxHits.length > 0
      ? sandboxHits
    : buildLegacyHits(legacySkill, action.skillType, character, levelKey);

  return {
    characterId: character.id,
    characterName: character.name,
    runtimeSkillId: action.runtimeSkillId || `${character.id}-${action.skillType}`,
    displayName: action.skillName || sandboxSkill?.displayName || legacySkill?.name || action.skillType,
    buttonType: action.skillType,
    hits,
  };
}

function resolveAbilityField(value: string): SkillDamagePanelBase['mainStatField'] {
  if (value === '力量') return 'strength';
  if (value === '敏捷') return 'agility';
  if (value === '智识') return 'intelligence';
  if (value === '意志') return 'will';
  return undefined;
}

function buildPanelBase(snapshot: ConfigSnapshot): SkillDamagePanelBase {
  const calc = snapshot.panel.calc;
  const display = snapshot.panel.display;
  return {
    baseAtk: display.baseAtk,
    characterAtk: calc.operatorAtk,
    weaponAtk: calc.weaponAtk,
    weaponAtkPercent: display.weaponAtkPercent,
    abilityBonus: display.abilityBonus,
    critRate: display.critRate,
    critDmg: display.critDmg,
    strength: display.abilityValues.strength,
    agility: display.abilityValues.agility,
    intelligence: display.abilityValues.intelligence,
    will: display.abilityValues.will,
    mainStatFinal: display.mainStatFinal,
    subStatFinal: display.subStatFinal,
    mainStatRaw: display.abilityDetail.rawMainStat,
    subStatRaw: display.abilityDetail.rawSubStat,
    mainStatField: resolveAbilityField(snapshot.operator.mainStat),
    subStatField: resolveAbilityField(snapshot.operator.subStat),
    mainStatScale: display.abilityDetail.mainStatScale,
    subStatScale: display.abilityDetail.subStatScale,
    allStatScale: display.abilityDetail.allStatScale,
  };
}

function explicitMobileSourceKey(buff: SkillButtonBuff): RdpsSourceKey | null {
  if (typeof buff.ownerCharacterId !== 'string' || !buff.ownerCharacterId.trim()) return null;
  const domain = buff.ownerBuffDomain;
  if (domain !== 'operator' && domain !== 'weapon' && domain !== 'equipment') return null;
  return buildRdpsSourceKey(buff.ownerCharacterId, domain);
}

function mobileSourceKeyOf(
  actionId: string,
  buff: SkillButtonBuff,
  sidecar?: RdpsSourceSidecar,
): RdpsSourceKey | null {
  return (sidecar
    ? sourceKeyFromSidecar(sidecar, buffApplicationKeyOf(actionId, buff))
    : null) ?? explicitMobileSourceKey(buff);
}

function applyMobileSourceFilter(
  actionId: string,
  buffs: SkillButtonBuff[],
  filter?: DamageReportSourceFilter,
  sidecar?: RdpsSourceSidecar,
): SkillButtonBuff[] {
  if (!filter) return buffs;
  return buffs.filter((buff) => {
    if (filter.imbalanceEnabled === false && buff.type === 'imbalanceDmgBonus') return false;
    if (filter.enabledSourceKeys === undefined || filter.enabledSourceKeys === null) return true;
    const sourceKey = filter.sourceKeyOf?.(buff) ?? mobileSourceKeyOf(actionId, buff, sidecar);
    return sourceKey === null
      ? filter.unattributedBuffsEnabled !== false
      : filter.enabledSourceKeys.has(sourceKey);
  });
}

function calculateMobileSlot(
  slotId: string,
  action: MobileTimelineAction,
  catalog: MobileCatalog,
  config: MobileOperatorConfig,
  snapshot: ConfigSnapshot,
  operatorSnapshots: Record<string, ConfigSnapshot>,
  sourceFilter?: DamageReportSourceFilter,
  sourceSidecar?: RdpsSourceSidecar,
): MobileSlotCalculation | null {
  const character = getCharacterById(catalog, action.operatorId);
  if (!character) return null;
  const template = resolveMobileSkillTemplate(character, config, action);
  if (template.hits.length === 0) return null;
  const globallyDisabled = new Set(action.globallyDisabledBuffIds);
  const enabledBuffs = applyMobileSourceFilter(action.id, action.buffs, sourceFilter, sourceSidecar)
    .filter((buff) => !globallyDisabled.has(buff.id));
  const modifierBuffs = enabledBuffs.filter((buff) => buff.effectKind !== 'extraHit');
  const extraHitBuffs = enabledBuffs.filter((buff): buff is SkillButtonBuff & {
    effectKind: 'extraHit';
    extraHitConfig: NonNullable<SkillButtonBuff['extraHitConfig']>;
  } => buff.effectKind === 'extraHit' && Boolean(buff.extraHitConfig));
  const stateDerivedBuffs = applyMobileSourceFilter(
    action.id,
    buildAnomalyStateDerivedBuffs(action.anomalyStatuses ?? [], action.skillType),
    sourceFilter,
    sourceSidecar,
  );
  const anomalyStateBuffs = applyMobileSourceFilter(
    action.id,
    buildAnomalyStateSnapshotBuffs(action.anomalyStateSnapshots ?? []),
    sourceFilter,
    sourceSidecar,
  );
  const combinedModifierBuffs = [...modifierBuffs, ...stateDerivedBuffs, ...anomalyStateBuffs];
  const resolvedSingleHitBuffTargets = resolveSingleHitMultiplierBonusTargets(
    combinedModifierBuffs,
    template.hits,
    action.disabledBuffIdsByHitKey,
    action.singleHitBuffTargetByBuffId,
  );
  const effectiveDamageBonus = resolveMobileRuntimeDamageBonus(
    snapshot,
    sourceFilter?.imbalanceEnabled !== false,
  );
  const result = calculateSkillButtonDamageV2({
    buttonId: action.id,
    characterId: character.id,
    runtimeSkillId: template.runtimeSkillId,
    template,
    buffs: combinedModifierBuffs,
    buffStackCounts: action.buffStackCounts,
    buffStackCountsByHitKey: action.buffStackCountsByHitKey,
    panel: {
      atk: snapshot.panel.display.atk,
      critRate: snapshot.panel.display.critRate,
      critDmg: snapshot.panel.display.critDmg,
    },
    panelBase: buildPanelBase(snapshot),
    disabledBuffIdsByHitKey: action.disabledBuffIdsByHitKey,
    singleHitBuffTargetByBuffId: resolvedSingleHitBuffTargets,
    disabledHitKeys: action.disabledHitKeys,
    damageBonus: effectiveDamageBonus,
    targetResistance: action.targetResistance,
  });
  const specialSegments = buildAnomalyDamageSegments({
    panelBase: buildPanelBase(snapshot),
    panelData: {
      atk: snapshot.panel.display.atk,
      critRate: snapshot.panel.display.critRate,
      critDmg: snapshot.panel.display.critDmg,
    },
    hitCards: result.hits.map((hit) => ({
      displayName: hit.hit.displayName,
      nonCritText: hit.nonCrit.final.toFixed(0),
    })),
    selectedAnomalyDamages: action.anomalyDamages ?? [],
    buttonCharacterId: character.id,
    element: character.element,
    damageBonus: effectiveDamageBonus,
    targetResistance: action.targetResistance,
    fullCombinedModifierBuffList: combinedModifierBuffs,
    extraHitBuffList: extraHitBuffs,
    buffStackCounts: action.buffStackCounts,
    buffStackCountsBySegmentKey: action.buffStackCountsByHitKey,
    manuallyDisabledBuffIdsBySegmentKey: action.disabledBuffIdsByHitKey,
    singleHitBuffTargetByBuffId: resolvedSingleHitBuffTargets,
    disabledHitKeys: action.disabledHitKeys,
    getEffectiveCharacterSourceSkillBoost: (characterId, buffs = []) => (
      (characterId ? operatorSnapshots[characterId]?.panel.display.sourceSkill ?? 0 : 0)
      + calculateBuffTotals(buffs).sourceSkillBoost
    ),
  });
  const specialExpected = specialSegments.reduce((sum, segment) => sum + segment.expectedValue, 0);
  const specialCrit = specialSegments.reduce((sum, segment) => sum + segment.critValue, 0);
  const specialNonCrit = specialSegments.reduce((sum, segment) => sum + segment.nonCritValue, 0);
  const combinedResult = {
    ...result,
    summary: {
      totalExpected: result.summary.totalExpected + specialExpected,
      totalCrit: result.summary.totalCrit + specialCrit,
      totalNonCrit: result.summary.totalNonCrit + specialNonCrit,
    },
  };
  return {
    slotId,
    actionId: action.id,
    operatorId: character.id,
    operatorName: character.name,
    skillName: template.displayName,
    result: combinedResult,
    modifierBuffs: combinedModifierBuffs,
    specialSegments,
  };
}

function buildRows(
  entries: Array<{ id: string; label: string; expected: number }>,
  totalExpected: number,
): MobileDamageReportRow[] {
  return entries
    .filter((entry) => entry.expected > 0)
    .sort((left, right) => right.expected - left.expected)
    .map((entry) => ({
      ...entry,
      share: totalExpected > 0 ? entry.expected / totalExpected : 0,
    }));
}

function buildMobileDamageReport(
  calculations: MobileSlotCalculation[],
): MobileDamageReport {
  const totalExpected = calculations.reduce((sum, item) => sum + item.result.summary.totalExpected, 0);
  const totalCrit = calculations.reduce((sum, item) => sum + item.result.summary.totalCrit, 0);
  const totalNonCrit = calculations.reduce((sum, item) => sum + item.result.summary.totalNonCrit, 0);
  const operatorMap = new Map<string, { label: string; expected: number }>();
  const skillMap = new Map<string, { label: string; expected: number }>();
  calculations.forEach((item) => {
    const expected = item.result.summary.totalExpected;
    const operator = operatorMap.get(item.operatorId) ?? { label: item.operatorName, expected: 0 };
    operator.expected += expected;
    operatorMap.set(item.operatorId, operator);
    const skillId = `${item.operatorId}:${item.skillName}`;
    const skill = skillMap.get(skillId) ?? { label: `${item.operatorName} · ${item.skillName}`, expected: 0 };
    skill.expected += expected;
    skillMap.set(skillId, skill);
  });
  return {
    totalExpected,
    totalCrit,
    totalNonCrit,
    slotCount: calculations.length,
    byOperator: buildRows(
      [...operatorMap].map(([id, item]) => ({ id, ...item })),
      totalExpected,
    ),
    bySkill: buildRows(
      [...skillMap].map(([id, item]) => ({ id, ...item })),
      totalExpected,
    ),
  };
}

function readRawDescription(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = (raw as { description?: unknown; raw?: unknown }).description
    ?? (raw as { raw?: unknown }).raw;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function buildMobileConfigCandidateBuffs(
  snapshots: Record<string, ConfigSnapshot>,
): SkillButtonBuff[] {
  return Object.values(snapshots).flatMap((snapshot) => {
    const operatorBuffs = (['talent', 'potential', 'skill'] as const).flatMap((groupKey) => (
      Object.entries(snapshot.operator.buffs[groupKey]?.effects ?? {}).flatMap(([effectKey, effect]) => {
        if (effect.category === 'passive' || effect.category === 'positive') return [];
        return [{
          schemaVersion: 2,
          id: `mobile-operator:${snapshot.operator.id}:${groupKey}:${effectKey}`,
          name: effect.name || effect.effectId || effectKey,
          displayName: effect.name || effect.effectId || effectKey,
          sourceName: snapshot.operator.name,
          source: 'operator-config',
          level: groupKey,
          type: effect.type,
          value: effect.value,
          description: effect.description || effect.raw,
          category: effect.category === 'countable' ? 'countable' : 'condition',
          maxStacks: effect.maxStacks,
          ownerBuffDomain: 'operator',
          ownerCharacterId: snapshot.operator.id,
          ownerBuffGroup: groupKey,
          valueMode: effect.valueMode,
          derivedValue: effect.derivedValue,
          effectKind: effect.effectKind,
          extraHitConfig: effect.extraHitConfig,
          multiplier: effect.multiplier,
          refCount: 1,
        } satisfies SkillButtonBuff];
      })
    ));

    const weaponBuffs = snapshot.weapon.skills.skill3.effects.flatMap((effect, index) => {
      if (effect.category === 'passive' || !snapshot.weapon.id) return [];
      return [{
        schemaVersion: 2,
        id: `mobile-weapon:${snapshot.operator.id}:${snapshot.weapon.id}:${effect.effectKey || index}`,
        name: effect.label || effect.effectKey || `weapon-effect-${index + 1}`,
        displayName: effect.label || effect.effectKey || `武器特效 ${index + 1}`,
        sourceName: snapshot.weapon.name || snapshot.weapon.id,
        source: 'weapon-config',
        level: `${effect.level} 级`,
        type: effect.typeKey,
        value: effect.value,
        description: readRawDescription(effect.raw),
        category: effect.category === 'countable' ? 'countable' : 'condition',
        maxStacks: effect.maxStacks,
        ownerBuffDomain: 'weapon',
        ownerCharacterId: snapshot.operator.id,
        ownerBuffGroup: 'weaponSkill',
        valueMode: effect.valueMode,
        derivedValue: effect.derivedValue,
        effectKind: effect.effectKind,
        extraHitConfig: effect.extraHitConfig,
        multiplier: effect.multiplier,
        refCount: 1,
      } satisfies SkillButtonBuff];
    });

    const equipmentBuffs = snapshot.equipment.setBuffs.flatMap((effect, index) => {
      if (effect.category === 'passive' || effect.category === 'positive') return [];
      return [{
        schemaVersion: 2,
        id: `mobile-equipment:${snapshot.operator.id}:${effect.gearSetId}:${effect.effectId || index}`,
        name: effect.label || effect.effectId || `equipment-effect-${index + 1}`,
        displayName: effect.label || effect.effectId || `三件套效果 ${index + 1}`,
        sourceName: effect.gearSetName || effect.gearSetId,
        source: 'equipment-config',
        level: '三件套',
        type: effect.typeKey,
        value: effect.value,
        description: effect.raw,
        category: 'condition',
        maxStacks: effect.maxStacks,
        ownerBuffDomain: 'equipment',
        ownerCharacterId: snapshot.operator.id,
        ownerBuffGroup: 'threePiece',
        valueMode: effect.valueMode,
        derivedValue: effect.derivedValue,
        effectKind: effect.effectKind,
        extraHitConfig: effect.extraHitConfig,
        multiplier: effect.multiplier,
        refCount: 1,
      } satisfies SkillButtonBuff];
    });

    return [...operatorBuffs, ...weaponBuffs, ...equipmentBuffs];
  });
}

function buildAvailableBuffs(
  catalogBuffs: SkillButtonBuff[],
  snapshots: Record<string, ConfigSnapshot>,
): SkillButtonBuff[] {
  const seen = new Set<string>();
  return [...catalogBuffs, ...buildMobileConfigCandidateBuffs(snapshots)].filter((buff) => {
    if (!buff.id || seen.has(buff.id)) return false;
    seen.add(buff.id);
    return true;
  });
}

function buildMobileRdpsResolution(
  draft: MobileDraft,
  catalog: MobileCatalog,
  operatorSnapshots: Record<string, ConfigSnapshot>,
  availableBuffs: SkillButtonBuff[],
): RdpsResolutionContext {
  const teamIndexById = new Map(draft.selectedOperatorIds.map((characterId, index) => [characterId, index]));
  const characterNameById = new Map(catalog.characters.map((character) => [character.id, character.name]));
  const buttons: PersistedSkillButton[] = [];
  const anomalyStatusesByButton: Record<string, NonNullable<MobileTimelineAction['anomalyStatuses']>> = {};
  const anomalySnapshotsByButton: Record<string, NonNullable<MobileTimelineAction['anomalyStateSnapshots']>> = {};
  const allAnomalySnapshots: NonNullable<MobileTimelineAction['anomalyStateSnapshots']> = [];
  const allBuffs: SkillButtonBuff[] = [];

  draft.slots.forEach((slot, nodeIndex) => {
    const action = slot.action;
    if (!action) return;
    const staffIndex = teamIndexById.get(action.operatorId) ?? 0;
    buttons.push({
      id: action.id,
      characterId: action.operatorId,
      characterName: characterNameById.get(action.operatorId) ?? action.operatorId,
      skillType: action.skillType,
      staffIndex,
      nodeIndex,
      nodeNumber: nodeIndex + 1,
      position: { x: nodeIndex, y: staffIndex },
      runtimeSkillId: action.runtimeSkillId,
      skillDisplayName: action.skillName,
      selectedBuff: action.buffs.map((buff) => buff.id),
    });
    anomalyStatusesByButton[action.id] = action.anomalyStatuses ?? [];
    anomalySnapshotsByButton[action.id] = action.anomalyStateSnapshots ?? [];
    allAnomalySnapshots.push(...(action.anomalyStateSnapshots ?? []));
    allBuffs.push(...action.buffs);
  });

  return buildRdpsResolutionContext({
    selectedCharacterIds: draft.selectedOperatorIds,
    staffLines: draft.selectedOperatorIds.map((characterId, staffIndex) => ({
      staffIndex,
      characterId,
      characterName: characterNameById.get(characterId) ?? characterId,
    })),
    buttons,
    operatorConfigCache: operatorSnapshots,
    candidateBuffList: availableBuffs,
    anomalyStatusesByButton,
    anomalySnapshotsByButton,
    allAnomalySnapshots,
    allBuffs,
  });
}

function collectMobileRdpsApplications(
  draft: MobileDraft,
  resolution: RdpsResolutionContext,
): RdpsAttributableApplication[] {
  const applications: RdpsAttributableApplication[] = [];
  for (const slot of draft.slots) {
    const action = slot.action;
    if (!action) continue;
    const stateBuffs = buildAnomalyStateDerivedBuffs(action.anomalyStatuses ?? [], action.skillType);
    const snapshotBuffs = buildAnomalyStateSnapshotBuffs(action.anomalyStateSnapshots ?? []);
    for (const buff of [...action.buffs, ...stateBuffs, ...snapshotBuffs]) {
      const applicationKey = buffApplicationKeyOf(action.id, buff);
      const resolved = resolution.sidecar.get(applicationKey);
      const sourceKey = mobileSourceKeyOf(action.id, buff, resolution.sidecar);
      if (!sourceKey) continue;
      const parsed = parseRdpsSourceKey(sourceKey);
      if (!parsed) continue;
      applications.push({
        buff,
        applicationKey,
        sourceKey,
        characterId: parsed.characterId,
        domain: parsed.domain,
        sourceAssetName: resolved?.sourceAssetName,
      });
    }
  }
  return applications;
}

function evaluateMobileRdpsTotal(
  draft: MobileDraft,
  catalog: MobileCatalog,
  operatorSnapshots: Record<string, ConfigSnapshot>,
  sourceSidecar: RdpsSourceSidecar,
  enabledSourceKeys: ReadonlySet<RdpsSourceKey>,
): number {
  const sourceFilter: DamageReportSourceFilter = {
    enabledSourceKeys,
    imbalanceEnabled: false,
  };
  return draft.slots.reduce((sum, slot) => {
    const action = slot.action;
    if (!action) return sum;
    const config = draft.operatorConfigs[action.operatorId];
    const snapshot = operatorSnapshots[action.operatorId];
    if (!config || !snapshot) return sum;
    const calculation = calculateMobileSlot(
      slot.id,
      action,
      catalog,
      config,
      snapshot,
      operatorSnapshots,
      sourceFilter,
      sourceSidecar,
    );
    return sum + (calculation?.result.summary.totalExpected ?? 0);
  }, 0);
}

function evaluateMobileDirectDamageByCharacter(
  draft: MobileDraft,
  catalog: MobileCatalog,
  operatorSnapshots: Record<string, ConfigSnapshot>,
  sourceSidecar: RdpsSourceSidecar,
): Map<string, number> {
  const directDamageByCharacter = new Map<string, number>();
  const directDamageFilter: DamageReportSourceFilter = {
    enabledSourceKeys: new Set<RdpsSourceKey>(),
    unattributedBuffsEnabled: false,
    imbalanceEnabled: false,
  };
  for (const slot of draft.slots) {
    const action = slot.action;
    if (!action) continue;
    const config = draft.operatorConfigs[action.operatorId];
    const snapshot = operatorSnapshots[action.operatorId];
    if (!config || !snapshot) continue;
    const calculation = calculateMobileSlot(
      slot.id,
      action,
      catalog,
      config,
      snapshot,
      operatorSnapshots,
      directDamageFilter,
      sourceSidecar,
    );
    const directDamage = calculation?.result.summary.totalExpected ?? 0;
    directDamageByCharacter.set(
      action.operatorId,
      (directDamageByCharacter.get(action.operatorId) ?? 0) + directDamage,
    );
  }
  return directDamageByCharacter;
}

export function buildMobileRuntimeState(
  draft: MobileDraft,
  catalog: MobileCatalog,
): MobileRuntimeState {
  const operatorSnapshots: Record<string, ConfigSnapshot> = {};
  draft.selectedOperatorIds.forEach((operatorId) => {
    const character = getCharacterById(catalog, operatorId);
    const config = draft.operatorConfigs[operatorId];
    if (!character || !config) return;
    operatorSnapshots[operatorId] = buildMobileOperatorSnapshot(character, config, catalog);
  });

  const slotCalculations: Record<string, MobileSlotCalculation> = {};
  draft.slots.forEach((slot) => {
    if (!slot.action) return;
    const config = draft.operatorConfigs[slot.action.operatorId];
    const snapshot = operatorSnapshots[slot.action.operatorId];
    if (!config || !snapshot) return;
    const calculation = calculateMobileSlot(slot.id, slot.action, catalog, config, snapshot, operatorSnapshots);
    if (calculation) slotCalculations[slot.id] = calculation;
  });

  const availableBuffs = buildAvailableBuffs(catalog.buffs, operatorSnapshots);
  const report = buildMobileDamageReport(Object.values(slotCalculations));
  if (draft.activePage === 'report') {
    const resolution = buildMobileRdpsResolution(draft, catalog, operatorSnapshots, availableBuffs);
    const characterNameById = new Map(
      catalog.characters
        .filter((character) => draft.selectedOperatorIds.includes(character.id))
        .map((character) => [character.id, character.name]),
    );
    report.rdps = computeRdpsAttributionFromApplications({
      applications: collectMobileRdpsApplications(draft, resolution),
      actualTotal: report.totalExpected,
      directDamageByCharacter: evaluateMobileDirectDamageByCharacter(
        draft,
        catalog,
        operatorSnapshots,
        resolution.sidecar,
      ),
      evaluateTotal: (enabledSourceKeys) => evaluateMobileRdpsTotal(
        draft,
        catalog,
        operatorSnapshots,
        resolution.sidecar,
        enabledSourceKeys,
      ),
      excludedImbalanceEffectCount: draft.slots.reduce((count, slot) => (
        count + (slot.action
          ? buildAnomalyStateDerivedBuffs(slot.action.anomalyStatuses ?? [], slot.action.skillType)
              .filter((buff) => buff.type === 'imbalanceDmgBonus').length
          : 0)
      ), 0),
    }, {
      contextFingerprint: `mobile:${catalog.dataVersion}:${draft.updatedAt}`,
      resolutionDiagnostics: resolution.diagnostics,
      characterNameById,
      teamCharacterIds: draft.selectedOperatorIds,
    });
  }

  return {
    operatorSnapshots,
    slotCalculations,
    availableBuffs,
    report,
  };
}
