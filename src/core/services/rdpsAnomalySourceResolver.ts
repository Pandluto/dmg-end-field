/**
 * RDPS2-2B 连击与异常来源 Resolver：异常快照（导电/腐蚀/碎甲）优先使用
 * sourceCharacterId，缺失时通过 sourceButtonId 经按钮目录恢复；旧连击卡
 * 缺显式来源时由 containing/source button 恢复施加干员。失衡不产生来源。
 * 只读，不新增或回填任何持久化字段。
 */

import type { PersistedAnomalyCard, AnomalyStateSnapshot } from '../../types/storage';
import type { RdpsCharacterDirectory, RdpsResolvedSource } from './rdpsSourceResolution.types';

/** 解析异常快照来源（导电/腐蚀/碎甲）。 */
export function resolveAnomalySnapshotSource(
  snapshot: Pick<AnomalyStateSnapshot, 'id' | 'sourceButtonId' | 'sourceCharacterId' | 'sourceCharacterName'>,
  directory: RdpsCharacterDirectory,
): RdpsResolvedSource {
  if (typeof snapshot.sourceCharacterId === 'string' && snapshot.sourceCharacterId.trim()) {
    return {
      characterId: snapshot.sourceCharacterId,
      characterName: typeof snapshot.sourceCharacterName === 'string' && snapshot.sourceCharacterName.trim()
        ? snapshot.sourceCharacterName
        : directory.nameByCharacterId.get(snapshot.sourceCharacterId),
      domain: 'operator',
      method: 'anomaly-snapshot',
      evidenceKey: `snapshot:${snapshot.id}:${snapshot.sourceCharacterId}`,
    };
  }
  if (typeof snapshot.sourceButtonId === 'string' && snapshot.sourceButtonId.trim()) {
    const characterId = directory.idByButtonId.get(snapshot.sourceButtonId);
    if (characterId) {
      return {
        characterId,
        characterName: directory.nameByCharacterId.get(characterId),
        domain: 'operator',
        method: 'anomaly-snapshot',
        evidenceKey: `snapshot:${snapshot.id}:button:${snapshot.sourceButtonId}`,
      };
    }
  }
  return {
    method: 'unresolved',
    evidenceKey: `snapshot:${snapshot.id}`,
    unresolvedReason: 'missing',
  };
}

/** 解析连击状态来源（含 containing/source button 恢复）。 */
export function resolveComboSource(
  card: Pick<PersistedAnomalyCard, 'id' | 'sourceCharacterId'>,
  containingButton: { id: string; characterId?: string | null; sourceButtonId?: string | null } | undefined,
  directory: RdpsCharacterDirectory,
): RdpsResolvedSource {
  // 新数据显式施加者。
  if (typeof card.sourceCharacterId === 'string' && card.sourceCharacterId.trim()) {
    return {
      characterId: card.sourceCharacterId,
      characterName: directory.nameByCharacterId.get(card.sourceCharacterId),
      domain: 'operator',
      method: 'explicit',
      evidenceKey: `combo:${card.id}:explicit:${card.sourceCharacterId}`,
    };
  }
  // source button（若连击模型存在来源按钮引用）。
  if (typeof containingButton?.sourceButtonId === 'string' && containingButton.sourceButtonId.trim()) {
    const characterId = directory.idByButtonId.get(containingButton.sourceButtonId);
    if (characterId) {
      return {
        characterId,
        characterName: directory.nameByCharacterId.get(characterId),
        domain: 'operator',
        method: 'source-button',
        evidenceKey: `combo:${card.id}:source-button:${containingButton.sourceButtonId}`,
      };
    }
  }
  // containing button → 稳定干员 ID。
  const characterId = typeof containingButton?.characterId === 'string' && containingButton.characterId.trim()
    ? containingButton.characterId
    : containingButton
      ? directory.idByButtonId.get(containingButton.id)
      : undefined;
  if (characterId) {
    return {
      characterId,
      characterName: directory.nameByCharacterId.get(characterId),
      domain: 'operator',
      method: 'container-button',
      evidenceKey: `combo:${card.id}:container:${containingButton?.id ?? ''}`,
    };
  }
  return {
    method: 'unresolved',
    evidenceKey: `combo:${card.id}`,
    unresolvedReason: 'missing',
  };
}

/** 失衡：返回 null（不产生可归因来源；由 strict-imbalance 过滤与诊断计数覆盖）。 */
export function resolveImbalanceSource(): null {
  return null;
}
