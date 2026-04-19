import { useCallback, useEffect, useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { SelectionPanel } from '../SelectionPanel';
import { CanvasBoard } from '../CanvasBoard';
import { setSelectedSkillButton } from '../../hooks/useSkillButtonBuffs';
import './WorkbenchFrame.css';

export type WorkbenchMode =
  | 'selection'
  | 'timeline'
  | 'toolPanel'
  | 'operatorConfig';

export function WorkbenchFrame() {
  const { state, dispatch } = useAppContext();
  const { currentView, selectedCharacters } = state;
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [workbenchMode, setWorkbenchMode] = useState<WorkbenchMode>('selection');
  const [forceOpenOperatorConfig, setForceOpenOperatorConfig] = useState(false);
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
      setForceOpenOperatorConfig(false);
      setForceShowToolPanel(false);
      closeDrawer();
      return;
    }

    dispatch({ type: 'SET_VIEW', view: 'canvas' });
    setWorkbenchMode(mode);
    setForceOpenOperatorConfig(mode === 'operatorConfig');
    setForceShowToolPanel(false);
  }, [dispatch, selectedCharacters.length]);

  const handleSkillButtonModalOpen = useCallback(() => {
    setForceShowToolPanel(true);
  }, []);

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
    workbenchMode === 'operatorConfig' ||
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
      case 'operatorConfig':
        return '角色配置';
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
            className={`workbench-drawer-tab ${workbenchMode === 'operatorConfig' ? 'is-active' : ''}`}
            type="button"
            onClick={() => handleModeClick('operatorConfig')}
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
        {currentView === 'canvas' && (
          <CanvasBoard
            workbenchMode={workbenchMode}
            isToolPanelVisible={shouldShowToolPanel}
            forceOpenOperatorConfig={forceOpenOperatorConfig}
            onSkillButtonModalOpen={handleSkillButtonModalOpen}
            onForceOpenOperatorConfigHandled={() => setForceOpenOperatorConfig(false)}
            workbenchControl={workbenchControl}
            isWorkbenchTopZoneOpen={isDrawerOpen}
          />
        )}
      </main>
    </div>
  );
}
