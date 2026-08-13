/**
 * RDPS 归因共享类型与计算接口合同。
 * RDPS v1 使用期望伤害（totalExpected）作为归因基准；来源键由
 * ownerCharacterId + ownerBuffDomain 组成，sourceName 只用于展示。
 */

import type { SkillButtonBuff } from '../../types/storage';
import type { DamageReportHitRow } from './damageReportService';

/** 归因来源域。 */
export type RdpsDomain = 'operator' | 'weapon' | 'equipment';

/** 稳定来源键：characterId + domain。 */
export type RdpsSourceKey = string;

/** 单个来源的贡献结果。 */
export interface RdpsSourceContribution {
  key: RdpsSourceKey;
  characterId?: string;
  characterName: string;
  domain?: RdpsDomain;
  label: string;
  /** 贡献伤害，保留符号。 */
  damage: number;
  /** 占实际总伤害比例（damage / actualTotal）。 */
  shareOfActual: number;
  /** 该来源纳入归因的 Buff 数量。 */
  includedBuffCount: number;
  negative: boolean;
}

/** 单个干员内三个来源域的贡献。 */
export interface RdpsDomainContribution {
  domain: RdpsDomain;
  damage: number;
  /** 占该干员归因贡献的比例（damage / character.damage）。 */
  shareOfCharacter: number;
}

/** 单个干员的聚合贡献。 */
export interface RdpsCharacterContribution {
  characterId: string;
  characterName: string;
  damage: number;
  shareOfActual: number;
  domains: RdpsDomainContribution[];
}

/** 归因诊断统计（图表不得依赖它计算，但可显示警告）。 */
export interface RdpsDiagnostics {
  /** 缺少稳定 owner 而进入 Residual 的 Buff 数量。 */
  unknownOwnerCount: number;
  /** 有效 owner 但不在当前四人报表队伍中的来源数量。 */
  outOfTeamSourceCount: number;
  /** 严格排除的失衡相关 Buff 数量。 */
  excludedImbalanceCount: number;
  /** 负贡献来源数量。 */
  negativeContributionCount: number;
  /** 无效或跳过的 Hit 数量。 */
  skippedHitCount: number;
  /** coalition 评估次数（性能与缓存验收）。 */
  coalitionEvaluationCount: number;
}

/** RDPS 归因结果合同。 */
export interface RdpsAttributionSummary {
  policyVersion: string;
  /** 完整当前配置的实际期望总伤害。 */
  actualTotal: number;
  /** 严格归因口径下所有可归因来源开启时的期望总伤害。 */
  attributionWorldTotal: number;
  /** 没有任何可归因来源开启时的期望总伤害。 */
  baselineTotal: number;
  /** 所有可归因来源贡献之和。 */
  attributedTotal: number;
  /** actualTotal - attributedTotal。 */
  residualTotal: number;
  /** 对账误差：abs(actualTotal - attributedTotal - residualTotal)。 */
  reconciliationError: number;
  sources: RdpsSourceContribution[];
  characters: RdpsCharacterContribution[];
  diagnostics: RdpsDiagnostics;
}

/** 归因策略版本。任何改变来源归属、失衡处理、静态面板口径或负值展示规则的修改都必须提升。 */
export const RDPS_POLICY_VERSION = 'rdps-v1-owen-buff-only-strict-imbalance' as const;

/**
 * 反事实来源过滤器：按来源 key 开关普通 Buff、异常状态 Buff、连击 Buff
 * 和 extra-hit 生成器。过滤必须在计算输入阶段执行。
 */
export interface DamageReportSourceFilter {
  /** 指定来源 key 是否启用。null 表示启用全部可归因来源。 */
  enabledSourceKeys?: ReadonlySet<RdpsSourceKey> | null;
  /** 失衡是否启用。v1 归因世界中恒为 false（严格排除）。 */
  imbalanceEnabled?: boolean;
  /**
   * 判定一个 Buff 是否属于某个来源 key。默认按 ownerCharacterId +
   * ownerBuffDomain；异常快照/连击派生 Buff 在 resolve 阶段已映射为 operator。
   */
  sourceKeyOf?(buff: SkillButtonBuff): RdpsSourceKey | null;
}

/** 一次性 resolve 得到的不可变计算输入（反事实循环中不得重复读取存储）。 */
export interface DamageReportCalculationContext {
  /** 上下文指纹：用于 coalition cache key，相同输入必须产生相同指纹。 */
  fingerprint: string;
  /** 参与计算的按钮输入（含面板、模板、Buff、禁用项、层数等）。 */
  // 具体字段由 RDPS-2A 实现固化；此处只保留合同约束。
  readonly resolvedButtons: readonly unknown[];
  /** 共享的展示用 trace 基础元数据（resolve 阶段预计算）。 */
  readonly traceBases: readonly unknown[];
}

/** 一次评估的输出。 */
export interface DamageReportEvaluation {
  totalExpected: number;
  totalNonCrit: number;
  /** 评估期间执行的 Hit 计算次数（性能验收用）。 */
  hitEvaluationCount: number;
}

/** 构造来源 key 的稳定格式。 */
export function buildRdpsSourceKey(characterId: string, domain: RdpsDomain): RdpsSourceKey {
  return `${characterId}::${domain}`;
}

/** 从来源 key 解析干员 ID（key 格式不匹配时返回 null）。 */
export function parseRdpsSourceKey(key: RdpsSourceKey): { characterId: string; domain: RdpsDomain } | null {
  const separator = key.indexOf('::');
  if (separator <= 0 || separator >= key.length - 2) return null;
  const characterId = key.slice(0, separator);
  const domain = key.slice(separator + 2);
  if (domain !== 'operator' && domain !== 'weapon' && domain !== 'equipment') return null;
  return { characterId, domain };
}

/** coalition cache key 组成：policyVersion + contextFingerprint + coalitionMask。 */
export function buildCoalitionCacheKey(
  policyVersion: string,
  contextFingerprint: string,
  coalitionMask: string,
): string {
  return `${policyVersion}|${contextFingerprint}|${coalitionMask}`;
}

/** 图表 summary 类型别名：图 3 / 图 4 消费的字段子集。 */
export type RdpsTableRow = RdpsSourceContribution & { residual?: boolean };

export type { DamageReportHitRow };
