/**
 * 干员选择界面（SelectionPanel）
 *
 * 用途：玩家从已加载的干员列表中选择最多 4 人，选择后点击"开始排轴"进入谱线编辑界面
 * 状态来源：loadedCharacters（全部干员）、selectedCharacters（已选干员列表）
 */

import { useAppContext } from '../../context/AppContext';
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

  /** 判断某干员是否已被选中 */
  const isSelected = (charId: string) =>
    selectedCharacters.some((c) => c.id === charId);

  /** 是否已达 4 人上限 */
  const isFull = selectedCharacters.length >= 4;

  /** 切换干员选中状态 */
  const handleSelect = (character: typeof loadedCharacters[0]) => {
    if (isSelected(character.id)) {
      dispatch({ type: 'DESELECT_CHARACTER', characterId: character.id });
    } else if (!isFull) {
      dispatch({ type: 'SELECT_CHARACTER', character });
    }
  };

  /** 确认选择 → 切换到谱线编辑界面，清空画布 */
  const handleConfirm = () => {
    if (selectedCharacters.length > 0) {
      dispatch({ type: 'CLEAR_SKILL_BUTTONS' });
      dispatch({ type: 'SET_VIEW', view: 'canvas' });
    }
  };

  return (
    <div className="selection-panel">
      <div className="container">
        <h1 className="title">选择干员</h1>
        <p className="subtitle">已选择 {selectedCharacters.length} / 4 位干员</p>

        {/* 干员卡片网格 */}
        <div className="character-grid">
          {loadedCharacters.map((character) => (
            <div
              key={character.id}
              className={`character-card ${isSelected(character.id) ? 'selected' : ''} ${
                !isSelected(character.id) && isFull ? 'disabled' : ''
              }`}
              onClick={() => handleSelect(character)}
            >
              {/* 头像区：首字母占位 + 元素属性小圆点 */}
              <div className="character-avatar">
                <span
                  className="element-dot"
                  style={{ backgroundColor: ELEMENT_COLORS[character.element] || '#888' }}
                />
                {character.name.charAt(0)}
              </div>
              {/* 干员信息 */}
              <div className="character-info">
                <h3 className="character-name">
                  {character.name}
                  <span className="rarity">{'★'.repeat(character.rarity)}</span>
                </h3>
                <p className="character-profession">{character.profession}</p>
                <p className="character-element">{character.element}</p>
              </div>
              {/* 已选中时显示勾选标记 */}
              {isSelected(character.id) && <div className="selected-badge">✓</div>}
            </div>
          ))}
        </div>

        {/* 确认按钮 */}
        <div className="actions">
          <button
            className="btn-confirm"
            onClick={handleConfirm}
            disabled={selectedCharacters.length === 0}
          >
            开始排轴
          </button>
        </div>
      </div>
    </div>
  );
}
