import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { safeSessionStorage } from '../../utils/storage';
import { STORAGE_KEYS } from '../../constants/storage-keys';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../../utils/appRoute';
import { setSelectedSkillButton } from '../../hooks/useSkillButtonBuffs';
import { SelectionPanel } from '../SelectionPanel';
import { CanvasBoard } from '../CanvasBoard';
import { BuffBatchEditWorkbench } from '../BuffBatchEditWorkbench';
import './WorkbenchFrame.css';

export type WorkbenchMode = 'selection' | 'timeline' | 'toolPanel' | 'buffBatchEdit';

interface WorkbenchFrameProps {
  activeSkillButtonId?: string | null;
}

export function WorkbenchFrame({ activeSkillButtonId = null }: WorkbenchFrameProps) {
  const { state, dispatch } = useAppContext();
  const { currentView, selectedCharacters } = state;
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [workbenchMode, setWorkbenchMode] = useState<WorkbenchMode>('selection');
  const [forceShowToolPanel, setForceShowToolPanel] = useState(false);
  const previousActiveSkillButtonIdRef = useRef<string | null>(activeSkillButtonId);

  const canAccessCanvas = selectedCharacters.length > 0;
  const isSelectionActive = currentView === 'selection';

  useEffect(() => {
    const previousActiveSkillButtonId = previousActiveSkillButtonIdRef.current;
    previousActiveSkillButtonIdRef.current = activeSkillButtonId;
    if (activeSkillButtonId) {
      dispatch({ type: 'SET_VIEW', view: 'canvas' });
      setWorkbenchMode('timeline');
      setForceShowToolPanel(true);
      return;
    }
    if (previousActiveSkillButtonId) {
      setForceShowToolPanel(false);
      setWorkbenchMode('timeline');
    }
  }, [activeSkillButtonId, dispatch]);

  useEffect(() => {
    if (currentView === 'canvas' && workbenchMode === 'selection') {
      setWorkbenchMode('timeline');
    }
  }, [currentView, workbenchMode]);

  const handleModeClick = useCallback((mode: WorkbenchMode) => {
    if (mode !== 'selection' && selectedCharacters.length === 0) return;
    if (mode === 'selection') {
      dispatch({ type: 'SELECT_SKILL_BUTTON', buttonId: null });
      setSelectedSkillButton(null);
      dispatch({ type: 'SET_VIEW', view: 'selection' });
      setWorkbenchMode('selection');
      setForceShowToolPanel(false);
      setIsDrawerOpen(false);
      return;
    }
    dispatch({ type: 'SET_VIEW', view: 'canvas' });
    setWorkbenchMode(mode);
    setForceShowToolPanel(false);
  }, [dispatch, selectedCharacters.length]);

  const openOperatorConfig = useCallback((characterId?: string) => {
    const targetId = characterId || selectedCharacters[0]?.id;
    if (targetId) {
      safeSessionStorage.setItem(STORAGE_KEYS.OPERATOR_CONFIG_ACTIVE_CHARACTER, targetId);
    }
    navigateToAppPath(APP_ROUTE_PATHS.operatorConfig);
  }, [selectedCharacters]);

  const handleSkillButtonModalOpen = useCallback(() => {
    setForceShowToolPanel(true);
  }, []);

  const handleSkillButtonModalClose = useCallback(() => {
    setForceShowToolPanel(false);
    setWorkbenchMode('timeline');
  }, []);

  const modeLabel = workbenchMode === 'buffBatchEdit'
    ? '批量 Buff'
    : workbenchMode === 'toolPanel'
      ? '侧边栏'
      : workbenchMode === 'timeline'
        ? '时间轴'
        : '选择队伍';

  const workbenchControl = (
    <button
      className="workbench-top-trigger"
      type="button"
      onClick={() => setIsDrawerOpen((open) => !open)}
    >
      <span className="workbench-trigger-text">{modeLabel}</span>
      <span className="workbench-trigger-divider">·</span>
      <span className="workbench-trigger-status">{selectedCharacters.length}/4</span>
    </button>
  );

  const workspaceActions = (
    <div className="workbench-bottom-actions">
      <button
        className={`workbench-top-trigger workbench-bottom-nav-button ${isSelectionActive ? 'is-active' : ''}`}
        type="button"
        onClick={() => handleModeClick('selection')}
      >
        <span className="workbench-trigger-text">队伍</span>
      </button>
      <button
        className={`workbench-top-trigger workbench-bottom-nav-button ${workbenchMode === 'timeline' && !isSelectionActive ? 'is-active' : ''}`}
        type="button"
        disabled={!canAccessCanvas}
        onClick={() => handleModeClick('timeline')}
      >
        <span className="workbench-trigger-text">排轴</span>
      </button>
      <button
        className={`workbench-top-trigger workbench-bottom-nav-button ${workbenchMode === 'buffBatchEdit' ? 'is-active' : ''}`}
        type="button"
        disabled={!canAccessCanvas}
        onClick={() => handleModeClick('buffBatchEdit')}
      >
        <span className="workbench-trigger-text">批量 Buff</span>
      </button>
      <button
        className="workbench-top-trigger workbench-bottom-nav-button"
        type="button"
        disabled={!canAccessCanvas}
        onClick={() => openOperatorConfig()}
      >
        <span className="workbench-trigger-text">干员配置</span>
      </button>
      <button
        className="workbench-top-trigger workbench-bottom-nav-button"
        type="button"
        disabled={!canAccessCanvas}
        onClick={() => navigateToAppPath(APP_ROUTE_PATHS.damageSheet)}
      >
        <span className="workbench-trigger-text">伤害表</span>
      </button>
    </div>
  );

  return (
    <div className={`workbench-frame ${isDrawerOpen ? 'has-top-zone' : ''}`}>
      <div className={`workbench-top-zone ${isDrawerOpen ? 'is-open' : ''}`}>
        <div className="workbench-drawer-tabs">
          <button
            className={`workbench-drawer-tab ${isSelectionActive ? 'is-active' : ''}`}
            type="button"
            onClick={() => handleModeClick('selection')}
          >
            选择队伍
          </button>
          <button
            className={`workbench-drawer-tab ${workbenchMode === 'timeline' && !isSelectionActive ? 'is-active' : ''}`}
            type="button"
            onClick={() => handleModeClick('timeline')}
            disabled={!canAccessCanvas}
          >
            时间轴
          </button>
          <button
            className={`workbench-drawer-tab ${workbenchMode === 'toolPanel' ? 'is-active' : ''}`}
            type="button"
            onClick={() => handleModeClick('toolPanel')}
            disabled={!canAccessCanvas}
          >
            计算侧栏
          </button>
          <button
            className={`workbench-drawer-tab ${workbenchMode === 'buffBatchEdit' ? 'is-active' : ''}`}
            type="button"
            onClick={() => handleModeClick('buffBatchEdit')}
            disabled={!canAccessCanvas}
          >
            批量 Buff
          </button>
          <button
            className="workbench-drawer-tab"
            type="button"
            onClick={() => openOperatorConfig()}
            disabled={!canAccessCanvas}
          >
            干员配置
          </button>
        </div>
      </div>

      <main className="workbench-content">
        {currentView === 'selection' && (
          <div className={`selection-workbench-layout ${isDrawerOpen ? 'has-top-zone' : ''}`}>
            <div className="selection-middle-zone">
              <SelectionPanel />
            </div>
            <div className="workbench-selection-bottom-bar">
              {workbenchControl}
              {workspaceActions}
            </div>
          </div>
        )}
        {currentView === 'canvas' && workbenchMode === 'buffBatchEdit' && (
          <BuffBatchEditWorkbench
            selectedCharacters={selectedCharacters}
            workbenchControl={workbenchControl}
            bottomRightControl={workspaceActions}
            isWorkbenchTopZoneOpen={isDrawerOpen}
          />
        )}
        {currentView === 'canvas' && workbenchMode !== 'buffBatchEdit' && (
          <CanvasBoard
            activeSkillButtonId={activeSkillButtonId}
            workbenchMode={workbenchMode}
            isToolPanelVisible={workbenchMode === 'toolPanel' || forceShowToolPanel}
            onSkillButtonModalOpen={handleSkillButtonModalOpen}
            onSkillButtonModalClose={handleSkillButtonModalClose}
            onOpenOperatorConfig={openOperatorConfig}
            workbenchControl={workbenchControl}
            bottomRightControl={workspaceActions}
            isWorkbenchTopZoneOpen={isDrawerOpen}
          />
        )}
      </main>
    </div>
  );
}
