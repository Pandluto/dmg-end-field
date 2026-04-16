/**
 * 画布拖拽逻辑 Hook
 *
 * 支持两种拖拽场景：
 * 1. 技能沙盒按钮拖拽到画布 → 在吸附点新建 SkillButton
 * 2. 画布已有按钮重新拖拽 → 移除旧位置，在新位置新建
 *
 * 核心流程（mousedown → mousemove → mouseup）：
 * - mousedown：记录起点信息（characterId, skillType, offset）
 * - mousemove：更新跟随鼠标的遮罩层位置
 * - mouseup：
 *   a. 调用 findNearestLine 找到最近的谱线（返回含 groupOffset 的精确 Y）
 *   b. 调用 snapToNearestNode 将 X 吸附到最近节点（Y 不再重复偏移，直接用）
 *   c. 创建 SkillButton 实例（注入 skillIconUrl + element）
 *   d. dispatch ADD_SKILL_BUTTON
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { SkillType, SkillButton, CanvasConfig } from '../../../types';
import { snapToNearestNode, findNearestLine } from '../../../utils/layout';
import { generateId } from '../../../utils/helpers';
import { resolveSkillIconUrl } from '../../../utils/assetResolver';

/** 拖拽中按钮的临时状态 */
interface DraggingState {
  id: string;
  characterId: string;
  characterName: string;
  skillType: SkillType;
  lineIndex: number;
  offsetX: number;   // 鼠标相对于按钮圆心的偏移量（用于保持拖拽位置精确）
  offsetY: number;
  /** 若从画布已有按钮拖出，保存原始按钮引用用于撤销 */
  originalButton?: SkillButton;
}

interface UseCanvasDragProps {
  config: CanvasConfig;
  canvasWidth: number;
  staffCount: number;
  selectedCharacters: { id: string; name?: string }[];
  skillButtons: SkillButton[];
  canvasRef: React.RefObject<HTMLDivElement | null>;
  dispatch: React.Dispatch<any>;
  /** 添加技能按钮到排轴数据 */
  addTimelineButton?: (buttonData: {
    characterName: string;
    skillType: SkillType;
    staffIndex: number;
    nodeIndex: number;
    position: { x: number; y: number };
  }, buttonId?: string) => void;
  /** 从排轴数据中移除技能按钮 */
  removeTimelineButton?: (staffIndex: number, buttonId: string) => void;
  /** 更新技能按钮位置（移动按钮时使用，保留原 ID 和 Buff） */
  updateSkillButtonPosition?: (staffIndex: number, buttonId: string, newPosition: { x: number; y: number }, newNodeIndex: number) => void;
  /** 保存排轴数据 */
  saveTimelineData?: () => void;
}

export interface UseCanvasDragReturn {
  draggingState: DraggingState | null;   // 当前拖拽状态（null 表示无拖拽）
  mousePosition: { x: number; y: number };  // 鼠标在页面上的坐标
  /** 从技能沙盒开始拖拽 */
  handleSandboxDragStart: (
    characterId: string,
    characterName: string,
    skillType: SkillType,
    lineIndex: number,
    e: React.MouseEvent
  ) => void;
  /** 从画布已有按钮开始拖拽 */
  handleButtonMouseDown: (e: React.MouseEvent, buttonId: string) => void;
}

export function useCanvasDrag({
  config,
  canvasWidth,
  staffCount,
  selectedCharacters,
  skillButtons,
  canvasRef,
  dispatch,
  addTimelineButton,
  removeTimelineButton,
  updateSkillButtonPosition,
  saveTimelineData,
}: UseCanvasDragProps): UseCanvasDragReturn {
  const [draggingState, setDraggingState] = useState<DraggingState | null>(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  // 使用 ref 避免闭包问题（useEffect 依赖中用到 skillButtons 时始终拿到最新值）
  const skillButtonsRef = useRef(skillButtons);
  useEffect(() => {
    skillButtonsRef.current = skillButtons;
  }, [skillButtons]);

  /**
   * 从技能沙盒开始拖拽
   * 生成新 ID，记录干员和技能类型，进入拖拽状态
   */
  const handleSandboxDragStart = useCallback(
    (
      characterId: string,
      characterName: string,
      skillType: SkillType,
      lineIndex: number,
      e: React.MouseEvent
    ) => {
      e.preventDefault();
      const offset = config.skillButtonSize / 2;  // 圆心偏移

      setDraggingState({
        id: generateId(),
        characterId,
        characterName,
        skillType,
        lineIndex,
        offsetX: offset,
        offsetY: offset,
      });
      setMousePosition({ x: e.clientX, y: e.clientY });
    },
    [config]
  );

  /**
   * 从画布已有按钮开始拖拽
   * 处理所有按钮（包括 isFromSandbox=true 和已有的按钮）
   * 使用 updateSkillButtonPosition 更新位置，保留原按钮 ID 和 Buff 关联
   */
  const handleButtonMouseDown = useCallback(
    (e: React.MouseEvent, buttonId: string) => {
      if (e.button !== 0) return;  // 仅响应左键
      e.stopPropagation();

      const button = skillButtons.find((b) => b.id === buttonId);
      if (!button) return;

      dispatch({ type: 'SELECT_SKILL_BUTTON', buttonId });
      dispatch({ type: 'SET_DRAGGING', buttonId, isDragging: true });

      const canvasRect = canvasRef.current?.getBoundingClientRect();
      if (canvasRect) {
        // 保存原始按钮引用用于拖拽状态
        setDraggingState({
          id: button.id,
          characterId: button.characterId,
          characterName: button.characterName,
          skillType: button.skillType,
          lineIndex: button.lineIndex,
          offsetX: config.skillButtonSize / 2,
          offsetY: config.skillButtonSize / 2,
          originalButton: button,  // 保存原始按钮用于释放时更新位置
        });
        setMousePosition({ x: e.clientX, y: e.clientY });
      }
    },
    [skillButtons, config, dispatch, canvasRef]
  );

  /**
   * 全局鼠标移动/释放监听
   * 处理吸附逻辑和按钮创建/回退
   */
  useEffect(() => {
    if (!draggingState) return;

    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY });
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!draggingState || !canvasRef.current) {
        setDraggingState(null);
        return;
      }

      const canvasRect = canvasRef.current.getBoundingClientRect();

      // 判断鼠标是否释放在画布范围内
      const isInsideCanvas =
        e.clientX >= canvasRect.left &&
        e.clientX <= canvasRect.right &&
        e.clientY >= canvasRect.top &&
        e.clientY <= canvasRect.bottom;

      if (isInsideCanvas) {
        // ① 找最近谱线（返回含 groupOffset 的精确 Y）
        const nearestLine = findNearestLine(
          e.clientY,
          canvasRect,
          config,
          staffCount,
          draggingState.characterId,
          selectedCharacters
        );

        if (nearestLine) {
          const { staffIndex, lineIndex, lineY } = nearestLine;
          // 鼠标相对于画布左边缘的 X 坐标
          const mouseX = e.clientX - canvasRect.left;

          // ② 吸附 X 到最近节点，Y 直接用 lineY（findNearestLine 已处理 groupOffset）
          const { snappedPosition, nodeIndex } = snapToNearestNode(
            { x: mouseX, y: lineY },
            config,
            staffIndex,
            lineIndex,
            canvasWidth,
            skillButtonsRef.current,
            draggingState.characterId
          );

          // 判断是移动已有按钮还是创建新按钮
          // 只要有 originalButton 就按"移动已有按钮"处理
          const isMovingExistingButton = !!draggingState.originalButton;

          if (isMovingExistingButton && updateSkillButtonPosition && draggingState.originalButton) {
            // 移动已有按钮：使用 updateSkillButtonPosition 保留原 ID 和 Buff
            const originalButton = draggingState.originalButton;
            const oldStaffIndex = originalButton.lineIndex;
            const buttonId = originalButton.id;
            
            // 如果移动到不同的 staff，需要先从原 staff 移除
            if (oldStaffIndex !== lineIndex && removeTimelineButton) {
              removeTimelineButton(oldStaffIndex, buttonId);
              // 然后作为新按钮添加到新 staff
              if (addTimelineButton) {
                addTimelineButton({
                  characterName: draggingState.characterName,
                  skillType: draggingState.skillType,
                  staffIndex: lineIndex,
                  nodeIndex,
                  position: snappedPosition,
                }, buttonId);
              }
            } else {
              // 同一 staff 内移动：更新位置
              updateSkillButtonPosition(lineIndex, buttonId, snappedPosition, nodeIndex);
            }

            // 同步更新 AppContext 中按钮的位置和 lineIndex/staffIndex
            dispatch({
              type: 'SET_SKILL_BUTTON_POSITION',
              buttonId: buttonId,
              position: snappedPosition,
              lineIndex: lineIndex,
              staffIndex: lineIndex,
            });
            dispatch({ type: 'SET_DRAGGING', buttonId: buttonId, isDragging: false });
          } else {
            // ③ 查找干员 element 属性（用于渲染底色）
            const characterElement = (selectedCharacters as { id: string; element?: string }[]).find(
              c => c.id === draggingState.characterId
            )?.element;

            // ④ 创建新 SkillButton 实例
            const newButton: SkillButton = {
              id: draggingState.id,
              characterId: draggingState.characterId,
              characterName: draggingState.characterName,
              skillType: draggingState.skillType,
              position: snappedPosition,
              staffIndex,
              lineIndex,
              isDragging: false,
              isSelected: false,
              isFromSandbox: true,
              // 派生字段：从资源路径解析函数获取
              skillIconUrl: resolveSkillIconUrl(draggingState.characterName, draggingState.skillType),
              element: characterElement,
            };

            dispatch({ type: 'ADD_SKILL_BUTTON', button: newButton });

            // ⑤ 添加到排轴数据（如果提供了 addTimelineButton 函数）
            if (addTimelineButton) {
              addTimelineButton({
                characterName: draggingState.characterName,
                skillType: draggingState.skillType,
                staffIndex: lineIndex,
                nodeIndex,
                position: snappedPosition,
              }, draggingState.id);
            }
          }
        }
      }

      setDraggingState(null);
      
      // 自动保存
      if (saveTimelineData) {
        saveTimelineData();
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingState, config, canvasWidth, staffCount, selectedCharacters, dispatch, canvasRef, addTimelineButton, removeTimelineButton, updateSkillButtonPosition, saveTimelineData]);

  return {
    draggingState,
    mousePosition,
    handleSandboxDragStart,
    handleButtonMouseDown,
  };
}
