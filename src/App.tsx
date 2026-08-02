/**
 * App 根组件
 * 路由页面按需执行；常用模块在浏览器空闲时依次抢跑，避免首次点击等待。
 */

import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
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

const loadWorkbenchFrame = () => import('./components/WorkbenchFrame');
const loadOperatorDraftPage = () => import('./components/OperatorDraftPage');
const loadBuffDraftPage = () => import('./components/BuffDraftPage');
const loadWeaponDraftPage = () => import('./components/WeaponDraftPage');
const loadEquipmentSheetPage = () => import('./components/EquipmentSheetPage');
const loadDamageSheetPage = () => import('./components/DamageSheetPage');
const loadDamageReportPptPage = () => import('./components/DamageReportPptPage');
const loadImageManagerPage = () => import('./components/ImageManagerPage');
const loadOperatorConfigPage = () => import('./components/OperatorConfigPage');

const WorkbenchFrame = lazy(async () => ({
  default: (await loadWorkbenchFrame()).WorkbenchFrame,
}));
const OperatorDraftPage = lazy(async () => ({
  default: (await loadOperatorDraftPage()).OperatorDraftPage,
}));
const BuffDraftSheetPage = lazy(async () => ({
  default: (await loadBuffDraftPage()).BuffDraftSheetPage,
}));
const WeaponDraftSheetPage = lazy(async () => ({
  default: (await loadWeaponDraftPage()).WeaponDraftSheetPage,
}));
const EquipmentSheetPage = lazy(async () => ({
  default: (await loadEquipmentSheetPage()).EquipmentSheetPage,
}));
const DamageSheetPage = lazy(async () => ({
  default: (await loadDamageSheetPage()).DamageSheetPage,
}));
const DamageReportPptPage = lazy(async () => ({
  default: (await loadDamageReportPptPage()).DamageReportPptPage,
}));
const ImageManagerPage = lazy(async () => ({
  default: (await loadImageManagerPage()).ImageManagerPage,
}));
const OperatorConfigPage = lazy(async () => ({
  default: (await loadOperatorConfigPage()).OperatorConfigPage,
}));

const routePreloaders = [
  loadWorkbenchFrame,
  loadOperatorConfigPage,
  loadDamageSheetPage,
  loadDamageReportPptPage,
  loadOperatorDraftPage,
  loadBuffDraftPage,
  loadWeaponDraftPage,
  loadEquipmentSheetPage,
  loadImageManagerPage,
] as const;

function isOverlayPath(path: string): boolean {
  return path === APP_ROUTE_PATHS.root
    || path === APP_ROUTE_PATHS.welcome
    || path === APP_ROUTE_PATHS.dataWorkspace
    || path === APP_ROUTE_PATHS.settings;
}

function isWorkbenchPath(path: string): boolean {
  return path === APP_ROUTE_PATHS.timelineWorkspace
    || path.startsWith(`${APP_ROUTE_PATHS.timelineSkillDetail}/`);
}

function PageLoadingFallback() {
  return (
    <main className="web-entry-screen app-route-loading" aria-live="polite">
      <div className="boot-indicator">
        <span />
        <p>正在打开工作区</p>
      </div>
    </main>
  );
}

function IdleWorkbenchBackdrop() {
  return <div className="workbench-idle-backdrop" aria-hidden="true" />;
}

function App() {
  const [currentPath, setCurrentPath] = useState(() => {
    if (typeof window === 'undefined') return APP_ROUTE_PATHS.root;
    return getCurrentAppPath(window.location);
  });
  const [workspaceActivated, setWorkspaceActivated] = useState(
    () => isWorkbenchPath(currentPath),
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
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

  useEffect(() => {
    if (isWorkbenchPath(currentPath)) setWorkspaceActivated(true);
  }, [currentPath]);

  useEffect(() => {
    let cancelled = false;
    let idleHandle: number | null = null;
    let timerHandle: number | null = null;
    let preloadIndex = 0;

    const scheduleNext = () => {
      if (cancelled || preloadIndex >= routePreloaders.length) return;
      const run = () => {
        if (cancelled) return;
        const preload = routePreloaders[preloadIndex];
        preloadIndex += 1;
        void preload().catch(() => undefined).finally(scheduleNext);
      };
      const requestIdle = (window as unknown as {
        requestIdleCallback?: Window['requestIdleCallback'];
      }).requestIdleCallback;
      if (typeof requestIdle === 'function') {
        idleHandle = requestIdle.call(window, run, { timeout: 2_000 });
      } else {
        timerHandle = globalThis.setTimeout(run, 450);
      }
    };

    scheduleNext();
    return () => {
      cancelled = true;
      const cancelIdle = (window as unknown as {
        cancelIdleCallback?: Window['cancelIdleCallback'];
      }).cancelIdleCallback;
      if (idleHandle !== null && typeof cancelIdle === 'function') {
        cancelIdle.call(window, idleHandle);
      }
      if (timerHandle !== null) window.clearTimeout(timerHandle);
    };
  }, []);

  let page: ReactNode;
  let overlay: ReactNode = null;
  if (isOverlayPath(currentPath)) {
    page = workspaceActivated ? <WorkbenchFrame /> : <IdleWorkbenchBackdrop />;
    if (currentPath === APP_ROUTE_PATHS.dataWorkspace) overlay = <DataWorkspacePage />;
    else if (currentPath === APP_ROUTE_PATHS.settings) overlay = <SettingsPage />;
    else overlay = <StartPage />;
  } else if (currentPath === APP_ROUTE_PATHS.draft) {
    page = <OperatorDraftPage />;
  } else if (currentPath === APP_ROUTE_PATHS.buffSheet) {
    page = <BuffDraftSheetPage />;
  } else if (currentPath === APP_ROUTE_PATHS.weaponSheet) {
    page = <WeaponDraftSheetPage />;
  } else if (currentPath === APP_ROUTE_PATHS.equipmentSheet) {
    page = <EquipmentSheetPage />;
  } else if (currentPath === APP_ROUTE_PATHS.damageSheet) {
    page = <DamageSheetPage />;
  } else if (currentPath === APP_ROUTE_PATHS.damageReportPpt) {
    page = <DamageReportPptPage />;
  } else if (currentPath === APP_ROUTE_PATHS.imageManager) {
    page = <ImageManagerPage />;
  } else if (currentPath === APP_ROUTE_PATHS.operatorConfig) {
    page = <OperatorConfigPage />;
  } else {
    const activeSkillButtonId = getTimelineSkillDetailButtonId(currentPath);
    page = <WorkbenchFrame activeSkillButtonId={activeSkillButtonId} />;
  }

  return (
    <div className="app">
      <AppShell currentPath={currentPath} overlay={overlay}>
        <Suspense fallback={<PageLoadingFallback />}>{page}</Suspense>
      </AppShell>
    </div>
  );
}

export default App;
