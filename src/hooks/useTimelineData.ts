/**
 * Timeline data management.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { SkillButtonData, TimelineData, StaffLineData } from '../types';
import { STORAGE_KEYS } from '../constants/storage-keys';
import { calculateNodeNumber } from '../utils/nodeNumbering';
import { getStorageJson, setStorageJson } from '../utils/storage';
import {
  upsertSkillButton,
  removeSkillButtonById,
  getSkillButtonById,
  removeBuffById,
  isBuffReferenced,
  PersistedSkillButton,
} from '../utils/storage';

function createEmptyTimelineData(characters: { name: string }[]): TimelineData {
  const now = Date.now();
  return {
    version: "1.0.0",
    createdAt: now,
    updatedAt: now,
    staffLines: characters.map((char, index) => ({
      staffIndex: index,
      characterName: char.name,
      occupiedNodes: [],
      buttons: [],
    })),
  };
}

function normalizeTimelineData(
  data: TimelineData,
  characters: { name: string }[]
): TimelineData {
  const normalizedStaffLines: StaffLineData[] = [];
  let hasStructuralChanges = data.staffLines.length !== characters.length;

  for (let i = 0; i < characters.length; i++) {
    const existingLine = data.staffLines[i];
    if (existingLine) {
      const normalizedOccupiedNodes = Array.isArray(existingLine.occupiedNodes) ? existingLine.occupiedNodes : [];
      const normalizedButtons = Array.isArray(existingLine.buttons) ? existingLine.buttons : [];

      if (
        existingLine.staffIndex !== i ||
        existingLine.characterName !== characters[i].name ||
        !Array.isArray(existingLine.occupiedNodes) ||
        !Array.isArray(existingLine.buttons)
      ) {
        hasStructuralChanges = true;
      }

      normalizedStaffLines.push({
        staffIndex: i,
        characterName: characters[i].name,
        occupiedNodes: normalizedOccupiedNodes,
        buttons: normalizedButtons,
      });
    } else {
      hasStructuralChanges = true;
      normalizedStaffLines.push({
        staffIndex: i,
        characterName: characters[i].name,
        occupiedNodes: [],
        buttons: [],
      });
    }
  }

  return {
    ...data,
    staffLines: normalizedStaffLines,
    updatedAt: hasStructuralChanges ? Date.now() : data.updatedAt,
  };
}

export function useTimelineData(selectedCharacters: { name: string }[]) {
  const [timelineData, setTimelineData] = useState<TimelineData>(() => {
    return createEmptyTimelineData(selectedCharacters);
  });

  const timelineDataRef = useRef(timelineData);
  timelineDataRef.current = timelineData;

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    const buttonId = customId || `btn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newButton: SkillButtonData = {
      ...buttonData,
      id: buttonId,
      nodeNumber: calculateNodeNumber(buttonData.nodeIndex),
    };

    // 同时写入 skill-button 总表
    const persistedButton: PersistedSkillButton = {
      id: buttonId,
      characterName: buttonData.characterName,
      skillType: buttonData.skillType,
      staffIndex: buttonData.staffIndex,
      nodeIndex: buttonData.nodeIndex,
      nodeNumber: newButton.nodeNumber,
      position: buttonData.position,
      selectedBuff: [], // 初始为空
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    upsertSkillButton(persistedButton);

    setTimelineData(prev => {
      const newData: TimelineData = {
        ...prev,
        updatedAt: Date.now(),
        staffLines: [...prev.staffLines],
      };

      const staffLine = { ...newData.staffLines[buttonData.staffIndex] };
      newData.staffLines[buttonData.staffIndex] = staffLine;

      staffLine.buttons = [...staffLine.buttons, newButton]
        .sort((a, b) => a.nodeIndex - b.nodeIndex);

      staffLine.occupiedNodes = [...staffLine.occupiedNodes, buttonData.nodeIndex]
        .sort((a, b) => a - b);

      return newData;
    });

    return newButton;
  }, []);

  const removeSkillButton = useCallback((staffIndex: number, buttonId: string) => {
    // 1. 先读取 button 的 selectedBuff（删除前保存）
    const buttonToRemove = getSkillButtonById(buttonId);
    const oldSelectedBuff = buttonToRemove?.selectedBuff || [];

    // 2. 从 skill-button 总表删除 button
    removeSkillButtonById(buttonId);

    // 3. 清理 timelineData 中的引用
    setTimelineData(prev => {
      const newData: TimelineData = {
        ...prev,
        updatedAt: Date.now(),
        staffLines: [...prev.staffLines],
      };

      const staffLine = { ...newData.staffLines[staffIndex] };
      newData.staffLines[staffIndex] = staffLine;

      const button = staffLine.buttons.find(b => b.id === buttonId);

      if (button) {
        staffLine.buttons = staffLine.buttons.filter(b => b.id !== buttonId);
        staffLine.occupiedNodes = staffLine.occupiedNodes
          .filter(n => n !== button.nodeIndex)
          .sort((a, b) => a - b);
      }

      return newData;
    });

    // 4. 对旧 selectedBuff 逐个执行引用检查，删除无引用的 Buff
    oldSelectedBuff.forEach(buffId => {
      if (!isBuffReferenced(buffId)) {
        removeBuffById(buffId);
        console.log('[Buff 清理] 删除无引用 Buff:', buffId);
      }
    });
  }, []);

  const updateSkillButtonPosition = useCallback((
    staffIndex: number,
    buttonId: string,
    newPosition: { x: number; y: number },
    newNodeIndex: number
  ): SkillButtonData | null => {
    let updatedButton: SkillButtonData | null = null;

    // 先更新 skill-button 总表
    const existingButton = getSkillButtonById(buttonId);
    if (existingButton) {
      upsertSkillButton({
        ...existingButton,
        position: newPosition,
        nodeIndex: newNodeIndex,
        nodeNumber: calculateNodeNumber(newNodeIndex),
        updatedAt: Date.now(),
      });
    }

    setTimelineData(prev => {
      const staffLine = prev.staffLines[staffIndex];
      const button = staffLine?.buttons.find(b => b.id === buttonId);

      if (!button) return prev;

      const oldNodeIndex = button.nodeIndex;

      updatedButton = {
        ...button,
        position: newPosition,
        nodeIndex: newNodeIndex,
        nodeNumber: calculateNodeNumber(newNodeIndex),
      };

      const newData: TimelineData = {
        ...prev,
        updatedAt: Date.now(),
        staffLines: [...prev.staffLines],
      };

      const newStaffLine = { ...newData.staffLines[staffIndex] };
      newData.staffLines[staffIndex] = newStaffLine;

      newStaffLine.buttons = newStaffLine.buttons
        .map(b => b.id === buttonId ? updatedButton! : b)
        .sort((a, b) => a.nodeIndex - b.nodeIndex);

      newStaffLine.occupiedNodes = newStaffLine.occupiedNodes
        .filter(n => n !== oldNodeIndex)
        .concat(newNodeIndex)
        .sort((a, b) => a - b);

      return newData;
    });

    return updatedButton;
  }, []);

  const moveSkillButtonToStaff = useCallback((
    fromStaffIndex: number,
    toStaffIndex: number,
    buttonId: string,
    newPosition: { x: number; y: number },
    newNodeIndex: number
  ): SkillButtonData | null => {
    let movedButton: SkillButtonData | null = null;

    // 先更新 skill-button 总表
    const existingButton = getSkillButtonById(buttonId);
    if (existingButton) {
      upsertSkillButton({
        ...existingButton,
        staffIndex: toStaffIndex,
        position: newPosition,
        nodeIndex: newNodeIndex,
        nodeNumber: calculateNodeNumber(newNodeIndex),
        updatedAt: Date.now(),
      });
    }

    setTimelineData(prev => {
      const fromStaffLine = prev.staffLines[fromStaffIndex];
      const toStaffLine = prev.staffLines[toStaffIndex];
      const button = fromStaffLine?.buttons.find(b => b.id === buttonId);

      if (!fromStaffLine || !toStaffLine || !button) return prev;

      movedButton = {
        ...button,
        staffIndex: toStaffIndex,
        position: newPosition,
        nodeIndex: newNodeIndex,
        nodeNumber: calculateNodeNumber(newNodeIndex),
      };

      const newData: TimelineData = {
        ...prev,
        updatedAt: Date.now(),
        staffLines: [...prev.staffLines],
      };

      const newFromStaffLine = { ...newData.staffLines[fromStaffIndex] };
      const newToStaffLine = { ...newData.staffLines[toStaffIndex] };
      newData.staffLines[fromStaffIndex] = newFromStaffLine;
      newData.staffLines[toStaffIndex] = newToStaffLine;

      newFromStaffLine.buttons = newFromStaffLine.buttons
        .filter(b => b.id !== buttonId)
        .sort((a, b) => a.nodeIndex - b.nodeIndex);
      newFromStaffLine.occupiedNodes = newFromStaffLine.occupiedNodes
        .filter(n => n !== button.nodeIndex)
        .sort((a, b) => a - b);

      newToStaffLine.buttons = [...newToStaffLine.buttons, movedButton]
        .sort((a, b) => a.nodeIndex - b.nodeIndex);
      newToStaffLine.occupiedNodes = [...newToStaffLine.occupiedNodes, newNodeIndex]
        .sort((a, b) => a - b);

      return newData;
    });

    return movedButton;
  }, []);

  /**
   * 更新按钮的 selectedBuff（操作 skill-button 总表，不再写入 timeline.data）
   * @param buttonId - 按钮 ID
   * @param buffIds - Buff ID 列表
   */
  const updateSelectedBuffList = useCallback((buttonId: string, buffIds: string[]) => {
    const existingButton = getSkillButtonById(buttonId);
    if (existingButton) {
      upsertSkillButton({
        ...existingButton,
        selectedBuff: buffIds,
        updatedAt: Date.now(),
      });
    }
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
    return timelineData.staffLines[staffIndex]?.buttons || [];
  }, [timelineData]);

  const saveTimelineData = useCallback((): TimelineData => {
    const dataToSave = timelineDataRef.current;
    setStorageJson(STORAGE_KEYS.TIMELINE_DATA, dataToSave);
    console.log('[timeline] saved to sessionStorage', dataToSave);
    return dataToSave;
  }, []);

  const loadTimelineData = useCallback((): TimelineData | null => {
    const parsed = getStorageJson<TimelineData | null>(STORAGE_KEYS.TIMELINE_DATA, null);
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
    getStaffButtons,
    saveTimelineData,
    loadTimelineData,
    normalizeTimelineData,
  };
}
