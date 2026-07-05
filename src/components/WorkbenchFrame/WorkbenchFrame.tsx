import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { SelectionPanel } from '../SelectionPanel';
import { CanvasBoard } from '../CanvasBoard';
import { BuffBatchEditWorkbench } from '../BuffBatchEditWorkbench';
import { setSelectedSkillButton } from '../../hooks/useSkillButtonBuffs';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../../utils/appRoute';
import { STORAGE_KEYS } from '../../constants/storage-keys';
import { safeSessionStorage } from '../../utils/storage';
import {
  getLocalAgentHealth,
  requestCloseShell,
  requestOpenShell,
} from '../../utils/localAgent';
import './WorkbenchFrame.css';

export type WorkbenchMode = 'selection' | 'timeline' | 'toolPanel' | 'buffBatchEdit';

interface WorkbenchFrameProps {
  activeSkillButtonId?: string | null;
}

export function WorkbenchFrame({ activeSkillButtonId = null }: WorkbenchFrameProps) {
  const { state, dispatch } = useAppContext();
  const { currentView, selectedCharacters } = state;
  const [isDrawerOpen, setIsDrawerOpen] = useState(true);
  const [workbenchMode, setWorkbenchMode] = useState<WorkbenchMode>('selection');
  const [forceShowToolPanel, setForceShowToolPanel] = useState(false);
  const [shellStatus, setShellStatus] = useState<'checking' | 'offline' | 'hidden' | 'visible' | 'opening' | 'closing'>('checking');
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

  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false);
  }, []);

  const toggleDrawer = useCallback(() => {
    setIsDrawerOpen(prev => !prev);
  }, []);

  const setWorkbenchTopZoneOpen = useCallback((open: boolean) => {
    setIsDrawerOpen(open);
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
      setForceShowToolPanel(false);
      closeDrawer();
      return;
    }

    dispatch({ type: 'SET_VIEW', view: 'canvas' });
    setWorkbenchMode(mode);
    setForceShowToolPanel(false);
  }, [dispatch, selectedCharacters.length]);

  const handleOperatorConfigClick = useCallback(() => {
    if (selectedCharacters.length === 0) return;
    const characterId = selectedCharacters[0]?.id;
    if (characterId) {
      safeSessionStorage.setItem(STORAGE_KEYS.OPERATOR_CONFIG_ACTIVE_CHARACTER, characterId);
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

  const openOperatorConfig = useCallback((characterId: string) => {
    safeSessionStorage.setItem(STORAGE_KEYS.OPERATOR_CONFIG_ACTIVE_CHARACTER, characterId);
    setForceShowToolPanel(false);
    setWorkbenchMode('timeline');
    navigateToAppPath(APP_ROUTE_PATHS.operatorConfig);
  }, []);

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
      case 'buffBatchEdit':
        return '批量Buff';
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
  const handleOpenOperatorDraft = useCallback(() => {
    navigateToAppPath(APP_ROUTE_PATHS.draft);
  }, []);

  const handleOpenBuffSheet = useCallback(() => {
    navigateToAppPath(APP_ROUTE_PATHS.buffSheet);
  }, []);

  const handleOpenWeaponSheet = useCallback(() => {
    navigateToAppPath(APP_ROUTE_PATHS.weaponSheet);
  }, []);

  const handleOpenEquipmentSheet = useCallback(() => {
    navigateToAppPath(APP_ROUTE_PATHS.equipmentSheet);
  }, []);

  const handleOpenOperatorConfig = useCallback(() => {
    const characterId = selectedCharacters[0]?.id;
    if (characterId) {
      safeSessionStorage.setItem(STORAGE_KEYS.OPERATOR_CONFIG_ACTIVE_CHARACTER, characterId);
    }
    navigateToAppPath(APP_ROUTE_PATHS.operatorConfig);
  }, [selectedCharacters]);

  const handleOpenImageManager = useCallback(() => {
    navigateToAppPath(APP_ROUTE_PATHS.imageManager);
  }, []);

  const handleOpenAiCli = useCallback(() => {
    if (window.desktopRuntime) {
      return;
    }
    navigateToAppPath(APP_ROUTE_PATHS.aiCli);
  }, []);

  const syncLocalAgentStatus = useCallback(async () => {
    try {
      const health = await getLocalAgentHealth();
      if (!health.shell.running || health.shell.state === 'missing') {
        setShellStatus('hidden');
      } else {
        setShellStatus(health.shell.state === 'visible' ? 'visible' : 'hidden');
      }
    } catch {
      setShellStatus('offline');
    }
  }, []);

  const handleToggleShell = useCallback(async () => {
    if (shellStatus === 'visible') {
      setShellStatus('closing');
      try {
        await requestCloseShell();
        setShellStatus('hidden');
      } catch {
        setShellStatus('offline');
      }
      return;
    }

    setShellStatus('opening');
    try {
      const shell = await requestOpenShell();
      setShellStatus(shell.state === 'visible' ? 'visible' : 'hidden');
    } catch {
      setShellStatus('offline');
    }
  }, [shellStatus]);

  const bottomNavControls = (
    <div className="workbench-bottom-actions">
      <button className="workbench-top-trigger workbench-bottom-nav-button is-active" type="button">
        <span className="workbench-trigger-text">主界面</span>
      </button>
      <button className="workbench-top-trigger workbench-bottom-nav-button" type="button" onClick={handleOpenOperatorDraft}>
        <span className="workbench-trigger-text">编辑干员</span>
      </button>
      <button className="workbench-top-trigger workbench-bottom-nav-button" type="button" onClick={handleOpenBuffSheet}>
        <span className="workbench-trigger-text">编辑BUFF</span>
      </button>
      <button className="workbench-top-trigger workbench-bottom-nav-button" type="button" onClick={handleOpenWeaponSheet}>
        <span className="workbench-trigger-text">编辑武器</span>
      </button>
      <button
        className="workbench-top-trigger workbench-bottom-nav-button"
        type="button"
        onClick={handleOpenEquipmentSheet}
        disabled
        title="编辑装备暂未开放"
      >
        <span className="workbench-trigger-text">编辑装备</span>
      </button>
      <button className="workbench-top-trigger workbench-bottom-nav-button" type="button" onClick={handleOpenOperatorConfig}>
        <span className="workbench-trigger-text">角色配置</span>
      </button>
      <button className="workbench-top-trigger workbench-bottom-nav-button" type="button" onClick={handleOpenImageManager}>
        <span className="workbench-trigger-text">图片管理</span>
      </button>
      <button
        className="workbench-top-trigger workbench-bottom-nav-button"
        type="button"
        onClick={handleOpenAiCli}
        disabled={Boolean(window.desktopRuntime)}
        title={window.desktopRuntime ? 'AI CLI 请在 Web 主界面中打开' : ''}
      >
        <span className="workbench-trigger-text">AI CLI</span>
      </button>
      <button className="workbench-top-trigger workbench-bottom-nav-button workbench-shell-button" type="button" onClick={handleToggleShell}>
        <span className="workbench-trigger-text">{shellStatus === 'visible' ? '收起Shell' : '打开Shell'}</span>
        <span className="workbench-trigger-divider">|</span>
        <span className="workbench-trigger-status">
          {shellStatus === 'checking' && '检测中'}
          {shellStatus === 'offline' && 'Shell 未启动'}
          {shellStatus === 'hidden' && '后台待命'}
          {shellStatus === 'visible' && '已打开'}
          {shellStatus === 'opening' && '打开中'}
          {shellStatus === 'closing' && '收起中'}
        </span>
      </button>
    </div>
  );

  useEffect(() => {
    if (currentView === 'canvas' && workbenchMode === 'selection') {
      setWorkbenchMode('timeline');
    }
  }, [currentView, workbenchMode]);

  useEffect(() => {
    syncLocalAgentStatus();
    const timer = window.setInterval(syncLocalAgentStatus, 5000);
    return () => {
      window.clearInterval(timer);
    };
  }, [syncLocalAgentStatus]);

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
            className={`workbench-drawer-tab ${workbenchMode === 'buffBatchEdit' ? 'is-active' : ''}`}
            type="button"
            onClick={() => handleModeClick('buffBatchEdit')}
            disabled={!canAccessCanvas}
            title={!canAccessCanvas ? '请先选择干员' : ''}
          >
            BUFF批量操作
          </button>
          <button
            className="workbench-drawer-tab"
            type="button"
            onClick={handleOperatorConfigClick}
            disabled={!canAccessCanvas}
            title={!canAccessCanvas ? '请先选择干员' : ''}
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
              {bottomNavControls}
            </div>
          </div>
        )}
        {currentView === 'canvas' && workbenchMode === 'buffBatchEdit' && (
          <BuffBatchEditWorkbench
            selectedCharacters={selectedCharacters}
            workbenchControl={workbenchControl}
            bottomRightControl={bottomNavControls}
            isWorkbenchTopZoneOpen={isDrawerOpen}
          />
        )}
        {currentView === 'canvas' && workbenchMode !== 'buffBatchEdit' && (
          <CanvasBoard
            activeSkillButtonId={activeSkillButtonId}
            workbenchMode={workbenchMode}
            isToolPanelVisible={shouldShowToolPanel}
            onSkillButtonModalOpen={handleSkillButtonModalOpen}
            onSkillButtonModalClose={handleSkillButtonModalClose}
            onOpenOperatorConfig={openOperatorConfig}
            workbenchControl={workbenchControl}
            bottomRightControl={bottomNavControls}
            isWorkbenchTopZoneOpen={isDrawerOpen}
            onWorkbenchTopZoneOpenChange={setWorkbenchTopZoneOpen}
          />
        )}
      </main>
    </div>
  );
}
