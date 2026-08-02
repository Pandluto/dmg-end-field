import assert from 'node:assert/strict';
import { createDefaultBuffDraft } from './buffDraftModel';
import {
  BUFF_DRAFT_STORAGE_KEY,
  BUFF_LIBRARY_STORAGE_KEY,
  BUFF_UNDO_LIMIT,
  BUFF_UNDO_STORAGE_KEY,
  createBuffUndoRepository,
  formatBuffUndoLabel,
  type BuffUndoStorage,
} from './buffDraftUndo';

class MemoryStorage implements BuffUndoStorage {
  readonly values = new Map<string, string>();
  readonly removedKeys: string[] = [];

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.removedKeys.push(key);
    this.values.delete(key);
  }
}

assert.equal(BUFF_DRAFT_STORAGE_KEY, 'def.buff-editor.draft.v1');
assert.equal(BUFF_LIBRARY_STORAGE_KEY, 'def.buff-editor.library.v1');
assert.equal(BUFF_UNDO_STORAGE_KEY, 'def.buff-editor.undo.v1');
assert.equal(BUFF_UNDO_LIMIT, 8);

const storage = new MemoryStorage();
let timestamp = 1_000;
const repository = createBuffUndoRepository(storage, {
  now: () => timestamp++,
  random: () => 0.5,
});

assert.deepEqual(repository.readSnapshots(), []);
storage.setItem(BUFF_UNDO_STORAGE_KEY, '{broken');
assert.deepEqual(repository.readSnapshots(), []);
storage.setItem(BUFF_UNDO_STORAGE_KEY, JSON.stringify({ not: 'an array' }));
assert.deepEqual(repository.readSnapshots(), []);

storage.setItem(BUFF_DRAFT_STORAGE_KEY, 'draft-before');
const capturedDraft = createDefaultBuffDraft();
repository.captureSnapshot('首次修改', {
  selectedDraftId: capturedDraft.id,
  draftState: capturedDraft,
  selectedItemKey: 'item-1',
  selectedEffectKey: 'buff-1',
});
capturedDraft.name = '捕获后修改，不应污染快照';

const firstSnapshot = repository.readSnapshots()[0];
assert.equal(firstSnapshot.id, '1000-i');
assert.equal(firstSnapshot.createdAt, 1001);
assert.equal(firstSnapshot.label, '首次修改');
assert.equal(firstSnapshot.selectedDraftId, 'custom-buff-001');
assert.equal(firstSnapshot.selectedItemKey, 'item-1');
assert.equal(firstSnapshot.selectedEffectKey, 'buff-1');
assert.equal(firstSnapshot.draftState?.name, '本地 Buff 草稿');
assert.deepEqual(firstSnapshot.localEntries, [
  [BUFF_DRAFT_STORAGE_KEY, 'draft-before'],
  [BUFF_LIBRARY_STORAGE_KEY, null],
]);

for (let index = 0; index < BUFF_UNDO_LIMIT + 2; index += 1) {
  storage.setItem(BUFF_DRAFT_STORAGE_KEY, `draft-${index}`);
  repository.captureSnapshot(`修改 ${index}`);
}

const limitedSnapshots = repository.readSnapshots();
assert.equal(limitedSnapshots.length, BUFF_UNDO_LIMIT);
assert.equal(limitedSnapshots[0].label, '修改 9');
assert.equal(limitedSnapshots.at(-1)?.label, '修改 2');

const restoreStorage = new MemoryStorage();
let restoreTimestamp = 2_000;
const restoreRepository = createBuffUndoRepository(restoreStorage, {
  now: () => restoreTimestamp++,
  random: () => 0.25,
});
restoreStorage.setItem(BUFF_DRAFT_STORAGE_KEY, 'old-draft');
restoreRepository.captureSnapshot('恢复目标', { selectedDraftId: 'old-id' });
restoreStorage.setItem(BUFF_DRAFT_STORAGE_KEY, 'new-draft');
restoreStorage.setItem(BUFF_LIBRARY_STORAGE_KEY, 'new-library');
restoreRepository.captureSnapshot('保留快照');

const restoreTarget = restoreRepository.readSnapshots().find((snapshot) => snapshot.label === '恢复目标');
assert.ok(restoreTarget);
assert.equal(restoreRepository.restoreSnapshot('missing'), null);
assert.equal(restoreRepository.readSnapshots().length, 2);

const restored = restoreRepository.restoreSnapshot(restoreTarget.id);
assert.equal(restored?.selectedDraftId, 'old-id');
assert.equal(restoreStorage.getItem(BUFF_DRAFT_STORAGE_KEY), 'old-draft');
assert.equal(restoreStorage.getItem(BUFF_LIBRARY_STORAGE_KEY), null);
assert.deepEqual(restoreStorage.removedKeys, [BUFF_LIBRARY_STORAGE_KEY]);
assert.deepEqual(restoreRepository.readSnapshots().map((snapshot) => snapshot.label), ['保留快照']);

const localTimestamp = new Date(2026, 7, 2, 3, 4, 5, 6).getTime();
assert.equal(formatBuffUndoLabel(localTimestamp), '2026-08-02 03:04:05.006');

console.log('Buff SQLite undo repository contract: PASS');
