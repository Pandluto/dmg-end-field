import { AI_CLI_PROTOCOL_VERSION } from './aiCliAgentTypes';
import type { AgentFillDomainAdapter, AgentFillProposalPayload, AgentFillValidationResult } from './aiCliFillDomains';
import { createLegacyFillProposalPayload } from '../legacyFillCore';
import {
  SUPPORTED_EQUIPMENT_EFFECT_TYPES,
  createEquipmentFillDraftSchema,
  emptyEquipmentLibrary,
  equipmentFillDomainCore,
  formatEquipmentLibrarySummary,
  mergeEquipmentLibraryPatch,
  parseEquipmentFillJsonPayload,
  type EquipmentLibrary,
} from '../legacyFillCore/domains/equipment';

export const EQUIPMENT_DRAFT_STORAGE_KEY = 'def.equipment-sheet.draft.v1';
export const EQUIPMENT_LIBRARY_STORAGE_KEY = 'def.equipment-sheet.library.v1';

function readJsonStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonStorage(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function readCurrentEquipmentLibrary(): EquipmentLibrary {
  return readJsonStorage<EquipmentLibrary>(EQUIPMENT_DRAFT_STORAGE_KEY, emptyEquipmentLibrary());
}

export function readEquipmentLibrary(): EquipmentLibrary {
  return readJsonStorage<EquipmentLibrary>(EQUIPMENT_LIBRARY_STORAGE_KEY, emptyEquipmentLibrary());
}

function readEquipmentMergeBaseline(): EquipmentLibrary {
  return mergeEquipmentLibraryPatch(readEquipmentLibrary(), readCurrentEquipmentLibrary());
}

export { equipmentFillDomainCore, formatEquipmentLibrarySummary, type EquipmentLibrary };

export const equipmentFillAdapter: AgentFillDomainAdapter<EquipmentLibrary> = {
  domain: 'equipment',
  workflow: 'equipment.fill',
  commandPrefix: 'equipment.fill',
  draftStorageKey: EQUIPMENT_DRAFT_STORAGE_KEY,
  libraryStorageKey: EQUIPMENT_LIBRARY_STORAGE_KEY,
  supportedEffectTypes: SUPPORTED_EQUIPMENT_EFFECT_TYPES,

  validateAiDraft(rawPayload): AgentFillValidationResult<EquipmentLibrary> {
    const parsed = parseEquipmentFillJsonPayload(rawPayload);
    if (!parsed.value) return { ok: false, errors: parsed.errors };
    return equipmentFillDomainCore.validate(parsed.value);
  },
  validateProposalPayload(payload): AgentFillValidationResult<EquipmentLibrary> {
    return equipmentFillDomainCore.validate(payload);
  },
  createProposalPayload(validation, rawCommand): AgentFillProposalPayload<EquipmentLibrary> {
    const draft = mergeEquipmentLibraryPatch(readEquipmentMergeBaseline(), validation.normalized!);
    return createLegacyFillProposalPayload({ rawCommand, normalized: draft, summary: equipmentFillAdapter.summarizeProposal(draft) });
  },
  summarizeProposal: (payload) => equipmentFillDomainCore.summarize(payload),
  getProposalTargetId: (payload) => equipmentFillDomainCore.targetId(payload),

  buildTaskPackage() {
    const draft = readCurrentEquipmentLibrary();
    return {
      lines: [`[info] equipment.fill.task ready: gearSets=${Object.keys(draft.gearSets || {}).length}`],
      data: {
        tool: 'equipment.fill',
        protocolVersion: AI_CLI_PROTOCOL_VERSION,
        currentDraft: draft,
        equipmentFillAiDraftSchema: createEquipmentFillDraftSchema(),
        supportedEffectTypes: SUPPORTED_EQUIPMENT_EFFECT_TYPES,
        storageBoundary: { workingDraft: EQUIPMENT_DRAFT_STORAGE_KEY, savedTruth: EQUIPMENT_LIBRARY_STORAGE_KEY },
        instruction: 'Return exactly one EquipmentFillAiDraft JSON object for equipment.fill.apply. No Markdown. No explanation. gearSets may contain only the gear sets being changed; omitted gear sets are preserved by incremental merge. Each submitted gear set must include its complete gearSetId/name/equipments structure. For an independent triggered damage instance in threePieceBuff/threePieceBuffs, set effectKind="extraHit", category="passive" or "countable", typeKey="", value=0, and provide extraHitConfig including skillType empty/A/B/E/Q/Dot. If category=countable, provide maxStacks; runtime creates one independent segment per active stack. Use equipment.setBuff for three-piece Buff-only updates. Use app-provided source data outside Agent CLI when needed. equipment.fill.apply creates a proposal only.',
        approvalSaveWarning: 'Approval applies to def.equipment-sheet.draft.v1. Save writes def.equipment-sheet.library.v1.',
      },
    };
  },

  applyToWorkingState(payload) {
    try { writeJsonStorage(EQUIPMENT_DRAFT_STORAGE_KEY, mergeEquipmentLibraryPatch(readEquipmentMergeBaseline(), payload)); return { ok: true }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  },
  saveToLocalTruth(payload) {
    try {
      const nextLibrary = mergeEquipmentLibraryPatch(readEquipmentLibrary(), payload);
      writeJsonStorage(EQUIPMENT_LIBRARY_STORAGE_KEY, nextLibrary);
      writeJsonStorage(EQUIPMENT_DRAFT_STORAGE_KEY, nextLibrary);
      return { ok: true };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  },
};
