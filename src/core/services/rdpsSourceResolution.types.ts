/**
 * RDPS2-1 临时来源解析合同：旧数据来源恢复的只读 sidecar、角色目录、
 * 候选来源索引与 legacy projection。来源身份仍为"干员 ID + 来源域"，
 * 但不要求原 Buff 持有这两个字段——Resolve 阶段从现有数据层级恢复。
 */

import type { RdpsDomain } from './rdpsAttribution.types';
import type { SkillButtonBuff } from '../../types/storage';

/** 来源解析方法（按优先级命中后停止）。 */
export type RdpsSourceResolutionMethod =
  | 'explicit'          // 新数据显式 owner 字段
  | 'candidate-exact'   // legacy projection 在候选索引中唯一精确匹配
  | 'canonical-path'    // 应用生成的规范化内部路径（白名单命名空间）
  | 'anomaly-snapshot'  // 异常快照 sourceCharacterId / sourceButtonId
  | 'source-button'     // 来源按钮 → 稳定干员 ID
  | 'container-button'  // 所属按钮 → 稳定干员 ID（连击）
  | 'unresolved';

/** 未解析原因。 */
export type RdpsUnresolvedReason = 'missing' | 'ambiguous' | 'invalid';

/** 一个 Buff/状态应用的临时来源结果。 */
export interface RdpsResolvedSource {
  characterId?: string;
  characterName?: string;
  domain?: RdpsDomain;
  /** 来源资产名（武器名/套装名），只用于明细展示，不参与来源 key。 */
  sourceAssetName?: string;
  method: RdpsSourceResolutionMethod;
  /** 可调试证据键：如按钮 ID、Buff ID、快照 ID、候选索引键。 */
  evidenceKey: string;
  unresolvedReason?: RdpsUnresolvedReason;
}

/** 应用键：普通 Buff 应用 = buttonId + ':' + buffId；状态应用 = buttonId + ':' + cardId；快照 = 'snapshot:' + snapshotId。 */
export type RdpsApplicationKey = string;

export function buildBuffApplicationKey(buttonId: string, buffId: string): RdpsApplicationKey {
  return `${buttonId}:${buffId}`;
}

export function buildStateApplicationKey(buttonId: string, cardId: string): RdpsApplicationKey {
  return `state:${buttonId}:${cardId}`;
}

export function buildSnapshotApplicationKey(snapshotId: number | string): RdpsApplicationKey {
  return `snapshot:${snapshotId}`;
}

/** 只读来源 sidecar：按应用键索引的解析结果。 */
export interface RdpsSourceSidecar {
  get(key: RdpsApplicationKey): RdpsResolvedSource | undefined;
  set(key: RdpsApplicationKey, source: RdpsResolvedSource): void;
  entries(): Iterable<[RdpsApplicationKey, RdpsResolvedSource]>;
}

/** 角色目录：稳定 ID ↔ 展示名、staffIndex ↔ ID、按钮 ID ↔ 干员 ID。 */
export interface RdpsCharacterDirectory {
  /** 干员 ID → 展示名（优先级：配置快照 > 队伍/资料 > 时间轴 > 异常快照 > 原始 ID）。 */
  nameByCharacterId: Map<string, string>;
  /** staffIndex → 干员 ID（selectedCharacters 顺序）。 */
  idByStaffIndex: Map<number, string>;
  /** 按钮 ID → 稳定干员 ID（persisted characterId；缺失时由 staffIndex 恢复）。 */
  idByButtonId: Map<string, string>;
  /** 干员 ID → 队伍序号（图 4 顺序；队伍外来源不在此列）。 */
  teamOrder: Map<string, number>;
  /** 名称冲突诊断（同 ID 多名 / 同名多 ID），不参与主键。 */
  conflicts: string[];
  /** 未能解析展示名的干员 ID 计数。 */
  unresolvedDisplayNameCount: number;
}

/** 候选来源索引条目。 */
export interface RdpsCandidateEntry {
  /** legacy projection 身份键（排除 owner 字段）。 */
  identityKey: string;
  characterId: string;
  domain: RdpsDomain;
  group?: string;
  sourceAssetName?: string;
  /** 候选来源：operator-studio / operator-config-snapshot / candidate-buff-list。 */
  origin: 'operatorStudio' | 'operatorConfigSnapshot' | 'candidateList';
}

/** 候选来源索引：Resolve 阶段从当前前端事实源构建，只读。 */
export interface RdpsCandidateProvenanceIndex {
  byIdentityKey: Map<string, RdpsCandidateEntry[]>;
  /** 规范化内部路径白名单解析。 */
  resolveCanonicalPath(name: string): { characterId: string; domain: RdpsDomain; sourceAssetName?: string } | null;
}

/**
 * Legacy projection：从内容签名中排除第一轮新增的 owner 字段，
 * 其余稳定计算字段参与唯一精确匹配。非模糊匹配。
 */
export function buildLegacyProjectionKey(buff: Pick<SkillButtonBuff, 'name' | 'displayName' | 'source' | 'sourceName' | 'level' | 'type' | 'value' | 'category' | 'maxStacks' | 'target' | 'valueMode' | 'derivedValue' | 'multiplier' | 'effectKind' | 'extraHitConfig'>): string {
  const target = buff.target
    ? JSON.stringify(buff.target)
    : '';
  return [
    buff.name ?? '',
    buff.displayName ?? '',
    buff.source ?? '',
    buff.sourceName ?? '',
    buff.level ?? '',
    buff.type ?? '',
    String(buff.value ?? ''),
    buff.category ?? '',
    String(buff.maxStacks ?? ''),
    target,
    buff.valueMode ?? '',
    buff.derivedValue ? JSON.stringify(buff.derivedValue) : '',
    buff.multiplier ? JSON.stringify(buff.multiplier) : '',
    buff.effectKind ?? '',
    buff.extraHitConfig ? JSON.stringify(buff.extraHitConfig) : '',
  ].join('||');
}

/** 冲突诊断：高优先级与低优先级结果冲突时记录，不静默选择。 */
export interface RdpsResolutionConflict {
  applicationKey: RdpsApplicationKey;
  primary: RdpsResolvedSource;
  secondary: RdpsResolvedSource;
  note: string;
}
