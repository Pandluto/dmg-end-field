/**
 * Timeline data management.
 * 只负责 React state 和 debounce，所有业务逻辑下沉到 timelineService
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { SkillButtonData, TimelineData } from '../types';
import { STORAGE_KEYS } from '../constants/storage-keys';
import { setStorageJson } from '../utils/storage';
import {
  createEmptyTimelineData,
  normalizeTimelineData,
  addSkillButton as addSkillButtonService,
  removeSkillButton as removeSkillButtonService,
  updateSkillButtonPosition as updateSkillButtonPositionService,
  moveSkillButtonToStaff as moveSkillButtonToStaffService,
  updateSelectedBuffList as updateSelectedBuffListService,
  updateSkillButtonType as updateSkillButtonTypeService,
  getStaffButtons as getStaffButtonsService,
  saveTimelineData as saveTimelineDataService,
  loadTimelineData as loadTimelineDataService,
} from '../core/services/timelineService';

export function useTimelineData(selectedCharacters: { name: string }[]) {
  const [timelineData, setTimelineData] = useState<TimelineData>(() => {
    return createEmptyTimelineData(selectedCharacters);
  });

  const timelineDataRef = useRef(timelineData);
  timelineDataRef.current = timelineData;

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce 保存到 sessionStorage
  useEffect(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      const dataToSave = timelineDataRef.current;
      setStorageJson(STORAGE_KEYS.TIMELINE_DATA, dataToSave);
      console.log('[timeline] autosaved to sessionStorage');
    }, 300);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [timelineData]);

  const addSkillButton = useCallback((buttonData: Omit<SkillButtonData, 'id' | 'nodeNumber'>, customId?: string): SkillButtonData => {
    const { newButton, newTimelineData } = addSkillButtonService(timelineDataRef.current, buttonData, customId);
    setTimelineData(newTimelineData);
    return newButton;
  }, []);

  const removeSkillButton = useCallback((staffIndex: number, buttonId: string) => {
    const newTimelineData = removeSkillButtonService(timelineDataRef.current, staffIndex, buttonId);
    setTimelineData(newTimelineData);
  }, []);

  const updateSkillButtonPosition = useCallback((
    staffIndex: number,
    buttonId: string,
    newPosition: { x: number; y: number },
    newNodeIndex: number
  ): SkillButtonData | null => {
    const { updatedButton, newTimelineData } = updateSkillButtonPositionService(
      timelineDataRef.current,
      staffIndex,
      buttonId,
      newPosition,
      newNodeIndex
    );
    setTimelineData(newTimelineData);
    return updatedButton;
  }, []);

  const moveSkillButtonToStaff = useCallback((
    fromStaffIndex: number,
    toStaffIndex: number,
    buttonId: string,
    newPosition: { x: number; y: number },
    newNodeIndex: number
  ): SkillButtonData | null => {
    const { movedButton, newTimelineData } = moveSkillButtonToStaffService(
      timelineDataRef.current,
      fromStaffIndex,
      toStaffIndex,
      buttonId,
      newPosition,
      newNodeIndex
    );
    setTimelineData(newTimelineData);
    return movedButton;
  }, []);

  /**
   * 更新按钮的 selectedBuff（操作 skill-button 总表，不再写入 timeline.data）
   * @param buttonId - 按钮 ID
   * @param buffIds - Buff ID 列表
   */
  const updateSelectedBuffList = useCallback((buttonId: string, buffIds: string[]) => {
    updateSelectedBuffListService(buttonId, buffIds);
  }, []);

  /**
   * 更新技能按钮类型
   * @param buttonId - 按钮 ID
   * @param nextSkillType - 新的技能类型
   * @returns 更新后的 SkillButtonData 或 null
   */
  const updateSkillButtonType = useCallback((
    buttonId: string,
    nextSkillType: 'A' | 'B' | 'E' | 'Q'
  ): SkillButtonData | null => {
    const { updatedButton, newTimelineData } = updateSkillButtonTypeService(
      timelineDataRef.current,
      buttonId,
      nextSkillType
    );
    setTimelineData(newTimelineData);
    return updatedButton;
  }, []);

  /**
   * @deprecated 已废弃，不再执行任何操作
   * 旧方法曾用于从 timelineData 更新 buffIds，现已改为 no-op。
   * selectedBuff 的写入只能通过新主链路：addBuffToButtonHelper / removeSkillButtonBuff / clearBuffs / removeSkillButton
   */
  const updateButtonBuffIds = useCallback((_staffIndex: number, _buttonId: string, _buffIds: string[]) => {
    // no-op: 禁止从旧 timelineData.buffIds 写回 skill-button 总表
    console.warn('[deprecated] updateButtonBuffIds 已废弃，不再执行任何操作');
  }, []);

  const getStaffButtons = useCallback((staffIndex: number): SkillButtonData[] => {
    return getStaffButtonsService(timelineData, staffIndex);
  }, [timelineData]);

  const saveTimelineData = useCallback((): TimelineData => {
    const dataToSave = timelineDataRef.current;
    saveTimelineDataService(dataToSave);
    console.log('[timeline] saved to sessionStorage', dataToSave);
    return dataToSave;
  }, []);

  const loadTimelineData = useCallback((): TimelineData | null => {
    const parsed = loadTimelineDataService();
    if (parsed) {
      const normalized = normalizeTimelineData(parsed, selectedCharacters);
      if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
        setStorageJson(STORAGE_KEYS.TIMELINE_DATA, normalized);
      }
      setTimelineData(normalized);
      console.log('[timeline] loaded from sessionStorage', normalized);
      console.log('  - selectedCharacters:', selectedCharacters.length);
      console.log('  - staffLines:', normalized.staffLines.length);
      normalized.staffLines.forEach((line, idx) => {
        console.log(`  - staffLine[${idx}]: buttons=${line.buttons.length}, occupiedNodes=${line.occupiedNodes.length}`);
      });
      return normalized;
    }
    return null;
  }, [selectedCharacters]);

  return {
    timelineData,
    addSkillButton,
    removeSkillButton,
    updateSkillButtonPosition,
    moveSkillButtonToStaff,
    updateButtonBuffIds,
    updateSelectedBuffList,
    updateSkillButtonType,
    getStaffButtons,
    saveTimelineData,
    loadTimelineData,
    normalizeTimelineData,
  };
}
