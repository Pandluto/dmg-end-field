import {
  createDefaultBuffDraft,
  normalizeBuffDraft,
  parseImportedBuffDraft,
  type BuffDraft,
  type BuffEffectDraft,
} from './buffDraftModel';

export const BUFF_DRAFT_STORAGE_KEY = 'def.buff-editor.draft.v1';
export const BUFF_LIBRARY_STORAGE_KEY = 'def.buff-editor.library.v1';

export interface BuffDraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function createBuffDraftRepository(storage: BuffDraftStorage) {
  const loadDraft = (): BuffDraft => {
    const raw = storage.getItem(BUFF_DRAFT_STORAGE_KEY);
    if (!raw) {
      return createDefaultBuffDraft();
    }
    try {
      return parseImportedBuffDraft(raw);
    } catch {
      return createDefaultBuffDraft();
    }
  };

  const loadLibrary = (): Record<string, BuffDraft> => {
    const raw = storage.getItem(BUFF_LIBRARY_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    try {
      const parsed = JSON.parse(raw) as Record<string, Partial<BuffDraft> & {
        buffs?: Record<string, Partial<BuffEffectDraft>>;
      }>;
      return Object.fromEntries(
        Object.entries(parsed).map(([draftId, draftValue]) => [draftId, normalizeBuffDraft(draftValue)]),
      );
    } catch {
      return {};
    }
  };

  const saveDraft = (draft: BuffDraft): void => {
    storage.setItem(BUFF_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  };

  const saveLibrary = (library: Record<string, BuffDraft>): void => {
    storage.setItem(BUFF_LIBRARY_STORAGE_KEY, JSON.stringify(library));
  };

  return {
    loadDraft,
    loadLibrary,
    saveDraft,
    saveLibrary,
  };
}

export type BuffDraftRepository = ReturnType<typeof createBuffDraftRepository>;
