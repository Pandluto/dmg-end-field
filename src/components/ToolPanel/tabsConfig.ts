// tabsConfig.ts
// 标签页配置 - 集中管理所有标签页定义

/**
 * 标签页定义接口
 * 定义每个标签页的基本属性
 */
export interface TabDefinition {
  key: string;       // 标签页唯一标识
  label: string;    // 显示名称
  icon?: string;    // 可选的图标类名
}

/**
 * 可用的标签页列表
 * 按顺序排列
 */
export const SIDE_PANEL_TABS: TabDefinition[] = [
  { key: 'damage', label: '伤害加成' },
  { key: 'report', label: '伤害报表' },
  { key: 'function1', label: '功能1' },
  { key: 'function2', label: '功能2' },
];

/**
 * 默认激活的标签页
 */
export const DEFAULT_ACTIVE_TAB = 'damage';
