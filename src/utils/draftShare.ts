export interface DraftLibraryShareFile<T = unknown> {
  type: string;
  exportedAt: number;
  label: string;
  payload: Record<string, T>;
}

function normalizeShareLabel(label?: string): string {
  const normalized = label?.trim();
  return normalized || '未命名';
}

function sanitizeFileNamePart(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  const seconds = `${date.getSeconds()}`.padStart(2, '0');
  return `${year}-${month}-${day} ${hours}-${minutes}-${seconds}`;
}

export function buildDraftLibraryShareFile<T>(
  type: string,
  payload: Record<string, T>,
  customLabel?: string
): DraftLibraryShareFile<T> {
  return {
    type,
    exportedAt: Date.now(),
    label: normalizeShareLabel(customLabel),
    payload,
  };
}

export function parseDraftLibraryShareFile(
  rawText: string,
  expectedType: string
): DraftLibraryShareFile<unknown> | null {
  try {
    const parsed = JSON.parse(rawText) as Partial<DraftLibraryShareFile<unknown>>;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    if (parsed.type !== expectedType) {
      return null;
    }
    if (!parsed.payload || typeof parsed.payload !== 'object' || Array.isArray(parsed.payload)) {
      return null;
    }

    return {
      type: expectedType,
      exportedAt: typeof parsed.exportedAt === 'number' ? parsed.exportedAt : Date.now(),
      label: normalizeShareLabel(parsed.label),
      payload: parsed.payload as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

export function buildDraftLibraryShareFileName(label: string, exportedAt: number): string {
  const safeLabel = sanitizeFileNamePart(normalizeShareLabel(label)) || '未命名';
  return `${safeLabel}-${formatTimestamp(exportedAt)}.json`;
}
