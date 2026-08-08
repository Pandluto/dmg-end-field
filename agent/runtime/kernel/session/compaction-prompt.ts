/**
 * Prompt and transcript formatting for durable Session compaction.
 *
 * This module intentionally accepts only transcript messages/entries.  The
 * current Product snapshot, Provider connection, headers, and API key are
 * not inputs and therefore cannot become part of a compaction prompt.
 */
import type { JsonValue } from '../../../core/contracts/json.ts';
import type {
  RuntimeAssistantContent,
  RuntimeMessage,
  RuntimeToolResultPayload,
} from '../messages.ts';
import type { RuntimeEntryId } from '../ids.ts';
import type { RuntimeSessionEntry } from './entries.ts';

const MAX_PROMPT_CODE_UNITS = 48 * 1_024;
const MAX_TRANSCRIPT_CODE_UNITS = 40 * 1_024;
const MAX_MESSAGE_CODE_UNITS = 8 * 1_024;
const MAX_JSON_DEPTH = 8;
const MAX_JSON_ITEMS = 128;
const MAX_JSON_KEYS = 128;
const MAX_JSON_STRING_CODE_UNITS = 2_048;

const SECRET_KEY_PATTERN = /(?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|authorization|bearer|cookie|credential|password|secret|private[-_ ]?key|client[-_ ]?secret|headers?)/iu;
const SECRET_TEXT_PATTERNS: readonly RegExp[] = [
  /authorization\s*:\s*\S+/iu,
  /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/iu,
  /\b(?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|password|secret)\s*[:=]\s*[^\s,;]{4,}/iu,
];

export const COMPACTION_PROMPT_VERSION = 'def-compaction-v1';

export interface CompactionPromptInput {
  /** Prefer entries so the caller can preserve the durable ordering. */
  readonly entries?: readonly RuntimeSessionEntry[];
  readonly messages?: readonly RuntimeMessage[];
  /** When entries contains the retained tail, summarize only its prefix. */
  readonly firstKeptEntryId?: RuntimeEntryId;
}

/** Build a bounded, deterministic summarization prompt from transcript data. */
export function buildCompactionPrompt(input: CompactionPromptInput): string {
  const transcript = transcriptForPrompt(input);
  const boundedTranscript = boundPromptText(transcript, MAX_TRANSCRIPT_CODE_UNITS);
  const prompt = [
    `DEF Runtime compaction prompt (${COMPACTION_PROMPT_VERSION}).`,
    'Create a concise durable summary of the transcript below.',
    '',
    'Preserve these sections and facts:',
    '- User goal and the latest requested outcome.',
    '- Confirmed facts, explicit constraints, and assumptions that still hold.',
    '- Completed steps and their evidence.',
    '- Unfinished steps, next actions, and unresolved questions.',
    '- Key Tool results, including important read facts and mutation receipts.',
    '- User preferences, explicit approvals, and explicit negations.',
    '- Errors, blockers, and recovery decisions that must continue.',
    '- Stable business conclusions relevant to the DEF Workbench.',
    '',
    'Keep unresolved Tool/Interaction state and Tool call/result pairing intact in the live tail; do not claim an unfinished action succeeded.',
    'Do not include the current Product snapshot, a Provider secret, API key, headers, or a raw Provider request. Product context is refreshed separately on every request.',
    'Return only the summary with short factual headings. Do not invent facts.',
    '',
    'Transcript to summarize:',
    boundedTranscript || '[no earlier transcript]',
  ].join('\n');
  return boundPromptText(prompt, MAX_PROMPT_CODE_UNITS);
}

/**
 * Normalize model output before it is considered for durable append.  An
 * empty or oversized answer is a failed compaction, never an empty summary.
 */
export function normalizeCompactionSummary(value: string, maximum = 256 * 1_024): string | undefined {
  const redacted = redactSecrets(value.trim());
  if (!redacted || redacted.length > maximum) return undefined;
  return redacted;
}

function transcriptForPrompt(input: CompactionPromptInput): string {
  if (input.entries) {
    let entries = input.entries;
    if (input.firstKeptEntryId !== undefined) {
      const index = entries.findIndex((entry) => entry.id === input.firstKeptEntryId);
      if (index >= 0) entries = entries.slice(0, index);
    }
    return entries
      .map((entry) => entry.type === 'message'
        ? formatMessage(entry.message)
        : entry.type === 'compaction'
          ? `[COMPACTION SUMMARY]\n${safeText(entry.summary)}`
          : '')
      .filter(Boolean)
      .join('\n\n');
  }
  return (input.messages ?? []).map(formatMessage).join('\n\n');
}

function formatMessage(message: RuntimeMessage): string {
  switch (message.role) {
    case 'user': {
      const content = message.content.map((block) => {
        if (block.type === 'text') return safeText(block.text);
        return `[file attachment omitted: ${safeText(block.filename)}]`;
      }).join('');
      return boundMessage(`[USER]\n${content}`);
    }
    case 'assistant': {
      const content = message.content.map(formatAssistantContent).filter(Boolean).join('\n');
      const diagnostic = message.diagnostic === undefined
        ? ''
        : `\n[provider diagnostic: ${safeText(message.diagnostic.code)} ${safeText(message.diagnostic.message)}]`;
      return boundMessage(`[ASSISTANT]\n${content || '[no assistant text]'}${diagnostic}`);
    }
    case 'tool-result':
      return boundMessage(`[TOOL RESULT ${safeText(message.toolName)} ${safeText(String(message.toolCallId))}]\n${formatToolResult(message.result)}`);
    case 'compaction':
      return boundMessage(`[COMPACTION SUMMARY]\n${safeText(message.summary)}`);
    default:
      return assertNever(message);
  }
}

function formatAssistantContent(block: RuntimeAssistantContent): string {
  if (block.type === 'text') return `[text] ${safeText(block.text)}`;
  if (block.type === 'thinking') return `[reasoning] ${safeText(block.text)}`;
  return `[TOOL CALL ${safeText(block.name)} ${safeText(String(block.toolCallId))}]\n${safeJson(block.arguments)}`;
}

function formatToolResult(result: RuntimeToolResultPayload): string {
  if (result.status === 'succeeded') return `[succeeded]\n${safeJson(result.output)}`;
  return `[failed ${safeText(result.code)}]\n${safeText(result.message)}${result.details === undefined ? '' : `\n${safeJson(result.details)}`}`;
}

function boundMessage(value: string): string {
  return boundPromptText(value, MAX_MESSAGE_CODE_UNITS);
}

function boundPromptText(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  return `${value.slice(0, Math.max(0, maximum - 24))}\n[transcript truncated]`;
}

function safeText(value: string): string {
  return redactSecrets(value.slice(0, MAX_JSON_STRING_CODE_UNITS));
}

function redactSecrets(value: string): string {
  let result = value;
  for (const pattern of SECRET_TEXT_PATTERNS) result = result.replace(pattern, '[redacted]');
  return result;
}

function safeJson(value: JsonValue): string {
  const seen = new WeakSet<object>();
  return encodeJson(value, 0, seen);
}

function encodeJson(value: JsonValue, depth: number, seen: WeakSet<object>): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(safeText(value));
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (depth >= MAX_JSON_DEPTH) return '"[depth limited]"';
  if (seen.has(value)) return '"[cycle omitted]"';
  seen.add(value);

  let result: string;
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_JSON_ITEMS).map((item) => encodeJson(item, depth + 1, seen));
    if (value.length > MAX_JSON_ITEMS) items.push('"[items omitted]"');
    result = `[${items.join(',')}]`;
  } else {
    const keys = Object.keys(value).sort().slice(0, MAX_JSON_KEYS);
    const fields: string[] = [];
    for (const key of keys) {
      if (SECRET_KEY_PATTERN.test(key)) continue;
      fields.push(`${JSON.stringify(key)}:${encodeJson(value[key], depth + 1, seen)}`);
    }
    if (Object.keys(value).length > MAX_JSON_KEYS) fields.push('"[keys omitted]":"[bounded]"');
    result = `{${fields.join(',')}}`;
  }
  seen.delete(value);
  return result;
}

function assertNever(value: never): never {
  throw new TypeError(`Unsupported Runtime message role: ${String(value)}`);
}
