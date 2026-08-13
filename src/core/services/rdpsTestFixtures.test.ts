import {
  assertFullReconciliation,
  assertReconciliation,
  assertSourcesSumToAttributed,
  buildEmptySummaryFixture,
  buildFourCharacterSummaryFixture,
  buildNegativeAndOutOfTeamSummaryFixture,
  buildFixtureSourceKeys,
  COALITION_CACHE_KEY_CASES,
  createTwoCharacterInteractionWorld,
  SOURCE_KEY_FIXTURE_CASES,
} from './rdpsTestFixtures';
import { buildCoalitionCacheKey, parseRdpsSourceKey } from './rdpsAttribution.types';

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertClose(actual: number, expected: number, message: string): void {
  if (Math.abs(actual - expected) > 1e-9) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

// 来源键解析合同
for (const item of SOURCE_KEY_FIXTURE_CASES) {
  const parsed = parseRdpsSourceKey(item.input);
  if (item.expected === null) {
    assertEqual(parsed, null, `parse should reject ${item.input}`);
  } else {
    assertEqual(parsed?.characterId, item.expected.characterId, `parse ${item.input} characterId`);
    assertEqual(parsed?.domain, item.expected.domain, `parse ${item.input} domain`);
  }
}

// coalition cache key 组成
for (const item of COALITION_CACHE_KEY_CASES) {
  const key = buildCoalitionCacheKey(item.policyVersion, item.fingerprint, item.mask);
  assertEqual(key, item.expected, 'coalition cache key composition');
}

// 来源键 fixture 确定性
const keysA = buildFixtureSourceKeys();
const keysB = buildFixtureSourceKeys();
assertEqual(keysA.operatorAlpha, 'op-alpha::operator', 'operator alpha key');
assertEqual(keysA.weaponAlpha, 'op-alpha::weapon', 'weapon alpha key');
assertEqual(keysA.operatorBeta, 'op-beta::operator', 'operator beta key');
assertEqual(JSON.stringify(keysA), JSON.stringify(keysB), 'fixture keys are deterministic');

// 对账断言 helper：正例
assertFullReconciliation(buildFourCharacterSummaryFixture());
assertFullReconciliation(buildNegativeAndOutOfTeamSummaryFixture());
assertFullReconciliation(buildEmptySummaryFixture());
// 四人无队伍外的 fixture 还必须满足 characters 求和（图 4 数据合同）
import { assertCharactersSumToAttributed } from './rdpsTestFixtures';
assertCharactersSumToAttributed(buildFourCharacterSummaryFixture());

// 对账断言 helper：负例必须抛错
let caught = false;
try {
  const bad = buildFourCharacterSummaryFixture();
  bad.attributedTotal += 1;
  assertReconciliation(bad);
} catch {
  caught = true;
}
assertEqual(caught, true, 'assertReconciliation must catch a broken total');

caught = false;
try {
  const bad = buildFourCharacterSummaryFixture();
  bad.sources = bad.sources.map((item) => ({ ...item, damage: item.damage + 1 }));
  assertSourcesSumToAttributed(bad);
} catch {
  caught = true;
}
assertEqual(caught, true, 'assertSourcesSumToAttributed must catch broken source sums');

// Owen 数学 fixture 确定性
const world = createTwoCharacterInteractionWorld();
assertEqual(world.leafNames.length, 4, 'two-character world has four leaves');
const full = world.valueOfCoalition(new Set(['A1', 'A2', 'B1', 'B2']));
assertClose(full, 10 + 4 + 6 + 3 + 12, 'full coalition value includes the interaction term');
const partial = world.valueOfCoalition(new Set(['A1', 'B1']));
assertClose(partial, 10 + 6 + 12, 'pair coalition includes the interaction term');
const single = world.valueOfCoalition(new Set(['A2', 'B2']));
assertClose(single, 4 + 3, 'non-interacting leaves are additive');

// 图表 summary fixture 分母正确
const four = buildFourCharacterSummaryFixture();
for (const character of four.characters) {
  for (const domain of character.domains) {
    assertClose(
      domain.shareOfCharacter,
      character.damage === 0 ? 0 : domain.damage / character.damage,
      `shareOfCharacter for ${character.characterId}/${domain.domain}`,
    );
  }
}
for (const item of four.sources) {
  assertClose(
    item.shareOfActual,
    four.actualTotal === 0 ? 0 : item.damage / four.actualTotal,
    `shareOfActual for ${item.key}`,
  );
}
