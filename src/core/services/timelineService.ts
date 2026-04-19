/**
 * Timeline Service
 * 负责 Timeline 业务规则和写入顺序
 * 不依赖 React，不访问 DOM
 */

import { SkillButtonData, TimelineData, StaffLineData } from '../../types';
import { PersistedSkillButton } from '../../types/storage';
import { calculateNodeNumber } from '../../utils/nodeNumbering';
import {
  getSkillButtonById,
  upsertSkillButton,
  removeSkillButtonById,
  saveTimelineData as saveTimelineRepo,
  loadTimelineData as loadTimelineRepo,
} from '../repositories';
import { cleanupBuffsOnButtonRemove } from './buffService';

/**
 * 创建空的 Timeline 数据
 */
export function createEmptyTimelineData(characters: { name: string }[]): TimelineData {
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
 * 规范化 Timeline 数据
 * 确保 staffLines 长度与 selectedCharacters 一致
 */
export function normalizeTimelineData(
  data: TimelineData,
  characters: { name: string }[]
): TimelineData {
  const normalizedStaffLines: StaffLineData[] = [];

  for (let i = 0; i < characters.length; i++) {
    const existingLine = data.staffLines[i];
    if (existingLine) {
      normalizedStaffLines.push({
        staffIndex: i,
        characterName: characters[i].name,
        occupiedNodes: Array.isArray(existingLine.occupiedNodes) ? existingLine.occupiedNodes : [],
        buttons: Array.isArray(existingLine.buttons) ? existingLine.buttons : [],
      });
    } else {
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
 * 添加技能按钮
 * 同时写入 timeline.data 和 skill-button 总表
 */
export function addSkillButton(
  timelineData: TimelineData,
  buttonData: Omit<SkillButtonData, 'id' | 'nodeNumber'>,
  customId?: string
): { newButton: SkillButtonData; newTimelineData: TimelineData } {
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
    selectedBuff: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  upsertSkillButton(persistedButton);

  // 更新 timelineData
  const newTimelineData: TimelineData = {
    ...timelineData,
    updatedAt: Date.now(),
    staffLines: [...timelineData.staffLines],
  };

  const staffLine = { ...newTimelineData.staffLines[buttonData.staffIndex] };
  newTimelineData.staffLines[buttonData.staffIndex] = staffLine;

  staffLine.buttons = [...staffLine.buttons, newButton]
    .sort((a, b) => a.nodeIndex - b.nodeIndex);

  staffLine.occupiedNodes = [...staffLine.occupiedNodes, buttonData.nodeIndex]
    .sort((a, b) => a - b);

  return { newButton, newTimelineData };
}

/**
 * 删除技能按钮
 * 同时清理 timeline.data、skill-button 总表和 Buff 引用
 */
export function removeSkillButton(
  timelineData: TimelineData,
  staffIndex: number,
  buttonId: string
): TimelineData {
  // 1. 先读取 button 的 selectedBuff（删除前保存）
  const buttonToRemove = getSkillButtonById(buttonId);
  const oldSelectedBuff = [...(buttonToRemove?.selectedBuff || [])];

  // 2. 从 skill-button 总表删除 button
  removeSkillButtonById(buttonId);

  // 3. 执行 Buff 清理（cleanupBuffsOnButtonRemove 会处理引用检查）
  cleanupBuffsOnButtonRemove(oldSelectedBuff);

  // 4. 清理 timelineData 中的引用
  const newTimelineData: TimelineData = {
    ...timelineData,
    updatedAt: Date.now(),
    staffLines: [...timelineData.staffLines],
  };

  const staffLine = { ...newTimelineData.staffLines[staffIndex] };
  newTimelineData.staffLines[staffIndex] = staffLine;

  const button = staffLine.buttons.find(b => b.id === buttonId);

  if (button) {
    staffLine.buttons = staffLine.buttons.filter(b => b.id !== buttonId);
    staffLine.occupiedNodes = staffLine.occupiedNodes
      .filter(n => n !== button.nodeIndex)
      .sort((a, b) => a - b);
  }

  return newTimelineData;
}

/**
 * 更新技能按钮位置
 * 同时更新 timeline.data 和 skill-button 总表
 */
export function updateSkillButtonPosition(
  timelineData: TimelineData,
  staffIndex: number,
  buttonId: string,
  newPosition: { x: number; y: number },
  newNodeIndex: number
): { updatedButton: SkillButtonData | null; newTimelineData: TimelineData } {
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

  // 更新 timelineData
  const staffLine = timelineData.staffLines[staffIndex];
  const button = staffLine?.buttons.find(b => b.id === buttonId);

  if (!button) {
    return { updatedButton: null, newTimelineData: timelineData };
  }

  const oldNodeIndex = button.nodeIndex;

  const updatedButton: SkillButtonData = {
    ...button,
    position: newPosition,
    nodeIndex: newNodeIndex,
    nodeNumber: calculateNodeNumber(newNodeIndex),
  };

  const newTimelineData: TimelineData = {
    ...timelineData,
    updatedAt: Date.now(),
    staffLines: [...timelineData.staffLines],
  };

  const newStaffLine = { ...newTimelineData.staffLines[staffIndex] };
  newTimelineData.staffLines[staffIndex] = newStaffLine;

  newStaffLine.buttons = newStaffLine.buttons
    .map(b => b.id === buttonId ? updatedButton : b)
    .sort((a, b) => a.nodeIndex - b.nodeIndex);

  newStaffLine.occupiedNodes = newStaffLine.occupiedNodes
    .filter(n => n !== oldNodeIndex)
    .concat(newNodeIndex)
    .sort((a, b) => a - b);

  return { updatedButton, newTimelineData };
}

/**
 * 跨 staff 移动技能按钮
 * 同时更新 timeline.data 和 skill-button 总表
 */
export function moveSkillButtonToStaff(
  timelineData: TimelineData,
  fromStaffIndex: number,
  toStaffIndex: number,
  buttonId: string,
  newPosition: { x: number; y: number },
  newNodeIndex: number
): { movedButton: SkillButtonData | null; newTimelineData: TimelineData } {
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

  // 更新 timelineData
  const fromStaffLine = timelineData.staffLines[fromStaffIndex];
  const toStaffLine = timelineData.staffLines[toStaffIndex];
  const button = fromStaffLine?.buttons.find(b => b.id === buttonId);

  if (!fromStaffLine || !toStaffLine || !button) {
    return { movedButton: null, newTimelineData: timelineData };
  }

  const movedButton: SkillButtonData = {
    ...button,
    staffIndex: toStaffIndex,
    position: newPosition,
    nodeIndex: newNodeIndex,
    nodeNumber: calculateNodeNumber(newNodeIndex),
  };

  const newTimelineData: TimelineData = {
    ...timelineData,
    updatedAt: Date.now(),
    staffLines: [...timelineData.staffLines],
  };

  const newFromStaffLine = { ...newTimelineData.staffLines[fromStaffIndex] };
  const newToStaffLine = { ...newTimelineData.staffLines[toStaffIndex] };
  newTimelineData.staffLines[fromStaffIndex] = newFromStaffLine;
  newTimelineData.staffLines[toStaffIndex] = newToStaffLine;

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

  return { movedButton, newTimelineData };
}

/**
 * 保存 Timeline 数据
 */
export function saveTimelineData(timelineData: TimelineData): void {
  saveTimelineRepo(timelineData);
}

/**
 * 加载 Timeline 数据
 */
export function loadTimelineData(): TimelineData | null {
  return loadTimelineRepo();
}

/**
 * 获取指定 staff 的按钮列表
 */
export function getStaffButtons(timelineData: TimelineData, staffIndex: number): SkillButtonData[] {
  return timelineData.staffLines[staffIndex]?.buttons || [];
}

/**
 * @deprecated 已废弃，不再执行任何操作
 * 旧方法曾用于从 timelineData 更新 buffIds，现已改为 no-op。
 */
export function updateButtonBuffIds(
  _staffIndex: number,
  _buttonId: string,
  _buffIds: string[]
): void {
  // no-op: 禁止从旧 timelineData.buffIds 写回 skill-button 总表
  console.warn('[deprecated] updateButtonBuffIds 已废弃，不再执行任何操作');
}

/**
 * 更新按钮的 selectedBuff（操作 skill-button 总表，不再写入 timeline.data）
 * @param buttonId - 按钮 ID
 * @param buffIds - Buff ID 列表
 */
export function updateSelectedBuffList(buttonId: string, buffIds: string[]): void {
  const existingButton = getSkillButtonById(buttonId);
  if (existingButton) {
    upsertSkillButton({
      ...existingButton,
      selectedBuff: buffIds,
      updatedAt: Date.now(),
    });
  }
}
