/**
 * Canvas drag logic.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { SkillType, SkillButton, CanvasConfig } from '../../../types';
import { snapToNearestNode, findNearestLine } from '../../../utils/layout';
import { generateId } from '../../../utils/helpers';
import { resolveSkillIconUrl } from '../../../utils/assetResolver';

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
  updateSkillButtonPosition?: (staffIndex: number, buttonId: string, newPosition: { x: number; y: number }, newNodeIndex: number) => void;
  moveTimelineButtonToStaff?: (
    fromStaffIndex: number,
    toStaffIndex: number,
    buttonId: string,
    newPosition: { x: number; y: number },
    newNodeIndex: number
  ) => void;
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

    const handleMouseUp = (e: MouseEvent) => {
      if (!draggingState || !canvasRef.current) {
        setDraggingState(null);
        return;
      }

      const canvasRect = canvasRef.current.getBoundingClientRect();
      const isInsideCanvas =
        e.clientX >= canvasRect.left &&
        e.clientX <= canvasRect.right &&
        e.clientY >= canvasRect.top &&
        e.clientY <= canvasRect.bottom;

      if (isInsideCanvas) {
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
          const mouseX = e.clientX - canvasRect.left;

          const { snappedPosition, nodeIndex } = snapToNearestNode(
            { x: mouseX, y: lineY },
            config,
            staffIndex,
            lineIndex,
            canvasWidth,
            skillButtonsRef.current,
            draggingState.characterId
          );

          const isMovingExistingButton = !!draggingState.originalButton;

          if (isMovingExistingButton && draggingState.originalButton) {
            const originalButton = draggingState.originalButton;
            const oldStaffIndex = originalButton.lineIndex;
            const buttonId = originalButton.id;

            if (oldStaffIndex !== lineIndex && moveTimelineButtonToStaff) {
              moveTimelineButtonToStaff(oldStaffIndex, lineIndex, buttonId, snappedPosition, nodeIndex);
            } else if (updateSkillButtonPosition) {
              updateSkillButtonPosition(lineIndex, buttonId, snappedPosition, nodeIndex);
            }

            dispatch({
              type: 'SET_SKILL_BUTTON_POSITION',
              buttonId,
              position: snappedPosition,
              lineIndex,
              staffIndex: lineIndex,
            });
            dispatch({ type: 'SET_DRAGGING', buttonId, isDragging: false });
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
              isDragging: false,
              isSelected: false,
              isFromSandbox: true,
              skillIconUrl: resolveSkillIconUrl(draggingState.characterName, draggingState.skillType),
              element: characterElement,
            };

            dispatch({ type: 'ADD_SKILL_BUTTON', button: newButton });

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
      } else if (draggingState.originalButton) {
        dispatch({ type: 'SET_DRAGGING', buttonId: draggingState.originalButton.id, isDragging: false });
      }

      setDraggingState(null);
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
