/**
 * RDPS2-2A 旧 Buff Provenance Resolver：从 operatorConfigPageCache、武器
 * skill3、装备 setBuffs 与候选 Buff 列表构建只读候选来源索引，通过
 * legacy projection 唯一精确匹配或白名单规范路径恢复旧 Buff 的来源。
 * 纯函数/只读，绝不写回存储，不做模糊名称匹配。
 */

import type { SkillButtonBuff } from '../../types/storage';
import type { RdpsDomain } from './rdpsAttribution.types';
import {
  buildLegacyProjectionKey,
  type RdpsCandidateEntry,
  type RdpsCandidateProvenanceIndex,
  type RdpsResolvedSource,
} from './rdpsSourceResolution.types';

/** 配置快照结构（只读子集）。 */
export interface RdpsConfigSnapshotLike {
  operator?: {
    id?: string;
    name?: string;
    buffs?: {
      talent?: { effects?: Record<string, unknown> };
      potential?: { effects?: Record<string, unknown> };
      skill?: { effects?: Record<string, unknown> };
    };
  };
  weapon?: {
    id?: string;
    name?: string;
    skills?: {
      skill3?: { effects?: Array<Record<string, unknown>> };
    };
  };
  equipment?: {
    setBuffs?: Array<Record<string, unknown>>;
  };
}

/** 候选 Buff 列表条目（只读）。 */
export interface RdpsCandidateBuffLike {
  name?: string;
  displayName?: string;
  source?: string;
  sourceName?: string;
  level?: string;
  type?: string;
  value?: number;
  category?: string;
  maxStacks?: number;
  target?: unknown;
  valueMode?: string;
  derivedValue?: unknown;
  multiplier?: unknown;
  effectKind?: string;
  extraHitConfig?: unknown;
  ownerCharacterId?: string;
  ownerBuffDomain?: string;
  ownerBuffGroup?: string;
}

const OPERATOR_GROUP_WHITELIST = new Set(['talent', 'potential', 'skill']);

/** 白名单规范路径解析（返回 null 表示不属于任何已知命名空间）。 */
export function parseCanonicalSourcePath(
  name: string,
): { characterId: string; domain: RdpsDomain; sourceAssetName?: string } | null {
  if (typeof name !== 'string') return null;
  const parts = name.split(':');
  if (parts.length < 3) return null;
  const namespace = parts[0];
  const characterId = parts[1];
  if (!characterId || characterId.includes(' ') || characterId === '') return null;
  if (namespace === 'operator-studio') {
    const group = parts[2];
    if (!OPERATOR_GROUP_WHITELIST.has(group)) return null;
    return { characterId, domain: 'operator' };
  }
  if (namespace === 'operator-config-snapshot') {
    const kind = parts[2];
    if (kind === 'weapon' && parts.length >= 4) {
      return { characterId, domain: 'weapon', sourceAssetName: parts[3] || undefined };
    }
    if (kind === 'equipment' && parts.length >= 4) {
      return { characterId, domain: 'equipment', sourceAssetName: parts[3] || undefined };
    }
    return null;
  }
  return null;
}

/** 从配置快照构造候选投影键（与 SkillButtonBuff 的 legacy projection 对齐）。 */
function projectionKeyOf(
  candidate: Pick<RdpsCandidateBuffLike, 'name' | 'displayName' | 'source' | 'sourceName' | 'level' | 'type' | 'value' | 'category' | 'maxStacks' | 'target' | 'valueMode' | 'derivedValue' | 'multiplier' | 'effectKind' | 'extraHitConfig'>,
): string {
  // 与 buildLegacyProjectionKey 完全对齐：缺失字段一律透传为空串，不填默认值。
  return buildLegacyProjectionKey({
    name: candidate.name ?? '',
    displayName: candidate.displayName ?? '',
    source: candidate.source ?? '',
    sourceName: candidate.sourceName ?? '',
    level: candidate.level ?? '',
    type: candidate.type ?? '',
    value: candidate.value,
    category: candidate.category as SkillButtonBuff['category'],
    maxStacks: candidate.maxStacks,
    target: candidate.target as SkillButtonBuff['target'],
    valueMode: candidate.valueMode as SkillButtonBuff['valueMode'],
    derivedValue: candidate.derivedValue as SkillButtonBuff['derivedValue'],
    multiplier: candidate.multiplier as SkillButtonBuff['multiplier'],
    effectKind: candidate.effectKind as SkillButtonBuff['effectKind'],
    extraHitConfig: candidate.extraHitConfig as SkillButtonBuff['extraHitConfig'],
  });
}

/**
 * 从 operatorConfigPageCache 与候选 Buff 列表构建只读候选来源索引。
 * 不触发配置刷新，不写回候选列表。
 */
export function buildRdpsCandidateProvenanceIndex(
  configCache: Readonly<Record<string, RdpsConfigSnapshotLike | undefined>>,
  candidateBuffs: readonly RdpsCandidateBuffLike[] = [],
): RdpsCandidateProvenanceIndex {
  const byIdentityKey = new Map<string, RdpsCandidateEntry[]>();

  const add = (entry: RdpsCandidateEntry): void => {
    const existing = byIdentityKey.get(entry.identityKey);
    if (existing) {
      existing.push(entry);
    } else {
      byIdentityKey.set(entry.identityKey, [entry]);
    }
  };

  for (const [characterId, config] of Object.entries(configCache)) {
    if (!config) continue;
    const operator = config.operator;
    const operatorName = operator?.name || characterId;
    // 干员本体：talent / potential / skill
    for (const group of ['talent', 'potential', 'skill'] as const) {
      const effects = operator?.buffs?.[group]?.effects ?? {};
      for (const effect of Object.values(effects)) {
        const record = (effect ?? {}) as Record<string, unknown>;
        add({
          identityKey: projectionKeyOf({
            name: `operator-studio:${characterId}:${group}:${String(record.effectId ?? '')}`,
            displayName: String(record.name ?? ''),
            source: operatorName,
            sourceName: operatorName,
            level: group,
            type: String(record.type ?? ''),
            value: typeof record.value === 'number' ? record.value : undefined,
            category: String(record.category ?? 'condition'),
            valueMode: String(record.valueMode ?? 'fixed'),
            derivedValue: record.derivedValue,
            multiplier: record.multiplier,
            effectKind: String(record.effectKind ?? 'modifier'),
          }),
          characterId,
          domain: 'operator',
          group,
          sourceAssetName: operatorName,
          origin: 'operatorConfigSnapshot',
        });
      }
    }
    // 武器 skill3
    const weapon = config.weapon;
    const weaponName = weapon?.name || weapon?.id || '';
    for (const effect of weapon?.skills?.skill3?.effects ?? []) {
      const record = (effect ?? {}) as Record<string, unknown>;
      add({
        identityKey: projectionKeyOf({
          name: `operator-config-snapshot:${characterId}:weapon:${weapon?.id || weaponName}:skill3:${String(record.effectKey ?? '')}`,
          displayName: String(record.label ?? ''),
          source: weaponName,
          sourceName: weaponName,
          level: String(record.level ?? ''),
          type: String(record.typeKey ?? ''),
          value: typeof record.value === 'number' ? record.value : undefined,
          category: String(record.category ?? 'condition'),
          valueMode: String(record.valueMode ?? 'fixed'),
          effectKind: String(record.effectKind ?? 'modifier'),
        }),
        characterId,
        domain: 'weapon',
        group: 'weaponSkill',
        sourceAssetName: weaponName,
        origin: 'operatorConfigSnapshot',
      });
    }
    // 装备三件套
    for (const effect of config.equipment?.setBuffs ?? []) {
      const record = (effect ?? {}) as Record<string, unknown>;
      const gearSetName = String(record.gearSetName ?? '');
      add({
        identityKey: projectionKeyOf({
          name: `operator-config-snapshot:${characterId}:equipment:${String(record.gearSetId ?? '')}:${String(record.effectId ?? '')}`,
          displayName: String(record.label ?? ''),
          source: gearSetName,
          sourceName: gearSetName,
          level: String(record.level ?? ''),
          type: String(record.typeKey ?? ''),
          value: typeof record.value === 'number' ? record.value : undefined,
          category: String(record.category ?? 'condition'),
          valueMode: String(record.valueMode ?? 'fixed'),
          effectKind: String(record.effectKind ?? 'modifier'),
        }),
        characterId,
        domain: 'equipment',
        group: 'threePiece',
        sourceAssetName: gearSetName,
        origin: 'operatorConfigSnapshot',
      });
    }
  }

  // 候选 Buff 列表（不刷新、不写回）
  for (const candidate of candidateBuffs) {
    const characterId = typeof candidate.ownerCharacterId === 'string' ? candidate.ownerCharacterId : '';
    const domain = candidate.ownerBuffDomain;
    if (!characterId || (domain !== 'operator' && domain !== 'weapon' && domain !== 'equipment')) {
      continue;
    }
    add({
      identityKey: projectionKeyOf(candidate),
      characterId,
      domain,
      group: candidate.ownerBuffGroup,
      sourceAssetName: candidate.sourceName,
      origin: 'candidateList',
    });
  }

  const resolveCanonicalPath = (name: string): { characterId: string; domain: RdpsDomain; sourceAssetName?: string } | null =>
    parseCanonicalSourcePath(name);

  return { byIdentityKey, resolveCanonicalPath };
}

/** Resolve 一个旧 Buff 的来源（不包含结构关系，如 anomaly/containing button）。 */
export function resolveLegacyBuffSource(
  buff: SkillButtonBuff,
  candidateIndex: RdpsCandidateProvenanceIndex,
): RdpsResolvedSource {
  // 1. 显式稳定来源（新数据）。
  if (typeof buff.ownerCharacterId === 'string' && buff.ownerCharacterId.trim()) {
    const domain = buff.ownerBuffDomain;
    if (domain === 'operator' || domain === 'weapon' || domain === 'equipment') {
      return {
        characterId: buff.ownerCharacterId,
        domain,
        method: 'explicit',
        evidenceKey: `explicit:${buff.id}`,
      };
    }
  }

  // 2. canonical path（应用生成的规范化内部路径，白名单命名空间）。
  const canonical = typeof buff.name === 'string' ? parseCanonicalSourcePath(buff.name) : null;
  if (canonical) {
    const explicitConflict = (
      typeof buff.ownerCharacterId === 'string' && buff.ownerCharacterId.trim()
      && buff.ownerCharacterId !== canonical.characterId
    );
    return {
      characterId: canonical.characterId,
      domain: canonical.domain,
      sourceAssetName: canonical.sourceAssetName,
      method: 'canonical-path',
      evidenceKey: `canonical:${buff.name}`,
      unresolvedReason: explicitConflict ? 'ambiguous' : undefined,
    };
  }

  // 3. legacy projection 唯一精确匹配。
  const identityKey = buildLegacyProjectionKey(buff);
  const matches = candidateIndex.byIdentityKey.get(identityKey);
  if (matches && matches.length > 0) {
    const owners = new Set(matches.map((match) => `${match.characterId}::${match.domain}`));
    if (owners.size === 1) {
      const match = matches[0];
      return {
        characterId: match.characterId,
        domain: match.domain,
        sourceAssetName: match.sourceAssetName,
        method: 'candidate-exact',
        evidenceKey: `candidate:${identityKey.slice(0, 64)}`,
      };
    }
    return {
      method: 'unresolved',
      evidenceKey: `candidate-ambiguous:${identityKey.slice(0, 64)}`,
      unresolvedReason: 'ambiguous',
    };
  }

  return {
    method: 'unresolved',
    evidenceKey: `unresolved:${buff.id}`,
    unresolvedReason: 'missing',
  };
}
