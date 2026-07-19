import { AI_CLI_PROTOCOL_VERSION } from './aiCliAgentTypes';
import type { AgentFillDomainAdapter, AgentFillProposalPayload, AgentFillValidationResult } from './aiCliFillDomains';
import { createLegacyFillProposalPayload } from '../legacyFillCore';
import {
  SUPPORTED_EFFECT_TYPES,
  WEAPON_DRAFT_STORAGE_KEY,
  WEAPON_FILL_AI_DRAFT_SCHEMA,
  WEAPON_LIBRARY_STORAGE_KEY,
  createFallbackWeaponDraft,
  parseWeaponFillResult,
  preserveExistingImageUrl,
  weaponFillDomainCore,
  type WeaponDraft,
} from '../legacyFillCore/domains/weapon';

export * from '../legacyFillCore/domains/weapon';

export const ALL_WEAPON_STORAGE_KEYS = [WEAPON_DRAFT_STORAGE_KEY, WEAPON_LIBRARY_STORAGE_KEY];

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
  if (typeof window !== 'undefined') window.localStorage.setItem(key, JSON.stringify(value));
}

export function readCurrentWeaponDraft(): WeaponDraft {
  return readJsonStorage<WeaponDraft>(WEAPON_DRAFT_STORAGE_KEY, createFallbackWeaponDraft());
}

export function readWeaponLibrary(): Record<string, WeaponDraft> {
  return readJsonStorage<Record<string, WeaponDraft>>(WEAPON_LIBRARY_STORAGE_KEY, {});
}

export function writeCurrentWeaponDraft(draft: WeaponDraft) {
  writeJsonStorage(WEAPON_DRAFT_STORAGE_KEY, draft);
}

export const weaponFillAdapter: AgentFillDomainAdapter<WeaponDraft> = {
  domain: 'weapon', workflow: 'weapon.fill', commandPrefix: 'weapon.fill',
  draftStorageKey: WEAPON_DRAFT_STORAGE_KEY, libraryStorageKey: WEAPON_LIBRARY_STORAGE_KEY,
  supportedEffectTypes: SUPPORTED_EFFECT_TYPES,
  validateAiDraft(rawPayload: unknown): AgentFillValidationResult<WeaponDraft> {
    if (typeof rawPayload !== 'string') return { ok: false, errors: ['payload must be string'] };
    const parsed = parseWeaponFillResult(rawPayload);
    return parsed.draft ? { ok: true, errors: [], normalized: parsed.draft } : { ok: false, errors: parsed.errors };
  },
  validateProposalPayload: weaponFillDomainCore.validate,
  createProposalPayload(validation, rawCommand): AgentFillProposalPayload<WeaponDraft> {
    const draft = validation.normalized!;
    return createLegacyFillProposalPayload({ rawCommand, normalized: draft, summary: weaponFillDomainCore.summarize(draft) });
  },
  summarizeProposal: weaponFillDomainCore.summarize,
  getProposalTargetId: weaponFillDomainCore.targetId,
  buildTaskPackage() {
    const draft = readCurrentWeaponDraft();
    const library = readWeaponLibrary();
    return { lines: [`[info] weapon.fill.task ready: name=${draft.name} skills=${Object.keys(draft.skills).length}`], data: {
      tool: 'weapon.fill', protocolVersion: AI_CLI_PROTOCOL_VERSION, currentDraft: draft,
      librarySummary: Object.entries(library).map(([id, weapon]) => ({ id, name: weapon.name, rarity: weapon.rarity })),
      weaponFillAiDraftSchema: WEAPON_FILL_AI_DRAFT_SCHEMA, supportedEffectTypes: SUPPORTED_EFFECT_TYPES,
      extraHitContract: 'For an independent triggered damage instance, set effectKind="extraHit", category="passive" or "countable", type="", levels[level]=that level base multiplier (250%=2.5), and provide extraHitConfig { key, damageType, skillType, baseMultiplier, imbalanceValue, cooldownSeconds, trigger }. skillType is empty/A/B/E/Q/Dot. If category=countable, provide maxStacks; runtime creates one independent segment per active stack.',
      instruction: 'Return exactly one WeaponFillAiDraft JSON object. No Markdown. No explanation. Use app-provided source data outside Agent CLI when needed. Keep fields aligned with weapon-sheet: id/name/rarity/type/description/imgUrl/attackGrowth/skills. If there is no image URL, leave imgUrl empty; do not use url as imgUrl. Only skill3.effects is preserved by weapon-sheet; use category condition/passive/countable. For extraHit, use category passive or countable and store level-specific multiplier in levels. weapon.fill.apply creates a proposal only; it does NOT save to library. Before weapon.fill.apply, self-check pending count with proposal.list. REST weapon.fill.apply is refused while any pending proposal exists. For stale backlog, call proposal.clear through REST, then resubmit only the current proposal. If multiple edits are intended, submit and finish them one by one. Do not ask the user to re-run weapon.fill.apply.',
      approvalSaveWarning: 'IMPORTANT: After REST weapon.fill.apply, the proposal is handed off to Web CLI automatically. Do not submit another weapon.fill.apply while a pending proposal exists. For stale backlog, call proposal.clear through REST, then resubmit only the current proposal. Do NOT tell the user to re-run weapon.fill.apply in the browser.',
    } };
  },
  applyToWorkingState(payload) {
    try { writeJsonStorage(WEAPON_DRAFT_STORAGE_KEY, preserveExistingImageUrl(payload, readCurrentWeaponDraft())); return { ok: true }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  },
  saveToLocalTruth(payload) {
    try {
      const library = readWeaponLibrary();
      const merged = preserveExistingImageUrl(payload, library[payload.id] ?? readCurrentWeaponDraft());
      writeJsonStorage(WEAPON_LIBRARY_STORAGE_KEY, { ...library, [merged.id]: merged });
      writeJsonStorage(WEAPON_DRAFT_STORAGE_KEY, merged);
      return { ok: true };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  },
};
