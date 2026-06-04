import {
  type WeaponDraft,
  readCurrentWeaponDraft,
  readWeaponLibrary,
  writeCurrentWeaponDraft,
} from './weaponFillAdapter';
import {
  buildWeaponSearchText,
  listWeaponSourceIndex,
  readWeaponSourceData,
} from './weaponSourceData';

export { listWeaponSourceIndex, readWeaponSourceData };

export interface WeaponLibrarySummaryEntry {
  id: string;
  name: string;
  rarity: number;
  type: string;
  skills: number;
  effects: number;
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
  const fuzzy = entries.find(([id, weapon]) => buildWeaponSearchText([id, weapon.name, weapon.type, weapon.description]).toLowerCase().includes(lower));
  return fuzzy ? { id: fuzzy[0], draft: fuzzy[1] } : null;
}

export function searchWeaponSurface(keyword: string) {
  const lower = keyword.trim().toLowerCase();
  if (!lower) return [];
  const library = readWeaponLibrary();
  const libraryRows = formatWeaponLibrarySummary(library)
    .filter((entry) => {
      const draft = library[entry.id];
      return buildWeaponSearchText([entry.id, entry.name, entry.type, draft?.description]).toLowerCase().includes(lower);
    })
    .map((entry) => ({ source: 'library' as const, ...entry }));
  const officialRows = listWeaponSourceIndex()
    .filter((entry) => buildWeaponSearchText([entry.id, entry.name, entry.folder]).toLowerCase().includes(lower))
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
