/**
 * RDPS2-3 来源解析上下文：Resolve 阶段一次性构建角色目录、候选来源索引、
 * 只读来源 sidecar 与解析诊断。所有结果只存在于本次计算内。
 */

import type { AnomalyStateSnapshot, PersistedAnomalyCard, PersistedSkillButton, SkillButtonBuff } from '../../types/storage';
import type { RdpsDiagnostics } from './rdpsAttribution.types';
import { buildRdpsCharacterDirectory } from './rdpsCharacterDirectory';
import { buildRdpsCandidateProvenanceIndex, resolveLegacyBuffSource } from './rdpsLegacyBuffSourceResolver';
import { resolveAnomalySnapshotSource, resolveComboSource } from './rdpsAnomalySourceResolver';
import {
  buildBuffApplicationKey,
  buildSnapshotApplicationKey,
  buildStateApplicationKey,
  type RdpsCandidateProvenanceIndex,
  type RdpsCharacterDirectory,
  type RdpsResolvedSource,
  type RdpsSourceSidecar,
} from './rdpsSourceResolution.types';

/** 解析上下文：Resolve 阶段输出，Evaluate 阶段只读消费。 */
export interface RdpsResolutionContext {
  directory: RdpsCharacterDirectory;
  candidateIndex: RdpsCandidateProvenanceIndex;
  sidecar: RdpsSourceSidecar;
  diagnostics: RdpsDiagnostics;
  /** 解析方法分布（审计/调试）。 */
  methodCounts: Record<string, number>;
}

class SidecarMap implements RdpsSourceSidecar {
  private readonly map = new Map<string, RdpsResolvedSource>();

  get(key: string): RdpsResolvedSource | undefined {
    return this.map.get(key);
  }

  set(key: string, source: RdpsResolvedSource): void {
    this.map.set(key, source);
  }

  entries(): Iterable<[string, RdpsResolvedSource]> {
    return this.map.entries();
  }
}

export interface RdpsResolutionInput {
  selectedCharacterIds: readonly string[];
  staffLines: ReadonlyArray<{ staffIndex?: number | null; characterId?: string | null; characterName?: string | null }>;
  buttons: ReadonlyArray<PersistedSkillButton>;
  operatorConfigCache: Readonly<Record<string, unknown>>;
  candidateBuffList: readonly unknown[];
  /** 每按钮的异常状态卡（与按钮 id 对应）。 */
  anomalyStatusesByButton: Readonly<Record<string, readonly PersistedAnomalyCard[]>>;
  /** 每按钮的异常快照列表。 */
  anomalySnapshotsByButton: Readonly<Record<string, readonly AnomalyStateSnapshot[]>>;
  /** 全部异常快照（角色目录兜底）。 */
  allAnomalySnapshots: readonly AnomalyStateSnapshot[];
  /** 全部 Buff 定义（buffId 查找，只读）。 */
  allBuffs: readonly SkillButtonBuff[];
}

/** 从来源解析结果计算 v2 诊断计数。 */
function countDiagnostics(
  resolvedByDefinition: Map<string, RdpsResolvedSource>,
  applicationEntries: ReadonlyArray<{ definitionKey: string; source: RdpsResolvedSource }>,
): RdpsDiagnostics {
  let resolvedExplicitDefinitionCount = 0;
  let resolvedLegacyDefinitionCount = 0;
  let unresolvedDefinitionCount = 0;
  let ambiguousDefinitionCount = 0;
  let unresolvedApplicationCount = 0;
  for (const source of resolvedByDefinition.values()) {
    if (source.method === 'explicit') resolvedExplicitDefinitionCount += 1;
    else if (source.method === 'canonical-path' || source.method === 'candidate-exact' || source.method === 'anomaly-snapshot' || source.method === 'source-button' || source.method === 'container-button') {
      resolvedLegacyDefinitionCount += 1;
    } else if (source.unresolvedReason === 'ambiguous') {
      ambiguousDefinitionCount += 1;
    } else {
      unresolvedDefinitionCount += 1;
    }
  }
  for (const entry of applicationEntries) {
    if (entry.source.method === 'unresolved') unresolvedApplicationCount += 1;
  }
  return {
    resolvedExplicitDefinitionCount,
    resolvedLegacyDefinitionCount,
    unresolvedDefinitionCount,
    ambiguousDefinitionCount,
    unresolvedApplicationCount,
    outOfTeamCharacterCount: 0,
    unresolvedDisplayNameCount: 0,
    excludedImbalanceEffectCount: 0,
    negativeContributionCount: 0,
    coalitionEvaluationCount: 0,
  };
}

/** 构建只读来源解析上下文。 */
export function buildRdpsResolutionContext(input: RdpsResolutionInput): RdpsResolutionContext {
  const directory = buildRdpsCharacterDirectory({
    selectedCharacterIds: input.selectedCharacterIds,
    staffLines: input.staffLines,
    buttons: input.buttons.map((button) => ({
      id: button.id,
      characterId: button.characterId,
      characterName: button.characterName,
      staffIndex: button.staffIndex,
    })),
    operatorConfigCache: input.operatorConfigCache as Record<string, { operator?: { id?: string; name?: string } }>,
    anomalySnapshots: input.allAnomalySnapshots,
  });

  const candidateIndex = buildRdpsCandidateProvenanceIndex(
    input.operatorConfigCache as Record<string, import('./rdpsLegacyBuffSourceResolver').RdpsConfigSnapshotLike | undefined>,
    input.candidateBuffList as import('./rdpsLegacyBuffSourceResolver').RdpsCandidateBuffLike[],
  );

  const sidecar = new SidecarMap();
  const methodCounts: Record<string, number> = {};
  const resolvedByDefinition = new Map<string, RdpsResolvedSource>();
  const applicationEntries: Array<{ definitionKey: string; source: RdpsResolvedSource }> = [];

  const record = (source: RdpsResolvedSource): void => {
    methodCounts[source.method] = (methodCounts[source.method] ?? 0) + 1;
  };

  for (const button of input.buttons) {
    // 普通 Buff（含 extra-hit generator：同一来源解析路径）。
    for (const buffId of button.selectedBuff ?? []) {
      const applicationKey = buildBuffApplicationKey(button.id, buffId);
      const definitionKey = `def:${buffId}`;
      let source = sidecar.get(applicationKey);
      if (!source) {
        const buff = inputBuffById(input, buffId);
        source = buff
          ? resolveLegacyBuffSource(buff, candidateIndex)
          : { method: 'unresolved', evidenceKey: `unresolved-buff:${buffId}`, unresolvedReason: 'missing' };
      }
      sidecar.set(applicationKey, source);
      record(source);
      if (!resolvedByDefinition.has(definitionKey)) resolvedByDefinition.set(definitionKey, source);
      applicationEntries.push({ definitionKey, source });
    }
    // 异常状态卡（连击/失衡）。
    for (const card of input.anomalyStatusesByButton[button.id] ?? []) {
      const applicationKey = buildStateApplicationKey(button.id, card.id);
      const definitionKey = `state:${card.id}`;
      const source = card.key === 'imbalance-state'
        ? { method: 'unresolved' as const, evidenceKey: `imbalance-excluded:${card.id}`, unresolvedReason: 'missing' as const }
        : resolveComboSource(card, button, directory);
      sidecar.set(applicationKey, source);
      record(source);
      if (!resolvedByDefinition.has(definitionKey)) resolvedByDefinition.set(definitionKey, source);
      applicationEntries.push({ definitionKey, source });
    }
    // 异常状态快照（导电/腐蚀/碎甲）。
    for (const snapshot of input.anomalySnapshotsByButton[button.id] ?? []) {
      const applicationKey = buildSnapshotApplicationKey(snapshot.id);
      const definitionKey = `snapshot:${snapshot.id}`;
      let source = sidecar.get(applicationKey);
      if (!source) {
        source = resolveAnomalySnapshotSource(snapshot, directory);
      }
      sidecar.set(applicationKey, source);
      record(source);
      if (!resolvedByDefinition.has(definitionKey)) resolvedByDefinition.set(definitionKey, source);
      applicationEntries.push({ definitionKey, source });
    }
  }

  const diagnostics = countDiagnostics(resolvedByDefinition, applicationEntries);
  diagnostics.outOfTeamCharacterCount = Array.from(directory.teamOrder.keys()).length < Array.from(directory.nameByCharacterId.keys()).length
    ? Array.from(directory.nameByCharacterId.keys()).filter((id) => !directory.teamOrder.has(id)).length
    : 0;
  diagnostics.unresolvedDisplayNameCount = directory.unresolvedDisplayNameCount;

  return { directory, candidateIndex, sidecar, diagnostics, methodCounts };
}

function inputBuffById(input: RdpsResolutionInput, buffId: string): SkillButtonBuff | null {
  return input.allBuffs.find((buff) => buff.id === buffId) ?? null;
}

/** 从 sidecar 取一个 Buff 的来源 key（不可归因返回 null）。 */
export function sourceKeyFromSidecar(
  sidecar: RdpsSourceSidecar,
  applicationKey: string,
): string | null {
  const source = sidecar.get(applicationKey);
  if (!source || source.method === 'unresolved') return null;
  if (!source.characterId || !source.domain) return null;
  return `${source.characterId}::${source.domain}`;
}

export function buffApplicationKeyOf(buttonId: string, buff: SkillButtonBuff): string {
  if (buff.id.startsWith('anomaly-state-snapshot-')) {
    return buildSnapshotApplicationKey(buff.id.slice('anomaly-state-snapshot-'.length));
  }
  if (buff.id.startsWith('anomaly-state-')) {
    return buildStateApplicationKey(buttonId, buff.id.slice('anomaly-state-'.length));
  }
  return buildBuffApplicationKey(buttonId, buff.id);
}
