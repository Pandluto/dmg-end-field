/**
 * Toolbar 工具栏组件
 *
 * 功能说明：
 * - 页面顶部的操作栏，提供返回、快照保存、快照恢复、排轴分享、伤害计算等功能
 * - 左侧：返回按钮
 * - 中间：干员组数量控制（2~5组）
 * - 右侧：保存按钮、恢复按钮、计算伤害按钮
 *
 * 使用场景：
 * - CanvasBoard 画布区域顶部
 */

interface ToolbarProps {
  /** 当前干员组数量（2~5） */
  staffCount: number;
  /** 返回按钮点击事件 */
  onBack: () => void;
  /** 增加干员组按钮点击事件 */
  onAddGroup: () => void;
  /** 减少干员组按钮点击事件 */
  onRemoveGroup: () => void;
  /** 保存按钮点击事件 */
  onSave?: () => void;
  /** 恢复按钮点击事件 */
  onRestore?: () => void;
  /** 分享按钮点击事件 */
  onShare?: () => void;
  /** 表格按钮点击事件 */
  onTable?: () => void;
  /** 计算伤害/生成报表点击事件 */
  onCalculate?: () => void;
}

/**
 * Toolbar 工具栏组件
 *
 * @param props - 组件属性
 * @param props.staffCount - 当前干员组数量
 * @param props.onBack - 返回按钮回调
 * @param props.onAddGroup - 增加干员组回调
 * @param props.onRemoveGroup - 减少干员组回调
 */
export function Toolbar({
  staffCount,
  onBack,
  onAddGroup,
  onRemoveGroup,
  onSave,
  onRestore,
  onShare,
  onTable,
  onCalculate,
}: ToolbarProps) {
  return (
    <div className="toolbar">
      {/* 左侧：返回按钮 */}
      <button className="btn-back" onClick={onBack}>
        返回
      </button>

      {/* 中间：干员组数量控制（加减按钮 + 当前组号显示） */}
      <div className="staff-group-controls">
        {/* 减少干员组按钮 - 最少2组时禁用 */}
        <button
          className="btn-remove-group"
          onClick={onRemoveGroup}
          disabled={staffCount <= 2}
        >
          -
        </button>

        {/* 当前组号显示 */}
        <span className="staff-group-count">第{staffCount}组</span>

        {/* 增加干员组按钮 - 最多5组时禁用 */}
        <button
          className="btn-add-group"
          onClick={onAddGroup}
          disabled={staffCount >= 5}
        >
          +
        </button>
      </div>

      {/* 右侧：保存和伤害计算按钮 */}
      <div className="toolbar-right">
        <button className="btn-save" onClick={onSave}>保存</button>
        <button className="btn-save" onClick={onRestore}>恢复</button>
        <button className="btn-save" onClick={onShare}>分享</button>
        <button className="btn-save" onClick={onTable}>表格</button>
        <button className="btn-calculate" onClick={onCalculate}>计算伤害</button>
      </div>
    </div>
  );
}
