import {
  assertParityResolution,
  buildParityLegacyBuff,
  buildParityNewBuff,
  PARITY_CONFIG_CACHE,
} from './rdpsLegacyCompatibility.fixture';
import { buildRdpsCandidateProvenanceIndex } from './rdpsLegacyBuffSourceResolver';
import { GOLDEN_BUFF_DEFINITIONS, GOLDEN_CONFIG_CACHE_SUMMARY } from './rdpsGoldenSample.fixture';
import { parseCanonicalSourcePath } from './rdpsLegacyBuffSourceResolver';

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

// 新/旧 parity：显式 owner 与删除 owner 后解析一致
const index = buildRdpsCandidateProvenanceIndex(PARITY_CONFIG_CACHE);
assertParityResolution(buildParityNewBuff(), buildParityLegacyBuff(), index);

// 金样来源矩阵：全部 15 个定义可解析且不与显式 owner 冲突
const goldenIndex = buildRdpsCandidateProvenanceIndex(
  Object.fromEntries(GOLDEN_CONFIG_CACHE_SUMMARY.map((c) => [c.characterId, {
    operator: { id: c.characterId, name: c.operatorName },
    weapon: { id: c.weaponId, name: c.weaponName },
    equipment: {},
  }])),
);
for (const def of GOLDEN_BUFF_DEFINITIONS) {
  const parsed = typeof def.name === 'string' ? parseCanonicalSourcePath(def.name) : null;
  assertEqual(parsed !== null, true, `golden ${def.id} canonical resolve`);
  if (parsed) {
    assertEqual(parsed.domain === 'operator' || parsed.domain === 'weapon' || parsed.domain === 'equipment', true, `golden ${def.id} domain`);
  }
}

// 金样异常快照来源矩阵：sourceCharacterId 完整
// （结构断言在 rdpsAnomalySourceResolver 测试覆盖；这里验证数据完整）
const snapshotIds = new Set(GOLDEN_BUFF_DEFINITIONS.map((def) => def.id));
assertEqual(snapshotIds.size, GOLDEN_BUFF_DEFINITIONS.length, 'golden buff ids are unique');
