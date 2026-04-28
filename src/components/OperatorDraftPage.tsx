import { useEffect, useMemo, useState } from 'react';
import './OperatorDraftPage.css';

const DRAFT_PAGE_PATH = '/draft';
const DRAFT_STORAGE_KEY = 'ddd.operator-editor.draft.v1';
const LIBRARY_STORAGE_KEY = 'ddd.operator-editor.library.v1';

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

interface CommandResult {
  draft: OperatorDraft;
  message: string;
  effect?: 'save-draft' | 'save-library' | 'export-json';
  selectedSkillKey?: string | null;
  selectedHitKey?: string | null;
}

interface CommandContext {
  selectedSkillKey: string | null;
  selectedHitKey: string | null;
}

function createDefaultHit(): HitMetaDraft {
  return {
    multiplier: 0,
    displayName: '',
    element: 'physical',
    skillType: 'A',
  };
}

function createDefaultSkill(buttonType: HitSkillType = 'A'): SkillDraft {
  return {
    displayName: '',
    buttonType,
    iconUrl: '',
    hitCount: 1,
    hitMeta: {
      hit1: createDefaultHit(),
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
      'skill-1': createDefaultSkill('A'),
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

function parseNumber(value: string) {
  const next = Number(value);
  if (Number.isNaN(next)) {
    throw new Error(`无效数字: ${value}`);
  }
  return next;
}

function assertSkill(draft: OperatorDraft, skillKey: string) {
  const skill = draft.skills[skillKey];
  if (!skill) {
    throw new Error(`未找到 skill: ${skillKey}`);
  }
  return skill;
}

function assertHit(skill: SkillDraft, hitKey: string) {
  const hit = skill.hitMeta[hitKey];
  if (!hit) {
    throw new Error(`未找到 hit: ${hitKey}`);
  }
  return hit;
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

function resolveSkillKey(rawSkillKey: string | undefined, context: CommandContext) {
  if (rawSkillKey && rawSkillKey !== '.') {
    return rawSkillKey;
  }
  if (!context.selectedSkillKey) {
    throw new Error('当前没有选中的 skill');
  }
  return context.selectedSkillKey;
}

function resolveHitKey(rawHitKey: string | undefined, context: CommandContext) {
  if (rawHitKey && rawHitKey !== '.') {
    return rawHitKey;
  }
  if (!context.selectedHitKey) {
    throw new Error('当前没有选中的 hit');
  }
  return context.selectedHitKey;
}

function parseCommand(input: string, currentDraft: OperatorDraft, context: CommandContext): CommandResult {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('命令为空');
  }

  const tokens = trimmed.split(/\s+/);
  const draft = cloneDraft(currentDraft);

  if (tokens[0] === 'set' && tokens[1] === 'operator' && tokens.length >= 4) {
    const field = tokens[2];
    const value = tokens.slice(3).join(' ');

    if (!['id', 'name', 'avatarUrl', 'profession', 'weapon', 'element', 'mainStat', 'subStat', 'level', 'rarity'].includes(field)) {
      throw new Error(`不支持的 operator 字段: ${field}`);
    }

    switch (field) {
      case 'id':
        draft.id = value;
        break;
      case 'name':
        draft.name = value;
        break;
      case 'avatarUrl':
        draft.avatarUrl = value;
        break;
      case 'profession':
        draft.profession = value;
        break;
      case 'weapon':
        draft.weapon = value;
        break;
      case 'element':
        draft.element = value;
        break;
      case 'mainStat':
        draft.mainStat = value;
        break;
      case 'subStat':
        draft.subStat = value;
        break;
      case 'level':
        draft.level = parseNumber(value);
        break;
      case 'rarity':
        draft.rarity = parseNumber(value);
        break;
      default:
        throw new Error(`不支持的 operator 字段: ${field}`);
    }

    return { draft, message: `已更新 operator.${field}` };
  }

  if (tokens[0] === 'set' && tokens[1] === 'attr' && tokens.length === 4) {
    const field = tokens[2] as keyof OperatorDraft['attributes'];
    if (!(field in draft.attributes)) {
      throw new Error(`不支持的 attributes 字段: ${field}`);
    }
    draft.attributes[field] = parseNumber(tokens[3]);
    return { draft, message: `已更新 attributes.${field}` };
  }

  if (tokens[0] === 'select' && tokens[1] === 'skill' && tokens.length === 3) {
    const skillKey = tokens[2];
    assertSkill(draft, skillKey);
    const skill = draft.skills[skillKey];
    const firstHitKey = Object.keys(skill.hitMeta)[0] ?? null;
    return { draft, message: `已选中 skill: ${skillKey}`, selectedSkillKey: skillKey, selectedHitKey: firstHitKey };
  }

  if (tokens[0] === 'select' && tokens[1] === 'hit') {
    if (tokens.length === 3) {
      const skillKey = resolveSkillKey(undefined, context);
      const skill = assertSkill(draft, skillKey);
      const hitKey = tokens[2];
      assertHit(skill, hitKey);
      return { draft, message: `已选中 ${skillKey}.${hitKey}`, selectedSkillKey: skillKey, selectedHitKey: hitKey };
    }

    if (tokens.length === 4) {
      const skillKey = tokens[2];
      const skill = assertSkill(draft, skillKey);
      const hitKey = tokens[3];
      assertHit(skill, hitKey);
      return { draft, message: `已选中 ${skillKey}.${hitKey}`, selectedSkillKey: skillKey, selectedHitKey: hitKey };
    }
  }

  if (tokens[0] === 'add' && tokens[1] === 'skill') {
    const skillKey = tokens[2] ?? getNextSkillKey(draft);
    if (draft.skills[skillKey]) {
      throw new Error(`skill 已存在: ${skillKey}`);
    }
    const buttonType = (tokens[3] as HitSkillType | undefined) ?? 'A';
    draft.skills[skillKey] = createDefaultSkill(buttonType);
    return { draft, message: `已新增 skill: ${skillKey}`, selectedSkillKey: skillKey, selectedHitKey: 'hit1' };
  }

  if (tokens[0] === 'remove' && tokens[1] === 'skill' && tokens.length <= 3) {
    const skillKey = resolveSkillKey(tokens[2], context);
    assertSkill(draft, skillKey);
    delete draft.skills[skillKey];
    const nextSkillKey = Object.keys(draft.skills)[0] ?? null;
    const nextHitKey = nextSkillKey ? Object.keys(draft.skills[nextSkillKey].hitMeta)[0] ?? null : null;
    return { draft, message: `已删除 skill: ${skillKey}`, selectedSkillKey: nextSkillKey, selectedHitKey: nextHitKey };
  }

  if (tokens[0] === 'set' && tokens[1] === 'skill') {
    const explicitFieldCall = tokens.length >= 4 && ['displayName', 'iconUrl', 'buttonType', 'hitCount'].includes(tokens[2]);
    const skillKey = explicitFieldCall ? resolveSkillKey(undefined, context) : resolveSkillKey(tokens[2], context);
    const field = explicitFieldCall ? tokens[2] : tokens[3];
    const value = explicitFieldCall ? tokens.slice(3).join(' ') : tokens.slice(4).join(' ');
    if (!field || !value) {
      throw new Error('set skill 命令不完整');
    }
    const skill = assertSkill(draft, skillKey);

    if (field === 'displayName') {
      skill.displayName = value;
    } else if (field === 'iconUrl') {
      skill.iconUrl = value;
    } else if (field === 'buttonType') {
      skill.buttonType = value as HitSkillType;
    } else if (field === 'hitCount') {
      const count = parseNumber(value);
      if (count < 1) {
        throw new Error('hitCount 不能小于 1');
      }
      const currentCount = Object.keys(skill.hitMeta).length;
      if (count > currentCount) {
        for (let index = currentCount + 1; index <= count; index += 1) {
          skill.hitMeta[`hit${index}`] = createDefaultHit();
        }
      } else if (count < currentCount) {
        for (let index = currentCount; index > count; index -= 1) {
          delete skill.hitMeta[`hit${index}`];
        }
      }
      syncHitCount(skill);
    } else {
      throw new Error(`不支持的 skill 字段: ${field}`);
    }

    return { draft, message: `已更新 ${skillKey}.${field}`, selectedSkillKey: skillKey };
  }

  if (tokens[0] === 'add' && tokens[1] === 'hit') {
    const explicitSkill = tokens.length >= 4;
    const skillKey = explicitSkill ? resolveSkillKey(tokens[2], context) : resolveSkillKey(undefined, context);
    const skill = assertSkill(draft, skillKey);
    const hitKey = explicitSkill ? (tokens[3] ?? getNextHitKey(skill)) : (tokens[2] ?? getNextHitKey(skill));
    if (skill.hitMeta[hitKey]) {
      throw new Error(`hit 已存在: ${hitKey}`);
    }
    skill.hitMeta[hitKey] = createDefaultHit();
    syncHitCount(skill);
    return { draft, message: `已新增 ${skillKey}.${hitKey}`, selectedSkillKey: skillKey, selectedHitKey: hitKey };
  }

  if (tokens[0] === 'remove' && tokens[1] === 'hit') {
    const explicitSkill = tokens.length >= 4;
    const skillKey = explicitSkill ? resolveSkillKey(tokens[2], context) : resolveSkillKey(undefined, context);
    const skill = assertSkill(draft, skillKey);
    const hitKey = explicitSkill ? resolveHitKey(tokens[3], context) : resolveHitKey(tokens[2], context);
    assertHit(skill, hitKey);
    delete skill.hitMeta[hitKey];
    if (Object.keys(skill.hitMeta).length === 0) {
      skill.hitMeta.hit1 = createDefaultHit();
    }
    syncHitCount(skill);
    const nextHitKey = Object.keys(skill.hitMeta)[0] ?? null;
    return { draft, message: `已删除 ${skillKey}.${hitKey}`, selectedSkillKey: skillKey, selectedHitKey: nextHitKey };
  }

  if (tokens[0] === 'set' && tokens[1] === 'hit') {
    const shortFieldCall = tokens.length >= 4 && ['multiplier', 'displayName', 'element', 'skillType'].includes(tokens[2]);
    const mediumFieldCall = tokens.length >= 5 && ['multiplier', 'displayName', 'element', 'skillType'].includes(tokens[3]);
    const skillKey = shortFieldCall ? resolveSkillKey(undefined, context) : mediumFieldCall ? resolveSkillKey(tokens[2], context) : resolveSkillKey(tokens[2], context);
    const skill = assertSkill(draft, skillKey);
    const hitKey = shortFieldCall ? resolveHitKey(undefined, context) : mediumFieldCall ? resolveHitKey(undefined, context) : resolveHitKey(tokens[3], context);
    const hit = assertHit(skill, hitKey);
    const field = shortFieldCall ? tokens[2] : mediumFieldCall ? tokens[3] : tokens[4];
    const value = shortFieldCall ? tokens.slice(3).join(' ') : mediumFieldCall ? tokens.slice(4).join(' ') : tokens.slice(5).join(' ');
    if (!field || !value) {
      throw new Error('set hit 命令不完整');
    }

    if (field === 'multiplier') {
      hit.multiplier = parseNumber(value);
    } else if (field === 'displayName') {
      hit.displayName = value;
    } else if (field === 'element') {
      hit.element = value as HitElement;
    } else if (field === 'skillType') {
      hit.skillType = value as HitSkillType;
    } else {
      throw new Error(`不支持的 hit 字段: ${field}`);
    }

    return { draft, message: `已更新 ${skillKey}.${hitKey}.${field}`, selectedSkillKey: skillKey, selectedHitKey: hitKey };
  }

  if (trimmed === 'save draft') {
    return { draft, message: '已保存草稿到 localStorage', effect: 'save-draft' };
  }

  if (trimmed === 'save library') {
    return { draft, message: '已保存到角色库', effect: 'save-library' };
  }

  if (trimmed === 'export json') {
    return { draft, message: '已导出 JSON 到剪贴板', effect: 'export-json' };
  }

  throw new Error(`无法识别命令: ${trimmed}`);
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
    return JSON.parse(raw) as OperatorDraft;
  } catch {
    return createDefaultDraft();
  }
}

async function copyText(text: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  }
}

export { isDraftPath };

export function OperatorDraftPage() {
  const [draft, setDraft] = useState<OperatorDraft>(() => loadDraftFromStorage());
  const [command, setCommand] = useState('');
  const [messages, setMessages] = useState<string[]>([
    '命令示例：set operator name 汤汤2号',
    '命令示例：add skill skill-2 B',
    '命令示例：set hit skill-1 hit1 multiplier 0.41',
  ]);
  const [selectedSkillKey, setSelectedSkillKey] = useState<string | null>(null);
  const [selectedHitKey, setSelectedHitKey] = useState<string | null>(null);

  useEffect(() => {
    const skillKeys = Object.keys(draft.skills);
    if (!selectedSkillKey || !draft.skills[selectedSkillKey]) {
      setSelectedSkillKey(skillKeys[0] ?? null);
    }
  }, [draft, selectedSkillKey]);

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

  const draftJson = useMemo(() => JSON.stringify(draft, null, 2), [draft]);

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

  const applyCommand = async (nextCommand: string, autoRun = false) => {
    setCommand(nextCommand);
    if (!autoRun) {
      return;
    }

    try {
      const result = parseCommand(nextCommand, draft, { selectedSkillKey, selectedHitKey });
      setDraft(result.draft);
      setMessages((prev) => [`[OK] ${result.message}`, ...prev].slice(0, 12));

      if (typeof result.selectedSkillKey !== 'undefined') {
        setSelectedSkillKey(result.selectedSkillKey);
      }
      if (typeof result.selectedHitKey !== 'undefined') {
        setSelectedHitKey(result.selectedHitKey);
      }

      if (result.effect === 'save-draft') {
        window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(result.draft));
      }

      if (result.effect === 'save-library') {
        const raw = window.localStorage.getItem(LIBRARY_STORAGE_KEY);
        const library = raw ? (JSON.parse(raw) as Record<string, OperatorDraft>) : {};
        library[result.draft.id] = result.draft;
        window.localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(library));
      }

      if (result.effect === 'export-json') {
        await copyText(JSON.stringify(result.draft, null, 2));
      }

      setCommand('');
    } catch (error) {
      const message = error instanceof Error ? error.message : '命令执行失败';
      setMessages((prev) => [`[ERR] ${message}`, ...prev].slice(0, 12));
    }
  };

  const runCommand = async () => {
    await applyCommand(command, true);
  };

  const skillEntries = Object.entries(draft.skills);

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
                  <p className="operator-draft-subtitle">命令改结构，工作台改细节，底部导出 JSON。</p>
                </div>

                <div className="operator-draft-command-box">
                  <textarea
                    className="operator-draft-command-input"
                    value={command}
                    onChange={(event) => setCommand(event.target.value)}
                    placeholder="输入命令，例如：set operator name 汤汤2号"
                  />
                  <div className="operator-draft-command-actions">
                    <button type="button" className="operator-draft-run-button" onClick={runCommand}>
                      执行命令
                    </button>
                    <button type="button" className="operator-draft-ghost-button" onClick={() => applyCommand('save draft', true)}>
                      保存草稿
                    </button>
                    <button type="button" className="operator-draft-ghost-button" onClick={() => applyCommand('export json', true)}>
                      导出 JSON
                    </button>
                  </div>
                </div>
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
                    <input value={draft.avatarUrl} onChange={(event) => updateOperatorField('avatarUrl', event.target.value)} />
                  </label>
                  <label>
                    <span>职业</span>
                    <input value={draft.profession} onChange={(event) => updateOperatorField('profession', event.target.value)} />
                  </label>
                  <label>
                    <span>武器</span>
                    <input value={draft.weapon} onChange={(event) => updateOperatorField('weapon', event.target.value)} />
                  </label>
                  <label>
                    <span>元素</span>
                    <input value={draft.element} onChange={(event) => updateOperatorField('element', event.target.value)} />
                  </label>
                  <label>
                    <span>主属性</span>
                    <input value={draft.mainStat} onChange={(event) => updateOperatorField('mainStat', event.target.value)} />
                  </label>
                  <label>
                    <span>副属性</span>
                    <input value={draft.subStat} onChange={(event) => updateOperatorField('subStat', event.target.value)} />
                  </label>
                  <label>
                    <span>等级</span>
                    <input type="number" value={draft.level} onChange={(event) => updateOperatorField('level', Number(event.target.value) || 0)} />
                  </label>
                  <label>
                    <span>稀有度</span>
                    <input type="number" value={draft.rarity} onChange={(event) => updateOperatorField('rarity', Number(event.target.value) || 0)} />
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
                    <button type="button" className="operator-draft-ghost-button" onClick={() => applyCommand('add skill', true)}>
                      新增技能
                    </button>
                    <button type="button" className="operator-draft-ghost-button" onClick={() => applyCommand('remove skill', true)}>
                      删除技能
                    </button>
                  </div>
                </div>
                {skillEntries.map(([skillKey, skill]) => (
                  <button
                    type="button"
                    key={skillKey}
                    className={`operator-draft-skill-item${selectedSkillKey === skillKey ? ' is-active' : ''}`}
                    onClick={() => setSelectedSkillKey(skillKey)}
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
                        <input
                          value={selectedSkill.iconUrl}
                          onChange={(event) =>
                            updateSelectedSkill((skill) => ({
                              ...skill,
                              iconUrl: event.target.value,
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
                    <button type="button" className="operator-draft-ghost-button" onClick={() => applyCommand('add hit', true)}>
                      新增 Hit
                    </button>
                    <button type="button" className="operator-draft-ghost-button" onClick={() => applyCommand('remove hit', true)}>
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
