import { cloneValue, type BuffDraft } from './buffDraftModel';

export const BUFF_DRAFT_STORAGE_KEY = 'def.buff-editor.draft.v1';
export const BUFF_LIBRARY_STORAGE_KEY = 'def.buff-editor.library.v1';
export const BUFF_UNDO_STORAGE_KEY = 'def.buff-editor.undo.v1';
export const BUFF_UNDO_LIMIT = 8;

export interface BuffUndoStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface BuffUndoSnapshot {
  id: string;
  createdAt: number;
  label: string;
  selectedDraftId?: string;
  draftState?: BuffDraft;
  selectedItemKey?: string | null;
  selectedEffectKey?: string | null;
  localEntries: Array<[string, string | null]>;
}

export interface BuffUndoCaptureOptions {
  selectedDraftId?: string;
  draftState?: BuffDraft;
  selectedItemKey?: string | null;
  selectedEffectKey?: string | null;
}

interface BuffUndoRepositoryOptions {
  limit?: number;
  now?: () => number;
  random?: () => number;
}

export function formatBuffUndoLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  const milliseconds = String(date.getMilliseconds()).padStart(3, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${milliseconds}`;
}

export function createBuffUndoRepository(
  storage: BuffUndoStorage,
  options: BuffUndoRepositoryOptions = {},
) {
  const limit = options.limit ?? BUFF_UNDO_LIMIT;
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;

  const readSnapshots = (): BuffUndoSnapshot[] => {
    try {
      const raw = storage.getItem(BUFF_UNDO_STORAGE_KEY);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw) as BuffUndoSnapshot[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const writeSnapshots = (snapshots: BuffUndoSnapshot[]): void => {
    storage.setItem(BUFF_UNDO_STORAGE_KEY, JSON.stringify(snapshots));
  };

  const captureSnapshot = (label: string, captureOptions?: BuffUndoCaptureOptions): void => {
    const localEntries: Array<[string, string | null]> = [
      [BUFF_DRAFT_STORAGE_KEY, storage.getItem(BUFF_DRAFT_STORAGE_KEY)],
      [BUFF_LIBRARY_STORAGE_KEY, storage.getItem(BUFF_LIBRARY_STORAGE_KEY)],
    ];

    const snapshot: BuffUndoSnapshot = {
      id: `${now()}-${random().toString(36).slice(2, 8)}`,
      createdAt: now(),
      label,
      selectedDraftId: captureOptions?.selectedDraftId,
      draftState: captureOptions?.draftState ? cloneValue(captureOptions.draftState) : undefined,
      selectedItemKey: captureOptions?.selectedItemKey,
      selectedEffectKey: captureOptions?.selectedEffectKey,
      localEntries,
    };

    writeSnapshots([snapshot, ...readSnapshots()].slice(0, limit));
  };

  const restoreSnapshot = (snapshotId: string): BuffUndoSnapshot | null => {
    const snapshots = readSnapshots();
    const target = snapshots.find((item) => item.id === snapshotId);
    if (!target) {
      return null;
    }

    target.localEntries.forEach(([key, value]) => {
      if (value == null) {
        storage.removeItem(key);
        return;
      }
      storage.setItem(key, value);
    });

    writeSnapshots(snapshots.filter((item) => item.id !== snapshotId));
    return target;
  };

  return {
    readSnapshots,
    writeSnapshots,
    captureSnapshot,
    restoreSnapshot,
  };
}

export type BuffUndoRepository = ReturnType<typeof createBuffUndoRepository>;
