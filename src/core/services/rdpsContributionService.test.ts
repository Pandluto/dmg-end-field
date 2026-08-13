import { computeOwenValues } from './rdpsContributionService';
import { createTwoCharacterInteractionWorld } from './rdpsTestFixtures';
import { buildRdpsSourceKey } from './rdpsAttribution.types';

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

// 单域组（队伍外聚合）
const singleGroup = [
  { characterId: 'out', characterName: '队伍外', leaves: ['out::operator'], singleDomain: true },
];
const singleResult = computeOwenValues(singleGroup, (mask) => (mask === '001' ? 7 : 0));
assertClose(singleResult.get('out::operator') ?? 0, 7, 'single-domain group takes full value');

void worldKeyOf;
