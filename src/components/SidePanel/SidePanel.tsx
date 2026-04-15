// SidePanel.tsx
// 功能面板根组件 - 提供多标签页结构支持切换不同功能模块

import { useState } from 'react';
import { SIDE_PANEL_TABS, DEFAULT_ACTIVE_TAB } from './tabsConfig';
import { DamageTab } from './components/DamageTab';
import './SidePanel.css';

/**
 * SidePanel 组件属性接口
 */
interface SidePanelProps {
  widthPercent?: number;  // 面板宽度百分比
}

/**
 * 功能面板组件
 * 提供多标签页结构，支持切换不同功能模块
 *
 * @param widthPercent - 面板宽度占父容器的百分比，默认为 15
 */
export function SidePanel({ widthPercent = 15 }: SidePanelProps) {
  // 使用 useState 管理当前激活的标签页状态
  const [activeTab, setActiveTab] = useState(DEFAULT_ACTIVE_TAB);

  return (
    <div className="side-panel" style={{ width: `${widthPercent}%` }}>
      <div className="side-panel-content">
        {/* 标签按钮容器 - 显示所有可切换的标签 */}
        <div className="side-panel-tabs">
          {SIDE_PANEL_TABS.map((tab) => (
            <button
              key={tab.key}
              className={`side-panel-tab${activeTab === tab.key ? ' is-active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 标签页内容区域 - 根据当前激活标签显示对应内容 */}
        <div className="side-panel-body">
          {/* 伤害加成标签页内容 */}
          {activeTab === 'damage' && <DamageTab />}
          {/* 功能1标签页内容 */}
          {activeTab === 'function1' && (
            <div className="tab-content-function1">功能1内容区</div>
          )}
          {/* 功能2标签页内容 */}
          {activeTab === 'function2' && (
            <div className="tab-content-function2">功能2内容区</div>
          )}
        </div>
      </div>
    </div>
  );
}
