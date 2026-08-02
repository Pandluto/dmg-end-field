import {
  buildDraftLibraryShareFile,
  parseDraftLibraryShareFile,
  type DraftLibraryShareFile,
} from '../utils/draftShare';
import {
  normalizeEnglishId,
  normalizeEquipmentLibrary,
  type EquipmentGearSet,
  type EquipmentLibrary,
} from './equipmentSheetModel';

export const EQUIPMENT_LIBRARY_SHARE_TYPE = 'equipment-library-share.v1';
export const EQUIPMENT_SHARE_INVALID_FILE_ERROR = '导入失败：文件不是有效的装备库分享 JSON。';
export const EQUIPMENT_SHARE_EMPTY_PAYLOAD_ERROR = 'JSON 中没有可导入的有效套装。';

export type EquipmentLibraryShareFile = DraftLibraryShareFile<EquipmentGearSet>;
export type EquipmentShareExportScope = 'current' | 'all';

export type EquipmentShareParseResult =
  | { ok: true; shareFile: EquipmentLibraryShareFile }
  | { ok: false; error: string };

export function buildEquipmentLibraryShareFile(params: {
  library: EquipmentLibrary;
  scope: EquipmentShareExportScope;
  selectedGearSetId?: string | null;
}): EquipmentLibraryShareFile {
  const selectedGearSet = params.selectedGearSetId
    ? params.library.gearSets[params.selectedGearSetId]
    : undefined;
  if (params.scope === 'current' && params.selectedGearSetId && selectedGearSet) {
    return buildDraftLibraryShareFile(
      EQUIPMENT_LIBRARY_SHARE_TYPE,
      { [params.selectedGearSetId]: selectedGearSet },
      selectedGearSet.name,
    );
  }

  return buildDraftLibraryShareFile(
    EQUIPMENT_LIBRARY_SHARE_TYPE,
    { ...params.library.gearSets },
    'equipment-library',
  );
}

function isEquipmentShareEntry(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseEquipmentLibraryShare(rawText: string): EquipmentShareParseResult {
  const parsedShare = parseDraftLibraryShareFile(rawText, EQUIPMENT_LIBRARY_SHARE_TYPE);
  if (!parsedShare) {
    return { ok: false, error: EQUIPMENT_SHARE_INVALID_FILE_ERROR };
  }

  const normalizedPayload: Record<string, EquipmentGearSet> = {};
  const usedGearSetIds = new Set<string>();
  Object.entries(parsedShare.payload).forEach(([outerGearSetId, value]) => {
    if (!isEquipmentShareEntry(value)) {
      return;
    }

    try {
      const canonicalGearSetId = normalizeEnglishId(
        'gear-set',
        outerGearSetId,
        outerGearSetId,
        new Set(usedGearSetIds),
      );
      const normalizedGearSet = normalizeEquipmentLibrary({
        gearSets: {
          [canonicalGearSetId]: {
            ...value,
            gearSetId: canonicalGearSetId,
          },
        },
      }).gearSets[canonicalGearSetId];
      if (!normalizedGearSet) {
        return;
      }

      usedGearSetIds.add(canonicalGearSetId);
      normalizedPayload[canonicalGearSetId] = {
        ...normalizedGearSet,
        gearSetId: canonicalGearSetId,
      };
    } catch {
      // A malformed entry must not prevent other payload entries from importing.
    }
  });

  if (Object.keys(normalizedPayload).length === 0) {
    return { ok: false, error: EQUIPMENT_SHARE_EMPTY_PAYLOAD_ERROR };
  }

  return {
    ok: true,
    shareFile: {
      ...parsedShare,
      payload: normalizedPayload,
    },
  };
}

export function mergeEquipmentLibraryShare(
  currentLibrary: EquipmentLibrary,
  shareFile: EquipmentLibraryShareFile,
): EquipmentLibrary {
  return {
    ...currentLibrary,
    gearSets: {
      ...currentLibrary.gearSets,
      ...shareFile.payload,
    },
  };
}

export function resolveEquipmentShareSelection(
  importedPayload: Record<string, EquipmentGearSet>,
  selectedGearSetId: string,
  currentLibrary: EquipmentLibrary,
): string {
  const importedGearSetId = Object.keys(importedPayload)[0];
  if (importedGearSetId !== undefined) {
    return importedGearSetId;
  }
  if (selectedGearSetId && currentLibrary.gearSets[selectedGearSetId]) {
    return selectedGearSetId;
  }
  return Object.keys(currentLibrary.gearSets)[0] ?? '';
}
