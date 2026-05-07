# review-todo0.5.6

## [任务理解]

本轮执行 `修改大纲—交互优化.md` 的第三步：面板工作台化。

目标是在 0.5.5 工作台壳层之后，将当前 `SidePanel` 从“固定 tab 容器”升级为“工作台工具面板”，为后续 Buff、伤害、配置、详情等工具能力提供统一面板边界。

本轮只做面板结构和职责边界，不改 Buff 缓存主链路，不改伤害计算，不做视觉大重构。

## [当前状态]

当前 `SidePanel`：

- 固定显示在 `CanvasBoard` 布局左侧。
- 内部通过 `activeTab` 切换 `damage / function1 / function2`。
- `DamageTab` 已在 0.5.3 抽出 `useCandidateBuffs` 和 `useBuffInteraction`。

当前问题：

- `SidePanel` 仍是简单 tab 容器，不是工作台工具面板。
- 工具面板没有统一标题、说明、状态、空态、操作区规范。
- 后续继续加功能会变成 tab 堆叠。
- 工作台壳层无法清晰接管工具面板区域。

## [必须改]

### 1. 新建 WorkbenchPanel 目录

Trae 执行：

- 新建 `src/components/WorkbenchPanel/`。
- 新建文件：
  - `WorkbenchPanel.tsx`
  - `WorkbenchToolTabs.tsx`
  - `WorkbenchPanelSection.tsx`
  - `WorkbenchPanel.css`
  - `index.ts`

约束：

- 本轮只建立面板壳和工具 tab 边界。
- 不要重写 `DamageTab` 业务逻辑。
- 不要改 Buff 添加、拖拽、删除链路。

### 2. 实现 WorkbenchPanel

Trae 执行：

- `WorkbenchPanel` 作为工作台工具面板外壳。
- 它负责统一：
  - 面板宽度。
  - 面板标题区域。
  - 工具 tab 区域。
  - 面板内容区。

建议 props：

```ts
interface WorkbenchPanelProps {
  title: string;
  description?: string;
  tabs: React.ReactNode;
  children: React.ReactNode;
  widthPercent?: number;
}
```

约束：

- `WorkbenchPanel` 不处理具体 Buff 业务。
- `WorkbenchPanel` 不读写 storage。
- `WorkbenchPanel` 不派发 Buff 事件。

### 3. 实现 WorkbenchToolTabs

Trae 执行：

- `WorkbenchToolTabs` 负责工具 tab 渲染。
- 从现有 `SidePanel` 中迁移 tab 按钮渲染逻辑。

建议 props：

```ts
interface WorkbenchToolTab {
  key: string;
  label: string;
}

interface WorkbenchToolTabsProps {
  tabs: WorkbenchToolTab[];
  activeKey: string;
  onChange: (key: string) => void;
}
```

约束：

- 不把具体 tab 内容写进 `WorkbenchToolTabs`。
- `WorkbenchToolTabs` 只负责展示和切换事件。

### 4. 实现 WorkbenchPanelSection

Trae 执行：

- `WorkbenchPanelSection` 用于面板内分区。
- 先提供最小结构：
  - section 标题。
  - 可选说明。
  - 内容区域。

建议 props：

```ts
interface WorkbenchPanelSectionProps {
  title?: string;
  description?: string;
  children: React.ReactNode;
}
```

约束：

- 不强制所有已有内容立刻使用 section。
- 可先给后续工具面板预留规范。

### 5. 改造 SidePanel 为 WorkbenchPanel 适配层

Trae 执行：

- 修改 `src/components/SidePanel/SidePanel.tsx`。
- 保留 `SidePanel` 对外组件名，避免影响 `CanvasBoard`。
- 内部改为使用：
  - `WorkbenchPanel`
  - `WorkbenchToolTabs`

目标：

- `SidePanel` 继续接收 `widthPercent`。
- `SidePanel` 继续管理 `activeTab`。
- `DamageTab` 仍作为 `damage` tab 内容。
- `function1 / function2` 暂时保留占位。

约束：

- 不改 `CanvasBoard` 对 `SidePanel` 的调用。
- 不改 `DamageTab` 的 props。
- 不改 `tabsConfig.ts` 的数据结构，除非必须。

### 6. 最小 CSS 迁移

Trae 执行：

- 新增 `WorkbenchPanel.css`。
- 将通用面板壳样式放到 `WorkbenchPanel.css`。
- `SidePanel.css` 保留兼容样式，避免大面积视觉回归。

要求：

- 不做视觉大改。
- 不改变 SidePanel 当前宽度策略。
- 不影响 `DamageTab` 内部布局。
- 不影响拖拽 Buff follower 层级。

### 7. 明确工具面板边界

Trae 执行：

- 在代码结构上保证：
  - `WorkbenchPanel` 是壳。
  - `WorkbenchToolTabs` 是 tab 切换器。
  - `DamageTab` 是具体工具内容。
  - `SidePanel` 是当前兼容适配层。

约束：

- 不要让 `WorkbenchPanel` import `DamageTab`。
- 不要让 `WorkbenchToolTabs` import `DamageTab`。
- 具体内容仍由 `SidePanel` 组合。

## [可选优化]

以下内容可做，但不得影响主线交付：

- 将 `SIDE_PANEL_TABS` 重命名为 `WORKBENCH_TOOL_TABS`，但本轮不强制。
- 给 tab 配置增加 `description` 字段，后续用于面板说明。
- 在 `WorkbenchPanel` 中预留 `actions` slot。

## [不要动]

本轮禁止：

- 不要修改 `DamageTab` 的 Buff 业务逻辑。
- 不要修改 `useCandidateBuffs`。
- 不要修改 `useBuffInteraction`。
- 不要修改 `candidateBuffRepository`。
- 不要修改 `buffService`。
- 不要修改 `timelineService`。
- 不要修改 `CanvasBoard`。
- 不要修改 `CanvasArea`。
- 不要修改 `SkillSandbox`。
- 不要修改 `SkillButton`。
- 不要改 `def.skill-button.v1`。
- 不要改 `def.all-buff-list.v1`。
- 不要改 `def.candidate-buff-list.v1`。
- 不要改伤害公式。
- 不要处理“增幅区”。

## [验收标准 AC]

1. `src/components/WorkbenchPanel/WorkbenchPanel.tsx` 存在。
2. `src/components/WorkbenchPanel/WorkbenchToolTabs.tsx` 存在。
3. `src/components/WorkbenchPanel/WorkbenchPanelSection.tsx` 存在。
4. `src/components/WorkbenchPanel/WorkbenchPanel.css` 存在。
5. `SidePanel.tsx` 内部使用 `WorkbenchPanel` 和 `WorkbenchToolTabs`。
6. `DamageTab` 仍能正常显示。
7. `function1 / function2` 占位仍能正常切换。
8. `CanvasBoard` 对 `SidePanel` 的调用不需要改。
9. `npm run build` 通过。

## [回归检查项]

Trae 必须手测：

1. `/timeline` 页面左侧工具面板正常显示。
2. 切换 `damage / function1 / function2` 正常。
3. Buff 刷新正常。
4. Buff 搜索正常。
5. Buff 单击添加正常。
6. Buff 拖拽添加正常。
7. Buff 详情弹窗正常。
8. 技能按钮弹窗中的已选 Buff 正常显示。
9. 画布拖拽技能按钮不受影响。
10. `npm run build` 通过。

## [给 Trae 的执行指令]

按以下顺序执行：

1. 新建 `src/components/WorkbenchPanel/` 和基础组件。
2. 实现 `WorkbenchPanel`。
3. 实现 `WorkbenchToolTabs`。
4. 实现 `WorkbenchPanelSection`。
5. 修改 `SidePanel.tsx`，让它成为 WorkbenchPanel 适配层。
6. 添加最小 CSS，保持视觉稳定。
7. 跑 `npm run build`。
8. 按回归检查项手测。

本轮交付标准：SidePanel 从普通 tab 容器升级为工作台工具面板结构，但 Buff、排轴、伤害、缓存功能不回退。

