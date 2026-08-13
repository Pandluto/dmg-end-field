/**
 * RDPS 测试基建：可重复的 synthetic 归因数据、Owen 数学 fixture、
 * 图表 summary fixture 与对账断言 helper。所有 fixture 不读取浏览器存储，
 * 相同输入可重复生成。
 */
import type {
  RdpsAttributionSummary,
  RdpsCharacterContribution,
  RdpsDomainContribution,
  RdpsSourceContribution,
} from './rdpsAttribution.types';
import { buildRdpsSourceKey, parseRdpsSourceKey, RDPS_POLICY_VERSION } from './rdpsAttribution.types';

// ── 来源键 fixture ──────────────────────────────────────────────────────────

export const SOURCE_FIXTURES = {
  operatorAlpha: { characterId: 'op-alpha', domain: 'operator' as const },
  weaponAlpha: { characterId: 'op-alpha', domain: 'weapon' as const },
  equipmentAlpha: { characterId: 'op-alpha', domain: 'equipment' as const },
  operatorBeta: { characterId: 'op-beta', domain: 'operator' as const },
  weaponBeta: { characterId: 'op-beta', domain: 'weapon' as const },
  equipmentBeta: { characterId: 'op-beta', domain: 'equipment' as const },
};

export function buildFixtureSourceKeys(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(SOURCE_FIXTURES).map(([name, ref]) => [
      name,
      buildRdpsSourceKey(ref.characterId, ref.domain),
    ]),
  );
}

export const SOURCE_KEY_FIXTURE_CASES = [
  { input: 'op-alpha::operator', expected: { characterId: 'op-alpha', domain: 'operator' as const } },
  { input: 'op-alpha::weapon', expected: { characterId: 'op-alpha', domain: 'weapon' as const } },
  { input: 'op-alpha::equipment', expected: { characterId: 'op-alpha', domain: 'equipment' as const } },
  { input: 'bad', expected: null },
  { input: 'op-alpha::unknown', expected: null },
  { input: '::operator', expected: null },
];

// ── Owen 数学 fixture ────────────────────────────────────────────────────────

export interface OwenFixtureWorld {
  leafNames: string[];
  characterGroups: Array<{ character: string; leaves: string[] }>;
  valueOfCoalition(leaves: Set<string>): number;
}

/** 加性项 + 单对交互项的世界：v(S) = Σ base(i) + pair(a,b) 若 a,b ∈ S。 */
export function createTwoCharacterInteractionWorld(): OwenFixtureWorld {
  const leaves = ['A1', 'A2', 'B1', 'B2'];
  const base: Record<string, number> = { A1: 10, A2: 4, B1: 6, B2: 3 };
  const pair = { a: 'A1', b: 'B1', value: 12 };
  return {
    leafNames: leaves,
    characterGroups: [
      { character: 'A', leaves: ['A1', 'A2'] },
      { character: 'B', leaves: ['B1', 'B2'] },
    ],
    valueOfCoalition(leavesSet: Set<string>): number {
      let total = 0;
      for (const leaf of leavesSet) total += base[leaf] ?? 0;
      if (leavesSet.has(pair.a) && leavesSet.has(pair.b)) total += pair.value;
      return total;
    },
  };
}

/** 不同组叶子数量不同的世界：A 组 3 叶、B 组 1 叶（队伍外聚合形态）。 */
export function createUnevenGroupWorld(): OwenFixtureWorld {
  const base: Record<string, number> = { A1: 10, A2: 4, A3: 2, B1: 6 };
  const pair = { a: 'A1', b: 'B1', value: 12 };
  return {
    leafNames: ['A1', 'A2', 'A3', 'B1'],
    characterGroups: [
      { character: 'A', leaves: ['A1', 'A2', 'A3'] },
      { character: 'B', leaves: ['B1'] },
    ],
    valueOfCoalition(leavesSet: Set<string>): number {
      let total = 0;
      for (const leaf of leavesSet) total += base[leaf] ?? 0;
      if (leavesSet.has(pair.a) && leavesSet.has(pair.b)) total += pair.value;
      return total;
    },
  };
}

// ── 归因结果 fixture（图表用）───────────────────────────────────────────────

const source = (partial: RdpsSourceContribution): RdpsSourceContribution => ({
  key: partial.key,
  characterId: partial.characterId,
  characterName: partial.characterName,
  domain: partial.domain,
  label: partial.label,
  damage: partial.damage,
  shareOfActual: partial.shareOfActual,
  includedBuffCount: partial.includedBuffCount,
  negative: partial.negative,
});

const domainContribution = (partial: RdpsDomainContribution): RdpsDomainContribution => ({
  domain: partial.domain,
  damage: partial.damage,
  shareOfCharacter: partial.shareOfCharacter,
});

const characterContribution = (partial: RdpsCharacterContribution): RdpsCharacterContribution => ({
  characterId: partial.characterId,
  characterName: partial.characterName,
  damage: partial.damage,
  shareOfActual: partial.shareOfActual,
  domains: partial.domains,
});

const v2Diagnostics = (partial: Partial<RdpsAttributionSummary['diagnostics']> = {}): RdpsAttributionSummary['diagnostics'] => ({
  resolvedExplicitDefinitionCount: 0,
  resolvedLegacyDefinitionCount: 0,
  unresolvedDefinitionCount: 0,
  ambiguousDefinitionCount: 0,
  unresolvedApplicationCount: 0,
  outOfTeamCharacterCount: 0,
  unresolvedDisplayNameCount: 0,
  excludedImbalanceEffectCount: 0,
  negativeContributionCount: 0,
  coalitionEvaluationCount: 0,
  ...partial,
});

/** 四人完整、正贡献为主的 summary。 */
export function buildFourCharacterSummaryFixture(): RdpsAttributionSummary {
  const actualTotal = 1000;
  const sources: RdpsSourceContribution[] = [
    source({ key: 'c1::operator', characterId: 'c1', characterName: '干员一', domain: 'operator', label: '干员一 · 本体', damage: 300, shareOfActual: 0.3, includedBuffCount: 5, negative: false }),
    source({ key: 'c1::weapon', characterId: 'c1', characterName: '干员一', domain: 'weapon', label: '干员一 · 武器', damage: 120, shareOfActual: 0.12, includedBuffCount: 2, negative: false }),
    source({ key: 'c1::equipment', characterId: 'c1', characterName: '干员一', domain: 'equipment', label: '干员一 · 装备', damage: 60, shareOfActual: 0.06, includedBuffCount: 3, negative: false }),
    source({ key: 'c2::operator', characterId: 'c2', characterName: '干员二', domain: 'operator', label: '干员二 · 本体', damage: 150, shareOfActual: 0.15, includedBuffCount: 4, negative: false }),
    source({ key: 'c2::weapon', characterId: 'c2', characterName: '干员二', domain: 'weapon', label: '干员二 · 武器', damage: 40, shareOfActual: 0.04, includedBuffCount: 1, negative: false }),
    source({ key: 'c2::equipment', characterId: 'c2', characterName: '干员二', domain: 'equipment', label: '干员二 · 装备', damage: 20, shareOfActual: 0.02, includedBuffCount: 1, negative: false }),
    source({ key: 'c3::operator', characterId: 'c3', characterName: '干员三', domain: 'operator', label: '干员三 · 本体', damage: 90, shareOfActual: 0.09, includedBuffCount: 3, negative: false }),
    source({ key: 'c3::weapon', characterId: 'c3', characterName: '干员三', domain: 'weapon', label: '干员三 · 武器', damage: 30, shareOfActual: 0.03, includedBuffCount: 1, negative: false }),
    source({ key: 'c4::operator', characterId: 'c4', characterName: '干员四', domain: 'operator', label: '干员四 · 本体', damage: 50, shareOfActual: 0.05, includedBuffCount: 2, negative: false }),
    source({ key: 'c4::equipment', characterId: 'c4', characterName: '干员四', domain: 'equipment', label: '干员四 · 装备', damage: 10, shareOfActual: 0.01, includedBuffCount: 1, negative: false }),
  ];
  const attributedTotal = sources.reduce((sum, item) => sum + item.damage, 0);
  const residualTotal = actualTotal - attributedTotal;
  return {
    policyVersion: RDPS_POLICY_VERSION,
    actualTotal,
    attributionWorldTotal: 870,
    baselineTotal: 0,
    attributedTotal,
    residualTotal,
    accountingError: 0,
    owenEfficiencyError: 0,
    hierarchyError: 0,
    sources,
    characters: [
      characterContribution({ characterId: 'c1', characterName: '干员一', damage: 480, shareOfActual: 0.48, domains: [
        domainContribution({ domain: 'operator', damage: 300, shareOfCharacter: 0.625 }),
        domainContribution({ domain: 'weapon', damage: 120, shareOfCharacter: 0.25 }),
        domainContribution({ domain: 'equipment', damage: 60, shareOfCharacter: 0.125 }),
      ] }),
      characterContribution({ characterId: 'c2', characterName: '干员二', damage: 210, shareOfActual: 0.21, domains: [
        domainContribution({ domain: 'operator', damage: 150, shareOfCharacter: 0.7142857142857143 }),
        domainContribution({ domain: 'weapon', damage: 40, shareOfCharacter: 0.19047619047619047 }),
        domainContribution({ domain: 'equipment', damage: 20, shareOfCharacter: 0.09523809523809523 }),
      ] }),
      characterContribution({ characterId: 'c3', characterName: '干员三', damage: 120, shareOfActual: 0.12, domains: [
        domainContribution({ domain: 'operator', damage: 90, shareOfCharacter: 0.75 }),
        domainContribution({ domain: 'weapon', damage: 30, shareOfCharacter: 0.25 }),
      ] }),
      characterContribution({ characterId: 'c4', characterName: '干员四', damage: 60, shareOfActual: 0.06, domains: [
        domainContribution({ domain: 'operator', damage: 50, shareOfCharacter: 0.8333333333333334 }),
        domainContribution({ domain: 'equipment', damage: 10, shareOfCharacter: 0.16666666666666666 }),
      ] }),
    ],
    diagnostics: v2Diagnostics({ resolvedExplicitDefinitionCount: 10, excludedImbalanceEffectCount: 1, coalitionEvaluationCount: 256 }),
  };
}

/** 包含负贡献与队伍外来源的 summary（图 4 警告场景）。 */
export function buildNegativeAndOutOfTeamSummaryFixture(): RdpsAttributionSummary {
  const actualTotal = 800;
  const sources: RdpsSourceContribution[] = [
    source({ key: 'c1::operator', characterId: 'c1', characterName: '干员一', domain: 'operator', label: '干员一 · 本体', damage: 260, shareOfActual: 0.325, includedBuffCount: 4, negative: false }),
    source({ key: 'c1::weapon', characterId: 'c1', characterName: '干员一', domain: 'weapon', label: '干员一 · 武器', damage: -30, shareOfActual: -0.0375, includedBuffCount: 1, negative: true }),
    source({ key: 'out::operator', characterId: 'out', characterName: '队伍外干员', domain: 'operator', label: '队伍外来源', damage: 100, shareOfActual: 0.125, includedBuffCount: 2, negative: false }),
  ];
  const attributedTotal = sources.reduce((sum, item) => sum + item.damage, 0);
  const residualTotal = actualTotal - attributedTotal;
  return {
    policyVersion: RDPS_POLICY_VERSION,
    actualTotal,
    attributionWorldTotal: 680,
    baselineTotal: 350,
    attributedTotal,
    residualTotal,
    accountingError: 0,
    owenEfficiencyError: 0,
    hierarchyError: 0,
    sources,
    characters: [
      characterContribution({ characterId: 'c1', characterName: '干员一', damage: 230, shareOfActual: 0.2875, domains: [
        domainContribution({ domain: 'operator', damage: 260, shareOfCharacter: 1.1304347826086956 }),
        domainContribution({ domain: 'weapon', damage: -30, shareOfCharacter: -0.13043478260869565 }),
      ] }),
    ],
    diagnostics: v2Diagnostics({
      resolvedExplicitDefinitionCount: 1,
      unresolvedDefinitionCount: 2,
      unresolvedApplicationCount: 2,
      outOfTeamCharacterCount: 1,
      excludedImbalanceEffectCount: 1,
      negativeContributionCount: 1,
      coalitionEvaluationCount: 32,
    }),
  };
}

/** 空队伍（无干员）summary。 */
export function buildEmptySummaryFixture(): RdpsAttributionSummary {
  return {
    policyVersion: RDPS_POLICY_VERSION,
    actualTotal: 0,
    attributionWorldTotal: 0,
    baselineTotal: 0,
    attributedTotal: 0,
    residualTotal: 0,
    accountingError: 0,
    owenEfficiencyError: 0,
    hierarchyError: 0,
    sources: [],
    characters: [],
    diagnostics: v2Diagnostics(),
  };
}

// ── 对账断言 helper ─────────────────────────────────────────────────────────

export const RECONCILIATION_TOLERANCE = 1e-6;

/** 断言 actualTotal = attributedTotal + residualTotal（总账误差在规格误差内）。 */
export function assertReconciliation(summary: RdpsAttributionSummary, tolerance = RECONCILIATION_TOLERANCE): void {
  const actual = summary.actualTotal;
  const left = summary.attributedTotal + summary.residualTotal;
  const allowed = tolerance * Math.max(1, Math.abs(actual));
  if (Math.abs(actual - left) > allowed) {
    throw new Error(
      `reconciliation failed: actual=${actual} attributed+residual=${left} (allowed ${allowed})`,
    );
  }
  if (Math.abs(summary.accountingError - Math.abs(actual - left)) > allowed) {
    throw new Error('accountingError field does not match the actual residual gap');
  }
}

/** 断言 Owen 效率误差：sum(source.damage) ≈ attributionWorldTotal - baselineTotal。 */
export function assertOwenEfficiency(summary: RdpsAttributionSummary, tolerance = RECONCILIATION_TOLERANCE): void {
  const sum = summary.sources.reduce((total, item) => total + item.damage, 0);
  const world = summary.attributionWorldTotal - summary.baselineTotal;
  const allowed = tolerance * Math.max(1, Math.abs(world));
  if (Math.abs(sum - world) > allowed) {
    throw new Error(
      `owen efficiency failed: sum(sources)=${sum} worldDelta=${world} (allowed ${allowed})`,
    );
  }
  if (Math.abs(summary.owenEfficiencyError - Math.abs(sum - world)) > allowed) {
    throw new Error('owenEfficiencyError field does not match the computed gap');
  }
}

/** 断言层级求和：characters 的域贡献之和 = 队伍来源贡献之和。 */
export function assertHierarchy(summary: RdpsAttributionSummary, tolerance = RECONCILIATION_TOLERANCE): void {
  const teamSourceSum = summary.sources
    .filter((item) => item.characterId !== undefined && summary.characters.some((c) => c.characterId === item.characterId))
    .reduce((total, item) => total + item.damage, 0);
  const characterDomainSum = summary.characters.reduce(
    (total, character) => total + character.domains.reduce((inner, domain) => inner + domain.damage, 0),
    0,
  );
  const allowed = tolerance * Math.max(1, Math.abs(characterDomainSum));
  if (Math.abs(characterDomainSum - teamSourceSum) > allowed) {
    throw new Error(
      `hierarchy failed: characters=${characterDomainSum} teamSources=${teamSourceSum} (allowed ${allowed})`,
    );
  }
}

/** 断言来源贡献之和等于 attributedTotal。 */
export function assertSourcesSumToAttributed(summary: RdpsAttributionSummary, tolerance = RECONCILIATION_TOLERANCE): void {
  const sum = summary.sources.reduce((total, item) => total + item.damage, 0);
  const allowed = tolerance * Math.max(1, Math.abs(summary.attributedTotal));
  if (Math.abs(sum - summary.attributedTotal) > allowed) {
    throw new Error(
      `sources do not sum to attributedTotal: sum=${sum} attributed=${summary.attributedTotal}`,
    );
  }
}

/** 断言每个干员的域贡献之和等于该干员贡献。 */
export function assertDomainsSumToCharacter(summary: RdpsAttributionSummary, tolerance = RECONCILIATION_TOLERANCE): void {
  for (const character of summary.characters) {
    const sum = character.domains.reduce((total, item) => total + item.damage, 0);
    const allowed = tolerance * Math.max(1, Math.abs(character.damage));
    if (Math.abs(sum - character.damage) > allowed) {
      throw new Error(
        `domains do not sum to character ${character.characterId}: sum=${sum} damage=${character.damage}`,
      );
    }
  }
}

/** 断言干员贡献之和等于 attributedTotal（图 4 数据合同；仅适用于无队伍外 fixture）。 */
export function assertCharactersSumToAttributed(summary: RdpsAttributionSummary, tolerance = RECONCILIATION_TOLERANCE): void {
  const sum = summary.characters.reduce((total, item) => total + item.damage, 0);
  const allowed = tolerance * Math.max(1, Math.abs(summary.attributedTotal));
  if (Math.abs(sum - summary.attributedTotal) > allowed) {
    throw new Error(
      `characters do not sum to attributedTotal: sum=${sum} attributed=${summary.attributedTotal}`,
    );
  }
}

/** 全套对账断言（图 3 / 图 4 数据合同）。characters 只覆盖当前四人。 */
export function assertFullReconciliation(summary: RdpsAttributionSummary): void {
  assertReconciliation(summary);
  assertSourcesSumToAttributed(summary);
  assertDomainsSumToCharacter(summary);
  assertOwenEfficiency(summary);
}

// ── coalition cache key fixture ──────────────────────────────────────────────

export const COALITION_CACHE_KEY_CASES = [
  {
    policyVersion: RDPS_POLICY_VERSION,
    fingerprint: 'btn-1|btn-2',
    mask: '0b010101',
    expected: `${RDPS_POLICY_VERSION}|btn-1|btn-2|0b010101`,
  },
  {
    policyVersion: RDPS_POLICY_VERSION,
    fingerprint: 'empty',
    mask: '0b000000',
    expected: `${RDPS_POLICY_VERSION}|empty|0b000000`,
  },
];

export { parseRdpsSourceKey };
