/**
 * 谱线编辑界面（CanvasBoard）
 *
 * 布局：SidePanel（侧边栏）+ CanvasArea（画布区域）+ SkillSandbox（技能沙盒）
 * 负责协调三个子模块之间的状态交互，是画布模块的顶层容器
 */

import React, { useRef } from 'react';
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
    saveTimelineData,
  } = useTimelineData(selectedCharacters);

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
    removeTimelineButton,
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
