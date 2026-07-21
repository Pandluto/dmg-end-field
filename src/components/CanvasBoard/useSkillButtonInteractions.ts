import { useCallback, useEffect } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { SkillButton as SkillButtonType, TimelineData } from '../../types';
import { getTimelineSkillDetailPath, navigateToAppPath } from '../../utils/appRoute';
import type { useSkillButtonRuntime } from './useSkillButtonRuntime';

interface UseSkillButtonInteractionsParams {
  button: SkillButtonType;
  timelineData?: TimelineData;
  isBrowseMode: boolean;
  isDragDisabled: boolean;
  onMouseDown: (event: ReactMouseEvent) => void;
  onModalOpen?: () => void;
  runtime: ReturnType<typeof useSkillButtonRuntime>;
}

export function useSkillButtonInteractions({
  button,
  timelineData,
  isBrowseMode,
  isDragDisabled,
  onMouseDown,
  onModalOpen,
  runtime,
}: UseSkillButtonInteractionsParams) {
  const {
    clickCountRef,
    clickTimerRef,
    isLongPressRef,
    longPressTimerRef,
    setIconLoadFailed,
  } = runtime;

  const handleMouseDown = useCallback((event: ReactMouseEvent) => {
    event.preventDefault();
    if (isBrowseMode || isDragDisabled) {
      return;
    }

    isLongPressRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      isLongPressRef.current = true;
      onMouseDown(event);
    }, 200);

    const handleMouseUp = () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mouseup', handleMouseUp);
  }, [isBrowseMode, isDragDisabled, isLongPressRef, longPressTimerRef, onMouseDown]);

  useEffect(() => {
    if (!isDragDisabled) return;
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    isLongPressRef.current = false;
  }, [isDragDisabled, isLongPressRef, longPressTimerRef]);

  const handleClick = useCallback(() => {
    if (isBrowseMode || isLongPressRef.current) return;

    clickCountRef.current += 1;
    if (clickCountRef.current === 1) {
      clickTimerRef.current = setTimeout(() => {
        clickCountRef.current = 0;
      }, 250);
      return;
    }

    if (clickCountRef.current === 2) {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      clickCountRef.current = 0;
      navigateToAppPath(getTimelineSkillDetailPath(button.id));
      onModalOpen?.();
      console.log('双击技能按钮，打开弹窗:', button.id);
      if (timelineData) {
        console.log('【排轴数据】当前总数据结构:', timelineData);
      }
    }
  }, [button.id, clickCountRef, clickTimerRef, isBrowseMode, isLongPressRef, onModalOpen, timelineData]);

  return {
    handleClick,
    handleIconError: () => setIconLoadFailed(true),
    handleIconLoad: () => setIconLoadFailed(false),
    handleMouseDown,
  };
}
