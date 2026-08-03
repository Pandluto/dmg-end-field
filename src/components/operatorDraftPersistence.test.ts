import assert from 'node:assert/strict';
import {
  OPERATOR_DRAFT_STORAGE_KEY,
  OPERATOR_LIBRARY_STORAGE_KEY,
  createOperatorDraftRepository,
  type OperatorDraftStorage,
} from './operatorDraftPersistence';
import {
  createDefaultDraft,
  normalizeDraft,
  type OperatorDraft,
} from './operatorDraftPageModel';

class MemoryStorage implements OperatorDraftStorage {
  readonly values = new Map<string, string>();
  readonly setCalls: Array<{ key: string; value: string }> = [];
  flushCalls = 0;
  setFailureKey: string | null = null;
  setFailure: Error | null = null;
  flushImplementation: () => Promise<void> = async () => undefined;

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (key === this.setFailureKey) {
      throw this.setFailure;
    }
    this.values.set(key, value);
    this.setCalls.push({ key, value });
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  flush(): Promise<void> {
    this.flushCalls += 1;
    return this.flushImplementation();
  }
}

function makeDraft(overrides: Partial<OperatorDraft> = {}): OperatorDraft {
  const draft = createDefaultDraft();
  return {
    ...draft,
    ...overrides,
    attributes: overrides.attributes ?? draft.attributes,
    skills: overrides.skills ?? draft.skills,
    buffs: overrides.buffs ?? draft.buffs,
  };
}

function storageWith(entries: Array<[string, string]>): MemoryStorage {
  const storage = new MemoryStorage();
  entries.forEach(([key, value]) => storage.values.set(key, value));
  return storage;
}

assert.equal(OPERATOR_DRAFT_STORAGE_KEY, 'def.operator-editor.draft.v1');
assert.equal(OPERATOR_LIBRARY_STORAGE_KEY, 'def.operator-editor.library.v1');

const emptyRepository = createOperatorDraftRepository(new MemoryStorage());
assert.deepEqual(emptyRepository.loadDraft(), createDefaultDraft());
assert.deepEqual(emptyRepository.loadLibrary(), {});

const malformedStorage = storageWith([
  [OPERATOR_DRAFT_STORAGE_KEY, '{broken'],
  [OPERATOR_LIBRARY_STORAGE_KEY, '{broken'],
]);
const malformedRepository = createOperatorDraftRepository(malformedStorage);
assert.deepEqual(malformedRepository.loadDraft(), createDefaultDraft());
assert.deepEqual(malformedRepository.loadLibrary(), {});

const draftWithLegacyValues = makeDraft({
  id: ' legacy-operator ',
  name: ' 旧干员 ',
  attributes: {
    strength: 12,
  } as never,
  skills: {
    'skill-A-1': {
      displayName: '',
      buttonType: 'A',
      iconUrl: '',
      hitCount: 99,
      hitMeta: {
        hit1: {
          displayName: '',
          element: 'physical',
          skillType: 'A',
          multiplier: 1.25,
          levels: { L1: 2 } as never,
        },
      },
    },
  },
});
const validDraftStorage = storageWith([
  [OPERATOR_DRAFT_STORAGE_KEY, JSON.stringify(draftWithLegacyValues)],
]);
const validDraftRepository = createOperatorDraftRepository(validDraftStorage);
const loadedDraft = validDraftRepository.loadDraft();
assert.equal(loadedDraft.id, ' legacy-operator ');
assert.equal(loadedDraft.name, ' 旧干员 ');
assert.equal(loadedDraft.attributes.strength.level1, 12);
assert.equal(loadedDraft.skills['skill-A-1'].displayName, '新技能1');
assert.equal(loadedDraft.skills['skill-A-1'].hitMeta.hit1.levels.L2, 1.25);
assert.equal('multiplier' in loadedDraft.skills['skill-A-1'].hitMeta.hit1, false);

const goodLibraryDraft = makeDraft({ id: 'library-good', name: '库草稿' });
const libraryDraftWithLegacyValues = makeDraft({
  id: 'library-legacy',
  name: ' 库旧草稿 ',
  attributes: { strength: 7 } as never,
});
const libraryStorage = storageWith([
  [OPERATOR_LIBRARY_STORAGE_KEY, JSON.stringify({
    good: goodLibraryDraft,
    legacy: libraryDraftWithLegacyValues,
    invalid: { id: '', name: '坏条目', skills: {} },
    malformed: '{not-a-draft}',
  })],
]);
const loadedLibrary = createOperatorDraftRepository(libraryStorage).loadLibrary();
assert.deepEqual(Object.keys(loadedLibrary), ['good', 'legacy']);
assert.equal(loadedLibrary.good.name, '库草稿');
assert.equal(loadedLibrary.legacy.name, ' 库旧草稿 ');
assert.equal(loadedLibrary.legacy.attributes.strength.level90, 7);

const savedDraft = makeDraft({ id: 'saved-operator', name: '保存干员' });
const saveStorage = new MemoryStorage();
const saveRepository = createOperatorDraftRepository(saveStorage);
await saveRepository.saveDraft(savedDraft);
assert.deepEqual(saveStorage.setCalls.map(({ key }) => key), [
  OPERATOR_DRAFT_STORAGE_KEY,
  OPERATOR_LIBRARY_STORAGE_KEY,
]);
assert.deepEqual(JSON.parse(saveStorage.values.get(OPERATOR_DRAFT_STORAGE_KEY) ?? ''), savedDraft);
assert.deepEqual(JSON.parse(saveStorage.values.get(OPERATOR_LIBRARY_STORAGE_KEY) ?? ''), {
  [savedDraft.id]: savedDraft,
});
assert.equal(saveStorage.flushCalls, 1);

let resolveSaveFlush: (() => void) | undefined;
const deferredSaveFlush = new Promise<void>((resolve) => {
  resolveSaveFlush = resolve;
});
const deferredSaveStorage = new MemoryStorage();
deferredSaveStorage.flushImplementation = () => deferredSaveFlush;
let deferredSaveResolved = false;
const deferredSave = createOperatorDraftRepository(deferredSaveStorage)
  .saveDraft(savedDraft)
  .then(() => {
    deferredSaveResolved = true;
  });
await Promise.resolve();
assert.equal(deferredSaveResolved, false, 'saveDraft must remain pending until flush resolves');
resolveSaveFlush?.();
await deferredSave;
assert.equal(deferredSaveResolved, true);

let resolveRevisionFlush: (() => void) | undefined;
const revisionFlush = new Promise<void>((resolve) => {
  resolveRevisionFlush = resolve;
});
const revisionStorage = new MemoryStorage();
revisionStorage.flushImplementation = () => revisionFlush;
const revisionRepository = createOperatorDraftRepository(revisionStorage);
let currentDraftDuringSave = savedDraft;
const revisionSave = revisionRepository.saveDraftRevision(
  savedDraft,
  () => currentDraftDuringSave,
);
await Promise.resolve();
currentDraftDuringSave = makeDraft({
  id: savedDraft.id,
  name: '保存期间继续编辑',
});
resolveRevisionFlush?.();
assert.equal(
  await revisionSave,
  'superseded',
  'a durable save must report edits that replaced its snapshot during flush',
);
assert.equal(currentDraftDuringSave.name, '保存期间继续编辑');

const currentRevisionRepository = createOperatorDraftRepository(new MemoryStorage());
assert.equal(
  await currentRevisionRepository.saveDraftRevision(savedDraft, () => savedDraft),
  'current',
  'an unchanged draft snapshot may be reported as current after flush',
);

const saveFlushFailure = new Error('operator save flush failed');
const failedFlushStorage = new MemoryStorage();
failedFlushStorage.flushImplementation = async () => {
  throw saveFlushFailure;
};
await assert.rejects(
  createOperatorDraftRepository(failedFlushStorage).saveDraft(savedDraft),
  (error) => error === saveFlushFailure,
);

for (const failedKey of [OPERATOR_DRAFT_STORAGE_KEY, OPERATOR_LIBRARY_STORAGE_KEY]) {
  const setFailure = new Error(`operator set failed: ${failedKey}`);
  const failedSetStorage = new MemoryStorage();
  failedSetStorage.setFailureKey = failedKey;
  failedSetStorage.setFailure = setFailure;
  await assert.rejects(
    createOperatorDraftRepository(failedSetStorage).saveDraft(savedDraft),
    (error) => error === setFailure,
  );
  assert.equal(failedSetStorage.flushCalls, 0, 'flush must not run after setItem failure');
}

const existingDraft = makeDraft({ id: 'existing', name: '已有草稿' });
const importStorage = storageWith([
  [OPERATOR_LIBRARY_STORAGE_KEY, JSON.stringify({ existing: existingDraft })],
]);
const importRepository = createOperatorDraftRepository(importStorage);
const importedDraft = makeDraft({ id: 'imported', name: '导入草稿' });
const mergedLibrary = await importRepository.mergeLibrary({ imported: importedDraft });
assert.deepEqual(Object.keys(mergedLibrary), ['existing', 'imported']);
assert.deepEqual(importRepository.loadLibrary(), mergedLibrary);
assert.equal(importStorage.flushCalls, 1);

let resolveImportFlush: (() => void) | undefined;
const importFlush = new Promise<void>((resolve) => {
  resolveImportFlush = resolve;
});
const deferredImportStorage = storageWith([
  [OPERATOR_LIBRARY_STORAGE_KEY, JSON.stringify({ existing: existingDraft })],
]);
deferredImportStorage.flushImplementation = () => importFlush;
let deferredImportResolved = false;
const deferredImport = createOperatorDraftRepository(deferredImportStorage)
  .mergeLibrary({ imported: importedDraft })
  .then(() => {
    deferredImportResolved = true;
  });
await Promise.resolve();
assert.equal(deferredImportResolved, false, 'mergeLibrary must remain pending until flush resolves');
resolveImportFlush?.();
await deferredImport;
assert.equal(deferredImportResolved, true);

const deleteResult = await importRepository.deleteFromLibrary('existing');
assert.equal(deleteResult.deleted, true);
assert.deepEqual(Object.keys(deleteResult.library), ['imported']);
assert.deepEqual(importRepository.loadLibrary(), { imported: importedDraft });
assert.equal(importStorage.flushCalls, 2);

const noOpSetCount = importStorage.setCalls.length;
const noOpFlushCount = importStorage.flushCalls;
const noOpDeleteResult = await importRepository.deleteFromLibrary('missing');
assert.equal(noOpDeleteResult.deleted, false);
assert.deepEqual(noOpDeleteResult.library, { imported: importedDraft });
assert.equal(importStorage.setCalls.length, noOpSetCount, 'missing delete must not write');
assert.equal(importStorage.flushCalls, noOpFlushCount, 'missing delete must not flush');

let resolveDeleteFlush: (() => void) | undefined;
const deleteFlush = new Promise<void>((resolve) => {
  resolveDeleteFlush = resolve;
});
const deferredDeleteStorage = storageWith([
  [OPERATOR_LIBRARY_STORAGE_KEY, JSON.stringify({ existing: existingDraft })],
]);
deferredDeleteStorage.flushImplementation = () => deleteFlush;
let deferredDeleteResolved = false;
const deferredDelete = createOperatorDraftRepository(deferredDeleteStorage)
  .deleteFromLibrary('existing')
  .then(() => {
    deferredDeleteResolved = true;
  });
await Promise.resolve();
assert.equal(deferredDeleteResolved, false, 'deleteFromLibrary must remain pending until flush resolves');
resolveDeleteFlush?.();
await deferredDelete;
assert.equal(deferredDeleteResolved, true);

for (const operation of [
  (repository: ReturnType<typeof createOperatorDraftRepository>) => repository.mergeLibrary({ imported: importedDraft }),
  (repository: ReturnType<typeof createOperatorDraftRepository>) => repository.deleteFromLibrary('existing'),
]) {
  const operationFailure = new Error('operator library flush failed');
  const failedOperationStorage = storageWith([
    [OPERATOR_LIBRARY_STORAGE_KEY, JSON.stringify({ existing: existingDraft })],
  ]);
  failedOperationStorage.flushImplementation = async () => {
    throw operationFailure;
  };
  await assert.rejects(
    operation(createOperatorDraftRepository(failedOperationStorage)),
    (error) => error === operationFailure,
  );
}

let retryDeleteFlushAttempts = 0;
const retryDeleteStorage = storageWith([
  [OPERATOR_LIBRARY_STORAGE_KEY, JSON.stringify({ existing: existingDraft })],
]);
retryDeleteStorage.flushImplementation = async () => {
  retryDeleteFlushAttempts += 1;
  if (retryDeleteFlushAttempts === 1) {
    throw new Error('first delete flush failed');
  }
};
const retryDeleteRepository = createOperatorDraftRepository(retryDeleteStorage);
await assert.rejects(
  retryDeleteRepository.deleteFromLibrary('existing'),
  /first delete flush failed/,
);
assert.deepEqual(
  retryDeleteRepository.loadLibrary(),
  { existing: existingDraft },
  'a failed delete must restore the in-memory library so the user can retry',
);
const retriedDelete = await retryDeleteRepository.deleteFromLibrary('existing');
assert.equal(retriedDelete.deleted, true);
assert.deepEqual(retriedDelete.library, {});
assert.equal(retryDeleteFlushAttempts, 2);

const canonicalDraft = makeDraft({ id: 'canonical', name: '规范化检查' });
const expectedCanonical = normalizeDraft(JSON.parse(JSON.stringify(canonicalDraft)) as OperatorDraft);
assert.deepEqual(
  createOperatorDraftRepository(storageWith([
    [OPERATOR_DRAFT_STORAGE_KEY, JSON.stringify(canonicalDraft)],
  ])).loadDraft(),
  expectedCanonical,
);

console.log('Operator SQLite draft repository durable flush contract: PASS');
