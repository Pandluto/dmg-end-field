/**
 * RDPS Owen 归因引擎：分层 Shapley（Owen value）分配"可归因 Buff 来源"
 * 对期望总伤害的贡献。归因世界固定关闭失衡（strict-imbalance policy），
 * 无 owner 的不可归因 Buff 恒启用（属于基线）。所有 coalition 结果按
 * context fingerprint + policyVersion + 来源 mask 缓存。
 */

import type {
  RdpsAttributionSummary,
  RdpsCharacterContribution,
  RdpsDiagnostics,
  RdpsDomain,
  RdpsDomainContribution,
  RdpsSourceContribution,
  RdpsSourceKey,
} from './rdpsAttribution.types';
import { buildCoalitionCacheKey, buildRdpsSourceKey, RDPS_POLICY_VERSION } from './rdpsAttribution.types';
import { buildAnomalyStateDerivedBuffs as buildDerived, buildAnomalyStateSnapshotBuffs as buildSnapshots } from './anomalyStateBuffs';
import type { ResolvedButtonInputs } from './damageReportService';
import { evaluateDamageReportContext } from './damageReportService';
import type { SkillButtonBuff } from '../../types/storage';

const DOMAINS: readonly RdpsDomain[] = ['operator', 'weapon', 'equipment'];

/** 默认来源键（与 evaluate 路径一致）。 */
function sourceKeyOf(buff: SkillButtonBuff): RdpsSourceKey | null {
  if (typeof buff.ownerCharacterId !== 'string' || !buff.ownerCharacterId.trim()) return null;
  const domain = buff.ownerBuffDomain;
  if (domain !== 'operator' && domain !== 'weapon' && domain !== 'equipment') return null;
  return buildRdpsSourceKey(buff.ownerCharacterId, domain);
}

/** 收集一个按钮输入里的全部可归因 Buff（含异常派生）。 */
function collectAttributableBuffs(inputs: readonly ResolvedButtonInputs[]): SkillButtonBuff[] {
  const buffs: SkillButtonBuff[] = [];
  for (const input of inputs) {
    const derived = buildDerived(input.anomalyStatuses, input.button.skillType);
    const snapshots = buildSnapshots(input.anomalyStateSnapshots);
    for (const buff of [...input.allBuffs, ...derived, ...snapshots]) {
      const key = sourceKeyOf(buff);
      if (key !== null) buffs.push(buff);
    }
  }
  return buffs;
}

/** 生成 [0..n) 的全排列（n ≤ 5 规模）。 */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  const results: T[][] = [];
  for (let index = 0; index < items.length; index += 1) {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const tail of permutations(rest)) {
      results.push([items[index], ...tail]);
    }
  }
  return results;
}

/** 来源掩码编码：组索引 i 的域位 = bits[i]（0 = 关闭该组）。 */
function encodeMask(bits: readonly number[]): string {
  return bits.map((bit) => bit.toString(2).padStart(3, '0')).join('');
}

/** 解码掩码为启用的来源 key 集合。 */
function decodeMask(mask: string, groups: readonly OwenGroup[]): Set<RdpsSourceKey> {
  const enabled = new Set<RdpsSourceKey>();
  for (let index = 0; index < groups.length; index += 1) {
    const bits = mask.slice(index * 3, index * 3 + 3);
    const group = groups[index];
    if (group.singleDomain) {
      if (bits === '001') enabled.add(group.leaves[0]);
      continue;
    }
    const bitValue = parseInt(bits, 2);
    DOMAINS.forEach((_, domainIndex) => {
      if (((bitValue >> domainIndex) & 1) === 1) {
        const leaf = group.leaves[domainIndex];
        if (leaf !== undefined) enabled.add(leaf);
      }
    });
  }
  return enabled;
}

/** Owen 分组：四人干员组 + 队伍外干员单域组。 */
export interface OwenGroup {
  characterId: string;
  characterName: string;
  /** 叶来源 key（域组为 3 个，队伍外为 1 个聚合）。 */
  leaves: RdpsSourceKey[];
  singleDomain: boolean;
}

/**
 * 分层 Owen value 纯函数：对每个叶子（来源域）计算其在所有外层干员组排列
 * 与内层域排列下的期望边际贡献。
 * @param groups - 分组（外层=组，内层=组内叶）。
 * @param valueOfMask - mask → 收益；mask 为每组 3 位（域位）编码。
 * @returns 叶来源 key → Owen 贡献。
 */
export function computeOwenValues(
  groups: readonly OwenGroup[],
  valueOfMask: (mask: string) => number,
): Map<RdpsSourceKey, number> {
  const contributionByKey = new Map<RdpsSourceKey, number>();
  const groupIndices = groups.map((_, index) => index);
  const groupPermutations = permutations(groupIndices);
  const innerPermutationsByGroup = groups.map((group) => (
    group.singleDomain
      ? [group.leaves]
      : permutations(group.leaves)
  ));
  const denominator = groupPermutations.length * (innerPermutationsByGroup[0]?.length ?? 1);

  for (const outerPerm of groupPermutations) {
    const beforeOuter = new Set<RdpsSourceKey>();
    for (const groupIndex of outerPerm) {
      const group = groups[groupIndex];
      const innerPerms = innerPermutationsByGroup[groupIndex];
      for (const innerPerm of innerPerms) {
        const beforeInner = new Set(beforeOuter);
        for (const leaf of innerPerm) {
          const vBefore = valueOfMask(maskOfSet(beforeInner, groups));
          const vWith = valueOfMask(maskOfSet(new Set([...beforeInner, leaf]), groups));
          const marginal = vWith - vBefore;
          contributionByKey.set(leaf, (contributionByKey.get(leaf) ?? 0) + marginal);
          beforeInner.add(leaf);
        }
      }
      for (const leaf of group.leaves) beforeOuter.add(leaf);
    }
  }
  for (const key of contributionByKey.keys()) {
    contributionByKey.set(key, (contributionByKey.get(key) ?? 0) / denominator);
  }
  return contributionByKey;
}

interface SourceStat {
  key: RdpsSourceKey;
  characterId: string;
  characterName: string;
  domain?: RdpsDomain;
  label: string;
  buffCount: number;
}

/**
 * 计算 RDPS 归因摘要。
 * @param inputs - resolveDamageReportContext 的输出。
 * @returns 归因摘要（actualTotal 严格对账）。
 */
export function computeRdpsAttribution(
  inputs: readonly ResolvedButtonInputs[],
  options: { policyVersion?: string } = {},
): RdpsAttributionSummary {
  const policyVersion = options.policyVersion ?? RDPS_POLICY_VERSION;
  const teamCharacterIds = Array.from(new Set(
    inputs.map((input) => input.runtimeButton.characterId).filter(Boolean),
  ));

  // 1. 收集可归因来源与统计
  const attributable = collectAttributableBuffs(inputs);
  const statsByKey = new Map<RdpsSourceKey, SourceStat>();
  const nameByCharacterId = new Map<string, string>();
  for (const input of inputs) {
    if (input.button.characterName && !nameByCharacterId.has(input.runtimeButton.characterId)) {
      nameByCharacterId.set(input.runtimeButton.characterId, input.button.characterName);
    }
  }
  for (const buff of attributable) {
    const key = sourceKeyOf(buff);
    if (key === null) continue;
    const domain = buff.ownerBuffDomain as RdpsDomain;
    const characterId = buff.ownerCharacterId as string;
    const existing = statsByKey.get(key);
    if (existing) {
      existing.buffCount += 1;
      continue;
    }
    statsByKey.set(key, {
      key,
      characterId,
      characterName: nameByCharacterId.get(characterId) ?? characterId,
      domain,
      label: `${nameByCharacterId.get(characterId) ?? characterId} · ${domain === 'operator' ? '本体' : domain === 'weapon' ? '武器' : '装备'}`,
      buffCount: 1,
    });
  }

  // 2. 分组：四人按三域，队伍外按单域聚合
  const groups: OwenGroup[] = [];
  const groupByCharacter = new Map<string, OwenGroup>();
  for (const characterId of teamCharacterIds) {
    const leaves = DOMAINS.map((domain) => buildRdpsSourceKey(characterId, domain));
    const group: OwenGroup = {
      characterId,
      characterName: nameByCharacterId.get(characterId) ?? characterId,
      leaves,
      singleDomain: false,
    };
    groups.push(group);
    groupByCharacter.set(characterId, group);
  }
  const outGroupLeaves: RdpsSourceKey[] = [];
  for (const stat of statsByKey.values()) {
    if (groupByCharacter.has(stat.characterId)) continue;
    if (!outGroupLeaves.includes(stat.key)) outGroupLeaves.push(stat.key);
  }
  if (outGroupLeaves.length > 0) {
    groups.push({ characterId: 'out-of-team', characterName: '队伍外来源', leaves: outGroupLeaves, singleDomain: true });
  }

  // 3. V(S) 评估器 + coalition 缓存
  const cache = new Map<string, number>();
  let coalitionEvaluationCount = 0;
  const evaluateMask = (mask: string): number => {
    const cacheKey = buildCoalitionCacheKey(policyVersion, inputs.length === 0 ? 'empty' : `${inputs.length}-buttons`, mask);
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return cached;
    coalitionEvaluationCount += 1;
    const enabled = decodeMask(mask, groups);
    const result = evaluateDamageReportContext(inputs, {
      enabledSourceKeys: enabled,
      imbalanceEnabled: false,
    }).totalExpected;
    cache.set(cacheKey, result);
    return result;
  };
  const allMask = encodeMask(groups.map((group) => group.singleDomain ? 1 : 7));
  const noneMask = encodeMask(groups.map(() => 0));

  // 4. 基线与归因世界
  const actualTotal = evaluateDamageReportContext(inputs, undefined).totalExpected;
  const attributionWorldTotal = evaluateMask(allMask);
  const baselineTotal = evaluateMask(noneMask);

  // 5. 分层 Owen value
  const contributionByKey = computeOwenValues(groups, evaluateMask);

  // 6. 组装结果
  const diagnostics: RdpsDiagnostics = {
    unknownOwnerCount: attributable.length - statsByKey.size,
    outOfTeamSourceCount: outGroupLeaves.length,
    excludedImbalanceCount: attributable.filter((buff) => buff.type === 'imbalanceDmgBonus').length,
    negativeContributionCount: 0,
    skippedHitCount: 0,
    coalitionEvaluationCount,
  };

  const sources: RdpsSourceContribution[] = [];
  const characterAggregate = new Map<string, { damage: number; domains: Map<RdpsDomain, number> }>();
  for (const stat of statsByKey.values()) {
    const damage = contributionByKey.get(stat.key) ?? 0;
    if (damage < 0) diagnostics.negativeContributionCount += 1;
    sources.push({
      key: stat.key,
      characterId: stat.characterId,
      characterName: stat.characterName,
      domain: stat.domain,
      label: stat.label,
      damage,
      shareOfActual: actualTotal > 0 ? damage / actualTotal : 0,
      includedBuffCount: stat.buffCount,
      negative: damage < 0,
    });
    const characterId = groupByCharacter.has(stat.characterId) ? stat.characterId : 'out-of-team';
    const aggregate = characterAggregate.get(characterId) ?? { damage: 0, domains: new Map() };
    aggregate.damage += damage;
    if (stat.domain !== undefined) {
      aggregate.domains.set(stat.domain, (aggregate.domains.get(stat.domain) ?? 0) + damage);
    }
    characterAggregate.set(characterId, aggregate);
  }

  const characters: RdpsCharacterContribution[] = [];
  for (const characterId of teamCharacterIds) {
    const aggregate = characterAggregate.get(characterId) ?? { damage: 0, domains: new Map() };
    const domains: RdpsDomainContribution[] = DOMAINS.map((domain) => {
      const damage = aggregate.domains.get(domain) ?? 0;
      return {
        domain,
        damage,
        shareOfCharacter: aggregate.damage === 0 ? 0 : damage / aggregate.damage,
      };
    });
    characters.push({
      characterId,
      characterName: nameByCharacterId.get(characterId) ?? characterId,
      damage: aggregate.damage,
      shareOfActual: actualTotal > 0 ? aggregate.damage / actualTotal : 0,
      domains,
    });
  }

  const attributedTotal = sources.reduce((sum, item) => sum + item.damage, 0);
  const residualTotal = actualTotal - attributedTotal;
  const reconciliationError = Math.abs(actualTotal - attributedTotal - residualTotal);

  return {
    policyVersion,
    actualTotal,
    attributionWorldTotal,
    baselineTotal,
    attributedTotal,
    residualTotal,
    reconciliationError,
    sources,
    characters,
    diagnostics,
  };
}

/** 将"启用的来源 key 集合"编码为掩码（未列出的来源关闭）。 */
function maskOfSet(enabled: ReadonlySet<RdpsSourceKey>, groups: readonly OwenGroup[]): string {
  return encodeMask(groups.map((group) => {
    if (group.singleDomain) {
      return group.leaves.some((leaf) => enabled.has(leaf)) ? 1 : 0;
    }
    let bits = 0;
    group.leaves.forEach((leaf, index) => {
      if (enabled.has(leaf)) bits += 1 << index;
    });
    return bits;
  }));
}


