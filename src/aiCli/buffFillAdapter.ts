import buffSheetAiSystemPromptRaw from '../prompts/buff-sheet-ai-system-prompt.md?raw';
import { buildBuffTypeCatalogPromptSection, BUFF_MODIFIER_TYPE_IDS } from '../ai/buffFillCatalog';
import { createBuffFillAiDraftSchema } from '../ai/buffFillSchema';
import { convertBuffFillAiDraftToBuffDraft, sanitizeBuffFillAiDraft, validateBuffFillAiDraft } from '../ai/buffFillValidator';
import type { BuffDraft } from '../types/buffFill';
import { normalizeStoredBuffDefinition } from '../core/services/buffStorageNormalization';
import { AI_CLI_PROTOCOL_VERSION } from './aiCliAgentTypes';
import type { AgentFillDomainAdapter, AgentFillProposalPayload, AgentFillValidationResult } from './aiCliFillDomains';

export const BUFF_DRAFT_STORAGE_KEY = 'def.buff-editor.draft.v1';
export const BUFF_LIBRARY_STORAGE_KEY = 'def.buff-editor.library.v1';
export const BUFF_UNDO_STORAGE_KEY = 'def.buff-editor.undo.v1';
export const ALL_BUFF_STORAGE_KEYS = [BUFF_DRAFT_STORAGE_KEY, BUFF_LIBRARY_STORAGE_KEY, BUFF_UNDO_STORAGE_KEY];

const BUFF_UNDO_LIMIT = 8;

interface BuffUndoSnapshot {
  id: string;
  createdAt: number;
  label: string;
  selectedDraftId?: string;
  draftState?: BuffDraft;
  localEntries: Array<[string, string | null]>;
}

function readJsonStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') {
    return fallback;
  }
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonStorage(key: string, value: unknown) {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeBuffDraftForStorage(draft: BuffDraft): BuffDraft {
  return {
    ...draft,
    items: Object.fromEntries(
      Object.entries(draft.items || {}).map(([itemKey, item]) => [
        itemKey,
        {
          ...item,
          effects: Object.fromEntries(
            Object.entries(item.effects || {}).map(([effectKey, effect]) => [
              effectKey,
              normalizeStoredBuffDefinition({
                ...effect,
                type: effect.type === 'magicTakenDmgBonus' ? 'magicVulnerability' : effect.type,
              }),
            ])
          ) as BuffDraft['items'][string]['effects'],
        },
      ])
    ),
  };
}

function normalizeBuffLibraryForStorage(library: Record<string, BuffDraft>): Record<string, BuffDraft> {
  return Object.fromEntries(
    Object.entries(library).map(([draftId, draft]) => [draftId, normalizeBuffDraftForStorage(draft)])
  );
}

function validateBuffProposalPayload(payload: unknown): AgentFillValidationResult<BuffDraft> {
  if (!isRecord(payload)) {
    return { ok: false, errors: ['proposal payload must be object'] };
  }
  const errors: string[] = [];
  for (const key of ['id', 'name', 'sourceName', 'source', 'description']) {
    if (typeof payload[key] !== 'string') {
      errors.push(`${key} must be string`);
    }
  }
  if (!isRecord(payload.items)) {
    errors.push('items must be object');
  } else {
    for (const [itemId, item] of Object.entries(payload.items)) {
      if (!isRecord(item)) {
        errors.push(`items.${itemId} must be object`);
        continue;
      }
      for (const key of ['id', 'name', 'sourceName', 'description']) {
        if (typeof item[key] !== 'string') {
          errors.push(`items.${itemId}.${key} must be string`);
        }
      }
      if (!isRecord(item.effects)) {
        errors.push(`items.${itemId}.effects must be object`);
      }
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, errors: [], normalized: payload as unknown as BuffDraft };
}

export function readCurrentBuffDraft(): BuffDraft {
  return normalizeBuffDraftForStorage(readJsonStorage<BuffDraft>(BUFF_DRAFT_STORAGE_KEY, createFallbackDraft()));
}

export function readBuffLibrary(): Record<string, BuffDraft> {
  return normalizeBuffLibraryForStorage(readJsonStorage<Record<string, BuffDraft>>(BUFF_LIBRARY_STORAGE_KEY, {}));
}

export function formatLibrarySummary(library: Record<string, BuffDraft>): Array<{ id: string; name: string; sourceName: string; source: string; items: number; effects: number }> {
  return Object.entries(library)
    .sort(([, a], [, b]) => (a.name || '').localeCompare(b.name || ''))
    .map(([id, entry]) => ({
      id,
      name: entry.name || '',
      sourceName: entry.sourceName || '',
      source: entry.source || '',
      items: entry.items ? Object.keys(entry.items).length : 0,
      effects: entry.items ? Object.values(entry.items).reduce((sum, item) => sum + (item.effects ? Object.keys(item.effects).length : 0), 0) : 0,
    }));
}

export function createFallbackDraft(): BuffDraft {
  return {
    id: 'custom-buff-001',
    name: '本地 Buff 草稿',
    sourceName: '',
    source: 'custom',
    description: '',
    items: {},
  };
}

export function persistDraft(draft: BuffDraft, label?: string) {
  if (label) {
    writeUndoSnapshot(label, readCurrentBuffDraft());
  }
  writeJsonStorage(BUFF_DRAFT_STORAGE_KEY, normalizeBuffDraftForStorage(draft));
}

export function writeUndoSnapshot(label: string, previousDraft: BuffDraft) {
  const snapshots = readJsonStorage<BuffUndoSnapshot[]>(BUFF_UNDO_STORAGE_KEY, []);
  const localEntries: Array<[string, string | null]> = [
    [BUFF_DRAFT_STORAGE_KEY, typeof window !== 'undefined' ? window.localStorage.getItem(BUFF_DRAFT_STORAGE_KEY) : null],
    [BUFF_LIBRARY_STORAGE_KEY, typeof window !== 'undefined' ? window.localStorage.getItem(BUFF_LIBRARY_STORAGE_KEY) : null],
  ];
  const next: BuffUndoSnapshot = {
    id: `undo-${Date.now()}`,
    createdAt: Date.now(),
    label,
    draftState: previousDraft,
    localEntries,
  };
  const trimmed = [next, ...snapshots].slice(0, BUFF_UNDO_LIMIT);
  writeJsonStorage(BUFF_UNDO_STORAGE_KEY, trimmed);
}

function buildTaskPackage(draft: BuffDraft, sourceText: string) {
  const library = readBuffLibrary();
  const modifierCatalog = buildBuffTypeCatalogPromptSection();
  return {
    tool: 'buff.fill',
    protocolVersion: AI_CLI_PROTOCOL_VERSION,
    mainStorage: BUFF_LIBRARY_STORAGE_KEY,
    currentDraft: draft,
    sourceText,
    librarySummary: formatLibrarySummary(library),
    modifierCatalog,
    systemPrompt: buffSheetAiSystemPromptRaw.trim(),
    instruction: 'Return exactly one BuffFillAiDraft JSON object. No Markdown. No explanation. Modifier effects may include category=condition/countable/passive. Multiplier buffs remain effectKind=modifier, always use category=condition, keep the original supported type, and write multiplier={coefficient: positiveNumber}; do not create multiplierMultiplier and do not copy coefficient into value. multiplier is incompatible with countable and extraHit. fill.apply creates a proposal only; it does NOT save to library. Before fill.apply, self-check pending count with proposal.list. REST fill.apply is refused while any pending proposal exists. For stale backlog, call proposal.clear through REST, then resubmit only the current proposal. If multiple edits are intended, submit and finish them one by one. Do not ask the user to re-run fill.apply.',
    outputSchema: createBuffFillAiDraftSchema(),
    approvalSaveWarning: 'IMPORTANT: After REST fill.apply, the proposal is handed off to Web CLI automatically. Do not submit another fill.apply while a pending proposal exists. For stale backlog, call proposal.clear through REST, then resubmit only the current proposal. Do NOT tell the user to re-run fill.apply in the browser.',
  };
}

function summarizeTaskPackage(draft: BuffDraft) {
  const itemCount = Object.keys(draft.items).length;
  const effectCount = Object.values(draft.items).reduce((sum, item) => sum + Object.keys(item.effects).length, 0);
  return `fill.task ready: items=${itemCount} effects=${effectCount}, catalog=${BUFF_MODIFIER_TYPE_IDS.length} types`;
}

function extractBalancedJsonObject(rawText: string) {
  const text = rawText.trim();
  const start = text.indexOf('{');
  if (start < 0) {
    return null;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }
  return null;
}

function parseAiFillResult(rawText: string, _options?: { skipSanitize?: boolean }) {
  const normalizedText = rawText.trim();
  if (!normalizedText) {
    return { draft: null, errors: ['AI response is empty'] };
  }
  const candidates = [normalizedText];
  const balancedJson = extractBalancedJsonObject(normalizedText);
  if (balancedJson && balancedJson !== normalizedText) {
    candidates.push(balancedJson);
  }
  const errors: string[] = [];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      const rawDraft = parsed && typeof parsed.draft === 'object' ? parsed.draft : parsed;
      const validation = validateBuffFillAiDraft(rawDraft);
      if (!validation.ok) {
        errors.push(...validation.errors);
        continue;
      }
      const sanitized = sanitizeBuffFillAiDraft(rawDraft as Record<string, unknown>);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const draft = convertBuffFillAiDraftToBuffDraft(sanitized as unknown as any);
      return { draft, errors: [] };
    } catch (error) {
      errors.push(`JSON parse failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { draft: null, errors: Array.from(new Set(errors)) };
}

export const buffFillAdapter: AgentFillDomainAdapter<BuffDraft> = {
  domain: 'buff',
  workflow: 'buff.fill',
  commandPrefix: 'fill',
  draftStorageKey: BUFF_DRAFT_STORAGE_KEY,
  libraryStorageKey: BUFF_LIBRARY_STORAGE_KEY,
  supportedEffectTypes: BUFF_MODIFIER_TYPE_IDS as string[],

  validateAiDraft(rawPayload: unknown): AgentFillValidationResult<BuffDraft> {
    if (typeof rawPayload !== 'string') {
      return { ok: false, errors: ['payload must be string'] };
    }
    const parsed = parseAiFillResult(rawPayload, { skipSanitize: true });
    if (!parsed.draft) {
      return { ok: false, errors: parsed.errors };
    }
    return { ok: true, errors: [], normalized: parsed.draft };
  },

  validateProposalPayload: validateBuffProposalPayload,

  createProposalPayload(validation, rawCommand): AgentFillProposalPayload<BuffDraft> {
    const draft = validation.normalized!;
    return {
      rawCommand,
      normalized: draft,
      summary: buffFillAdapter.summarizeProposal(draft),
    };
  },

  summarizeProposal(payload: BuffDraft): string {
    const itemCount = Object.keys(payload.items).length;
    const effectCount = Object.values(payload.items).reduce((sum, item) => sum + Object.keys(item.effects).length, 0);
    return `buff fill: items=${itemCount} effects=${effectCount}`;
  },

  buildTaskPackage() {
    const draft = readCurrentBuffDraft();
    return {
      lines: [`[info] ${summarizeTaskPackage(draft)}`],
      data: buildTaskPackage(draft, ''),
    };
  },

  applyToWorkingState(payload: BuffDraft): { ok: boolean; error?: string } {
    try {
      writeJsonStorage(BUFF_DRAFT_STORAGE_KEY, normalizeBuffDraftForStorage(payload));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  saveToLocalTruth(payload: BuffDraft): { ok: boolean; error?: string } {
    try {
      const previousDraft = readCurrentBuffDraft();
      const normalizedPayload = normalizeBuffDraftForStorage(payload);
      const nextLibrary = normalizeBuffLibraryForStorage({ ...readBuffLibrary(), [payload.id]: normalizedPayload });
      writeUndoSnapshot(`AI CLI fill.save · ${payload.id}`, previousDraft);
      writeJsonStorage(BUFF_LIBRARY_STORAGE_KEY, nextLibrary);
      writeJsonStorage(BUFF_DRAFT_STORAGE_KEY, normalizedPayload);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};
