import { pinyin } from 'pinyin-pro';

export interface OperatorSourceIndexEntry {
  name: string;
  id: string;
  folder: string;
  files: {
    base: boolean;
    max: boolean;
    buff: boolean;
    markdown: boolean;
  };
}

export interface OperatorSourceReadResult {
  name: string;
  id: string;
  folder: string;
  base?: unknown;
  max?: unknown;
  buff?: unknown;
  markdown?: string;
  files: {
    base?: unknown;
    max?: unknown;
    buff?: unknown;
    markdown?: string;
  };
  missingFiles: string[];
}

const operatorSourceRawFiles = import.meta.glob('../../public/data/characters/**/*', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

export function buildOperatorSearchText(values: Array<string | number | undefined | null>) {
  const text = values
    .map((value) => (value == null ? '' : String(value).trim()))
    .filter(Boolean)
    .join(' ');
  if (!text) return '';
  const fullPinyin = pinyin(text, { toneType: 'none', type: 'array' })
    .map((item) => String(item).toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter(Boolean)
    .join(' ');
  const initials = pinyin(text, { toneType: 'none', pattern: 'first', type: 'array' })
    .map((item) => String(item).toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter(Boolean)
    .join('');
  return [text, text.toLowerCase(), fullPinyin, initials].filter(Boolean).join(' | ');
}

function safeJsonParse(raw: string) {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function buildOperatorIdFromName(name: string) {
  const rawPinyin = pinyin(name.trim(), { toneType: 'none', type: 'array' })
    .map((item) => String(item).toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter(Boolean)
    .join('');
  return (rawPinyin || name.toLowerCase())
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getPathParts(path: string) {
  const normalized = path.replace(/\\/g, '/');
  const marker = '/public/data/characters/';
  const markerIndex = normalized.indexOf(marker);
  const relative = markerIndex >= 0 ? normalized.slice(markerIndex + marker.length) : normalized.split('public/data/characters/').pop() || normalized;
  const parts = relative.split('/').filter(Boolean);
  return {
    folder: parts.length > 1 ? parts[0] : '',
    fileName: parts[parts.length - 1] || '',
  };
}

function findRaw(folder: string, kind: keyof OperatorSourceIndexEntry['files']) {
  for (const [path, raw] of Object.entries(operatorSourceRawFiles)) {
    const parts = getPathParts(path);
    if (parts.folder !== folder) continue;
    if (kind === 'base' && parts.fileName === `${folder}.json`) return raw;
    if (kind === 'max' && parts.fileName === `${folder}max.json`) return raw;
    if (kind === 'buff' && parts.fileName === `${folder}buff.json`) return raw;
    if (kind === 'markdown' && parts.fileName === `${folder}.md`) return raw;
  }
  return undefined;
}

function getNameFromSource(folder: string) {
  const base = findRaw(folder, 'base') || findRaw(folder, 'max');
  const parsed = base ? safeJsonParse(base) : null;
  if (parsed && typeof parsed === 'object' && typeof (parsed as { name?: unknown }).name === 'string') {
    return (parsed as { name: string }).name;
  }
  return folder;
}

export function listOperatorSourceIndex(): OperatorSourceIndexEntry[] {
  const folders = new Set<string>();
  for (const path of Object.keys(operatorSourceRawFiles)) {
    const { folder } = getPathParts(path);
    if (folder) folders.add(folder);
  }
  return Array.from(folders)
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
    .map((folder) => {
      const name = getNameFromSource(folder);
      return {
        name,
        id: buildOperatorIdFromName(name),
        folder,
        files: {
          base: Boolean(findRaw(folder, 'base')),
          max: Boolean(findRaw(folder, 'max')),
          buff: Boolean(findRaw(folder, 'buff')),
          markdown: Boolean(findRaw(folder, 'markdown')),
        },
      };
    });
}

export function readOperatorSourceData(ref: string): { ok: true; data: OperatorSourceReadResult } | { ok: false; error: string; candidates?: OperatorSourceIndexEntry[] } {
  const keyword = ref.trim();
  if (!keyword) {
    return { ok: false, error: 'usage: operator.data.show <id|name>' };
  }
  const normalized = keyword.toLowerCase();
  const candidates = listOperatorSourceIndex().filter((entry) => {
    const searchText = buildOperatorSearchText([entry.id, entry.name, entry.folder]);
    return entry.id.toLowerCase() === normalized
      || entry.name === keyword
      || entry.folder === keyword
      || searchText.toLowerCase().includes(normalized);
  });
  if (!candidates.length) {
    return { ok: false, error: `operator source data not found: ${keyword}` };
  }
  const exact = candidates.filter((entry) => entry.id.toLowerCase() === normalized || entry.name === keyword || entry.folder === keyword);
  const matches = exact.length ? exact : candidates;
  if (matches.length > 1) {
    return { ok: false, error: `multiple operator source matches: ${keyword}`, candidates: matches.slice(0, 10) };
  }

  const entry = matches[0]!;
  const missingFiles: string[] = [];
  const files: OperatorSourceReadResult['files'] = {};
  const baseRaw = findRaw(entry.folder, 'base');
  const maxRaw = findRaw(entry.folder, 'max');
  const buffRaw = findRaw(entry.folder, 'buff');
  const markdownRaw = findRaw(entry.folder, 'markdown');
  if (baseRaw) files.base = safeJsonParse(baseRaw); else missingFiles.push('base');
  if (maxRaw) files.max = safeJsonParse(maxRaw); else missingFiles.push('max');
  if (buffRaw) files.buff = safeJsonParse(buffRaw); else missingFiles.push('buff');
  if (markdownRaw) files.markdown = markdownRaw; else missingFiles.push('markdown');
  const baseFields = isRecord(files.base) ? files.base : {};
  return {
    ok: true,
    data: {
      ...baseFields,
      name: entry.name,
      id: entry.id,
      folder: entry.folder,
      base: files.base,
      max: files.max,
      buff: files.buff,
      markdown: files.markdown,
      files,
      missingFiles,
    },
  };
}
