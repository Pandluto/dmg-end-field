import { useState } from 'react';
import { SIDE_PANEL_TABS, DEFAULT_ACTIVE_TAB } from './tabsConfig';
import { DamageTab } from './components/DamageTab';
import './ToolPanel.css';

interface ToolPanelProps {
  widthPercent?: number;
}

export function ToolPanel({ widthPercent = 100 }: ToolPanelProps) {
  const [activeTab, setActiveTab] = useState(DEFAULT_ACTIVE_TAB);

  return (
    <div className="tool-panel" style={{ width: `${widthPercent}%` }}>
      <div className="tool-panel-content">
        <div className="tool-panel-tabs">
          {SIDE_PANEL_TABS.map((tab) => (
            <button
              key={tab.key}
              className={`tool-panel-tab${activeTab === tab.key ? ' is-active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="tool-panel-body">
          {activeTab === 'damage' && <DamageTab />}
          {activeTab === 'function1' && (
            <div className="tab-content-function1">功能1内容区</div>
          )}
          {activeTab === 'function2' && (
            <div className="tab-content-function2">功能2内容区</div>
          )}
        </div>
      </div>
    </div>
  );
}
