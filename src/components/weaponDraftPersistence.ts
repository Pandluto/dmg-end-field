import {
  createEmptyWeaponDraft,
  normalizeWeaponDraft,
  type RawWeaponDraft,
  type WeaponDraft,
} from './weaponDraftModel';

export const WEAPON_DRAFT_STORAGE_KEY = 'def.weapon-sheet.draft.v1';
export const WEAPON_LIBRARY_STORAGE_KEY = 'def.weapon-sheet.library.v1';

export interface WeaponDraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function createWeaponDraftRepository(storage: WeaponDraftStorage) {
  const loadDraft = (): WeaponDraft => {
    const serialized = storage.getItem(WEAPON_DRAFT_STORAGE_KEY);
    if (!serialized) {
      return createEmptyWeaponDraft();
    }
    try {
      const parsed = JSON.parse(serialized) as RawWeaponDraft | null;
      return parsed ? normalizeWeaponDraft(parsed) : createEmptyWeaponDraft();
    } catch {
      return createEmptyWeaponDraft();
    }
  };

  const loadLibrary = (): Record<string, WeaponDraft> => {
    const serialized = storage.getItem(WEAPON_LIBRARY_STORAGE_KEY);
    if (!serialized) {
      return {};
    }
    try {
      const parsed = JSON.parse(serialized) as Record<string, RawWeaponDraft>;
      return Object.fromEntries(
        Object.entries(parsed).map(([draftId, draftValue]) => [
          draftId,
          normalizeWeaponDraft({ ...draftValue, id: draftId }),
        ]),
      );
    } catch {
      return {};
    }
  };

  const saveDraft = (draft: WeaponDraft): void => {
    storage.setItem(WEAPON_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  };

  const saveLibrary = (library: Record<string, WeaponDraft>): void => {
    storage.setItem(WEAPON_LIBRARY_STORAGE_KEY, JSON.stringify(library));
  };

  return {
    loadDraft,
    loadLibrary,
    saveDraft,
    saveLibrary,
  };
}

export type WeaponDraftRepository = ReturnType<typeof createWeaponDraftRepository>;
