import { useEffect, useMemo, useState } from 'react';
import type { ConfigSnapshot } from '../../core/calculators/operatorPanelCalculator';
import type {
  EquipmentEffect,
  EquipmentItem,
  EquipmentLibrary,
  EquipmentPart,
} from '../../core/services/operatorEquipmentLibrary';
import type { Character, SkillType } from '../../types';
import type {
  MobileCatalog,
  MobileEquipmentSlotKey,
  MobileOperatorConfig,
} from '../model';
import { MobilePortal } from '../components/MobilePortal';
import { normalizeAssetUrl, resolveAvatarUrl, resolveSkillIconUrl } from '../../utils/assetResolver';
import './MobileOperatorConfigPage.css';

const CHARACTER_LEVELS = [1, 20, 30, 40, 50, 60, 70, 80, 90] as const;
const SKILL_LEVEL_OPTIONS = [
  'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9', 'M1', 'M2', 'M3',
] as const;
const WEAPON_SKILL_KEYS = ['skill1', 'skill2', 'skill3'] as const;
const WEAPON_SKILL_LABELS: Record<(typeof WEAPON_SKILL_KEYS)[number], string> = {
  skill1: '能力值',
  skill2: '属性',
  skill3: '特效',
};

const SKILL_ITEMS: ReadonlyArray<{ key: Exclude<SkillType, 'Dot'>; label: string }> = [
  { key: 'A', label: '普攻' },
  { key: 'B', label: '战技' },
  { key: 'E', label: '连携' },
  { key: 'Q', label: '终结' },
];

const EQUIPMENT_SLOTS: ReadonlyArray<{
  key: MobileEquipmentSlotKey;
  label: string;
  part: EquipmentPart;
}> = [
  { key: 'armor', label: '护甲', part: '护甲' },
  { key: 'glove', label: '护手', part: '护手' },
  { key: 'accessory1', label: '配件 1', part: '配件' },
  { key: 'accessory2', label: '配件 2', part: '配件' },
];

const ELEMENT_LABELS: Record<string, string> = {
  physical: '物理',
  fire: '灼热',
  ice: '寒冷',
  electric: '电磁',
  nature: '自然',
};

type ConfigPicker =
  | { kind: 'weapon' }
  | { kind: 'equipment'; slotKey: MobileEquipmentSlotKey };

export interface MobileOperatorConfigPageProps {
  /** 当前线上官方目录中的干员，顺序由选人页决定。 */
  characters: Character[];
  selectedOperatorIds: string[];
  activeOperatorId: string;
  /** 移动端内存状态；页面只通过回调更新，不读写桌面存储。 */
  configs: Record<string, MobileOperatorConfig>;
  /** 由移动端目录提供的武器与装备，只用于候选项展示和筛选。 */
  weapons: MobileCatalog['weapons'];
  equipment: MobileCatalog['equipment'];
  /** 当前干员的最新计算结果；空值时显示可理解的占位状态。 */
  configSnapshot: ConfigSnapshot | null;
  onActiveOperatorChange: (operatorId: string) => void;
  onConfigChange: (operatorId: string, config: MobileOperatorConfig) => void;
}

function createEmptyEquipmentSelection(): MobileOperatorConfig['equipment'][MobileEquipmentSlotKey] {
  return { equipmentId: '', effectLevels: {} };
}

function createDefaultConfig(character: Character): MobileOperatorConfig {
  return {
    characterId: character.id,
    level: 90,
    potential: '0潜',
    favorValue: 60,
    mainStatFlatBonus: 60,
    subStatFlatBonus: 0,
    skillLevels: { A: 'M3', B: 'M3', E: 'M3', Q: 'M3', Dot: 'M3' },
    weapon: {
      weaponId: '',
      level: 90,
      potential: '0潜',
      skillLevels: { skill1: 9, skill2: 9, skill3: 4 },
    },
    equipment: {
      armor: createEmptyEquipmentSelection(),
      glove: createEmptyEquipmentSelection(),
      accessory1: createEmptyEquipmentSelection(),
      accessory2: createEmptyEquipmentSelection(),
    },
  };
}

function mergeConfig(character: Character, input?: MobileOperatorConfig): MobileOperatorConfig {
  const fallback = createDefaultConfig(character);
  return {
    ...fallback,
    ...input,
    characterId: character.id,
    skillLevels: { ...fallback.skillLevels, ...(input?.skillLevels ?? {}) },
    weapon: {
      ...fallback.weapon,
      ...(input?.weapon ?? {}),
      skillLevels: {
        ...fallback.weapon.skillLevels,
        ...(input?.weapon?.skillLevels ?? {}),
      },
    },
    equipment: Object.fromEntries(
      EQUIPMENT_SLOTS.map(({ key }) => [
        key,
        {
          ...fallback.equipment[key],
          ...(input?.equipment?.[key] ?? {}),
          effectLevels: {
            ...fallback.equipment[key].effectLevels,
            ...(input?.equipment?.[key]?.effectLevels ?? {}),
          },
        },
      ]),
    ) as MobileOperatorConfig['equipment'],
  };
}

function parseNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getPotentialOptions(currentValue: string, potentialCount: number): string[] {
  const options = ['0潜', ...Array.from({ length: Math.max(0, potentialCount) }, (_, index) => `${index + 1}潜`), '满潜'];
  return Array.from(new Set([currentValue, ...options].filter(Boolean)));
}

function getWeaponId(key: string, weapon: MobileCatalog['weapons'][string]): string {
  return weapon.id?.trim() || key;
}

function getWeaponType(weapon: MobileCatalog['weapons'][string]): string {
  return weapon.type.trim().toLocaleLowerCase();
}

function getEquipmentItems(library: EquipmentLibrary): EquipmentItem[] {
  const itemMap = new Map<string, EquipmentItem>();
  Object.values(library.gearSets).forEach((gearSet) => {
    Object.values(gearSet.equipments).forEach((item) => {
      if (!itemMap.has(item.equipmentId)) itemMap.set(item.equipmentId, item);
    });
  });
  return Array.from(itemMap.values()).sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
}

function getEffectLevelOptions(effect: EquipmentEffect): number[] {
  const levels = Object.keys(effect.levels)
    .map((level) => Number(level))
    .filter((level) => Number.isFinite(level))
    .sort((left, right) => left - right);
  return levels.length > 0 ? levels : [0];
}

function getDefaultEffectLevel(effect: EquipmentEffect): number {
  return getEffectLevelOptions(effect).at(-1) ?? 0;
}

function formatNumber(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(value * 100 >= 10 ? 1 : 2).replace(/\.0+$/, '')}%`;
}

function getCharacterSkill(character: Character, skillType: Exclude<SkillType, 'Dot'>) {
  if (skillType === 'A') return character.skills.normalAttack;
  if (skillType === 'B') return character.skills.skill;
  if (skillType === 'E') return character.skills.chainSkill;
  return character.skills.ultimate;
}

function getSkillIconUrl(character: Character, skillType: Exclude<SkillType, 'Dot'>): string {
  return normalizeAssetUrl(character.skillIconMap?.[skillType]) || resolveSkillIconUrl(character.name, skillType);
}

function getWeaponImageUrl(weapon?: MobileCatalog['weapons'][string]): string {
  return normalizeAssetUrl(weapon?.imgUrl);
}

function getEquipmentImageUrl(item?: EquipmentItem): string {
  return normalizeAssetUrl(item?.imgUrl);
}

function createEquipmentSelection(
  item?: EquipmentItem,
): MobileOperatorConfig['equipment'][MobileEquipmentSlotKey] {
  if (!item) return createEmptyEquipmentSelection();
  return {
    equipmentId: item.equipmentId,
    effectLevels: Object.fromEntries(
      Object.entries(item.effects).map(([effectId, effect]) => [
        effectId,
        getDefaultEffectLevel(effect as EquipmentEffect),
      ]),
    ) as MobileOperatorConfig['equipment'][MobileEquipmentSlotKey]['effectLevels'],
  };
}

export function MobileOperatorConfigPage({
  characters,
  selectedOperatorIds,
  activeOperatorId,
  configs,
  weapons,
  equipment,
  configSnapshot,
  onActiveOperatorChange,
  onConfigChange,
}: MobileOperatorConfigPageProps) {
  const [isPanelDetailOpen, setIsPanelDetailOpen] = useState(false);
  const [picker, setPicker] = useState<ConfigPicker | null>(null);

  const selectedCharacters = useMemo(() => {
    const characterMap = new Map(
      characters
        .filter((character) => character.librarySource !== 'local')
        .map((character) => [character.id, character] as const),
    );
    return selectedOperatorIds
      .map((operatorId) => characterMap.get(operatorId))
      .filter((character): character is Character => Boolean(character));
  }, [characters, selectedOperatorIds]);

  const activeCharacter = selectedCharacters.find((character) => character.id === activeOperatorId) ?? selectedCharacters[0] ?? null;
  const resolvedActiveOperatorId = activeCharacter?.id ?? '';
  const currentConfig = useMemo(
    () => activeCharacter ? mergeConfig(activeCharacter, configs[resolvedActiveOperatorId]) : null,
    [activeCharacter, configs, resolvedActiveOperatorId],
  );

  useEffect(() => {
    setIsPanelDetailOpen(false);
    setPicker(null);
  }, [resolvedActiveOperatorId]);

  const equipmentItems = useMemo(() => getEquipmentItems(equipment), [equipment]);
  const weaponEntries = useMemo(
    () => Object.entries(weapons).sort(([, left], [, right]) => left.name.localeCompare(right.name, 'zh-CN')),
    [weapons],
  );

  const compatibleWeapons = useMemo(() => {
    if (!activeCharacter) return [];
    const characterWeaponType = activeCharacter.weapon?.trim().toLocaleLowerCase() ?? '';
    if (!characterWeaponType) return weaponEntries;
    return weaponEntries.filter(([, weapon]) => getWeaponType(weapon) === characterWeaponType);
  }, [activeCharacter, weaponEntries]);

  const currentWeapon = useMemo(() => {
    if (!currentConfig?.weapon.weaponId) return undefined;
    return weaponEntries.find(([key, weapon]) => getWeaponId(key, weapon) === currentConfig.weapon.weaponId)?.[1]
      ?? weapons[currentConfig.weapon.weaponId];
  }, [currentConfig?.weapon.weaponId, weaponEntries, weapons]);

  const patchConfig = (updater: (config: MobileOperatorConfig) => MobileOperatorConfig) => {
    if (!activeCharacter || !currentConfig) return;
    onConfigChange(resolvedActiveOperatorId, updater(currentConfig));
  };

  const patchEquipment = (
    slotKey: MobileEquipmentSlotKey,
    updater: (selection: MobileOperatorConfig['equipment'][MobileEquipmentSlotKey]) => MobileOperatorConfig['equipment'][MobileEquipmentSlotKey],
  ) => {
    patchConfig((config) => ({
      ...config,
      equipment: {
        ...config.equipment,
        [slotKey]: updater(config.equipment[slotKey]),
      },
    }));
  };

  const chooseWeapon = (weaponId: string) => {
    patchConfig((config) => ({
      ...config,
      weapon: { ...config.weapon, weaponId },
    }));
    setPicker(null);
  };

  const chooseEquipment = (slotKey: MobileEquipmentSlotKey, equipmentId: string) => {
    const nextItem = equipmentItems.find((item) => item.equipmentId === equipmentId);
    patchEquipment(slotKey, () => createEquipmentSelection(nextItem));
    setPicker(null);
  };

  if (!activeCharacter || !currentConfig) {
    return (
      <main className="mobile-operator-config-page">
        <div className="mobile-operator-config-empty">
          <span className="mobile-operator-config-empty-mark" aria-hidden="true">◎</span>
          <strong>还没有选择干员</strong>
          <p>先在选人页加入至少一名官方干员，再回来完成配置。</p>
        </div>
      </main>
    );
  }

  const potentialOptions = getPotentialOptions(currentConfig.potential, activeCharacter.potentials?.length ?? 6);
  const weaponPotentialOptions = getPotentialOptions(currentConfig.weapon.potential, 6);
  const selectedWeaponIsCompatible = compatibleWeapons.some(
    ([key, weapon]) => getWeaponId(key, weapon) === currentConfig.weapon.weaponId,
  );
  const pickerEquipmentSlot = picker?.kind === 'equipment'
    ? EQUIPMENT_SLOTS.find(({ key }) => key === picker.slotKey) ?? null
    : null;
  const pickerEquipmentItems = pickerEquipmentSlot
    ? equipmentItems.filter((item) => item.part === pickerEquipmentSlot.part)
    : [];
  const pickerEquipmentSelection = pickerEquipmentSlot
    ? currentConfig.equipment[pickerEquipmentSlot.key]
    : null;

  return (
    <main className="mobile-operator-config-page">
      <div className="mobile-operator-config-portrait-warning" role="status">
        <span aria-hidden="true">↻</span>
        <strong>请旋转回竖屏</strong>
        <small>手机版配置页为竖屏布局</small>
      </div>

      <div className="mobile-operator-config-content">
        <header className="mobile-operator-config-header">
          <div>
            <span className="mobile-operator-config-eyebrow">OPERATOR LOADOUT</span>
            <h1>干员配置</h1>
            <p>修改会立即应用到当前移动端计算</p>
          </div>
          <span className="mobile-operator-config-live-badge"><i aria-hidden="true" />实时</span>
        </header>

        <section className="mobile-operator-config-switcher" aria-label="切换干员">
          <div className="mobile-operator-config-section-caption">
            <span>当前干员</span>
            <span>{selectedCharacters.length} 人队伍</span>
          </div>
          <div className="mobile-operator-config-switcher-list">
            {selectedCharacters.map((character) => (
              <button
                type="button"
                key={character.id}
                className={`mobile-operator-config-switcher-item${character.id === resolvedActiveOperatorId ? ' is-active' : ''}`}
                onClick={() => onActiveOperatorChange(character.id)}
                aria-pressed={character.id === resolvedActiveOperatorId}
              >
                <img src={normalizeAssetUrl(character.avatarUrl) || resolveAvatarUrl(character.name)} alt="" />
                <span>{character.name}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="mobile-operator-config-identity-card">
          <div className="mobile-operator-config-identity-avatar">
            <img src={normalizeAssetUrl(activeCharacter.avatarUrl) || resolveAvatarUrl(activeCharacter.name)} alt="" />
          </div>
          <div className="mobile-operator-config-identity-copy">
            <h2>{activeCharacter.name}</h2>
            <p>{activeCharacter.profession || '未分类'} · {ELEMENT_LABELS[activeCharacter.element] || activeCharacter.element}</p>
          </div>
          <span className="mobile-operator-config-identity-index">{selectedCharacters.findIndex((character) => character.id === resolvedActiveOperatorId) + 1}</span>
        </section>

        <section className="mobile-operator-config-card" aria-labelledby="mobile-operator-basic-title">
          <div className="mobile-operator-config-card-heading">
            <div>
              <span className="mobile-operator-config-section-kicker">BASE</span>
              <h2 id="mobile-operator-basic-title">干员参数</h2>
            </div>
            <span className="mobile-operator-config-card-note">实时计算</span>
          </div>
          <div className="mobile-operator-config-field-grid">
            <label className="mobile-operator-config-field">
              <span>等级</span>
              <select
                value={String(currentConfig.level)}
                onChange={(event) => patchConfig((config) => ({ ...config, level: parseNumber(event.target.value, config.level) }))}
              >
                {CHARACTER_LEVELS.map((level) => <option value={level} key={level}>{level} 级</option>)}
              </select>
            </label>
            <label className="mobile-operator-config-field">
              <span>潜能</span>
              <select
                value={currentConfig.potential}
                onChange={(event) => patchConfig((config) => ({ ...config, potential: event.target.value }))}
              >
                {potentialOptions.map((potential) => <option value={potential} key={potential}>{potential}</option>)}
              </select>
            </label>
            <label className="mobile-operator-config-field">
              <span>信赖 / 好感</span>
              <input
                type="number"
                min="0"
                step="1"
                value={currentConfig.favorValue}
                onChange={(event) => patchConfig((config) => ({ ...config, favorValue: parseNumber(event.target.value, config.favorValue) }))}
              />
            </label>
            <label className="mobile-operator-config-field">
              <span>{activeCharacter.mainStat || '主属性'}平铺</span>
              <input
                type="number"
                min="0"
                step="1"
                value={currentConfig.mainStatFlatBonus}
                onChange={(event) => patchConfig((config) => ({ ...config, mainStatFlatBonus: parseNumber(event.target.value, config.mainStatFlatBonus) }))}
              />
            </label>
            <label className="mobile-operator-config-field">
              <span>{activeCharacter.subStat || '副属性'}平铺</span>
              <input
                type="number"
                min="0"
                step="1"
                value={currentConfig.subStatFlatBonus}
                onChange={(event) => patchConfig((config) => ({ ...config, subStatFlatBonus: parseNumber(event.target.value, config.subStatFlatBonus) }))}
              />
            </label>
          </div>
        </section>

        <section className="mobile-operator-config-card" aria-labelledby="mobile-operator-skill-title">
          <div className="mobile-operator-config-card-heading">
            <div>
              <span className="mobile-operator-config-section-kicker">SKILLS</span>
              <h2 id="mobile-operator-skill-title">技能等级</h2>
            </div>
            <span className="mobile-operator-config-card-note">A / B / E / Q</span>
          </div>
          <div className="mobile-operator-config-skill-list">
            {SKILL_ITEMS.map(({ key, label }) => {
              const skill = getCharacterSkill(activeCharacter, key);
              return (
                <label className="mobile-operator-config-skill-row" key={key}>
                  <span className="mobile-operator-config-skill-icon">
                    <img src={getSkillIconUrl(activeCharacter, key)} alt="" />
                    <b>{key}</b>
                  </span>
                  <span className="mobile-operator-config-skill-copy">
                    <strong>{label}</strong>
                    <small>{skill.name || '未命名技能'}</small>
                  </span>
                  <select
                    value={currentConfig.skillLevels[key]}
                    onChange={(event) => patchConfig((config) => ({
                      ...config,
                      skillLevels: { ...config.skillLevels, [key]: event.target.value },
                    }))}
                    aria-label={`${label}等级`}
                  >
                    {Array.from(new Set([currentConfig.skillLevels[key], ...SKILL_LEVEL_OPTIONS])).map((level) => (
                      <option value={level} key={level}>{level}</option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
        </section>

        <section className="mobile-operator-config-card" aria-labelledby="mobile-operator-weapon-title">
          <div className="mobile-operator-config-card-heading">
            <div>
              <span className="mobile-operator-config-section-kicker">WEAPON</span>
              <h2 id="mobile-operator-weapon-title">武器装备</h2>
            </div>
            <span className="mobile-operator-config-card-note">{activeCharacter.weapon ? `类型：${activeCharacter.weapon}` : '全部类型'}</span>
          </div>

          <button
            type="button"
            className="mobile-operator-config-picker-trigger"
            onClick={() => setPicker({ kind: 'weapon' })}
            aria-haspopup="dialog"
            aria-expanded={picker?.kind === 'weapon'}
          >
            <span className="mobile-operator-config-picker-image">
              {getWeaponImageUrl(currentWeapon) ? <img src={getWeaponImageUrl(currentWeapon)} alt="" /> : <span aria-hidden="true">◇</span>}
            </span>
            <span className="mobile-operator-config-picker-copy">
              <small>兼容武器</small>
              <strong>{currentWeapon?.name || '暂不装备武器'}</strong>
              <span>{currentWeapon?.type || '点击打开图片卡片选择'}</span>
            </span>
            <span className="mobile-operator-config-picker-arrow" aria-hidden="true">›</span>
          </button>

          {currentWeapon && !selectedWeaponIsCompatible && (
            <p className="mobile-operator-config-warning">当前配置的武器与干员武器类型不匹配，请重新选择。</p>
          )}
          {activeCharacter.weapon && compatibleWeapons.length === 0 && (
            <p className="mobile-operator-config-muted">线上目录中暂时没有匹配“{activeCharacter.weapon}”的武器。</p>
          )}

          <div className="mobile-operator-config-field-grid">
            <label className="mobile-operator-config-field">
              <span>武器等级</span>
              <select
                value={String(currentConfig.weapon.level)}
                onChange={(event) => patchConfig((config) => ({
                  ...config,
                  weapon: { ...config.weapon, level: parseNumber(event.target.value, config.weapon.level) },
                }))}
              >
                {Array.from(new Set([
                  currentConfig.weapon.level,
                  ...CHARACTER_LEVELS,
                  ...Object.keys(currentWeapon?.attackGrowth ?? {}).map((level) => Number(level)).filter(Number.isFinite),
                ])).sort((left, right) => Number(left) - Number(right)).map((level) => (
                  <option value={level} key={level}>{level} 级</option>
                ))}
              </select>
            </label>
            <label className="mobile-operator-config-field">
              <span>武器潜能</span>
              <select
                value={currentConfig.weapon.potential}
                onChange={(event) => patchConfig((config) => ({
                  ...config,
                  weapon: { ...config.weapon, potential: event.target.value },
                }))}
              >
                {weaponPotentialOptions.map((potential) => <option value={potential} key={potential}>{potential}</option>)}
              </select>
            </label>
          </div>

          <div className="mobile-operator-config-weapon-skills">
            {WEAPON_SKILL_KEYS.map((skillKey) => {
              const skill = currentWeapon?.skills?.[skillKey];
              return (
                <label className="mobile-operator-config-weapon-skill" key={skillKey}>
                  <span>{WEAPON_SKILL_LABELS[skillKey]}</span>
                  <small>{skill?.name || '未选择'}</small>
                  <select
                    value={String(currentConfig.weapon.skillLevels[skillKey])}
                    onChange={(event) => patchConfig((config) => ({
                      ...config,
                      weapon: {
                        ...config.weapon,
                        skillLevels: {
                          ...config.weapon.skillLevels,
                          [skillKey]: parseNumber(event.target.value, config.weapon.skillLevels[skillKey]),
                        },
                      },
                    }))}
                    aria-label={`${WEAPON_SKILL_LABELS[skillKey]}等级`}
                  >
                    {Array.from({ length: 9 }, (_, index) => index + 1).map((level) => (
                      <option value={level} key={level}>{level} 级</option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
        </section>

        <section className="mobile-operator-config-card" aria-labelledby="mobile-operator-equipment-title">
          <div className="mobile-operator-config-card-heading">
            <div>
              <span className="mobile-operator-config-section-kicker">EQUIPMENT</span>
              <h2 id="mobile-operator-equipment-title">装备槽位</h2>
            </div>
            <span className="mobile-operator-config-card-note">部位已筛选</span>
          </div>

          <div className="mobile-operator-config-equipment-list">
            {EQUIPMENT_SLOTS.map(({ key, label, part }) => {
              const selection = currentConfig.equipment[key];
              const selectedItem = equipmentItems.find((item) => item.equipmentId === selection.equipmentId);
              const options = equipmentItems.filter((item) => item.part === part);
              return (
                <article className="mobile-operator-config-equipment-slot" key={key}>
                  <div className="mobile-operator-config-equipment-heading">
                    <div className="mobile-operator-config-equipment-copy">
                      <strong>{label}</strong>
                      <small>{selectedItem?.name || '未配置'}</small>
                      <span>{part} · {options.length} 件</span>
                    </div>
                    <button
                      type="button"
                      className="mobile-operator-config-equipment-image"
                      onClick={() => setPicker({ kind: 'equipment', slotKey: key })}
                      aria-label={`${selectedItem ? '更换' : '选择'}${label}`}
                      aria-haspopup="dialog"
                      aria-expanded={picker?.kind === 'equipment' && picker.slotKey === key}
                    >
                      {getEquipmentImageUrl(selectedItem) ? <img src={getEquipmentImageUrl(selectedItem)} alt="" /> : <span aria-hidden="true">＋</span>}
                    </button>
                  </div>

                  {selectedItem && Object.values(selectedItem.effects).length > 0 && (
                    <div className="mobile-operator-config-effect-list">
                      {Object.values(selectedItem.effects).map((effect) => {
                        if (!effect) return null;
                        const currentLevel = selection.effectLevels[effect.effectId] ?? getDefaultEffectLevel(effect);
                        return (
                          <label className="mobile-operator-config-effect-row" key={effect.effectId}>
                            <span>{effect.label}</span>
                            <select
                              value={String(currentLevel)}
                              onChange={(event) => patchEquipment(key, (currentSelection) => ({
                                ...currentSelection,
                                effectLevels: {
                                  ...currentSelection.effectLevels,
                                  [effect.effectId]: parseNumber(event.target.value, currentLevel),
                                },
                              }))}
                              aria-label={`${label}${effect.label}等级`}
                            >
                              {getEffectLevelOptions(effect).map((level) => <option value={level} key={level}>{level} 级</option>)}
                            </select>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>

        <section className="mobile-operator-config-summary-card" aria-labelledby="mobile-operator-summary-title">
          <button
            type="button"
            className="mobile-operator-config-summary-toggle"
            onClick={() => setIsPanelDetailOpen((open) => !open)}
            aria-expanded={isPanelDetailOpen}
          >
            <span>
              <span className="mobile-operator-config-section-kicker">SNAPSHOT</span>
              <strong id="mobile-operator-summary-title">面板摘要</strong>
            </span>
            <span className="mobile-operator-config-summary-chevron" aria-hidden="true">{isPanelDetailOpen ? '⌃' : '⌄'}</span>
          </button>

          {configSnapshot ? (
            <>
              <div className="mobile-operator-config-summary-metrics">
                <div><span>攻击力</span><strong>{formatNumber(configSnapshot.panel.display.atk)}</strong></div>
                <div><span>生命值</span><strong>{formatNumber(configSnapshot.panel.display.hp)}</strong></div>
                <div><span>暴击率</span><strong>{formatPercent(configSnapshot.panel.display.critRate)}</strong></div>
                <div><span>源石技艺</span><strong>{formatNumber(configSnapshot.panel.display.sourceSkill)}</strong></div>
              </div>

              {isPanelDetailOpen && (
                <div className="mobile-operator-config-summary-details">
                  <div className="mobile-operator-config-summary-detail-line">
                    <span>基础攻击力</span><strong>{formatNumber(configSnapshot.panel.display.baseAtk)}</strong>
                    <span>主属性</span><strong>{formatNumber(configSnapshot.panel.display.mainStatFinal)}</strong>
                    <span>副属性</span><strong>{formatNumber(configSnapshot.panel.display.subStatFinal)}</strong>
                  </div>
                  {configSnapshot.panel.display.groups.map((group) => (
                    <details className="mobile-operator-config-display-group" key={group.title}>
                      <summary>{group.title}<span>{group.items.length} 项</span></summary>
                      <div>
                        {group.items.map((item) => <p key={`${group.title}-${item.label}`}><span>{item.label}</span><strong>{item.value}</strong></p>)}
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="mobile-operator-config-summary-empty">完成基础配置后，面板摘要会在这里更新。</p>
          )}
        </section>
      </div>

      {picker ? (
        <MobilePortal>
          <div
            className="mobile-operator-config-picker-backdrop"
            role="presentation"
            onClick={() => setPicker(null)}
          >
            <section
              className="mobile-operator-config-picker-sheet"
              role="dialog"
              aria-modal="true"
              aria-labelledby="mobile-operator-config-picker-title"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="mobile-operator-config-picker-header">
                <div>
                  <span className="mobile-operator-config-section-kicker">LOADOUT</span>
                  <h2 id="mobile-operator-config-picker-title">
                    {picker.kind === 'weapon'
                      ? '选择武器'
                      : `${pickerEquipmentSlot?.label ?? '装备'} · 选择装备`}
                  </h2>
                  <p>
                    {picker.kind === 'weapon'
                      ? `${compatibleWeapons.length} 件兼容武器`
                      : `${pickerEquipmentItems.length} 件${pickerEquipmentSlot?.part ?? '装备'}可选`}
                  </p>
                </div>
                <button type="button" className="mobile-operator-config-picker-close" onClick={() => setPicker(null)} aria-label="关闭">×</button>
              </header>

              {picker.kind === 'weapon' ? (
                <div className="mobile-operator-config-picker-grid">
                  <button
                    type="button"
                    className={`mobile-operator-config-picker-card is-empty${!selectedWeaponIsCompatible ? ' is-selected' : ''}`}
                    onClick={() => chooseWeapon('')}
                    aria-pressed={!selectedWeaponIsCompatible}
                  >
                    <span className="mobile-operator-config-picker-card-image" aria-hidden="true">◇</span>
                    <span className="mobile-operator-config-picker-card-copy">
                      <strong>暂不装备武器</strong>
                      <small>清空当前武器</small>
                    </span>
                    <span className="mobile-operator-config-picker-check" aria-hidden="true">{!selectedWeaponIsCompatible ? '✓' : '＋'}</span>
                  </button>
                  {compatibleWeapons.map(([key, weapon]) => {
                    const weaponId = getWeaponId(key, weapon);
                    const selected = selectedWeaponIsCompatible && currentConfig.weapon.weaponId === weaponId;
                    return (
                      <button
                        type="button"
                        key={weaponId}
                        className={`mobile-operator-config-picker-card${selected ? ' is-selected' : ''}`}
                        onClick={() => chooseWeapon(weaponId)}
                        aria-pressed={selected}
                      >
                        <span className="mobile-operator-config-picker-card-image">
                          {getWeaponImageUrl(weapon) ? <img src={getWeaponImageUrl(weapon)} alt="" loading="lazy" /> : <span aria-hidden="true">◇</span>}
                        </span>
                        <span className="mobile-operator-config-picker-card-copy">
                          <strong>{weapon.name}</strong>
                          <small>{weapon.type || '未分类'}{weapon.rarity ? ` · ${weapon.rarity}★` : ''}</small>
                        </span>
                        <span className="mobile-operator-config-picker-check" aria-hidden="true">{selected ? '✓' : '›'}</span>
                      </button>
                    );
                  })}
                </div>
              ) : pickerEquipmentSlot ? (
                <div className="mobile-operator-config-picker-grid">
                  <button
                    type="button"
                    className={`mobile-operator-config-picker-card is-empty${!pickerEquipmentSelection?.equipmentId ? ' is-selected' : ''}`}
                    onClick={() => chooseEquipment(pickerEquipmentSlot.key, '')}
                    aria-pressed={!pickerEquipmentSelection?.equipmentId}
                  >
                    <span className="mobile-operator-config-picker-card-image" aria-hidden="true">＋</span>
                    <span className="mobile-operator-config-picker-card-copy">
                      <strong>暂不装备</strong>
                      <small>清空{pickerEquipmentSlot.label}</small>
                    </span>
                    <span className="mobile-operator-config-picker-check" aria-hidden="true">{!pickerEquipmentSelection?.equipmentId ? '✓' : '＋'}</span>
                  </button>
                  {pickerEquipmentItems.map((item) => {
                    const selected = pickerEquipmentSelection?.equipmentId === item.equipmentId;
                    const effectLabels = Object.values(item.effects)
                      .filter((effect): effect is EquipmentEffect => Boolean(effect))
                      .slice(0, 2)
                      .map((effect) => effect.label)
                      .join(' · ');
                    return (
                      <button
                        type="button"
                        key={item.equipmentId}
                        className={`mobile-operator-config-picker-card${selected ? ' is-selected' : ''}`}
                        onClick={() => chooseEquipment(pickerEquipmentSlot.key, item.equipmentId)}
                        aria-pressed={selected}
                      >
                        <span className="mobile-operator-config-picker-card-image">
                          {getEquipmentImageUrl(item) ? <img src={getEquipmentImageUrl(item)} alt="" loading="lazy" /> : <span aria-hidden="true">＋</span>}
                        </span>
                        <span className="mobile-operator-config-picker-card-copy">
                          <strong>{item.name}</strong>
                          <small>{effectLabels || item.part}</small>
                        </span>
                        <span className="mobile-operator-config-picker-check" aria-hidden="true">{selected ? '✓' : '›'}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </section>
          </div>
        </MobilePortal>
      ) : null}
    </main>
  );
}
