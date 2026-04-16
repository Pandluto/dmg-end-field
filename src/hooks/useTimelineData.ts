/**
 * 排轴数据管理 Hook
 * 管理技能按钮的增删改查，点击保存时存储到 sessionStorage
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { SkillButtonData, TimelineData, StaffLineData } from '../types';
import { STORAGE_KEYS } from '../constants/storage-keys';
import { calculateNodeNumber } from '../utils/nodeNumbering';
import { getStorageJson, setStorageJson } from '../utils/storage';

/**
 * 创建空的排轴数据结构
 * @param characters - 已选干员列表
 * @returns 空的 TimelineData 对象
 */
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

/**
 * 规范化 timelineData 结构
 * 确保 staffLines 长度与 selectedCharacters 一致，补齐缺失的 line
 * @param data - 从 sessionStorage 加载的 timelineData
 * @param characters - 当前已选干员列表
 * @returns 规范化后的 TimelineData
 */
function normalizeTimelineData(
  data: TimelineData,
  characters: { name: string }[]
): TimelineData {
  const normalizedStaffLines: StaffLineData[] = [];
  
  // 确保每个干员都有对应的 staffLine
  for (let i = 0; i < characters.length; i++) {
    const existingLine = data.staffLines[i];
    if (existingLine) {
      // 使用现有的 line，但确保字段合法
      normalizedStaffLines.push({
        staffIndex: i,
        characterName: characters[i].name,
        occupiedNodes: Array.isArray(existingLine.occupiedNodes) ? existingLine.occupiedNodes : [],
        buttons: Array.isArray(existingLine.buttons) ? existingLine.buttons : [],
      });
    } else {
      // 补齐缺失的 line
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
    updatedAt: Date.now(),
  };
}

/**
 * 排轴数据管理 Hook
 * @param selectedCharacters - 已选干员列表
 * @returns 排轴数据和相关操作函数
 */
export function useTimelineData(selectedCharacters: { name: string }[]) {
  // 排轴数据状态（内存中，不自动持久化）
  const [timelineData, setTimelineData] = useState<TimelineData>(() => {
    return createEmptyTimelineData(selectedCharacters);
  });

  // 使用 ref 存储最新数据，供保存时使用
  const timelineDataRef = useRef(timelineData);
  timelineDataRef.current = timelineData;

  // debounce 自动保存
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // timelineData 变化后 300ms 自动保存
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      const dataToSave = timelineDataRef.current;
      setStorageJson(STORAGE_KEYS.TIMELINE_DATA, dataToSave);
      console.log('【自动保存】已保存到 sessionStorage');
    }, 300);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [timelineData]);

  /**
   * 添加技能按钮
   * @param buttonData - 按钮数据（不含 id 和 nodeNumber）
   * @param customId - 可选的自定义按钮 ID，如果不提供则自动生成
   * @returns 完整的 SkillButtonData 对象
   */
  const addSkillButton = useCallback((buttonData: Omit<SkillButtonData, 'id' | 'nodeNumber'>, customId?: string): SkillButtonData => {
    const newButton: SkillButtonData = {
      ...buttonData,
      id: customId || `btn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      nodeNumber: calculateNodeNumber(buttonData.nodeIndex),
    };

    setTimelineData(prev => {
      const newData: TimelineData = {
        ...prev,
        updatedAt: Date.now(),
        staffLines: [...prev.staffLines],
      };

      const staffLine = { ...newData.staffLines[buttonData.staffIndex] };
      newData.staffLines[buttonData.staffIndex] = staffLine;

      // 添加按钮并排序
      staffLine.buttons = [...staffLine.buttons, newButton]
        .sort((a, b) => a.nodeIndex - b.nodeIndex);

      // 更新占用节点列表并排序
      staffLine.occupiedNodes = [...staffLine.occupiedNodes, buttonData.nodeIndex]
        .sort((a, b) => a - b);

      return newData;
    });

    return newButton;
  }, []);

  /**
   * 删除技能按钮
   * @param staffIndex - 干员索引
   * @param buttonId - 按钮 ID
   */
  const removeSkillButton = useCallback((staffIndex: number, buttonId: string) => {
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
        // 移除按钮
        staffLine.buttons = staffLine.buttons.filter(b => b.id !== buttonId);
        // 更新占用节点
        staffLine.occupiedNodes = staffLine.occupiedNodes
          .filter(n => n !== button.nodeIndex)
          .sort((a, b) => a - b);
      }

      return newData;
    });
  }, []);

  /**
   * 更新技能按钮位置（移动按钮时使用，保留原按钮 ID 和 Buff 关联）
   * @param staffIndex - 干员索引
   * @param buttonId - 按钮 ID
   * @param newPosition - 新位置坐标
   * @param newNodeIndex - 新节点索引
   * @returns 更新后的按钮数据，如果未找到则返回 null
   */
  const updateSkillButtonPosition = useCallback((
    staffIndex: number,
    buttonId: string,
    newPosition: { x: number; y: number },
    newNodeIndex: number
  ): SkillButtonData | null => {
    let updatedButton: SkillButtonData | null = null;

    setTimelineData(prev => {
      const staffLine = prev.staffLines[staffIndex];
      const button = staffLine?.buttons.find(b => b.id === buttonId);
      
      if (!button) return prev;

      const oldNodeIndex = button.nodeIndex;
      
      // 创建更新后的按钮数据
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

      // 更新按钮列表（替换原按钮并排序）
      newStaffLine.buttons = newStaffLine.buttons
        .map(b => b.id === buttonId ? updatedButton! : b)
        .sort((a, b) => a.nodeIndex - b.nodeIndex);

      // 更新占用节点列表（移除旧节点，添加新节点）
      newStaffLine.occupiedNodes = newStaffLine.occupiedNodes
        .filter(n => n !== oldNodeIndex)
        .concat(newNodeIndex)
        .sort((a, b) => a - b);

      return newData;
    });

    return updatedButton;
  }, []);

  /**
   * 更新按钮的 Buff ID 列表
   * @param staffIndex - 干员索引
   * @param buttonId - 按钮 ID
   * @param buffIds - Buff ID 列表
   */
  const updateButtonBuffIds = useCallback((staffIndex: number, buttonId: string, buffIds: string[]) => {
    setTimelineData(prev => {
      const staffLine = prev.staffLines[staffIndex];
      const button = staffLine?.buttons.find(b => b.id === buttonId);
      
      if (!button) return prev;

      const newData: TimelineData = {
        ...prev,
        updatedAt: Date.now(),
        staffLines: [...prev.staffLines],
      };

      const newStaffLine = { ...newData.staffLines[staffIndex] };
      newData.staffLines[staffIndex] = newStaffLine;

      // 更新按钮的 buffIds
      newStaffLine.buttons = newStaffLine.buttons.map(b =>
        b.id === buttonId ? { ...b, buffIds } : b
      );

      return newData;
    });
  }, []);

  /**
   * 获取指定干员谱线上的所有按钮
   * @param staffIndex - 干员索引
   * @returns 按钮列表
   */
  const getStaffButtons = useCallback((staffIndex: number): SkillButtonData[] => {
    return timelineData.staffLines[staffIndex]?.buttons || [];
  }, [timelineData]);

  /**
   * 保存排轴数据到 sessionStorage
   * 点击保存按钮时调用
   * @returns 保存的数据对象
   */
  const saveTimelineData = useCallback((): TimelineData => {
    const dataToSave = timelineDataRef.current;
    setStorageJson(STORAGE_KEYS.TIMELINE_DATA, dataToSave);
    console.log('【排轴数据】已保存到 sessionStorage:', dataToSave);
    return dataToSave;
  }, []);

  /**
   * 从 sessionStorage 加载排轴数据
   * 加载后会根据当前 selectedCharacters 规范化 staffLines 结构
   * @returns 加载并规范化后的数据对象，如果没有则返回 null
   */
  const loadTimelineData = useCallback((): TimelineData | null => {
    const parsed = getStorageJson<TimelineData | null>(STORAGE_KEYS.TIMELINE_DATA, null);
    if (parsed) {
      // 规范化数据：确保 staffLines 长度与 selectedCharacters 一致
      const normalized = normalizeTimelineData(parsed, selectedCharacters);
      setTimelineData(normalized);
      console.log('【排轴数据】已从 sessionStorage 加载并规范化:', normalized);
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
    updateButtonBuffIds,
    getStaffButtons,
    saveTimelineData,
    loadTimelineData,
    normalizeTimelineData,
  };
}
