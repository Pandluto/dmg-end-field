import {
  buildDraftLibraryShareFile,
  parseDraftLibraryShareFile,
  type DraftLibraryShareFile,
} from '../utils/draftShare';
import {
  normalizeBuffDraftLibrary,
  parseImportedBuffDraft,
  type BuffDraft,
} from './buffDraftModel';

export const BUFF_LIBRARY_SHARE_TYPE = 'buff-library-share.v1';
export const BUFF_SHARE_INVALID_FILE_ERROR = 'JSON 无效，或不是 Buff 分享文件。';
export const BUFF_SHARE_EMPTY_PAYLOAD_ERROR = 'JSON 中没有可导入的有效 Buff 分组。';

export type BuffDraftLibraryShareFile = DraftLibraryShareFile<BuffDraft>;

export type BuffDraftShareParseResult =
  | { ok: true; shareFile: BuffDraftLibraryShareFile }
  | { ok: false; error: string };

export function buildBuffDraftLibraryShareFile(
  library: Record<string, BuffDraft>,
  label: string,
): BuffDraftLibraryShareFile {
  return buildDraftLibraryShareFile(BUFF_LIBRARY_SHARE_TYPE, library, label);
}

export function parseBuffDraftLibraryShare(rawText: string): BuffDraftShareParseResult {
  const parsedShare = parseDraftLibraryShareFile(rawText, BUFF_LIBRARY_SHARE_TYPE);
  if (!parsedShare) {
    return { ok: false, error: BUFF_SHARE_INVALID_FILE_ERROR };
  }

  const normalizedPayload = Object.fromEntries(
    Object.entries(parsedShare.payload).flatMap(([draftId, value]) => {
      try {
        const normalizedDraft = parseImportedBuffDraft(JSON.stringify(value));
        return [[draftId, normalizedDraft] as const];
      } catch {
        return [];
      }
    }),
  ) as Record<string, BuffDraft>;

  if (Object.keys(normalizedPayload).length === 0) {
    return { ok: false, error: BUFF_SHARE_EMPTY_PAYLOAD_ERROR };
  }

  return {
    ok: true,
    shareFile: {
      ...parsedShare,
      payload: normalizedPayload,
    },
  };
}

export function mergeBuffDraftLibraryShare(
  currentLibrary: Record<string, BuffDraft>,
  shareFile: BuffDraftLibraryShareFile,
): Record<string, BuffDraft> {
  return normalizeBuffDraftLibrary({
    ...currentLibrary,
    ...shareFile.payload,
  });
}

export function resolveBuffDraftShareSelection(
  selectedDraftId: string,
  nextLibrary: Record<string, BuffDraft>,
  importedPayload: Record<string, BuffDraft>,
): string {
  if (selectedDraftId && nextLibrary[selectedDraftId]) {
    return selectedDraftId;
  }
  return Object.keys(importedPayload)[0] ?? Object.keys(nextLibrary)[0] ?? '';
}
