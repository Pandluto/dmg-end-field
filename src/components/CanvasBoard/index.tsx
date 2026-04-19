/**
 * 谱线编辑界面（CanvasBoard）
 *
 * 布局：SidePanel（侧边栏）+ CanvasArea（画布区域）+ SkillSandbox（技能沙盒）
 * 负责协调三个子模块之间的状态交互，是画布模块的顶层容器
 */

import React, { useRef, useEffect } from 'react';
import { useAppContext } from '../../context/AppContext';
import { getTotalCanvasHeight } from '../../utils/layout';
import { SkillSandbox } from './SkillSandbox';
import { useCanvasWidth } from './hooks/useCanvasWidth';
import { useSelectStart } from './hooks/useSelectStart';
import { useCanvasDrag } from './hooks/useCanvasDrag';
import { useTimelineData } from '../../hooks/useTimelineData';
import { CanvasArea } from './components/CanvasArea';
import { SidePanel } from '../SidePanel';
import { DraggingOverlay } from './components/DraggingOverlay';
import { OperatorConfigPanel } from './components/OperatorConfigPanel';
import { SkillButton } from '../../types';
import { migrateOldBuffStorage } from '../../utils/migrateStorage';
import './CanvasBoard.css';

export function CanvasBoard() {
  const { state, dispatch } = useAppContext();
  const { selectedCharacters, canvasConfig, skillButtons } = state;
  const canvasRef = useRef<HTMLDivElement>(null);
  const [isConfigPanelOpen, setIsConfigPanelOpen] = React.useState(false);
  const [activeConfigCharacterId, setActiveConfigCharacterId] = React.useState<string | null>(null);

  // staffCount 使用独立 state，可在 2-5 之间动态增删
  const [staffCount, setStaffCount] = React.useState(canvasConfig.staffCount);

  // 画布宽度由视口比例决定（响应式）
  const canvasWidth = useCanvasWidth(canvasConfig.canvasWidthPercent);
  // 画布总高度 = staffCount * staffGroupHeight + 间距
  const currentCanvasHeight = getTotalCanvasHeight(canvasConfig, staffCount);

  // 点击"开始战斗"时回到选择界面
  useSelectStart();

  // 使用排轴数据管理 Hook
  const {
    timelineData,
    addSkillButton: addTimelineButton,
    removeSkillButton: removeTimelineButton,
    updateSkillButtonPosition,
    moveSkillButtonToStaff,
    saveTimelineData,
    loadTimelineData,
    normalizeTimelineData,
  } = useTimelineData(selectedCharacters);

  // 页面刷新后从 timelineData 恢复 skillButtons 到 AppContext
  // 使用 ref 保证"只恢复一次"
  const hasRestoredRef = useRef(false);

  useEffect(() => {
    if (hasRestoredRef.current) {
      return; // 防止重复恢复
    }
    hasRestoredRef.current = true;

    // 先执行旧缓存迁移（幂等）
    migrateOldBuffStorage();

    // 加载持久化的排轴数据（内部已做规范化）
    const loadedData = loadTimelineData();
    if (loadedData) {
      // 额外校验：确保 staffLines 结构合法
      console.log('【刷新恢复】数据校验:');
      console.log('  - selectedCharacters:', selectedCharacters.length);
      console.log('  - staffLines:', loadedData.staffLines.length);
      
      // 如果结构仍不匹配，再次规范化
      let dataToRestore = loadedData;
      if (loadedData.staffLines.length < selectedCharacters.length) {
        console.warn('  - 结构不匹配，执行额外规范化');
        dataToRestore = normalizeTimelineData(loadedData, selectedCharacters);
      }
      
      // 将 timelineData 中的按钮转换为 AppContext 的 skillButtons
      const restoredButtons: SkillButton[] = [];
      dataToRestore.staffLines.forEach((staffLine) => {
        // 确保 buttons 是数组
        const buttons = Array.isArray(staffLine.buttons) ? staffLine.buttons : [];
        buttons.forEach((btn) => {
          restoredButtons.push({
            id: btn.id,
            characterId: btn.characterName, // timeline 中存的是 name，作为 id 使用
            characterName: btn.characterName,
            skillType: btn.skillType,
            position: btn.position,
            staffIndex: btn.staffIndex,
            lineIndex: btn.staffIndex, // 兼容字段
            isDragging: false,
            isSelected: false,
            isFromSandbox: false,
          });
        });
      });

      // 先清空现有按钮，再批量恢复
      dispatch({ type: 'CLEAR_SKILL_BUTTONS' });
      restoredButtons.forEach((button) => {
        dispatch({ type: 'ADD_SKILL_BUTTON', button });
      });

      console.log('【刷新恢复】已从 timelineData 恢复按钮:', restoredButtons.length);
    }
  }, [dispatch, loadTimelineData, normalizeTimelineData, selectedCharacters]);

  // 监听 Buff 添加事件，仅用于触发 UI 刷新
  // 注意：Buff 数据已写入 skill-button 总表，不需要再从 timelineData 同步
  useEffect(() => {
    const handleBuffAdded = (event: CustomEvent) => {
      const { buttonId, buffId } = event.detail;
      if (!buttonId || !buffId) return;

      console.log('【Buff 事件】已添加 Buff:', buttonId, buffId);
      // UI 刷新由 SkillButton 组件自行处理（通过 loadBuffList）
    };

    window.addEventListener('skillbutton-buff-added', handleBuffAdded as EventListener);
    return () => {
      window.removeEventListener('skillbutton-buff-added', handleBuffAdded as EventListener);
    };
  }, []);

  // 监听 Buff 删除事件，仅用于触发 UI 刷新
  useEffect(() => {
    const handleBuffRemoved = (event: CustomEvent) => {
      const { buttonId, buffId } = event.detail;
      if (!buttonId || !buffId) return;

      console.log('【Buff 事件】已移除 Buff:', buttonId, buffId);
      // UI 刷新由 SkillButton 组件自行处理（通过 loadBuffList）
    };

    window.addEventListener('skillbutton-buff-removed', handleBuffRemoved as EventListener);
    return () => {
      window.removeEventListener('skillbutton-buff-removed', handleBuffRemoved as EventListener);
    };
  }, []);

  // 拖拽逻辑：处理技能沙盒按钮拖出、画布按钮拖动
  const { draggingState, mousePosition, handleSandboxDragStart, handleButtonMouseDown } = useCanvasDrag({
    config: canvasConfig,
    canvasWidth,
    staffCount,
    selectedCharacters,
    skillButtons,
    canvasRef,
    dispatch,
    addTimelineButton,
    updateSkillButtonPosition,
    moveTimelineButtonToStaff: moveSkillButtonToStaff,
  });

  const handleBack = () => {
    dispatch({ type: 'SET_VIEW', view: 'selection' });
    dispatch({ type: 'SELECT_SKILL_BUTTON', buttonId: null });
  };

  // 增删 staff 组（最多 5 个，最少 2 个）
  const handleAddStaffGroup = () => {
    if (staffCount < 5) {
      setStaffCount(prev => prev + 1);
    }
  };

  const handleRemoveStaffGroup = () => {
    if (staffCount > 2) {
      setStaffCount(prev => prev - 1);
    }
  };

  // 右键删除技能按钮
  const handleButtonContextMenu = (e: React.MouseEvent, buttonId: string) => {
    e.preventDefault();
    e.stopPropagation();

    // 检查按钮是否被锁定
    const button = skillButtons.find(b => b.id === buttonId);
    if (button?.isLocked) {
      return; // 锁定状态不响应右键删除
    }

    // 先从 skillButtons 中找到按钮，获取 lineIndex（干员索引）
    if (button && button.lineIndex !== undefined) {
      // 同时从 timelineData 中移除
      removeTimelineButton(button.lineIndex, buttonId);
    }

    dispatch({ type: 'REMOVE_SKILL_BUTTON', buttonId });
  };

  // 点击画布空白处：取消按钮选中
  const handleCanvasClick = () => {
    dispatch({ type: 'SELECT_SKILL_BUTTON', buttonId: null });
  };

  // 双击头像时打开配置界面，并记录当前正在配置的干员
  const handleAvatarDoubleClick = (characterId: string) => {
    setActiveConfigCharacterId(characterId);
    setIsConfigPanelOpen(true);
  };

  // 统一关闭入口：返回按钮与遮罩点击都复用该函数，避免状态回收逻辑分叉
  const closeConfigPanel = () => {
    setIsConfigPanelOpen(false);
    setActiveConfigCharacterId(null);
  };

  const handleConfigCharacterSelect = (characterId: string) => {
    setActiveConfigCharacterId(characterId);
  };

  // 保存排轴数据到 sessionStorage
  const handleSaveTimeline = () => {
    saveTimelineData();
    alert('排轴数据已保存！');
  };

  return (
    <div className="canvas-board">
      <div className="canvas-layout">
        {/* 倾斜平行四边形装饰层 */}
        <div className="skew-panel" />
        <div className="skew-panel-bottom" />
        {/* 侧边栏：显示已选干员列表 */}
        <SidePanel widthPercent={15} />
        {/* 画布区域：渲染谱线、节点、已放置的技能按钮 */}
        <CanvasArea
          ref={canvasRef}
          config={canvasConfig}
          staffCount={staffCount}
          selectedCharacters={selectedCharacters}
          skillButtons={skillButtons}
          canvasWidth={canvasWidth}
          canvasHeight={currentCanvasHeight}
          onBack={handleBack}
          onAddGroup={handleAddStaffGroup}
          onRemoveGroup={handleRemoveStaffGroup}
          onSave={handleSaveTimeline}
          onButtonMouseDown={handleButtonMouseDown}
          onButtonContextMenu={handleButtonContextMenu}
          onCanvasClick={handleCanvasClick}
          timelineData={timelineData}
        />
        {/* 技能沙盒：拖拽技能按钮到画布 */}
        <SkillSandbox
          selectedCharacters={selectedCharacters}
          onDragStart={handleSandboxDragStart}
          onAvatarDoubleClick={handleAvatarDoubleClick}
        />
      </div>
      <OperatorConfigPanel
        isOpen={isConfigPanelOpen}
        activeCharacterId={activeConfigCharacterId}
        selectedCharacters={selectedCharacters}
        onSelectCharacter={handleConfigCharacterSelect}
        onClose={closeConfigPanel}
      />
      {/* 拖拽遮罩层：渲染正在拖拽的半透明按钮跟随鼠标 */}
      <DraggingOverlay
        draggingState={draggingState ? { id: draggingState.id, skillType: draggingState.skillType } : null}
        mousePosition={mousePosition}
        buttonSize={canvasConfig.skillButtonSize}
      />
    </div>
  );
}
