/**
 * 排轴数据管理 Hook
 * 管理技能按钮的增删改查，点击保存时存储到 sessionStorage
 */

import { useState, useCallback, useRef } from 'react';
import { SkillButtonData, TimelineData } from '../types';
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
   * @returns 加载的数据对象，如果没有则返回 null
   */
  const loadTimelineData = useCallback((): TimelineData | null => {
    const parsed = getStorageJson<TimelineData | null>(STORAGE_KEYS.TIMELINE_DATA, null);
    if (parsed) {
      setTimelineData(parsed);
      console.log('【排轴数据】已从 sessionStorage 加载:', parsed);
      return parsed;
    }
    return null;
  }, []);

  return {
    timelineData,
    addSkillButton,
    removeSkillButton,
    getStaffButtons,
    saveTimelineData,
    loadTimelineData,
  };
}
