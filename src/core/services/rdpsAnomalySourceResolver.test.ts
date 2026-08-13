import { resolveAnomalySnapshotSource, resolveComboSource } from './rdpsAnomalySourceResolver';
import { buildRdpsCharacterDirectory } from './rdpsCharacterDirectory';

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

const directory = buildRdpsCharacterDirectory({
  selectedCharacterIds: ['laevatain', 'langwei', 'aierdaila', 'kamiao'],
  staffLines: [],
  buttons: [
    { id: 'btn-laevatain', characterId: 'laevatain', characterName: '莱万汀', staffIndex: 0 },
    { id: 'btn-legacy', characterId: null, characterName: null, staffIndex: 2 },
  ],
  operatorConfigCache: {
    laevatain: { operator: { id: 'laevatain', name: '莱万汀' } },
    aierdaila: { operator: { id: 'aierdaila', name: '艾尔黛拉' } },
  },
  anomalySnapshots: [{ sourceCharacterId: 'aierdaila', sourceCharacterName: '艾尔黛拉' }],
});

// 异常快照：sourceCharacterId 优先
const snapshot = resolveAnomalySnapshotSource({
  id: 13,
  sourceButtonId: 'btn-laevatain',
  sourceCharacterId: 'aierdaila',
  sourceCharacterName: '艾尔黛拉',
}, directory);
assertEqual(snapshot.method, 'anomaly-snapshot', 'snapshot uses source character');
assertEqual(snapshot.characterId, 'aierdaila', 'snapshot character');
assertEqual(snapshot.domain, 'operator', 'snapshot domain operator');

// 异常快照：缺 sourceCharacterId，sourceButtonId 恢复
const snapshotViaButton = resolveAnomalySnapshotSource({
  id: 7,
  sourceButtonId: 'btn-laevatain',
  sourceCharacterId: null,
  sourceCharacterName: '莱万汀',
} as never, directory);
assertEqual(snapshotViaButton.characterId, 'laevatain', 'snapshot recovers via source button');

// 连击：显式来源
const comboExplicit = resolveComboSource(
  { id: 'combo-1', sourceCharacterId: 'kamiao' },
  { id: 'btn-laevatain', characterId: 'laevatain' },
  directory,
);
assertEqual(comboExplicit.method, 'explicit', 'combo explicit wins');
assertEqual(comboExplicit.characterId, 'kamiao', 'combo explicit character');

// 连击：旧卡无来源 → containing button
const comboLegacy = resolveComboSource(
  { id: 'combo-legacy', sourceCharacterId: undefined },
  { id: 'btn-laevatain', characterId: 'laevatain' },
  directory,
);
assertEqual(comboLegacy.method, 'container-button', 'legacy combo uses containing button');
assertEqual(comboLegacy.characterId, 'laevatain', 'legacy combo character');

// 连击：旧卡 + 无 characterId 的按钮 → staffIndex 恢复
const comboStaffIndex = resolveComboSource(
  { id: 'combo-staff', sourceCharacterId: undefined },
  { id: 'btn-legacy', characterId: null },
  directory,
);
assertEqual(comboStaffIndex.characterId, 'aierdaila', 'legacy combo recovers via staff index');

// 连击：按钮关系缺失 → unresolved（不归给出伤者）
const comboMissing = resolveComboSource(
  { id: 'combo-missing', sourceCharacterId: undefined },
  undefined,
  directory,
);
assertEqual(comboMissing.method, 'unresolved', 'combo without button goes unresolved');
