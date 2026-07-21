import { Fragment, useEffect, useMemo, useState } from 'react';
import './OperatorDraftPage.css';
import { navigateToAppPath } from '../utils/appRoute';
import { normalizeAssetUrl } from '../utils/assetResolver';
import { imageBridge } from '../utils/imageBridge';
import { toUserImageRelPath } from '../utils/imageFileService';
import DeferredNumberInput, { parseIntegerInput } from './DeferredNumberInput';
import * as draftBuffModel from './operatorDraftBuffModel';
import BuffEffectEditorDrawer from './BuffEffectEditorDrawer';

import {
  ABILITY_OPTIONS,
  ASSET_PATH_OPTIONS,
  ATTRIBUTE_LEVEL_KEYS,
  ATTRIBUTE_LEVEL_LABELS,
  ATTRIBUTE_ROWS,
  AVATAR_ASSET_OPTIONS,
  ELEMENT_OPTIONS,
  OPERATOR_BUFF_BUSINESS_TYPE_LABELS,
  OPERATOR_BUFF_GROUPS,
  OPERATOR_DRAFT_NAV_LINKS,
  PROFESSION_OPTIONS,
  RARITY_OPTIONS,
  SKILL_LEVEL_KEYS,
  SKILL_TYPE_FILTERS,
  WEAPON_OPTIONS,
  buildOperatorIdFromName,
  buildOrderedDraft,
  cloneDraft,
  createDefaultBuffEffect,
  createDefaultHit,
  createDefaultSkill,
  getNextBuffEffectKey,
  getNextHitKey,
  getNextSkillKeyByType,
  getOperatorBuffTypeDisplayLabel,
  getSkillFilterKey,
  isDraftPath,
  loadDraftFromStorage,
  moveSkillKey,
  syncHitCount,
  syncSkillOrderWithDraft,
  type AttributeKey,
  type AttributeLevelKey,
  type HitElement,
  type HitMetaDraft,
  type HitSkillType,
  type OperatorBuffEffect,
  type OperatorBuffGroupKey,
  type OperatorDraft,
  type SkillButtonType,
  type SkillDraft,
  type SkillTypeFilter,
} from './operatorDraftPageModel';

import { renderMiniMarkdown, SearchablePathSelect } from './OperatorDraftFields';
import { useOperatorDraftLibrary } from './useOperatorDraftLibrary';

export { isDraftPath };

export function OperatorDraftPage() {
  const [draft, setDraft] = useState<OperatorDraft>(() => loadDraftFromStorage());
  const [messages, setMessages] = useState<string[]>([
    '已进入干员模板编辑器',
  ]);
  const [selectedSkillKey, setSelectedSkillKey] = useState<string | null>(null);
  const [selectedHitKey, setSelectedHitKey] = useState<string | null>(null);
  const [activeBuffGroupKey, setActiveBuffGroupKey] = useState<OperatorBuffGroupKey>('talent');
  const [selectedBuffEffectKey, setSelectedBuffEffectKey] = useState<string | null>(null);
  const [isBuffDrawerOpen, setIsBuffDrawerOpen] = useState(false);
  const [skillOrder, setSkillOrder] = useState<string[]>([]);
  const [activeSkillTypeFilter, setActiveSkillTypeFilter] = useState<SkillTypeFilter>('all');
  const [draggingSkillKey, setDraggingSkillKey] = useState<string | null>(null);
  const [dragOverSkillKey, setDragOverSkillKey] = useState<string | null>(null);
  const [userAssetPathOptions, setUserAssetPathOptions] = useState<string[]>([]);

  useEffect(() => {
    const skillKeys = Object.keys(draft.skills);
    if (!selectedSkillKey || !draft.skills[selectedSkillKey]) {
      setSelectedSkillKey(skillKeys[0] ?? null);
    }
  }, [draft, selectedSkillKey]);

  useEffect(() => {
    if (activeSkillTypeFilter === 'all') {
      return;
    }
    if (selectedSkillKey && draft.skills[selectedSkillKey] && getSkillFilterKey(draft.skills[selectedSkillKey]) === activeSkillTypeFilter) {
      return;
    }

    const nextSelectedSkillKey = skillOrder.find((skillKey) => {
      const skill = draft.skills[skillKey];
      return skill && getSkillFilterKey(skill) === activeSkillTypeFilter;
    }) ?? null;
    setSelectedSkillKey(nextSelectedSkillKey);
    setSelectedHitKey(nextSelectedSkillKey ? Object.keys(draft.skills[nextSelectedSkillKey].hitMeta)[0] ?? null : null);
  }, [activeSkillTypeFilter, draft, selectedSkillKey, skillOrder]);

  useEffect(() => {
    setSkillOrder((prev) => {
      const next = syncSkillOrderWithDraft(prev, draft);
      return next.length === prev.length && next.every((skillKey, index) => skillKey === prev[index]) ? prev : next;
    });
  }, [draft]);

  useEffect(() => {
    let isMounted = true;

    const loadUserAssetOptions = async () => {
      try {
        const assets = await imageBridge.listAssets();
        if (!isMounted) return;
        const paths = assets
          .map((asset) => {
            const relPath = toUserImageRelPath(asset);
            return relPath ? `user-images/${relPath}` : '';
          })
          .filter((path): path is string => Boolean(path));
        setUserAssetPathOptions(Array.from(new Set(paths)).sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true })));
      } catch {
        if (isMounted) {
          setUserAssetPathOptions([]);
        }
      }
    };

    void loadUserAssetOptions();

    return () => {
      isMounted = false;
    };
  }, []);

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
    const effects = draft.buffs[activeBuffGroupKey]?.effects ?? {};
    const effectKeys = Object.keys(effects);
    if (!selectedBuffEffectKey || !effects[selectedBuffEffectKey]) {
      setSelectedBuffEffectKey(effectKeys[0] ?? null);
    }
  }, [activeBuffGroupKey, draft.buffs, selectedBuffEffectKey]);

  const selectedSkill = selectedSkillKey ? draft.skills[selectedSkillKey] : null;
  const selectedHit = selectedSkill && selectedHitKey ? selectedSkill.hitMeta[selectedHitKey] : null;
  const activeBuffGroup = draft.buffs[activeBuffGroupKey];
  const buffEffectEntries = Object.entries(activeBuffGroup.effects);
  const selectedBuffEffect = selectedBuffEffectKey ? activeBuffGroup.effects[selectedBuffEffectKey] ?? null : null;
  const latestMessage = messages[0] ?? '';

  const assetPathOptions = useMemo(
    () => Array.from(new Set([...userAssetPathOptions, ...ASSET_PATH_OPTIONS])),
    [userAssetPathOptions],
  );
  const avatarAssetOptions = useMemo(
    () => Array.from(new Set([...userAssetPathOptions, ...AVATAR_ASSET_OPTIONS])),
    [userAssetPathOptions],
  );

  const orderedDraft = useMemo(() => buildOrderedDraft(draft, skillOrder), [draft, skillOrder]);
  const {
    library: {
      draftIds: localDraftIds,
      draftNames: localDraftNames,
      getDraftLabel: getLocalDraftLabel,
      selectedDeleteDraftId: selectedDeleteLocalDraftId,
      selectedDraftId: selectedLocalDraftId,
      setSelectedDeleteDraftId: setSelectedDeleteLocalDraftId,
      setSelectedDraftId: setSelectedLocalDraftId,
    },
    dialogs: {
      isDeleteOpen: isDeleteLocalDraftModalOpen,
      isExportOpen: isExportJsonModalOpen,
      isOverwriteOpen: isOverwriteDraftModalOpen,
      isShareOpen: isShareModalOpen,
      setDeleteOpen: setIsDeleteLocalDraftModalOpen,
      setExportOpen: setIsExportJsonModalOpen,
      setOverwriteOpen: setIsOverwriteDraftModalOpen,
    },
    share: {
      currentText: currentShareText,
      exportScope,
      importInputRef: shareImportInputRef,
      name: shareDraftName,
      pendingImport: pendingImportShare,
      setExportScope,
      setName: setShareDraftName,
    },
    preferences: {
      isOverwriteProtectionEnabled,
      setOverwriteProtectionEnabled: setIsOverwriteProtectionEnabled,
    },
    actions: {
      cancelImportShare: handleCancelImportShare,
      closeShare: handleCloseShareModal,
      confirmImportShare: handleConfirmImportShare,
      confirmOverwrite: handleConfirmOverwriteDraft,
      copyExportJson: handleCopyExportJson,
      copyShareJson: handleCopyShareJson,
      createNewDraft: handleCreateNewDraft,
      deleteLocalDraft: handleDeleteLocalDraft,
      exportLocalLibraryShare: handleExportLocalLibraryShare,
      importLocalDraft: handleImportLocalDraft,
      openExportJson: handleOpenExportJsonModal,
      openLocalLibraryManager: handleOpenLocalLibraryManager,
      openShare: handleOpenShareModal,
      openShareImportPicker: handleOpenShareImportPicker,
      reorderDraft: handleReorderDraft,
      saveAsDraft: handleSaveAsDraft,
      saveDraft: handleSaveDraft,
      selectShareFile: handleShareFileSelected,
    },
  } = useOperatorDraftLibrary({
    draft,
    orderedDraft,
    selectedHitKey,
    selectedSkillKey,
    setDraft,
    setMessages,
    setSelectedHitKey,
    setSelectedSkillKey,
    setSkillOrder,
  });
  const draftJson = useMemo(() => JSON.stringify(orderedDraft, null, 2), [orderedDraft]);

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

  const operatorMarkdown = useMemo(() => {
    const skillLines = Object.entries(orderedDraft.skills).map(([skillKey, skill]) => {
      const hitSummary = Object.entries(skill.hitMeta)
        .map(([hitKey, hit]) => `${hitKey}:${hit.displayName || '-'} / ${hit.element} / ${hit.skillType} / M3 ${hit.levels?.M3 ?? 0}`)
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
      ...ATTRIBUTE_ROWS.map(([attributeKey, label]) => `- ${label}：1/${draft.attributes[attributeKey].level1} 20/${draft.attributes[attributeKey].level20} 40/${draft.attributes[attributeKey].level40} 60/${draft.attributes[attributeKey].level60} 80/${draft.attributes[attributeKey].level80} 90/${draft.attributes[attributeKey].level90}`),
      '## 技能概览',
      ...(skillLines.length ? skillLines : ['- 暂无技能']),
      '## 干员 Buff',
      ...OPERATOR_BUFF_GROUPS.map(({ key, label }) => `- ${label}：${Object.keys(draft.buffs[key].effects).length} 个`),
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

  const updateAttributeField = (field: AttributeKey, levelKey: AttributeLevelKey, value: number) => {
    setDraft((prev) => ({
      ...prev,
      attributes: {
        ...prev.attributes,
        [field]: {
          ...prev.attributes[field],
          [levelKey]: value,
        },
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

  const updateSelectedBuffEffect = (updater: (effect: OperatorBuffEffect) => OperatorBuffEffect) => {
    if (!selectedBuffEffectKey) return;
    setDraft((prev) => ({
      ...prev,
      buffs: {
        ...prev.buffs,
        [activeBuffGroupKey]: {
          effects: {
            ...prev.buffs[activeBuffGroupKey].effects,
            [selectedBuffEffectKey]: updater(prev.buffs[activeBuffGroupKey].effects[selectedBuffEffectKey]),
          },
        },
      },
    }));
  };

  const duplicateSelectedSkill = () => {
    if (!selectedSkillKey || !selectedSkill) {
      setMessages((prev) => ['[ERR] 当前没有可复制的 skill', ...prev].slice(0, 12));
      return;
    }

    const nextSkillKey = getNextSkillKeyByType(draft, selectedSkill.buttonType);
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

  const handleAddSkill = () => {
    const nextSkillKey = getNextSkillKeyByType(draft, 'A');
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

  const handleDuplicateHit = () => {
    if (!selectedSkillKey || !selectedHitKey || !draft.skills[selectedSkillKey]?.hitMeta[selectedHitKey]) {
      setMessages((prev) => ['[ERR] 当前没有可复制的 hit', ...prev].slice(0, 12));
      return;
    }
    const nextDraft = cloneDraft(draft);
    const nextSkill = nextDraft.skills[selectedSkillKey];
    const nextHitKey = getNextHitKey(nextSkill);
    const duplicatedHit = cloneDraft(nextSkill.hitMeta[selectedHitKey]);
    nextSkill.hitMeta[nextHitKey] = {
      ...duplicatedHit,
      displayName: `${duplicatedHit.displayName || selectedHitKey} 副本`,
    };
    syncHitCount(nextSkill);
    setDraft(nextDraft);
    setSelectedHitKey(nextHitKey);
    setMessages((prev) => [`[OK] 已复制 ${selectedSkillKey}.${selectedHitKey} -> ${nextHitKey}`, ...prev].slice(0, 12));
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

  const handleAddBuffEffect = () => {
    const nextEffectKey = getNextBuffEffectKey(activeBuffGroup.effects);
    setDraft((prev) => ({
      ...prev,
      buffs: {
        ...prev.buffs,
        [activeBuffGroupKey]: {
          effects: {
            ...prev.buffs[activeBuffGroupKey].effects,
            [nextEffectKey]: createDefaultBuffEffect(nextEffectKey),
          },
        },
      },
    }));
    setSelectedBuffEffectKey(nextEffectKey);
    setIsBuffDrawerOpen(true);
    setMessages((prev) => [`[OK] 已新增 ${activeBuffGroupKey}.${nextEffectKey}`, ...prev].slice(0, 12));
  };

  const handleDuplicateBuffEffect = () => {
    if (!selectedBuffEffectKey || !selectedBuffEffect) {
      setMessages((prev) => ['[ERR] 当前没有可复制的 Buff effect', ...prev].slice(0, 12));
      return;
    }
    const nextEffectKey = getNextBuffEffectKey(activeBuffGroup.effects);
    setDraft((prev) => ({
      ...prev,
      buffs: {
        ...prev.buffs,
        [activeBuffGroupKey]: {
          effects: {
            ...prev.buffs[activeBuffGroupKey].effects,
            [nextEffectKey]: {
              ...cloneDraft(selectedBuffEffect),
              effectId: nextEffectKey,
              name: `${selectedBuffEffect.name || selectedBuffEffectKey} 副本`,
            },
          },
        },
      },
    }));
    setSelectedBuffEffectKey(nextEffectKey);
    setIsBuffDrawerOpen(true);
    setMessages((prev) => [`[OK] 已复制 Buff effect：${selectedBuffEffectKey} -> ${nextEffectKey}`, ...prev].slice(0, 12));
  };

  const handleRemoveBuffEffect = () => {
    if (!selectedBuffEffectKey || !activeBuffGroup.effects[selectedBuffEffectKey]) {
      setMessages((prev) => ['[ERR] 当前没有可删除的 Buff effect', ...prev].slice(0, 12));
      return;
    }
    const nextEffects = { ...activeBuffGroup.effects };
    delete nextEffects[selectedBuffEffectKey];
    const nextSelectedEffectKey = Object.keys(nextEffects)[0] ?? null;
    setDraft((prev) => ({
      ...prev,
      buffs: {
        ...prev.buffs,
        [activeBuffGroupKey]: { effects: nextEffects },
      },
    }));
    setSelectedBuffEffectKey(nextSelectedEffectKey);
    setIsBuffDrawerOpen(false);
    setMessages((prev) => [`[OK] 已删除 ${activeBuffGroupKey}.${selectedBuffEffectKey}`, ...prev].slice(0, 12));
  };

  const handleNavigate = (path: string) => {
    navigateToAppPath(path);
  };

  const handleSkillDragStart = (skillKey: string) => {
    if (activeSkillTypeFilter !== 'all') {
      return;
    }
    setDraggingSkillKey(skillKey);
    setDragOverSkillKey(skillKey);
  };

  const handleSkillDrop = (targetSkillKey: string) => {
    if (activeSkillTypeFilter !== 'all') {
      setDraggingSkillKey(null);
      setDragOverSkillKey(null);
      return;
    }
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
  const skillFilterCounts = skillEntries.reduce<Record<SkillTypeFilter, number>>((counts, [, skill]) => {
    counts.all += 1;
    counts[getSkillFilterKey(skill)] += 1;
    return counts;
  }, {
    all: 0,
    A: 0,
    B: 0,
    E: 0,
    Q: 0,
    Dot: 0,
    other: 0,
  });
  const displayedSkillEntries = activeSkillTypeFilter === 'all'
    ? skillEntries
    : skillEntries.filter(([, skill]) => getSkillFilterKey(skill) === activeSkillTypeFilter);
  const isSkillDragEnabled = activeSkillTypeFilter === 'all';

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
                  <p className="operator-draft-subtitle">本地草稿、工作台编辑，底部导出 JSON。</p>
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
                      <span>载入本地草稿</span>
                      <select value={selectedLocalDraftId} onChange={(event) => setSelectedLocalDraftId(event.target.value)}>
                        <option value="">选择要载入的草稿</option>
                        {localDraftIds.map((draftId) => (
                          <option key={draftId} value={draftId}>
                            {getLocalDraftLabel(draftId)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="operator-draft-command-actions">
                      <button type="button" className="operator-draft-ghost-button" onClick={handleImportLocalDraft}>
                        载入为当前草稿
                      </button>
                      <button
                        type="button"
                        className="operator-draft-ghost-button"
                        onClick={handleOpenLocalLibraryManager}
                        disabled={localDraftIds.length === 0}
                      >
                        管理本地库
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
                  {latestMessage ? <div className="operator-draft-latest-message">{latestMessage}</div> : null}
                </div>
              </section>

              <section className="operator-draft-nav-panel">
                <div className="operator-draft-section-header">
                  <h3>页面跳转</h3>
                </div>
                <div className="operator-draft-nav-grid">
                  {OPERATOR_DRAFT_NAV_LINKS.map((link) => (
                    <button
                      key={link.path}
                      type="button"
                      className="operator-draft-ghost-button"
                      onClick={() => handleNavigate(link.path)}
                    >
                      {link.label}
                    </button>
                  ))}
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
                        整理命名
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
                        options={avatarAssetOptions}
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
                    <DeferredNumberInput
                      value={draft.level}
                      parse={parseIntegerInput}
                      onCommit={(value) => updateOperatorField('level', value ?? 0)}
                    />
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
                  <div className="operator-draft-attribute-matrix">
                    <div className="operator-draft-attribute-cell operator-draft-attribute-cell-head">属性</div>
                    {ATTRIBUTE_LEVEL_KEYS.map((levelKey) => (
                      <div key={levelKey} className="operator-draft-attribute-cell operator-draft-attribute-cell-head">
                        {ATTRIBUTE_LEVEL_LABELS[levelKey]}
                      </div>
                    ))}
                    {ATTRIBUTE_ROWS.map(([attributeKey, label]) => (
                      <Fragment key={attributeKey}>
                        <div className="operator-draft-attribute-cell operator-draft-attribute-name">{label}</div>
                        {ATTRIBUTE_LEVEL_KEYS.map((levelKey) => (
                          <label key={`${attributeKey}-${levelKey}`} className="operator-draft-attribute-input">
                            <span>{`${label} ${ATTRIBUTE_LEVEL_LABELS[levelKey]}`}</span>
                            <DeferredNumberInput
                              value={draft.attributes[attributeKey]?.[levelKey] ?? 0}
                              onCommit={(value) => updateAttributeField(attributeKey, levelKey, value ?? 0)}
                            />
                          </label>
                        ))}
                      </Fragment>
                    ))}
                  </div>
                </div>
              </section>

              <section className="operator-draft-skill-list">
                <div className="operator-draft-section-header">
                  <h3>技能列表</h3>
                  <div className="operator-draft-section-actions">
                    <span>{activeSkillTypeFilter === 'all' ? `${skillEntries.length} 个` : `${displayedSkillEntries.length}/${skillEntries.length} 个`}</span>
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
                <div className="operator-draft-skill-filters">
                  {SKILL_TYPE_FILTERS.map((filter) => (
                    <button
                      key={filter.key}
                      type="button"
                      className={`operator-draft-skill-filter${activeSkillTypeFilter === filter.key ? ' is-active' : ''}`}
                      onClick={() => setActiveSkillTypeFilter(filter.key)}
                    >
                      <span>{filter.label}</span>
                      <strong>{skillFilterCounts[filter.key]}</strong>
                    </button>
                  ))}
                </div>
                {activeSkillTypeFilter !== 'all' ? (
                  <p className="operator-draft-skill-filter-note">筛选状态下暂不支持拖拽排序。</p>
                ) : null}
                {displayedSkillEntries.length ? displayedSkillEntries.map(([skillKey, skill]) => (
                  <button
                    type="button"
                    key={skillKey}
                    draggable={isSkillDragEnabled}
                    className={`operator-draft-skill-item${selectedSkillKey === skillKey ? ' is-active' : ''}${draggingSkillKey === skillKey ? ' is-dragging' : ''}${dragOverSkillKey === skillKey && draggingSkillKey !== skillKey ? ' is-drag-over' : ''}`}
                    onClick={() => setSelectedSkillKey(skillKey)}
                    onDragStart={() => handleSkillDragStart(skillKey)}
                    onDragEnter={() => {
                      if (isSkillDragEnabled) {
                        setDragOverSkillKey(skillKey);
                      }
                    }}
                    onDragOver={(event) => {
                      if (isSkillDragEnabled) {
                        event.preventDefault();
                      }
                    }}
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
                )) : (
                  <p className="operator-draft-empty">当前筛选下没有技能。</p>
                )}
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
                  <button type="button" className="operator-draft-ghost-button" onClick={handleDuplicateHit}>
                    复制 Hit
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
                              buttonType: event.target.value as SkillButtonType,
                            }))
                          }
                        >
                          <option value="A">A</option>
                          <option value="B">B</option>
                          <option value="E">E</option>
                          <option value="Q">Q</option>
                          <option value="Dot">Dot</option>
                        </select>
                      </label>
                      <label className="is-wide">
                        <span>技能图标</span>
                        <SearchablePathSelect
                          value={selectedSkill.iconUrl}
                          options={assetPathOptions}
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
                        <span>{`M3: ${hit.levels?.M3 ?? 0}`}</span>
                        <span>{`${hit.element} / ${hit.skillType}`}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p className="operator-draft-empty">当前没有可预览的 skill。</p>
              )}
              </section>
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
                    <div className="operator-draft-hit-levels">
                      {SKILL_LEVEL_KEYS.map((levelKey) => (
                        <label key={levelKey}>
                          <span>{levelKey}</span>
                          <DeferredNumberInput
                            step="0.01"
                            value={selectedHit.levels?.[levelKey] ?? 0}
                            onCommit={(value) =>
                              updateSelectedHit((hit) => ({
                                ...hit,
                                levels: {
                                  ...hit.levels,
                                  [levelKey]: value ?? 0,
                                },
                              }))
                            }
                          />
                        </label>
                      ))}
                    </div>
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
                        <option value="Dot">Dot</option>
                      </select>
                    </label>
                  </div>
                ) : (
                  <p className="operator-draft-empty">当前没有选中的 hit。</p>
                )}
              </section>
            </div>

            <div className="operator-draft-column operator-draft-column-right">
              <section className="operator-draft-buff-panel">
                <div className="operator-draft-section-header">
                  <h3>干员 Buff</h3>
                  <span>{buffEffectEntries.length} 个</span>
                </div>
                <div className="operator-draft-buff-tabs">
                  {OPERATOR_BUFF_GROUPS.map(({ key, label }) => (
                    <button
                      key={key}
                      type="button"
                      className={`operator-draft-buff-tab${activeBuffGroupKey === key ? ' is-active' : ''}`}
                      onClick={() => setActiveBuffGroupKey(key)}
                    >
                      <span>{label}</span>
                      <strong>{Object.keys(draft.buffs[key].effects).length}</strong>
                    </button>
                  ))}
                </div>
                <div className="operator-draft-buff-actions">
                  <button type="button" className="operator-draft-ghost-button" onClick={handleAddBuffEffect}>
                    新增
                  </button>
                  <button type="button" className="operator-draft-ghost-button" onClick={handleDuplicateBuffEffect}>
                    复制
                  </button>
                  <button type="button" className="operator-draft-ghost-button" onClick={handleRemoveBuffEffect}>
                    删除
                  </button>
                  <button type="button" className="operator-draft-copy-button" disabled={!selectedBuffEffect} onClick={() => setIsBuffDrawerOpen(true)}>
                    编辑 Buff
                  </button>
                </div>
                <div className="operator-draft-buff-body">
                  <div className="operator-draft-buff-list">
                    {buffEffectEntries.length ? (
                      buffEffectEntries.map(([effectKey, effect]) => (
                        <button
                          key={effectKey}
                          type="button"
                          className={`operator-draft-buff-item${selectedBuffEffectKey === effectKey ? ' is-active' : ''}`}
                          onClick={() => setSelectedBuffEffectKey(effectKey)}
                          onDoubleClick={() => {
                            setSelectedBuffEffectKey(effectKey);
                            setIsBuffDrawerOpen(true);
                          }}
                        >
                          <strong>{effect.name || effectKey}</strong>
                          <span>{effect.effectKind === 'extraHit' ? '额外伤害段' : effect.type ? getOperatorBuffTypeDisplayLabel(effect.type) : '未设置类型'}</span>
                          <span>{draftBuffModel.getBuffEffectSummary(effect)}</span>
                        </button>
                      ))
                    ) : (
                      <p className="operator-draft-empty">当前分组没有 Buff effect。</p>
                    )}
                  </div>
                  {selectedBuffEffect ? (
                    <div className="operator-draft-buff-summary">
                      <strong>{selectedBuffEffect.name || selectedBuffEffect.effectId}</strong>
                      <span>{OPERATOR_BUFF_BUSINESS_TYPE_LABELS[draftBuffModel.deriveOperatorBuffBusinessType(selectedBuffEffect)]}</span>
                      <span>{selectedBuffEffect.effectKind === 'extraHit' ? '额外伤害段' : selectedBuffEffect.type ? getOperatorBuffTypeDisplayLabel(selectedBuffEffect.type) : '未设置 typeKey'}</span>
                      <p>{draftBuffModel.getBuffEffectSummary(selectedBuffEffect)}</p>
                      <button type="button" className="operator-draft-copy-button" onClick={() => setIsBuffDrawerOpen(true)}>打开编辑抽屉</button>
                    </div>
                  ) : null}
                </div>
              </section>
            </div>
          </div>
        </section>
      </section>
      <BuffEffectEditorDrawer
        open={isBuffDrawerOpen}
        sourceLabel={`干员 Buff · ${OPERATOR_BUFF_GROUPS.find((group) => group.key === activeBuffGroupKey)?.label ?? activeBuffGroupKey}`}
        effect={selectedBuffEffect}
        onChange={(nextEffect) => updateSelectedBuffEffect(() => nextEffect)}
        onClose={() => setIsBuffDrawerOpen(false)}
      />
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
              <p>{exportScope === 'current' ? '导出仅包含当前编辑的干员。' : `当前本地干员库共有 ${localDraftIds.length} 个条目，导出会打包整个本地干员库。`}</p>
            </div>
            <div className="operator-draft-share-tabs">
              <button
                type="button"
                className={`operator-draft-share-tab${exportScope === 'current' ? ' is-active' : ''}`}
                onClick={() => setExportScope('current')}
              >
                导出当前
              </button>
              <button
                type="button"
                className={`operator-draft-share-tab${exportScope === 'all' ? ' is-active' : ''}`}
                onClick={() => setExportScope('all')}
              >
                导出全部
              </button>
            </div>
            <label className="operator-draft-share-label">
              <span>分享文件名</span>
              <input
                value={shareDraftName}
                onChange={(event) => setShareDraftName(event.target.value)}
                placeholder="留空则默认使用未命名"
              />
            </label>
            <div className="operator-draft-modal-actions">
              <button type="button" className="operator-draft-ghost-button" onClick={handleCopyShareJson}>
                复制 JSON
              </button>
              <button type="button" className="operator-draft-copy-button" onClick={handleExportLocalLibraryShare}>
                导出文件
              </button>
            </div>
            <textarea
              className="operator-draft-share-textarea"
              value={currentShareText}
              readOnly
              spellCheck={false}
            />
            <div className="operator-draft-modal-actions">
              <button type="button" className="operator-draft-ghost-button" onClick={handleOpenShareImportPicker}>
                导入分享
              </button>
            </div>
            <input
              ref={shareImportInputRef}
              type="file"
              accept=".json,application/json"
              className="operator-draft-file-input"
              onChange={handleShareFileSelected}
            />
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
              <h3>本地库管理</h3>
              <span>{localDraftIds.length} 个条目</span>
            </div>
            <div className="operator-draft-confirm-body">
              <div className="operator-draft-local-library-list" role="listbox" aria-label="本地草稿目录">
                {localDraftIds.length ? (
                  localDraftIds.map((draftId) => {
                    const draftName = localDraftNames[draftId]?.trim();
                    const isActive = selectedDeleteLocalDraftId === draftId;
                    return (
                      <button
                        key={draftId}
                        type="button"
                        className={`operator-draft-local-library-item${isActive ? ' is-active' : ''}`}
                        onClick={() => setSelectedDeleteLocalDraftId(draftId)}
                        role="option"
                        aria-selected={isActive}
                      >
                        <strong>{draftName || draftId}</strong>
                        <span>{draftId}</span>
                      </button>
                    );
                  })
                ) : (
                  <div className="operator-draft-searchable-empty">本地库为空</div>
                )}
              </div>
              <p>删除只影响本地库记录，不会自动清空当前编辑器里的草稿内容。</p>
            </div>
            <div className="operator-draft-modal-actions">
              <button type="button" className="operator-draft-ghost-button" onClick={() => setIsDeleteLocalDraftModalOpen(false)}>
                取消
              </button>
              <button
                type="button"
                className="operator-draft-copy-button operator-draft-danger-button"
                onClick={handleDeleteLocalDraft}
                disabled={!selectedDeleteLocalDraftId}
              >
                删除所选草稿
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
