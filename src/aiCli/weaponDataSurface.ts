import { pinyin } from 'pinyin-pro';
import {
  type WeaponDraft,
  readCurrentWeaponDraft,
  readWeaponLibrary,
  writeCurrentWeaponDraft,
} from './weaponFillAdapter';

type WeaponSourceFileKind = 'base' | 'max' | 'buff' | 'markdown';

export interface WeaponSourceIndexEntry {
  name: string;
  id?: string;
  folder: string;
  files: Record<WeaponSourceFileKind, boolean>;
}

export interface WeaponSourceReadResult {
  name: string;
  folder: string;
  files: {
    base?: unknown;
    max?: unknown;
    buff?: unknown;
    markdown?: string;
  };
  missingFiles: string[];
}

export interface WeaponLibrarySummaryEntry {
  id: string;
  name: string;
  rarity: number;
  type: string;
  skills: number;
  effects: number;
}

const weaponSourceRawFiles = import.meta.glob('../../public/data/weapons/**/*', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

function buildSearchText(values: Array<string | number | undefined | null>) {
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

function getWeaponSourcePathParts(path: string) {
  const normalized = path.replace(/\\/g, '/');
  const marker = '/public/data/weapons/';
  const markerIndex = normalized.indexOf(marker);
  const relative = markerIndex >= 0 ? normalized.slice(markerIndex + marker.length) : normalized.split('public/data/weapons/').pop() || normalized;
  const parts = relative.split('/').filter(Boolean);
  return {
    folder: parts[0] || '',
    fileName: parts[parts.length - 1] || '',
  };
}

function getWeaponSourceFileKind(folder: string, fileName: string): WeaponSourceFileKind | null {
  if (!folder || !fileName) return null;
  if (fileName === `${folder}.json` || fileName === `${folder}..json`) return 'base';
  if (fileName === `${folder}max.json` || fileName === `${folder}.max.json`) return 'max';
  if (fileName === `${folder}buff.json` || fileName === `${folder}.buff.json`) return 'buff';
  if (fileName === `${folder}.md` || fileName === `${folder}..md`) return 'markdown';
  return null;
}

function findWeaponSourceRaw(folder: string, kind: WeaponSourceFileKind) {
  for (const [path, raw] of Object.entries(weaponSourceRawFiles)) {
    const parts = getWeaponSourcePathParts(path);
    if (parts.folder !== folder) continue;
    if (getWeaponSourceFileKind(parts.folder, parts.fileName) === kind) {
      return raw;
    }
  }
  return undefined;
}

function getWeaponNameFromSource(folder: string) {
  const baseRaw = findWeaponSourceRaw(folder, 'base') || findWeaponSourceRaw(folder, 'max');
  const parsed = baseRaw ? safeJsonParse(baseRaw) : null;
  if (parsed && typeof parsed === 'object' && 'name' in parsed && typeof (parsed as { name?: unknown }).name === 'string') {
    return (parsed as { name: string }).name;
  }
  return folder;
}

export function listWeaponSourceIndex(): WeaponSourceIndexEntry[] {
  const folders = new Set<string>();
  for (const path of Object.keys(weaponSourceRawFiles)) {
    const { folder } = getWeaponSourcePathParts(path);
    if (folder && folder !== 'weapons-list.json') {
      folders.add(folder);
    }
  }

  return Array.from(folders)
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
    .map((folder) => {
      const name = getWeaponNameFromSource(folder);
      return {
        name,
        id: buildWeaponIdFromName(name),
        folder,
        files: {
          base: Boolean(findWeaponSourceRaw(folder, 'base')),
          max: Boolean(findWeaponSourceRaw(folder, 'max')),
          buff: Boolean(findWeaponSourceRaw(folder, 'buff')),
          markdown: Boolean(findWeaponSourceRaw(folder, 'markdown')),
        },
      };
    });
}

function buildWeaponIdFromName(name: string) {
  const rawPinyin = pinyin(name.trim(), { toneType: 'none', type: 'array' })
    .map((item) => String(item).toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter(Boolean)
    .join('');
  return (rawPinyin || name.toLowerCase())
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function readWeaponSourceData(ref: string): { ok: true; data: WeaponSourceReadResult } | { ok: false; error: string; candidates?: WeaponSourceIndexEntry[] } {
  const keyword = ref.trim();
  if (!keyword) {
    return { ok: false, error: 'usage: weapon.data.show <id|name>' };
  }
  const normalized = keyword.toLowerCase();
  const candidates = listWeaponSourceIndex().filter((entry) => {
    const searchText = buildSearchText([entry.id, entry.name, entry.folder]);
    return entry.id?.toLowerCase() === normalized
      || entry.name === keyword
      || entry.folder === keyword
      || searchText.toLowerCase().includes(normalized);
  });
  if (candidates.length === 0) {
    return { ok: false, error: `weapon source data not found: ${keyword}` };
  }
  const exact = candidates.filter((entry) => entry.id?.toLowerCase() === normalized || entry.name === keyword || entry.folder === keyword);
  const matches = exact.length ? exact : candidates;
  if (matches.length > 1) {
    return { ok: false, error: `multiple weapon source matches: ${keyword}`, candidates: matches.slice(0, 10) };
  }

  const entry = matches[0]!;
  const missingFiles: string[] = [];
  const files: WeaponSourceReadResult['files'] = {};
  const baseRaw = findWeaponSourceRaw(entry.folder, 'base');
  const maxRaw = findWeaponSourceRaw(entry.folder, 'max');
  const buffRaw = findWeaponSourceRaw(entry.folder, 'buff');
  const markdownRaw = findWeaponSourceRaw(entry.folder, 'markdown');

  if (baseRaw) files.base = safeJsonParse(baseRaw); else missingFiles.push('base');
  if (maxRaw) files.max = safeJsonParse(maxRaw); else missingFiles.push('max');
  if (buffRaw) files.buff = safeJsonParse(buffRaw); else missingFiles.push('buff');
  if (markdownRaw) files.markdown = markdownRaw; else missingFiles.push('markdown');

  return {
    ok: true,
    data: {
      name: entry.name,
      folder: entry.folder,
      files,
      missingFiles,
    },
  };
}

export function formatWeaponLibrarySummary(library = readWeaponLibrary()): WeaponLibrarySummaryEntry[] {
  return Object.entries(library)
    .sort(([, a], [, b]) => (a.name || '').localeCompare(b.name || '', 'zh-CN'))
    .map(([id, weapon]) => ({
      id,
      name: weapon.name || '',
      rarity: Number(weapon.rarity ?? 0),
      type: weapon.type || '',
      skills: weapon.skills ? Object.keys(weapon.skills).length : 0,
      effects: weapon.skills ? Object.values(weapon.skills).reduce((sum, skill) => sum + Object.keys(skill.effects || {}).length, 0) : 0,
    }));
}

export function findWeaponLibraryEntry(ref: string, library = readWeaponLibrary()): { id: string; draft: WeaponDraft } | null {
  const keyword = ref.trim();
  if (!keyword) return null;
  const lower = keyword.toLowerCase();
  const entries = Object.entries(library);
  const direct = entries.find(([id, weapon]) => id === keyword || id.toLowerCase() === lower || weapon.name === keyword);
  if (direct) {
    return { id: direct[0], draft: direct[1] };
  }
  const fuzzy = entries.find(([id, weapon]) => buildSearchText([id, weapon.name, weapon.type, weapon.description]).toLowerCase().includes(lower));
  return fuzzy ? { id: fuzzy[0], draft: fuzzy[1] } : null;
}

export function searchWeaponSurface(keyword: string) {
  const lower = keyword.trim().toLowerCase();
  if (!lower) return [];
  const library = readWeaponLibrary();
  const libraryRows = formatWeaponLibrarySummary(library)
    .filter((entry) => {
      const draft = library[entry.id];
      return buildSearchText([entry.id, entry.name, entry.type, draft?.description]).toLowerCase().includes(lower);
    })
    .map((entry) => ({ source: 'library' as const, ...entry }));
  const officialRows = listWeaponSourceIndex()
    .filter((entry) => buildSearchText([entry.id, entry.name, entry.folder]).toLowerCase().includes(lower))
    .map((entry) => ({ source: 'official' as const, id: entry.id || '', name: entry.name, folder: entry.folder, files: entry.files }));
  return [...libraryRows, ...officialRows];
}

export function getCurrentWeaponDraft() {
  return readCurrentWeaponDraft();
}

export function openWeaponLibraryEntry(ref: string): { ok: true; id: string; draft: WeaponDraft } | { ok: false; error: string } {
  const entry = findWeaponLibraryEntry(ref);
  if (!entry) {
    return { ok: false, error: `weapon library entry not found: ${ref}` };
  }
  writeCurrentWeaponDraft(entry.draft);
  return { ok: true, id: entry.id, draft: entry.draft };
}
