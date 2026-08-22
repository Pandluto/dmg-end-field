import {
  buildRdpsCandidateProvenanceIndex,
  parseCanonicalSourcePath,
  resolveLegacyBuffSource,
  type RdpsConfigSnapshotLike,
} from './rdpsLegacyBuffSourceResolver';
import { GOLDEN_BUFF_DEFINITIONS } from './rdpsGoldenSample.fixture';
import type { SkillButtonBuff } from '../../types/storage';

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertTrue(actual: boolean, message: string): void {
  if (!actual) throw new Error(message);
}

// ── 金样 canonical path：15 个旧 Buff 定义全部可确定性解析 ─────────────────
const goldenExpectations: Array<{ name: string; characterId: string; domain: string }> = [
  { name: 'operator-studio:laevatain:talent:effect3', characterId: 'laevatain', domain: 'operator' },
  { name: 'operator-studio:langwei:talent:effect2', characterId: 'langwei', domain: 'operator' },
  { name: 'operator-studio:aierdaila:skill:effect2', characterId: 'aierdaila', domain: 'operator' },
  { name: 'operator-studio:kamiao:skill:effect1', characterId: 'kamiao', domain: 'operator' },
  { name: 'operator-config-snapshot:aierdaila:weapon:沧溟星梦:skill3:effect2', characterId: 'aierdaila', domain: 'weapon' },
  { name: 'operator-config-snapshot:laevatain:weapon:熔铸火焰:skill3:effect3', characterId: 'laevatain', domain: 'weapon' },
  { name: 'operator-config-snapshot:laevatain:equipment:gear-set-dong-huo-yong:buff2', characterId: 'laevatain', domain: 'equipment' },
  { name: 'operator-config-snapshot:langwei:equipment:gear-set-chang-xi:effect1', characterId: 'langwei', domain: 'equipment' },
  { name: 'operator-config-snapshot:kamiao:weapon:镀红祝福:skill3:effect3', characterId: 'kamiao', domain: 'weapon' },
  { name: 'operator-config-snapshot:kamiao:equipment:gear-set-tuo-huang:buff1', characterId: 'kamiao', domain: 'equipment' },
];
for (const item of goldenExpectations) {
  const parsed = parseCanonicalSourcePath(item.name);
  assertEqual(parsed?.characterId, item.characterId, `canonical ${item.name} characterId`);
  assertEqual(parsed?.domain, item.domain, `canonical ${item.name} domain`);
}

// 金样里全部 15 个定义都应命中 canonical 或 candidate（不允许恶意串命中）
for (const def of GOLDEN_BUFF_DEFINITIONS) {
  const parsed = typeof def.name === 'string' ? parseCanonicalSourcePath(def.name) : null;
  assertTrue(parsed !== null, `golden buff ${def.id} name resolves canonically: ${def.name}`);
}

// ── 恶意/用户自定义字符串不能命中白名单 ─────────────────────────────────────
for (const bad of ['weapon:foo:bar', 'operator-studio::talent:x', 'a:b:c:d', 'operator-config-snapshot:kamiao:weapon', 'operator-studio:kamiao:random:x', 'my:custom:path:1:2']) {
  assertEqual(parseCanonicalSourcePath(bad), null, `reject ${bad}`);
}

// ── 候选索引唯一匹配 ────────────────────────────────────────────────────────
const configCache: Record<string, RdpsConfigSnapshotLike> = {
  kamiao: {
    operator: { id: 'kamiao', name: '卡缪', buffs: { skill: { effects: { effect1: { effectId: 'effect1', name: '战技·灼热脆弱', type: 'fireVulnerability', category: 'condition', value: 0.07, valueMode: 'fixed', effectKind: 'modifier' } } } } },
    weapon: { id: '镀红祝福', name: '镀红祝福', skills: { skill3: { effects: [{ skillKey: 'skill3', effectKey: 'effect3', label: '汲罪·全队灼热伤害', typeKey: 'fireDmgBonus', category: 'condition', level: 3, value: 0.096, valueMode: 'fixed', effectKind: 'modifier' }] } } },
    equipment: { setBuffs: [{ effectId: 'buff1', label: '拓荒·全队伤害+16%', typeKey: 'allDmgBonus', level: '三件套', value: 0.16, gearSetId: 'gear-set-tuo-huang', gearSetName: '拓荒', category: 'condition', valueMode: 'fixed', effectKind: 'modifier' }] },
  },
};
const index = buildRdpsCandidateProvenanceIndex(configCache);

const kamiaoSkillBuff: SkillButtonBuff = {
  id: 'buff-x1',
  name: 'operator-studio:kamiao:skill:effect1',
  displayName: '战技·灼热脆弱',
  sourceName: '卡缪',
  source: '卡缪',
  type: 'fireVulnerability',
  value: 0.07,
  category: 'condition',
  effectKind: 'modifier',
  refCount: 1,
};
const resolved = resolveLegacyBuffSource(kamiaoSkillBuff, index);
assertEqual(resolved.method, 'canonical-path', 'kanonical path resolves first');
assertEqual(resolved.characterId, 'kamiao', 'kanonical path character');
assertEqual(resolved.domain, 'operator', 'kanonical path domain');

// spec 必测：同一 Buff 删除 owner 字段后唯一匹配（name 保持应用生成的 canonical 路径）
const noOwner: SkillButtonBuff = {
  ...kamiaoSkillBuff,
  ownerCharacterId: undefined,
  ownerBuffDomain: undefined,
};
const resolvedNoOwner = resolveLegacyBuffSource(noOwner, index);
assertEqual(resolvedNoOwner.characterId, 'kamiao', 'owner-stripped buff recovers kamiao');
assertEqual(resolvedNoOwner.domain, 'operator', 'owner-stripped buff recovers operator domain');
assertEqual(resolvedNoOwner.method, 'canonical-path', 'owner-stripped buff resolves via canonical path');

const equipmentBuff: SkillButtonBuff = {
  id: 'buff-equipment',
  name: 'operator-config-snapshot:kamiao:equipment:gear-set-tuo-huang:buff1',
  displayName: '拓荒·全队伤害+16%',
  sourceName: '拓荒',
  source: '拓荒',
  type: 'allDmgBonus',
  value: 0.16,
  category: 'condition',
  effectKind: 'modifier',
  refCount: 1,
};
const resolvedEquipment = resolveLegacyBuffSource(equipmentBuff, index);
assertEqual(resolvedEquipment.characterId, 'kamiao', 'equipment canonical path owner');
assertEqual(resolvedEquipment.domain, 'equipment', 'equipment canonical path domain');
assertEqual(resolvedEquipment.sourceAssetName, '拓荒', 'equipment id resolves to display asset name');

// candidate-exact：候选 Buff 列表提供非 canonical name 的条目时唯一匹配
const libraryIndex = buildRdpsCandidateProvenanceIndex(configCache, [{
  name: 'buff-lib:effect-x',
  displayName: '战技·灼热脆弱',
  source: '卡缪',
  sourceName: '卡缪',
  level: '',
  type: 'fireVulnerability',
  value: 0.07,
  category: 'condition',
  effectKind: 'modifier',
  ownerCharacterId: 'kamiao',
  ownerBuffDomain: 'operator',
}]);
const libraryBuff: SkillButtonBuff = {
  id: 'buff-lib-1',
  name: 'buff-lib:effect-x',
  displayName: '战技·灼热脆弱',
  sourceName: '卡缪',
  source: '卡缪',
  type: 'fireVulnerability',
  value: 0.07,
  category: 'condition',
  effectKind: 'modifier',
  refCount: 1,
};
const resolvedByCandidate = resolveLegacyBuffSource(libraryBuff, libraryIndex);
assertEqual(resolvedByCandidate.method, 'candidate-exact', 'candidate exact match');
assertEqual(resolvedByCandidate.characterId, 'kamiao', 'candidate character');

// 显式来源优先
const explicitBuff: SkillButtonBuff = {
  ...kamiaoSkillBuff,
  ownerCharacterId: 'langwei',
  ownerBuffDomain: 'operator',
};
const resolvedExplicit = resolveLegacyBuffSource(explicitBuff, index);
assertEqual(resolvedExplicit.method, 'explicit', 'explicit wins');
assertEqual(resolvedExplicit.characterId, 'langwei', 'explicit character');

// 歧义：两个不同 owner 对 legacy projection 均精确命中（候选列表提供，字段与 Buff 完全一致）
const ambiguousSharedFields = {
  name: 'shared-effect-key',
  displayName: '同名效果',
  source: 'X',
  sourceName: 'X',
  level: '',
  type: 'fireDmgBonus',
  value: 0.1,
  category: 'condition',
  effectKind: 'modifier',
} as const;
const ambiguousIndex = buildRdpsCandidateProvenanceIndex({}, [
  { ...ambiguousSharedFields, ownerCharacterId: 'id-a', ownerBuffDomain: 'operator' },
  { ...ambiguousSharedFields, ownerCharacterId: 'id-b', ownerBuffDomain: 'operator' },
]);
const ambiguousBuff: SkillButtonBuff = {
  id: 'buff-amb',
  name: 'shared-effect-key',
  displayName: '同名效果',
  sourceName: 'X',
  source: 'X',
  type: 'fireDmgBonus',
  value: 0.1,
  category: 'condition',
  effectKind: 'modifier',
  refCount: 1,
};
const resolvedAmbiguous = resolveLegacyBuffSource(ambiguousBuff, ambiguousIndex);
assertEqual(resolvedAmbiguous.method, 'unresolved', 'ambiguous goes unresolved');
assertEqual(resolvedAmbiguous.unresolvedReason, 'ambiguous', 'ambiguous reason');

// 真正 missing
const missingIndex = buildRdpsCandidateProvenanceIndex({});
const missingBuff: SkillButtonBuff = { ...ambiguousBuff, displayName: '自定义特效', type: 'allDmgBonus', value: 0.5 };
const resolvedMissing = resolveLegacyBuffSource(missingBuff, missingIndex);
assertEqual(resolvedMissing.method, 'unresolved', 'missing goes unresolved');
assertEqual(resolvedMissing.unresolvedReason, 'missing', 'missing reason');

// 本地自定义 Buff 只有 sourceName 时保持 unresolved（不按名称猜测）
const customBuff: SkillButtonBuff = {
  id: 'buff-custom',
  name: 'my-local-effect',
  displayName: '本地自定义',
  sourceName: '卡缪',
  source: 'local_custom',
  type: 'allDmgBonus',
  value: 0.2,
  category: 'passive',
  effectKind: 'modifier',
  refCount: 1,
  target: { mode: 'all' },
};
const resolvedCustom = resolveLegacyBuffSource(customBuff, index);
assertEqual(resolvedCustom.method, 'unresolved', 'custom buff stays unresolved');
