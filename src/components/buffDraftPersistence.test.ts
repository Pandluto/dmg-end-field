import assert from 'node:assert/strict';
import { createDefaultBuffDraft, type BuffDraft } from './buffDraftModel';
import {
  BUFF_DRAFT_STORAGE_KEY,
  BUFF_LIBRARY_STORAGE_KEY,
  createBuffDraftRepository,
  type BuffDraftStorage,
} from './buffDraftPersistence';

class MemoryStorage implements BuffDraftStorage {
  readonly values = new Map<string, string>();
  failure: Error | null = null;
  failureKey: string | null = null;

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (key === this.failureKey) {
      throw this.failure;
    }
    this.values.set(key, value);
  }
}

assert.equal(BUFF_DRAFT_STORAGE_KEY, 'def.buff-editor.draft.v1');
assert.equal(BUFF_LIBRARY_STORAGE_KEY, 'def.buff-editor.library.v1');

const storage = new MemoryStorage();
const repository = createBuffDraftRepository(storage);
assert.deepEqual(repository.loadDraft(), createDefaultBuffDraft());
assert.deepEqual(repository.loadLibrary(), {});

storage.setItem(BUFF_DRAFT_STORAGE_KEY, '{broken');
storage.setItem(BUFF_LIBRARY_STORAGE_KEY, '{broken');
assert.deepEqual(repository.loadDraft(), createDefaultBuffDraft());
assert.deepEqual(repository.loadLibrary(), {});

storage.setItem(BUFF_DRAFT_STORAGE_KEY, JSON.stringify({
  id: ' legacy-draft ',
  name: ' 旧草稿 ',
  sourceName: ' 测试来源 ',
  buffs: {
    'buff-4': {
      name: 'legacy_buff',
      type: 'magicTakenDmgBonus',
      value: 12,
      category: 'positive',
    },
  },
}));
const loadedDraft = repository.loadDraft();
assert.equal(loadedDraft.id, 'legacy-draft');
assert.equal(loadedDraft.name, '旧草稿');
assert.equal(loadedDraft.items['item-1'].effects['buff-4'].type, 'magicVulnerability');

storage.setItem(BUFF_LIBRARY_STORAGE_KEY, JSON.stringify({
  outerKey: {
    ...loadedDraft,
    id: ' library-draft ',
    name: ' 库草稿 ',
  },
}));
const loadedLibrary = repository.loadLibrary();
assert.deepEqual(Object.keys(loadedLibrary), ['outerKey']);
assert.equal(loadedLibrary.outerKey.id, 'library-draft');
assert.equal(loadedLibrary.outerKey.name, '库草稿');

const nextDraft: BuffDraft = {
  ...createDefaultBuffDraft(),
  id: 'saved-draft',
  name: '保存草稿',
};
repository.saveDraft(nextDraft);
repository.saveLibrary({ 'saved-draft': nextDraft });
assert.deepEqual(JSON.parse(storage.getItem(BUFF_DRAFT_STORAGE_KEY) ?? ''), nextDraft);
assert.deepEqual(JSON.parse(storage.getItem(BUFF_LIBRARY_STORAGE_KEY) ?? ''), { 'saved-draft': nextDraft });

for (const [failedKey, save] of [
  [BUFF_DRAFT_STORAGE_KEY, () => repository.saveDraft(nextDraft)],
  [BUFF_LIBRARY_STORAGE_KEY, () => repository.saveLibrary({ 'saved-draft': nextDraft })],
] as const) {
  const previousValue = storage.getItem(failedKey);
  const failure = new Error(`write failed: ${failedKey}`);
  storage.failureKey = failedKey;
  storage.failure = failure;
  assert.throws(save, (error) => error === failure, `${failedKey} must propagate storage failures`);
  assert.equal(storage.getItem(failedKey), previousValue, `${failedKey} must retain its previous value after a failed write`);
  storage.failureKey = null;
  storage.failure = null;
}

console.log('Buff SQLite draft repository contract: PASS');
