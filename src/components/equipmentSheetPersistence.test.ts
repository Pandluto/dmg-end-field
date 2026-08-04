import assert from 'node:assert/strict';
import {
  EQUIPMENT_DRAFT_STORAGE_KEY,
  EQUIPMENT_LIBRARY_STORAGE_KEY,
  createEquipmentLibraryRepository,
  type EquipmentLibraryStorage,
} from './equipmentSheetPersistence';
import {
  normalizeEquipmentLibrary,
  type EquipmentLibrary,
} from './equipmentSheetModel';

class MemoryStorage implements EquipmentLibraryStorage {
  readonly values = new Map<string, string>();
  readonly setCalls: Array<{ key: string; value: string }> = [];
  flushCalls = 0;
  getFailureKey: string | null = null;
  getFailure: Error | null = null;
  setFailureKey: string | null = null;
  setFailure: Error | null = null;
  flushImplementation: () => Promise<void> = async () => undefined;

  getItem(key: string): string | null {
    if (key === this.getFailureKey) {
      throw this.getFailure;
    }
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (key === this.setFailureKey) {
      throw this.setFailure;
    }
    this.values.set(key, value);
    this.setCalls.push({ key, value });
  }

  flush(): Promise<void> {
    this.flushCalls += 1;
    return this.flushImplementation();
  }
}

function makeRawLibrary(name: string) {
  return {
    updatedAt: '2026-08-03T00:00:00.000Z',
    gearSets: {
      'gear-set-persistence': {
        gearSetId: 'gear-set-persistence',
        name,
        buffId: 'buff-persistence',
        equipments: {
          'equipment-persistence': {
            equipmentId: 'equipment-persistence',
            name: '持久化装备',
            part: 'invalid-part',
            fixedStat: {
              label: '旧固定属性',
              typeKey: 'invalid-fixed-type',
              value: '42',
              unit: 'invalid-unit',
            },
            effects: {
              effect1: {
                effectId: 'wrong-effect-id',
                label: '旧效果',
                typeKey: 'strengthBoost',
                category: 'invalid-category',
                unit: 'flat',
                levels: { '0': '12', '1': 'not-a-number' },
              },
            },
          },
        },
      },
    },
  };
}

function storageWith(entries: Array<[string, string]>): MemoryStorage {
  const storage = new MemoryStorage();
  entries.forEach(([key, value]) => storage.values.set(key, value));
  return storage;
}

assert.equal(EQUIPMENT_DRAFT_STORAGE_KEY, 'def.equipment-sheet.draft.v1');
assert.equal(EQUIPMENT_LIBRARY_STORAGE_KEY, 'def.equipment-sheet.library.v1');

const libraryRaw = makeRawLibrary('library 优先');
const draftRaw = makeRawLibrary('draft 备用');
const priorityStorage = storageWith([
  [EQUIPMENT_LIBRARY_STORAGE_KEY, JSON.stringify(libraryRaw)],
  [EQUIPMENT_DRAFT_STORAGE_KEY, JSON.stringify(draftRaw)],
]);
const priorityLoaded = createEquipmentLibraryRepository(priorityStorage).loadCachedLibrary();
assert.equal(priorityLoaded.gearSets['gear-set-persistence'].name, 'library 优先');

const draftOnlyStorage = storageWith([
  [EQUIPMENT_DRAFT_STORAGE_KEY, JSON.stringify(draftRaw)],
]);
assert.equal(
  createEquipmentLibraryRepository(draftOnlyStorage).loadCachedLibrary().gearSets['gear-set-persistence'].name,
  'draft 备用',
);

for (const invalidLibraryValue of [
  '',
  '   ',
  'null',
  '{malformed',
  JSON.stringify({ updatedAt: '', gearSets: {} }),
]) {
  const fallbackStorage = storageWith([
    [EQUIPMENT_LIBRARY_STORAGE_KEY, invalidLibraryValue],
    [EQUIPMENT_DRAFT_STORAGE_KEY, JSON.stringify(draftRaw)],
  ]);
  const fallbackLoaded = createEquipmentLibraryRepository(fallbackStorage).loadCachedLibrary();
  assert.equal(
    fallbackLoaded.gearSets['gear-set-persistence'].name,
    'draft 备用',
    `library value ${JSON.stringify(invalidLibraryValue)} must fall back to draft`,
  );
}

const normalizedLoaded = createEquipmentLibraryRepository(draftOnlyStorage).loadCachedLibrary();
const normalizedEquipment = normalizedLoaded.gearSets['gear-set-persistence'].equipments['equipment-persistence'];
assert.equal(normalizedEquipment.part, '配件');
assert.equal(normalizedEquipment.fixedStat?.typeKey, 'defense');
assert.equal(normalizedEquipment.fixedStat?.value, 42);
assert.equal(normalizedEquipment.fixedStat?.unit, 'flat');
assert.equal(normalizedEquipment.effects.effect1?.effectId, 'effect1');
assert.equal(normalizedEquipment.effects.effect1?.category, 'buff');
assert.deepEqual(normalizedEquipment.effects.effect1?.levels, { '0': 12 });

const staleRawCanonicalCache = makeRawLibrary('canonical cache');
const staleRawCanonicalEffect = staleRawCanonicalCache
  .gearSets['gear-set-persistence']
  .equipments['equipment-persistence']
  .effects.effect1;
staleRawCanonicalEffect.typeKey = 'physicalDmgBonus';
staleRawCanonicalEffect.unit = 'percent';
staleRawCanonicalEffect.raw = '伤害：+20%';
staleRawCanonicalEffect.levels = { '0': 2 };
const staleRawCanonicalStorage = storageWith([
  [EQUIPMENT_LIBRARY_STORAGE_KEY, JSON.stringify(staleRawCanonicalCache)],
]);
const staleRawCanonicalLoaded = createEquipmentLibraryRepository(staleRawCanonicalStorage).loadCachedLibrary();
assert.equal(
  staleRawCanonicalLoaded
    .gearSets['gear-set-persistence']
    .equipments['equipment-persistence']
    .effects.effect1?.levels['0'],
  2,
  'cached values are already canonical and must not rerun legacy percent migration',
);

const normalizedEmptyLibrary = normalizeEquipmentLibrary(null);
for (const invalidDraftValue of [null, '', '   ', 'null', '{malformed']) {
  const emptyStorage = new MemoryStorage();
  emptyStorage.values.set(EQUIPMENT_LIBRARY_STORAGE_KEY, 'null');
  if (invalidDraftValue !== null) {
    emptyStorage.values.set(EQUIPMENT_DRAFT_STORAGE_KEY, invalidDraftValue);
  }
  assert.deepEqual(
    createEquipmentLibraryRepository(emptyStorage).loadCachedLibrary(),
    normalizedEmptyLibrary,
    `draft value ${JSON.stringify(invalidDraftValue)} must fall back to a normalized empty library`,
  );
}

const savedLibrary = normalizeEquipmentLibrary(makeRawLibrary('保存库'));
const oldSavedLibrary = normalizeEquipmentLibrary(makeRawLibrary('旧值'));
const newerSavedLibrary = normalizeEquipmentLibrary(makeRawLibrary('新值'));
const saveStorage = new MemoryStorage();
await createEquipmentLibraryRepository(saveStorage).saveLibrary(savedLibrary);
const savedLibraryJson = saveStorage.values.get(EQUIPMENT_LIBRARY_STORAGE_KEY);
const savedDraftJson = saveStorage.values.get(EQUIPMENT_DRAFT_STORAGE_KEY);
assert.equal(savedLibraryJson, savedDraftJson);
assert.deepEqual(JSON.parse(savedLibraryJson ?? ''), JSON.parse(JSON.stringify(savedLibrary)));
assert.deepEqual(saveStorage.setCalls.map(({ key }) => key), [
  EQUIPMENT_LIBRARY_STORAGE_KEY,
  EQUIPMENT_DRAFT_STORAGE_KEY,
]);
assert.equal(saveStorage.flushCalls, 1);

let resolveDeferredFlush: (() => void) | undefined;
const deferredFlush = new Promise<void>((resolve) => {
  resolveDeferredFlush = resolve;
});
const deferredStorage = new MemoryStorage();
deferredStorage.flushImplementation = () => deferredFlush;
let deferredSaveResolved = false;
const deferredSave = createEquipmentLibraryRepository(deferredStorage)
  .saveLibrary(savedLibrary)
  .then(() => {
    deferredSaveResolved = true;
  });
await Promise.resolve();
assert.equal(deferredSaveResolved, false, 'saveLibrary must remain pending until flush resolves');
resolveDeferredFlush?.();
await deferredSave;
assert.equal(deferredSaveResolved, true);

let resolveRevisionFlush: (() => void) | undefined;
const revisionFlush = new Promise<void>((resolve) => {
  resolveRevisionFlush = resolve;
});
const revisionStorage = new MemoryStorage();
revisionStorage.flushImplementation = () => revisionFlush;
const revisionRepository = createEquipmentLibraryRepository(revisionStorage);
let currentLibraryDuringSave = savedLibrary;
const revisionSave = revisionRepository.saveLibraryRevision(
  savedLibrary,
  () => currentLibraryDuringSave,
);
await Promise.resolve();
currentLibraryDuringSave = {
  ...savedLibrary,
  updatedAt: 'edited-during-flush',
};
resolveRevisionFlush?.();
assert.equal(
  await revisionSave,
  'superseded',
  'a durable save must report edits that replaced its snapshot during flush',
);
assert.equal(currentLibraryDuringSave.updatedAt, 'edited-during-flush');

const currentRevisionStorage = new MemoryStorage();
const currentRevisionRepository = createEquipmentLibraryRepository(currentRevisionStorage);
assert.equal(
  await currentRevisionRepository.saveLibraryRevision(savedLibrary, () => savedLibrary),
  'current',
  'an unchanged snapshot may be marked clean after durable flush',
);

const flushFailure = new Error('flush failed');
const rejectedFlushStorage = storageWith([
  [EQUIPMENT_LIBRARY_STORAGE_KEY, JSON.stringify(oldSavedLibrary)],
  [EQUIPMENT_DRAFT_STORAGE_KEY, JSON.stringify(oldSavedLibrary)],
]);
rejectedFlushStorage.flushImplementation = async () => {
  throw flushFailure;
};
const rejectedFlushRepository = createEquipmentLibraryRepository(rejectedFlushStorage);
await assert.rejects(
  rejectedFlushRepository.saveLibrary(newerSavedLibrary),
  (error) => error === flushFailure,
);
assert.equal(rejectedFlushStorage.flushCalls, 1);
assert.equal(
  rejectedFlushStorage.values.get(EQUIPMENT_LIBRARY_STORAGE_KEY),
  JSON.stringify(newerSavedLibrary),
  'flush failure happens after both in-memory values have been replaced',
);
assert.equal(
  rejectedFlushStorage.values.get(EQUIPMENT_DRAFT_STORAGE_KEY),
  JSON.stringify(newerSavedLibrary),
  'flush failure does not restore the draft cache value',
);
assert.equal(
  rejectedFlushRepository.loadCachedLibrary().gearSets['gear-set-persistence'].name,
  '新值',
  'the repository reads the latest in-memory cache after a failed flush',
);

const firstSetFailure = new Error('first set failed');
const firstSetFailureStorage = storageWith([
  [EQUIPMENT_LIBRARY_STORAGE_KEY, JSON.stringify(oldSavedLibrary)],
  [EQUIPMENT_DRAFT_STORAGE_KEY, JSON.stringify(oldSavedLibrary)],
]);
firstSetFailureStorage.setFailureKey = EQUIPMENT_LIBRARY_STORAGE_KEY;
firstSetFailureStorage.setFailure = firstSetFailure;
const firstSetFailureRepository = createEquipmentLibraryRepository(firstSetFailureStorage);
await assert.rejects(
  firstSetFailureRepository.saveLibrary(newerSavedLibrary),
  (error) => error === firstSetFailure,
);
assert.deepEqual(
  firstSetFailureStorage.setCalls,
  [],
  'the first failed setItem must not be recorded as a successful write',
);
assert.equal(firstSetFailureStorage.flushCalls, 0);
assert.equal(
  firstSetFailureStorage.values.get(EQUIPMENT_LIBRARY_STORAGE_KEY),
  JSON.stringify(oldSavedLibrary),
);
assert.equal(
  firstSetFailureStorage.values.get(EQUIPMENT_DRAFT_STORAGE_KEY),
  JSON.stringify(oldSavedLibrary),
);
assert.equal(
  firstSetFailureRepository.loadCachedLibrary().gearSets['gear-set-persistence'].name,
  '旧值',
  'a first-key failure leaves both old cache values readable',
);

const secondSetFailure = new Error('second set failed');
const secondSetFailureStorage = storageWith([
  [EQUIPMENT_LIBRARY_STORAGE_KEY, JSON.stringify(oldSavedLibrary)],
  [EQUIPMENT_DRAFT_STORAGE_KEY, JSON.stringify(oldSavedLibrary)],
]);
secondSetFailureStorage.setFailureKey = EQUIPMENT_DRAFT_STORAGE_KEY;
secondSetFailureStorage.setFailure = secondSetFailure;
const secondSetFailureRepository = createEquipmentLibraryRepository(secondSetFailureStorage);
await assert.rejects(
  secondSetFailureRepository.saveLibrary(newerSavedLibrary),
  (error) => error === secondSetFailure,
);
assert.deepEqual(
  secondSetFailureStorage.setCalls.map(({ key }) => key),
  [EQUIPMENT_LIBRARY_STORAGE_KEY],
  'the library key is written before the draft key is attempted',
);
assert.equal(secondSetFailureStorage.flushCalls, 0);
assert.equal(
  secondSetFailureStorage.values.get(EQUIPMENT_LIBRARY_STORAGE_KEY),
  JSON.stringify(newerSavedLibrary),
  'the first key remains updated when the second setItem fails',
);
assert.equal(
  secondSetFailureStorage.values.get(EQUIPMENT_DRAFT_STORAGE_KEY),
  JSON.stringify(oldSavedLibrary),
  'the second key retains its old value when its setItem fails',
);
assert.equal(
  secondSetFailureRepository.loadCachedLibrary().gearSets['gear-set-persistence'].name,
  '新值',
  'the non-empty library key remains the cache priority after a partial write',
);

for (const failedKey of [EQUIPMENT_LIBRARY_STORAGE_KEY, EQUIPMENT_DRAFT_STORAGE_KEY]) {
  const setFailure = new Error(`set failed: ${failedKey}`);
  const rejectedSetStorage = new MemoryStorage();
  rejectedSetStorage.setFailureKey = failedKey;
  rejectedSetStorage.setFailure = setFailure;
  await assert.rejects(
    createEquipmentLibraryRepository(rejectedSetStorage).saveLibrary(savedLibrary),
    (error) => error === setFailure,
  );
  assert.equal(rejectedSetStorage.flushCalls, 0, 'flush must not run after a setItem failure');
}

const libraryReadFailureStorage = storageWith([
  [EQUIPMENT_DRAFT_STORAGE_KEY, JSON.stringify(oldSavedLibrary)],
]);
libraryReadFailureStorage.getFailureKey = EQUIPMENT_LIBRARY_STORAGE_KEY;
libraryReadFailureStorage.getFailure = new Error('library read failed');
assert.equal(
  createEquipmentLibraryRepository(libraryReadFailureStorage)
    .loadCachedLibrary()
    .gearSets['gear-set-persistence'].name,
  '旧值',
  'a library read failure falls back to the draft cache',
);

const draftReadFailureStorage = storageWith([
  [EQUIPMENT_LIBRARY_STORAGE_KEY, JSON.stringify(normalizeEquipmentLibrary(null))],
]);
draftReadFailureStorage.getFailureKey = EQUIPMENT_DRAFT_STORAGE_KEY;
draftReadFailureStorage.getFailure = new Error('draft read failed');
assert.deepEqual(
  createEquipmentLibraryRepository(draftReadFailureStorage).loadCachedLibrary(),
  normalizedEmptyLibrary,
  'a draft read failure returns a normalized empty library after an empty primary cache',
);

const liveCacheStorage = storageWith([
  [EQUIPMENT_LIBRARY_STORAGE_KEY, JSON.stringify(oldSavedLibrary)],
]);
const liveCacheRepository = createEquipmentLibraryRepository(liveCacheStorage);
assert.equal(
  liveCacheRepository.loadCachedLibrary().gearSets['gear-set-persistence'].name,
  '旧值',
);
liveCacheStorage.values.set(EQUIPMENT_LIBRARY_STORAGE_KEY, JSON.stringify(newerSavedLibrary));
assert.equal(
  liveCacheRepository.loadCachedLibrary().gearSets['gear-set-persistence'].name,
  '新值',
  'loadCachedLibrary must not retain a stale repository-local snapshot',
);

const supersededByEqualCloneRepository = createEquipmentLibraryRepository(new MemoryStorage());
assert.equal(
  await supersededByEqualCloneRepository.saveLibraryRevision(
    savedLibrary,
    () => structuredClone(savedLibrary),
  ),
  'superseded',
  'revision status uses snapshot identity, not deep equality',
);

let failedRevisionCurrentLookupCalls = 0;
const failedRevisionStorage = storageWith([
  [EQUIPMENT_LIBRARY_STORAGE_KEY, JSON.stringify(oldSavedLibrary)],
  [EQUIPMENT_DRAFT_STORAGE_KEY, JSON.stringify(oldSavedLibrary)],
]);
failedRevisionStorage.flushImplementation = async () => {
  throw new Error('revision flush failed');
};
await assert.rejects(
  createEquipmentLibraryRepository(failedRevisionStorage).saveLibraryRevision(
    newerSavedLibrary,
    () => {
      failedRevisionCurrentLookupCalls += 1;
      return newerSavedLibrary;
    },
  ),
  /revision flush failed/,
);
assert.equal(
  failedRevisionCurrentLookupCalls,
  0,
  'current/superseded lookup must not run when durable flush fails',
);

console.log('Equipment cached library repository and durable flush contract: PASS');
