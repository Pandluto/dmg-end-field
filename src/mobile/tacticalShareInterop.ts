import type { ConfigSnapshot } from '../core/calculators/operatorPanelCalculator';
import { validateTimelinePayload } from '../agentKernel/timelineWorktree/validator';
import type { Character, SkillButtonData, SkillType, TimelineData } from '../types';
import type {
  AnomalyStateSnapshot,
  PersistedSkillButton,
  SkillButtonBuff,
  SkillButtonTable,
} from '../types/storage';
import { calculateNodeNumber } from '../utils/nodeNumbering';
import {
  buildTimelineBundleV2,
  parseTimelineBundleV2,
  type TimelineBundleV2,
  type TimelineSnapshotEntry,
  type TimelineSnapshotPayload,
} from '../utils/timelineSnapshotStorage';
import {
  createDefaultMobileOperatorConfig,
  normalizeMobileDraft,
} from './mobileDraft';
import type {
  MobileCatalog,
  MobileDraft,
  MobileEquipmentSlotKey,
  MobileOperatorConfig,
  MobileTimelineAction,
} from './model';
import { MOBILE_EQUIPMENT_SLOT_KEYS } from './model';
import { buildMobileRuntimeState, resolveMobileSkillTemplate } from './mobileRuntime';

const SKILL_TYPES = new Set<SkillType>(['A', 'B', 'E', 'Q', 'Dot']);

function safeNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveCatalogCharacter(
  catalog: MobileCatalog,
  characterKey: string,
): Character | null {
  return catalog.characters.find((character) => (
    character.id === characterKey || character.name === characterKey
  )) ?? null;
}

function snapshotForCharacter(
  payload: TimelineSnapshotPayload,
  character: Character,
): ConfigSnapshot | null {
  return payload.operatorConfigPageCache[character.id]
    ?? payload.operatorConfigPageCache[character.name]
    ?? null;
}

function resolveMobileWeaponKey(
  catalog: MobileCatalog,
  snapshot: ConfigSnapshot,
): string {
  const directId = snapshot.weapon.id?.trim() || '';
  if (directId && catalog.weapons[directId]) return directId;
  const snapshotName = snapshot.weapon.name?.trim() || '';
  const match = Object.entries(catalog.weapons).find(([, weapon]) => (
    (directId && weapon.id === directId)
    || (snapshotName && weapon.name === snapshotName)
  ));
  return match?.[0] || '';
}

function toMobileSegmentKey(segmentKey: string): string {
  return segmentKey.startsWith('normal-hit-')
    ? segmentKey.slice('normal-hit-'.length)
    : segmentKey;
}

function toMobileSegmentMap<T>(source: Record<string, T> | undefined): Record<string, T> {
  return Object.fromEntries(
    Object.entries(source ?? {}).map(([segmentKey, value]) => [
      toMobileSegmentKey(segmentKey),
      value,
    ]),
  );
}

function toDesktopSegmentMap<T>(
  source: Record<string, T> | undefined,
  normalHitKeys: Set<string>,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(source ?? {}).map(([segmentKey, value]) => [
      normalHitKeys.has(segmentKey) ? `normal-hit-${segmentKey}` : segmentKey,
      value,
    ]),
  );
}

function mobileConfigFromSnapshot(
  character: Character,
  snapshot: ConfigSnapshot | null,
  catalog: MobileCatalog,
): MobileOperatorConfig {
  const config = createDefaultMobileOperatorConfig(character);
  if (!snapshot) return config;

  const equipment = { ...config.equipment };
  snapshot.equipment.pieces.forEach((piece) => {
    if (!MOBILE_EQUIPMENT_SLOT_KEYS.includes(piece.slotKey as MobileEquipmentSlotKey)) return;
    const slotKey = piece.slotKey as MobileEquipmentSlotKey;
    equipment[slotKey] = {
      equipmentId: piece.equipmentId,
      effectLevels: Object.fromEntries(piece.effects.flatMap((effect) => (
        ['effect1', 'effect2', 'effect3'].includes(effect.effectId)
          ? [[effect.effectId, safeNumber(effect.level, 0)]]
          : []
      ))) as MobileOperatorConfig['equipment'][MobileEquipmentSlotKey]['effectLevels'],
    };
  });

  return {
    ...config,
    level: safeNumber(snapshot.operator.level, config.level),
    potential: snapshot.operator.potential || config.potential,
    mainStatFlatBonus: safeNumber(snapshot.operator.mainStatFlatBonus, config.mainStatFlatBonus),
    subStatFlatBonus: safeNumber(snapshot.operator.subStatFlatBonus, config.subStatFlatBonus),
    skillLevels: {
      A: snapshot.operator.skillConfig.A || config.skillLevels.A,
      B: snapshot.operator.skillConfig.B || config.skillLevels.B,
      E: snapshot.operator.skillConfig.E || config.skillLevels.E,
      Q: snapshot.operator.skillConfig.Q || config.skillLevels.Q,
      Dot: snapshot.operator.skillConfig.Dot || config.skillLevels.Dot,
    },
    weapon: {
      weaponId: resolveMobileWeaponKey(catalog, snapshot) || config.weapon.weaponId,
      level: safeNumber(snapshot.weapon.config.level, config.weapon.level),
      potential: snapshot.weapon.config.potential || config.weapon.potential,
      skillLevels: {
        skill1: safeNumber(snapshot.weapon.config.skillLevels.skill1, config.weapon.skillLevels.skill1),
        skill2: safeNumber(snapshot.weapon.config.skillLevels.skill2, config.weapon.skillLevels.skill2),
        skill3: safeNumber(snapshot.weapon.config.skillLevels.skill3, config.weapon.skillLevels.skill3),
      },
    },
    equipment,
  };
}

function actionFromTimelineButton(
  button: SkillButtonData,
  persisted: PersistedSkillButton,
  character: Character,
  buffById: Map<string, SkillButtonBuff>,
  anomalyById: Map<number, AnomalyStateSnapshot>,
): MobileTimelineAction {
  const skillType = persisted.skillType as SkillType;
  if (!SKILL_TYPES.has(skillType)) {
    throw new Error(`${character.name} 的技能 ${persisted.skillDisplayName || persisted.id} 类型不受手机版支持。`);
  }
  const sandboxSkill = character.sandboxSkills?.find((skill) => (
    skill.id === persisted.runtimeSkillId || skill.buttonType === skillType
  ));
  const selectedBuffIds = persisted.selectedBuff ?? [];
  const selectedSnapshotIds = persisted.anomalyConfig?.selectedStateSnapshotIds ?? [];
  return {
    id: persisted.id,
    operatorId: character.id,
    skillType,
    runtimeSkillId: persisted.runtimeSkillId || sandboxSkill?.id || `${character.id}-${skillType}`,
    skillName: persisted.skillDisplayName || sandboxSkill?.displayName || button.skillDisplayName || skillType,
    skillIconUrl: persisted.skillIconUrl || sandboxSkill?.iconUrl || button.skillIconUrl,
    customHits: persisted.customHits ?? button.customHits ?? sandboxSkill?.customHits,
    buffs: selectedBuffIds.flatMap((buffId) => {
      const buff = buffById.get(buffId);
      return buff ? [buff] : [];
    }),
    buffStackCounts: { ...(persisted.buffStackCounts ?? {}) },
    buffStackCountsByHitKey: toMobileSegmentMap(
      persisted.panelConfig?.manualBuffStackCountsBySegmentKey,
    ),
    globallyDisabledBuffIds: [...(persisted.panelConfig?.globallyDisabledBuffIds ?? [])],
    disabledBuffIdsByHitKey: toMobileSegmentMap(
      persisted.panelConfig?.manualDisabledBuffIdsBySegmentKey,
    ),
    disabledHitKeys: [...(persisted.panelConfig?.manualDisabledHitKeys ?? [])],
    targetResistance: { ...(persisted.resistanceConfig?.targetResistance ?? {}) },
    anomalyStatuses: [...(persisted.anomalyConfig?.selectedStatuses ?? [])],
    anomalyDamages: [...(persisted.anomalyConfig?.selectedDamages ?? [])],
    anomalyStateSnapshots: selectedSnapshotIds.flatMap((snapshotId) => {
      const snapshot = anomalyById.get(snapshotId);
      return snapshot ? [snapshot] : [];
    }),
  };
}

export function timelinePayloadToMobileDraft(
  payload: TimelineSnapshotPayload,
  catalog: MobileCatalog,
): MobileDraft {
  const validation = validateTimelinePayload(payload);
  if (!validation.ok) {
    throw new Error(`桌面节点无法转换：${validation.issues.map((issue) => issue.message).join('；')}`);
  }
  const operators = payload.selectedCharacters.map((characterKey) => {
    const character = resolveCatalogCharacter(catalog, characterKey);
    if (!character) throw new Error(`当前手机版资料中找不到桌面节点使用的干员：${characterKey}`);
    return character;
  });
  const operatorByKey = new Map(operators.flatMap((operator) => [
    [operator.id, operator] as const,
    [operator.name, operator] as const,
  ]));
  const buffById = new Map(payload.allBuffList.map((buff) => [buff.id, buff]));
  const anomalyById = new Map(payload.anomalyStateSnapshots.map((snapshot) => [snapshot.id, snapshot]));
  const timelineButtons = payload.timelineData.staffLines.flatMap((line) => (
    line.buttons.map((button) => ({ line, button }))
  )).sort((left, right) => (
    left.button.nodeIndex - right.button.nodeIndex
    || left.line.staffIndex - right.line.staffIndex
    || left.button.id.localeCompare(right.button.id)
  ));

  return normalizeMobileDraft({
    schemaVersion: 1,
    selectedOperatorIds: operators.map((operator) => operator.id),
    operatorConfigs: Object.fromEntries(operators.map((operator) => [
      operator.id,
      mobileConfigFromSnapshot(operator, snapshotForCharacter(payload, operator), catalog),
    ])),
    slots: timelineButtons.map(({ button }, index) => {
      const persisted = payload.skillButtonTable[button.id];
      if (!persisted) throw new Error(`桌面节点缺少技能恢复数据：${button.id}`);
      const character = operatorByKey.get(persisted.characterId || '')
        ?? operatorByKey.get(persisted.characterName);
      if (!character) throw new Error(`桌面节点中的技能无法匹配干员：${persisted.characterName}`);
      return {
        id: `desktop-share-slot-${index + 1}-${button.id}`,
        action: actionFromTimelineButton(button, persisted, character, buffById, anomalyById),
      };
    }),
    reportNotes: {},
    activePage: 'report',
    activeOperatorId: operators[0]?.id || '',
    updatedAt: payload.timelineData.updatedAt || Date.now(),
  });
}

function uniqueButtonId(requestedId: string, slotIndex: number, usedIds: Set<string>): string {
  const base = requestedId.trim() || `mobile-share-action-${slotIndex + 1}`;
  let candidate = base;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

export function mobileDraftToTimelinePayload(
  sourceDraft: MobileDraft,
  catalog: MobileCatalog,
): TimelineSnapshotPayload {
  const draft = normalizeMobileDraft(sourceDraft);
  const operators = draft.selectedOperatorIds.map((operatorId) => {
    const character = resolveCatalogCharacter(catalog, operatorId);
    if (!character) throw new Error(`当前桌面资料中找不到手机快照使用的干员：${operatorId}`);
    return character;
  });
  const runtime = buildMobileRuntimeState(draft, catalog);
  const operatorIndex = new Map(operators.map((operator, index) => [operator.id, index]));
  const usedButtonIds = new Set<string>();
  const skillButtonTable: SkillButtonTable = {};
  const buttonsByOperator = new Map<string, SkillButtonData[]>();
  const buffById = new Map<string, SkillButtonBuff>();
  const buffRefCounts = new Map<string, number>();
  const anomalyById = new Map<number, AnomalyStateSnapshot>();

  draft.slots.forEach((slot, slotIndex) => {
    const action = slot.action;
    if (!action) return;
    const lineIndex = operatorIndex.get(action.operatorId);
    const character = operators[lineIndex ?? -1];
    if (lineIndex === undefined || !character) {
      throw new Error(`手机快照中的技能无法匹配干员：${action.operatorId}`);
    }
    const id = uniqueButtonId(action.id, slotIndex, usedButtonIds);
    const selectedBuff = action.buffs.map((buff) => buff.id);
    action.buffs.forEach((buff) => {
      buffById.set(buff.id, buff);
      buffRefCounts.set(buff.id, (buffRefCounts.get(buff.id) ?? 0) + 1);
    });
    action.anomalyStateSnapshots?.forEach((snapshot) => anomalyById.set(snapshot.id, snapshot));
    const config = draft.operatorConfigs[character.id]
      ?? createDefaultMobileOperatorConfig(character);
    const normalHitKeys = new Set(
      resolveMobileSkillTemplate(character, config, action).hits.map((hit) => hit.key),
    );
    const persisted: PersistedSkillButton = {
      id,
      characterId: character.id,
      characterName: character.name,
      skillType: action.skillType,
      staffIndex: lineIndex,
      lineIndex,
      nodeIndex: slotIndex,
      nodeNumber: calculateNodeNumber(slotIndex),
      position: { x: 0, y: 0 },
      runtimeSkillId: action.runtimeSkillId,
      skillDisplayName: action.skillName,
      skillIconUrl: action.skillIconUrl,
      customHits: action.customHits,
      selectedBuff,
      buffStackCounts: { ...action.buffStackCounts },
      anomalyConfig: {
        selectedStatuses: [...(action.anomalyStatuses ?? [])],
        selectedDamages: [...(action.anomalyDamages ?? [])],
        selectedStateSnapshotIds: action.anomalyStateSnapshots?.map((snapshot) => snapshot.id) ?? [],
      },
      resistanceConfig: { targetResistance: { ...action.targetResistance } },
      panelConfig: {
        selectedBuff: [...selectedBuff],
        globallyDisabledBuffIds: [...action.globallyDisabledBuffIds],
        manualDisabledBuffIdsBySegmentKey: toDesktopSegmentMap(
          action.disabledBuffIdsByHitKey,
          normalHitKeys,
        ),
        manualBuffStackCountsBySegmentKey: toDesktopSegmentMap(
          action.buffStackCountsByHitKey,
          normalHitKeys,
        ),
        manualDisabledHitKeys: [...action.disabledHitKeys],
      },
      runtimeSnapshot: null,
      createdAt: draft.updatedAt,
      updatedAt: draft.updatedAt,
    };
    skillButtonTable[id] = persisted;
    const timelineButton: SkillButtonData = {
      id,
      characterId: character.id,
      characterName: character.name,
      skillType: action.skillType,
      staffIndex: lineIndex,
      lineIndex,
      nodeIndex: slotIndex,
      nodeNumber: calculateNodeNumber(slotIndex),
      position: { x: 0, y: 0 },
      runtimeSkillId: action.runtimeSkillId,
      skillDisplayName: action.skillName,
      skillIconUrl: action.skillIconUrl,
      customHits: action.customHits,
      buffIds: [...selectedBuff],
    };
    buttonsByOperator.set(character.id, [
      ...(buttonsByOperator.get(character.id) ?? []),
      timelineButton,
    ]);
  });

  const now = draft.updatedAt || Date.now();
  const timelineData: TimelineData = {
    version: '1.1.0',
    createdAt: now,
    updatedAt: now,
    staffLines: operators.map((operator, staffIndex) => {
      const buttons = buttonsByOperator.get(operator.id) ?? [];
      return {
        staffIndex,
        characterName: operator.name,
        occupiedNodes: buttons.map((button) => button.nodeIndex),
        buttons,
      };
    }),
  };
  const payload: TimelineSnapshotPayload = {
    selectedCharacters: operators.map((operator) => operator.id),
    timelineData,
    skillButtonTable,
    allBuffList: [...buffById.values()].map((buff) => ({
      ...buff,
      refCount: buffRefCounts.get(buff.id) ?? buff.refCount ?? 0,
    })),
    anomalyStateSnapshots: [...anomalyById.values()],
    characterInputMap: {},
    characterComputedMap: {},
    characterDisplayCacheMap: {},
    operatorConfigPageCache: runtime.operatorSnapshots,
  };
  const validation = validateTimelinePayload(payload);
  if (!validation.ok) {
    throw new Error(`手机快照无法建立桌面节点：${validation.issues.map((issue) => issue.message).join('；')}`);
  }
  return payload;
}

export function resolveTimelineBundleCheckoutPayload(
  bundle: TimelineBundleV2,
): TimelineSnapshotPayload | null {
  const checkout = bundle.checkoutRef;
  if (checkout?.targetType === 'work-node') {
    const node = bundle.workNodes?.find((item) => item.id === checkout.targetId);
    if (node) return bundle.payloads[node.workingPayloadIndex] ?? null;
  }
  if (checkout?.targetType === 'snapshot') {
    const snapshot = bundle.snapshots.find((item) => item.id === checkout.targetId);
    if (snapshot) return bundle.payloads[snapshot.payloadIndex] ?? null;
  }
  const fallback = bundle.snapshots[0];
  return fallback ? bundle.payloads[fallback.payloadIndex] ?? null : null;
}

export async function validateDesktopTimelineBundle(value: unknown): Promise<TimelineBundleV2> {
  const parsed = await parseTimelineBundleV2(JSON.stringify(value));
  if (!parsed) throw new Error('桌面分享中的完整节点树校验失败。');
  return parsed;
}

export async function desktopBundleToMobileDraft(
  value: unknown,
  catalog: MobileCatalog,
): Promise<MobileDraft> {
  const bundle = await validateDesktopTimelineBundle(value);
  const payload = resolveTimelineBundleCheckoutPayload(bundle);
  if (!payload) throw new Error('桌面分享没有可供手机版读取的当前节点。');
  return timelinePayloadToMobileDraft(payload, catalog);
}

export async function buildMobileSnapshotTimelineBundle(
  shareId: string,
  draft: MobileDraft,
  catalog: MobileCatalog,
  label: string,
): Promise<TimelineBundleV2> {
  const payload = mobileDraftToTimelinePayload(draft, catalog);
  const createdAt = draft.updatedAt || Date.now();
  const snapshot: TimelineSnapshotEntry = {
    id: `mobile-share-${shareId}-snapshot`,
    label,
    createdAt,
    summary: {
      characterCount: payload.selectedCharacters.length,
      buttonCount: Object.keys(payload.skillButtonTable).length,
      buffCount: payload.allBuffList.length,
    },
    payload,
  };
  return buildTimelineBundleV2({
    timelineId: `mobile-share-${shareId}`,
    label,
    snapshot,
    checkoutRef: {
      targetType: 'snapshot',
      targetId: snapshot.id,
      updatedAt: createdAt,
    },
    scope: 'snapshot',
  });
}
