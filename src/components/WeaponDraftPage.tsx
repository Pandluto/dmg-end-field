import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { pinyin } from 'pinyin-pro';
import './BuffDraftPage.css';
import './OperatorDraftPage.css';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../utils/appRoute';
import {
  buildDraftLibraryShareFile,
  buildDraftLibraryShareFileName,
  parseDraftLibraryShareFile,
  type DraftLibraryShareFile,
} from '../utils/draftShare';

const WEAPON_SHEET_PAGE_PATH = APP_ROUTE_PATHS.weaponSheet;
const WEAPON_DRAFT_STORAGE_KEY = 'def.weapon-sheet.draft.v1';
const WEAPON_LIBRARY_STORAGE_KEY = 'def.weapon-sheet.library.v1';
const WEAPON_LIBRARY_SHARE_TYPE = 'weapon-library-share.v1';

type WeaponSkillKey = 'skill1' | 'skill2' | 'skill3';
type WeaponEffectBucket = 'value' | 'passive' | 'effects';

interface RawWeaponLevelData {
  value?: number;
  description?: string;
  passive?: Record<string, number>;
  effects?: Record<string, number>;
}

interface RawWeaponSkillData {
  name?: string;
  statType?: string;
  levels?: Record<string, RawWeaponLevelData>;
}

interface RawWeaponDraft {
  id?: string;
  name?: string;
  rarity?: number;
  type?: string;
  description?: string;
  attackGrowth?: Record<string, number>;
  skills?: Record<string, RawWeaponSkillData>;
}

interface WeaponLevelData {
  value?: number;
  description: string;
  passive: Record<string, number>;
  effects: Record<string, number>;
}

interface WeaponSkillData {
  name: string;
  statType: string;
  levels: Record<string, WeaponLevelData>;
}

interface WeaponDraft {
  id: string;
  name: string;
  rarity: number;
  type: string;
  description: string;
  attackGrowth: Record<string, number>;
  skills: Record<WeaponSkillKey, WeaponSkillData>;
}

type WeaponSheetRow =
  | {
      kind: 'weapon';
      key: string;
      title: string;
      idText: string;
      slot: string;
      level: string;
      effectKey: string;
      valueText: string;
      description: string;
      searchText: string;
    }
  | {
      kind: 'skill';
      key: string;
      skillKey: WeaponSkillKey;
      title: string;
      idText: string;
      slot: string;
      level: string;
      effectKey: string;
      valueText: string;
      description: string;
      searchText: string;
    }
  | {
      kind: 'level';
      key: string;
      skillKey: WeaponSkillKey;
      levelKey: string;
      title: string;
      idText: string;
      slot: string;
      level: string;
      effectKey: string;
      valueText: string;
      description: string;
      searchText: string;
    }
  | {
      kind: 'effect';
      key: string;
      skillKey: WeaponSkillKey;
      levelKey: string;
      bucket: WeaponEffectBucket;
      sourceEffectKey: string;
      title: string;
      idText: string;
      slot: string;
      level: string;
      effectKey: string;
      valueText: string;
      description: string;
      searchText: string;
    };

interface WeaponSheetColumn {
  key: 'name' | 'idText' | 'slot' | 'level' | 'effectKey' | 'valueText' | 'description';
  title: string;
  width: number;
  align?: 'left' | 'center' | 'right';
}

interface WeaponWorkbookCell {
  key: string;
  address: string;
  value: string;
  columnKey: WeaponSheetColumn['key'];
  width: number;
  align: 'left' | 'center' | 'right';
  sourceRowKey: string;
}

interface WeaponWorkbookRow {
  key: string;
  rowNumber: number;
  kind: WeaponSheetRow['kind'];
  sourceRow: WeaponSheetRow;
  cells: WeaponWorkbookCell[];
}

interface WeaponWorkbookSelection {
  address: string;
  sourceRowKey: string;
  columnKey: WeaponSheetColumn['key'];
}

interface FormulaBinding {
  key: string;
  focusId: string;
  inputMode: 'text' | 'number';
  value: string;
  placeholder: string;
  control?: 'input' | 'select';
  readOnly?: boolean;
  options?: Array<{ value: string; label: string }>;
  onValueChange?: (value: string) => void;
  apply: (draft: WeaponDraft, rawInput: string) => WeaponDraft;
}

const SKILL_KEYS: WeaponSkillKey[] = ['skill1', 'skill2', 'skill3'];
const LEVEL_KEYS = Array.from({ length: 9 }, (_, index) => String(index + 1));

function isWeaponSheetPath(pathname: string) {
  return pathname === WEAPON_SHEET_PAGE_PATH;
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function buildWeaponIdFromName(name: string) {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return '';
  }
  const rawPinyin = pinyin(trimmedName, { toneType: 'none', type: 'array' })
    .map((item) => String(item).toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter(Boolean)
    .join('');
  const normalized = (rawPinyin || trimmedName.toLowerCase())
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized;
}

function createEmptyWeaponLevelData(): WeaponLevelData {
  return {
    value: undefined,
    description: '',
    passive: {},
    effects: {},
  };
}

function createEmptyWeaponSkillData(skillKey: WeaponSkillKey): WeaponSkillData {
  return {
    name: skillKey,
    statType: '',
    levels: Object.fromEntries(
      Array.from({ length: 9 }, (_, index) => {
        const levelKey = String(index + 1);
        return [levelKey, createEmptyWeaponLevelData()];
      }),
    ) as Record<string, WeaponLevelData>,
  };
}

function createEmptyWeaponDraft(nextId = 'custom-weapon-001'): WeaponDraft {
  return {
    id: nextId,
    name: '新建武器',
    rarity: 6,
    type: '',
    description: '',
    attackGrowth: {},
    skills: {
      skill1: createEmptyWeaponSkillData('skill1'),
      skill2: createEmptyWeaponSkillData('skill2'),
      skill3: createEmptyWeaponSkillData('skill3'),
    },
  };
}

function normalizeWeaponDraft(raw: RawWeaponDraft | WeaponDraft | null | undefined): WeaponDraft {
  const fallbackId = buildWeaponIdFromName(raw?.name?.trim() || '') || 'custom-weapon-001';
  const nextDraft: WeaponDraft = {
    id: typeof raw?.id === 'string' && raw.id.trim() ? raw.id.trim() : fallbackId,
    name: raw?.name?.trim() || '未命名武器',
    rarity: Number(raw?.rarity ?? 6) || 6,
    type: raw?.type?.trim() || '',
    description: raw?.description?.trim() || '',
    attackGrowth: Object.fromEntries(
      Object.entries(raw?.attackGrowth ?? {}).filter(([, value]) => typeof value === 'number')
    ),
    skills: {
      skill1: createEmptyWeaponSkillData('skill1'),
      skill2: createEmptyWeaponSkillData('skill2'),
      skill3: createEmptyWeaponSkillData('skill3'),
    },
  };

  SKILL_KEYS.forEach((skillKey) => {
    const sourceSkill = raw?.skills?.[skillKey];
    const nextSkill = createEmptyWeaponSkillData(skillKey);
    nextSkill.name = sourceSkill?.name?.trim() || skillKey;
    nextSkill.statType = sourceSkill?.statType?.trim() || '';

    Array.from({ length: 9 }, (_, index) => String(index + 1)).forEach((levelKey) => {
      const level = sourceSkill?.levels?.[levelKey];
      nextSkill.levels[levelKey] = {
        value: typeof level?.value === 'number' ? level.value : undefined,
        description: level?.description?.trim() || '',
        passive: Object.fromEntries(Object.entries(level?.passive ?? {}).filter(([, value]) => typeof value === 'number')),
        effects: Object.fromEntries(Object.entries(level?.effects ?? {}).filter(([, value]) => typeof value === 'number')),
      };
    });

    nextDraft.skills[skillKey] = nextSkill;
  });

  return nextDraft;
}

function buildNextCustomWeaponId(existingIds: string[]) {
  let index = 1;
  while (existingIds.includes(`custom-weapon-${String(index).padStart(3, '0')}`)) {
    index += 1;
  }
  return `custom-weapon-${String(index).padStart(3, '0')}`;
}

function readLocalStorageJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') {
    return fallback;
  }
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeLocalStorageJson<T>(key: string, value: T) {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(value));
}

function loadLocalWeaponLibrary() {
  const raw = readLocalStorageJson<Record<string, RawWeaponDraft>>(WEAPON_LIBRARY_STORAGE_KEY, {});
  return Object.fromEntries(
    Object.entries(raw).map(([draftId, draftValue]) => [draftId, normalizeWeaponDraft({ ...draftValue, id: draftId })]),
  ) as Record<string, WeaponDraft>;
}

function loadDraftFromStorage() {
  const raw = readLocalStorageJson<RawWeaponDraft | null>(WEAPON_DRAFT_STORAGE_KEY, null);
  if (!raw) {
    return createEmptyWeaponDraft();
  }
  return normalizeWeaponDraft(raw);
}

function buildWeaponSheetColumns(): WeaponSheetColumn[] {
  return [
    { key: 'name', title: '名称', width: 220 },
    { key: 'idText', title: 'ID', width: 120 },
    { key: 'slot', title: '槽位', width: 120, align: 'center' },
    { key: 'level', title: '等级', width: 72, align: 'center' },
    { key: 'effectKey', title: '效果键', width: 180 },
    { key: 'valueText', title: '数值', width: 110, align: 'right' },
    { key: 'description', title: '描述', width: 420 },
  ];
}

function formatWeaponNumericValue(value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '-';
  }
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

function buildWeaponLevelRowKey(skillKey: WeaponSkillKey) {
  return `level-${skillKey}`;
}

function buildWeaponEffectRowKey(
  skillKey: WeaponSkillKey,
  levelKey: string,
  bucket: WeaponEffectBucket,
  effectKey: string,
) {
  return bucket === 'value'
    ? `effect-${skillKey}-${levelKey}-value`
    : `effect-${skillKey}-${levelKey}-${bucket}-${effectKey}`;
}

function buildWeaponSheetRows(draft: WeaponDraft, selectedLevelBySkill: Record<WeaponSkillKey, string>): WeaponSheetRow[] {
  const rows: WeaponSheetRow[] = [
    {
      kind: 'weapon',
      key: `weapon-${draft.id}`,
      title: draft.name,
      idText: draft.id,
      slot: 'weapon',
      level: '-',
      effectKey: draft.type || '未设置类型',
      valueText: `${draft.rarity}★`,
      description: draft.description || '-',
      searchText: `${draft.name} ${draft.id} ${draft.type} ${draft.description}`.toLowerCase(),
    },
  ];

  SKILL_KEYS.forEach((skillKey) => {
    const skill = draft.skills[skillKey];
    const levelCount = Object.keys(skill.levels).length;
    const selectedLevelKey = skill.levels[selectedLevelBySkill[skillKey]] ? selectedLevelBySkill[skillKey] : '1';
    const levelData = skill.levels[selectedLevelKey];
    const effectCount = Number(typeof levelData.value === 'number') + Object.keys(levelData.passive).length + Object.keys(levelData.effects).length;
    rows.push({
      kind: 'skill',
      key: `skill-${skillKey}`,
      skillKey,
      title: skill.name || skillKey,
      idText: skillKey,
      slot: skill.statType || '-',
      level: '-',
      effectKey: `${levelCount} 个 level`,
      valueText: '-',
      description: '',
      searchText: `${skillKey} ${skill.name} ${skill.statType}`.toLowerCase(),
    });

    rows.push({
      kind: 'level',
      key: buildWeaponLevelRowKey(skillKey),
      skillKey,
      levelKey: selectedLevelKey,
      title: 'Level',
      idText: `${skillKey}-level`,
      slot: skill.name || skillKey,
      level: `Lv${selectedLevelKey}`,
      effectKey: `${effectCount} 个效果`,
      valueText: typeof levelData.value === 'number' ? formatWeaponNumericValue(levelData.value) : '-',
      description: levelData.description || '-',
      searchText: `${skill.name} ${skillKey} level ${selectedLevelKey} ${levelData.description}`.toLowerCase(),
    });

    if (typeof levelData.value === 'number') {
      rows.push({
        kind: 'effect',
        key: buildWeaponEffectRowKey(skillKey, selectedLevelKey, 'value', 'value'),
        skillKey,
        levelKey: selectedLevelKey,
        bucket: 'value',
        sourceEffectKey: 'value',
        title: skill.name || skillKey,
        idText: `${skillKey}-${selectedLevelKey}-value`,
        slot: 'value',
        level: `Lv${selectedLevelKey}`,
        effectKey: 'value',
        valueText: formatWeaponNumericValue(levelData.value),
        description: levelData.description || '-',
        searchText: `${skill.name} ${skillKey} level ${selectedLevelKey} value ${levelData.value} ${levelData.description}`.toLowerCase(),
      });
    }

    (['passive', 'effects'] as const).forEach((bucket) => {
      Object.entries(levelData[bucket]).forEach(([effectKey, value]) => {
        rows.push({
          kind: 'effect',
          key: buildWeaponEffectRowKey(skillKey, selectedLevelKey, bucket, effectKey),
          skillKey,
          levelKey: selectedLevelKey,
          bucket,
          sourceEffectKey: effectKey,
          title: skill.name || skillKey,
          idText: `${skillKey}-${selectedLevelKey}-${bucket}`,
          slot: bucket,
          level: `Lv${selectedLevelKey}`,
          effectKey,
          valueText: formatWeaponNumericValue(value),
          description: levelData.description || '-',
          searchText: `${skill.name} ${skillKey} level ${selectedLevelKey} ${bucket} ${effectKey} ${value} ${levelData.description}`.toLowerCase(),
        });
      });
    });
  });

  return rows;
}

function columnIndexToLabel(index: number) {
  let current = index + 1;
  let label = '';
  while (current > 0) {
    const remainder = (current - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    current = Math.floor((current - 1) / 26);
  }
  return label;
}

function buildWeaponWorkbookRows(rows: WeaponSheetRow[], columns: WeaponSheetColumn[]): WeaponWorkbookRow[] {
  return rows.map((row, rowIndex) => ({
    key: row.key,
    rowNumber: rowIndex + 1,
    kind: row.kind,
    sourceRow: row,
    cells: columns.map((column, columnIndex) => {
      const cellValue = (() => {
        switch (column.key) {
          case 'name':
            return row.title;
          case 'idText':
            return row.idText;
          case 'slot':
            return row.slot;
          case 'level':
            return row.level;
          case 'effectKey':
            return row.effectKey;
          case 'valueText':
            return row.valueText;
          case 'description':
            return row.description;
          default:
            return '';
        }
      })();
      return {
        key: `${row.key}-${column.key}`,
        address: `${columnIndexToLabel(columnIndex)}${rowIndex + 1}`,
        value: cellValue,
        columnKey: column.key,
        width: column.width,
        align: column.align ?? 'left',
        sourceRowKey: row.key,
      };
    }),
  }));
}

function filterRows(rows: WeaponSheetRow[], keyword: string) {
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (!normalizedKeyword) {
    return rows;
  }
  return rows.filter((row) => row.searchText.includes(normalizedKeyword));
}

function renderWeaponSheetMenuIcon(icon: 'new' | 'save' | 'delete' | 'import' | 'export' | 'shield') {
  switch (icon) {
    case 'new':
      return <path d="M8 3.25v9.5M3.25 8h9.5" />;
    case 'save':
      return (
        <>
          <path d="M3.25 2.75h7.5l2.25 2.25v8.25H3.25z" />
          <path d="M5.25 2.75v3.5h4.5v-3.5M5.25 10.25h5.5" />
        </>
      );
    case 'delete':
      return (
        <>
          <path d="M4.25 5.25h7.5" />
          <path d="M6.25 2.75h3.5" />
          <path d="M5.25 5.25v6.5M8 5.25v6.5M10.75 5.25v6.5" />
          <path d="M4.75 5.25l.5 7h5.5l.5-7" />
        </>
      );
    case 'import':
      return (
        <>
          <path d="M8 3.25v6.5" />
          <path d="M5.5 7.25L8 9.75l2.5-2.5" />
          <path d="M3.5 12.25h9" />
        </>
      );
    case 'export':
      return (
        <>
          <path d="M8 9.75v-6.5" />
          <path d="M5.5 5.75L8 3.25l2.5 2.5" />
          <path d="M3.5 12.25h9" />
        </>
      );
    case 'shield':
      return (
        <>
          <path d="M8 2.5l4 1.5v3.25c0 2.5-1.5 4.75-4 6.25-2.5-1.5-4-3.75-4-6.25V4z" />
          <path d="M6.25 8.25L7.4 9.4l2.35-2.55" />
        </>
      );
    default:
      return null;
  }
}

function updateRecordKey<T>(record: Record<string, T>, sourceKey: string, nextKey: string) {
  if (sourceKey === nextKey || !record[sourceKey]) {
    return record;
  }
  const nextRecord: Record<string, T> = {};
  Object.entries(record).forEach(([key, value]) => {
    nextRecord[key === sourceKey ? nextKey : key] = value;
  });
  return nextRecord;
}

function getWeaponWorkbookRowClassName(row: WeaponWorkbookRow) {
  if (row.kind === 'weapon') {
    return 'damage-sheet-excel-row is-button weapon-sheet-row-weapon';
  }
  if (row.kind === 'skill') {
    return 'damage-sheet-excel-row is-character weapon-sheet-row-skill';
  }
  if (row.kind === 'level') {
    return 'damage-sheet-excel-row is-data weapon-sheet-row-level';
  }
  return 'damage-sheet-excel-row is-data weapon-sheet-row-effect';
}

export { isWeaponSheetPath };

export function WeaponDraftSheetPage() {
  const [draft, setDraft] = useState<WeaponDraft>(() => loadDraftFromStorage());
  const [localLibrary, setLocalLibrary] = useState<Record<string, WeaponDraft>>(() => loadLocalWeaponLibrary());
  const [selectedLocalDraftId, setSelectedLocalDraftId] = useState('');
  const [selectedLevelBySkill, setSelectedLevelBySkill] = useState<Record<WeaponSkillKey, string>>({
    skill1: '1',
    skill2: '1',
    skill3: '1',
  });
  const [filterKeyword, setFilterKeyword] = useState('');
  const [formulaInput, setFormulaInput] = useState('');
  const [selectedWorkbookCell, setSelectedWorkbookCell] = useState<WeaponWorkbookSelection | null>(null);
  const [pendingFocusRowKey, setPendingFocusRowKey] = useState<string | null>(null);
  const [collapsedSkills, setCollapsedSkills] = useState<Record<WeaponSkillKey, boolean>>({
    skill1: false,
    skill2: false,
    skill3: false,
  });
  const [collapsedLevels, setCollapsedLevels] = useState<Record<string, boolean>>({});
  const [isOverwriteProtectionEnabled, setIsOverwriteProtectionEnabled] = useState(true);
  const [isOverwriteDraftModalOpen, setIsOverwriteDraftModalOpen] = useState(false);
  const [shareImportError, setShareImportError] = useState('');
  const [shareDraftName, setShareDraftName] = useState('');
  const [pendingImportShare, setPendingImportShare] = useState<DraftLibraryShareFile<WeaponDraft> | null>(null);
  const shareImportInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!selectedLocalDraftId && draft.id && localLibrary[draft.id]) {
      setSelectedLocalDraftId(draft.id);
    }
  }, [draft.id, localLibrary, selectedLocalDraftId]);

  useEffect(() => {
    setSelectedLevelBySkill((prev) => ({
      skill1: draft.skills.skill1.levels[prev.skill1] ? prev.skill1 : '1',
      skill2: draft.skills.skill2.levels[prev.skill2] ? prev.skill2 : '1',
      skill3: draft.skills.skill3.levels[prev.skill3] ? prev.skill3 : '1',
    }));
  }, [draft]);

  const columns = useMemo(() => buildWeaponSheetColumns(), []);
  const rows = useMemo(() => buildWeaponSheetRows(draft, selectedLevelBySkill), [draft, selectedLevelBySkill]);
  const visibleRows = useMemo(() => {
    const structuralRows = rows.filter((row) => {
      if (row.kind === 'level' && collapsedSkills[row.skillKey]) {
        return false;
      }
      if (row.kind === 'effect' && (collapsedSkills[row.skillKey] || collapsedLevels[`${row.skillKey}:${row.levelKey}`])) {
        return false;
      }
      return true;
    });
    return filterRows(structuralRows, filterKeyword);
  }, [collapsedLevels, collapsedSkills, filterKeyword, rows]);
  const workbookRows = useMemo(() => buildWeaponWorkbookRows(visibleRows, columns), [columns, visibleRows]);
  const selectedWorkbookSummary = selectedWorkbookCell?.sourceRowKey
    ? visibleRows.find((row) => row.key === selectedWorkbookCell.sourceRowKey) ?? null
    : null;
  const selectedSummaryKey = selectedWorkbookSummary?.key ?? '';

  const formulaBinding = useMemo<FormulaBinding | null>(() => {
    if (!selectedWorkbookSummary) {
      return null;
    }

    if (selectedWorkbookSummary.kind === 'weapon') {
      if (selectedWorkbookCell?.columnKey === 'idText') {
        return {
          key: 'weapon:id',
          focusId: 'weapon-id',
          inputMode: 'text',
          value: draft.id,
          placeholder: '武器 ID',
          apply: (baseDraft, rawInput) => ({ ...baseDraft, id: rawInput.trim() || baseDraft.id }),
        };
      }
      if (selectedWorkbookCell?.columnKey === 'effectKey') {
        return {
          key: 'weapon:type',
          focusId: 'weapon-type',
          inputMode: 'text',
          value: draft.type,
          placeholder: '武器类型',
          apply: (baseDraft, rawInput) => ({ ...baseDraft, type: rawInput }),
        };
      }
      if (selectedWorkbookCell?.columnKey === 'valueText') {
        return {
          key: 'weapon:rarity',
          focusId: 'weapon-rarity',
          inputMode: 'number',
          value: String(draft.rarity),
          placeholder: '稀有度',
          apply: (baseDraft, rawInput) => {
            const parsed = Number(rawInput);
            return { ...baseDraft, rarity: Number.isFinite(parsed) ? parsed : baseDraft.rarity };
          },
        };
      }
      if (selectedWorkbookCell?.columnKey === 'description') {
        return {
          key: 'weapon:description',
          focusId: 'weapon-description',
          inputMode: 'text',
          value: draft.description,
          placeholder: '武器描述',
          apply: (baseDraft, rawInput) => ({ ...baseDraft, description: rawInput }),
        };
      }
      return {
        key: 'weapon:name',
        focusId: 'weapon-name',
        inputMode: 'text',
        value: draft.name,
        placeholder: '武器名称',
        apply: (baseDraft, rawInput) => ({
          ...baseDraft,
          name: rawInput,
          id: buildWeaponIdFromName(rawInput) || baseDraft.id,
        }),
      };
    }

    if (selectedWorkbookSummary.kind === 'skill') {
      const targetSkill = draft.skills[selectedWorkbookSummary.skillKey];
      if (selectedWorkbookCell?.columnKey === 'slot') {
        return {
          key: `${selectedWorkbookSummary.skillKey}:statType`,
          focusId: 'skill-stat-type',
          inputMode: 'text',
          value: targetSkill.statType,
          placeholder: 'skill statType',
          apply: (baseDraft, rawInput) => ({
            ...baseDraft,
            skills: {
              ...baseDraft.skills,
              [selectedWorkbookSummary.skillKey]: {
                ...baseDraft.skills[selectedWorkbookSummary.skillKey],
                statType: rawInput,
              },
            },
          }),
        };
      }
      return {
        key: `${selectedWorkbookSummary.skillKey}:name`,
        focusId: 'skill-name',
        inputMode: 'text',
        value: targetSkill.name,
        placeholder: 'skill 名称',
        apply: (baseDraft, rawInput) => ({
          ...baseDraft,
          skills: {
            ...baseDraft.skills,
            [selectedWorkbookSummary.skillKey]: {
              ...baseDraft.skills[selectedWorkbookSummary.skillKey],
              name: rawInput,
            },
          },
        }),
      };
    }

    if (selectedWorkbookSummary.kind === 'level') {
      const targetLevel = draft.skills[selectedWorkbookSummary.skillKey].levels[selectedWorkbookSummary.levelKey];
      if (selectedWorkbookCell?.columnKey === 'name') {
        return {
          key: `${selectedWorkbookSummary.skillKey}:${selectedWorkbookSummary.levelKey}:name`,
          focusId: 'level-name',
          inputMode: 'text',
          readOnly: true,
          value: 'Level',
          placeholder: 'Level',
          apply: (baseDraft) => baseDraft,
        };
      }
      if (selectedWorkbookCell?.columnKey === 'idText') {
        return {
          key: `${selectedWorkbookSummary.skillKey}:${selectedWorkbookSummary.levelKey}:id`,
          focusId: 'level-id',
          inputMode: 'text',
          readOnly: true,
          value: `${selectedWorkbookSummary.skillKey}-level`,
          placeholder: 'Level ID',
          apply: (baseDraft) => baseDraft,
        };
      }
      if (selectedWorkbookCell?.columnKey === 'slot') {
        return {
          key: `${selectedWorkbookSummary.skillKey}:${selectedWorkbookSummary.levelKey}:slot`,
          focusId: 'level-slot',
          inputMode: 'text',
          readOnly: true,
          value: draft.skills[selectedWorkbookSummary.skillKey].name,
          placeholder: '所属 skill',
          apply: (baseDraft) => baseDraft,
        };
      }
      if (selectedWorkbookCell?.columnKey === 'level') {
        return {
          key: `${selectedWorkbookSummary.skillKey}:level-picker`,
          focusId: 'level-picker',
          inputMode: 'text',
          control: 'select',
          value: selectedWorkbookSummary.levelKey,
          placeholder: '',
          options: LEVEL_KEYS.map((levelKey) => ({ value: levelKey, label: `Lv${levelKey}` })),
          onValueChange: (nextLevelKey) => handleSelectedLevelChange(
            selectedWorkbookSummary.skillKey,
            nextLevelKey,
            selectedWorkbookCell?.address ?? '',
            selectedWorkbookCell?.columnKey ?? 'level',
          ),
          apply: (baseDraft) => baseDraft,
        };
      }
      if (selectedWorkbookCell?.columnKey === 'effectKey') {
        return {
          key: `${selectedWorkbookSummary.skillKey}:${selectedWorkbookSummary.levelKey}:effect-count`,
          focusId: 'level-effect-count',
          inputMode: 'text',
          readOnly: true,
          value: selectedWorkbookSummary.effectKey,
          placeholder: '效果数量',
          apply: (baseDraft) => baseDraft,
        };
      }
      if (selectedWorkbookCell?.columnKey === 'valueText') {
        return {
          key: `${selectedWorkbookSummary.skillKey}:${selectedWorkbookSummary.levelKey}:value`,
          focusId: 'level-value',
          inputMode: 'number',
          value: typeof targetLevel.value === 'number' ? String(targetLevel.value) : '',
          placeholder: 'level 主数值',
          apply: (baseDraft, rawInput) => {
            const parsed = Number(rawInput);
            const nextValue = Number.isFinite(parsed) ? parsed : undefined;
            return {
              ...baseDraft,
              skills: {
                ...baseDraft.skills,
                [selectedWorkbookSummary.skillKey]: {
                  ...baseDraft.skills[selectedWorkbookSummary.skillKey],
                  levels: {
                    ...baseDraft.skills[selectedWorkbookSummary.skillKey].levels,
                    [selectedWorkbookSummary.levelKey]: {
                      ...baseDraft.skills[selectedWorkbookSummary.skillKey].levels[selectedWorkbookSummary.levelKey],
                      value: nextValue,
                    },
                  },
                },
              },
            };
          },
        };
      }
      return {
        key: `${selectedWorkbookSummary.skillKey}:${selectedWorkbookSummary.levelKey}:description`,
        focusId: 'level-description',
        inputMode: 'text',
        value: targetLevel.description,
        placeholder: 'level 描述',
        apply: (baseDraft, rawInput) => ({
          ...baseDraft,
          skills: {
            ...baseDraft.skills,
            [selectedWorkbookSummary.skillKey]: {
              ...baseDraft.skills[selectedWorkbookSummary.skillKey],
              levels: {
                ...baseDraft.skills[selectedWorkbookSummary.skillKey].levels,
                [selectedWorkbookSummary.levelKey]: {
                  ...baseDraft.skills[selectedWorkbookSummary.skillKey].levels[selectedWorkbookSummary.levelKey],
                  description: rawInput,
                },
              },
            },
          },
        }),
      };
    }

    if (selectedWorkbookSummary.kind === 'effect') {
      const { skillKey, levelKey, bucket, sourceEffectKey } = selectedWorkbookSummary;
      const level = draft.skills[skillKey].levels[levelKey];
      const bucketValue = bucket === 'value'
        ? level.value
        : level[bucket][sourceEffectKey];

      if (
        selectedWorkbookCell?.columnKey === 'name'
        || selectedWorkbookCell?.columnKey === 'idText'
        || selectedWorkbookCell?.columnKey === 'slot'
      ) {
        if (selectedWorkbookCell?.columnKey === 'name') {
          return {
            key: `${skillKey}:effect-name`,
            focusId: 'effect-name',
            inputMode: 'text',
            value: draft.skills[skillKey].name,
            placeholder: 'skill 名称',
            apply: (baseDraft, rawInput) => ({
              ...baseDraft,
              skills: {
                ...baseDraft.skills,
                [skillKey]: {
                  ...baseDraft.skills[skillKey],
                  name: rawInput,
                },
              },
            }),
          };
        }
        return {
          key: `${skillKey}:${levelKey}:${bucket}:${sourceEffectKey}:${selectedWorkbookCell?.columnKey}`,
          focusId: `effect-${selectedWorkbookCell?.columnKey}`,
          inputMode: 'text',
          readOnly: true,
          value:
            selectedWorkbookCell?.columnKey === 'idText'
                ? selectedWorkbookSummary.idText
                : selectedWorkbookCell?.columnKey === 'slot'
                  ? selectedWorkbookSummary.slot
                  : '',
          placeholder: '',
          apply: (baseDraft) => baseDraft,
        };
      }

      if (selectedWorkbookCell?.columnKey === 'level') {
        return {
          key: `${skillKey}:effect-level-picker`,
          focusId: 'effect-level-picker',
          inputMode: 'text',
          control: 'select',
          value: levelKey,
          placeholder: '',
          options: LEVEL_KEYS.map((nextLevelKey) => ({ value: nextLevelKey, label: `Lv${nextLevelKey}` })),
          onValueChange: (nextLevelKey) => handleSelectedLevelChange(
            skillKey,
            nextLevelKey,
            selectedWorkbookCell?.address ?? '',
            selectedWorkbookCell?.columnKey ?? 'level',
          ),
          apply: (baseDraft) => baseDraft,
        };
      }

      if (selectedWorkbookCell?.columnKey === 'effectKey') {
        if (bucket === 'value') {
          return {
            key: `${skillKey}:${levelKey}:value:key`,
            focusId: 'effect-key',
            inputMode: 'text',
            readOnly: true,
            value: 'value',
            placeholder: '',
            apply: (baseDraft) => baseDraft,
          };
        }
        return {
          key: `${skillKey}:${levelKey}:${bucket}:${sourceEffectKey}:key`,
          focusId: 'effect-key',
          inputMode: 'text',
          value: sourceEffectKey,
          placeholder: '效果键',
          apply: (baseDraft, rawInput) => {
            const trimmed = rawInput.trim();
            if (!trimmed || trimmed === sourceEffectKey) {
              return baseDraft;
            }
            const nextLevel = baseDraft.skills[skillKey].levels[levelKey];
            return {
              ...baseDraft,
              skills: {
                ...baseDraft.skills,
                [skillKey]: {
                  ...baseDraft.skills[skillKey],
                  levels: {
                    ...baseDraft.skills[skillKey].levels,
                    [levelKey]: {
                      ...nextLevel,
                      [bucket]: updateRecordKey(nextLevel[bucket], sourceEffectKey, trimmed),
                    },
                  },
                },
              },
            };
          },
        };
      }

      if (selectedWorkbookCell?.columnKey === 'description') {
        return {
          key: `${skillKey}:${levelKey}:${bucket}:${sourceEffectKey}:description`,
          focusId: 'effect-description',
          inputMode: 'text',
          value: level.description,
          placeholder: '效果描述',
          apply: (baseDraft, rawInput) => ({
            ...baseDraft,
            skills: {
              ...baseDraft.skills,
              [skillKey]: {
                ...baseDraft.skills[skillKey],
                levels: {
                  ...baseDraft.skills[skillKey].levels,
                  [levelKey]: {
                    ...baseDraft.skills[skillKey].levels[levelKey],
                    description: rawInput,
                  },
                },
              },
            },
          }),
        };
      }

      return {
        key: `${skillKey}:${levelKey}:${bucket}:${sourceEffectKey}:value`,
        focusId: 'effect-value',
        inputMode: 'number',
        value: typeof bucketValue === 'number' ? String(bucketValue) : '',
        placeholder: '效果数值',
        apply: (baseDraft, rawInput) => {
          const parsed = Number(rawInput);
          if (!Number.isFinite(parsed)) {
            return baseDraft;
          }
          const nextLevel = baseDraft.skills[skillKey].levels[levelKey];
          if (bucket === 'value') {
            return {
              ...baseDraft,
              skills: {
                ...baseDraft.skills,
                [skillKey]: {
                  ...baseDraft.skills[skillKey],
                  levels: {
                    ...baseDraft.skills[skillKey].levels,
                    [levelKey]: {
                      ...nextLevel,
                      value: parsed,
                    },
                  },
                },
              },
            };
          }
          return {
            ...baseDraft,
            skills: {
              ...baseDraft.skills,
              [skillKey]: {
                ...baseDraft.skills[skillKey],
                levels: {
                  ...baseDraft.skills[skillKey].levels,
                  [levelKey]: {
                    ...nextLevel,
                    [bucket]: {
                      ...nextLevel[bucket],
                      [sourceEffectKey]: parsed,
                    },
                  },
                },
              },
            },
          };
        },
      };
    }

    return null;
  }, [draft, selectedWorkbookCell?.columnKey, selectedWorkbookSummary]);

  useEffect(() => {
    setFormulaInput(formulaBinding?.value ?? '');
  }, [formulaBinding?.key, formulaBinding?.value]);

  useEffect(() => {
    const firstDataRow = workbookRows[0];
    if (!firstDataRow) {
      setSelectedWorkbookCell(null);
      return;
    }
    if (pendingFocusRowKey) {
      const targetRow = workbookRows.find((row) => row.sourceRow.key === pendingFocusRowKey);
      if (targetRow) {
        const targetCell = targetRow.cells[0];
        setSelectedWorkbookCell({
          address: targetCell.address,
          sourceRowKey: targetCell.sourceRowKey,
          columnKey: targetCell.columnKey,
        });
        setPendingFocusRowKey(null);
        return;
      }
    }
    if (!selectedWorkbookCell) {
      const firstCell = firstDataRow.cells[0];
      setSelectedWorkbookCell({
        address: firstCell.address,
        sourceRowKey: firstCell.sourceRowKey,
        columnKey: firstCell.columnKey,
      });
    }
  }, [pendingFocusRowKey, selectedWorkbookCell, workbookRows]);

  const commitFormulaInput = useCallback((baseDraft: WeaponDraft) => {
    if (!formulaBinding || formulaInput === formulaBinding.value) {
      return baseDraft;
    }
    return normalizeWeaponDraft(formulaBinding.apply(baseDraft, formulaInput));
  }, [formulaBinding, formulaInput]);

  const persistLibraryState = useCallback((nextLibrary: Record<string, WeaponDraft>, nextDraft: WeaponDraft, nextSelectedId: string) => {
    writeLocalStorageJson(WEAPON_LIBRARY_STORAGE_KEY, nextLibrary);
    writeLocalStorageJson(WEAPON_DRAFT_STORAGE_KEY, nextDraft);
    setLocalLibrary(nextLibrary);
    setDraft(nextDraft);
    setSelectedLocalDraftId(nextSelectedId);
  }, []);

  const persistDraftToLibrary = useCallback((allowOverwrite: boolean) => {
    const nextDraft = commitFormulaInput(draft);
    const library = loadLocalWeaponLibrary();
    const nextDraftId = nextDraft.id.trim() || buildNextCustomWeaponId(Object.keys(library));
    const sourceDraftId = selectedLocalDraftId && library[selectedLocalDraftId] ? selectedLocalDraftId : null;

    if (library[nextDraftId] && nextDraftId !== sourceDraftId && !allowOverwrite) {
      setIsOverwriteDraftModalOpen(true);
      return false;
    }

    const finalDraft = { ...nextDraft, id: nextDraftId };
    const nextLibrary = {
      ...library,
      [nextDraftId]: finalDraft,
    };

    persistLibraryState(nextLibrary, finalDraft, nextDraftId);
    setPendingFocusRowKey(`weapon-${nextDraftId}`);
    setIsOverwriteDraftModalOpen(false);
    return true;
  }, [commitFormulaInput, draft, persistLibraryState, selectedLocalDraftId]);

  const handleSaveDraft = useCallback(() => {
    persistDraftToLibrary(!isOverwriteProtectionEnabled);
  }, [isOverwriteProtectionEnabled, persistDraftToLibrary]);

  const handleConfirmOverwriteDraft = useCallback(() => {
    persistDraftToLibrary(true);
  }, [persistDraftToLibrary]);

  const handleCreateNewDraft = useCallback(() => {
    const nextDraftId = buildNextCustomWeaponId(Object.keys(localLibrary));
    const nextDraft = createEmptyWeaponDraft(nextDraftId);
    setDraft(nextDraft);
    setSelectedLocalDraftId('');
    setPendingFocusRowKey(`weapon-${nextDraft.id}`);
  }, [localLibrary]);

  const handleLoadLocalDraft = useCallback((draftId: string) => {
    const nextDraft = localLibrary[draftId];
    if (!nextDraft) {
      return;
    }
    setDraft(cloneValue(nextDraft));
    setSelectedLocalDraftId(draftId);
    setPendingFocusRowKey(`weapon-${draftId}`);
  }, [localLibrary]);

  const toggleSkillCollapsed = useCallback((skillKey: WeaponSkillKey) => {
    setCollapsedSkills((prev) => ({ ...prev, [skillKey]: !prev[skillKey] }));
  }, []);

  const toggleLevelCollapsed = useCallback((skillKey: WeaponSkillKey, levelKey: string) => {
    const collapseKey = `${skillKey}:${levelKey}`;
    setCollapsedLevels((prev) => ({ ...prev, [collapseKey]: !prev[collapseKey] }));
  }, []);

  const handleSelectedLevelChange = useCallback((skillKey: WeaponSkillKey, nextLevelKey: string, address: string, columnKey: WeaponSheetColumn['key']) => {
    setSelectedLevelBySkill((prev) => ({ ...prev, [skillKey]: nextLevelKey }));
    setSelectedWorkbookCell({
      address,
      sourceRowKey: buildWeaponLevelRowKey(skillKey),
      columnKey,
    });
  }, []);

  const handleDeleteLocalDraft = useCallback(() => {
    if (!selectedLocalDraftId || !localLibrary[selectedLocalDraftId]) {
      return;
    }
    const nextLibrary = { ...localLibrary };
    delete nextLibrary[selectedLocalDraftId];
    writeLocalStorageJson(WEAPON_LIBRARY_STORAGE_KEY, nextLibrary);
    setLocalLibrary(nextLibrary);
    setSelectedLocalDraftId('');
  }, [localLibrary, selectedLocalDraftId]);

  const currentShareFile = useMemo(() => buildDraftLibraryShareFile(
    WEAPON_LIBRARY_SHARE_TYPE,
    localLibrary,
    shareDraftName || draft.name || 'weapon-library',
  ), [draft.name, localLibrary, shareDraftName]);

  const handleExportLocalLibrary = useCallback(() => {
    const blob = new Blob([JSON.stringify(currentShareFile, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = buildDraftLibraryShareFileName(currentShareFile.label, currentShareFile.exportedAt);
    link.click();
    window.URL.revokeObjectURL(url);
  }, [currentShareFile]);

  const handleOpenShareImportPicker = useCallback(() => {
    shareImportInputRef.current?.click();
  }, []);

  const handleShareFileSelected = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const rawText = await file.text();
    const parsed = parseDraftLibraryShareFile(rawText, WEAPON_LIBRARY_SHARE_TYPE);
    if (!parsed) {
      setShareImportError('导入失败：文件不是有效的武器库分享 JSON。');
      event.target.value = '';
      return;
    }

    const normalizedPayload = Object.fromEntries(
      Object.entries(parsed.payload).map(([draftId, draftValue]) => [draftId, normalizeWeaponDraft({ ...(draftValue as RawWeaponDraft), id: draftId })]),
    ) as Record<string, WeaponDraft>;

    setPendingImportShare({
      ...parsed,
      payload: normalizedPayload,
    } as DraftLibraryShareFile<WeaponDraft>);
    setShareImportError('');
    event.target.value = '';
  }, []);

  const handleConfirmImportShare = useCallback(() => {
    if (!pendingImportShare) {
      return;
    }
    const nextLibrary = {
      ...localLibrary,
      ...pendingImportShare.payload,
    };
    const nextDraftId = Object.keys(pendingImportShare.payload)[0] ?? '';
    const nextDraft = nextDraftId && nextLibrary[nextDraftId]
      ? nextLibrary[nextDraftId]
      : draft;
    persistLibraryState(nextLibrary, nextDraft, nextDraftId || selectedLocalDraftId || draft.id);
    setPendingImportShare(null);
  }, [draft, localLibrary, pendingImportShare, persistLibraryState, selectedLocalDraftId]);

  const renderFormulaEditor = () => {
    if (!formulaBinding) {
      return <div className="damage-sheet-formula-value">{draft.description || 'Sheet-Weapon workbook'}</div>;
    }

    if (formulaBinding.control === 'select') {
      return (
        <select
          data-formula-focus-id={formulaBinding.focusId}
          className="buff-sheet-formula-input is-select"
          value={formulaBinding.value}
          onChange={(event) => {
            setFormulaInput(event.target.value);
            formulaBinding.onValueChange?.(event.target.value);
          }}
        >
          {(formulaBinding.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      );
    }

    if (formulaBinding.readOnly) {
      return (
        <input
          data-formula-focus-id={formulaBinding.focusId}
          className="buff-sheet-formula-input"
          type="text"
          value={formulaBinding.value}
          readOnly
        />
      );
    }

    return (
      <input
        data-formula-focus-id={formulaBinding.focusId}
        className="buff-sheet-formula-input"
        type={formulaBinding.inputMode === 'number' ? 'number' : 'text'}
        value={formulaInput}
        onChange={(event) => setFormulaInput(event.target.value)}
        onBlur={() => {
          const nextDraft = commitFormulaInput(draft);
          if (nextDraft !== draft) {
            setDraft(nextDraft);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            const nextDraft = commitFormulaInput(draft);
            if (nextDraft !== draft) {
              setDraft(nextDraft);
            }
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') {
            setFormulaInput(formulaBinding.value);
            event.currentTarget.blur();
          }
        }}
        placeholder={formulaBinding.placeholder}
      />
    );
  };

  const renderRowNumberContent = (row: WeaponWorkbookRow) => {
    const sourceRow = row.sourceRow;
    if (sourceRow.kind === 'skill') {
      return (
        <button
          type="button"
          className="damage-sheet-row-toggle"
          onClick={() => toggleSkillCollapsed(sourceRow.skillKey)}
        >
          {collapsedSkills[sourceRow.skillKey] ? '[+]' : '[-]'}
        </button>
      );
    }

    if (sourceRow.kind === 'level') {
      return (
        <button
          type="button"
          className="damage-sheet-row-toggle"
          onClick={() => toggleLevelCollapsed(sourceRow.skillKey, sourceRow.levelKey)}
        >
          {collapsedLevels[`${sourceRow.skillKey}:${sourceRow.levelKey}`] ? '[+]' : '[-]'}
        </button>
      );
    }

    return row.rowNumber;
  };

  return (
    <main className="damage-sheet-page buff-sheet-page weapon-sheet-page">
      <header className="damage-sheet-topbar">
        <div className="damage-sheet-topbar-left">
          <button type="button" className="damage-sheet-back-button" onClick={() => navigateToAppPath(APP_ROUTE_PATHS.home)}>
            返回
          </button>
          <div className="damage-sheet-title-block">
            <h1>Sheet-Weapon</h1>
            <p>武器档案工作表 · 按 weapon → skill → level → effect 编辑</p>
          </div>
        </div>
        <div className="damage-sheet-topbar-right">
          <button type="button" className="damage-sheet-action-button" onClick={() => navigateToAppPath(APP_ROUTE_PATHS.buffSheet)}>
            打开 Sheet-Buff
          </button>
        </div>
      </header>

      <section className="damage-sheet-ribbon buff-sheet-ribbon">
        <div className="buff-sheet-ribbon-actions">
          <button type="button" className="buff-sheet-tool-button" onClick={handleCreateNewDraft}>
            <span className="buff-sheet-tool-icon" aria-hidden="true">
              <svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false">
                {renderWeaponSheetMenuIcon('new')}
              </svg>
            </span>
            <span className="buff-sheet-tool-text">新建</span>
          </button>
          <button type="button" className="buff-sheet-tool-button" onClick={handleSaveDraft}>
            <span className="buff-sheet-tool-icon" aria-hidden="true">
              <svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false">
                {renderWeaponSheetMenuIcon('save')}
              </svg>
            </span>
            <span className="buff-sheet-tool-text">保存</span>
          </button>
          <button
            type="button"
            className={`buff-sheet-tool-button${isOverwriteProtectionEnabled ? ' is-active' : ''}`}
            onClick={() => setIsOverwriteProtectionEnabled((prev) => !prev)}
          >
            <span className="buff-sheet-tool-icon" aria-hidden="true">
              <svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false">
                {renderWeaponSheetMenuIcon('shield')}
              </svg>
            </span>
            <span className="buff-sheet-tool-text">{isOverwriteProtectionEnabled ? '保护开' : '保护关'}</span>
          </button>
          <button type="button" className="buff-sheet-tool-button" onClick={handleExportLocalLibrary}>
            <span className="buff-sheet-tool-icon" aria-hidden="true">
              <svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false">
                {renderWeaponSheetMenuIcon('export')}
              </svg>
            </span>
            <span className="buff-sheet-tool-text">导出</span>
          </button>
          <button type="button" className="buff-sheet-tool-button" onClick={handleOpenShareImportPicker}>
            <span className="buff-sheet-tool-icon" aria-hidden="true">
              <svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false">
                {renderWeaponSheetMenuIcon('import')}
              </svg>
            </span>
            <span className="buff-sheet-tool-text">导入</span>
          </button>
          <button type="button" className="buff-sheet-tool-button" onClick={handleDeleteLocalDraft} disabled={!selectedLocalDraftId}>
            <span className="buff-sheet-tool-icon" aria-hidden="true">
              <svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false">
                {renderWeaponSheetMenuIcon('delete')}
              </svg>
            </span>
            <span className="buff-sheet-tool-text">删除</span>
          </button>
        </div>
        
        <div className="damage-sheet-formula-bar">
          <span className="damage-sheet-formula-address">{selectedWorkbookCell?.address ?? '-'}</span>
          <span className="damage-sheet-formula-label">fx</span>
          {renderFormulaEditor()}
        </div>
      </section>

      <main className="damage-sheet-workspace">
        <aside className="damage-sheet-sidebar buff-sheet-explorer">
          <div className="damage-sheet-sidebar-title">本地武器库</div>
          <input
            className="buff-sheet-search-input"
            value={filterKeyword}
            onChange={(event) => setFilterKeyword(event.target.value)}
            placeholder="搜索武器 / skill / effect"
          />
          <input
            ref={shareImportInputRef}
            type="file"
            accept=".json,application/json"
            className="operator-draft-file-input"
            onChange={handleShareFileSelected}
          />
          <div className="weapon-sheet-explorer-section">
            <div className="weapon-sheet-explorer-subtitle">当前草稿</div>
            <div className="buff-sheet-explorer-tree">
              <div className="buff-sheet-explorer-node">
                <button
                  type="button"
                  className={`buff-sheet-explorer-row${selectedSummaryKey === `weapon-${draft.id}` ? ' is-active' : ''}`}
                  onClick={() => setPendingFocusRowKey(`weapon-${draft.id}`)}
                >
                  <span className="buff-sheet-explorer-label">{draft.name}</span>
                </button>
                <div className="buff-sheet-explorer-children">
                {SKILL_KEYS.map((skillKey) => (
                  <div key={skillKey} className="buff-sheet-explorer-node">
                    <button
                      type="button"
                      className={`buff-sheet-explorer-child${selectedSummaryKey === `skill-${skillKey}` ? ' is-active' : ''}`}
                      onClick={() => setPendingFocusRowKey(`skill-${skillKey}`)}
                    >
                      <span
                        className="damage-sheet-row-toggle buff-sheet-explorer-toggle"
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleSkillCollapsed(skillKey);
                        }}
                      >
                        {collapsedSkills[skillKey] ? '[+]' : '[-]'}
                      </span>
                      <span className="buff-sheet-explorer-label">{draft.skills[skillKey].name || skillKey}</span>
                    </button>
                    {!collapsedSkills[skillKey] ? (
                    <div className="buff-sheet-explorer-children buff-sheet-explorer-effects">
                      <button
                        type="button"
                        className={`buff-sheet-explorer-effect${selectedSummaryKey === buildWeaponLevelRowKey(skillKey) ? ' is-active' : ''}`}
                        onClick={() => setPendingFocusRowKey(buildWeaponLevelRowKey(skillKey))}
                      >
                        <span
                          className="damage-sheet-row-toggle buff-sheet-explorer-toggle"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleLevelCollapsed(skillKey, selectedLevelBySkill[skillKey]);
                          }}
                        >
                          {collapsedLevels[`${skillKey}:${selectedLevelBySkill[skillKey]}`] ? '[+]' : '[-]'}
                        </span>
                        <span className="buff-sheet-explorer-bullet">·</span>
                        <span className="buff-sheet-explorer-label">Level</span>
                        <span className="buff-sheet-explorer-count">{`Lv${selectedLevelBySkill[skillKey]}`}</span>
                      </button>
                      {!collapsedLevels[`${skillKey}:${selectedLevelBySkill[skillKey]}`] ? (
                        <div className="buff-sheet-explorer-children buff-sheet-explorer-effects">
                          {visibleRows
                            .filter((row): row is Extract<WeaponSheetRow, { kind: 'effect' }> => row.kind === 'effect')
                            .filter((row) => row.skillKey === skillKey)
                            .map((row) => (
                              <button
                                key={row.key}
                                type="button"
                                className={`buff-sheet-explorer-effect${selectedSummaryKey === row.key ? ' is-active' : ''}`}
                                onClick={() => setPendingFocusRowKey(row.key)}
                              >
                                <span className="buff-sheet-explorer-bullet">·</span>
                                <span className="buff-sheet-explorer-label">{row.effectKey}</span>
                              </button>
                            ))}
                        </div>
                      ) : null}
                    </div>
                    ) : null}
                  </div>
                ))}
              </div>
              </div>
            </div>
          </div>

          <div className="weapon-sheet-explorer-section">
            <div className="weapon-sheet-explorer-subtitle">已保存本地库</div>
            <div className="buff-sheet-explorer-tree">
              {Object.values(localLibrary).length === 0 ? (
                <div className="damage-sheet-detail-empty">当前还没有本地保存的武器。</div>
              ) : (
                Object.values(localLibrary)
                  .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'))
                  .map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      className={`buff-sheet-explorer-row${selectedLocalDraftId === entry.id ? ' is-active' : ''}`}
                      onClick={() => handleLoadLocalDraft(entry.id)}
                    >
                      <span className="buff-sheet-explorer-label">{entry.name}</span>
                    </button>
                  ))
              )}
            </div>
          </div>

          {shareImportError ? <div className="buff-sheet-share-feedback is-error">{shareImportError}</div> : null}
        </aside>

        <section className="damage-sheet-excel-shell">
          <div className="damage-sheet-excel-scroll">
            <div className="damage-sheet-excel-row is-header">
              <div className="damage-sheet-excel-row-number">#</div>
              <div className="damage-sheet-excel-row-cells">
                {columns.map((column) => (
                  <div
                    key={column.key}
                    className={`damage-sheet-excel-cell is-header is-${column.align ?? 'left'}`}
                    style={{ width: `${column.width}px` }}
                  >
                    {column.title}
                  </div>
                ))}
              </div>
            </div>
            {workbookRows.map((row) => (
              <div
                key={row.key}
                className={getWeaponWorkbookRowClassName(row)}
              >
                <div className="damage-sheet-excel-row-number">{renderRowNumberContent(row)}</div>
                <div className="damage-sheet-excel-row-cells">
                  {row.cells.map((cell) => (
                    <div
                      key={cell.key}
                      className={`damage-sheet-excel-cell is-${row.kind} is-${cell.align}${selectedWorkbookCell?.address === cell.address ? ' is-active' : ''}`}
                      style={{ width: `${cell.width}px` }}
                      onClick={() => setSelectedWorkbookCell({
                        address: cell.address,
                        sourceRowKey: cell.sourceRowKey,
                        columnKey: cell.columnKey,
                      })}
                    >
                      {row.sourceRow.kind === 'level' && cell.columnKey === 'level' ? (() => {
                        const sourceRow = row.sourceRow;
                        return (
                          <select
                            className="buff-sheet-formula-input is-select weapon-sheet-inline-select"
                            value={sourceRow.levelKey}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => {
                              event.stopPropagation();
                              handleSelectedLevelChange(sourceRow.skillKey, event.target.value, cell.address, cell.columnKey);
                            }}
                          >
                            {LEVEL_KEYS.map((levelKey) => (
                              <option key={levelKey} value={levelKey}>{`Lv${levelKey}`}</option>
                            ))}
                          </select>
                        );
                      })() : (
                        cell.value
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      {isOverwriteDraftModalOpen ? (
        <div className="operator-draft-modal-overlay" onClick={() => setIsOverwriteDraftModalOpen(false)}>
          <div className="operator-draft-modal operator-draft-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <div className="operator-draft-section-header">
              <div>
                <h3>确认覆盖本地武器</h3>
                <p>当前 ID 已存在于本地武器库中。</p>
              </div>
            </div>
            <div className="operator-draft-confirm-body">
              <strong>{draft.name || draft.id || '未命名武器'}</strong>
              <p>保护开启时，确认后会用当前 Sheet-Weapon 编辑内容覆盖同 ID 武器。</p>
            </div>
            <div className="operator-draft-modal-actions">
              <button type="button" className="operator-draft-ghost-button" onClick={() => setIsOverwriteDraftModalOpen(false)}>
                取消
              </button>
              <button type="button" className="operator-draft-copy-button operator-draft-danger-button" onClick={handleConfirmOverwriteDraft}>
                确认覆盖
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingImportShare ? (
        <div className="operator-draft-modal-overlay" onClick={() => setPendingImportShare(null)}>
          <div className="operator-draft-modal operator-draft-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <div className="operator-draft-section-header">
              <div>
                <h3>确认导入武器库</h3>
                <p>会把分享文件中的武器合并进当前本地库。</p>
              </div>
            </div>
            <div className="operator-draft-confirm-body">
              <strong>{pendingImportShare.label}</strong>
              <p>{`将导入 ${Object.keys(pendingImportShare.payload).length} 把武器。`}</p>
            </div>
            <div className="operator-draft-modal-actions">
              <button type="button" className="operator-draft-ghost-button" onClick={() => setPendingImportShare(null)}>
                取消
              </button>
              <button type="button" className="operator-draft-copy-button" onClick={handleConfirmImportShare}>
                确认导入
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
