import { pinyin } from 'pinyin-pro';
import equipmentsRaw from '../../public/data/equipments/equipments.json?raw';

export interface EquipmentSourceIndexEntry {
  id: string;
  name: string;
  kind: 'gearSet' | 'equipment';
  gearSetId: string;
  equipmentId?: string;
  part?: string;
}

function safeJsonParse(raw: string) {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function buildEquipmentSearchText(values: Array<string | number | undefined | null>) {
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

export function readEquipmentSourceLibrary() {
  return safeJsonParse(equipmentsRaw) as { gearSets?: Record<string, unknown>; updatedAt?: string } | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function listEquipmentSourceIndex(): EquipmentSourceIndexEntry[] {
  const library = readEquipmentSourceLibrary();
  const gearSets = isRecord(library?.gearSets) ? library.gearSets : {};
  const rows: EquipmentSourceIndexEntry[] = [];
  for (const [gearSetId, rawSet] of Object.entries(gearSets)) {
    if (!isRecord(rawSet)) continue;
    const setName = typeof rawSet.name === 'string' ? rawSet.name : gearSetId;
    rows.push({
      id: gearSetId,
      name: setName,
      kind: 'gearSet',
      gearSetId,
    });
    const equipments = isRecord(rawSet.equipments) ? rawSet.equipments : {};
    for (const [equipmentId, rawEquipment] of Object.entries(equipments)) {
      if (!isRecord(rawEquipment)) continue;
      rows.push({
        id: equipmentId,
        name: typeof rawEquipment.name === 'string' ? rawEquipment.name : equipmentId,
        kind: 'equipment',
        gearSetId,
        equipmentId,
        part: typeof rawEquipment.part === 'string' ? rawEquipment.part : '',
      });
    }
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

export function readEquipmentSourceData(ref: string): { ok: true; data: unknown; entry: EquipmentSourceIndexEntry } | { ok: false; error: string; candidates?: EquipmentSourceIndexEntry[] } {
  const keyword = ref.trim();
  if (!keyword) {
    return { ok: false, error: 'usage: equipment.data.show <id|name>' };
  }
  const normalized = keyword.toLowerCase();
  const rows = listEquipmentSourceIndex();
  const candidates = rows.filter((entry) => entry.id.toLowerCase() === normalized
    || entry.name === keyword
    || buildEquipmentSearchText([entry.id, entry.name, entry.kind, entry.part]).toLowerCase().includes(normalized));
  if (!candidates.length) {
    return { ok: false, error: `equipment source data not found: ${keyword}` };
  }
  const exact = candidates.filter((entry) => entry.id.toLowerCase() === normalized || entry.name === keyword);
  const matches = exact.length ? exact : candidates;
  if (matches.length > 1) {
    return { ok: false, error: `multiple equipment source matches: ${keyword}`, candidates: matches.slice(0, 10) };
  }

  const entry = matches[0]!;
  const library = readEquipmentSourceLibrary();
  const gearSets = isRecord(library?.gearSets) ? library.gearSets : {};
  const gearSet = gearSets[entry.gearSetId];
  if (!isRecord(gearSet)) {
    return { ok: false, error: `equipment gear set not found: ${entry.gearSetId}` };
  }
  if (entry.kind === 'gearSet') {
    return { ok: true, entry, data: gearSet };
  }
  const equipments = isRecord(gearSet.equipments) ? gearSet.equipments : {};
  const equipment = entry.equipmentId ? equipments[entry.equipmentId] : undefined;
  if (!equipment) {
    return { ok: false, error: `equipment not found: ${entry.equipmentId}` };
  }
  return { ok: true, entry, data: equipment };
}
