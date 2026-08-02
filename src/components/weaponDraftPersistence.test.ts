import assert from 'node:assert/strict';
import { createEmptyWeaponDraft, type WeaponDraft } from './weaponDraftModel';
import {
  WEAPON_DRAFT_STORAGE_KEY,
  WEAPON_LIBRARY_STORAGE_KEY,
  createWeaponDraftRepository,
  type WeaponDraftStorage,
} from './weaponDraftPersistence';

class MemoryStorage implements WeaponDraftStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

assert.equal(WEAPON_DRAFT_STORAGE_KEY, 'def.weapon-sheet.draft.v1');
assert.equal(WEAPON_LIBRARY_STORAGE_KEY, 'def.weapon-sheet.library.v1');

const storage = new MemoryStorage();
const repository = createWeaponDraftRepository(storage);
assert.deepEqual(repository.loadDraft(), createEmptyWeaponDraft());
assert.deepEqual(repository.loadLibrary(), {});

storage.setItem(WEAPON_DRAFT_STORAGE_KEY, '{broken');
storage.setItem(WEAPON_LIBRARY_STORAGE_KEY, '{broken');
assert.deepEqual(repository.loadDraft(), createEmptyWeaponDraft());
assert.deepEqual(repository.loadLibrary(), {});

storage.setItem(WEAPON_DRAFT_STORAGE_KEY, 'null');
storage.setItem(WEAPON_LIBRARY_STORAGE_KEY, 'null');
assert.deepEqual(repository.loadDraft(), createEmptyWeaponDraft());
assert.deepEqual(repository.loadLibrary(), {});

storage.setItem(WEAPON_DRAFT_STORAGE_KEY, JSON.stringify({
  id: ' legacy-weapon ',
  name: ' 旧武器 ',
  type: ' 单手剑 ',
  skills: {
    skill3: {
      effectTypes: { legacyEffect: 'physicalDmgBonus' },
      levels: {
        1: { passive: { legacyEffect: 10 } },
        9: { passive: { legacyEffect: 90 } },
      },
    },
  },
}));
const loadedDraft = repository.loadDraft();
assert.equal(loadedDraft.id, 'legacy-weapon');
assert.equal(loadedDraft.name, '旧武器');
assert.equal(loadedDraft.type, '单手剑');
assert.deepEqual(loadedDraft.skills.skill3.effects.legacyEffect.levels, { 1: 10, 9: 90 });

storage.setItem(WEAPON_LIBRARY_STORAGE_KEY, JSON.stringify({
  outerKey: {
    ...loadedDraft,
    id: 'inner-id',
    name: ' 库武器 ',
  },
}));
const loadedLibrary = repository.loadLibrary();
assert.deepEqual(Object.keys(loadedLibrary), ['outerKey']);
assert.equal(loadedLibrary.outerKey.id, 'outerKey', 'library key remains the canonical weapon id');
assert.equal(loadedLibrary.outerKey.name, '库武器');

const savedDraft: WeaponDraft = {
  ...createEmptyWeaponDraft('saved-weapon'),
  name: '保存武器',
};
repository.saveDraft(savedDraft);
repository.saveLibrary({ 'saved-weapon': savedDraft });
const serializedDraft = JSON.parse(JSON.stringify(savedDraft));
assert.deepEqual(JSON.parse(storage.getItem(WEAPON_DRAFT_STORAGE_KEY) ?? ''), serializedDraft);
assert.deepEqual(JSON.parse(storage.getItem(WEAPON_LIBRARY_STORAGE_KEY) ?? ''), {
  'saved-weapon': serializedDraft,
});

console.log('Weapon SQLite draft repository contract: PASS');
