import { useState } from 'react';
import { SIDE_PANEL_TABS, DEFAULT_ACTIVE_TAB } from './tabsConfig';
import { DamageTab } from './components/DamageTab';
import { ReportTab } from './components/ReportTab';
import './ToolPanel.css';

interface ToolPanelProps {
  widthPercent?: number;
  activeTab?: string;
  onActiveTabChange?: (tabKey: string) => void;
  reportAutoGenerateToken?: number;
}

export function ToolPanel({
  widthPercent = 100,
  activeTab,
  onActiveTabChange,
  reportAutoGenerateToken = 0,
}: ToolPanelProps) {
  const [internalActiveTab, setInternalActiveTab] = useState(DEFAULT_ACTIVE_TAB);
  const resolvedActiveTab = activeTab ?? internalActiveTab;

  const handleTabChange = (tabKey: string) => {
    if (activeTab === undefined) {
      setInternalActiveTab(tabKey);
    }
    onActiveTabChange?.(tabKey);
  };

  return (
    <div className="tool-panel" style={{ width: `${widthPercent}%` }}>
      <div className="tool-panel-content">
        <div className="tool-panel-tabs">
          {SIDE_PANEL_TABS.map((tab) => (
            <button
              key={tab.key}
              className={`tool-panel-tab${resolvedActiveTab === tab.key ? ' is-active' : ''}`}
              onClick={() => handleTabChange(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="tool-panel-body">
          {resolvedActiveTab === 'damage' && <DamageTab />}
          {resolvedActiveTab === 'report' && <ReportTab autoGenerateToken={reportAutoGenerateToken} />}
          {resolvedActiveTab === 'function1' && (
            <div className="tab-content-function1">功能1内容区</div>
          )}
          {resolvedActiveTab === 'function2' && (
            <div className="tab-content-function2">功能2内容区</div>
          )}
        </div>
      </div>
    </div>
  );
}
