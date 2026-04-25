/**
 * App 根组件
 * 只负责渲染工作台框架，业务页面由 WorkbenchFrame 承载
 */

import { WorkbenchFrame } from './components/WorkbenchFrame';
import { StorageDebugPage, isStorageDebugPath } from './components/StorageDebugPage';
import './styles/global.css';

function App() {
  if (typeof window !== 'undefined' && isStorageDebugPath(window.location.pathname)) {
    return <StorageDebugPage />;
  }

  return (
    <div className="app">
      <WorkbenchFrame />
    </div>
  );
}

export default App;
