import { useEffect, useMemo, useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { createEmptyTimelineData, reconcileSelectionChange } from '../../core/services/timelineService';
import {
  isLocalOperatorLibraryStorageKey,
  loadLocalOperatorCharacters,
} from '../../core/services/localOperatorAdapter';
import { LOCAL_LIBRARY_CHANGED_EVENT } from '../../aiCli/aiCliCommandService';
import { Character } from '../../types';
import { normalizeAssetUrl } from '../../utils/assetResolver';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../../utils/appRoute';
import { applyTimelineSnapshotPayload, type TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';
import { createTimelineRepositoryClient } from '../../agentKernel/timelineRepository/localTimelineClient';
import { activateTimelineSession } from '../../agentKernel/timelineRepository/timelineSession';
import { useTimelineSession } from '../../agentKernel/timelineRepository/useTimelineSession';
import { flushUserWorkspaceState } from '../../utils/userWorkspaceBridge';
import './SelectionPanel.css';

const ELEMENT_LABELS: Record<string, string> = {
  physical: '物理',
  fire: '火',
  ice: '冰',
  electric: '电',
  nature: '自然',
};

const ELEMENT_COLORS: Record<string, string> = {
  physical: '#8a8f98',
  fire: '#d86a3a',
  ice: '#3c91b7',
  electric: '#c59a19',
  nature: '#3b8b5a',
};

export function SelectionPanel() {
  const { state, dispatch } = useAppContext();
  const { selectedCharacters } = state;
  const { activeTimelineId, activeTimelineIsTemporary } = useTimelineSession();
  const [localCharacters, setLocalCharacters] = useState<Character[]>([]);
  const [draftCharacterIds, setDraftCharacterIds] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');

  const refreshLocalCharacters = () => {
    setLocalCharacters(loadLocalOperatorCharacters());
  };

  useEffect(() => {
    refreshLocalCharacters();
    // web-cli 保存到本地主库后派发的同页事件
    const handleLocalChanged = () => refreshLocalCharacters();
    window.addEventListener(LOCAL_LIBRARY_CHANGED_EVENT, handleLocalChanged);
    // 跨页签：其他标签页写 localStorage 时触发的原生 storage 事件
    const handleStorage = (event: StorageEvent) => {
      if (isLocalOperatorLibraryStorageKey(event.key)) {
        refreshLocalCharacters();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(LOCAL_LIBRARY_CHANGED_EVENT, handleLocalChanged);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  useEffect(() => {
    setDraftCharacterIds(
      selectedCharacters
        .filter((character) => character.librarySource === 'local')
        .map((character) => character.id)
        .slice(0, 4)
    );
  }, [selectedCharacters]);

  const localCharacterMap = useMemo(() => {
    const nextMap = new Map<string, Character>();
    localCharacters.forEach((character) => {
      nextMap.set(character.id, character);
    });
    return nextMap;
  }, [localCharacters]);

  const draftCharacters = useMemo(
    () =>
      draftCharacterIds
        .map((characterId) => localCharacterMap.get(characterId))
        .filter((character): character is Character => Boolean(character)),
    [draftCharacterIds, localCharacterMap]
  );

  const filteredCharacters = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return localCharacters;
    }
    return localCharacters.filter((character) => {
      const fields = [
        character.name,
        character.id,
        character.profession,
        character.element,
        ELEMENT_LABELS[character.element],
      ];
      return fields.some((field) => String(field || '').toLowerCase().includes(keyword));
    });
  }, [localCharacters, query]);

  const isSelected = (characterId: string) => draftCharacterIds.includes(characterId);
  const isFull = draftCharacterIds.length >= 4;

  const toggleCharacter = (character: Character) => {
    if (isSelected(character.id)) {
      setDraftCharacterIds((prev) => prev.filter((characterId) => characterId !== character.id));
      return;
    }
    if (!isFull) {
      setDraftCharacterIds((prev) => [...prev, character.id].slice(0, 4));
    }
  };

  const removeSelected = (characterId: string) => {
    setDraftCharacterIds((prev) => prev.filter((id) => id !== characterId));
  };

  const clearSelected = () => {
    setDraftCharacterIds([]);
  };

  const handleConfirm = async () => {
    if (draftCharacters.length === 0) {
      return;
    }

    const currentCharacterIds = new Set(selectedCharacters.map((character) => character.id));
    const hasSharedCharacter = draftCharacters.some((character) => currentCharacterIds.has(character.id));

    // 临时工作区只在“整队完全不同”时推倒重来。只要还保留任一干员，
    // 就继续使用同一个 SQLite，并按既有的排轴重排规则同步数据。
    if (activeTimelineIsTemporary && hasSharedCharacter) {
      reconcileSelectionChange(selectedCharacters, draftCharacters);
      await flushUserWorkspaceState();
      dispatch({ type: 'CLEAR_SKILL_BUTTONS' });
      dispatch({ type: 'SET_SELECTED_CHARACTERS', characters: draftCharacters });
      dispatch({ type: 'SET_VIEW', view: 'canvas' });
      return;
    }

    setIsCreatingWorkspace(true);
    setWorkspaceError('');
    const createdAt = Date.now();
    const nonce = typeof crypto?.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2, 12);
    const timelineId = `timeline-${createdAt}-${nonce}`;
    const snapshotId = `${timelineId}-initial`;
    const documentLabel = `排轴 ${new Date(createdAt).toLocaleString('zh-CN', { hour12: false })}`;
    const payload: TimelineSnapshotPayload = {
      selectedCharacters: draftCharacters.map((character) => character.id),
      timelineData: createEmptyTimelineData(draftCharacters),
      skillButtonTable: {},
      allBuffList: [],
      anomalyStateSnapshots: [],
      characterInputMap: {},
      characterComputedMap: {},
      characterDisplayCacheMap: {},
      operatorConfigPageCache: {},
    };

    try {
      const repository = createTimelineRepositoryClient();
      const imported = await repository.importDocumentBundle({
        document: { id: timelineId, label: documentLabel, isTemporary: true, createdAt },
        snapshots: [{
          id: snapshotId,
          label: '初始排轴',
          createdAt,
          payload,
        }],
        checkoutRef: { targetType: 'snapshot', targetId: snapshotId, updatedAt: createdAt },
      });
      const checkoutRef = {
        timelineId: imported.document.id,
        targetType: 'snapshot' as const,
        targetId: snapshotId,
        updatedAt: createdAt,
      };

      if (activeTimelineIsTemporary) {
        try {
          await repository.deleteDocument(activeTimelineId);
        } catch (error) {
          // 切换前未能清掉旧临时工作区时，回收刚创建的空工作区，避免
          // 留下无法使用的孤立 SQLite 文档。
          await repository.deleteDocument(imported.document.id).catch(() => undefined);
          throw error;
        }
      }

      // 先同步 SQLite 工作副本和会话，再切画布；这样新画布不会从上一个
      // 工作区读取旧按钮表或旧 Work Node 树。
      applyTimelineSnapshotPayload(payload);
      await flushUserWorkspaceState();
      activateTimelineSession({
        document: imported.document,
        checkoutRef,
        workingPayload: payload,
      });
      dispatch({ type: 'CLEAR_SKILL_BUTTONS' });
      dispatch({ type: 'SET_SELECTED_CHARACTERS', characters: draftCharacters });
      dispatch({ type: 'SET_VIEW', view: 'canvas' });
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsCreatingWorkspace(false);
    }
  };

  const openOperatorDraft = () => {
    navigateToAppPath(APP_ROUTE_PATHS.draft);
  };

  const renderAvatar = (character: Character) => (
    <div className="selection-character-avatar">
      {character.avatarUrl ? (
        <img
          className="selection-character-avatar-image"
          src={normalizeAssetUrl(character.avatarUrl)}
          alt={`${character.name} 头像`}
        />
      ) : (
        <span>{character.name.charAt(0)}</span>
      )}
    </div>
  );

  return (
    <div className="selection-panel">
      <section className="selection-shell">
        <header className="selection-header">
          <div>
            <h1 className="selection-title">选择本地干员</h1>
            <p className="selection-subtitle">已选 {draftCharacterIds.length}/4</p>
          </div>
          <div className="selection-header-actions">
            <button type="button" className="selection-ghost-button" onClick={refreshLocalCharacters}>
              刷新
            </button>
            <button type="button" className="selection-ghost-button" onClick={openOperatorDraft}>
              编辑干员
            </button>
          </div>
        </header>

        <div className="selection-workspace">
          <aside className="selection-roster">
            <div className="selection-section-header">
              <span>出战队列</span>
              <button type="button" onClick={clearSelected} disabled={draftCharacterIds.length === 0}>
                清空
              </button>
            </div>

            <div className="selection-slots">
              {Array.from({ length: 4 }, (_, index) => {
                const character = draftCharacters[index];
                return (
                  <div key={character?.id || `empty-${index}`} className={`selection-slot${character ? ' is-filled' : ''}`}>
                    {character ? (
                      <>
                        {renderAvatar(character)}
                        <div className="selection-slot-text">
                          <strong>{character.name}</strong>
                          <span>{character.profession || '-'}</span>
                        </div>
                        <button type="button" className="selection-slot-remove" onClick={() => removeSelected(character.id)}>
                          移除
                        </button>
                      </>
                    ) : (
                      <span className="selection-slot-empty">空位 {index + 1}</span>
                    )}
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              className="selection-confirm-button"
              onClick={handleConfirm}
              disabled={draftCharacters.length === 0 || isCreatingWorkspace}
            >
              {isCreatingWorkspace ? '正在创建 SQLite 工作区…' : '开始排轴'}
            </button>
            {workspaceError && <p className="selection-error">创建 SQLite 工作区失败：{workspaceError}</p>}
          </aside>

          <section className="selection-library">
            <div className="selection-toolbar">
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索名称 / 职业 / 属性"
              />
              <span>{filteredCharacters.length} / {localCharacters.length}</span>
            </div>

            {localCharacters.length === 0 ? (
              <div className="selection-empty">
                <strong>本地干员库为空</strong>
                <button type="button" className="selection-ghost-button" onClick={openOperatorDraft}>
                  新建干员
                </button>
              </div>
            ) : (
              <div className="selection-character-grid">
                {filteredCharacters.map((character) => {
                  const selected = isSelected(character.id);
                  const disabled = !selected && isFull;
                  return (
                    <button
                      key={character.id}
                      type="button"
                      className={`selection-character-card${selected ? ' is-selected' : ''}`}
                      onClick={() => toggleCharacter(character)}
                      disabled={disabled}
                      title={disabled ? '最多选择 4 位干员' : character.name}
                    >
                      {renderAvatar(character)}
                      <span className="selection-character-main">
                        <strong>{character.name}</strong>
                        <span>{character.profession || '-'}</span>
                      </span>
                      <span
                        className="selection-element-pill"
                        style={{ borderColor: ELEMENT_COLORS[character.element] || '#8a8f98' }}
                      >
                        {ELEMENT_LABELS[character.element] || character.element || '-'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}
