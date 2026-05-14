import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { pinyin } from 'pinyin-pro';
import './OperatorDraftPage.css';
import assetPathsRaw from '../../asset-paths.txt?raw';
import { loadReferenceOperatorDraft, loadReferenceOperatorNames } from './operatorDraftReference';
import { buildWeaponSearchIndex, searchWeapons } from '../utils/weaponFuzzySearch';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../utils/appRoute';
import {
  buildDraftLibraryShareFile,
  buildDraftLibraryShareFileName,
  parseDraftLibraryShareFile,
  type DraftLibraryShareFile,
} from '../utils/draftShare';
import { normalizeAssetUrl } from '../utils/assetResolver';

const DRAFT_PAGE_PATH = APP_ROUTE_PATHS.draft;
const DRAFT_STORAGE_KEY = 'def.operator-editor.draft.v1';
const LIBRARY_STORAGE_KEY = 'def.operator-editor.library.v1';
const OPERATOR_LIBRARY_SHARE_TYPE = 'operator-library-share.v1';
const RARITY_OPTIONS = [4, 5, 6] as const;
const PROFESSION_OPTIONS = ['突击', '重装', '近卫', '辅助', '先锋', '术师'] as const;
const WEAPON_OPTIONS = ['手铳', '双手剑', '长柄武器', '法术单元', '单手剑'] as const;
const ABILITY_OPTIONS = ['力量', '敏捷', '智识', '意志'] as const;
const ELEMENT_OPTIONS = ['physical', 'fire', 'ice', 'electric', 'nature'] as const;
const ASSET_PATH_OPTIONS = assetPathsRaw
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);
const AVATAR_ASSET_OPTIONS = ASSET_PATH_OPTIONS.filter((path) => /\/assets\/avatars\/[^/]+\/[^/]+\.png$/i.test(path) && !/连携技|战技|终结技|icon_/i.test(path));

type HitSkillType = 'A' | 'B' | 'E' | 'Q';
type HitElement = 'physical' | 'fire' | 'ice' | 'electric' | 'nature';

interface HitMetaDraft {
  multiplier: number;
  displayName: string;
  element: HitElement;
  skillType: HitSkillType;
}

interface SkillDraft {
  displayName: string;
  buttonType: HitSkillType;
  iconUrl: string;
  hitCount: number;
  hitMeta: Record<string, HitMetaDraft>;
}

interface OperatorDraft {
  id: string;
  name: string;
  avatarUrl: string;
  rarity: number;
  profession: string;
  weapon: string;
  element: string;
  mainStat: string;
  subStat: string;
  level: number;
  attributes: {
    strength: number;
    agility: number;
    intelligence: number;
    will: number;
    atk: number;
    hp: number;
  };
  skills: Record<string, SkillDraft>;
}

function getSkillIndexFromKey(skillKey: string) {
  const matched = skillKey.match(/(\d+)$/);
  return matched ? Number(matched[1]) : 1;
}

function getHitIndexFromKey(hitKey: string) {
  const matched = hitKey.match(/(\d+)$/);
  return matched ? Number(matched[1]) : 1;
}

function createDefaultHit(hitKey = 'hit1'): HitMetaDraft {
  const hitIndex = getHitIndexFromKey(hitKey);
  return {
    multiplier: 0,
    displayName: `第${hitIndex}击`,
    element: 'physical',
    skillType: 'A',
  };
}

function createDefaultSkill(buttonType: HitSkillType = 'A', skillKey = 'skill-1'): SkillDraft {
  const skillIndex = getSkillIndexFromKey(skillKey);
  return {
    displayName: `新技能${skillIndex}`,
    buttonType,
    iconUrl: '',
    hitCount: 1,
    hitMeta: {
      hit1: createDefaultHit('hit1'),
    },
  };
}

function createDefaultDraft(): OperatorDraft {
  return {
    id: 'custom-operator-001',
    name: '新干员',
    avatarUrl: '',
    rarity: 6,
    profession: '',
    weapon: '',
    element: 'physical',
    mainStat: '',
    subStat: '',
    level: 90,
    attributes: {
      strength: 0,
      agility: 0,
      intelligence: 0,
      will: 0,
      atk: 0,
      hp: 0,
    },
    skills: {
      'skill-1': createDefaultSkill('A', 'skill-1'),
    },
  };
}

function createEmptyDraft(nextId = 'custom-operator-001'): OperatorDraft {
  return {
    ...createDefaultDraft(),
    id: nextId,
    name: '新建干员',
    skills: {},
  };
}

function buildOperatorIdFromName(name: string) {
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

function isDraftPath(pathname: string) {
  return pathname === DRAFT_PAGE_PATH;
}

function cloneDraft<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function syncHitCount(skill: SkillDraft) {
  skill.hitCount = Object.keys(skill.hitMeta).length;
}

function normalizeDraft(value: OperatorDraft) {
  Object.entries(value.skills).forEach(([skillKey, skill]) => {
    if (!skill.displayName?.trim()) {
      skill.displayName = createDefaultSkill(skill.buttonType, skillKey).displayName;
    }
    Object.entries(skill.hitMeta).forEach(([hitKey, hit]) => {
      if (!hit.displayName?.trim()) {
        hit.displayName = createDefaultHit(hitKey).displayName;
      }
    });
    syncHitCount(skill);
  });
  return value;
}

function parseImportedDraft(rawText: string) {
  const parsed = JSON.parse(rawText) as Partial<OperatorDraft>;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('JSON 根节点必须是对象');
  }
  if (!parsed.id || !parsed.name || !parsed.skills || typeof parsed.skills !== 'object') {
    throw new Error('JSON 缺少 id / name / skills');
  }
  return normalizeDraft(parsed as OperatorDraft);
}

function getNextSkillKey(draft: OperatorDraft) {
  let index = 1;
  while (draft.skills[`skill-${index}`]) {
    index += 1;
  }
  return `skill-${index}`;
}

function getNextDraftId(existingIds: string[]) {
  let index = 1;
  while (existingIds.includes(`custom-operator-${String(index).padStart(3, '0')}`)) {
    index += 1;
  }
  return `custom-operator-${String(index).padStart(3, '0')}`;
}

function getNextHitKey(skill: SkillDraft) {
  let index = 1;
  while (skill.hitMeta[`hit${index}`]) {
    index += 1;
  }
  return `hit${index}`;
}

function syncSkillOrderWithDraft(skillOrder: string[], draft: OperatorDraft) {
  const keys = Object.keys(draft.skills);
  const filtered = skillOrder.filter((key) => keys.includes(key));
  const missing = keys.filter((key) => !filtered.includes(key));
  return [...filtered, ...missing];
}

function moveSkillKey(skillOrder: string[], fromKey: string, toKey: string) {
  if (fromKey === toKey) {
    return skillOrder;
  }

  const nextOrder = [...skillOrder];
  const fromIndex = nextOrder.indexOf(fromKey);
  const toIndex = nextOrder.indexOf(toKey);
  if (fromIndex === -1 || toIndex === -1) {
    return skillOrder;
  }

  nextOrder.splice(fromIndex, 1);
  nextOrder.splice(toIndex, 0, fromKey);
  return nextOrder;
}

function buildOrderedDraft(draft: OperatorDraft, skillOrder: string[]) {
  const nextSkills: Record<string, SkillDraft> = {};
  const nextOrder = syncSkillOrderWithDraft(skillOrder, draft);
  nextOrder.forEach((skillKey) => {
    nextSkills[skillKey] = draft.skills[skillKey];
  });
  return {
    ...draft,
    skills: nextSkills,
  };
}

function reorderDraftStructure(draft: OperatorDraft): OperatorDraft {
  const nextSkills: Record<string, SkillDraft> = {};
  const orderedSkillKeys = Object.keys(draft.skills);
  orderedSkillKeys.forEach((skillKey, skillIndex) => {
    const nextSkillKey = `skill-${skillIndex + 1}`;
    const skill = cloneDraft(draft.skills[skillKey]);
    const nextHitMeta: Record<string, HitMetaDraft> = {};
    Object.entries(skill.hitMeta).forEach(([, hit], hitIndex) => {
      const nextHitKey = `hit${hitIndex + 1}`;
      nextHitMeta[nextHitKey] = {
        ...hit,
        displayName: hit.displayName?.trim() ? hit.displayName : createDefaultHit(nextHitKey).displayName,
      };
    });
    skill.hitMeta = nextHitMeta;
    syncHitCount(skill);
    nextSkills[nextSkillKey] = skill;
  });
  return {
    ...draft,
    skills: nextSkills,
  };
}

function loadDraftFromStorage() {
  if (typeof window === 'undefined') {
    return createDefaultDraft();
  }

  const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
  if (!raw) {
    return createDefaultDraft();
  }

  try {
    return parseImportedDraft(raw);
  } catch {
    return createDefaultDraft();
  }
}

async function copyText(text: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  }
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${keyPrefix}-b-${index}`}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={`${keyPrefix}-c-${index}`}>{part.slice(1, -1)}</code>;
    }
    return <span key={`${keyPrefix}-t-${index}`}>{part}</span>;
  });
}

function renderMiniMarkdown(markdown: string): ReactNode[] {
  const lines = markdown.split('\n');
  const nodes: ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (!listItems.length) return;
    const items = listItems;
    listItems = [];
    nodes.push(
      <ul key={`list-${nodes.length}`}>
        {items.map((item, index) => (
          <li key={`li-${index}`}>{renderInlineMarkdown(item, `list-${nodes.length}-${index}`)}</li>
        ))}
      </ul>
    );
  };

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      return;
    }

    if (line.startsWith('- ')) {
      listItems.push(line.slice(2));
      return;
    }

    flushList();

    if (line.startsWith('## ')) {
      nodes.push(<h4 key={`h4-${index}`}>{renderInlineMarkdown(line.slice(3), `h4-${index}`)}</h4>);
      return;
    }

    if (line.startsWith('# ')) {
      nodes.push(<h3 key={`h3-${index}`}>{renderInlineMarkdown(line.slice(2), `h3-${index}`)}</h3>);
      return;
    }

    nodes.push(<p key={`p-${index}`}>{renderInlineMarkdown(line, `p-${index}`)}</p>);
  });

  flushList();
  return nodes;
}

interface SearchablePathSelectProps {
  value: string;
  options: string[];
  placeholder: string;
  onChange: (value: string) => void;
}

function SearchablePathSelect({ value, options, placeholder, onChange }: SearchablePathSelectProps) {
  const [keyword, setKeyword] = useState(value);
  const [isOpen, setIsOpen] = useState(false);
  const searchIndex = useMemo(() => buildWeaponSearchIndex(options), [options]);
  const matchedOptions = useMemo(() => {
    const trimmed = keyword.trim();
    if (!trimmed) {
      return options.slice(0, 40);
    }
    const results = searchWeapons(trimmed, searchIndex);
    return results.slice(0, 40);
  }, [keyword, options, searchIndex]);

  useEffect(() => {
    setKeyword(value);
  }, [value]);

  return (
    <div className="operator-draft-searchable-select">
      <input
        value={keyword}
        onChange={(event) => {
          const nextKeyword = event.target.value;
          setKeyword(nextKeyword);
          setIsOpen(true);
          if (!nextKeyword.trim()) {
            onChange('');
          }
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => {
          window.setTimeout(() => {
            setIsOpen(false);
            setKeyword(value);
          }, 120);
        }}
        placeholder={placeholder}
      />
      {isOpen ? (
        <div className="operator-draft-searchable-select-list">
          {matchedOptions.length ? (
            matchedOptions.map((option) => (
              <button
                type="button"
                key={option}
                className={`operator-draft-searchable-option${value === option ? ' is-active' : ''}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  setKeyword(option);
                  onChange(option);
                  setIsOpen(false);
                }}
              >
                {option}
              </button>
            ))
          ) : (
            <div className="operator-draft-searchable-empty">无匹配结果</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export { isDraftPath };

export function OperatorDraftPage() {
  const [draft, setDraft] = useState<OperatorDraft>(() => loadDraftFromStorage());
  const [referenceNames, setReferenceNames] = useState<string[]>([]);
  const [selectedReferenceName, setSelectedReferenceName] = useState('');
  const [localDraftIds, setLocalDraftIds] = useState<string[]>([]);
  const [selectedLocalDraftId, setSelectedLocalDraftId] = useState('');
  const [messages, setMessages] = useState<string[]>([
    '已进入干员模板编辑器',
  ]);
  const [selectedSkillKey, setSelectedSkillKey] = useState<string | null>(null);
  const [selectedHitKey, setSelectedHitKey] = useState<string | null>(null);
  const [skillOrder, setSkillOrder] = useState<string[]>([]);
  const [draggingSkillKey, setDraggingSkillKey] = useState<string | null>(null);
  const [dragOverSkillKey, setDragOverSkillKey] = useState<string | null>(null);
  const [isExportJsonModalOpen, setIsExportJsonModalOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isDeleteLocalDraftModalOpen, setIsDeleteLocalDraftModalOpen] = useState(false);
  const [isOverwriteDraftModalOpen, setIsOverwriteDraftModalOpen] = useState(false);
  const [isOverwriteProtectionEnabled, setIsOverwriteProtectionEnabled] = useState(true);
  const [loadedLocalDraftId, setLoadedLocalDraftId] = useState<string | null>(null);
  const [shareDraftName, setShareDraftName] = useState('');
  const [pendingImportShare, setPendingImportShare] = useState<DraftLibraryShareFile<OperatorDraft> | null>(null);
  const shareImportInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const skillKeys = Object.keys(draft.skills);
    if (!selectedSkillKey || !draft.skills[selectedSkillKey]) {
      setSelectedSkillKey(skillKeys[0] ?? null);
    }
  }, [draft, selectedSkillKey]);

  useEffect(() => {
    setSkillOrder((prev) => {
      const next = syncSkillOrderWithDraft(prev, draft);
      return next.length === prev.length && next.every((skillKey, index) => skillKey === prev[index]) ? prev : next;
    });
  }, [draft]);

  useEffect(() => {
    let isMounted = true;

    const loadReferenceOperators = async () => {
      try {
        if (!isMounted) {
          return;
        }
        const names = await loadReferenceOperatorNames();
        if (!isMounted) {
          return;
        }
        setReferenceNames(names);
        setSelectedReferenceName((prev) => prev || names[0] || '');
      } catch (error) {
        if (!isMounted) {
          return;
        }
        const message = error instanceof Error ? error.message : 'operators-list 加载失败';
        setMessages((prev) => [`[ERR] ${message}`, ...prev].slice(0, 12));
      }
    };

    loadReferenceOperators();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const raw = window.localStorage.getItem(LIBRARY_STORAGE_KEY);
    const localDraftIdsFromStorage: string[] = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Record<string, OperatorDraft>;
        localDraftIdsFromStorage.push(...Object.keys(parsed));
      } catch {
        // ignore malformed local library
      }
    }
    setLocalDraftIds(localDraftIdsFromStorage);
    setSelectedLocalDraftId((prev) => prev || localDraftIdsFromStorage[0] || '');
  }, [draft.id]);

  useEffect(() => {
    if (!selectedSkillKey || !draft.skills[selectedSkillKey]) {
      setSelectedHitKey(null);
      return;
    }

    const hitKeys = Object.keys(draft.skills[selectedSkillKey].hitMeta);
    if (!selectedHitKey || !draft.skills[selectedSkillKey].hitMeta[selectedHitKey]) {
      setSelectedHitKey(hitKeys[0] ?? null);
    }
  }, [draft, selectedSkillKey, selectedHitKey]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        handleSaveDraft({
          allowOverwriteOnConflict: !isOverwriteProtectionEnabled,
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [draft, skillOrder, isOverwriteProtectionEnabled]);

  const selectedSkill = selectedSkillKey ? draft.skills[selectedSkillKey] : null;
  const selectedHit = selectedSkill && selectedHitKey ? selectedSkill.hitMeta[selectedHitKey] : null;

  const orderedDraft = useMemo(() => buildOrderedDraft(draft, skillOrder), [draft, skillOrder]);
  const draftJson = useMemo(() => JSON.stringify(orderedDraft, null, 2), [orderedDraft]);
  const operatorMarkdown = useMemo(() => {
    const skillLines = Object.entries(orderedDraft.skills).map(([skillKey, skill]) => {
      const hitSummary = Object.entries(skill.hitMeta)
        .map(([hitKey, hit]) => `${hitKey}:${hit.displayName || '-'} / ${hit.element} / ${hit.skillType} / x${hit.multiplier}`)
        .join('；');
      return `- **${skill.displayName || skillKey}**（\`${skill.buttonType}\`，${skill.hitCount} hit）：${hitSummary || '无 hit'}`;
    });

    return [
      '# 干员信息',
      `**名称**：${draft.name}`,
      `**ID**：\`${draft.id}\``,
      `**等级**：${draft.level} / **稀有度**：${draft.rarity}`,
      `**职业**：${draft.profession || '-'} / **武器**：${draft.weapon || '-'}`,
      `**元素**：${draft.element || '-'} / **主属性**：${draft.mainStat || '-'} / **副属性**：${draft.subStat || '-'}`,
      '## 基础属性',
      `- 力量：${draft.attributes.strength}`,
      `- 敏捷：${draft.attributes.agility}`,
      `- 智识：${draft.attributes.intelligence}`,
      `- 意志：${draft.attributes.will}`,
      `- 攻击：${draft.attributes.atk}`,
      `- 生命：${draft.attributes.hp}`,
      '## 技能概览',
      ...(skillLines.length ? skillLines : ['- 暂无技能']),
    ].join('\n');
  }, [draft, orderedDraft]);

  const updateOperatorField = <K extends keyof OperatorDraft>(field: K, value: OperatorDraft[K]) => {
    setDraft((prev) => {
      if (field === 'name') {
        const nextName = String(value);
        return {
          ...prev,
          name: nextName,
          id: buildOperatorIdFromName(nextName) || prev.id,
        };
      }
      return { ...prev, [field]: value };
    });
  };

  const updateAttributeField = (field: keyof OperatorDraft['attributes'], value: number) => {
    setDraft((prev) => ({
      ...prev,
      attributes: {
        ...prev.attributes,
        [field]: value,
      },
    }));
  };

  const updateSelectedSkill = (updater: (skill: SkillDraft) => SkillDraft) => {
    if (!selectedSkillKey) return;
    setDraft((prev) => ({
      ...prev,
      skills: {
        ...prev.skills,
        [selectedSkillKey]: updater(prev.skills[selectedSkillKey]),
      },
    }));
  };

  const updateSelectedHit = (updater: (hit: HitMetaDraft) => HitMetaDraft) => {
    if (!selectedSkillKey || !selectedHitKey) return;
    setDraft((prev) => ({
      ...prev,
      skills: {
        ...prev.skills,
        [selectedSkillKey]: {
          ...prev.skills[selectedSkillKey],
          hitMeta: {
            ...prev.skills[selectedSkillKey].hitMeta,
            [selectedHitKey]: updater(prev.skills[selectedSkillKey].hitMeta[selectedHitKey]),
          },
        },
      },
    }));
  };

  const loadDraftIntoEditor = (nextDraft: OperatorDraft, message: string) => {
    const normalizedDraft = normalizeDraft(cloneDraft(nextDraft));
    const nextSkillOrder = Object.keys(normalizedDraft.skills);
    const firstSkillKey = nextSkillOrder[0] ?? null;
    const firstHitKey = firstSkillKey ? Object.keys(normalizedDraft.skills[firstSkillKey].hitMeta)[0] ?? null : null;
    setDraft(buildOrderedDraft(normalizedDraft, nextSkillOrder));
    setSkillOrder(nextSkillOrder);
    setSelectedSkillKey(firstSkillKey);
    setSelectedHitKey(firstHitKey);
    setMessages((prev) => [message, ...prev].slice(0, 12));
  };

  const duplicateSelectedSkill = () => {
    if (!selectedSkillKey || !selectedSkill) {
      setMessages((prev) => ['[ERR] 当前没有可复制的 skill', ...prev].slice(0, 12));
      return;
    }

    const nextSkillKey = getNextSkillKey(draft);
    const duplicatedSkill = cloneDraft(selectedSkill);
    const firstHitKey = Object.keys(duplicatedSkill.hitMeta)[0] ?? null;
    const nextDraft = {
      ...draft,
      skills: {
        ...draft.skills,
        [nextSkillKey]: duplicatedSkill,
      },
    };
    const nextSkillOrder = [...syncSkillOrderWithDraft(skillOrder, draft), nextSkillKey];
    setDraft(buildOrderedDraft(nextDraft, nextSkillOrder));
    setSkillOrder(nextSkillOrder);
    setSelectedSkillKey(nextSkillKey);
    setSelectedHitKey(firstHitKey);
    setMessages((prev) => [`[OK] 已复制 skill：${selectedSkillKey} -> ${nextSkillKey}`, ...prev].slice(0, 12));
  };

  const importReferenceOperator = async () => {
    if (!selectedReferenceName) {
      setMessages((prev) => ['[ERR] 未选择参考干员', ...prev].slice(0, 12));
      return;
    }

    try {
      const nextDraft = await loadReferenceOperatorDraft(selectedReferenceName, {
        assetPathOptions: ASSET_PATH_OPTIONS,
        avatarAssetOptions: AVATAR_ASSET_OPTIONS,
      });
      loadDraftIntoEditor(nextDraft, `[OK] 已导入参考干员：${selectedReferenceName}`);
      setLoadedLocalDraftId(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : '参考干员导入失败';
      setMessages((prev) => [`[ERR] ${message}`, ...prev].slice(0, 12));
    }
  };

  const persistDraftToLibrary = (allowOverwrite: boolean) => {
    const raw = window.localStorage.getItem(LIBRARY_STORAGE_KEY);
    const library = raw ? (JSON.parse(raw) as Record<string, OperatorDraft>) : {};
    if (!orderedDraft.id.trim()) {
      setMessages((prev) => ['[ERR] 干员 ID 不能为空', ...prev].slice(0, 12));
      return false;
    }
    if (library[orderedDraft.id] && !allowOverwrite) {
      setIsOverwriteDraftModalOpen(true);
      return false;
    }
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(orderedDraft));
    library[orderedDraft.id] = orderedDraft;
    window.localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(library));
    setLocalDraftIds((prev) => (prev.includes(orderedDraft.id) ? prev : [...prev, orderedDraft.id]));
    setSelectedLocalDraftId(orderedDraft.id);
    setLoadedLocalDraftId(null);
    setMessages((prev) => [`[OK] 已保存到本地：${orderedDraft.id}`, ...prev].slice(0, 12));
    return true;
  };

  const handleSaveDraft = (options?: { allowOverwriteOnConflict?: boolean }) => {
    persistDraftToLibrary(Boolean(options?.allowOverwriteOnConflict));
  };

  const handleConfirmOverwriteDraft = () => {
    const saved = persistDraftToLibrary(true);
    if (saved) {
      setMessages((prev) => [`[OK] 已覆盖本地干员：${orderedDraft.id}`, ...prev].slice(0, 12));
    }
    setIsOverwriteDraftModalOpen(false);
  };

  const handleCreateNewDraft = () => {
    const nextId = getNextDraftId(localDraftIds);
    loadDraftIntoEditor(createEmptyDraft(nextId), `[OK] 已新建空草稿：${nextId}`);
    setSelectedLocalDraftId(nextId);
    setLoadedLocalDraftId(null);
  };

  const handleSaveAsDraft = () => {
    const nextId = getNextDraftId(localDraftIds);
    const nextDraft = {
      ...orderedDraft,
      id: nextId,
    };
    loadDraftIntoEditor(nextDraft, `[OK] 已另存为新草稿：${nextId}`);
    setSelectedLocalDraftId(nextId);
    setLoadedLocalDraftId(null);
  };

  const handleReorderDraft = () => {
    const nextDraft = reorderDraftStructure(orderedDraft);
    const nextSkillOrder = Object.keys(nextDraft.skills);
    const nextSelectedSkillKey = nextSkillOrder[0] ?? null;
    const nextSelectedHitKey = nextSelectedSkillKey ? Object.keys(nextDraft.skills[nextSelectedSkillKey].hitMeta)[0] ?? null : null;
    setDraft(buildOrderedDraft(nextDraft, nextSkillOrder));
    setSkillOrder(nextSkillOrder);
    setSelectedSkillKey(nextSelectedSkillKey);
    setSelectedHitKey(nextSelectedHitKey);
    setMessages((prev) => ['[OK] 已整理技能与 hit 编号', ...prev].slice(0, 12));
  };

  const readLocalDraftLibrary = () => {
    if (typeof window === 'undefined') {
      return {} as Record<string, OperatorDraft>;
    }

    const raw = window.localStorage.getItem(LIBRARY_STORAGE_KEY);
    if (!raw) {
      return {} as Record<string, OperatorDraft>;
    }

    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(parsed).flatMap(([draftId, value]) => {
          try {
            const normalizedDraft = parseImportedDraft(JSON.stringify(value));
            return [[draftId, normalizedDraft] as const];
          } catch {
            return [];
          }
        })
      );
    } catch {
      return {} as Record<string, OperatorDraft>;
    }
  };

  const downloadShareFile = (shareFile: DraftLibraryShareFile<OperatorDraft>) => {
    const blob = new Blob([JSON.stringify(shareFile, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = buildDraftLibraryShareFileName(shareFile.label, shareFile.exportedAt);
    link.click();
    window.URL.revokeObjectURL(url);
  };

  const handleOpenExportJsonModal = () => {
    setIsExportJsonModalOpen(true);
  };

  const handleCopyExportJson = async () => {
    await copyText(JSON.stringify(orderedDraft, null, 2));
    setMessages((prev) => ['[OK] 已复制导出 JSON', ...prev].slice(0, 12));
  };

  const handleOpenShareModal = () => {
    setShareDraftName('');
    setPendingImportShare(null);
    setIsShareModalOpen(true);
  };

  const handleCloseShareModal = () => {
    setIsShareModalOpen(false);
    setPendingImportShare(null);
    setShareDraftName('');
    if (shareImportInputRef.current) {
      shareImportInputRef.current.value = '';
    }
  };

  const handleExportLocalLibraryShare = () => {
    const library = readLocalDraftLibrary();
    const draftCount = Object.keys(library).length;
    if (draftCount === 0) {
      setMessages((prev) => ['[ERR] 本地没有可分享的干员库数据', ...prev].slice(0, 12));
      return;
    }

    const shareFile = buildDraftLibraryShareFile(OPERATOR_LIBRARY_SHARE_TYPE, library, shareDraftName);
    downloadShareFile(shareFile);
    setMessages((prev) => [`[OK] 已导出干员分享：${shareFile.label}（${draftCount} 个）`, ...prev].slice(0, 12));
  };

  const handleOpenShareImportPicker = () => {
    shareImportInputRef.current?.click();
  };

  const handleShareFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const rawText = await file.text();
    const parsedShare = parseDraftLibraryShareFile(rawText, OPERATOR_LIBRARY_SHARE_TYPE);
    if (!parsedShare) {
      setMessages((prev) => ['[ERR] 导入失败：文件不是有效的干员分享 JSON', ...prev].slice(0, 12));
      event.target.value = '';
      return;
    }

    const normalizedPayload = Object.fromEntries(
      Object.entries(parsedShare.payload).flatMap(([draftId, value]) => {
        try {
          const normalizedDraft = parseImportedDraft(JSON.stringify(value));
          return [[draftId, normalizedDraft] as const];
        } catch {
          return [];
        }
      })
    ) as Record<string, OperatorDraft>;

    if (Object.keys(normalizedPayload).length === 0) {
      setMessages((prev) => ['[ERR] 导入失败：分享文件内没有有效的干员草稿', ...prev].slice(0, 12));
      event.target.value = '';
      return;
    }

    setPendingImportShare({
      ...parsedShare,
      payload: normalizedPayload,
    });
    event.target.value = '';
  };

  const handleCancelImportShare = () => {
    setPendingImportShare(null);
  };

  const handleConfirmImportShare = () => {
    if (typeof window === 'undefined' || !pendingImportShare) {
      return;
    }

    const currentLibrary = readLocalDraftLibrary();
    const nextLibrary = {
      ...currentLibrary,
      ...pendingImportShare.payload,
    };
    const nextIds = Object.keys(nextLibrary);
    window.localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(nextLibrary));
    setLocalDraftIds(nextIds);
    setSelectedLocalDraftId((prev) => prev && nextLibrary[prev] ? prev : (Object.keys(pendingImportShare.payload)[0] ?? nextIds[0] ?? ''));
    setIsShareModalOpen(false);
    setShareDraftName('');
    setPendingImportShare(null);
    setMessages((prev) => [
      `[OK] 已导入干员分享：${pendingImportShare.label}（${Object.keys(pendingImportShare.payload).length} 个）`,
      ...prev,
    ].slice(0, 12));
  };

  const handleImportLocalDraft = () => {
    if (typeof window === 'undefined') {
      return;
    }
    const raw = window.localStorage.getItem(LIBRARY_STORAGE_KEY);
    if (!raw) {
      setMessages((prev) => ['[ERR] 本地没有可导入数据', ...prev].slice(0, 12));
      return;
    }

    try {
      const parsed = JSON.parse(raw) as Record<string, OperatorDraft>;
      const localDraft = parsed[selectedLocalDraftId];
      if (!selectedLocalDraftId || !localDraft) {
      setMessages((prev) => ['[ERR] 未找到所选本地干员', ...prev].slice(0, 12));
        return;
      }
      loadDraftIntoEditor(localDraft, `[OK] 已从本地导入：${localDraft.id}`);
      setLoadedLocalDraftId(localDraft.id);
    } catch {
      setMessages((prev) => ['[ERR] 本地数据损坏，无法导入', ...prev].slice(0, 12));
    }
  };

  const handleDeleteLocalDraft = () => {
    if (typeof window === 'undefined' || !loadedLocalDraftId) {
      setMessages((prev) => ['[ERR] 请先导入本地数据，再删除对应本地干员', ...prev].slice(0, 12));
      return;
    }

    const raw = window.localStorage.getItem(LIBRARY_STORAGE_KEY);
    if (!raw) {
      setMessages((prev) => ['[ERR] 本地没有可删除数据', ...prev].slice(0, 12));
      setIsDeleteLocalDraftModalOpen(false);
      return;
    }

    try {
      const parsed = JSON.parse(raw) as Record<string, OperatorDraft>;
      if (!parsed[loadedLocalDraftId]) {
      setMessages((prev) => ['[ERR] 未找到所选本地干员', ...prev].slice(0, 12));
        setIsDeleteLocalDraftModalOpen(false);
        return;
      }
      delete parsed[loadedLocalDraftId];
      window.localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(parsed));
      const nextIds = Object.keys(parsed);
      setLocalDraftIds(nextIds);
      setSelectedLocalDraftId(nextIds[0] ?? '');
      setLoadedLocalDraftId(null);
      setMessages((prev) => [`[OK] 已删除本地干员：${loadedLocalDraftId}`, ...prev].slice(0, 12));
    } catch {
      setMessages((prev) => ['[ERR] 本地数据损坏，无法删除', ...prev].slice(0, 12));
    } finally {
      setIsDeleteLocalDraftModalOpen(false);
    }
  };

  const handleAddSkill = () => {
    const nextSkillKey = getNextSkillKey(draft);
    const nextDraft = {
      ...draft,
      skills: {
        ...draft.skills,
        [nextSkillKey]: createDefaultSkill('A', nextSkillKey),
      },
    };
    const nextSkillOrder = [...syncSkillOrderWithDraft(skillOrder, draft), nextSkillKey];
    setDraft(buildOrderedDraft(nextDraft, nextSkillOrder));
    setSkillOrder(nextSkillOrder);
    setSelectedSkillKey(nextSkillKey);
    setSelectedHitKey('hit1');
    setMessages((prev) => [`[OK] 已新增 skill: ${nextSkillKey}`, ...prev].slice(0, 12));
  };

  const handleRemoveSkill = () => {
    if (!selectedSkillKey || !draft.skills[selectedSkillKey]) {
      setMessages((prev) => ['[ERR] 当前没有可删除的 skill', ...prev].slice(0, 12));
      return;
    }
    const nextDraft = cloneDraft(draft);
    delete nextDraft.skills[selectedSkillKey];
    const nextSkillOrder = skillOrder.filter((skillKey) => skillKey !== selectedSkillKey);
    const nextSelectedSkillKey = nextSkillOrder[0] ?? null;
    const nextSelectedHitKey = nextSelectedSkillKey ? Object.keys(nextDraft.skills[nextSelectedSkillKey].hitMeta)[0] ?? null : null;
    setDraft(buildOrderedDraft(nextDraft, nextSkillOrder));
    setSkillOrder(nextSkillOrder);
    setSelectedSkillKey(nextSelectedSkillKey);
    setSelectedHitKey(nextSelectedHitKey);
    setMessages((prev) => [`[OK] 已删除 skill: ${selectedSkillKey}`, ...prev].slice(0, 12));
  };

  const handleAddHit = () => {
    if (!selectedSkillKey || !draft.skills[selectedSkillKey]) {
      setMessages((prev) => ['[ERR] 当前没有可新增 hit 的 skill', ...prev].slice(0, 12));
      return;
    }
    const skill = draft.skills[selectedSkillKey];
    const nextHitKey = getNextHitKey(skill);
    const nextDraft = cloneDraft(draft);
    nextDraft.skills[selectedSkillKey].hitMeta[nextHitKey] = createDefaultHit(nextHitKey);
    syncHitCount(nextDraft.skills[selectedSkillKey]);
    setDraft(nextDraft);
    setSelectedHitKey(nextHitKey);
    setMessages((prev) => [`[OK] 已新增 ${selectedSkillKey}.${nextHitKey}`, ...prev].slice(0, 12));
  };

  const handleRemoveHit = () => {
    if (!selectedSkillKey || !selectedHitKey || !draft.skills[selectedSkillKey]?.hitMeta[selectedHitKey]) {
      setMessages((prev) => ['[ERR] 当前没有可删除的 hit', ...prev].slice(0, 12));
      return;
    }
    const nextDraft = cloneDraft(draft);
    const nextSkill = nextDraft.skills[selectedSkillKey];
    delete nextSkill.hitMeta[selectedHitKey];
    if (Object.keys(nextSkill.hitMeta).length === 0) {
      nextSkill.hitMeta.hit1 = createDefaultHit('hit1');
    }
    syncHitCount(nextSkill);
    const nextSelectedHitKey = Object.keys(nextSkill.hitMeta)[0] ?? null;
    setDraft(nextDraft);
    setSelectedHitKey(nextSelectedHitKey);
    setMessages((prev) => [`[OK] 已删除 ${selectedSkillKey}.${selectedHitKey}`, ...prev].slice(0, 12));
  };

  const handleSkillDragStart = (skillKey: string) => {
    setDraggingSkillKey(skillKey);
    setDragOverSkillKey(skillKey);
  };

  const handleSkillDrop = (targetSkillKey: string) => {
    if (!draggingSkillKey || draggingSkillKey === targetSkillKey) {
      setDraggingSkillKey(null);
      setDragOverSkillKey(null);
      return;
    }

    const nextSkillOrder = moveSkillKey(skillOrder, draggingSkillKey, targetSkillKey);
    setSkillOrder(nextSkillOrder);
    setDraft((prev) => buildOrderedDraft(prev, nextSkillOrder));
    setDraggingSkillKey(null);
    setDragOverSkillKey(null);
  };

  const handleOpenBuffDraftPage = () => {
    if (typeof window === 'undefined') {
      return;
    }
    navigateToAppPath(APP_ROUTE_PATHS.buffDraft);
  };

  const handleOpenWorkbenchPage = () => {
    if (typeof window === 'undefined') {
      return;
    }
    navigateToAppPath(APP_ROUTE_PATHS.home);
  };

  const skillEntries = skillOrder
    .filter((skillKey) => draft.skills[skillKey])
    .map((skillKey) => [skillKey, draft.skills[skillKey]] as const);

  return (
    <main className="operator-draft-page">
      <section className="operator-draft-shell">
        <section className="operator-draft-preview-panel">
          <div className="operator-draft-workbench">
            <div className="operator-draft-column operator-draft-column-cli">
              <section className="operator-draft-command-panel">
                <div className="operator-draft-panel-header">
                  <p className="operator-draft-eyebrow">Draft</p>
                  <h1>干员模板编辑器</h1>
                  <p className="operator-draft-subtitle">参考导入、工作台编辑，底部导出 JSON。</p>
                </div>

                <div className="operator-draft-command-box">
                  <div className="operator-draft-command-actions">
                    <button type="button" className="operator-draft-ghost-button" onClick={handleOpenExportJsonModal}>
                      导出 JSON
                    </button>
                    <button type="button" className="operator-draft-ghost-button" onClick={handleOpenShareModal}>
                      分享库
                    </button>
                  </div>
                  <div className="operator-draft-reference-box">
                    <label>
                      <span>参考数据导入</span>
                      <select value={selectedReferenceName} onChange={(event) => setSelectedReferenceName(event.target.value)}>
                        <option value="">选择已有干员</option>
                        {referenceNames.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="button" className="operator-draft-ghost-button" onClick={importReferenceOperator}>
                      导入参考数据
                    </button>
                  </div>
                  <div className="operator-draft-reference-box">
                    <label>
                      <span>从本地导入</span>
                      <select value={selectedLocalDraftId} onChange={(event) => setSelectedLocalDraftId(event.target.value)}>
                        <option value="">选择本地干员</option>
                        {localDraftIds.map((draftId) => (
                          <option key={draftId} value={draftId}>
                            {draftId}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="operator-draft-command-actions">
                      <button type="button" className="operator-draft-ghost-button" onClick={handleImportLocalDraft}>
                        导入本地数据
                      </button>
                      <button
                        type="button"
                        className="operator-draft-ghost-button"
                        onClick={() => setIsDeleteLocalDraftModalOpen(true)}
                        disabled={!loadedLocalDraftId}
                      >
                        删除本地数据
                      </button>
                    </div>
                  </div>
                  <div className="operator-draft-reference-box">
                    <label>
                      <span>分享导入</span>
                      <input value="点击打开导入弹窗" readOnly />
                    </label>
                    <button type="button" className="operator-draft-ghost-button" onClick={handleOpenShareModal}>
                      打开分享弹窗
                    </button>
                  </div>
                </div>
              </section>

              <section className="operator-draft-markdown-panel">
                <div className="operator-draft-section-header">
                  <h3>干员信息</h3>
                  <span>Markdown 预览</span>
                </div>
                <div className="operator-draft-markdown-body">{renderMiniMarkdown(operatorMarkdown)}</div>
              </section>
            </div>

            <div className="operator-draft-column operator-draft-column-left">
              <section className="operator-draft-basic-panel">
                <div className="operator-draft-section-header">
                  <h3>基础数据</h3>
                    <div className="operator-draft-section-actions">
                      <button
                        type="button"
                        className="operator-draft-ghost-button"
                        onClick={() => setIsOverwriteProtectionEnabled((prev) => !prev)}
                      >
                        {isOverwriteProtectionEnabled ? '保护开' : '保护关'}
                      </button>
                      <button type="button" className="operator-draft-ghost-button" onClick={handleReorderDraft}>
                        整理
                      </button>
                    <button type="button" className="operator-draft-ghost-button" onClick={handleCreateNewDraft}>
                      新建
                    </button>
                    <button type="button" className="operator-draft-ghost-button" onClick={handleSaveAsDraft}>
                      另存为
                    </button>
                      <button
                        type="button"
                        className="operator-draft-ghost-button"
                        onClick={() => handleSaveDraft({ allowOverwriteOnConflict: !isOverwriteProtectionEnabled })}
                      >
                        保存到本地
                      </button>
                  </div>
                </div>
                <div className="operator-draft-basic-grid">
                  <div className="operator-draft-avatar-wrap operator-draft-avatar-wrap-dense">
                    {draft.avatarUrl ? (
                      <img className="operator-draft-avatar" src={normalizeAssetUrl(draft.avatarUrl)} alt={draft.name} />
                    ) : (
                      <div className="operator-draft-avatar operator-draft-avatar-fallback">{draft.name.slice(0, 1)}</div>
                    )}
                  </div>
                  <label>
                    <span>名称</span>
                    <input value={draft.name} onChange={(event) => updateOperatorField('name', event.target.value)} />
                  </label>
                  <label>
                    <span>ID</span>
                    <input value={draft.id} onChange={(event) => updateOperatorField('id', event.target.value)} />
                  </label>
                    <label>
                      <span>头像 URL</span>
                      <SearchablePathSelect
                        value={draft.avatarUrl}
                        options={AVATAR_ASSET_OPTIONS}
                        placeholder="搜索头像 URL"
                        onChange={(nextValue) => updateOperatorField('avatarUrl', nextValue)}
                      />
                    </label>
                  <label>
                    <span>职业</span>
                    <select value={draft.profession} onChange={(event) => updateOperatorField('profession', event.target.value)}>
                      <option value="">未设置</option>
                      {PROFESSION_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>武器</span>
                    <select value={draft.weapon} onChange={(event) => updateOperatorField('weapon', event.target.value)}>
                      <option value="">未设置</option>
                      {WEAPON_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>元素</span>
                    <select value={draft.element} onChange={(event) => updateOperatorField('element', event.target.value)}>
                      {ELEMENT_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>主属性</span>
                    <select value={draft.mainStat} onChange={(event) => updateOperatorField('mainStat', event.target.value)}>
                      <option value="">未设置</option>
                      {ABILITY_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>副属性</span>
                    <select value={draft.subStat} onChange={(event) => updateOperatorField('subStat', event.target.value)}>
                      <option value="">未设置</option>
                      {ABILITY_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>等级</span>
                    <input type="number" value={draft.level} onChange={(event) => updateOperatorField('level', Number(event.target.value) || 0)} />
                  </label>
                  <label>
                    <span>稀有度</span>
                    <select value={draft.rarity} onChange={(event) => updateOperatorField('rarity', Number(event.target.value) || 0)}>
                      {RARITY_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                  {(
                    [
                      ['strength', '力量'],
                      ['agility', '敏捷'],
                      ['intelligence', '智识'],
                      ['will', '意志'],
                      ['atk', '攻击'],
                      ['hp', '生命'],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      <span>{label}</span>
                      <input
                        type="number"
                        value={draft.attributes[key]}
                        onChange={(event) => updateAttributeField(key, Number(event.target.value) || 0)}
                      />
                    </label>
                  ))}
                </div>
              </section>

              <section className="operator-draft-skill-list">
                <div className="operator-draft-section-header">
                  <h3>技能列表</h3>
                  <div className="operator-draft-section-actions">
                    <span>{skillEntries.length} 个</span>
                    <button type="button" className="operator-draft-ghost-button" onClick={handleAddSkill}>
                      新增技能
                    </button>
                    <button type="button" className="operator-draft-ghost-button" onClick={duplicateSelectedSkill}>
                      复制技能
                    </button>
                    <button type="button" className="operator-draft-ghost-button" onClick={handleRemoveSkill}>
                      删除技能
                    </button>
                  </div>
                </div>
                {skillEntries.map(([skillKey, skill]) => (
                  <button
                    type="button"
                    key={skillKey}
                    draggable
                    className={`operator-draft-skill-item${selectedSkillKey === skillKey ? ' is-active' : ''}${draggingSkillKey === skillKey ? ' is-dragging' : ''}${dragOverSkillKey === skillKey && draggingSkillKey !== skillKey ? ' is-drag-over' : ''}`}
                    onClick={() => setSelectedSkillKey(skillKey)}
                    onDragStart={() => handleSkillDragStart(skillKey)}
                    onDragEnter={() => setDragOverSkillKey(skillKey)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      handleSkillDrop(skillKey);
                    }}
                    onDragEnd={() => {
                      setDraggingSkillKey(null);
                      setDragOverSkillKey(null);
                    }}
                  >
                    <div className="operator-draft-skill-icon-wrap">
                      {skill.iconUrl ? (
                        <img src={normalizeAssetUrl(skill.iconUrl)} alt={skill.displayName || skillKey} className="operator-draft-skill-icon" />
                      ) : (
                        <div className="operator-draft-skill-icon operator-draft-skill-icon-fallback">{skill.buttonType}</div>
                      )}
                    </div>
                    <div className="operator-draft-skill-meta">
                      <strong>{skill.displayName || skillKey}</strong>
                      <span>{`${skillKey} / ${skill.buttonType}`}</span>
                      <span>{`${skill.hitCount} hit`}</span>
                    </div>
                  </button>
                ))}
              </section>
            </div>

            <div className="operator-draft-column operator-draft-column-main">
              <section className="operator-draft-skill-detail">
              <div className="operator-draft-section-header">
                <h3>技能预览</h3>
                <div className="operator-draft-section-actions">
                  <span>{selectedSkillKey ?? '-'}</span>
                  <button type="button" className="operator-draft-ghost-button" onClick={handleAddHit}>
                    新增 Hit
                  </button>
                  <button type="button" className="operator-draft-ghost-button" onClick={handleRemoveHit}>
                    删除 Hit
                  </button>
                </div>
              </div>
              {selectedSkill ? (
                <>
                  <div className="operator-draft-skill-hero">
                    {selectedSkill.iconUrl ? (
                      <img src={normalizeAssetUrl(selectedSkill.iconUrl)} alt={selectedSkill.displayName} className="operator-draft-skill-hero-icon" />
                    ) : (
                      <div className="operator-draft-skill-hero-icon operator-draft-skill-icon-fallback">{selectedSkill.buttonType}</div>
                    )}
                    <div className="operator-draft-skill-form">
                      <label>
                        <span>技能名</span>
                        <input
                          value={selectedSkill.displayName}
                          onChange={(event) =>
                            updateSelectedSkill((skill) => ({
                              ...skill,
                              displayName: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span>按钮类型</span>
                        <select
                          value={selectedSkill.buttonType}
                          onChange={(event) =>
                            updateSelectedSkill((skill) => ({
                              ...skill,
                              buttonType: event.target.value as HitSkillType,
                            }))
                          }
                        >
                          <option value="A">A</option>
                          <option value="B">B</option>
                          <option value="E">E</option>
                          <option value="Q">Q</option>
                        </select>
                      </label>
                      <label className="is-wide">
                        <span>技能图标</span>
                        <SearchablePathSelect
                          value={selectedSkill.iconUrl}
                          options={ASSET_PATH_OPTIONS}
                          placeholder="搜索技能图标 URL"
                          onChange={(nextValue) =>
                            updateSelectedSkill((skill) => ({
                              ...skill,
                              iconUrl: nextValue,
                            }))
                          }
                        />
                      </label>
                      <div className="operator-draft-inline-actions">
                        <span>{`hit 数：${selectedSkill.hitCount}`}</span>
                      </div>
                    </div>
                  </div>

                  <div className="operator-draft-hit-list">
                    {Object.entries(selectedSkill.hitMeta).map(([hitKey, hit]) => (
                      <button
                        type="button"
                        key={hitKey}
                        className={`operator-draft-hit-item${selectedHitKey === hitKey ? ' is-active' : ''}`}
                        onClick={() => setSelectedHitKey(hitKey)}
                      >
                        <span className="operator-draft-hit-badge">{hitKey}</span>
                        <strong>{hit.displayName || '未命名 hit'}</strong>
                        <span>{`multiplier: ${hit.multiplier}`}</span>
                        <span>{`${hit.element} / ${hit.skillType}`}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p className="operator-draft-empty">当前没有可预览的 skill。</p>
              )}
              </section>
            </div>

            <div className="operator-draft-column operator-draft-column-right">
              <section className="operator-draft-hit-detail">
                <div className="operator-draft-section-header">
                  <h3>Hit 细节</h3>
                  <span>{selectedHitKey ?? '-'}</span>
                </div>
                {selectedHit ? (
                  <div className="operator-draft-hit-detail-card">
                    <label>
                      <span>名称</span>
                      <input
                        value={selectedHit.displayName}
                        onChange={(event) =>
                          updateSelectedHit((hit) => ({
                            ...hit,
                            displayName: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>倍率</span>
                      <input
                        type="number"
                        step="0.01"
                        value={selectedHit.multiplier}
                        onChange={(event) =>
                          updateSelectedHit((hit) => ({
                            ...hit,
                            multiplier: Number(event.target.value) || 0,
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>伤害属性</span>
                      <select
                        value={selectedHit.element}
                        onChange={(event) =>
                          updateSelectedHit((hit) => ({
                            ...hit,
                            element: event.target.value as HitElement,
                          }))
                        }
                      >
                        <option value="physical">physical</option>
                        <option value="fire">fire</option>
                        <option value="ice">ice</option>
                        <option value="electric">electric</option>
                        <option value="nature">nature</option>
                      </select>
                    </label>
                    <label>
                      <span>技能乘区</span>
                      <select
                        value={selectedHit.skillType}
                        onChange={(event) =>
                          updateSelectedHit((hit) => ({
                            ...hit,
                            skillType: event.target.value as HitSkillType,
                          }))
                        }
                      >
                        <option value="A">A</option>
                        <option value="B">B</option>
                        <option value="E">E</option>
                        <option value="Q">Q</option>
                      </select>
                    </label>
                  </div>
                ) : (
                  <p className="operator-draft-empty">当前没有选中的 hit。</p>
                )}
              </section>

              <section className="operator-draft-history operator-draft-history-side">
                <div className="operator-draft-section-header">
                  <h3>命令输出</h3>
                  <span>{messages.length} 条</span>
                </div>
                <ul>
                  {messages.map((message, index) => (
                    <li key={`${message}-${index}`}>{message}</li>
                  ))}
                </ul>
                <div className="operator-draft-history-footer">
                  <button type="button" className="operator-draft-ghost-button" onClick={handleOpenWorkbenchPage}>
                    主界面
                  </button>
                  <button type="button" className="operator-draft-ghost-button is-active">
                    编辑干员
                  </button>
                  <button type="button" className="operator-draft-ghost-button" onClick={handleOpenBuffDraftPage}>
                    编辑BUFF
                  </button>
                </div>
              </section>
            </div>
          </div>
        </section>
      </section>
      {isExportJsonModalOpen ? (
        <div className="operator-draft-modal-overlay" onClick={() => setIsExportJsonModalOpen(false)}>
          <div className="operator-draft-modal" onClick={(event) => event.stopPropagation()}>
            <div className="operator-draft-section-header">
              <h3>导出 JSON</h3>
              <span>预览后复制</span>
            </div>
            <pre className="operator-draft-json">{draftJson}</pre>
            <div className="operator-draft-modal-actions">
              <button type="button" className="operator-draft-ghost-button" onClick={() => setIsExportJsonModalOpen(false)}>
                关闭
              </button>
              <button type="button" className="operator-draft-copy-button" onClick={handleCopyExportJson}>
                复制
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {isShareModalOpen ? (
        <div className="operator-draft-modal-overlay" onClick={handleCloseShareModal}>
          <div className="operator-draft-modal operator-draft-share-modal" onClick={(event) => event.stopPropagation()}>
            <div className="operator-draft-section-header">
              <h3>干员库分享</h3>
              <span>导出 / 导入本地库</span>
            </div>
            <div className="operator-draft-confirm-body">
              <p>{`当前本地干员库共有 ${localDraftIds.length} 个条目。`}</p>
              <p>导出会打包整个本地干员库；导入会把分享文件中的干员合并回本地库，并覆盖同 ID 条目。</p>
            </div>
            <label className="operator-draft-share-label">
              <span>分享文件名</span>
              <input
                value={shareDraftName}
                onChange={(event) => setShareDraftName(event.target.value)}
                placeholder="留空则默认使用未命名"
              />
            </label>
            <input
              ref={shareImportInputRef}
              type="file"
              accept=".json,application/json"
              className="operator-draft-file-input"
              onChange={handleShareFileSelected}
            />
            <div className="operator-draft-modal-actions">
              <button type="button" className="operator-draft-ghost-button" onClick={handleOpenShareImportPicker}>
                导入分享
              </button>
              <button type="button" className="operator-draft-copy-button" onClick={handleExportLocalLibraryShare}>
                一键导出 JSON
              </button>
            </div>
            <div className="operator-draft-modal-actions">
              <button type="button" className="operator-draft-ghost-button" onClick={handleCloseShareModal}>
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {isDeleteLocalDraftModalOpen ? (
        <div className="operator-draft-modal-overlay" onClick={() => setIsDeleteLocalDraftModalOpen(false)}>
          <div className="operator-draft-modal operator-draft-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <div className="operator-draft-section-header">
              <h3>删除本地数据</h3>
              <span>请确认</span>
            </div>
            <div className="operator-draft-confirm-body">
              <p>{loadedLocalDraftId ? `确认删除当前已导入的本地干员草稿「${loadedLocalDraftId}」吗？` : '请先导入本地数据，再删除对应的本地干员草稿。'}</p>
              <p>该操作只删除本地库记录，不会自动清空当前编辑器内容。</p>
            </div>
            <div className="operator-draft-modal-actions">
              <button type="button" className="operator-draft-ghost-button" onClick={() => setIsDeleteLocalDraftModalOpen(false)}>
                取消
              </button>
              <button type="button" className="operator-draft-copy-button operator-draft-danger-button" onClick={handleDeleteLocalDraft}>
                确认删除
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {pendingImportShare ? (
        <div className="operator-draft-modal-overlay" onClick={handleCancelImportShare}>
          <div className="operator-draft-modal operator-draft-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <div className="operator-draft-section-header">
              <h3>确认导入干员分享</h3>
              <span>请确认</span>
            </div>
            <div className="operator-draft-confirm-body">
              <p>{`即将导入分享「${pendingImportShare.label}」。`}</p>
              <p>{`本次会写入 ${Object.keys(pendingImportShare.payload).length} 个干员条目，并覆盖本地同 ID 记录。`}</p>
            </div>
            <div className="operator-draft-modal-actions">
              <button type="button" className="operator-draft-ghost-button" onClick={handleCancelImportShare}>
                取消
              </button>
              <button type="button" className="operator-draft-copy-button operator-draft-danger-button" onClick={handleConfirmImportShare}>
                确认导入
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {isOverwriteDraftModalOpen ? (
        <div className="operator-draft-modal-overlay" onClick={() => setIsOverwriteDraftModalOpen(false)}>
          <div className="operator-draft-modal operator-draft-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <div className="operator-draft-section-header">
              <h3>覆盖本地干员</h3>
              <span>请确认</span>
            </div>
            <div className="operator-draft-confirm-body">
              <p>{`本地库中已存在 ID 为「${orderedDraft.id}」的干员。`}</p>
              <p>保护开启时，确认后会用当前编辑器内容覆盖本地同 ID 干员。</p>
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
    </main>
  );
}

