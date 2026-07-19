import { AI_CLI_PROTOCOL_VERSION } from './aiCliAgentTypes';
import type { AgentFillDomainAdapter, AgentFillProposalPayload, AgentFillValidationResult } from './aiCliFillDomains';
import { createLegacyFillProposalPayload } from '../legacyFillCore';
import {
  SUPPORTED_OPERATOR_EFFECT_TYPES,
  createOperatorFillDraftSchema,
  createFallbackOperatorDraft,
  formatOperatorLibrarySummary,
  normalizeOperatorDraft,
  operatorFillDomainCore,
  parseOperatorFillJsonPayload,
  preserveExistingOperatorAssetUrls,
  validateOperatorDraftShape,
  type OperatorDraft,
} from '../legacyFillCore/domains/operator';

export const OPERATOR_DRAFT_STORAGE_KEY = 'def.operator-editor.draft.v1';
export const OPERATOR_LIBRARY_STORAGE_KEY = 'def.operator-editor.library.v1';

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

export function readCurrentOperatorDraft(): OperatorDraft {
  const stored = readJsonStorage<OperatorDraft>(OPERATOR_DRAFT_STORAGE_KEY, createFallbackOperatorDraft());
  return normalizeOperatorDraft(stored as unknown as Record<string, unknown>);
}

export function readOperatorLibrary(): Record<string, OperatorDraft> {
  const stored = readJsonStorage<Record<string, OperatorDraft>>(OPERATOR_LIBRARY_STORAGE_KEY, {});
  return Object.fromEntries(Object.entries(stored).map(([id, value]) => [id, normalizeOperatorDraft(value as unknown as Record<string, unknown>)]));
}

function readExistingOperatorDraftForPayload(payload: OperatorDraft): OperatorDraft | undefined {
  const libraryDraft = readOperatorLibrary()[payload.id];
  if (libraryDraft) return libraryDraft;
  const currentDraft = readCurrentOperatorDraft();
  return currentDraft.id === payload.id ? currentDraft : undefined;
}

function preserveExistingOperatorAssets(payload: OperatorDraft): OperatorDraft {
  const existing = readExistingOperatorDraftForPayload(payload);
  return existing ? preserveExistingOperatorAssetUrls(payload, existing) : payload;
}

export { formatOperatorLibrarySummary, operatorFillDomainCore, type OperatorDraft };

export const operatorFillAdapter: AgentFillDomainAdapter<OperatorDraft> = {
  domain: 'operator',
  workflow: 'operator.fill',
  commandPrefix: 'operator.fill',
  draftStorageKey: OPERATOR_DRAFT_STORAGE_KEY,
  libraryStorageKey: OPERATOR_LIBRARY_STORAGE_KEY,
  supportedEffectTypes: SUPPORTED_OPERATOR_EFFECT_TYPES,

  validateAiDraft(rawPayload): AgentFillValidationResult<OperatorDraft> {
    const parsed = parseOperatorFillJsonPayload(rawPayload);
    if (!parsed.value) return { ok: false, errors: parsed.errors };
    return validateOperatorDraftShape(parsed.value);
  },
  validateProposalPayload: operatorFillDomainCore.validate,
  createProposalPayload(validation, rawCommand): AgentFillProposalPayload<OperatorDraft> {
    const draft = preserveExistingOperatorAssets(validation.normalized!);
    return createLegacyFillProposalPayload({ rawCommand, normalized: draft, summary: operatorFillAdapter.summarizeProposal(draft) });
  },
  summarizeProposal: (payload) => operatorFillDomainCore.summarize(payload),
  getProposalTargetId: (payload) => operatorFillDomainCore.targetId(payload),

  buildTaskPackage() {
    const draft = readCurrentOperatorDraft();
    const library = readOperatorLibrary();
    return {
      lines: [`[info] operator.fill.task ready: name=${draft.name} skills=${Object.keys(draft.skills || {}).length}`],
      data: {
        tool: 'operator.fill',
        protocolVersion: AI_CLI_PROTOCOL_VERSION,
        currentDraft: draft,
        librarySummary: formatOperatorLibrarySummary(library),
        operatorFillAiDraftSchema: createOperatorFillDraftSchema(),
        supportedEffectTypes: SUPPORTED_OPERATOR_EFFECT_TYPES,
        instruction: 'Return exactly one ImportedOperatorDraft-compatible JSON object. No Markdown. No explanation. Prefer POST /api/operator/fill/check|apply with a JSON body for Chinese payloads; CLI JSON args may be shell-encoding sensitive. Use system skill keys in the latest format skill-{buttonType}-{index}, for example skill-A-1 / skill-B-1 / skill-E-1 / skill-Q-1 / skill-Dot-1; every buttonType counts from 1. Legacy skill-1 keys are accepted only for compatibility and will be normalized. Operator buffs use talent/potential/skill groups. Buff category must be passive/condition/countable; legacy positive is accepted only for migration and normalizes to passive. Multiplier buffs remain effectKind=modifier, always use category=condition, use multiplier={ coefficient: positiveNumber }, only reference supportedEffectTypes listed in buffEffect.multiplier.supportedTypes, and never copy coefficient into value. Use multiplierBonus as the canonical skill-multiplier type; multiplierMultiplier is legacy input only. Multiplier is incompatible with countable and extraHit. Countable buffs require maxStacks and only support fixed numeric value, no derivedValue. ExtraHit requires extraHitConfig and supports passive/countable only; countable extraHit creates one independent damage segment per active stack. Fixed effects use valueMode fixed with numeric value. Derived effects use valueMode derived and derivedValue.source/perPointValue, where perPointValue means 每点提升多少, not an arbitrary formula. Percent-like buff types still use decimal numbers, e.g. 每点 +0.10% => 0.001. operator.fill.apply creates a proposal only; it does NOT save to library.',
        approvalSaveWarning: 'Approval applies to def.operator-editor.draft.v1. Save writes def.operator-editor.library.v1.',
      },
    };
  },

  applyToWorkingState(payload) {
    try { writeJsonStorage(OPERATOR_DRAFT_STORAGE_KEY, preserveExistingOperatorAssets(payload)); return { ok: true }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  },
  saveToLocalTruth(payload) {
    try {
      const mergedPayload = preserveExistingOperatorAssets(payload);
      writeJsonStorage(OPERATOR_LIBRARY_STORAGE_KEY, { ...readOperatorLibrary(), [mergedPayload.id]: mergedPayload });
      writeJsonStorage(OPERATOR_DRAFT_STORAGE_KEY, mergedPayload);
      return { ok: true };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  },
};
