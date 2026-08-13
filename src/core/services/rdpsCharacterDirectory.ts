/**
 * RDPS2-2C 角色 ID 与展示名目录：从当前前端事实源汇总稳定干员 ID ↔ 展示名，
 * staffIndex ↔ 干员 ID，按钮 ID ↔ 干员 ID。只读，不写回存储。
 * 展示名优先级：operatorConfigPageCache > 队伍/资料 > 时间轴 > 异常快照 > 原始 ID。
 */

import type { RdpsCharacterDirectory } from './rdpsSourceResolution.types';

/** 构造输入：所有来源都是只读的当前工作区数据。 */
export interface RdpsCharacterDirectoryInput {
  /** selectedCharacters：按队伍顺序排列的干员 ID（staffIndex 下标）。 */
  selectedCharacterIds: readonly string[];
  /** 时间轴 staff lines：staffIndex + 可选 characterId/characterName。 */
  staffLines: ReadonlyArray<{
    staffIndex?: number | null;
    characterId?: string | null;
    characterName?: string | null;
  }>;
  /** 技能按钮：buttonId → characterId（可能缺失）+ characterName。 */
  buttons: ReadonlyArray<{
    id: string;
    characterId?: string | null;
    characterName?: string | null;
    staffIndex?: number | null;
  }>;
  /** 干员配置缓存：characterId → operator.name（最高优先级展示名）。 */
  operatorConfigCache: Readonly<Record<string, { operator?: { id?: string; name?: string } } | undefined>>;
  /** 异常快照：sourceCharacterId/sourceCharacterName（队伍外覆盖）。 */
  anomalySnapshots?: ReadonlyArray<{
    sourceCharacterId?: string;
    sourceCharacterName?: string;
  }>;
}

/** 构造只读角色目录。 */
export function buildRdpsCharacterDirectory(input: RdpsCharacterDirectoryInput): RdpsCharacterDirectory {
  const nameByCharacterId = new Map<string, string>();
  const idByStaffIndex = new Map<number, string>();
  const idByButtonId = new Map<string, string>();
  const teamOrder = new Map<string, number>();
  const conflicts: string[] = [];
  const seenNames = new Map<string, string>();

  // 1. 配置缓存优先：characterId → 展示名。
  for (const [characterId, config] of Object.entries(input.operatorConfigCache)) {
    const name = config?.operator?.name;
    if (typeof name === 'string' && name.trim()) {
      const existing = nameByCharacterId.get(characterId);
      if (existing !== undefined && existing !== name) {
        conflicts.push(`operator config name conflict: ${characterId} has ${existing} and ${name}`);
      }
      nameByCharacterId.set(characterId, name.trim());
    }
  }

  // 2. staffIndex → selectedCharacters[staffIndex]（队伍顺序即图 4 顺序）。
  input.selectedCharacterIds.forEach((characterId, staffIndex) => {
    idByStaffIndex.set(staffIndex, characterId);
    if (!teamOrder.has(characterId)) teamOrder.set(characterId, teamOrder.size);
    if (!nameByCharacterId.has(characterId)) nameByCharacterId.set(characterId, characterId);
  });

  // 3. staff lines：交叉校验名字（不覆盖稳定 ID 映射）。
  for (const line of input.staffLines) {
    if (typeof line.characterId === 'string' && line.characterId.trim()) {
      idByStaffIndex.set(Number(line.staffIndex ?? 0), line.characterId);
      if (typeof line.characterName === 'string' && line.characterName.trim()) {
        nameByCharacterId.set(line.characterId, line.characterName.trim());
      }
    }
  }

  // 4. 按钮 → 干员 ID（persisted 优先；缺失时由 staffIndex 恢复）。
  for (const button of input.buttons) {
    let characterId = typeof button.characterId === 'string' && button.characterId.trim()
      ? button.characterId
      : undefined;
    if (!characterId && typeof button.staffIndex === 'number') {
      characterId = idByStaffIndex.get(button.staffIndex);
    }
    if (characterId) {
      idByButtonId.set(button.id, characterId);
      if (typeof button.characterName === 'string' && button.characterName.trim()) {
        nameByCharacterId.set(characterId, button.characterName.trim());
      }
    }
  }

  // 5. 异常快照：队伍外来源的 ID/name。
  for (const snapshot of input.anomalySnapshots ?? []) {
    if (typeof snapshot.sourceCharacterId === 'string' && snapshot.sourceCharacterId.trim()) {
      if (typeof snapshot.sourceCharacterName === 'string' && snapshot.sourceCharacterName.trim()) {
        nameByCharacterId.set(snapshot.sourceCharacterId, snapshot.sourceCharacterName.trim());
      }
    }
  }

  // 同名多 ID 冲突诊断（不参与主键，仅记录）。
  for (const [characterId, name] of nameByCharacterId.entries()) {
    const previousId = seenNames.get(name);
    if (previousId !== undefined && previousId !== characterId) {
      conflicts.push(`duplicate display name ${name}: ${previousId} and ${characterId}`);
    } else {
      seenNames.set(name, characterId);
    }
  }

  const unresolvedDisplayNameCount = Array.from(nameByCharacterId.entries())
    .filter(([characterId, name]) => name === characterId).length;

  return {
    nameByCharacterId,
    idByStaffIndex,
    idByButtonId,
    teamOrder,
    conflicts,
    unresolvedDisplayNameCount,
  };
}
