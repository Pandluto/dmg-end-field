/**
 * 干员选择界面（SelectionPanel）
 *
 * 用途：玩家从已加载的干员列表中选择最多 4 人，选择后点击"开始排轴"进入谱线编辑界面
 * 状态来源：loadedCharacters（官方角色）、selectedCharacters（已选干员列表）
 */

import { useEffect, useMemo, useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { reconcileSelectionChange } from '../../core/services/timelineService';
import { loadLocalOperatorCharacters } from '../../core/services/localOperatorAdapter';
import { Character } from '../../types';
import './SelectionPanel.css';

/** 干员元素属性 → CSS 颜色映射（用于元素圆点）*/
const ELEMENT_COLORS: Record<string, string> = {
  physical: '#888888',
  fire: '#ff6b35',
  ice: '#6bcfff',
  electric: '#ffd93d',
  nature: '#78c88c',
};

/**
 * 干员选择面板
 * 展示所有已加载干员，支持选中/取消选中（最多 4 人），
 * 点击确认后切换到 canvas 视图并清空画布
 */
export function SelectionPanel() {
  const { state, dispatch } = useAppContext();
  const { loadedCharacters, selectedCharacters } = state;
  const [localCharacters, setLocalCharacters] = useState<Character[]>([]);
  const officialCharacters = useMemo(
    () => loadedCharacters,
    [loadedCharacters]
  );
  useEffect(() => {
    setLocalCharacters(loadLocalOperatorCharacters());
  }, []);
  const [draftCharacterIds, setDraftCharacterIds] = useState<string[]>([]);

  useEffect(() => {
    setDraftCharacterIds(selectedCharacters.map((character) => character.id));
  }, [selectedCharacters]);

  const mergedCharacterMap = useMemo(() => {
    const nextMap = new Map<string, Character>();
    officialCharacters.forEach((character) => {
      nextMap.set(character.id, character);
    });
    localCharacters.forEach((character) => {
      nextMap.set(character.id, character);
    });
    return nextMap;
  }, [officialCharacters, localCharacters]);

  const draftCharacters = useMemo(
    () =>
      draftCharacterIds
        .map((characterId) => mergedCharacterMap.get(characterId))
        .filter((character): character is Character => Boolean(character)),
    [draftCharacterIds, mergedCharacterMap]
  );

  /** 判断某干员是否已被选中 */
  const isSelected = (charId: string) =>
    draftCharacterIds.includes(charId);

  /** 是否已达 4 人上限 */
  const isFull = draftCharacterIds.length >= 4;

  /** 切换干员选中状态 */
  const handleSelect = (character: typeof loadedCharacters[0]) => {
    if (isSelected(character.id)) {
      setDraftCharacterIds((prev) => prev.filter((characterId) => characterId !== character.id));
    } else if (!isFull) {
      setDraftCharacterIds((prev) => [...prev, character.id]);
    }
  };

  /** 确认选择 → 差量迁移后切换到谱线编辑界面 */
  const handleConfirm = () => {
    if (draftCharacters.length > 0) {
      reconcileSelectionChange(selectedCharacters, draftCharacters);
      dispatch({ type: 'CLEAR_SKILL_BUTTONS' });
      dispatch({ type: 'SET_SELECTED_CHARACTERS', characters: draftCharacters });
      dispatch({ type: 'SET_VIEW', view: 'canvas' });
    }
  };

  const renderCharacterCard = (character: Character) => (
    <div
      key={character.id}
      className={`character-card ${isSelected(character.id) ? 'selected' : ''} ${
        !isSelected(character.id) && isFull ? 'disabled' : ''
      }`}
      onClick={() => handleSelect(character)}
    >
      <div className="character-avatar">
        <span
          className="element-dot"
          style={{ backgroundColor: ELEMENT_COLORS[character.element] || '#888' }}
        />
        {character.avatarUrl ? (
          <img
            className="character-avatar-image"
            src={character.avatarUrl}
            alt={`${character.name} 头像`}
          />
        ) : (
          character.name.charAt(0)
        )}
      </div>
      <div className="character-info">
        <h3 className="character-name">
          {character.name}
          <span className="rarity">{'★'.repeat(character.rarity)}</span>
        </h3>
        <p className="character-profession">{character.profession}</p>
        <p className="character-element">{character.element}</p>
      </div>
      {isSelected(character.id) && <div className="selected-badge">✓</div>}
    </div>
  );

  return (
    <div className="selection-panel">
      <div className="container">
        <h1 className="title">选择干员</h1>
        <p className="subtitle">已选择 {draftCharacterIds.length} / 4 位干员</p>

        <div className="character-library-columns">
          <section className="character-library-section">
            <div className="character-library-header">
              <h2>官方角色</h2>
              <span>{officialCharacters.length} 位</span>
            </div>
            <div className="character-grid">
              {officialCharacters.map(renderCharacterCard)}
            </div>
          </section>

          <section className="character-library-section">
            <div className="character-library-header">
              <h2>本地角色</h2>
              <span>{localCharacters.length} 位</span>
            </div>
            {localCharacters.length > 0 ? (
              <div className="character-grid character-grid-local">
                {localCharacters.map(renderCharacterCard)}
              </div>
            ) : (
              <div className="character-library-empty">本地角色库为空</div>
            )}
          </section>
        </div>

        <div className="actions">
          <button
            className="btn-confirm"
            onClick={handleConfirm}
            disabled={draftCharacterIds.length === 0}
          >
            开始排轴
          </button>
        </div>
      </div>
    </div>
  );
}
