import {
  buildDraftLibraryShareFile,
  parseDraftLibraryShareFile,
  type DraftLibraryShareFile,
} from '../utils/draftShare';
import {
  normalizeWeaponDraft,
  type RawWeaponDraft,
  type WeaponDraft,
} from './weaponDraftModel';

export const WEAPON_LIBRARY_SHARE_TYPE = 'weapon-library-share.v1';
export const WEAPON_SHARE_INVALID_FILE_ERROR = '导入失败：文件不是有效的武器库分享 JSON。';
export const WEAPON_SHARE_EMPTY_PAYLOAD_ERROR = 'JSON 中没有可导入的有效武器。';

export type WeaponDraftLibraryShareFile = DraftLibraryShareFile<WeaponDraft>;
export type WeaponDraftExportScope = 'current' | 'all';

export type WeaponDraftShareParseResult =
  | { ok: true; shareFile: WeaponDraftLibraryShareFile }
  | { ok: false; error: string };

export function buildWeaponDraftLibraryShareFile(params: {
  draft: WeaponDraft;
  library: Record<string, WeaponDraft>;
  scope: WeaponDraftExportScope;
  libraryLabel?: string;
}): WeaponDraftLibraryShareFile {
  if (params.scope === 'current') {
    return buildDraftLibraryShareFile(
      WEAPON_LIBRARY_SHARE_TYPE,
      params.draft.id ? { [params.draft.id]: params.draft } : {},
      params.draft.name || 'weapon',
    );
  }

  const payload = { ...params.library };
  if (params.draft.id) {
    payload[params.draft.id] = params.draft;
  }
  return buildDraftLibraryShareFile(
    WEAPON_LIBRARY_SHARE_TYPE,
    payload,
    params.libraryLabel || params.draft.name || 'weapon-library',
  );
}

export function parseWeaponDraftLibraryShare(rawText: string): WeaponDraftShareParseResult {
  const parsedShare = parseDraftLibraryShareFile(rawText, WEAPON_LIBRARY_SHARE_TYPE);
  if (!parsedShare) {
    return { ok: false, error: WEAPON_SHARE_INVALID_FILE_ERROR };
  }

  const normalizedPayload = Object.fromEntries(
    Object.entries(parsedShare.payload).map(([draftId, draftValue]) => [
      draftId,
      normalizeWeaponDraft({ ...(draftValue as RawWeaponDraft), id: draftId }),
    ]),
  ) as Record<string, WeaponDraft>;

  if (Object.keys(normalizedPayload).length === 0) {
    return { ok: false, error: WEAPON_SHARE_EMPTY_PAYLOAD_ERROR };
  }

  return {
    ok: true,
    shareFile: {
      ...parsedShare,
      payload: normalizedPayload,
    },
  };
}

export function mergeWeaponDraftLibraryShare(
  currentLibrary: Record<string, WeaponDraft>,
  shareFile: WeaponDraftLibraryShareFile,
): Record<string, WeaponDraft> {
  return {
    ...currentLibrary,
    ...shareFile.payload,
  };
}

export function resolveWeaponDraftShareSelection(
  importedPayload: Record<string, WeaponDraft>,
  selectedDraftId: string,
  fallbackDraftId: string,
): string {
  return Object.keys(importedPayload)[0] ?? (selectedDraftId || fallbackDraftId);
}
