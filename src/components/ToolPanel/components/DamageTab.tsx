// DamageTab.tsx
// 伤害加成标签页内容组件 - 提供文本输入框和 Buff 陈列区

import { useState, useCallback, useEffect } from 'react';
import { useAppContext } from '../../../context/AppContext';
import {
  addSkillButtonBuff,
  getSelectedSkillButton,
} from '../../../hooks/useSkillButtonBuffs';
import { SkillButtonBuff } from '../../../types/storage';
import { searchManualCandidateBuffsByName, useCandidateBuffs } from '../../../hooks/useCandidateBuffs';
import { useBuffInteraction } from '../../../hooks/useBuffInteraction';
import { CandidateBuff } from '../../../core/domain/buff';
import { emitSkillButtonBuffAdded } from '../../../core/events/buffEvents';

/**
 * 将 CandidateBuff 转换为 SkillButtonBuff
 * @param candidate 候选 Buff
 * @returns 已选 Buff 实体（不含 id，由 addSkillButtonBuff 生成）
 */
function toSkillButtonBuff(candidate: CandidateBuff): Omit<SkillButtonBuff, 'id'> {
  return {
    name: candidate.name,
    displayName: candidate.displayName,
    sourceName: candidate.sourceName,
    level: candidate.level,
    type: candidate.type,
    value: candidate.value,
    description: candidate.description,
    source: candidate.source,
    condition: candidate.condition,
    refCount: 1,
  };
}

/**
 * 检查点是否在 SkillButton 弹窗区域内
 * @param x 屏幕坐标 x
 * @param y 屏幕坐标 y
 * @returns 是否在弹窗内
 */
function isPointInSkillButtonModal(x: number, y: number): boolean {
  const modal = document.querySelector('.skill-button-modal');
  if (!modal) return false;
  const rect = modal.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/**
 * 伤害加成标签页组件
 * 提供文本输入框和 Buff 陈列区功能
 */
export function DamageTab() {
  // 从 AppContext 获取已选角色列表
  const { state } = useAppContext();
  const { selectedCharacters } = state;
  const selectedCharacterRefs = selectedCharacters.map((char) => ({ id: char.id, name: char.name }));

  // 文本输入框的值（受控组件）
  const [inputValue, setInputValue] = useState('');
  const [manualSourceKeyword, setManualSourceKeyword] = useState('');
  const [manualSourceResults, setManualSourceResults] = useState<CandidateBuff[]>([]);
  const [isManualSourceLoading, setIsManualSourceLoading] = useState(false);
  const [manualSourceError, setManualSourceError] = useState('');

  // 使用候选 Buff Hook
  const {
    buffList,
    searchKeyword,
    setSearchKeyword,
    matchedBuffs,
    isLoading,
    handleRefresh,
    isDrawerOpen,
    setIsDrawerOpen,
    drawerHostRef,
  } = useCandidateBuffs(selectedCharacterRefs);

  // 唯一添加入口：添加候选 Buff 到当前选中的技能按钮
  const handleAddCandidateBuff = useCallback((candidate: CandidateBuff) => {
    const selectedButtonId = getSelectedSkillButton();
    if (!selectedButtonId) {
      console.warn('没有选中的技能按钮，无法添加 Buff');
      return false;
    }

    // 转换 CandidateBuff -> SkillButtonBuff
    const newBuff = toSkillButtonBuff(candidate);

    // 添加到技能按钮
    const result = addSkillButtonBuff(selectedButtonId, newBuff);
    if (!result.success) {
      console.log('Buff 添加失败:', candidate.displayName);
      return false;
    }

    if (result.isDuplicate) {
      console.log('Buff 已存在:', candidate.displayName);
      return true; // 幂等，返回成功
    }

    const actualBuffId = result.buffId!;
    console.log('添加 Buff 到技能按钮:', candidate.displayName, actualBuffId);

    // 触发事件通知 SkillButton 弹窗刷新 Buff 列表
    emitSkillButtonBuffAdded(selectedButtonId, actualBuffId);

    return true;
  }, []);

  // 使用 Buff 交互 Hook
  const {
    isDragging,
    draggedBuff,
    dragPosition,
    selectedBuff,
    isModalOpen,
    handleBuffClick,
    handleBuffMouseDown,
    handleCloseModal,
  } = useBuffInteraction({
    onAddBuff: handleAddCandidateBuff,
    onOpenBuffDetail: (buff) => {
      console.log('打开 Buff 详情:', buff.displayName);
    },
    isPointInDropZone: isPointInSkillButtonModal,
  });

  // 同步 inputValue 和 searchKeyword
  useEffect(() => {
    setInputValue(searchKeyword);
  }, [searchKeyword]);

  const handleManualSourceSearch = useCallback(async () => {
    const keyword = manualSourceKeyword.trim();
    if (!keyword) {
      setManualSourceResults([]);
      setManualSourceError('');
      return;
    }

    setIsManualSourceLoading(true);
    setManualSourceError('');
    try {
      const results = await searchManualCandidateBuffsByName(keyword);
      setManualSourceResults(results);
      if (results.length === 0) {
        setManualSourceError('未命中官方干员/武器 Buff');
      }
    } catch (error) {
      console.error('手动搜索官方 Buff 失败:', error);
      setManualSourceResults([]);
      setManualSourceError('手动搜索失败，请检查名称或稍后重试');
    } finally {
      setIsManualSourceLoading(false);
    }
  }, [manualSourceKeyword]);

  return (
    <div className="tab-content-damage">
      {/* 文本输入区 - 抽屉宿主 */}
      <div className="damage-input-section drawer-host" ref={drawerHostRef}>
        <input
          type="text"
          className="damage-input"
          value={inputValue}
          onChange={(e) => {
            const value = e.target.value;
            setInputValue(value);
            setSearchKeyword(value);
            setIsDrawerOpen(value.trim().length > 0);
          }}
          onFocus={() => {
            if (searchKeyword.trim().length > 0) {
              setIsDrawerOpen(true);
            }
          }}
          placeholder="输入内容"
        />

        {/* 下滑抽屉 - 展示匹配的 Buff displayName 列表 */}
        <div className={`damage-search-drawer${isDrawerOpen ? ' is-open' : ''}`}>
          {matchedBuffs.length > 0 ? (
            matchedBuffs.map((buff, index) => (
              <button
                key={index}
                className="damage-search-option"
                onClick={() => handleBuffClick(buff)}
              >
                {buff.displayName}
              </button>
            ))
          ) : (
            <div className="damage-search-empty">未匹配到 Buff</div>
          )}
        </div>
      </div>

      {/* 陈列区 */}
      <div className="damage-display-section">
        <div className="refresh-row">
          <input
            className="damage-input"
            value={manualSourceKeyword}
            onChange={(event) => setManualSourceKeyword(event.target.value)}
            placeholder="按名字临时加载官方干员/武器 Buff（如：管理员 / 宏愿）"
          />
          <button
            className="refresh-button"
            onClick={handleManualSourceSearch}
            disabled={isManualSourceLoading}
            type="button"
          >
            {isManualSourceLoading ? '...' : '临时搜'}
          </button>
        </div>
        {manualSourceError ? <div className="buff-empty">{manualSourceError}</div> : null}
        {manualSourceResults.length > 0 && (
          <div className="buff-list">
            {manualSourceResults.map((buff, index) => (
              <div
                key={`manual-${buff.source}-${buff.name}-${index}`}
                className={`buff-item${draggedBuff?.name === buff.name ? ' is-dragging' : ''}`}
                title={`${buff.displayName} (${buff.source})`}
                onClick={() => handleBuffClick(buff)}
                onMouseDown={(e) => handleBuffMouseDown(buff, e)}
              >
                {buff.displayName}
              </div>
            ))}
          </div>
        )}
        {/* Buff 列表 - 始终显示全部，不受搜索影响 */}
        <div className="buff-list">
          {buffList.length === 0 ? (
            <div className="buff-empty">点击刷新加载 Buff 数据</div>
          ) : (
            buffList.map((buff, index) => (
              <div
                key={index}
                className={`buff-item${draggedBuff?.name === buff.name ? ' is-dragging' : ''}`}
                title={buff.displayName}
                onClick={() => handleBuffClick(buff)}
                onMouseDown={(e) => handleBuffMouseDown(buff, e)}
              >
                {buff.displayName}
              </div>
            ))
          )}
        </div>

        {/* 刷新行 */}
        <div className="refresh-row">
          <button
            className="refresh-button"
            onClick={handleRefresh}
            disabled={isLoading}
          >
            {isLoading ? '...' : '刷新'}
          </button>
        </div>
      </div>

      {/* 拖拽中的 Buff 跟随鼠标 */}
      {isDragging && draggedBuff && (
        <div
          className="dragging-buff-follower"
          style={{
            left: dragPosition.x,
            top: dragPosition.y,
            transform: 'translate(-50%, -50%)',
          }}
        >
          {draggedBuff.displayName}
        </div>
      )}

      {/* Buff 详情弹窗 */}
      {isModalOpen && selectedBuff && (
        <div className="buff-detail-modal-overlay" onClick={handleCloseModal}>
          <div className="buff-detail-modal" onClick={e => e.stopPropagation()}>
            <h4>Buff 详情</h4>
            <div className="buff-detail-content">
              <p><strong>显示名称:</strong> {selectedBuff.displayName}</p>
              <p><strong>名称:</strong> {selectedBuff.name}</p>
              <p><strong>来源:</strong> {selectedBuff.sourceName}</p>
              <p><strong>类型:</strong> {selectedBuff.type || '无'}</p>
              <p><strong>数值:</strong> {selectedBuff.value !== undefined ? selectedBuff.value : '无'}</p>
              <p><strong>等级:</strong> {selectedBuff.level}</p>
              <p><strong>描述:</strong> {selectedBuff.description}</p>
              {selectedBuff.condition && <p><strong>条件:</strong> {selectedBuff.condition}</p>}
            </div>
            <button className="buff-detail-close-btn" onClick={handleCloseModal}>
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
