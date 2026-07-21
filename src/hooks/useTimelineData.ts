/**
 * Timeline data management.
 * 只负责 React state 和 debounce，所有业务逻辑下沉到 timelineService
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { SkillButtonData, SkillButtonSkillChangePayload, TimelineData } from '../types';
import { STORAGE_KEYS } from '../constants/storage-keys';
import { setStorageJson } from '../utils/storage';
import {
  createEmptyTimelineData,
  addSkillButton as addSkillButtonService,
  removeSkillButton as removeSkillButtonService,
  updateSkillButtonPosition as updateSkillButtonPositionService,
  moveSkillButtonToStaff as moveSkillButtonToStaffService,
  updateSelectedBuffList as updateSelectedBuffListService,
  updateSkillButtonType as updateSkillButtonTypeService,
  getStaffButtons as getStaffButtonsService,
  saveTimelineData as saveTimelineDataService,
  loadTimelineData as loadTimelineDataService,
  normalizeTimelineData,
  ensureTimelineDataConsistency,
} from '../core/services/timelineService';

export function useTimelineData(selectedCharacters: { name: string }[]) {
  const [timelineData, setTimelineData] = useState<TimelineData>(() => {
    return createEmptyTimelineData(selectedCharacters);
  });

  const timelineDataRef = useRef(timelineData);
  timelineDataRef.current = timelineData;

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce 保存当前工作副本；桌面/本地桥接环境会落到 user.sqlite。
  useEffect(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      const dataToSave = timelineDataRef.current;
      saveTimelineDataService(dataToSave);
      // timeline.data 与 skill-button 总表分别写入。异步 UI 切换或历史数据
      // 恢复期间，最后一次写入不能让两者留下不一致的快照。
      ensureTimelineDataConsistency(selectedCharacters);
      console.log('[timeline] autosaved to workspace repository');
    }, 300);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [selectedCharacters, timelineData]);

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
   * 更新技能按钮技能真相
   * @param payload - 完整技能切换 payload
   * @returns 更新后的 SkillButtonData 或 null
   */
  const updateSkillButtonType = useCallback((
    payload: SkillButtonSkillChangePayload
  ): SkillButtonData | null => {
    const { updatedButton, newTimelineData } = updateSkillButtonTypeService(
      timelineDataRef.current,
      payload
    );
    setTimelineData(newTimelineData);
    return updatedButton;
  }, []);

  const getStaffButtons = useCallback((staffIndex: number): SkillButtonData[] => {
    return getStaffButtonsService(timelineData, staffIndex);
  }, [timelineData]);

  const saveTimelineData = useCallback((): TimelineData => {
    const dataToSave = timelineDataRef.current;
    saveTimelineDataService(dataToSave);
    const consistentData = ensureTimelineDataConsistency(selectedCharacters) ?? dataToSave;
    console.log('[timeline] saved to workspace repository', consistentData);
    return consistentData;
  }, [selectedCharacters]);

  const loadTimelineData = useCallback((): TimelineData | null => {
    const parsed = ensureTimelineDataConsistency(selectedCharacters) ?? loadTimelineDataService();
    if (parsed) {
      const normalized = normalizeTimelineData(parsed, selectedCharacters);
      if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
        setStorageJson(STORAGE_KEYS.TIMELINE_DATA, normalized);
      }
      setTimelineData(normalized);
      console.log('[timeline] loaded from workspace repository', normalized);
      console.log('  - selectedCharacters:', selectedCharacters.length);
      console.log('  - staffLines:', normalized.staffLines.length);
      normalized.staffLines.forEach((line, idx) => {
        console.log(`  - staffLine[${idx}]: buttons=${line.buttons.length}, occupiedNodes=${line.occupiedNodes.length}`);
      });
      return normalized;
    }
    return null;
  }, [selectedCharacters]);

  const replaceTimelineData = useCallback((nextTimelineData: TimelineData) => {
    // Checkout/selection hydration is authoritative. Cancel any delayed save
    // created by the previous roster and move the ref synchronously before
    // React renders, otherwise that stale timer can overwrite the freshly
    // hydrated SQLite/sessionStorage projection with old staff lines.
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    timelineDataRef.current = nextTimelineData;
    setTimelineData(nextTimelineData);
  }, []);

  return {
    timelineData,
    addSkillButton,
    removeSkillButton,
    updateSkillButtonPosition,
    moveSkillButtonToStaff,
    updateSelectedBuffList,
    updateSkillButtonType,
    getStaffButtons,
    saveTimelineData,
    loadTimelineData,
    replaceTimelineData,
    normalizeTimelineData,
  };
}
