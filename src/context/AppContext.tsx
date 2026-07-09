/**
 * 应用全局状态管理
 *
 * 架构：
 * - AppProvider：根组件，提供 Context.Provider，初始化时加载所有干员数据
 * - useAppContext：消费 Context，返回 state 和 dispatch，供所有子组件使用
 * - appReducer：纯函数，根据 action 更新状态，支持以下操作：
 *
 * Action 说明：
 * - SELECT_CHARACTER / DESELECT_CHARACTER：干员选择（最多 4 人）
 * - SET_VIEW：切换视图（selection <-> canvas）
 * - ADD_SKILL_BUTTON / REMOVE_SKILL_BUTTON / SET_SKILL_BUTTONS：画布上技能按钮的增删与整表替换
 * - SET_SKILL_BUTTON_POSITION：移动画布上已有按钮
 * - SELECT_SKILL_BUTTON：选中画布上的技能按钮
 * - SET_DRAGGING：标记按钮是否正在被拖拽（影响拖拽跟随）
 * - CLEAR_SKILL_BUTTONS：清空画布
 */

import React, { createContext, useCallback, useContext, useMemo, useReducer, ReactNode, useEffect, useRef } from 'react';
import { LOCAL_LIBRARY_CHANGED_EVENT } from '../aiCli/aiCliCommandService';
import {
  AppState,
  Character,
  SandboxSkill,
  SkillButton,
  SkillType,
  ViewType,
  DEFAULT_CANVAS_CONFIG,
} from '../types';
import { resolveAvatarUrl, resolvePublicPath, resolveSkillIconUrl } from '../utils/assetResolver';
import {
  cleanupStorage,
  getSelectedCharacterIds,
  safeSessionStorage,
  setSelectedCharacterIds,
} from '../utils/storage';
import { STORAGE_KEYS } from '../constants/storage-keys';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../utils/appRoute';
import {
  adaptRuntimeTemplateToLegacyCharacter,
  loadLocalOperatorCharacters,
  loadLocalOperatorDraftMap,
} from '../core/services/localOperatorAdapter';
import { reconcileSelectionChange } from '../core/services/timelineService';
import {
  buildRuntimeOperatorTemplateFromOfficialCharacter,
  buildRuntimeOperatorTemplateFromDraft,
} from '../core/services/operatorTemplateAdapter';
import { setRuntimeOperatorTemplateMap } from '../utils/storage';
import {
  getPendingMainWorkbenchCommands,
  patchMainWorkbenchCommand,
  pullRemoteMainWorkbenchCommands,
  pushMainWorkbenchCommandResult,
  pushMainWorkbenchSnapshot,
  readMainWorkbenchSnapshot,
  writeMainWorkbenchSnapshot,
  type MainWorkbenchSnapshot,
} from '../utils/mainWorkbenchControl';
import {
  removeTimelineData,
  setAllBuffList,
  setSkillButtonTable,
} from '../core/repositories';

function buildSelectionWorkbenchSnapshot(
  selectedCharacters: Character[],
  currentView: ViewType,
  skillButtons: SkillButton[],
): MainWorkbenchSnapshot {
  const previousSnapshot = readMainWorkbenchSnapshot();
  const selectedKeys = new Set(selectedCharacters.flatMap((character) => [character.id, character.name]));
  const selectedLineIndex = new Map(selectedCharacters.flatMap((character, index) => [
    [character.id, index],
    [character.name, index],
  ]));
  const previousButtons = Array.isArray(previousSnapshot?.skillButtons) ? previousSnapshot.skillButtons : [];
  const sourceButtons = skillButtons.length > 0
    ? skillButtons.map((button) => ({
        id: button.id,
        characterId: button.characterId,
        characterName: button.characterName,
        skillType: button.skillType,
        runtimeSkillId: button.runtimeSkillId,
        skillDisplayName: button.skillDisplayName,
        staffIndex: button.staffIndex,
        lineIndex: button.lineIndex,
        nodeIndex: button.nodeIndex,
        nodeNumber: button.nodeNumber,
        selectedBuffIds: [],
      }))
    : previousButtons;
  const mirroredButtons = sourceButtons
    .filter((button) => selectedKeys.has(button.characterId) || selectedKeys.has(button.characterName))
    .map((button) => ({
      ...button,
      lineIndex: selectedLineIndex.get(button.characterId) ?? selectedLineIndex.get(button.characterName) ?? button.lineIndex,
      selectedBuffIds: [...(button.selectedBuffIds ?? [])],
    }));
  const previousDamageReport = previousSnapshot?.damageReport;
  const canReuseDamageReport = Boolean(previousDamageReport) &&
    previousSnapshot?.skillButtons?.length === mirroredButtons.length &&
    previousDamageReport?.buttonCount === mirroredButtons.length;

  return {
    schemaVersion: 1,
    updatedAt: Date.now(),
    source: 'app',
    currentView,
    selectedCharacters: selectedCharacters.map((character) => ({
      id: character.id,
      name: character.name,
      element: character.element,
      profession: character.profession,
      librarySource: character.librarySource,
    })),
    skillButtons: mirroredButtons,
    damageReport: canReuseDamageReport && previousDamageReport
      ? previousDamageReport
      : {
          generatedAt: 0,
          totalExpected: 0,
          totalNonCrit: 0,
          buttonCount: mirroredButtons.length,
          buttons: [],
        },
    operatorConfigs: (previousSnapshot?.operatorConfigs ?? []).filter((config) =>
      selectedKeys.has(config.characterId) || selectedKeys.has(config.characterName)
    ),
  };
}

/** 所有支持的 Action 类型（Tagged Union）*/
type AppAction =
  | { type: 'SET_LOADED_CHARACTERS'; characters: Character[] }
  | { type: 'SET_SELECTED_CHARACTERS'; characters: Character[] }
  | { type: 'SELECT_CHARACTER'; character: Character }
  | { type: 'DESELECT_CHARACTER'; characterId: string }
  | { type: 'SET_VIEW'; view: ViewType }
  | { type: 'ADD_SKILL_BUTTON'; button: SkillButton }
  | { type: 'SET_SKILL_BUTTONS'; buttons: SkillButton[] }
  | { type: 'REMOVE_SKILL_BUTTON'; buttonId: string }
  | {
      type: 'SET_SKILL_BUTTON_POSITION';
      buttonId: string;
      position: { x: number; y: number };
      lineIndex?: number;
      staffIndex?: number;
      nodeIndex?: number;
      nodeNumber?: number;
    }
  | { type: 'SELECT_SKILL_BUTTON'; buttonId: string | null }
  | { type: 'SET_DRAGGING'; buttonId: string; isDragging: boolean }
  | { type: 'TOGGLE_SKILL_BUTTON_LOCK'; buttonId: string }
  | {
      type: 'UPDATE_SKILL_BUTTON_TYPE';
      buttonId: string;
      skillType: SkillType;
      runtimeSkillId?: string;
      skillDisplayName?: string;
      skillIconUrl?: string;
      customHits?: SkillButton['customHits'];
    }
  | { type: 'CLEAR_SKILL_BUTTONS' };

/** 初始状态：默认显示干员选择界面，无已选干员，无技能按钮 */
const initialState: AppState = {
  currentView: 'selection',
  selectedCharacters: [],
  canvasConfig: DEFAULT_CANVAS_CONFIG,
  skillButtons: [],
  loadedCharacters: [],
};

const serializeCharactersForRefresh = (characters: Character[]) => JSON.stringify(
  characters.map((character) => ({
    id: character.id,
    name: character.name,
    rarity: character.rarity,
    profession: character.profession,
    element: character.element,
    mainStat: character.mainStat,
    subStat: character.subStat,
    attributes: character.attributes,
    skills: character.skills,
    avatarUrl: character.avatarUrl,
    skillIconMap: character.skillIconMap,
    librarySource: character.librarySource,
    sandboxSkills: character.sandboxSkills,
    operatorBuffs: character.operatorBuffs,
  })),
);

function buildOfficialSandboxSkills(character: Character): SandboxSkill[] {
  const officialSkillMap = {
    A: character.skills.normalAttack,
    B: character.skills.skill,
    E: character.skills.chainSkill,
    Q: character.skills.ultimate,
  } as const;

  return (['A', 'B', 'E', 'Q'] as const).map((skillType) => {
    const skill = officialSkillMap[skillType];
    const multipliers = skill?.multipliers?.M3 ?? skill?.multipliers?.['9'] ?? {};
    const hitCount = Object.keys(multipliers).filter((key) => /^hit\d+$/i.test(key)).length || 1;

    return {
      id: `official-${skillType}`,
      displayName: skill?.name || skillType,
      buttonType: skillType,
      iconUrl: character.skillIconMap?.[skillType],
      hitCount,
      source: 'official',
    };
  });
}

/**
 * 状态更新纯函数
 * 根据 action 类型对 AppState 进行不可变更新
 */
function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_LOADED_CHARACTERS':
      return { ...state, loadedCharacters: action.characters };

    case 'SET_SELECTED_CHARACTERS':
      return { ...state, selectedCharacters: action.characters };

    // 选择干员：已达 4 人上限或已选中则忽略
    case 'SELECT_CHARACTER': {
      if (state.selectedCharacters.length >= 4) {
        return state;
      }
      if (state.selectedCharacters.find((c) => c.id === action.character.id)) {
        return state;
      }
      return {
        ...state,
        selectedCharacters: [...state.selectedCharacters, action.character],
      };
    }

    // 取消选择：从已选列表中移除
    case 'DESELECT_CHARACTER': {
      const newSelected = state.selectedCharacters.filter((c) => c.id !== action.characterId);
      return {
        ...state,
        selectedCharacters: newSelected,
      };
    }

    // 切换视图
    case 'SET_VIEW':
      return { ...state, currentView: action.view };

    // 添加技能按钮到画布
    case 'ADD_SKILL_BUTTON':
      return {
        ...state,
        skillButtons: [...state.skillButtons, action.button],
      };

    case 'SET_SKILL_BUTTONS':
      return {
        ...state,
        skillButtons: action.buttons,
      };

    // 移除技能按钮
    case 'REMOVE_SKILL_BUTTON':
      return {
        ...state,
        skillButtons: state.skillButtons.filter((btn) => btn.id !== action.buttonId),
      };

    // 更新技能按钮位置（包括跨线移动时更新 lineIndex/staffIndex）
    case 'SET_SKILL_BUTTON_POSITION': {
      return {
        ...state,
        skillButtons: state.skillButtons.map((btn) =>
          btn.id === action.buttonId
            ? {
                ...btn,
                position: action.position,
                ...(action.lineIndex !== undefined && { lineIndex: action.lineIndex }),
                ...(action.staffIndex !== undefined && { staffIndex: action.staffIndex }),
                ...(action.nodeIndex !== undefined && { nodeIndex: action.nodeIndex }),
                ...(action.nodeNumber !== undefined && { nodeNumber: action.nodeNumber }),
              }
            : btn
        ),
      };
    }

    // 选中技能按钮（同一时间只能选中一个）
    case 'SELECT_SKILL_BUTTON': {
      return {
        ...state,
        skillButtons: state.skillButtons.map((btn) => ({
          ...btn,
          isSelected: btn.id === action.buttonId,
        })),
      };
    }

    // 设置拖拽状态（用于渲染时的视觉反馈）
    case 'SET_DRAGGING': {
      return {
        ...state,
        skillButtons: state.skillButtons.map((btn) =>
          btn.id === action.buttonId ? { ...btn, isDragging: action.isDragging } : btn
        ),
      };
    }

    // 清空画布
    case 'CLEAR_SKILL_BUTTONS':
      return { ...state, skillButtons: [] };

    // 切换技能按钮锁定状态
    case 'TOGGLE_SKILL_BUTTON_LOCK': {
      return {
        ...state,
        skillButtons: state.skillButtons.map((btn) =>
          btn.id === action.buttonId ? { ...btn, isLocked: !btn.isLocked } : btn
        ),
      };
    }

    // 更新技能按钮类型
    case 'UPDATE_SKILL_BUTTON_TYPE': {
      return {
        ...state,
        skillButtons: state.skillButtons.map((btn) =>
          btn.id === action.buttonId
            ? {
                ...btn,
                skillType: action.skillType,
                skillIconUrl: action.skillIconUrl,
                runtimeSkillId: action.runtimeSkillId,
                skillDisplayName: action.skillDisplayName,
                customHits: action.customHits,
              }
            : btn
        ),
      };
    }

    default:
      return state;
  }
}

/** Context 类型定义 */
interface AppContextType {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
  loadCharacters: () => Promise<void>;
  refreshSelectedCharacters: () => Promise<Character[]>;
}

const AppContext = createContext<AppContextType | null>(null);

/**
 * 根 Provider 组件
 * 初始化时加载所有干员 JSON 数据，并注入 avatarUrl / skillIconMap 派生字段
 */
export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const selectedCharactersHydratedRef = useRef(false);
  const canvasLocalRefreshSignatureRef = useRef<string | null>(null);
  const loadedCharactersSignatureRef = useRef<string | null>(null);
  const isProcessingWorkbenchCommandRef = useRef(false);

  const refreshSelectedLocalCharacters = useCallback((selectedCharacters: Character[]) => {
    const localDraftMap = loadLocalOperatorDraftMap();
    let changed = false;
    const refreshedCharacters = selectedCharacters.map((character) => {
      const draft = localDraftMap[character.id];
      if (!draft) {
        return character;
      }
      const refreshedCharacter = adaptRuntimeTemplateToLegacyCharacter(buildRuntimeOperatorTemplateFromDraft(draft));
      if (
        character.name !== refreshedCharacter.name
        || character.avatarUrl !== refreshedCharacter.avatarUrl
        || JSON.stringify(character.skillIconMap ?? {}) !== JSON.stringify(refreshedCharacter.skillIconMap ?? {})
        || JSON.stringify((character.sandboxSkills ?? []).map((skill) => [skill.id, skill.displayName, skill.iconUrl, skill.hitCount])) !== JSON.stringify((refreshedCharacter.sandboxSkills ?? []).map((skill) => [skill.id, skill.displayName, skill.iconUrl, skill.hitCount]))
      ) {
        changed = true;
      }
      return refreshedCharacter;
    });

    return changed ? refreshedCharacters : selectedCharacters;
  }, []);

  /**
   * 从 public/data/characters/operators-list.json 动态加载所有干员名称列表，
   * 再根据名称加载对应角色的 JSON 数据。
   * 加载完成后为每个干员注入派生字段：
   * - avatarUrl：头像图片路径
   * - skillIconMap：四个技能的图标路径映射
   */
  const loadOfficialCharacters = useCallback(async (): Promise<Character[]> => {
    const listResponse = await fetch(resolvePublicPath('data/characters/operators-list.json'), { cache: 'no-store' });
    if (!listResponse.ok) {
      console.warn('Failed to load operators-list.json');
      return [];
    }
    const operatorList: { name: string }[] = await listResponse.json();
    const characters: Character[] = [];

    for (const operator of operatorList) {
      const fileName = `${operator.name}/${operator.name}.json`;
      try {
        const response = await fetch(resolvePublicPath(`data/characters/${fileName}`), { cache: 'no-store' });
        if (response.ok) {
          const data = await response.json();
          const character = data as Character;
          character.id = character.name;
          character.avatarUrl = resolveAvatarUrl(character.name);
          character.skillIconMap = {
            A: resolveSkillIconUrl(character.name, 'A'),
            B: resolveSkillIconUrl(character.name, 'B'),
            E: resolveSkillIconUrl(character.name, 'E'),
            Q: resolveSkillIconUrl(character.name, 'Q'),
          };
          character.librarySource = 'official';
          character.sandboxSkills = buildOfficialSandboxSkills(character);
          characters.push(character);
        }
      } catch (error) {
        console.warn(`Failed to load ${fileName}:`, error);
      }
    }

    return characters;
  }, []);

  const buildRestorableCharacterMap = useCallback((officialCharacters: Character[]) => {
    const localCharacters = loadLocalOperatorCharacters();
    const restorableCharacterMap = new Map<string, Character>();
    officialCharacters.forEach((char) => restorableCharacterMap.set(char.id, char));
    localCharacters.forEach((char) => restorableCharacterMap.set(char.id, char));
    return restorableCharacterMap;
  }, []);

  const rebuildSelectedRuntimeTemplateMap = useCallback((selectedCharacters: Character[]) => {
    // 空选中态：清空模板表
    if (selectedCharacters.length === 0) {
      setRuntimeOperatorTemplateMap({});
      console.log('[AppContext] 模板表已清空（无已选角色）');
      return;
    }

    // 加载本地 draft map 用于本地角色定向查找
    const localDraftMap = loadLocalOperatorDraftMap();

    // 为每个已选角色构建模板
    const nextMap: Record<string, ReturnType<typeof buildRuntimeOperatorTemplateFromOfficialCharacter>> = {};

    selectedCharacters.forEach((character) => {
      if (character.librarySource === 'official') {
        // 官方角色：直接从 character 构建
        nextMap[character.id] = buildRuntimeOperatorTemplateFromOfficialCharacter(character);
      } else if (character.librarySource === 'local') {
        // 本地角色：按 id 定向取 draft 后构建
        const draft = localDraftMap[character.id];
        if (draft) {
          nextMap[character.id] = buildRuntimeOperatorTemplateFromDraft(draft);
        } else {
          console.warn(`[AppContext] 本地角色 ${character.id} 的 draft 不存在，跳过模板构建`);
        }
      }
    });

    setRuntimeOperatorTemplateMap(nextMap);
    console.log('[AppContext] 模板表已重建:', {
      selectedCount: selectedCharacters.length,
      templateCount: Object.keys(nextMap).length,
      ids: Object.keys(nextMap),
    });
  }, []);

  const loadCharacters = useCallback(async () => {
    try {
      const characters = await loadOfficialCharacters();
      loadedCharactersSignatureRef.current = serializeCharactersForRefresh(characters);
      dispatch({ type: 'SET_LOADED_CHARACTERS', characters });
      const restorableCharacterMap = buildRestorableCharacterMap(characters);

        const selectedCharacterIds = getSelectedCharacterIds();
        const hasTimelineData = Boolean(safeSessionStorage.getItem(STORAGE_KEYS.TIMELINE_DATA));
        console.log('[AppContext] restore check', {
          selectedCharacterIds,
          rawSelectedCharacters: safeSessionStorage.getItem(STORAGE_KEYS.SELECTED_CHARACTERS),
          hasTimelineData,
          rawTimelineData: safeSessionStorage.getItem(STORAGE_KEYS.TIMELINE_DATA),
        });

      if (selectedCharacterIds.length > 0 && hasTimelineData) {
        const restoredCharacters = selectedCharacterIds
          .map((characterId) => restorableCharacterMap.get(characterId))
          .filter((character): character is Character => Boolean(character))
          .slice(0, 4);
        const refreshedRestoredCharacters = refreshSelectedLocalCharacters(restoredCharacters);

        const expectedCount = Math.min(selectedCharacterIds.length, 4);
        const restoredIds = refreshedRestoredCharacters.map((c) => c.id);
        const missingIds = selectedCharacterIds.filter((id) => !restoredIds.includes(id));

        if (refreshedRestoredCharacters.length > 0 && refreshedRestoredCharacters.length === expectedCount) {
          dispatch({ type: 'SET_SELECTED_CHARACTERS', characters: refreshedRestoredCharacters });
          dispatch({ type: 'SET_VIEW', view: 'canvas' });
          // 恢复成功后：定向重建模板表（只包含已恢复角色）
          // 注：这里手动重建是为了首轮 hydration，后续变更统一由 selectedCharacters effect 接管
          rebuildSelectedRuntimeTemplateMap(refreshedRestoredCharacters);
        } else {
          console.warn('[AppContext] 角色恢复失败:', {
            selectedCharacterIds,
            restoredIds,
            missingIds,
            expectedCount,
            actualCount: refreshedRestoredCharacters.length,
          });
          // 恢复失败：显式清空模板表，避免残留旧数据
          setRuntimeOperatorTemplateMap({});
          console.log('[AppContext] 恢复失败，模板表已清空');
        }
        } else {
          // 无有效恢复条件（未选角色或无 timeline 数据）：清空残留模板表
          console.log('[AppContext] restore skipped', {
            reason: selectedCharacterIds.length === 0 ? 'selected-character-ids-empty' : 'timeline-data-missing',
            selectedCharacterIds,
            hasTimelineData,
          });
          setRuntimeOperatorTemplateMap({});
          console.log('[AppContext] 无有效恢复条件，模板表已清空');
        }
    } catch (error) {
      console.warn('Failed to load operators list:', error);
    } finally {
      selectedCharactersHydratedRef.current = true;
    }
  }, [buildRestorableCharacterMap, loadOfficialCharacters, rebuildSelectedRuntimeTemplateMap, refreshSelectedLocalCharacters]);

  const refreshSelectedCharacters = useCallback(async (): Promise<Character[]> => {
    const selectedIds = (
      state.selectedCharacters.length > 0
        ? state.selectedCharacters.map((character) => character.id)
        : getSelectedCharacterIds()
    ).filter((id) => id.trim().length > 0).slice(0, 4);

    if (selectedIds.length === 0) {
      setRuntimeOperatorTemplateMap({});
      return [];
    }

    const officialCharacters = await loadOfficialCharacters();
    const officialCharactersSignature = serializeCharactersForRefresh(officialCharacters);
    if (loadedCharactersSignatureRef.current !== officialCharactersSignature) {
      loadedCharactersSignatureRef.current = officialCharactersSignature;
      dispatch({ type: 'SET_LOADED_CHARACTERS', characters: officialCharacters });
    }
    const restorableCharacterMap = buildRestorableCharacterMap(officialCharacters);
    const refreshedCharacters = selectedIds
      .map((characterId) => restorableCharacterMap.get(characterId))
      .filter((character): character is Character => Boolean(character))
      .slice(0, 4);

    if (refreshedCharacters.length === 0) {
      console.warn('[AppContext] 静默刷新已选干员失败：未能解析当前已选 ID', selectedIds);
      return state.selectedCharacters;
    }

    setSelectedCharacterIds(refreshedCharacters.map((character) => character.id));
    rebuildSelectedRuntimeTemplateMap(refreshedCharacters);

    if (
      serializeCharactersForRefresh(refreshedCharacters) !==
      serializeCharactersForRefresh(state.selectedCharacters)
    ) {
      dispatch({ type: 'SET_SELECTED_CHARACTERS', characters: refreshedCharacters });
    }

    return refreshedCharacters;
  }, [buildRestorableCharacterMap, loadOfficialCharacters, rebuildSelectedRuntimeTemplateMap, state.selectedCharacters]);

  const processMainWorkbenchSelectionCommand = useCallback(async () => {
    if (isProcessingWorkbenchCommandRef.current) {
      return;
    }
    isProcessingWorkbenchCommandRef.current = true;
    try {
      await pullRemoteMainWorkbenchCommands();
      const commandEntry = getPendingMainWorkbenchCommands(['selectCharacters', 'openView', 'clearTimeline', 'openWorkbenchPage'])[0];
      if (!commandEntry) {
        return;
      }

      patchMainWorkbenchCommand(commandEntry.id, { status: 'running' });
      const command = commandEntry.command;
      try {
        if (command.op === 'openView') {
          dispatch({ type: 'SET_VIEW', view: command.view });
          const doneEntry = patchMainWorkbenchCommand(commandEntry.id, {
            status: 'done',
            result: { view: command.view },
          });
          if (doneEntry) void pushMainWorkbenchCommandResult(doneEntry);
          return;
        }

        if (command.op === 'clearTimeline') {
          removeTimelineData();
          setSkillButtonTable({});
          setAllBuffList([]);
          dispatch({ type: 'CLEAR_SKILL_BUTTONS' });
          const doneEntry = patchMainWorkbenchCommand(commandEntry.id, {
            status: 'done',
            result: { cleared: true },
          });
          if (doneEntry) void pushMainWorkbenchCommandResult(doneEntry);
          return;
        }

        if (command.op === 'openWorkbenchPage') {
          const pageRoutes: Record<typeof command.page, string | null> = {
            home: APP_ROUTE_PATHS.home,
            selection: null,
            canvas: null,
            operatorConfig: APP_ROUTE_PATHS.operatorConfig,
            weaponSheet: APP_ROUTE_PATHS.weaponSheet,
            equipmentSheet: APP_ROUTE_PATHS.equipmentSheet,
            damageSheet: APP_ROUTE_PATHS.damageSheet,
            damageReportPpt: APP_ROUTE_PATHS.damageReportPpt,
            aiCli: APP_ROUTE_PATHS.aiCli,
          };
          if (command.characterId || command.characterName) {
            const restorableCharacterMap = buildRestorableCharacterMap(state.loadedCharacters);
            const target = command.characterId
              ? restorableCharacterMap.get(command.characterId)
              : [...restorableCharacterMap.values()].find((character) => character.name === command.characterName);
            if (target) {
              safeSessionStorage.setItem(STORAGE_KEYS.OPERATOR_CONFIG_ACTIVE_CHARACTER, target.id);
            }
          }
          if (command.page === 'selection') {
            dispatch({ type: 'SET_VIEW', view: 'selection' });
          } else if (command.page === 'canvas') {
            dispatch({ type: 'SET_VIEW', view: 'canvas' });
          } else {
            const route = pageRoutes[command.page];
            if (route) navigateToAppPath(route);
          }
          const doneEntry = patchMainWorkbenchCommand(commandEntry.id, {
            status: 'done',
            result: { page: command.page },
          });
          if (doneEntry) void pushMainWorkbenchCommandResult(doneEntry);
          return;
        }

        if (command.op !== 'selectCharacters') {
          throw new Error(`Unsupported AppContext main workbench command: ${command.op}`);
        }

        const requestedIds = Array.isArray(command.characterIds) ? command.characterIds : [];
        const requestedNames = Array.isArray(command.characterNames) ? command.characterNames : [];
        const requestedKeys = [...requestedIds, ...requestedNames]
          .map((key) => String(key || '').trim())
          .filter(Boolean);

        if (requestedKeys.length === 0) {
          throw new Error('selectCharacters requires characterIds or characterNames');
        }

        const restorableCharacterMap = buildRestorableCharacterMap(state.loadedCharacters);
        const charactersByName = new Map<string, Character>();
        restorableCharacterMap.forEach((character) => {
          charactersByName.set(character.name, character);
        });

        const selected = requestedKeys
          .map((key) => restorableCharacterMap.get(key) ?? charactersByName.get(key))
          .filter((character): character is Character => Boolean(character))
          .filter((character, index, array) => array.findIndex((item) => item.id === character.id) === index)
          .slice(0, 4);

        if (selected.length === 0 || selected.length !== Math.min(requestedKeys.length, 4)) {
          const selectedKeys = new Set(selected.flatMap((character) => [character.id, character.name]));
          const missing = requestedKeys.filter((key) => !selectedKeys.has(key));
          throw new Error(`未找到干员: ${missing.join(', ') || requestedKeys.join(', ')}`);
        }

        if (command.resetTimeline) {
          removeTimelineData();
          setSkillButtonTable({});
          setAllBuffList([]);
        } else {
          reconcileSelectionChange(state.selectedCharacters, selected);
        }
        dispatch({ type: 'CLEAR_SKILL_BUTTONS' });
        dispatch({ type: 'SET_SELECTED_CHARACTERS', characters: selected });
        dispatch({ type: 'SET_VIEW', view: command.openCanvas === false ? 'selection' : 'canvas' });

        const doneEntry = patchMainWorkbenchCommand(commandEntry.id, {
          status: 'done',
          result: {
            selectedCharacters: selected.map((character) => ({ id: character.id, name: character.name })),
            currentView: command.openCanvas === false ? 'selection' : 'canvas',
          },
        });
        if (doneEntry) void pushMainWorkbenchCommandResult(doneEntry);
      } catch (error) {
        const errorEntry = patchMainWorkbenchCommand(commandEntry.id, {
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        });
        if (errorEntry) void pushMainWorkbenchCommandResult(errorEntry);
      }
    } finally {
      isProcessingWorkbenchCommandRef.current = false;
    }
  }, [buildRestorableCharacterMap, state.loadedCharacters, state.selectedCharacters]);

  // 组件首次挂载时自动加载干员数据
  useEffect(() => {
    cleanupStorage();
    loadCharacters();
    // web-cli proposal.save 后派发的同页事件：立即重读本地主库
    const handleLocalChanged = () => { void loadCharacters(); };
    window.addEventListener(LOCAL_LIBRARY_CHANGED_EVENT, handleLocalChanged);
    // 跨页签：其他标签页写 localStorage 时触发的原生 storage 事件
    const handleStorage = (event: StorageEvent) => {
      if (event.key && event.key.startsWith('def.')) {
        void loadCharacters();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(LOCAL_LIBRARY_CHANGED_EVENT, handleLocalChanged);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  useEffect(() => {
    if (!selectedCharactersHydratedRef.current) {
      return undefined;
    }
    void processMainWorkbenchSelectionCommand();
    const handleControlEvent = () => {
      void processMainWorkbenchSelectionCommand();
    };
    const timer = window.setInterval(() => {
      void processMainWorkbenchSelectionCommand();
    }, 1200);
    window.addEventListener('def-main-workbench-control', handleControlEvent);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('def-main-workbench-control', handleControlEvent);
    };
  }, [processMainWorkbenchSelectionCommand, state.loadedCharacters]);

  useEffect(() => {
    if (!selectedCharactersHydratedRef.current) {
      return;
    }
    // 同步选中角色 ID 到 sessionStorage
    setSelectedCharacterIds(state.selectedCharacters.map((character) => character.id));
    // 同步重建运行时模板表（职责收紧：只包含当前已选角色）
    rebuildSelectedRuntimeTemplateMap(state.selectedCharacters);
  }, [rebuildSelectedRuntimeTemplateMap, state.selectedCharacters]);

  useEffect(() => {
    if (!selectedCharactersHydratedRef.current || state.currentView !== 'canvas' || state.selectedCharacters.length === 0) {
      return;
    }

    const localDraftMap = loadLocalOperatorDraftMap();
    const signature = state.selectedCharacters
      .map((character) => {
        const draft = localDraftMap[character.id];
        return draft
          ? `${character.id}:${draft.name}:${draft.avatarUrl}:${JSON.stringify(Object.keys(draft.skills || {}))}:${JSON.stringify(Object.values(draft.skills || {}).map((skill) => [skill.displayName, skill.buttonType, skill.iconUrl, skill.hitCount]))}`
          : `${character.id}:official`;
      })
      .join('|');

    if (canvasLocalRefreshSignatureRef.current === signature) {
      return;
    }
    canvasLocalRefreshSignatureRef.current = signature;

    const refreshedCharacters = refreshSelectedLocalCharacters(state.selectedCharacters);
    if (refreshedCharacters !== state.selectedCharacters) {
      dispatch({ type: 'SET_SELECTED_CHARACTERS', characters: refreshedCharacters });
      return;
    }

    rebuildSelectedRuntimeTemplateMap(refreshedCharacters);
  }, [rebuildSelectedRuntimeTemplateMap, refreshSelectedLocalCharacters, state.currentView, state.selectedCharacters]);

  useEffect(() => {
    if (!selectedCharactersHydratedRef.current || state.currentView === 'canvas') {
      return;
    }
    const snapshot = buildSelectionWorkbenchSnapshot(state.selectedCharacters, state.currentView, state.skillButtons);
    writeMainWorkbenchSnapshot(snapshot);
    void pushMainWorkbenchSnapshot(snapshot);
  }, [state.currentView, state.selectedCharacters, state.skillButtons]);

  const contextValue = useMemo(() => ({
    state,
    dispatch,
    loadCharacters,
    refreshSelectedCharacters,
  }), [loadCharacters, refreshSelectedCharacters, state]);

  return (
    <AppContext.Provider value={contextValue}>
      {children}
    </AppContext.Provider>
  );
}

/**
 * 消费 Context 的 Hook
 * 在任意子组件中调用，获取全局 state 和 dispatch
 * @throws 若在 AppProvider 之外调用，抛出错误
 */
export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within AppProvider');
  }
  return context;
}
