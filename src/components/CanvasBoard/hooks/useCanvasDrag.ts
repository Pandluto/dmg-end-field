/**
 * Canvas drag logic.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { SkillType, SkillButton, CanvasConfig, SkillButtonData } from '../../../types';
import { generateId } from '../../../utils/helpers';
import { resolveSkillIconUrl } from '../../../utils/assetResolver';
import {
  findNearestGridLine,
  resolveSnappedGridNode,
  clientToGridCoords,
  gridToCanvasContentCoords,
  GRID_COLUMN_WIDTH,
  GRID_FIRST_COLUMN_WIDTH,
  clampGridNodeIndex,
  GRID_NODE_COUNT,
} from '../../../core/calculators/gridSnapLayout';
import { calculateNodeNumber } from '../../../utils/nodeNumbering';

interface DraggingState {
  id: string;
  characterId: string;
  characterName: string;
  skillType: SkillType;
  lineIndex: number;
  offsetX: number;
  offsetY: number;
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
  addTimelineButton?: (buttonData: {
    characterName: string;
    skillType: SkillType;
    staffIndex: number;
    nodeIndex: number;
    position: { x: number; y: number };
  }, buttonId?: string) => void;
  updateSkillButtonPosition?: (staffIndex: number, buttonId: string, newPosition: { x: number; y: number }, newNodeIndex: number) => SkillButtonData | null;
  moveTimelineButtonToStaff?: (
    fromStaffIndex: number,
    toStaffIndex: number,
    buttonId: string,
    newPosition: { x: number; y: number },
    newNodeIndex: number
  ) => SkillButtonData | null;
}

export interface UseCanvasDragReturn {
  draggingState: DraggingState | null;
  mousePosition: { x: number; y: number };
  handleSandboxDragStart: (
    characterId: string,
    characterName: string,
    skillType: SkillType,
    lineIndex: number,
    e: React.MouseEvent
  ) => void;
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
  updateSkillButtonPosition,
  moveTimelineButtonToStaff,
}: UseCanvasDragProps): UseCanvasDragReturn {
  const [draggingState, setDraggingState] = useState<DraggingState | null>(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  const skillButtonsRef = useRef(skillButtons);
  useEffect(() => {
    skillButtonsRef.current = skillButtons;
  }, [skillButtons]);

  const handleSandboxDragStart = useCallback(
    (
      characterId: string,
      characterName: string,
      skillType: SkillType,
      lineIndex: number,
      e: React.MouseEvent
    ) => {
      e.preventDefault();
      const offset = config.skillButtonSize / 2;

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

  const handleButtonMouseDown = useCallback(
    (e: React.MouseEvent, buttonId: string) => {
      if (e.button !== 0) return;
      e.stopPropagation();

      const button = skillButtons.find((b) => b.id === buttonId);
      if (!button) return;

      dispatch({ type: 'SELECT_SKILL_BUTTON', buttonId });
      dispatch({ type: 'SET_DRAGGING', buttonId, isDragging: true });

      const canvasRect = canvasRef.current?.getBoundingClientRect();
      if (canvasRect) {
        setDraggingState({
          id: button.id,
          characterId: button.characterId,
          characterName: button.characterName,
          skillType: button.skillType,
          lineIndex: button.lineIndex,
          offsetX: config.skillButtonSize / 2,
          offsetY: config.skillButtonSize / 2,
          originalButton: button,
        });
        setMousePosition({ x: e.clientX, y: e.clientY });
      }
    },
    [skillButtons, config, dispatch, canvasRef]
  );

  useEffect(() => {
    if (!draggingState) return;

    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY });
    };

    const getGridContentOffsetX = (canvasElement: HTMLDivElement, gridStackElement: Element): number => {
      const canvasRect = canvasElement.getBoundingClientRect();
      const gridStackRect = gridStackElement.getBoundingClientRect();
      return gridStackRect.left - canvasRect.left + canvasElement.scrollLeft;
    };

    const getButtonNodeIndex = (button: SkillButton, gridContentOffsetX: number): number => {
      const persistedNodeIndex = (button as SkillButton & { nodeIndex?: number }).nodeIndex;
      if (typeof persistedNodeIndex === 'number' && Number.isFinite(persistedNodeIndex)) {
        return clampGridNodeIndex(persistedNodeIndex);
      }

      const gridX = button.position.x - gridContentOffsetX;
      const firstNodeCenterX = GRID_FIRST_COLUMN_WIDTH + GRID_COLUMN_WIDTH / 2;
      return clampGridNodeIndex(Math.round((gridX - firstNodeCenterX) / GRID_COLUMN_WIDTH));
    };

    const getOccupiedNodeIndices = (
      staffIndex: number,
      lineIndex: number,
      movingButtonId: string | null,
      gridContentOffsetX: number
    ): Set<number> => {
      const occupied = new Set<number>();

      skillButtonsRef.current.forEach((button) => {
        if (button.id === movingButtonId) return;
        if (button.staffIndex !== staffIndex) return;
        if (button.lineIndex !== lineIndex) return;

        const nodeIndex = getButtonNodeIndex(button, gridContentOffsetX);
        if (Number.isFinite(nodeIndex)) {
          occupied.add(nodeIndex);
        }
      });

      return occupied;
    };

    const handleMouseUp = (e: MouseEvent) => {
      try {
        if (!draggingState || !canvasRef.current) {
          return;
        }

        const canvasRect = canvasRef.current.getBoundingClientRect();
        const gridStack = canvasRef.current.querySelector('.canvas-grid-stack');
        if (!gridStack) {
          return;
        }
        const gridStackRect = gridStack.getBoundingClientRect();

        const isInsideCanvas =
          e.clientX >= canvasRect.left &&
          e.clientX <= canvasRect.right &&
          e.clientY >= canvasRect.top &&
          e.clientY <= canvasRect.bottom;

        if (isInsideCanvas) {
          const { gridX, gridY } = clientToGridCoords(e.clientX, e.clientY, canvasRect, gridStackRect);

          const nearestLine = findNearestGridLine(
            gridY,
            staffCount,
            draggingState.characterId,
            selectedCharacters
          );

          if (nearestLine) {
            const { staffIndex, lineIndex, lineY } = nearestLine;

            const gridContentOffsetX = getGridContentOffsetX(canvasRef.current, gridStack);
            const occupiedNodeIndices = getOccupiedNodeIndices(
              staffIndex,
              lineIndex,
              draggingState.originalButton?.id ?? null,
              gridContentOffsetX
            );
            const snappedResult = resolveSnappedGridNode(gridX, occupiedNodeIndices);

            if (!snappedResult) {
              console.log('[吸附] 满行无可用节点，取消放置');
              dispatch({ type: 'SET_DRAGGING', buttonId: draggingState.id, isDragging: false });
              setDraggingState(null);
              return;
            }

            const { nodeIndex, nodeCenterX } = snappedResult;

            const snappedPosition = gridToCanvasContentCoords(
              nodeCenterX,
              lineY,
              canvasRef.current,
              gridStack
            );

            console.log('[吸附] grid坐标:', { gridX: Math.round(gridX), gridY: Math.round(gridY), nodeCenterX: Math.round(nodeCenterX), lineY: Math.round(lineY) });
            console.log('[吸附] canvas坐标:', snappedPosition);

            const isMovingExistingButton = !!draggingState.originalButton;

            if (isMovingExistingButton && draggingState.originalButton) {
              const originalButton = draggingState.originalButton;
              const buttonId = originalButton.id;

              // 持久层映射：staffIndex 用 lineIndex（干员索引），nodeIndex 用全局编号
              const oldPersistenceStaffIndex = originalButton.lineIndex;
              const newPersistenceStaffIndex = lineIndex;
              const persistenceNodeIndex = staffIndex * GRID_NODE_COUNT + nodeIndex;

              let serviceResult: SkillButtonData | null = null;

              if (oldPersistenceStaffIndex !== newPersistenceStaffIndex && moveTimelineButtonToStaff) {
                serviceResult = moveTimelineButtonToStaff(
                  oldPersistenceStaffIndex,
                  newPersistenceStaffIndex,
                  buttonId,
                  snappedPosition,
                  persistenceNodeIndex
                );
              } else if (updateSkillButtonPosition) {
                serviceResult = updateSkillButtonPosition(
                  newPersistenceStaffIndex,
                  buttonId,
                  snappedPosition,
                  persistenceNodeIndex
                );
              }

              if (serviceResult) {
                dispatch({
                  type: 'SET_SKILL_BUTTON_POSITION',
                  buttonId,
                  position: snappedPosition,
                  lineIndex,
                  staffIndex,
                  nodeIndex,
                  nodeNumber: calculateNodeNumber(nodeIndex),
                });
                dispatch({ type: 'SET_DRAGGING', buttonId, isDragging: false });
              } else {
                console.error('[useCanvasDrag] service returned null, skipping dispatch');
                dispatch({ type: 'SET_DRAGGING', buttonId, isDragging: false });
              }
            } else {
              const characterElement = (selectedCharacters as { id: string; element?: string }[]).find(
                c => c.id === draggingState.characterId
              )?.element;

              const newButton: SkillButton = {
                id: draggingState.id,
                characterId: draggingState.characterId,
                characterName: draggingState.characterName,
                skillType: draggingState.skillType,
                position: snappedPosition,
                staffIndex,
                lineIndex,
                nodeIndex,
                nodeNumber: calculateNodeNumber(nodeIndex),
                isDragging: false,
                isSelected: false,
                isFromSandbox: true,
                skillIconUrl: resolveSkillIconUrl(draggingState.characterName, draggingState.skillType),
                element: characterElement,
              };

              dispatch({ type: 'ADD_SKILL_BUTTON', button: newButton });

              try {
                if (addTimelineButton) {
                  // 持久层映射：staffIndex 用 lineIndex（干员索引），nodeIndex 用全局编号
                  const persistenceStaffIndex = lineIndex;
                  const persistenceNodeIndex = staffIndex * GRID_NODE_COUNT + nodeIndex;
                  addTimelineButton({
                    characterName: draggingState.characterName,
                    skillType: draggingState.skillType,
                    staffIndex: persistenceStaffIndex,
                    nodeIndex: persistenceNodeIndex,
                    position: snappedPosition,
                  }, draggingState.id);
                }
              } catch (timelineError) {
                console.error('[useCanvasDrag] addTimelineButton failed:', timelineError);
                dispatch({ type: 'REMOVE_SKILL_BUTTON', buttonId: newButton.id });
              }
            }
          }
        } else if (draggingState.originalButton) {
          dispatch({ type: 'SET_DRAGGING', buttonId: draggingState.originalButton.id, isDragging: false });
        }
      } catch (error) {
        console.error('[useCanvasDrag] handleMouseUp error:', error);
      } finally {
        setDraggingState(null);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingState, config, canvasWidth, staffCount, selectedCharacters, dispatch, canvasRef, addTimelineButton, updateSkillButtonPosition, moveTimelineButtonToStaff]);

  return {
    draggingState,
    mousePosition,
    handleSandboxDragStart,
    handleButtonMouseDown,
  };
}
