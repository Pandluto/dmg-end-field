import { useCallback, useEffect, useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { SelectionPanel } from '../SelectionPanel';
import { CanvasBoard } from '../CanvasBoard';
import { setSelectedSkillButton } from '../../hooks/useSkillButtonBuffs';
import './WorkbenchFrame.css';

export type WorkbenchMode = 'selection' | 'timeline' | 'toolPanel';

export function WorkbenchFrame() {
  const { state, dispatch } = useAppContext();
  const { currentView, selectedCharacters } = state;
  const [isDrawerOpen, setIsDrawerOpen] = useState(true);
  const [workbenchMode, setWorkbenchMode] = useState<WorkbenchMode>('selection');
  const [operatorConfigVisible, setOperatorConfigVisible] = useState(false);
  const [operatorConfigCharacterId, setOperatorConfigCharacterId] = useState<string | null>(null);
  const [forceShowToolPanel, setForceShowToolPanel] = useState(false);

  const canAccessCanvas = selectedCharacters.length > 0;
  const isSelectionActive = currentView === 'selection';

  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false);
  }, []);

  const toggleDrawer = useCallback(() => {
    setIsDrawerOpen(prev => !prev);
  }, []);

  const handleModeClick = useCallback((mode: WorkbenchMode) => {
    if (mode !== 'selection' && selectedCharacters.length === 0) {
      return;
    }

    if (mode === 'selection') {
      dispatch({ type: 'SELECT_SKILL_BUTTON', buttonId: null });
      setSelectedSkillButton(null);
      dispatch({ type: 'SET_VIEW', view: 'selection' });
      setWorkbenchMode('selection');
      setOperatorConfigVisible(false);
      setForceShowToolPanel(false);
      closeDrawer();
      return;
    }

    dispatch({ type: 'SET_VIEW', view: 'canvas' });
    setWorkbenchMode(mode);
    setOperatorConfigVisible(false);
    setForceShowToolPanel(false);
  }, [dispatch, selectedCharacters.length]);

  const handleOperatorConfigClick = useCallback(() => {
    if (selectedCharacters.length === 0) return;
    // 如果在选人页，先切换到 canvas
    if (currentView === 'selection') {
      dispatch({ type: 'SET_VIEW', view: 'canvas' });
      setWorkbenchMode('timeline');
    }
    // toggle 配置面板
    setOperatorConfigVisible(prev => {
      const next = !prev;
      if (next && !operatorConfigCharacterId) {
        setOperatorConfigCharacterId(selectedCharacters[0]?.id ?? null);
      }
      return next;
    });
  }, [selectedCharacters, currentView, dispatch, operatorConfigCharacterId]);

  const handleSkillButtonModalOpen = useCallback(() => {
    setForceShowToolPanel(true);
    setOperatorConfigVisible(false);
  }, []);

  const handleSkillButtonModalClose = useCallback(() => {
    setForceShowToolPanel(false);
    setWorkbenchMode('timeline');
    setOperatorConfigVisible(false);
  }, []);

  const closeOperatorConfig = useCallback(() => {
    setOperatorConfigVisible(false);
    setOperatorConfigCharacterId(null);
    setForceShowToolPanel(false);
    setWorkbenchMode('timeline');
  }, []);

  const openOperatorConfig = useCallback((characterId: string) => {
    if (currentView === 'selection') {
      dispatch({ type: 'SET_VIEW', view: 'canvas' });
    }
    setOperatorConfigCharacterId(characterId);
    setOperatorConfigVisible(true);
    setForceShowToolPanel(false);
    setWorkbenchMode('timeline');
  }, [currentView, dispatch]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeDrawer();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeDrawer]);

  const shouldShowToolPanel = (
    workbenchMode === 'toolPanel' ||
    forceShowToolPanel
  );

  const getModeLabel = () => {
    switch (workbenchMode) {
      case 'selection':
        return '选人';
      case 'timeline':
        return '排轴';
      case 'toolPanel':
        return '侧边栏';
      default:
        return '选人';
    }
  };

  const workbenchControl = (
    <button className="workbench-top-trigger" type="button" onClick={toggleDrawer}>
      <span className="workbench-trigger-text">{getModeLabel()}</span>
      <span className="workbench-trigger-divider">|</span>
      <span className="workbench-trigger-status">已选 {selectedCharacters.length}/4</span>
    </button>
  );

  useEffect(() => {
    if (currentView === 'canvas' && workbenchMode === 'selection') {
      setWorkbenchMode('timeline');
    }
  }, [currentView, workbenchMode]);

  return (
    <div className={`workbench-frame ${isDrawerOpen ? 'has-top-zone' : ''}`}>
      <div className={`workbench-top-zone ${isDrawerOpen ? 'is-open' : ''}`}>
        <div className="workbench-drawer-tabs">
          <button
            className={`workbench-drawer-tab ${isSelectionActive ? 'is-active' : ''}`}
            type="button"
            onClick={() => handleModeClick('selection')}
            disabled
            title="选人入口暂时关闭"
          >
            选人
          </button>
          <button
            className={`workbench-drawer-tab ${workbenchMode === 'timeline' ? 'is-active' : ''}`}
            type="button"
            onClick={() => handleModeClick('timeline')}
            disabled={!canAccessCanvas}
            title={!canAccessCanvas ? '请先选择干员' : ''}
          >
            排轴
          </button>
          <button
            className={`workbench-drawer-tab ${workbenchMode === 'toolPanel' ? 'is-active' : ''}`}
            type="button"
            onClick={() => handleModeClick('toolPanel')}
            disabled={!canAccessCanvas}
            title={!canAccessCanvas ? '请先选择干员' : ''}
          >
            侧边栏
          </button>
          <button
            className={`workbench-drawer-tab ${operatorConfigVisible ? 'is-active' : ''}`}
            type="button"
            onClick={handleOperatorConfigClick}
            disabled={!canAccessCanvas}
            title={!canAccessCanvas ? '请先选择干员' : ''}
          >
            角色配置
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
            </div>
          </div>
        )}
        {(currentView === 'canvas' || operatorConfigVisible) && (
          <CanvasBoard
            workbenchMode={workbenchMode}
            isToolPanelVisible={shouldShowToolPanel}
            operatorConfigVisible={operatorConfigVisible}
            operatorConfigCharacterId={operatorConfigCharacterId}
            onSkillButtonModalOpen={handleSkillButtonModalOpen}
            onSkillButtonModalClose={handleSkillButtonModalClose}
            onCloseOperatorConfig={closeOperatorConfig}
            onOpenOperatorConfig={openOperatorConfig}
            workbenchControl={workbenchControl}
            isWorkbenchTopZoneOpen={isDrawerOpen}
          />
        )}
      </main>
    </div>
  );
}
