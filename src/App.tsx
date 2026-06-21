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
import { AiCliPage, isAiCliPath } from './components/AiCliPage';
import { OperatorConfigPage } from './components/OperatorConfigPage';
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

  if (isDraftPath(currentPath)) {
    return <OperatorDraftPage />;
  }

  if (isBuffSheetPath(currentPath)) {
    return <BuffDraftSheetPage />;
  }

  if (isWeaponSheetPath(currentPath)) {
    return <WeaponDraftSheetPage />;
  }

  if (isEquipmentSheetPath(currentPath)) {
    return <EquipmentSheetPage />;
  }

  if (isDamageSheetPath(currentPath)) {
    return <DamageSheetPage />;
  }

  if (isDamageReportPptPath(currentPath)) {
    return <DamageReportPptPage />;
  }

  if (isImageManagerPath(currentPath)) {
    return <ImageManagerPage />;
  }

  if (isAiCliPath(currentPath)) {
    return <AiCliPage />;
  }

  if (currentPath === APP_ROUTE_PATHS.operatorConfig) {
    return <OperatorConfigPage />;
  }

  const activeSkillButtonId = getTimelineSkillDetailButtonId(currentPath);

  return (
    <div className="app">
      <WorkbenchFrame activeSkillButtonId={activeSkillButtonId} />
    </div>
  );
}

export default App;
