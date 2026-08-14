import {
  collectRdpsAttributableApplications,
  computeOwenValues,
  computeRdpsAttributionFromApplications,
} from './rdpsContributionService';
import { createTwoCharacterInteractionWorld, createUnevenGroupWorld } from './rdpsTestFixtures';
import { buildRdpsSourceKey } from './rdpsAttribution.types';
import type { ResolvedButtonInputs } from './damageReportService';
import type { SkillButtonBuff } from '../../types/storage';

function assertClose(actual: number, expected: number, message: string): void {
  if (Math.abs(actual - expected) > 1e-9) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

/** 将世界 V(S) 适配为 mask 求值器（组内叶子顺序 = 组的 leaves 顺序）。 */
function worldValueOfMask(
  world: ReturnType<typeof createTwoCharacterInteractionWorld>,
  groups: Array<{ character: string; leaves: string[] }>,
): (mask: string) => number {
  return (mask: string) => {
    const enabled = new Set<string>();
    groups.forEach((group, groupIndex) => {
      const bitValue = parseInt(mask.slice(groupIndex * 3, groupIndex * 3 + 3), 2);
      group.leaves.forEach((leaf, leafIndex) => {
        if (((bitValue >> leafIndex) & 1) === 1) enabled.add(leaf);
      });
    });
    return world.valueOfCoalition(enabled);
  };
}

// 2 角色 × 2 域世界：A1(10) A2(4) B1(6) B2(3) + 交互 A1×B1 = 12
// 手工解析 Owen 值：
//   v({}) = 0; v(full) = 35
//   A1 的边际出现在"自己 + B1 在组"时：每对 (A 排列, B 排列) 下…
// 这里用数值验证：Owen 贡献之和 = v(full) - v({}) = 35（效率性质）。
const world = createTwoCharacterInteractionWorld();
const groupA = { character: 'A', leaves: ['A1', 'A2'] };
const groupB = { character: 'B', leaves: ['B1', 'B2'] };
const groups = [
  { character: 'A', leaves: [buildRdpsSourceKey('A', 'operator'), buildRdpsSourceKey('A', 'weapon')] },
  { character: 'B', leaves: [buildRdpsSourceKey('B', 'operator'), buildRdpsSourceKey('B', 'weapon')] },
];
// 把世界叶子名映射到 key（用 'A1' 等作为 characterId，域为 operator/weapon 的简化）
const worldKeyOf = (leaf: string): string => leaf;
const valueOfMask = worldValueOfMask(world, [
  { character: 'A', leaves: ['A1', 'A2'] },
  { character: 'B', leaves: ['B1', 'B2'] },
]);
const owenGroups = [
  { characterId: 'A', characterName: 'A', leaves: ['A1', 'A2'], singleDomain: false },
  { characterId: 'B', characterName: 'B', leaves: ['B1', 'B2'], singleDomain: false },
];
const contributions = computeOwenValues(owenGroups, valueOfMask);

// 效率：Σ Owen = v(full) - v(∅) = 35
const total = Array.from(contributions.values()).reduce((sum, value) => sum + value, 0);
assertClose(total, 35, 'Owen values are efficient (sum = v(full) - v(empty))');

// 对称性：B1 与 A1 有交互，A2 无交互 → A2 的 Owen = base(A2) = 4；
// A1 的 Owen = base(A1) + 交互分配（A1 与 B1 同组概率 1/2 × 交互 12 = 6 → 10 + 6 = 16）
assertClose(contributions.get('A1') ?? 0, 16, 'A1 Owen = base + half interaction');
assertClose(contributions.get('A2') ?? 0, 4, 'A2 Owen = base only');
assertClose(contributions.get('B1') ?? 0, 6 + 6, 'B1 Owen = base + half interaction');
assertClose(contributions.get('B2') ?? 0, 3, 'B2 Owen = base only');

// 确定性：重复计算一致
const again = computeOwenValues(owenGroups, valueOfMask);
assertEqual(JSON.stringify([...contributions.entries()]), JSON.stringify([...again.entries()]), 'Owen is deterministic');

// 空组世界
const emptyResult = computeOwenValues([], () => 0);
assertEqual(emptyResult.size, 0, 'empty groups yield no contributions');

// 运行时来源 sidecar 必须进入 Owen 来源建模：旧 Buff 和旧连击本体都没有 owner。
const legacyBuff: SkillButtonBuff = {
  id: 'legacy-buff',
  name: 'operator-config-snapshot:langwei:equipment:gear-set-chang-xi:effect1',
  displayName: '长息·队友伤害+16%',
  sourceName: '长息',
  source: '长息',
  type: 'allDmgBonus',
  value: 0.16,
  category: 'condition',
  refCount: 1,
};
const runtimeSources = new Map([
  ['legacy-button:legacy-buff', {
    characterId: 'langwei',
    domain: 'equipment' as const,
    sourceAssetName: '长息',
    method: 'canonical-path' as const,
    evidenceKey: 'legacy-buff-path',
  }],
  ['state:legacy-button:legacy-combo', {
    characterId: 'laevatain',
    domain: 'operator' as const,
    method: 'container-button' as const,
    evidenceKey: 'legacy-combo-button',
  }],
]);
const runtimeSourceInput = {
  button: { id: 'legacy-button', skillType: 'B' },
  allBuffs: [legacyBuff],
  anomalyStatuses: [{
    id: 'legacy-combo',
    key: 'combo-state',
    label: '连击',
    level: 1,
    primaryText: '连击',
  }],
  anomalyStateSnapshots: [],
  resolvedSourceSidecar: {
    get: (key: string) => runtimeSources.get(key),
    set: () => undefined,
    entries: () => runtimeSources.entries(),
  },
} as unknown as ResolvedButtonInputs;
const runtimeApplications = collectRdpsAttributableApplications([runtimeSourceInput]);
assertEqual(runtimeApplications.length, 2, 'legacy Buff and combo both enter Owen source applications');
assertEqual(
  runtimeApplications.some((item) => item.sourceKey === 'langwei::equipment'),
  true,
  'legacy Buff source comes from sidecar',
);
assertEqual(
  runtimeApplications.some((item) => item.sourceKey === 'laevatain::operator'),
  true,
  'legacy combo source comes from containing button sidecar',
);

// 单域组（队伍外聚合）
const singleGroup = [
  { characterId: 'out', characterName: '队伍外', leaves: ['out::operator'], singleDomain: true },
];
const singleResult = computeOwenValues(singleGroup, (mask) => (mask === '001' ? 7 : 0));
assertClose(singleResult.get('out::operator') ?? 0, 7, 'single-domain group takes full value');

// 不均匀组：A 3 叶 + B 1 叶（队伍外聚合形态），效率性质仍成立
const uneven = createUnevenGroupWorld();
const unevenGroups = [
  { characterId: 'A', characterName: 'A', leaves: ['A1', 'A2', 'A3'], singleDomain: false },
  { characterId: 'B', characterName: 'B', leaves: ['B1'], singleDomain: true },
];
const unevenValue = (mask: string): number => {
  const enabled = new Set<string>();
  unevenGroups.forEach((g, gi) => {
    const bitValue = parseInt(mask.slice(gi * 3, gi * 3 + 3), 2);
    if (g.singleDomain) {
      if (bitValue !== 0) g.leaves.forEach((leaf) => enabled.add(leaf));
      return;
    }
    g.leaves.forEach((leaf, li) => {
      if (((bitValue >> li) & 1) === 1) enabled.add(leaf);
    });
  });
  return uneven.valueOfCoalition(enabled);
};
const unevenResult = computeOwenValues(unevenGroups, unevenValue);
const unevenTotal = [...unevenResult.values()].reduce((sum, value) => sum + value, 0);
assertClose(unevenTotal, uneven.valueOfCoalition(new Set(['A1', 'A2', 'A3', 'B1'])), 'uneven groups keep Owen efficiency');
// 对称性：A3（无交互）Owen = base(A3) = 2；B1（单叶组）Owen = base(B1) + 交互分配
assertClose(unevenResult.get('A3') ?? 0, 2, 'A3 Owen = base only in uneven world');

// 队伍外聚合：singleDomain 组开启时全部底层叶子进入评估
const outGroup = [
  { characterId: 'c1', characterName: 'C1', leaves: ['c1::operator'], singleDomain: false },
  { characterId: 'out', characterName: '队伍外', leaves: ['out1::operator', 'out2::weapon'], singleDomain: true },
];
let outLeafCount = 0;
const outValue = (mask: string): number => {
  const enabled = new Set<string>();
  outGroup.forEach((g, gi) => {
    const bitValue = parseInt(mask.slice(gi * 3, gi * 3 + 3), 2);
    if (g.singleDomain) {
      if (bitValue !== 0) g.leaves.forEach((leaf) => enabled.add(leaf));
      return;
    }
    g.leaves.forEach((leaf, li) => {
      if (((bitValue >> li) & 1) === 1) enabled.add(leaf);
    });
  });
  return enabled.size;
};
const outResult = computeOwenValues(outGroup, (mask) => {
  outLeafCount += 1;
  return outValue(mask);
});
// 效率：v(full) = 3 叶
const outTotal = [...outResult.values()].reduce((sum, value) => sum + value, 0);
assertClose(outTotal, 3, 'out-of-team aggregation enables all underlying leaves');
assertClose(outResult.get('out1::operator') ?? 0, 1, 'out leaf 1 shares aggregate');
assertClose(outResult.get('out2::weapon') ?? 0, 1, 'out leaf 2 shares aggregate');
void outLeafCount;

// v3 全伤害归属：直接伤害进入出伤干员 operator，Owen 只分配 Buff 增量；
// 未解析 Buff 留在 Owen 基线并最终进入 residual。
const alphaOperatorKey = buildRdpsSourceKey('alpha', 'operator');
const alphaWeaponKey = buildRdpsSourceKey('alpha', 'weapon');
const attribution = computeRdpsAttributionFromApplications({
  applications: [
    {
      buff: { id: 'alpha-operator-buff' } as SkillButtonBuff,
      applicationKey: 'button:alpha-operator-buff',
      sourceKey: alphaOperatorKey,
      characterId: 'alpha',
      domain: 'operator',
    },
    {
      buff: { id: 'alpha-weapon-buff' } as SkillButtonBuff,
      applicationKey: 'button:alpha-weapon-buff',
      sourceKey: alphaWeaponKey,
      characterId: 'alpha',
      domain: 'weapon',
    },
  ],
  actualTotal: 190,
  directDamageByCharacter: new Map([
    ['alpha', 100],
    ['beta', 50],
  ]),
  // 空联盟 160 = 150 直接伤害 + 10 未解析 Buff；完整联盟再增加 30。
  evaluateTotal: (enabled) => 160
    + (enabled.has(alphaOperatorKey) ? 20 : 0)
    + (enabled.has(alphaWeaponKey) ? 10 : 0),
}, {
  teamCharacterIds: ['alpha', 'beta'],
  characterNameById: new Map([
    ['alpha', '干员甲'],
    ['beta', '干员乙'],
  ]),
});
assertClose(attribution.directDamageTotal, 150, 'direct damage total belongs to damage dealers');
assertClose(attribution.sourceContributionTotal, 30, 'Owen total only contains resolved Buff uplift');
assertClose(attribution.attributedTotal, 180, 'attributed total combines direct and marginal damage');
assertClose(attribution.residualTotal, 10, 'unresolved baseline effect stays residual');
assertClose(attribution.owenEfficiencyError, 0, 'v3 keeps Owen efficiency independent');
const alphaOperatorSource = attribution.sources.find((item) => item.key === alphaOperatorKey);
assertClose(alphaOperatorSource?.directDamage ?? 0, 100, 'operator row receives direct damage');
assertClose(alphaOperatorSource?.marginalDamage ?? 0, 20, 'operator row also keeps operator Buff uplift');
assertClose(alphaOperatorSource?.damage ?? 0, 120, 'operator row combines both components');
const alphaWeaponSource = attribution.sources.find((item) => item.key === alphaWeaponKey);
assertClose(alphaWeaponSource?.directDamage ?? 0, 0, 'weapon row receives no direct damage');
assertClose(alphaWeaponSource?.damage ?? 0, 10, 'weapon row keeps only its marginal uplift');
const betaOperatorSource = attribution.sources.find((item) => item.key === buildRdpsSourceKey('beta', 'operator'));
assertClose(betaOperatorSource?.damage ?? 0, 50, 'damage dealer without operator Buff still gets an operator row');
assertClose(attribution.characters[0]?.damage ?? 0, 130, 'alpha full RD combines operator and weapon');
assertClose(attribution.characters[1]?.damage ?? 0, 50, 'beta full RD contains its direct damage');

void worldKeyOf;
