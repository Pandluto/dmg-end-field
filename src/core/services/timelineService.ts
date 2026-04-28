/**
 * Timeline Service
 * 负责 Timeline 业务规则和写入顺序
 * 不依赖 React，不访问 DOM
 */

import { SkillButtonData, TimelineData, StaffLineData, SkillType } from '../../types';
import { PersistedSkillButton } from '../../types/storage';
import { calculateNodeNumber } from '../../utils/nodeNumbering';
import {
  getGridGroupTop,
  getGridLineCenterY,
  GRID_NODE_COUNT,
} from '../calculators/gridSnapLayout';
import {
  getSkillButtonById,
  getSkillButtonTable,
  setSkillButtonTable,
  upsertSkillButton,
  removeSkillButtonById,
  saveTimelineData as saveTimelineRepo,
  loadTimelineData as loadTimelineRepo,
} from '../repositories';
import { cleanupBuffsOnButtonRemove, recomputeSkillButtonPanel } from './buffService';

/**
 * 创建空的 Timeline 数据
 */
export function createEmptyTimelineData(characters: { name: string }[]): TimelineData {
  const now = Date.now();
  return {
    version: "1.1.0",
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
 * 按 characterName 匹配旧缓存，禁止按下标继承
 * 从有效按钮重建 occupiedNodes，不信任缓存中的旧占用
 */
export function normalizeTimelineData(
  data: TimelineData,
  characters: { name: string }[]
): TimelineData {
  const normalizedStaffLines: StaffLineData[] = [];

  for (let i = 0; i < characters.length; i++) {
    const characterName = characters[i].name;

    // 按 characterName 匹配旧 line，禁止按下标继承
    const existingLine = data.staffLines.find(
      line => line.characterName === characterName
    );

    if (existingLine && Array.isArray(existingLine.buttons)) {
      // 过滤：只保留属于当前角色的按钮
      const validButtons = existingLine.buttons.filter(
        btn => btn.characterName === characterName
      );

      // 从有效按钮重建 occupiedNodes，不信任缓存
      const occupiedNodes = [...new Set(validButtons.map(btn => btn.nodeIndex))]
        .filter(n => Number.isFinite(n) && n >= 0 && n < 15)
        .sort((a, b) => a - b);

      normalizedStaffLines.push({
        staffIndex: i,
        characterName,
        occupiedNodes,
        buttons: validButtons,
      });
    } else {
      // 找不到同名角色，创建空 line
      normalizedStaffLines.push({
        staffIndex: i,
        characterName,
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

function getButtonGroupIndex(globalNodeIndex: number): number {
  if (!Number.isFinite(globalNodeIndex) || globalNodeIndex < 0) {
    return 0;
  }

  return Math.floor(globalNodeIndex / GRID_NODE_COUNT);
}

function getReconciledButtonPosition(
  globalNodeIndex: number,
  lineIndex: number,
  position: { x: number; y: number }
): { x: number; y: number } {
  return {
    x: position.x,
    // v1.1.0+ stores position.y as the base midline, not the orb center.
    // 我的亲自手调，这里 +10才是对的
    y: getGridGroupTop(getButtonGroupIndex(globalNodeIndex)) + getGridLineCenterY(lineIndex) + 10,
  };
}

function buildTimelineButtonsFromSkillButtonTable(
  skillButtonTable: Record<string, PersistedSkillButton>,
  nextCharacters: { name: string }[]
): StaffLineData[] {
  return nextCharacters.map((character, index) => {
    const buttons = Object.values(skillButtonTable)
      .filter((button) => button.characterName === character.name)
      .map((button) => ({
        id: button.id,
        characterName: button.characterName,
        skillType: button.skillType as SkillType,
        staffIndex: index,
        nodeIndex: button.nodeIndex,
        nodeNumber: button.nodeNumber,
        position: button.position,
      }))
      .sort((left, right) => left.nodeIndex - right.nodeIndex);

    const occupiedNodes = [...new Set(buttons.map((button) => button.nodeIndex))]
      .filter((nodeIndex) => Number.isFinite(nodeIndex) && nodeIndex >= 0)
      .sort((left, right) => left - right);

    return {
      staffIndex: index,
      characterName: character.name,
      occupiedNodes,
      buttons,
    };
  });
}

export function reconcileSelectionChange(
  _prevCharacters: { id: string; name: string }[],
  nextCharacters: { id: string; name: string }[]
): TimelineData {
  const nextCharacterIndexMap = new Map(
    nextCharacters.map((character, index) => [character.name, index])
  );

  const currentTimelineData = loadTimelineRepo() ?? createEmptyTimelineData(nextCharacters);
  const currentSkillButtonTable = getSkillButtonTable();
  const nextSkillButtonTable: Record<string, PersistedSkillButton> = {};
  const removedButtonBuffRefs: string[][] = [];

  Object.values(currentSkillButtonTable).forEach((button) => {
    const nextCharacterIndex = nextCharacterIndexMap.get(button.characterName);

    if (nextCharacterIndex === undefined) {
      removedButtonBuffRefs.push([...(button.selectedBuff || [])]);
      return;
    }

    const nextButton = {
      ...button,
      staffIndex: nextCharacterIndex,
      position: getReconciledButtonPosition(button.nodeIndex, nextCharacterIndex, button.position),
      updatedAt: Date.now(),
    };

    nextSkillButtonTable[button.id] = nextButton;
  });

  setSkillButtonTable(nextSkillButtonTable);
  removedButtonBuffRefs.forEach((buffIds) => {
    cleanupBuffsOnButtonRemove(buffIds);
  });

  Object.keys(nextSkillButtonTable).forEach((buttonId) => {
    recomputeSkillButtonPanel(buttonId);
  });

  const nextStaffLines = buildTimelineButtonsFromSkillButtonTable(nextSkillButtonTable, nextCharacters);

  const nextTimelineData: TimelineData = {
    ...currentTimelineData,
    updatedAt: Date.now(),
    staffLines: nextStaffLines,
  };

  saveTimelineRepo(nextTimelineData);
  return nextTimelineData;
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
    characterId: buttonData.characterName,
    characterName: buttonData.characterName,
    skillType: buttonData.skillType,
    staffIndex: buttonData.staffIndex,
    nodeIndex: buttonData.nodeIndex,
    nodeNumber: newButton.nodeNumber,
    position: buttonData.position,
    selectedBuff: [],
    panelConfig: {
      selectedBuff: [],
    },
    panelSnapshot: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  upsertSkillButton(persistedButton);
  recomputeSkillButtonPanel(buttonId);

  // 更新 timelineData
  const newTimelineData: TimelineData = {
    ...timelineData,
    updatedAt: Date.now(),
    staffLines: [...timelineData.staffLines],
  };

  // 防御脏数据：确保 staffLine 存在且 buttons/occupiedNodes 是数组
  let staffLine = newTimelineData.staffLines[buttonData.staffIndex];
  if (!staffLine) {
    staffLine = {
      staffIndex: buttonData.staffIndex,
      characterName: buttonData.characterName,
      buttons: [],
      occupiedNodes: [],
    };
  }
  staffLine = {
    ...staffLine,
    buttons: Array.isArray(staffLine.buttons) ? staffLine.buttons : [],
    occupiedNodes: Array.isArray(staffLine.occupiedNodes) ? staffLine.occupiedNodes : [],
  };
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

  // 更新 timelineData - 防御脏数据
  let staffLine = timelineData.staffLines[staffIndex];
  if (!staffLine) {
    staffLine = {
      staffIndex,
      characterName: '',
      buttons: [],
      occupiedNodes: [],
    };
  }
  // 防御非数组
  staffLine = {
    ...staffLine,
    buttons: Array.isArray(staffLine.buttons) ? staffLine.buttons : [],
    occupiedNodes: Array.isArray(staffLine.occupiedNodes) ? staffLine.occupiedNodes : [],
  };

  const button = staffLine.buttons.find(b => b.id === buttonId);

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

  const newStaffLine = { ...staffLine };
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

  // 更新 timelineData - 防御脏数据 + 兜底查找真实来源组
  let actualFromStaffIndex = fromStaffIndex;
  let fromStaffLine = timelineData.staffLines[fromStaffIndex];

  // 先在指定 fromStaffIndex 查找
  if (fromStaffLine && Array.isArray(fromStaffLine.buttons)) {
    const foundButton = fromStaffLine.buttons.find(b => b.id === buttonId);
    if (!foundButton) {
      // 兜底：遍历全部 staffLines 查找真实来源组
      for (let i = 0; i < timelineData.staffLines.length; i++) {
        const staffLine = timelineData.staffLines[i];
        if (staffLine && Array.isArray(staffLine.buttons)) {
          const btn = staffLine.buttons.find(b => b.id === buttonId);
          if (btn) {
            actualFromStaffIndex = i;
            fromStaffLine = staffLine;
            break;
          }
        }
      }
    }
  }

  let toStaffLine = timelineData.staffLines[toStaffIndex];

  // 防御 fromStaffLine 不存在或非数组
  if (!fromStaffLine) {
    fromStaffLine = {
      staffIndex: actualFromStaffIndex,
      characterName: '',
      buttons: [],
      occupiedNodes: [],
    };
  }
  fromStaffLine = {
    ...fromStaffLine,
    buttons: Array.isArray(fromStaffLine.buttons) ? fromStaffLine.buttons : [],
    occupiedNodes: Array.isArray(fromStaffLine.occupiedNodes) ? fromStaffLine.occupiedNodes : [],
  };

  // 防御 toStaffLine 不存在或非数组
  if (!toStaffLine) {
    toStaffLine = {
      staffIndex: toStaffIndex,
      characterName: '',
      buttons: [],
      occupiedNodes: [],
    };
  }
  toStaffLine = {
    ...toStaffLine,
    buttons: Array.isArray(toStaffLine.buttons) ? toStaffLine.buttons : [],
    occupiedNodes: Array.isArray(toStaffLine.occupiedNodes) ? toStaffLine.occupiedNodes : [],
  };

  const button = fromStaffLine.buttons.find(b => b.id === buttonId);

  if (!button) {
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

  // 使用归一化后的 staffLine 写回
  const newFromStaffLine = { ...fromStaffLine };
  const newToStaffLine = { ...toStaffLine };
  newTimelineData.staffLines[actualFromStaffIndex] = newFromStaffLine;
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
      panelConfig: {
        ...(existingButton.panelConfig ?? { selectedBuff: [] }),
        selectedBuff: [...buffIds],
      },
      updatedAt: Date.now(),
    });
    recomputeSkillButtonPanel(buttonId);
  }
}

/**
 * 更新技能按钮类型
 * 同时更新 timeline.data 和 skill-button 总表
 */
export function updateSkillButtonType(
  timelineData: TimelineData,
  buttonId: string,
  nextSkillType: SkillType
): { updatedButton: SkillButtonData | null; updatedPersistedButton: PersistedSkillButton | null; newTimelineData: TimelineData } {
  // 1. 查找按钮所在 staffLine
  let targetStaffLine: StaffLineData | null = null;
  let targetButton: SkillButtonData | null = null;
  let targetStaffIndex = -1;

  for (let i = 0; i < timelineData.staffLines.length; i++) {
    const staffLine = timelineData.staffLines[i];
    if (staffLine && Array.isArray(staffLine.buttons)) {
      const btn = staffLine.buttons.find(b => b.id === buttonId);
      if (btn) {
        targetStaffLine = staffLine;
        targetButton = btn;
        targetStaffIndex = i;
        break;
      }
    }
  }

  if (!targetStaffLine || !targetButton) {
    return { updatedButton: null, updatedPersistedButton: null, newTimelineData: timelineData };
  }

  // 2. 更新 skill-button 总表
  const existingPersistedButton = getSkillButtonById(buttonId);
  let updatedPersistedButton: PersistedSkillButton | null = null;

  if (existingPersistedButton) {
    updatedPersistedButton = {
      ...existingPersistedButton,
      skillType: nextSkillType,
      updatedAt: Date.now(),
    };
    upsertSkillButton(updatedPersistedButton);
  }

  // 3. 更新 timelineData
  const updatedTimelineButton: SkillButtonData = {
    ...targetButton,
    skillType: nextSkillType,
  };

  const newTimelineData: TimelineData = {
    ...timelineData,
    updatedAt: Date.now(),
    staffLines: [...timelineData.staffLines],
  };

  const newStaffLine: StaffLineData = {
    ...targetStaffLine,
    buttons: targetStaffLine.buttons.map(b => b.id === buttonId ? updatedTimelineButton : b),
  };
  newTimelineData.staffLines[targetStaffIndex] = newStaffLine;

  return { updatedButton: updatedTimelineButton, updatedPersistedButton, newTimelineData };
}
