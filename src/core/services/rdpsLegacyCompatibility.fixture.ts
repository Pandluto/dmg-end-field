/**
 * RDPS2-2F 旧/新数据 Parity fixture：同一份数据构造"显式 owner"与"删除
 * owner 字段"两份，断言来源解析与来源 key 完全一致。
 */
import type { SkillButtonBuff } from '../../types/storage';
import {
  buildRdpsCandidateProvenanceIndex,
  resolveLegacyBuffSource,
  type RdpsConfigSnapshotLike,
} from './rdpsLegacyBuffSourceResolver';

export const PARITY_CONFIG_CACHE: Record<string, RdpsConfigSnapshotLike> = {
  laevatain: {
    operator: { id: 'laevatain', name: '莱万汀', buffs: { talent: { effects: { effect1: { effectId: 'effect1', name: '天赋·灼心', type: 'fireResistanceIgnore', category: 'condition', value: 20, valueMode: 'fixed', effectKind: 'modifier' } } } } },
    weapon: { id: '熔铸火焰', name: '熔铸火焰', skills: { skill3: { effects: [{ skillKey: 'skill3', effectKey: 'effect3', label: '施放终结技·普通攻击伤害2', typeKey: 'normalAttackDmgBonus', category: 'condition', level: 4, value: 0.5, valueMode: 'fixed', effectKind: 'modifier' }] } } },
    equipment: { setBuffs: [{ effectId: 'buff2', label: '动火用·燃烧后·灼热伤害+50%', typeKey: 'fireDmgBonus', level: '三件套', value: 0.5, gearSetId: 'gear-set-dong-huo-yong', gearSetName: '动火用', category: 'condition', valueMode: 'fixed', effectKind: 'modifier' }] },
  },
  kamiao: {
    operator: { id: 'kamiao', name: '卡缪', buffs: { skill: { effects: { effect1: { effectId: 'effect1', name: '战技·灼热脆弱', type: 'fireVulnerability', category: 'condition', value: 0.07, valueMode: 'fixed', effectKind: 'modifier' } } } } },
    weapon: { id: '镀红祝福', name: '镀红祝福', skills: { skill3: { effects: [{ skillKey: 'skill3', effectKey: 'effect3', label: '汲罪·全队灼热伤害', typeKey: 'fireDmgBonus', category: 'condition', level: 3, value: 0.096, valueMode: 'fixed', effectKind: 'modifier' }] } } },
  },
};

/** 新数据：带显式 owner 的 Buff。 */
export function buildParityNewBuff(): SkillButtonBuff {
  return {
    id: 'parity-buff-1',
    name: 'operator-studio:laevatain:talent:effect1',
    displayName: '天赋·灼心',
    sourceName: '莱万汀',
    source: '莱万汀',
    level: 'talent',
    type: 'fireResistanceIgnore',
    value: 20,
    category: 'condition',
    effectKind: 'modifier',
    ownerCharacterId: 'laevatain',
    ownerBuffDomain: 'operator',
    refCount: 1,
  };
}

/** 旧数据：删除 owner 字段（其余字段与内容层级保留）。 */
export function buildParityLegacyBuff(): SkillButtonBuff {
  const next = { ...buildParityNewBuff() };
  delete next.ownerCharacterId;
  delete next.ownerBuffDomain;
  return next;
}

/** 断言新旧解析一致（来源 key 与域）。 */
export function assertParityResolution(newBuff: SkillButtonBuff, legacyBuff: SkillButtonBuff, index: ReturnType<typeof buildRdpsCandidateProvenanceIndex>): void {
  const resolvedNew = resolveLegacyBuffSource(newBuff, index);
  const resolvedLegacy = resolveLegacyBuffSource(legacyBuff, index);
  const keyOf = (source: { characterId?: string; domain?: string }) =>
    source.characterId && source.domain ? `${source.characterId}::${source.domain}` : 'unresolved';
  if (keyOf(resolvedNew) !== keyOf(resolvedLegacy)) {
    throw new Error(
      `parity failed: new=${keyOf(resolvedNew)} legacy=${keyOf(resolvedLegacy)} (legacy method ${resolvedLegacy.method})`,
    );
  }
}
