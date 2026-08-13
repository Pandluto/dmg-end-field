import { buildRdpsCharacterDirectory } from './rdpsCharacterDirectory';
import {
  GOLDEN_ANOMALY_SNAPSHOTS,
  GOLDEN_BUTTONS,
  GOLDEN_CONFIG_CACHE_SUMMARY,
  GOLDEN_SELECTED_CHARACTER_IDS,
  GOLDEN_STAFF_LINES,
} from './rdpsGoldenSample.fixture';

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

// 金样：队伍四人顺序稳定
const directory = buildRdpsCharacterDirectory({
  selectedCharacterIds: GOLDEN_SELECTED_CHARACTER_IDS,
  staffLines: GOLDEN_STAFF_LINES,
  buttons: GOLDEN_BUTTONS,
  operatorConfigCache: Object.fromEntries(GOLDEN_CONFIG_CACHE_SUMMARY.map((c) => [
    c.characterId,
    { operator: { id: c.characterId, name: c.operatorName } },
  ])),
  anomalySnapshots: GOLDEN_ANOMALY_SNAPSHOTS,
});

// 队伍顺序
assertEqual(Array.from(directory.teamOrder.keys()).join(','), 'laevatain,langwei,aierdaila,kamiao', 'team order is stable');
// staffIndex → id
assertEqual(directory.idByStaffIndex.get(0), 'laevatain', 'staff 0 is laevatain');
assertEqual(directory.idByStaffIndex.get(3), 'kamiao', 'staff 3 is kamiao');
// 按钮 → 干员
assertEqual(directory.idByButtonId.get('uzno6fbto'), 'langwei', 'button maps to langwei');
assertEqual(directory.idByButtonId.get('frz3jxmvq'), 'laevatain', 'button maps to laevatain');
// 展示名
assertEqual(directory.nameByCharacterId.get('laevatain'), '莱万汀', 'laevatain display name');
assertEqual(directory.nameByCharacterId.get('kamiao'), '卡缪', 'kamiao display name');
// 队伍外 karin → 秋栗（spec 硬性要求）
assertEqual(directory.nameByCharacterId.get('chr_0019_karin'), '秋栗', 'karin resolves to 秋栗');
assertEqual(directory.unresolvedDisplayNameCount, 0, 'all golden ids resolve display names');

// 旧按钮无 characterId：staffIndex 恢复
const legacyDirectory = buildRdpsCharacterDirectory({
  selectedCharacterIds: ['laevatain', 'langwei', 'aierdaila', 'kamiao'],
  staffLines: [{ staffIndex: 2, characterId: null, characterName: '艾尔黛拉' }],
  buttons: [{ id: 'legacy-btn', characterId: null, characterName: null, staffIndex: 2 }],
  operatorConfigCache: {},
  anomalySnapshots: [],
});
assertEqual(legacyDirectory.idByButtonId.get('legacy-btn'), 'aierdaila', 'legacy button recovers character via staffIndex');

// 同名多 ID 冲突诊断
const conflictDirectory = buildRdpsCharacterDirectory({
  selectedCharacterIds: ['id-a', 'id-b'],
  staffLines: [],
  buttons: [],
  operatorConfigCache: {
    'id-a': { operator: { id: 'id-a', name: '同名干员' } },
    'id-b': { operator: { id: 'id-b', name: '同名干员' } },
  },
  anomalySnapshots: [],
});
assertEqual(conflictDirectory.conflicts.some((c) => c.includes('同名干员')), true, 'duplicate display name recorded as conflict');
