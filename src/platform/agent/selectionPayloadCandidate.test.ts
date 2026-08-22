import assert from 'node:assert/strict';
import type { Character } from '../../types';
import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';
import {
  buildPreparedSelectionPayload,
  resolvePreparedSelectionRoster,
} from './selectionPayloadCandidate';

const characters = {
  a: { id: 'operator-a', name: '干员 A' },
  b: { id: 'operator-b', name: '干员 B' },
  c: { id: 'operator-c', name: '干员 C' },
  d: { id: 'operator-d', name: '干员 D' },
  e: { id: 'operator-e', name: '干员 E' },
  f: { id: 'operator-f', name: '干员 F' },
  g: { id: 'operator-g', name: '干员 G' },
  h: { id: 'operator-h', name: '干员 H' },
} satisfies Record<string, Pick<Character, 'id' | 'name'>>;

function fixture(): TimelineSnapshotPayload {
  const button = (id: string, characterId: string, characterName: string, staffIndex: number, nodeIndex: number, buffs: string[]) => ({
    id,
    characterId,
    characterName,
    skillType: 'A' as const,
    staffIndex,
    lineIndex: staffIndex,
    nodeIndex,
    nodeNumber: nodeIndex + 1,
    position: { x: 100 + nodeIndex, y: 200 + staffIndex },
    runtimeSkillId: `${characterId}-skill-a`,
    skillDisplayName: `${characterName} A`,
    selectedBuff: buffs,
    panelConfig: { selectedBuff: buffs },
    createdAt: 1,
    updatedAt: 1,
  });
  const a = button('button-a', characters.a.id, characters.a.name, 0, 1, ['buff-shared']);
  const b = button('button-b', characters.b.id, characters.b.name, 1, 2, ['buff-shared', 'buff-b']);
  const c = button('button-c', characters.c.id, characters.c.name, 2, 3, []);
  const d = button('button-d', characters.d.id, characters.d.name, 3, 4, []);
  return {
    selectedCharacters: [characters.a.id, characters.b.id, characters.c.id, characters.d.id],
    timelineData: {
      version: '1.1.0',
      createdAt: 1,
      updatedAt: 1,
      staffLines: [a, b, c, d].map((entry, staffIndex) => ({
        staffIndex,
        characterName: entry.characterName,
        occupiedNodes: [entry.nodeIndex],
        buttons: [{ ...entry, buffIds: [...entry.selectedBuff] }],
      })),
    },
    skillButtonTable: { [a.id]: a, [b.id]: b, [c.id]: c, [d.id]: d },
    allBuffList: [
      { id: 'buff-shared', name: 'shared', displayName: '共享', sourceName: '来源', refCount: 99 },
      { id: 'buff-b', name: 'b', displayName: 'B', sourceName: '来源', refCount: 99 },
      { id: 'buff-orphan', name: 'orphan', displayName: '孤儿', sourceName: '来源', refCount: 99 },
    ],
    anomalyStateSnapshots: [],
    characterInputMap: { keep: { value: 1 } } as never,
    characterComputedMap: {},
    characterDisplayCacheMap: {},
    operatorConfigPageCache: { keep: { value: 1 } } as never,
  };
}

const base = fixture();

const availableCharacters = Object.values(characters) as Character[];
const resolvedByNames = resolvePreparedSelectionRoster({
  roster: {
    characterNames: ['干员 B', '干员 A'],
    nodeTitle: '调整阵容顺序',
    nodeDescription: '严格按名称解析阵容。',
    openCanvas: false,
  },
  availableCharacters,
});
assert.deepEqual(resolvedByNames.characters.map((character) => character.id), ['operator-b', 'operator-a']);
assert.equal(resolvedByNames.openCanvas, false);
const resolvedPairs = resolvePreparedSelectionRoster({
  roster: {
    characterIds: ['operator-a', 'operator-c'],
    characterNames: ['干员 A', '干员 C'],
    nodeTitle: '调整阵容',
    nodeDescription: 'ID 与名称必须逐项指向同一干员。',
  },
  availableCharacters,
});
assert.deepEqual(resolvedPairs.characters.map((character) => character.id), ['operator-a', 'operator-c']);
assert.equal(resolvedPairs.openCanvas, true);
assert.throws(
  () => resolvePreparedSelectionRoster({
    roster: {
      characterNames: ['干员 A', '不存在'],
      nodeTitle: '调整阵容',
      nodeDescription: '不得吞掉缺失项。',
    },
    availableCharacters,
  }),
  /missing: 不存在/u,
);
assert.throws(
  () => resolvePreparedSelectionRoster({
    roster: {
      characterIds: ['operator-a', 'operator-a'],
      nodeTitle: '调整阵容',
      nodeDescription: '不得吞掉重复项。',
    },
    availableCharacters,
  }),
  /duplicate values/u,
);
assert.throws(
  () => resolvePreparedSelectionRoster({
    roster: {
      characterIds: ['operator-a'],
      characterNames: ['干员 B'],
      nodeTitle: '调整阵容',
      nodeDescription: '不得接受错配身份。',
    },
    availableCharacters,
  }),
  /does not identify the same operator/u,
);
assert.throws(
  () => resolvePreparedSelectionRoster({
    roster: {
      characterNames: ['干员 A', '干员 B', '干员 C', '干员 D', '干员 E'],
      nodeTitle: '调整阵容',
      nodeDescription: '不得截断超过四人的阵容。',
    },
    availableCharacters,
  }),
  /between one and four/u,
);

const before = structuredClone(base);
const reordered = buildPreparedSelectionPayload({
  basePayload: base,
  nextCharacters: [characters.d, characters.b, characters.a, characters.c],
  now: 10,
});
assert.deepEqual(base, before, 'selection candidate must not mutate its base');
assert.equal(reordered.destination, 'current-timeline');
assert.deepEqual(reordered.payload.selectedCharacters, ['operator-d', 'operator-b', 'operator-a', 'operator-c']);
assert.deepEqual(reordered.payload.timelineData.staffLines.map((line) => line.characterName), ['干员 D', '干员 B', '干员 A', '干员 C']);
assert.equal(reordered.payload.skillButtonTable['button-a']?.staffIndex, 2);
assert.equal(reordered.payload.skillButtonTable['button-d']?.staffIndex, 0);
assert.deepEqual(reordered.retainedButtonIds, ['button-a', 'button-b', 'button-c', 'button-d']);
assert.deepEqual(reordered.removedButtonIds, []);
assert.deepEqual(reordered.payload.allBuffList.map((buff) => [buff.id, buff.refCount]), [
  ['buff-shared', 2],
  ['buff-b', 1],
]);
assert.deepEqual(reordered.payload.operatorConfigPageCache, base.operatorConfigPageCache);

const partial = buildPreparedSelectionPayload({
  basePayload: fixture(),
  nextCharacters: [characters.a, characters.c, characters.e],
  now: 11,
});
assert.equal(partial.destination, 'current-timeline');
assert.deepEqual(partial.retainedButtonIds, ['button-a', 'button-c']);
assert.deepEqual(partial.removedButtonIds, ['button-b', 'button-d']);
assert.deepEqual(Object.keys(partial.payload.skillButtonTable), ['button-a', 'button-c']);
assert.deepEqual(partial.payload.allBuffList.map((buff) => [buff.id, buff.refCount]), [['buff-shared', 1]]);

const replacement = buildPreparedSelectionPayload({
  basePayload: fixture(),
  nextCharacters: [characters.e, characters.f, characters.g, characters.h],
  now: 12,
});
assert.equal(replacement.destination, 'new-temporary-workspace');
assert.deepEqual(replacement.payload.selectedCharacters, ['operator-e', 'operator-f', 'operator-g', 'operator-h']);
assert.deepEqual(replacement.payload.timelineData.staffLines.map((line) => line.buttons.length), [0, 0, 0, 0]);
assert.deepEqual(replacement.payload.skillButtonTable, {});
assert.deepEqual(replacement.payload.operatorConfigPageCache, {});

assert.throws(
  () => buildPreparedSelectionPayload({
    basePayload: fixture(),
    nextCharacters: [characters.a, characters.a],
  }),
  /duplicate operator ids/u,
);

const missingBuff = fixture();
missingBuff.allBuffList = missingBuff.allBuffList.filter((buff) => buff.id !== 'buff-shared');
assert.throws(
  () => buildPreparedSelectionPayload({ basePayload: missingBuff, nextCharacters: [characters.a] }),
  /base payload is invalid|missing Buff reference/u,
);

console.log('Prepared selection payload contract: PASS');
