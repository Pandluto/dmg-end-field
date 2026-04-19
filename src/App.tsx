/**
 * App 根组件
 * 只负责渲染工作台框架，业务页面由 WorkbenchFrame 承载
 */

import { WorkbenchFrame } from './components/WorkbenchFrame';
import './styles/global.css';

function App() {
  return (
    <div className="app">
      <WorkbenchFrame />
    </div>
  );
}

export default App;
