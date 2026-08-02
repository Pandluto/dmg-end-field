import {
  normalizeEquipmentLibrary,
  type EquipmentLibrary,
} from './equipmentSheetModel';

export const EQUIPMENT_DRAFT_STORAGE_KEY = 'def.equipment-sheet.draft.v1';
export const EQUIPMENT_LIBRARY_STORAGE_KEY = 'def.equipment-sheet.library.v1';

export interface EquipmentLibraryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  flush(): Promise<void>;
}

function loadNormalizedLibrary(storage: EquipmentLibraryStorage, key: string): EquipmentLibrary {
  try {
    const serialized = storage.getItem(key);
    if (!serialized?.trim()) {
      return normalizeEquipmentLibrary(null);
    }
    return normalizeEquipmentLibrary(JSON.parse(serialized) as unknown);
  } catch {
    return normalizeEquipmentLibrary(null);
  }
}

export function createEquipmentLibraryRepository(storage: EquipmentLibraryStorage) {
  const loadCachedLibrary = (): EquipmentLibrary => {
    const library = loadNormalizedLibrary(storage, EQUIPMENT_LIBRARY_STORAGE_KEY);
    if (Object.keys(library.gearSets).length > 0) {
      return library;
    }
    return loadNormalizedLibrary(storage, EQUIPMENT_DRAFT_STORAGE_KEY);
  };

  const saveLibrary = async (library: EquipmentLibrary): Promise<void> => {
    const serialized = JSON.stringify(library);
    storage.setItem(EQUIPMENT_LIBRARY_STORAGE_KEY, serialized);
    storage.setItem(EQUIPMENT_DRAFT_STORAGE_KEY, serialized);
    await storage.flush();
  };

  return {
    loadCachedLibrary,
    saveLibrary,
  };
}

export type EquipmentLibraryRepository = ReturnType<typeof createEquipmentLibraryRepository>;
