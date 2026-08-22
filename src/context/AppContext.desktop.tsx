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
import { flushSync } from 'react-dom';
import { LOCAL_LIBRARY_CHANGED_EVENT } from '../constants/events';
import {
  AppState,
  Character,
  SkillButton,
  SkillType,
  ViewType,
  DEFAULT_CANVAS_CONFIG,
} from '../types';
import {
  cleanupStorage,
  getSelectedCharacterIds,
  getRuntimeOperatorTemplateById,
  safeSessionStorage,
  setSelectedCharacterIds,
} from '../utils/storage';
import { STORAGE_KEYS } from '../constants/storage-keys';
import { GRID_NODE_COUNT } from '../core/calculators/gridSnapLayout';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../utils/appRoute';
import {
  adaptRuntimeTemplateToLegacyCharacter,
  isLocalOperatorLibraryStorageKey,
  loadLocalOperatorCharacters,
  loadLocalOperatorDraftMap,
} from '../core/services/localOperatorAdapter';
import {
  abandonReviewedSelectionProposal,
  applyReviewedSelectionProposal,
  applySelectionWorkspaceTransition,
  assertSelectionWorkspaceCheckoutPublishable,
  ensureSelectionWorkspaceSourceCheckout,
  prepareReviewedSelectionProposal,
  type PersistedWorkspaceCheckout,
  type PreparedSelectionProjectionCallbacks,
  type PreparedSelectionProjectionTarget,
} from '../core/services/selectionWorkspaceTransition';
import { getTimelineSessionSnapshot } from '../agentKernel/timelineRepository/timelineSession';
import {
  buildSandboxSkillsFromRuntimeTemplate,
  buildRuntimeOperatorTemplateFromDraft,
} from '../core/services/operatorTemplateAdapter';
import { setRuntimeOperatorTemplateMap } from '../utils/storage';
import {
  getPendingMainWorkbenchCommands,
  executeAgentProductCatalogCommand,
  patchMainWorkbenchCommand,
  pullRemoteMainWorkbenchCommands,
  pushMainWorkbenchCommandResult,
  pushMainWorkbenchSnapshot,
  readMainWorkbenchSnapshot,
  projectMainWorkbenchButtonState,
  projectMainWorkbenchCandidateBuff,
  writeMainWorkbenchSnapshot,
  type MainWorkbenchSnapshot,
} from '../utils/mainWorkbenchControl';
import {
  removeTimelineData,
  getCandidateBuffList,
  setAllBuffList,
  setSkillButtonTable,
} from '../core/repositories';
import {
  buildAiTimelineNodeReviewProjection,
  emptyAiTimelineNodeReviewProjection,
} from '../agentKernel/timelineWorktree/nodeReview';
import { browserAgentRuntime } from '../platform/agent/browserAgentRuntime';
import { getCurrentTimelineSnapshotPayload } from '../utils/timelineSnapshotStorage';
import { calculateNodeNumber } from '../utils/nodeNumbering';

function exactCharacterRosterFromPayload(
  characterIds: readonly string[],
  availableCharacters: readonly Character[],
): Character[] {
  const byId = new Map<string, Character[]>();
  for (const character of availableCharacters) {
    byId.set(character.id, [...(byId.get(character.id) ?? []), character]);
  }
  const resolved = characterIds.map((characterId) => {
    const matches = byId.get(characterId) ?? [];
    if (matches.length !== 1) {
      throw new Error(matches.length === 0
        ? `selection checkout roster 缺少干员：${characterId}`
        : `selection checkout roster 干员 ID 不唯一：${characterId}`);
    }
    return matches[0]!;
  });
  if (new Set(resolved.map((character) => character.id)).size !== resolved.length) {
    throw new Error('selection checkout roster 含重复干员。');
  }
  return resolved;
}

function buildSelectionRuntimeButtons(
  payload: PersistedWorkspaceCheckout['payload'],
  selectedCharacters: readonly Character[],
): SkillButton[] {
  const selectedById = new Map(selectedCharacters.map((character, index) => [character.id, { character, index }]));
  return Object.values(payload.skillButtonTable)
    .sort((left, right) => (left.nodeIndex - right.nodeIndex) || left.id.localeCompare(right.id))
    .map((button) => {
      const resolved = selectedById.get(button.characterId || '')
        ?? [...selectedById.values()].find(({ character }) => character.name === button.characterName);
      if (!resolved
        || (button.characterId && button.characterId !== resolved.character.id)
        || button.characterName !== resolved.character.name) {
        throw new Error(`selection checkout button ${button.id} 无法精确绑定 roster。`);
      }
      const globalNodeIndex = Number.isSafeInteger(button.nodeIndex) && button.nodeIndex >= 0
        ? button.nodeIndex
        : 0;
      const localNodeIndex = globalNodeIndex % GRID_NODE_COUNT;
      return {
        id: button.id,
        characterId: resolved.character.id,
        characterName: resolved.character.name,
        skillType: button.skillType as SkillType,
        position: { ...button.position },
        staffIndex: Math.floor(globalNodeIndex / GRID_NODE_COUNT),
        lineIndex: resolved.index,
        nodeIndex: localNodeIndex,
        nodeNumber: calculateNodeNumber(localNodeIndex),
        isDragging: false,
        isSelected: false,
        isFromSandbox: true,
        runtimeSkillId: button.runtimeSkillId,
        skillDisplayName: button.skillDisplayName,
        skillIconUrl: button.skillIconUrl,
        customHits: button.customHits,
        element: resolved.character.element,
      };
    });
}

export function buildSelectionWorkbenchSnapshot(
  selectedCharacters: readonly Character[],
  currentView: ViewType,
  source: PersistedWorkspaceCheckout,
): MainWorkbenchSnapshot {
  const previousSnapshot = readMainWorkbenchSnapshot();
  const buffById = new Map(source.payload.allBuffList.map((buff) => [buff.id, buff]));
  const mirroredButtons: MainWorkbenchSnapshot['skillButtons'] = Object.values(source.payload.skillButtonTable)
    .sort((left, right) => (left.nodeIndex - right.nodeIndex) || left.id.localeCompare(right.id))
    .map((button) => {
      const lineIndex = selectedCharacters.findIndex((character) => (
        character.id === button.characterId || character.name === button.characterName
      ));
      if (lineIndex < 0) throw new Error(`selection snapshot button ${button.id} 不属于正式 roster。`);
      const localNodeIndex = button.nodeIndex % GRID_NODE_COUNT;
      return {
        id: button.id,
        characterId: button.characterId || selectedCharacters[lineIndex]!.id,
        characterName: button.characterName,
        skillType: button.skillType as SkillType,
        runtimeSkillId: button.runtimeSkillId,
        skillDisplayName: button.skillDisplayName,
        staffIndex: Math.floor(button.nodeIndex / GRID_NODE_COUNT),
        lineIndex,
        persistenceStaffIndex: lineIndex,
        persistenceNodeIndex: button.nodeIndex,
        nodeIndex: localNodeIndex,
        nodeNumber: calculateNodeNumber(localNodeIndex),
        ...projectMainWorkbenchButtonState({
          selectedBuffIds: button.selectedBuff,
          selectedBuffs: button.selectedBuff.map((buffId) => buffById.get(buffId)).filter(Boolean),
          buffStackCounts: button.buffStackCounts,
          panelConfig: button.panelConfig,
          targetResistance: button.resistanceConfig?.targetResistance,
        }),
      };
    });
  const skillCatalog: NonNullable<MainWorkbenchSnapshot['skillCatalog']> = selectedCharacters.flatMap((character) => {
    const template = getRuntimeOperatorTemplateById(character.id);
    const skills = template
      ? buildSandboxSkillsFromRuntimeTemplate(template)
      : character.sandboxSkills ?? [];
    return skills.map((skill) => ({
      characterId: character.id,
      characterName: character.name,
      skillId: skill.id,
      skillType: skill.buttonType,
      skillDisplayName: skill.displayName,
      source: skill.source,
    }));
  });
  const candidateBuffs = getCandidateBuffList().map((buff) => projectMainWorkbenchCandidateBuff(buff));
  const operatorConfigs: MainWorkbenchSnapshot['operatorConfigs'] = selectedCharacters.flatMap((character) => {
    const configSnapshot = source.payload.operatorConfigPageCache[character.id];
    if (!configSnapshot) return [];
    return [{
      characterId: character.id,
      characterName: character.name,
      weapon: {
        id: configSnapshot.weapon.id,
        name: configSnapshot.weapon.name,
        level: configSnapshot.weapon.config.level,
        potential: configSnapshot.weapon.config.potential,
        skillLevels: configSnapshot.weapon.config.skillLevels,
        attack: configSnapshot.weapon.attack,
      },
      equipment: configSnapshot.equipment.pieces.map((piece) => ({
        slotKey: piece.slotKey,
        equipmentId: piece.equipmentId,
        name: piece.name,
        part: piece.part,
        effects: piece.effects.map((effect) => ({
          effectId: effect.effectId,
          label: effect.label,
          typeKey: effect.typeKey,
          level: effect.level,
          value: effect.value,
        })),
      })),
      setBuffs: configSnapshot.equipment.setBuffs.map((buff) => ({
        gearSetId: buff.gearSetId,
        gearSetName: buff.gearSetName,
        effectId: buff.effectId,
        label: buff.label,
        typeKey: buff.typeKey,
        value: buff.value,
        category: buff.category,
        effectKind: buff.effectKind,
      })),
      operatorSkillLevels: configSnapshot.operator.skillConfig,
    }];
  });
  const previousDamageReport = previousSnapshot?.damageReport;
  const canReuseDamageReport = Boolean(
    previousDamageReport
    && typeof previousDamageReport.totalDamage === 'number'
    && Array.isArray(previousDamageReport.characters),
  ) &&
    previousSnapshot?.skillButtons?.length === mirroredButtons.length &&
    previousDamageReport?.buttonCount === mirroredButtons.length;

  return {
    schemaVersion: 1,
    updatedAt: Date.now(),
    source: 'app',
    timelineId: source.document.id,
    activeTimelineId: source.document.id,
    checkout: {
      targetType: source.checkoutRef.targetType,
      targetId: source.checkoutRef.targetId,
      contentRevision: source.contentRevision,
      updatedAt: source.checkoutRef.updatedAt,
    },
    currentView,
    selectedCharacters: selectedCharacters.map((character) => ({
      id: character.id,
      name: character.name,
      element: character.element,
      profession: character.profession,
      librarySource: character.librarySource,
    })),
    skillCatalog,
    candidateBuffs,
    skillButtons: mirroredButtons,
    damageReportStatus: 'placeholder',
    damageReport: canReuseDamageReport && previousDamageReport
      ? previousDamageReport
      : undefined,
    operatorConfigs,
    nodeReview: source.sourceNode
      ? buildAiTimelineNodeReviewProjection(source.sourceNode, source.checkoutRef)
      : emptyAiTimelineNodeReviewProjection(),
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
 * 初始化时从已经应用的本地干员库加载全部运行时角色
 */
export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const [agentRouteRevision, bumpAgentRouteRevision] = useReducer((revision: number) => revision + 1, 0);
  const selectedCharactersHydratedRef = useRef(false);
  const canvasLocalRefreshSignatureRef = useRef<string | null>(null);
  const loadedCharactersSignatureRef = useRef<string | null>(null);
  const isProcessingWorkbenchCommandRef = useRef(false);
  const retryAppWorkbenchCommandRef = useRef(false);
  const processMainWorkbenchSelectionCommandRef = useRef<(pullRemote?: boolean) => Promise<void>>(async () => undefined);
  const stateRef = useRef(state);
  stateRef.current = state;

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

  const buildRestorableCharacterMap = useCallback((characters?: Character[]) => {
    const localCharacters = characters ?? loadLocalOperatorCharacters();
    const restorableCharacterMap = new Map<string, Character>();
    localCharacters.forEach((char) => restorableCharacterMap.set(char.id, char));
    return restorableCharacterMap;
  }, []);

  const rebuildSelectedRuntimeTemplateMap = useCallback((selectedCharacters: Character[]) => {
    // 空选中态：清空模板表
    if (selectedCharacters.length === 0) {
      setRuntimeOperatorTemplateMap({});
      return;
    }

    // 加载本地 draft map 用于本地角色定向查找
    const localDraftMap = loadLocalOperatorDraftMap();

    // 为每个已选角色构建模板
    const nextMap: Record<string, ReturnType<typeof buildRuntimeOperatorTemplateFromDraft>> = {};

    selectedCharacters.forEach((character) => {
      const draft = localDraftMap[character.id];
      if (draft) {
        nextMap[character.id] = buildRuntimeOperatorTemplateFromDraft(draft);
      } else {
        console.warn(`[AppContext] 本地角色 ${character.id} 的 draft 不存在，跳过模板构建`);
      }
    });

    setRuntimeOperatorTemplateMap(nextMap);
  }, []);

  const loadCharacters = useCallback(async () => {
    try {
      const characters = loadLocalOperatorCharacters();
      loadedCharactersSignatureRef.current = serializeCharactersForRefresh(characters);
      dispatch({ type: 'SET_LOADED_CHARACTERS', characters });
      const restorableCharacterMap = buildRestorableCharacterMap(characters);

        const selectedCharacterIds = getSelectedCharacterIds();
        const hasTimelineData = Boolean(safeSessionStorage.getItem(STORAGE_KEYS.TIMELINE_DATA));

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
        }
        } else {
          // 无有效恢复条件（未选角色或无 timeline 数据）：清空残留模板表
          setRuntimeOperatorTemplateMap({});
        }
    } catch (error) {
      console.warn('Failed to load local operator library:', error);
    } finally {
      selectedCharactersHydratedRef.current = true;
    }
  }, [buildRestorableCharacterMap, rebuildSelectedRuntimeTemplateMap, refreshSelectedLocalCharacters]);

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

    const localCharacters = loadLocalOperatorCharacters();
    const localCharactersSignature = serializeCharactersForRefresh(localCharacters);
    if (loadedCharactersSignatureRef.current !== localCharactersSignature) {
      loadedCharactersSignatureRef.current = localCharactersSignature;
      dispatch({ type: 'SET_LOADED_CHARACTERS', characters: localCharacters });
    }
    const restorableCharacterMap = buildRestorableCharacterMap(localCharacters);
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
  }, [buildRestorableCharacterMap, rebuildSelectedRuntimeTemplateMap, state.selectedCharacters]);

  const buildPreparedSelectionProjection = useCallback((): PreparedSelectionProjectionCallbacks => {
    const commitProjection = (target: PreparedSelectionProjectionTarget) => {
      const buttons = buildSelectionRuntimeButtons(target.payload, target.characters);
      rebuildSelectedRuntimeTemplateMap([...target.characters]);
      flushSync(() => {
        dispatch({ type: 'SET_SELECTED_CHARACTERS', characters: [...target.characters] });
        dispatch({ type: 'SET_SKILL_BUTTONS', buttons });
        dispatch({ type: 'SET_VIEW', view: target.currentView });
      });
    };
    const verifyProjection = async (target: PreparedSelectionProjectionTarget) => {
      const current = stateRef.current;
      const expectedRoster = target.characters.map((character) => `${character.id}\u0000${character.name}`);
      const observedRoster = current.selectedCharacters.map((character) => `${character.id}\u0000${character.name}`);
      const expectedButtonIds = Object.keys(target.payload.skillButtonTable).sort();
      const observedStateButtonIds = current.skillButtons.map((button) => button.id).sort();
      const visibleButtonIds = [...document.querySelectorAll<HTMLElement>('[data-skill-button-id]')]
        .map((element) => element.dataset.skillButtonId || '')
        .filter(Boolean)
        .sort();
      const rosterPass = JSON.stringify(observedRoster) === JSON.stringify(expectedRoster);
      const stateButtonsPass = JSON.stringify(observedStateButtonIds) === JSON.stringify(expectedButtonIds);
      const viewPass = current.currentView === target.currentView;
      const visibleViewPass = target.currentView === 'canvas'
        ? Boolean(document.querySelector('.canvas-board'))
          && JSON.stringify(visibleButtonIds) === JSON.stringify(expectedButtonIds)
        : Boolean(document.querySelector('.selection-workbench-layout'));
      const pass = rosterPass && stateButtonsPass && viewPass && visibleViewPass;
      return {
        pass,
        ...(pass ? {} : { reason: 'selection React roster/button/view 或可见页面后置条件不精确。' }),
        observed: {
          roster: current.selectedCharacters.map((character) => ({ id: character.id, name: character.name })),
          stateButtonIds: observedStateButtonIds,
          visibleButtonIds,
          currentView: current.currentView,
          expectedView: target.currentView,
        },
      };
    };
    return {
      apply: commitProjection,
      verify: verifyProjection,
      restore: commitProjection,
    };
  }, [rebuildSelectedRuntimeTemplateMap]);

  const processMainWorkbenchSelectionCommand = useCallback(async (pullRemote = false) => {
    if (!selectedCharactersHydratedRef.current) return;
    if (isProcessingWorkbenchCommandRef.current) {
      retryAppWorkbenchCommandRef.current = true;
      return;
    }
    isProcessingWorkbenchCommandRef.current = true;
    try {
      if (pullRemote) await pullRemoteMainWorkbenchCommands();
      const commandEntry = getPendingMainWorkbenchCommands([
        'queryAgentProductCatalog',
        'selectCharacters',
        'openView',
        'clearTimeline',
        'openWorkbenchPage',
        'prepareReviewedWorkNodeProposal',
        'applyReviewedWorkNodeProposal',
        'abandonPreparedWorkNodeProposal',
      ]).find((entry) => {
        if (entry.command.op === 'prepareReviewedWorkNodeProposal') {
          return entry.command.intent === 'selection';
        }
        if (entry.command.op === 'applyReviewedWorkNodeProposal'
          || entry.command.op === 'abandonPreparedWorkNodeProposal') {
          return entry.command.candidate.intent === 'selection';
        }
        return true;
      });
      if (!commandEntry) {
        return;
      }

      patchMainWorkbenchCommand(commandEntry.id, { status: 'running' });
      const command = commandEntry.command;
      const settleCommand = (patch: Parameters<typeof patchMainWorkbenchCommand>[1]) => {
        const settledEntry = patchMainWorkbenchCommand(commandEntry.id, patch);
        if (settledEntry) void pushMainWorkbenchCommandResult(settledEntry);
      };
      try {
        if (command.op === 'queryAgentProductCatalog') {
          settleCommand({ status: 'done', result: executeAgentProductCatalogCommand(command) });
          return;
        }

        if (command.op === 'prepareReviewedWorkNodeProposal') {
          if (command.intent !== 'selection') {
            throw new Error('AppContext 只消费 selection prepared proposal。');
          }
          const result = await prepareReviewedSelectionProposal({
            operation: command.operation,
            scope: command.scope,
            sourceBinding: command.sourceBinding,
            currentBinding: browserAgentRuntime.getBinding(),
            roster: command.roster,
            availableCharacters: stateRef.current.loadedCharacters,
          });
          settleCommand({
            status: result.ok ? 'done' : 'error',
            result,
            ...(result.ok ? {} : { error: result.message }),
          });
          return;
        }

        if (command.op === 'applyReviewedWorkNodeProposal') {
          const result = await applyReviewedSelectionProposal({
            operation: command.operation,
            candidate: command.candidate,
            currentBinding: browserAgentRuntime.getBinding(),
            availableCharacters: stateRef.current.loadedCharacters,
            previousView: stateRef.current.currentView,
            projection: buildPreparedSelectionProjection(),
          });
          if (result.ok) bumpAgentRouteRevision();
          settleCommand({
            status: result.ok ? 'done' : 'error',
            result,
            ...(result.ok ? {} : { error: result.message }),
          });
          return;
        }

        if (command.op === 'abandonPreparedWorkNodeProposal') {
          const result = await abandonReviewedSelectionProposal({
            candidate: command.candidate,
            currentBinding: browserAgentRuntime.getBinding(),
            reason: command.reason,
          });
          const deleted = result.ok && result.cleanup.status === 'deleted';
          settleCommand({
            status: deleted ? 'done' : 'error',
            result,
            ...(deleted ? {} : { error: result.cleanup.reason || 'selection candidate 未删除。' }),
          });
          return;
        }

        if (command.op === 'openView') {
          dispatch({ type: 'SET_VIEW', view: command.view });
          settleCommand({
            status: 'done',
            result: { view: command.view },
          });
          return;
        }

        if (command.op === 'clearTimeline') {
          removeTimelineData();
          setSkillButtonTable({});
          setAllBuffList([]);
          dispatch({ type: 'CLEAR_SKILL_BUTTONS' });
          settleCommand({
            status: 'done',
            result: { cleared: true },
          });
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
            damageReportPpt: APP_ROUTE_PATHS.damageReportPpt,
          };
          if (command.characterId || command.characterName) {
            const restorableCharacterMap = buildRestorableCharacterMap(stateRef.current.loadedCharacters);
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
          settleCommand({
            status: 'done',
            result: { page: command.page },
          });
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

        const currentState = stateRef.current;
        const restorableCharacterMap = buildRestorableCharacterMap(currentState.loadedCharacters);
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

        const timelineSession = getTimelineSessionSnapshot();
        const transitionResult = await applySelectionWorkspaceTransition({
          activeTimelineId: timelineSession.activeTimelineId,
          activeTimelineIsTemporary: timelineSession.activeTimelineIsTemporary,
          previousCharacters: currentState.selectedCharacters,
          nextCharacters: selected,
          actor: 'ai',
          nodeTitle: command.nodeTitle,
          nodeDescription: command.nodeDescription,
          approval: command.approval,
        });
        dispatch({ type: 'SET_SELECTED_CHARACTERS', characters: selected });
        dispatch({ type: 'SET_VIEW', view: command.openCanvas === false ? 'selection' : 'canvas' });

        settleCommand({
          status: 'done',
          result: {
            selectedCharacters: selected.map((character) => ({ id: character.id, name: character.name })),
            currentView: command.openCanvas === false ? 'selection' : 'canvas',
            transition: transitionResult.transition,
            timelineId: transitionResult.timelineId,
            nodeId: transitionResult.nodeId,
          },
        });
      } catch (error) {
        settleCommand({
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      isProcessingWorkbenchCommandRef.current = false;
      if (retryAppWorkbenchCommandRef.current) {
        retryAppWorkbenchCommandRef.current = false;
        window.setTimeout(() => {
          void processMainWorkbenchSelectionCommandRef.current(false);
        }, 50);
      }
    }
  }, [buildPreparedSelectionProjection, buildRestorableCharacterMap]);
  processMainWorkbenchSelectionCommandRef.current = processMainWorkbenchSelectionCommand;

  // 组件首次挂载时自动加载干员数据
  useEffect(() => {
    cleanupStorage();
    loadCharacters();
    // web-cli proposal.save 后派发的同页事件：立即重读本地主库
    const handleLocalChanged = () => { void loadCharacters(); };
    window.addEventListener(LOCAL_LIBRARY_CHANGED_EVENT, handleLocalChanged);
    // 跨页签：其他标签页写 localStorage 时触发的原生 storage 事件
    const handleStorage = (event: StorageEvent) => {
      if (isLocalOperatorLibraryStorageKey(event.key)) {
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
    const handleControlEvent = () => {
      void processMainWorkbenchSelectionCommandRef.current(false);
    };
    const timer = window.setInterval(() => {
      void processMainWorkbenchSelectionCommandRef.current(false);
    }, 1200);
    window.addEventListener('def-main-workbench-control', handleControlEvent);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('def-main-workbench-control', handleControlEvent);
    };
  }, []);

  useEffect(() => {
    void processMainWorkbenchSelectionCommandRef.current(false);
  }, [state.loadedCharacters]);

  useEffect(() => {
    const handleHashChange = () => bumpAgentRouteRevision();
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    if (state.currentView === 'canvas') return undefined;
    if (!browserAgentRuntime.isActive()) {
      browserAgentRuntime.cancelCommandPull();
      return undefined;
    }
    let stopped = false;
    let running = false;
    let retryDelay = 100;
    let timer: number | null = null;
    const schedule = (delay: number) => {
      if (stopped || timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        void runOnce();
      }, Math.max(25, Math.min(delay, 1000)));
    };
    const runOnce = async () => {
      if (stopped || running || document.visibilityState !== 'visible') {
        if (!stopped && document.visibilityState !== 'visible') schedule(250);
        return;
      }
      running = true;
      try {
        await processMainWorkbenchSelectionCommandRef.current(true);
        retryDelay = 100;
        schedule(25);
      } catch (error) {
        if (!stopped) {
          console.warn('[AppContext] selection Agent command pull failed; bounded retry scheduled.', error);
          schedule(retryDelay);
          retryDelay = Math.min(retryDelay * 2, 1000);
        }
      } finally {
        running = false;
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void runOnce();
    };
    void runOnce();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
      browserAgentRuntime.cancelCommandPull();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [agentRouteRevision, state.currentView]);

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
          : `${character.id}:missing-local-draft`;
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
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      try {
        const source = await ensureSelectionWorkspaceSourceCheckout(stateRef.current.selectedCharacters);
        const runtimePayload = getCurrentTimelineSnapshotPayload();
        const sourceIds = source.payload.selectedCharacters;
        const storedIds = getSelectedCharacterIds();
        const currentIds = stateRef.current.selectedCharacters.map((character) => character.id);
        assertSelectionWorkspaceCheckoutPublishable({
          sourcePayload: source.payload,
          runtimePayload,
          storedCharacterIds: storedIds,
          currentCharacterIds: currentIds,
        });
        const resolvedCharacters = exactCharacterRosterFromPayload(
          sourceIds,
          stateRef.current.loadedCharacters,
        );
        if (cancelled || stateRef.current.currentView === 'canvas') return;
        rebuildSelectedRuntimeTemplateMap(resolvedCharacters);
        const snapshot = buildSelectionWorkbenchSnapshot(resolvedCharacters, stateRef.current.currentView, source);
        writeMainWorkbenchSnapshot(snapshot);
        await pushMainWorkbenchSnapshot(snapshot);
      } catch (error) {
        // Fail closed: without a persisted checkout payload and its target CAS
        // revision the selection page must not publish a writable binding.
        await browserAgentRuntime.suspendWritableBinding().catch(() => undefined);
        console.warn('[AppContext] selection source checkout is not publishable.', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentRouteRevision, rebuildSelectedRuntimeTemplateMap, state.currentView, state.loadedCharacters, state.selectedCharacters]);

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
