/**
 * RDPS 归因引擎：无 Buff 的直接伤害归入实际出伤干员的 operator 域，
 * 分层 Shapley（Owen value）继续分配可归因 Buff 的边际贡献。归因世界
 * 固定关闭失衡（strict-imbalance policy），无 owner Buff 仅保留在 Owen
 * 基线中并最终进入 residual。所有 coalition 结果按 context fingerprint +
 * policyVersion + 来源 mask 缓存。
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
import { buildCoalitionCacheKey, buildRdpsSourceKey, parseRdpsSourceKey, RDPS_POLICY_VERSION } from './rdpsAttribution.types';
import { buildAnomalyStateDerivedBuffs as buildDerived, buildAnomalyStateSnapshotBuffs as buildSnapshots } from './anomalyStateBuffs';
import type { ResolvedButtonInputs } from './damageReportService';
import { evaluateDamageReportContext } from './damageReportService';
import type { SkillButtonBuff } from '../../types/storage';
import { buffApplicationKeyOf } from './rdpsSourceResolutionContext';

const DOMAINS: readonly RdpsDomain[] = ['operator', 'weapon', 'equipment'];
const NO_SOURCE_KEYS = new Set<RdpsSourceKey>();

/** 默认来源键（与 evaluate 路径一致）。 */
function sourceKeyOf(buff: SkillButtonBuff): RdpsSourceKey | null {
  if (typeof buff.ownerCharacterId !== 'string' || !buff.ownerCharacterId.trim()) return null;
  const domain = buff.ownerBuffDomain;
  if (domain !== 'operator' && domain !== 'weapon' && domain !== 'equipment') return null;
  return buildRdpsSourceKey(buff.ownerCharacterId, domain);
}

export interface RdpsAttributableApplication {
  buff: SkillButtonBuff;
  applicationKey: string;
  sourceKey: RdpsSourceKey;
  characterId: string;
  domain: RdpsDomain;
  sourceAssetName?: string;
}

/**
 * 收集全部可归因应用（普通 Buff、extra-hit、异常快照与连击）。来源判定必须
 * 与 evaluate 路径一致：优先消费运行时 sidecar，仅在 sidecar 没有可用结果时
 * 兼容显式 owner。旧数据不能因为 Buff 本体没有 owner 字段而漏出 Owen 世界。
 */
export function collectRdpsAttributableApplications(
  inputs: readonly ResolvedButtonInputs[],
): RdpsAttributableApplication[] {
  const applications: RdpsAttributableApplication[] = [];
  for (const input of inputs) {
    const derived = buildDerived(input.anomalyStatuses, input.button.skillType);
    const snapshots = buildSnapshots(input.anomalyStateSnapshots);
    for (const buff of [...input.allBuffs, ...derived, ...snapshots]) {
      const applicationKey = buffApplicationKeyOf(input.button.id, buff);
      const resolved = input.resolvedSourceSidecar.get(applicationKey);
      const sidecarKey = resolved?.method !== 'unresolved' && resolved?.characterId && resolved.domain
        ? buildRdpsSourceKey(resolved.characterId, resolved.domain)
        : null;
      const sourceKey = sidecarKey ?? sourceKeyOf(buff);
      if (sourceKey === null) continue;
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
      if (parseInt(bits, 2) !== 0) {
        for (const leaf of group.leaves) enabled.add(leaf);
      }
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
  // 每组用自己的内层排列数归一化（不同组叶子数量可以不同）。
  const denominatorByGroup = groups.map(
    (_, groupIndex) => groupPermutations.length * (innerPermutationsByGroup[groupIndex]?.length ?? 1),
  );

  for (const outerPerm of groupPermutations) {
    const beforeOuter = new Set<RdpsSourceKey>();
    for (const groupIndex of outerPerm) {
      const group = groups[groupIndex];
      const denominator = denominatorByGroup[groupIndex];
      const innerPerms = innerPermutationsByGroup[groupIndex];
      for (const innerPerm of innerPerms) {
        const beforeInner = new Set(beforeOuter);
        if (group.singleDomain) {
          // 聚合单元（队伍外虚拟来源）：全部底层叶子一次性加入，单元边际组内等分。
          const vBefore = valueOfMask(maskOfSet(beforeInner, groups));
          const vWith = valueOfMask(maskOfSet(new Set([...beforeInner, ...innerPerm]), groups));
          const marginal = vWith - vBefore;
          for (const leaf of innerPerm) {
            contributionByKey.set(leaf, (contributionByKey.get(leaf) ?? 0) + marginal / innerPerm.length / denominator);
          }
          continue;
        }
        for (const leaf of innerPerm) {
          const vBefore = valueOfMask(maskOfSet(beforeInner, groups));
          const vWith = valueOfMask(maskOfSet(new Set([...beforeInner, leaf]), groups));
          const marginal = vWith - vBefore;
          contributionByKey.set(leaf, (contributionByKey.get(leaf) ?? 0) + marginal / denominator);
          beforeInner.add(leaf);
        }
      }
      for (const leaf of group.leaves) beforeOuter.add(leaf);
    }
  }
  return contributionByKey;
}

interface SourceStat {
  key: RdpsSourceKey;
  characterId: string;
  characterName: string;
  domain: RdpsDomain;
  sourceAssetName?: string;
  label: string;
  buffCount: number;
}

export interface RdpsAttributionOptions {
  policyVersion?: string;
  contextFingerprint?: string;
  resolutionDiagnostics?: Partial<RdpsDiagnostics>;
  characterNameById?: ReadonlyMap<string, string>;
  teamCharacterIds?: readonly string[];
}

export interface RdpsAttributionEvaluationInput {
  applications: readonly RdpsAttributableApplication[];
  actualTotal: number;
  /** 所有 Buff 关闭且严格排除失衡后，按实际出伤干员聚合的直接伤害。 */
  directDamageByCharacter?: ReadonlyMap<string, number>;
  evaluateTotal: (enabledSourceKeys: ReadonlySet<RdpsSourceKey>) => number;
  excludedImbalanceEffectCount?: number;
}

/**
 * 对已经解析来源、且能执行来源开关反事实计算的任意前端上下文计算 RDPS。
 * 桌面与移动端共用这一数学入口；各端只负责提供自己的输入阶段评估器。
 */
export function computeRdpsAttributionFromApplications(
  evaluation: RdpsAttributionEvaluationInput,
  options: RdpsAttributionOptions = {},
): RdpsAttributionSummary {
  const policyVersion = options.policyVersion ?? RDPS_POLICY_VERSION;
  const contextFingerprint = options.contextFingerprint ?? `${evaluation.applications.length}-applications`;
  const directDamageByCharacter = new Map<string, number>();
  for (const [characterId, damage] of evaluation.directDamageByCharacter ?? []) {
    if (!characterId || !Number.isFinite(damage)) continue;
    directDamageByCharacter.set(characterId, (directDamageByCharacter.get(characterId) ?? 0) + damage);
  }
  const teamCharacterIds = Array.from(new Set(
    (options.teamCharacterIds ?? [
      ...evaluation.applications.map((application) => application.characterId),
      ...directDamageByCharacter.keys(),
    ]).filter(Boolean),
  ));
  const teamCharacterIdSet = new Set(teamCharacterIds);

  // 1. 收集可归因来源与统计
  const statsByKey = new Map<RdpsSourceKey, SourceStat>();
  const nameByCharacterId = new Map<string, string>(options.characterNameById ?? []);
  for (const application of evaluation.applications) {
    const { sourceKey, characterId, domain, sourceAssetName } = application;
    const existing = statsByKey.get(sourceKey);
    if (existing) {
      existing.buffCount += 1;
      if (!existing.sourceAssetName && sourceAssetName) {
        existing.sourceAssetName = sourceAssetName;
        const domainName = domain === 'operator' ? '本体' : domain === 'weapon' ? '武器' : '装备';
        const assetSuffix = sourceAssetName !== existing.characterName ? `（${sourceAssetName}）` : '';
        existing.label = `${existing.characterName} · ${domainName}${assetSuffix}`;
      }
      continue;
    }
    const characterName = nameByCharacterId.get(characterId) ?? characterId;
    const domainName = domain === 'operator' ? '本体' : domain === 'weapon' ? '武器' : '装备';
    const assetSuffix = sourceAssetName && sourceAssetName !== characterName
      ? `（${sourceAssetName}）`
      : '';
    statsByKey.set(sourceKey, {
      key: sourceKey,
      characterId,
      characterName,
      domain,
      sourceAssetName,
      label: `${characterName} · ${domainName}${assetSuffix}`,
      buffCount: 1,
    });
  }

  // 2. 分组：当前队伍只建立实际存在的域叶；队伍外按单域聚合
  const groups: OwenGroup[] = [];
  for (const characterId of teamCharacterIds) {
    const leaves = DOMAINS
      .map((domain) => buildRdpsSourceKey(characterId, domain))
      .filter((key) => statsByKey.has(key));
    if (leaves.length === 0) continue;
    const group: OwenGroup = {
      characterId,
      characterName: nameByCharacterId.get(characterId) ?? characterId,
      leaves,
      singleDomain: false,
    };
    groups.push(group);
  }
  const outGroupLeaves: RdpsSourceKey[] = [];
  for (const stat of statsByKey.values()) {
    if (teamCharacterIdSet.has(stat.characterId)) continue;
    if (!outGroupLeaves.includes(stat.key)) outGroupLeaves.push(stat.key);
  }
  if (outGroupLeaves.length > 0) {
    groups.push({ characterId: 'out-of-team', characterName: '队伍外来源', leaves: outGroupLeaves, singleDomain: true });
  }

  // 3. V(S) 评估器 + coalition 缓存
  const cache = new Map<string, number>();
  let coalitionEvaluationCount = 0;
  const evaluateMask = (mask: string): number => {
    const cacheKey = buildCoalitionCacheKey(policyVersion, contextFingerprint, mask);
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return cached;
    coalitionEvaluationCount += 1;
    const enabled = decodeMask(mask, groups);
    const result = evaluation.evaluateTotal(enabled);
    cache.set(cacheKey, result);
    return result;
  };
  const allMask = encodeMask(groups.map((group) => (
    group.singleDomain ? 1 : (1 << group.leaves.length) - 1
  )));
  const noneMask = encodeMask(groups.map(() => 0));

  // 4. 基线与归因世界
  const actualTotal = evaluation.actualTotal;
  const attributionWorldTotal = evaluateMask(allMask);
  const baselineTotal = evaluateMask(noneMask);

  // 5. 分层 Owen value
  const contributionByKey = computeOwenValues(groups, evaluateMask);

  // 6. 组装结果
  const attributableCharacterIds = new Set([
    ...Array.from(statsByKey.values()).map((stat) => stat.characterId),
    ...directDamageByCharacter.keys(),
  ]);
  const diagnostics: RdpsDiagnostics = {
    resolvedExplicitDefinitionCount: options.resolutionDiagnostics?.resolvedExplicitDefinitionCount ?? 0,
    resolvedLegacyDefinitionCount: options.resolutionDiagnostics?.resolvedLegacyDefinitionCount ?? 0,
    unresolvedDefinitionCount: options.resolutionDiagnostics?.unresolvedDefinitionCount ?? 0,
    ambiguousDefinitionCount: options.resolutionDiagnostics?.ambiguousDefinitionCount ?? 0,
    unresolvedApplicationCount: options.resolutionDiagnostics?.unresolvedApplicationCount ?? 0,
    outOfTeamCharacterCount: Array.from(attributableCharacterIds)
      .filter((characterId) => !teamCharacterIdSet.has(characterId)).length,
    unresolvedDisplayNameCount: new Set(
      Array.from(attributableCharacterIds)
        .filter((characterId) => (nameByCharacterId.get(characterId) ?? characterId) === characterId),
    ).size,
    excludedImbalanceEffectCount: evaluation.excludedImbalanceEffectCount ?? 0,
    negativeContributionCount: 0,
    coalitionEvaluationCount,
  };

  const sources: RdpsSourceContribution[] = [];
  const characterAggregate = new Map<string, { damage: number; domains: Map<RdpsDomain, number> }>();
  const appendSource = (stat: SourceStat, marginalDamage: number, directDamage: number): void => {
    const damage = directDamage + marginalDamage;
    const negative = marginalDamage < 0 || damage < 0;
    if (negative) diagnostics.negativeContributionCount += 1;
    sources.push({
      key: stat.key,
      characterId: stat.characterId,
      characterName: stat.characterName,
      domain: stat.domain,
      label: stat.label,
      directDamage,
      marginalDamage,
      damage,
      shareOfActual: actualTotal > 0 ? damage / actualTotal : 0,
      includedBuffCount: stat.buffCount,
      negative,
    });
    const characterId = teamCharacterIdSet.has(stat.characterId) ? stat.characterId : 'out-of-team';
    const aggregate = characterAggregate.get(characterId) ?? { damage: 0, domains: new Map() };
    aggregate.damage += damage;
    if (stat.domain !== undefined) {
      aggregate.domains.set(stat.domain, (aggregate.domains.get(stat.domain) ?? 0) + damage);
    }
    characterAggregate.set(characterId, aggregate);
  };

  for (const stat of statsByKey.values()) {
    const directDamage = stat.domain === 'operator'
      ? directDamageByCharacter.get(stat.characterId) ?? 0
      : 0;
    appendSource(stat, contributionByKey.get(stat.key) ?? 0, directDamage);
  }
  // 没有 operator Buff 的出伤干员仍必须拥有一个本体来源行。
  for (const [characterId, directDamage] of directDamageByCharacter) {
    const key = buildRdpsSourceKey(characterId, 'operator');
    if (statsByKey.has(key)) continue;
    const characterName = nameByCharacterId.get(characterId) ?? characterId;
    appendSource({
      key,
      characterId,
      characterName,
      domain: 'operator',
      label: `${characterName} · 本体`,
      buffCount: 0,
    }, 0, directDamage);
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

  const directDamageTotal = Array.from(directDamageByCharacter.values())
    .reduce((sum, damage) => sum + damage, 0);
  const sourceContributionTotal = sources.reduce((sum, item) => sum + item.marginalDamage, 0);
  const attributedTotal = sources.reduce((sum, item) => sum + item.damage, 0);
  const residualTotal = actualTotal - attributedTotal;
  const accountingError = Math.abs(actualTotal - attributedTotal - residualTotal);
  const owenEfficiencyError = Math.abs(sourceContributionTotal - (attributionWorldTotal - baselineTotal));
  const teamSourceSum = sources
    .filter((item) => item.characterId !== undefined && teamCharacterIdSet.has(item.characterId))
    .reduce((sum, item) => sum + item.damage, 0);
  const hierarchyError = Math.abs(
    characters.reduce(
      (sum, character) => sum + character.domains.reduce((inner, domain) => inner + domain.damage, 0),
      0,
    ) - teamSourceSum,
  );

  return {
    policyVersion,
    actualTotal,
    attributionWorldTotal,
    baselineTotal,
    directDamageTotal,
    sourceContributionTotal,
    attributedTotal,
    residualTotal,
    accountingError,
    owenEfficiencyError,
    hierarchyError,
    sources,
    characters,
    diagnostics,
  };
}

/**
 * 计算桌面伤害报表上下文的 RDPS 归因摘要。
 * @param inputs - resolveDamageReportContext 的输出。
 * @param options - policyVersion、contextFingerprint（coalition cache key 组成）与来源解析诊断。
 */
export function computeRdpsAttribution(
  inputs: readonly ResolvedButtonInputs[],
  options: RdpsAttributionOptions = {},
): RdpsAttributionSummary {
  const nameByCharacterId = new Map<string, string>(options.characterNameById ?? []);
  for (const input of inputs) {
    if (input.button.characterName && !nameByCharacterId.has(input.runtimeButton.characterId)) {
      nameByCharacterId.set(input.runtimeButton.characterId, input.button.characterName);
    }
  }
  const teamCharacterIds = options.teamCharacterIds
    ?? inputs.map((input) => input.runtimeButton.characterId).filter(Boolean);
  return computeRdpsAttributionFromApplications({
    applications: collectRdpsAttributableApplications(inputs),
    actualTotal: evaluateDamageReportContext(inputs, undefined).totalExpected,
    directDamageByCharacter: inputs.reduce((damageByCharacter, input) => {
      const characterId = input.runtimeButton.characterId;
      if (!characterId) return damageByCharacter;
      const directDamage = evaluateDamageReportContext([input], {
        enabledSourceKeys: NO_SOURCE_KEYS,
        unattributedBuffsEnabled: false,
        imbalanceEnabled: false,
      }).totalExpected;
      damageByCharacter.set(characterId, (damageByCharacter.get(characterId) ?? 0) + directDamage);
      return damageByCharacter;
    }, new Map<string, number>()),
    evaluateTotal: (enabledSourceKeys) => evaluateDamageReportContext(inputs, {
      enabledSourceKeys,
      imbalanceEnabled: false,
    }).totalExpected,
    excludedImbalanceEffectCount: inputs.reduce((count, input) => (
      count + buildDerived(input.anomalyStatuses, input.button.skillType)
        .filter((buff) => buff.type === 'imbalanceDmgBonus').length
    ), 0),
  }, {
    ...options,
    characterNameById: nameByCharacterId,
    teamCharacterIds,
    contextFingerprint: options.contextFingerprint ?? `${inputs.length}-buttons`,
  });
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
