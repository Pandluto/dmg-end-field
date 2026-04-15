/**
 * App 根组件
 * 根据 currentView 决定渲染哪个界面：
 * - 'selection'：干员选择界面（SelectionPanel）
 * - 'canvas'：谱线编辑界面（CanvasBoard）
 */

import { useAppContext } from './context/AppContext';
import { SelectionPanel } from './components/SelectionPanel';
import { CanvasBoard } from './components/CanvasBoard';
import './styles/global.css';

function App() {
  const { state } = useAppContext();

  return (
    <div className="app">
      {state.currentView === 'selection' && <SelectionPanel />}
      {state.currentView === 'canvas' && <CanvasBoard />}
    </div>
  );
}

export default App;
