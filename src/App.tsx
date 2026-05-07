/**
 * App 根组件
 * 只负责渲染工作台框架，业务页面由 WorkbenchFrame 承载
 */

import { useEffect, useState } from 'react';
import { WorkbenchFrame } from './components/WorkbenchFrame';
import { StorageDebugPage, isStorageDebugPath } from './components/StorageDebugPage';
import { OperatorDraftPage, isDraftPath } from './components/OperatorDraftPage';
import { BuffDraftPage, isBuffDraftPath } from './components/BuffDraftPage';
import { getCurrentAppPath } from './utils/appRoute';
import { migrateLegacyStorageNamespace } from './utils/migrateStorage';
import './styles/global.css';

function App() {
  const [currentPath, setCurrentPath] = useState(() => {
    if (typeof window === 'undefined') {
      return '/';
    }
    return getCurrentAppPath(window.location);
  });

  useEffect(() => {
    migrateLegacyStorageNamespace();
  }, []);

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

  if (isStorageDebugPath(currentPath)) {
    return <StorageDebugPage />;
  }

  if (isDraftPath(currentPath)) {
    return <OperatorDraftPage />;
  }

  if (isBuffDraftPath(currentPath)) {
    return <BuffDraftPage />;
  }

  return (
    <div className="app">
      <WorkbenchFrame />
    </div>
  );
}

export default App;
