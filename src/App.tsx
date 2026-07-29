/**
 * App 根组件
 * 只负责渲染工作台框架，业务页面由 WorkbenchFrame 承载
 */

import { useEffect, useState } from 'react';
import { DamageSheetPage, isDamageSheetPath } from './components/DamageSheetPage';
import { DamageReportPptPage, isDamageReportPptPath } from './components/DamageReportPptPage';
import { WorkbenchFrame } from './components/WorkbenchFrame';
import { OperatorDraftPage, isDraftPath } from './components/OperatorDraftPage';
import { BuffDraftSheetPage, isBuffSheetPath } from './components/BuffDraftPage';
import { WeaponDraftSheetPage, isWeaponSheetPath } from './components/WeaponDraftPage';
import { EquipmentSheetPage, isEquipmentSheetPath } from './components/EquipmentSheetPage';
import { ImageManagerPage, isImageManagerPath } from './components/ImageManagerPage';
import { OperatorConfigPage } from './components/OperatorConfigPage';
import { AppShell } from './components/WebApp/AppShell';
import { DataWorkspacePage } from './components/WebApp/DataWorkspacePage';
import { SettingsPage } from './components/WebApp/SettingsPage';
import { StartPage } from './components/WebApp/StartPage';
import {
  APP_ROUTE_PATHS,
  getCurrentAppPath,
  getTimelineSkillDetailButtonId,
} from './utils/appRoute';
import './styles/global.css';

function App() {
  const [currentPath, setCurrentPath] = useState(() => {
    if (typeof window === 'undefined') {
      return '/';
    }
    return getCurrentAppPath(window.location);
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    const syncCurrentPath = () => {
      setCurrentPath(getCurrentAppPath(window.location));
    };

    window.addEventListener('hashchange', syncCurrentPath);
    window.addEventListener('popstate', syncCurrentPath);
    syncCurrentPath();

    return () => {
      window.removeEventListener('hashchange', syncCurrentPath);
      window.removeEventListener('popstate', syncCurrentPath);
    };
  }, []);

  let page: React.ReactNode;
  let overlay: React.ReactNode = null;
  if (currentPath === APP_ROUTE_PATHS.root || currentPath === APP_ROUTE_PATHS.welcome) {
    page = <WorkbenchFrame />;
    overlay = <StartPage />;
  } else if (currentPath === APP_ROUTE_PATHS.dataWorkspace) {
    page = <WorkbenchFrame />;
    overlay = <DataWorkspacePage />;
  } else if (currentPath === APP_ROUTE_PATHS.settings) {
    page = <WorkbenchFrame />;
    overlay = <SettingsPage />;
  } else if (isDraftPath(currentPath)) {
    page = <OperatorDraftPage />;
  } else if (isBuffSheetPath(currentPath)) {
    page = <BuffDraftSheetPage />;
  } else if (isWeaponSheetPath(currentPath)) {
    page = <WeaponDraftSheetPage />;
  } else if (isEquipmentSheetPath(currentPath)) {
    page = <EquipmentSheetPage />;
  } else if (isDamageSheetPath(currentPath)) {
    page = <DamageSheetPage />;
  } else if (isDamageReportPptPath(currentPath)) {
    page = <DamageReportPptPage />;
  } else if (isImageManagerPath(currentPath)) {
    page = <ImageManagerPage />;
  } else if (currentPath === APP_ROUTE_PATHS.operatorConfig) {
    page = <OperatorConfigPage />;
  } else {
    const activeSkillButtonId = getTimelineSkillDetailButtonId(currentPath);
    page = <WorkbenchFrame activeSkillButtonId={activeSkillButtonId} />;
  }

  return (
    <div className="app">
      <AppShell currentPath={currentPath} overlay={overlay}>{page}</AppShell>
    </div>
  );
}

export default App;
