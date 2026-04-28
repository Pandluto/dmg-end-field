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
 * - ADD_SKILL_BUTTON / REMOVE_SKILL_BUTTON：画布上技能按钮的增删
 * - SET_SKILL_BUTTON_POSITION：移动画布上已有按钮
 * - SELECT_SKILL_BUTTON：选中画布上的技能按钮
 * - SET_DRAGGING：标记按钮是否正在被拖拽（影响拖拽跟随）
 * - CLEAR_SKILL_BUTTONS：清空画布
 */

import React, { createContext, useContext, useReducer, ReactNode, useEffect, useRef } from 'react';
import {
  AppState,
  Character,
  SkillButton,
  ViewType,
  DEFAULT_CANVAS_CONFIG,
} from '../types';
import { resolveAvatarUrl, resolveSkillIconUrl } from '../utils/assetResolver';
import {
  cleanupStorage,
  getSelectedCharacterIds,
  safeSessionStorage,
  setSelectedCharacterIds,
} from '../utils/storage';
import { STORAGE_KEYS } from '../constants/storage-keys';

/** 所有支持的 Action 类型（Tagged Union）*/
type AppAction =
  | { type: 'SET_LOADED_CHARACTERS'; characters: Character[] }
  | { type: 'SET_SELECTED_CHARACTERS'; characters: Character[] }
  | { type: 'SELECT_CHARACTER'; character: Character }
  | { type: 'DESELECT_CHARACTER'; characterId: string }
  | { type: 'SET_VIEW'; view: ViewType }
  | { type: 'ADD_SKILL_BUTTON'; button: SkillButton }
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
  | { type: 'UPDATE_SKILL_BUTTON_TYPE'; buttonId: string; skillType: 'A' | 'B' | 'E' | 'Q'; skillIconUrl: string }
  | { type: 'CLEAR_SKILL_BUTTONS' };

/** 初始状态：默认显示干员选择界面，无已选干员，无技能按钮 */
const initialState: AppState = {
  currentView: 'selection',
  selectedCharacters: [],
  canvasConfig: DEFAULT_CANVAS_CONFIG,
  skillButtons: [],
  loadedCharacters: [],
};

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
}

const AppContext = createContext<AppContextType | null>(null);

/**
 * 根 Provider 组件
 * 初始化时加载所有干员 JSON 数据，并注入 avatarUrl / skillIconMap 派生字段
 */
export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const selectedCharactersHydratedRef = useRef(false);

  /**
   * 从 public/data/characters/operators-list.json 动态加载所有干员名称列表，
   * 再根据名称加载对应角色的 JSON 数据。
   * 加载完成后为每个干员注入派生字段：
   * - avatarUrl：头像图片路径
   * - skillIconMap：四个技能的图标路径映射
   */
  const loadCharacters = async () => {
    try {
      const listResponse = await fetch('/data/characters/operators-list.json');
      if (!listResponse.ok) {
        console.warn('Failed to load operators-list.json');
        return;
      }
      const operatorList: { name: string }[] = await listResponse.json();

      const characters: Character[] = [];

      for (const operator of operatorList) {
        const fileName = `${operator.name}/${operator.name}.json`;
        try {
          const response = await fetch(`/data/characters/${fileName}`);
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
            characters.push(character);
          }
        } catch (error) {
          console.warn(`Failed to load ${fileName}:`, error);
        }
      }

      dispatch({ type: 'SET_LOADED_CHARACTERS', characters });

      const selectedCharacterIds = getSelectedCharacterIds();
      const hasTimelineData = Boolean(safeSessionStorage.getItem(STORAGE_KEYS.TIMELINE_DATA));

      if (selectedCharacterIds.length > 0 && hasTimelineData) {
        const restoredCharacters = selectedCharacterIds
          .map((characterId) => characters.find((character) => character.id === characterId))
          .filter((character): character is Character => Boolean(character))
          .slice(0, 4);

        if (
          restoredCharacters.length > 0 &&
          restoredCharacters.length === Math.min(selectedCharacterIds.length, 4)
        ) {
          dispatch({ type: 'SET_SELECTED_CHARACTERS', characters: restoredCharacters });
          dispatch({ type: 'SET_VIEW', view: 'canvas' });
        }
      }
    } catch (error) {
      console.warn('Failed to load operators list:', error);
    } finally {
      selectedCharactersHydratedRef.current = true;
    }
  };

  // 组件首次挂载时自动加载干员数据
  useEffect(() => {
    cleanupStorage();
    loadCharacters();
  }, []);

  useEffect(() => {
    if (!selectedCharactersHydratedRef.current) {
      return;
    }
    setSelectedCharacterIds(state.selectedCharacters.map((character) => character.id));
  }, [state.selectedCharacters]);

  return (
    <AppContext.Provider value={{ state, dispatch, loadCharacters }}>
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
