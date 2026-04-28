import { useEffect, useMemo, useState, type ReactNode } from 'react';
import './OperatorDraftPage.css';
import assetPathsRaw from '../../asset-paths.txt?raw';
import { loadReferenceOperatorDraft, loadReferenceOperatorNames } from './operatorDraftReference';

const DRAFT_PAGE_PATH = '/draft';
const DRAFT_STORAGE_KEY = 'ddd.operator-editor.draft.v1';
const LIBRARY_STORAGE_KEY = 'ddd.operator-editor.library.v1';
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
  const [jsonImportText, setJsonImportText] = useState('');

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
    setDraft((prev) => ({ ...prev, [field]: value }));
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
    } catch (error) {
      const message = error instanceof Error ? error.message : '参考干员导入失败';
      setMessages((prev) => [`[ERR] ${message}`, ...prev].slice(0, 12));
    }
  };

  const handleSaveDraft = () => {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(orderedDraft));
    const raw = window.localStorage.getItem(LIBRARY_STORAGE_KEY);
    const library = raw ? (JSON.parse(raw) as Record<string, OperatorDraft>) : {};
    library[orderedDraft.id] = orderedDraft;
    window.localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(library));
    setLocalDraftIds((prev) => (prev.includes(orderedDraft.id) ? prev : [...prev, orderedDraft.id]));
    setSelectedLocalDraftId(orderedDraft.id);
    setMessages((prev) => [`[OK] 已保存到本地：${orderedDraft.id}`, ...prev].slice(0, 12));
  };

  const handleExportJson = async () => {
    await copyText(JSON.stringify(orderedDraft, null, 2));
    setMessages((prev) => ['[OK] 已导出 JSON 到剪贴板', ...prev].slice(0, 12));
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
        setMessages((prev) => ['[ERR] 未找到所选本地角色', ...prev].slice(0, 12));
        return;
      }
      loadDraftIntoEditor(localDraft, `[OK] 已从本地导入：${localDraft.id}`);
    } catch {
      setMessages((prev) => ['[ERR] 本地数据损坏，无法导入', ...prev].slice(0, 12));
    }
  };

  const handleImportJsonText = () => {
    const trimmedText = jsonImportText.trim();
    if (!trimmedText) {
      setMessages((prev) => ['[ERR] JSON 文本为空', ...prev].slice(0, 12));
      return;
    }

    try {
      const importedDraft = parseImportedDraft(trimmedText);
      loadDraftIntoEditor(importedDraft, `[OK] 已从 JSON 文本导入：${importedDraft.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'JSON 导入失败';
      setMessages((prev) => [`[ERR] ${message}`, ...prev].slice(0, 12));
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
                    <button type="button" className="operator-draft-ghost-button" onClick={handleSaveDraft}>
                      保存到本地
                    </button>
                    <button type="button" className="operator-draft-ghost-button" onClick={handleExportJson}>
                      导出 JSON
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
                        <option value="">选择本地角色</option>
                        {localDraftIds.map((draftId) => (
                          <option key={draftId} value={draftId}>
                            {draftId}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="button" className="operator-draft-ghost-button" onClick={handleImportLocalDraft}>
                      导入本地数据
                    </button>
                  </div>
                  <div className="operator-draft-reference-box">
                    <label>
                      <span>从 JSON 文本导入</span>
                      <textarea
                        value={jsonImportText}
                        onChange={(event) => setJsonImportText(event.target.value)}
                        placeholder="粘贴导出的 OperatorDraft JSON"
                      />
                    </label>
                    <button type="button" className="operator-draft-ghost-button" onClick={handleImportJsonText}>
                      导入 JSON 文本
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
                  <span>{draft.id}</span>
                </div>
                <div className="operator-draft-basic-grid">
                  <div className="operator-draft-avatar-wrap operator-draft-avatar-wrap-dense">
                    {draft.avatarUrl ? (
                      <img className="operator-draft-avatar" src={draft.avatarUrl} alt={draft.name} />
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
                    <select value={draft.avatarUrl} onChange={(event) => updateOperatorField('avatarUrl', event.target.value)}>
                      <option value="">未设置</option>
                      {AVATAR_ASSET_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
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
                        <img src={skill.iconUrl} alt={skill.displayName || skillKey} className="operator-draft-skill-icon" />
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
                <span>{selectedSkillKey ?? '-'}</span>
              </div>
              {selectedSkill ? (
                <>
                  <div className="operator-draft-skill-hero">
                    {selectedSkill.iconUrl ? (
                      <img src={selectedSkill.iconUrl} alt={selectedSkill.displayName} className="operator-draft-skill-hero-icon" />
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
                        <select
                          value={selectedSkill.iconUrl}
                          onChange={(event) =>
                            updateSelectedSkill((skill) => ({
                              ...skill,
                              iconUrl: event.target.value,
                            }))
                          }
                        >
                          <option value="">未设置</option>
                          {ASSET_PATH_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
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

              <section className="operator-draft-json-panel">
                <div className="operator-draft-section-header">
                  <h3>JSON 预览</h3>
                  <button type="button" className="operator-draft-copy-button" onClick={() => copyText(draftJson)}>
                    复制
                  </button>
                </div>
                <pre className="operator-draft-json">{draftJson}</pre>
              </section>
            </div>

            <div className="operator-draft-column operator-draft-column-right">
              <section className="operator-draft-hit-detail">
                <div className="operator-draft-section-header">
                  <h3>Hit 细节</h3>
                  <div className="operator-draft-section-actions">
                    <span>{selectedHitKey ?? '-'}</span>
                    <button type="button" className="operator-draft-ghost-button" onClick={handleAddHit}>
                      新增 Hit
                    </button>
                    <button type="button" className="operator-draft-ghost-button" onClick={handleRemoveHit}>
                      删除 Hit
                    </button>
                  </div>
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
              </section>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
