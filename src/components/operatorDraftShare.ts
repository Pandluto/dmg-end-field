import {
  buildDraftLibraryShareFile,
  parseDraftLibraryShareFile,
  type DraftLibraryShareFile,
} from '../utils/draftShare';
import {
  buildOperatorIdFromName,
  getNextDraftId,
  parseImportedDraft,
  type OperatorDraft,
} from './operatorDraftPageModel';

export const OPERATOR_LIBRARY_SHARE_TYPE = 'operator-library-share.v1';
export const OPERATOR_SHARE_INVALID_FILE_ERROR = '导入失败：文件不是有效的干员库分享 JSON。';
export const OPERATOR_SHARE_EMPTY_PAYLOAD_ERROR = 'JSON 中没有可导入的有效干员。';

export type OperatorDraftLibraryShareFile = DraftLibraryShareFile<OperatorDraft>;
export type OperatorDraftExportScope = 'current' | 'all';

export type OperatorDraftShareParseResult =
  | { ok: true; shareFile: OperatorDraftLibraryShareFile }
  | { ok: false; error: string };

type ExistingOperatorIds = readonly string[] | ReadonlySet<string>;

const CANONICAL_OPERATOR_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function toExistingIdSet(existingIds: ExistingOperatorIds): Set<string> {
  return new Set(existingIds);
}

function makeUniqueOperatorId(candidate: string, existingIds: Set<string>): string {
  if (!existingIds.has(candidate)) {
    return candidate;
  }

  let suffix = 2;
  let uniqueCandidate = `${candidate}-${suffix}`;
  while (existingIds.has(uniqueCandidate)) {
    suffix += 1;
    uniqueCandidate = `${candidate}-${suffix}`;
  }
  return uniqueCandidate;
}

export function normalizeOperatorDraftShareId(
  outerKey: string,
  fallbackName: string,
  existingIds: ExistingOperatorIds,
): string {
  const usedIds = toExistingIdSet(existingIds);
  const trimmedOuterKey = outerKey.trim();
  let candidate = CANONICAL_OPERATOR_ID_PATTERN.test(trimmedOuterKey)
    ? trimmedOuterKey
    : buildOperatorIdFromName(trimmedOuterKey);

  if (!CANONICAL_OPERATOR_ID_PATTERN.test(candidate)) {
    candidate = buildOperatorIdFromName(fallbackName);
  }

  if (!CANONICAL_OPERATOR_ID_PATTERN.test(candidate)) {
    candidate = getNextDraftId([...usedIds]);
  }

  return makeUniqueOperatorId(candidate, usedIds);
}

export function buildOperatorDraftLibraryShareFile(params: {
  draft: OperatorDraft;
  library: Record<string, OperatorDraft>;
  scope: OperatorDraftExportScope;
  libraryLabel?: string;
}): OperatorDraftLibraryShareFile {
  const draftId = params.draft.id;
  if (params.scope === 'current') {
    return buildDraftLibraryShareFile(
      OPERATOR_LIBRARY_SHARE_TYPE,
      draftId ? { [draftId]: params.draft } : {},
      params.draft.name || 'operator',
    );
  }

  const payload = { ...params.library };
  if (draftId) {
    payload[draftId] = params.draft;
  }
  return buildDraftLibraryShareFile(
    OPERATOR_LIBRARY_SHARE_TYPE,
    payload,
    params.libraryLabel?.trim() || params.draft.name || 'operator-library',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseOperatorDraftLibraryShare(rawText: string): OperatorDraftShareParseResult {
  const parsedShare = parseDraftLibraryShareFile(rawText, OPERATOR_LIBRARY_SHARE_TYPE);
  if (!parsedShare) {
    return { ok: false, error: OPERATOR_SHARE_INVALID_FILE_ERROR };
  }

  const normalizedPayload: Record<string, OperatorDraft> = {};
  const usedIds = new Set<string>();
  Object.entries(parsedShare.payload).forEach(([outerKey, value]) => {
    if (!isRecord(value)) {
      return;
    }

    try {
      const fallbackName = typeof value.name === 'string' ? value.name : '';
      const canonicalId = normalizeOperatorDraftShareId(outerKey, fallbackName, usedIds);
      const normalizedDraft = parseImportedDraft(JSON.stringify({
        ...value,
        id: canonicalId,
      }));
      normalizedPayload[canonicalId] = {
        ...normalizedDraft,
        id: canonicalId,
      };
      usedIds.add(canonicalId);
    } catch {
      // One malformed entry must not prevent other entries from importing.
    }
  });

  if (Object.keys(normalizedPayload).length === 0) {
    return { ok: false, error: OPERATOR_SHARE_EMPTY_PAYLOAD_ERROR };
  }

  return {
    ok: true,
    shareFile: {
      ...parsedShare,
      payload: normalizedPayload,
    },
  };
}

export function mergeOperatorDraftLibraryShare(
  currentLibrary: Record<string, OperatorDraft>,
  shareFile: OperatorDraftLibraryShareFile,
): {
  nextLibrary: Record<string, OperatorDraft>;
  importedIds: string[];
} {
  const importedIds = Object.keys(shareFile.payload);
  return {
    nextLibrary: {
      ...currentLibrary,
      ...shareFile.payload,
    },
    importedIds,
  };
}

export function resolveOperatorDraftShareSelection(importedIds: string[]): string {
  return importedIds[0] ?? '';
}
