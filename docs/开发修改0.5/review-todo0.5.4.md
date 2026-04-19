# review-todo0.5.4：工作台框架化

## [Review 结论]

本阶段只做“工作台框架化”，不是重写选人流程，也不是重写排轴工作区。

当前项目已经存在两个自洽流程：

- `SelectionPanel`：选人流程。
- `CanvasBoard`：排轴工作区，内部包含 `SidePanel`、`CanvasArea`、`SkillSandbox`、`OperatorConfigPanel`、技能按钮弹窗、Buff 交互、伤害展示。

0.5.4 的目标是新增一个独立的 `WorkbenchFrame`，在顶部提供“选人 / 排轴”两个工作台标签，用框架承载两个流程界面。框架只能负责页面容器和标签切换，不允许介入各业务流程内部逻辑。

## [问题列表]

### P1：当前 `App.tsx` 直接用 `state.currentView` 渲染业务页面，缺少工作台外壳

文件：`src/App.tsx`

现状：

- `App.tsx` 直接判断 `state.currentView === 'selection'` 渲染 `SelectionPanel`。
- `App.tsx` 直接判断 `state.currentView === 'canvas'` 渲染 `CanvasBoard`。

问题：

- 顶层没有统一工作台框架。
- “选人”和“排轴”是流程切换，但没有被表达为工作台标签。
- 后续如果直接在 `SelectionPanel` 或 `CanvasBoard` 内加顶部栏，会污染业务页面职责。

修正方向：

- 新增 `WorkbenchFrame`。
- `App.tsx` 只渲染 `WorkbenchFrame`。
- `WorkbenchFrame` 内部根据 `state.currentView` 渲染 `SelectionPanel` 或 `CanvasBoard`。

### P1：工作台标签必须是框架行为，不能改写业务页面行为

涉及文件：

- `src/components/SelectionPanel/index.tsx`
- `src/components/CanvasBoard/index.tsx`
- 新增 `src/components/WorkbenchFrame/WorkbenchFrame.tsx`

约束：

- `SelectionPanel.handleConfirm()` 仍然负责“开始排轴”：清空画布并切到 `canvas`。
- `CanvasBoard.handleBack()` 仍然负责“返回选人”：切到 `selection` 并清空当前技能按钮选中态。
- 顶部标签只是额外入口，不能替代或删除现有入口。

修正方向：

- `WorkbenchFrame` 顶部标签点击“选人”：dispatch `SET_VIEW selection`。
- `WorkbenchFrame` 顶部标签点击“排轴”：仅当 `selectedCharacters.length > 0` 时 dispatch `SET_VIEW canvas`。
- 未选择干员时，“排轴”标签必须禁用，或点击后不切换并给出轻量提示。

### P2：不能把 0.5.4 扩散成 SidePanel / 配置面板 / Buff 交互重构

禁止改动：

- `src/components/SidePanel/SidePanel.tsx`
- `src/components/SidePanel/components/DamageTab.tsx`
- `src/components/CanvasBoard/SkillButton.tsx`
- `src/components/CanvasBoard/SkillSandbox.tsx`
- `src/components/CanvasBoard/components/OperatorConfigPanel.tsx`
- `src/hooks/useBuffInteraction.ts`
- `src/hooks/useCandidateBuffs.ts`
- `src/hooks/useSkillButtonBuffs.ts`
- `src/core/services/*`
- `src/core/repositories/*`
- `src/core/calculators/*`

原因：

- 当前 SidePanel 是 Buff 工具输入区。
- OperatorConfigPanel 是干员配置输入区。
- SkillButton 弹窗是技能按钮结果消费区。
- 三者交互关系已经自洽，0.5.4 只加外层框架，不能重排或合并这些职责。

## [风险列表]

- 如果 `WorkbenchFrame` 在切换 tab 时卸载并重建 `CanvasBoard`，可能触发现有恢复逻辑重新执行。必须手测排轴 tab 来回切换后按钮、Buff、配置面板行为是否异常。
- 如果点击“选人”时顺手清空 `selectedCharacters` 或 `skillButtons`，会破坏现有返回选人语义。0.5.4 不允许增加自动清空逻辑。
- 如果把顶部标签塞进 `CanvasBoard`，会让工作台框架和排轴业务耦合，后续继续重构会更难。

## [给 Trae 的修正 TODO]

### 必须改

1. 新增目录和文件：

   - `src/components/WorkbenchFrame/WorkbenchFrame.tsx`
   - `src/components/WorkbenchFrame/WorkbenchFrame.css`
   - 可选：`src/components/WorkbenchFrame/index.ts`

2. 修改 `src/App.tsx`：

   - 移除 `App.tsx` 内对 `SelectionPanel` 和 `CanvasBoard` 的直接渲染判断。
   - 改为只渲染 `<WorkbenchFrame />`。
   - 保留 `global.css` 引入。

3. 在 `WorkbenchFrame.tsx` 中实现顶部工作台标签：

   - 标签 1：`选人`
   - 标签 2：`排轴`
   - 当前激活态来自 `state.currentView`。
   - `selection` 对应选人标签激活。
   - `canvas` 对应排轴标签激活。

4. 在 `WorkbenchFrame.tsx` 中承载现有业务页面：

   - `state.currentView === 'selection'` 时渲染 `<SelectionPanel />`。
   - `state.currentView === 'canvas'` 时渲染 `<CanvasBoard />`。
   - 不修改 `SelectionPanel` 和 `CanvasBoard` 内部结构。

5. 实现标签切换规则：

   - 点击“选人”：dispatch `{ type: 'SET_VIEW', view: 'selection' }`。
   - 点击“排轴”：如果 `state.selectedCharacters.length > 0`，dispatch `{ type: 'SET_VIEW', view: 'canvas' }`。
   - 未选择干员时，“排轴”标签必须禁用，或点击后不切换。

6. 样式要求：

   - `WorkbenchFrame` 外层作为全应用壳层。
   - 顶部标签栏固定在内容上方。
   - 页面内容区域完整承载现有 `SelectionPanel` / `CanvasBoard`。
   - 不要求大规模视觉重设计。
   - 不改变现有 `SelectionPanel.css`、`CanvasBoard.css` 的业务布局。

### 可选优化

1. “排轴”标签禁用时增加简短 title，例如：`请先选择干员`。
2. 顶部栏右侧显示当前已选干员数量，例如：`已选 3/4`。
3. 顶部栏可预留工作台标题，但不要新增业务按钮。

### 不要动

1. 不要引入 `react-router-dom`。
2. 不要新增 `/select`、`/timeline` 路由。
3. 不要拆 `CanvasBoard`。
4. 不要改 `SidePanel` 的 tab 结构。
5. 不要改 `DamageTab` 的 Buff 添加逻辑。
6. 不要改 `OperatorConfigPanel` 的打开方式、干员切换、武器配置、装备输入、同步逻辑。
7. 不要改技能按钮双击弹窗、长按拖动、右键删除、锁定逻辑。
8. 不要改任何 sessionStorage key。
9. 不要改伤害计算公式。
10. 不要清理或重命名 0.5.1 到 0.5.3 已完成的分层文件。

## [验收标准 AC]

### AC1：工作台框架存在

- `src/components/WorkbenchFrame/WorkbenchFrame.tsx` 存在。
- `App.tsx` 只负责渲染 `WorkbenchFrame`。
- `SelectionPanel` 和 `CanvasBoard` 不再直接挂在 `App.tsx`。

### AC2：顶部标签可切换

- 初始进入应用时显示“选人”标签激活。
- 选择至少 1 个干员后，点击“开始排轴”进入排轴工作区。
- 进入排轴后，“排轴”标签激活。
- 点击顶部“选人”标签可回到选人界面。
- 未选择干员时不能进入“排轴”标签。

### AC3：现有流程不回退

- `SelectionPanel` 仍支持选择 / 取消选择干员。
- 最多仍只能选择 4 个干员。
- “开始排轴”仍能进入 `CanvasBoard`。
- `CanvasBoard` 内原有返回按钮仍能返回选人。

### AC4：排轴主交互不回退

- 从 `SkillSandbox` 拖技能到画布仍可生成技能按钮。
- 已放置技能按钮仍可拖动换节点。
- 技能按钮右键删除仍有效。
- 技能按钮锁定后右键删除仍失效。
- 技能按钮双击仍打开技能弹窗。

### AC5：SidePanel / Buff 不回退

- `SidePanel` 仍显示伤害加成 tab。
- 候选 Buff 刷新仍有效。
- 候选 Buff 单击添加仍有效。
- 候选 Buff 双击详情仍有效。
- 候选 Buff 长按拖到技能弹窗仍有效。
- 长按释放到弹窗外不应添加。
- 已选 Buff 右键删除仍有效。

### AC6：配置面板不回退

- `SkillSandbox` 干员头像双击仍打开 `OperatorConfigPanel`。
- 配置面板右侧头像切换仍有效。
- 技能等级 L9/M3 切换仍有效。
- 武器选择 / 潜能切换仍有效。
- 装备输入 / 复制解析 / 同步仍有效。
- 技能按钮伤害弹窗仍能消费配置结果。

### AC7：构建通过

- `npm run build` 必须通过。

## [回归检查项]

1. 进入应用，确认默认显示选人界面。
2. 未选择干员时点击“排轴”标签，确认不会进入空排轴。
3. 选择 1 到 4 个干员，点击“开始排轴”，确认进入排轴。
4. 从顶部“选人”标签切回选人，再切回“排轴”，确认选择状态不被误清空。
5. 拖一个技能到画布，确认按钮生成并吸附节点。
6. 双击技能按钮打开弹窗，确认技能信息、已选 Buff、伤害展示仍存在。
7. 在 SidePanel 刷新 Buff，单击添加 Buff，确认技能弹窗已选 Buff 更新。
8. 长按 Buff 拖到技能弹窗内释放，确认添加成功。
9. 长按 Buff 拖到弹窗外释放，确认不添加。
10. 右键删除已选 Buff，确认删除成功。
11. 双击干员头像打开配置面板，切换武器、技能等级、装备同步，确认不报错。
12. 保存排轴后刷新页面，确认恢复链路不被 WorkbenchFrame 破坏。

## [给 Trae 的执行指令]

按以下顺序执行：

1. 新建 `WorkbenchFrame` 目录和组件，只做外层框架。
2. 修改 `App.tsx`，让它只渲染 `WorkbenchFrame`。
3. 在 `WorkbenchFrame` 中接入 `useAppContext()`，读取 `state.currentView` 和 `state.selectedCharacters`。
4. 在 `WorkbenchFrame` 中实现顶部“选人 / 排轴”标签。
5. 在 `WorkbenchFrame` 中原样承载 `SelectionPanel` 和 `CanvasBoard`。
6. 只补必要 CSS，不动业务组件样式。
7. 跑 `npm run build`。
8. 按回归检查项完成手测。

本轮目标是“框架和流程界面互相独立”。不得把 0.5.4 扩散成路由改造、CanvasBoard 拆分、SidePanel 重排、配置面板重构或 Buff 交互重写。
