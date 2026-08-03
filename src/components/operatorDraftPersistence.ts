import {
  createDefaultDraft,
  parseImportedDraft,
  type OperatorDraft,
} from './operatorDraftPageModel';

export const OPERATOR_DRAFT_STORAGE_KEY = 'def.operator-editor.draft.v1';
export const OPERATOR_LIBRARY_STORAGE_KEY = 'def.operator-editor.library.v1';

export interface OperatorDraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  flush(): Promise<void>;
}

export type OperatorDraftLibrary = Record<string, OperatorDraft>;
export type OperatorDraftSaveRevision = 'current' | 'superseded';

export interface OperatorDraftDeleteResult {
  deleted: boolean;
  library: OperatorDraftLibrary;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseDraftValue(value: unknown): OperatorDraft | null {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== 'string') {
    return null;
  }
  try {
    return parseImportedDraft(serialized);
  } catch {
    return null;
  }
}

function readLibrary(storage: OperatorDraftStorage): OperatorDraftLibrary {
  const raw = storage.getItem(OPERATOR_LIBRARY_STORAGE_KEY);
  if (!raw?.trim()) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).flatMap(([draftId, value]) => {
        const draft = parseDraftValue(value);
        return draft ? [[draftId, draft] as const] : [];
      }),
    );
  } catch {
    return {};
  }
}

async function writeDurablyWithRollback(
  storage: OperatorDraftStorage,
  updates: Array<readonly [key: string, value: string]>,
): Promise<void> {
  const previousValues = updates.map(([key]) => [key, storage.getItem(key)] as const);
  try {
    updates.forEach(([key, value]) => storage.setItem(key, value));
    await storage.flush();
  } catch (error) {
    previousValues.forEach(([key, value]) => {
      try {
        if (value === null) {
          storage.removeItem(key);
        } else {
          storage.setItem(key, value);
        }
      } catch {
        // Preserve the original write error; best-effort rollback cannot replace it.
      }
    });
    throw error;
  }
}

export function createOperatorDraftRepository(storage: OperatorDraftStorage) {
  const loadDraft = (): OperatorDraft => {
    const raw = storage.getItem(OPERATOR_DRAFT_STORAGE_KEY);
    if (!raw?.trim()) {
      return createDefaultDraft();
    }

    try {
      return parseImportedDraft(raw);
    } catch {
      return createDefaultDraft();
    }
  };

  const loadLibrary = (): OperatorDraftLibrary => readLibrary(storage);

  const saveDraft = async (draft: OperatorDraft): Promise<void> => {
    const library = loadLibrary();
    const serializedDraft = JSON.stringify(draft);
    const nextLibrary = {
      ...library,
      [draft.id]: draft,
    };

    await writeDurablyWithRollback(storage, [
      [OPERATOR_DRAFT_STORAGE_KEY, serializedDraft],
      [OPERATOR_LIBRARY_STORAGE_KEY, JSON.stringify(nextLibrary)],
    ]);
  };

  const saveDraftRevision = async (
    draft: OperatorDraft,
    getCurrentDraft: () => OperatorDraft,
  ): Promise<OperatorDraftSaveRevision> => {
    await saveDraft(draft);
    return getCurrentDraft() === draft ? 'current' : 'superseded';
  };

  const mergeLibrary = async (drafts: OperatorDraftLibrary): Promise<OperatorDraftLibrary> => {
    const library = loadLibrary();
    const canonicalDrafts = Object.fromEntries(
      Object.entries(drafts).flatMap(([draftId, draft]) => {
        const canonicalDraft = parseDraftValue(draft);
        return canonicalDraft ? [[draftId, canonicalDraft] as const] : [];
      }),
    );
    const nextLibrary = {
      ...library,
      ...canonicalDrafts,
    };

    await writeDurablyWithRollback(storage, [
      [OPERATOR_LIBRARY_STORAGE_KEY, JSON.stringify(nextLibrary)],
    ]);
    return nextLibrary;
  };

  const deleteFromLibrary = async (draftId: string): Promise<OperatorDraftDeleteResult> => {
    const library = loadLibrary();
    if (!Object.prototype.hasOwnProperty.call(library, draftId)) {
      return {
        deleted: false,
        library,
      };
    }

    const nextLibrary = { ...library };
    delete nextLibrary[draftId];
    await writeDurablyWithRollback(storage, [
      [OPERATOR_LIBRARY_STORAGE_KEY, JSON.stringify(nextLibrary)],
    ]);
    return {
      deleted: true,
      library: nextLibrary,
    };
  };

  return {
    loadDraft,
    loadLibrary,
    saveDraft,
    saveDraftRevision,
    mergeLibrary,
    deleteFromLibrary,
  };
}

export type OperatorDraftRepository = ReturnType<typeof createOperatorDraftRepository>;
