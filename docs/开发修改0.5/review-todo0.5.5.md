# review-todo0.5.5：工作台显示模式升级

## [任务理解]

当前工作台抽屉只有两个入口：

- `选人`
- `排轴`

现需求升级为五个入口：

- `选人`
- `排轴`
- `侧边栏`
- `角色配置`
- `全部显示`

当前旧的 `排轴` 实际等价于“全部显示”：同时显示 `SidePanel`、`CanvasArea`、`SkillSandbox`、`OperatorConfigPanel` 触发能力。

本轮要把显示模式拆开：

- 新 `排轴`：只显示画布和技能沙盒，其他区域留白或不显示。
- `侧边栏`：用于控制 `SidePanel` 显示/隐藏。
- `角色配置`：用于强制调出干员配置界面。
- `全部显示`：恢复旧排轴体验，全部模块打开。

本轮是工作台显示模式升级，不是缓存、Buff、伤害计算、数据层重构。

## [核心规则]

### 工作台入口规则

工作台抽屉水平标签从 2 个扩展为 5 个：

```text
选人 / 排轴 / 侧边栏 / 角色配置 / 全部显示
```

含义：

- `选人`：显示 `SelectionPanel`。
- `排轴`：显示排轴主工作区，但只显示 `CanvasArea + SkillSandbox`。
- `侧边栏`：在排轴工作区中控制 `SidePanel` 的显示与否。
- `角色配置`：在排轴工作区中强制打开 `OperatorConfigPanel`。
- `全部显示`：显示旧版完整排轴工作区，即 `SidePanel + CanvasArea + SkillSandbox`，并允许配置面板按现有逻辑打开。

### 排轴模式规则

新 `排轴` 不是旧 `CanvasBoard` 的完整展示。

新 `排轴` 只显示：

- `CanvasArea`
- `SkillSandbox`
- `DraggingOverlay`

新 `排轴` 不显示：

- `SidePanel`
- `OperatorConfigPanel`

说明：

- `CanvasArea` 和 `SkillSandbox` 保留原交互。
- `SidePanel` 不显示时，左侧位置可留白，或通过 CSS 保持布局稳定，但不能显示 `DamageTab`。
- `OperatorConfigPanel` 不自动显示。

### 侧边栏模式规则

`侧边栏` 入口用于控制 `SidePanel` 显示/隐藏。

规则：

- 点击 `侧边栏` 时，必须进入排轴工作区。
- 如果 `SidePanel` 当前隐藏，则显示。
- 如果 `SidePanel` 当前显示，则隐藏。
- 该入口是“开关行为”，不是进入单独页面。
- 但当技能按钮被双击打开时，必须强制显示 `SidePanel`，即使用户之前隐藏了侧边栏。

原因：

- 技能按钮弹窗打开后，用户需要从 `SidePanel.DamageTab` 添加 Buff。
- 如果 SidePanel 被隐藏，技能按钮弹窗的 Buff 添加主链路会断。

### 角色配置模式规则

`角色配置` 入口用于强制调出 `OperatorConfigPanel`。

规则：

- 点击 `角色配置` 时，必须进入排轴工作区。
- 必须打开 `OperatorConfigPanel`。
- 默认配置对象：
  - 优先使用当前已激活的配置干员。
  - 如果没有 activeConfigCharacterId，则使用 `selectedCharacters[0]?.id`。
  - 如果没有已选干员，则禁用该入口。
- `SkillSandbox` 中双击干员头像打开配置面板的原逻辑继续生效。
- `角色配置` 入口不能替代头像双击，只是新增强制入口。

### 全部显示规则

`全部显示` 等于旧排轴完整体验。

必须显示：

- `SidePanel`
- `CanvasArea`
- `SkillSandbox`
- `DraggingOverlay`

允许显示：

- `OperatorConfigPanel`，当用户通过 `角色配置` 入口或双击头像打开时显示。

说明：

- “全部显示”不是新页面。
- 它是排轴工作区的完整显示模式。
- 旧版 `排轴` 体验迁移到 `全部显示`。

## [实现建议]

### 必须新增显示模式类型

建议在 `WorkbenchFrame.tsx` 或独立类型文件中定义：

```ts
type WorkbenchMode =
  | 'selection'
  | 'timeline'
  | 'sidepanel'
  | 'operatorConfig'
  | 'all';
```

语义：

- `selection`：选人。
- `timeline`：新排轴，只显示画布和技能沙盒。
- `sidepanel`：排轴工作区 + 侧边栏开关操作。
- `operatorConfig`：排轴工作区 + 强制打开配置面板。
- `all`：旧排轴完整显示。

注意：

- 不要直接扩展 `AppState.currentView` 为五种状态，除非改动范围可控。
- 推荐保留 `currentView: 'selection' | 'canvas'`，新增 `WorkbenchFrame` 本地的 `workbenchMode` 控制显示模式。
- 进入任何非 `selection` 模式时，`currentView` 仍切到 `canvas`。

### WorkbenchFrame 应负责模式切换

修改文件：

- `src/components/WorkbenchFrame/WorkbenchFrame.tsx`

新增状态：

```ts
const [workbenchMode, setWorkbenchMode] = useState<WorkbenchMode>('selection');
```

切换规则：

- 点击 `选人`：
  - `setWorkbenchMode('selection')`
  - 清理当前技能按钮选择态
  - `dispatch({ type: 'SET_VIEW', view: 'selection' })`
  - 关闭抽屉

- 点击 `排轴`：
  - 要求已选干员数 > 0
  - `setWorkbenchMode('timeline')`
  - `dispatch({ type: 'SET_VIEW', view: 'canvas' })`
  - 关闭抽屉

- 点击 `侧边栏`：
  - 要求已选干员数 > 0
  - `setWorkbenchMode('sidepanel')`
  - `dispatch({ type: 'SET_VIEW', view: 'canvas' })`
  - 切换 `SidePanel` 显示状态
  - 关闭抽屉

- 点击 `角色配置`：
  - 要求已选干员数 > 0
  - `setWorkbenchMode('operatorConfig')`
  - `dispatch({ type: 'SET_VIEW', view: 'canvas' })`
  - 通知 `CanvasBoard` 打开配置面板
  - 关闭抽屉

- 点击 `全部显示`：
  - 要求已选干员数 > 0
  - `setWorkbenchMode('all')`
  - `dispatch({ type: 'SET_VIEW', view: 'canvas' })`
  - 显示 `SidePanel`
  - 关闭抽屉

### CanvasBoard 必须接收显示控制 props

修改文件：

- `src/components/CanvasBoard/index.tsx`

建议新增 props：

```ts
interface CanvasBoardProps {
  workbenchMode?: 'timeline' | 'sidepanel' | 'operatorConfig' | 'all';
  isSidePanelVisible?: boolean;
  forceOpenOperatorConfig?: boolean;
  onSkillButtonModalOpen?: () => void;
}
```

实际可以按实现调整，但必须满足：

- `CanvasBoard` 不再无条件显示 `SidePanel`。
- `CanvasBoard` 能根据工作台模式显示/隐藏 `SidePanel`。
- `CanvasBoard` 能响应 `角色配置` 模式强制打开 `OperatorConfigPanel`。
- `CanvasBoard` 能在技能按钮双击打开后强制显示 `SidePanel`。

### SidePanel 显示条件

在 `CanvasBoard` 中把当前：

```tsx
<SidePanel widthPercent={15} />
```

改为条件渲染：

```tsx
{shouldShowSidePanel && <SidePanel widthPercent={15} />}
```

`shouldShowSidePanel` 必须满足：

- `workbenchMode === 'all'` 时为 true。
- `sidePanelVisible === true` 时为 true。
- 技能按钮弹窗打开时强制为 true。
- `workbenchMode === 'timeline'` 且未触发强制显示时为 false。

### 技能按钮双击后强制显示 SidePanel

涉及文件：

- `src/components/CanvasBoard/SkillButton.tsx`
- `src/components/CanvasBoard/components/CanvasArea.tsx`
- `src/components/CanvasBoard/index.tsx`

当前技能按钮弹窗打开逻辑在 `SkillButton.tsx` 内部。

必须新增向上通知：

- `SkillButtonComponent` 新增 prop：`onModalOpen?: () => void`
- 双击打开弹窗时调用 `onModalOpen?.()`
- `CanvasArea` 接收 `onSkillButtonModalOpen` 并传给 `SkillButtonComponent`
- `CanvasBoard` 实现 `handleSkillButtonModalOpen`：
  - 强制 `SidePanel` 显示

这样满足：

- 用户双击技能按钮打开技能弹窗后，`SidePanel` 必须显示。
- Buff 添加链路不被隐藏侧边栏破坏。

### 角色配置强制打开

修改文件：

- `src/components/CanvasBoard/index.tsx`
- `src/components/WorkbenchFrame/WorkbenchFrame.tsx`

实现要求：

- `WorkbenchFrame` 点击 `角色配置` 后，传递一个强制打开信号给 `CanvasBoard`。
- `CanvasBoard` 接收到后：
  - `setIsConfigPanelOpen(true)`
  - `setActiveConfigCharacterId(prev => prev ?? selectedCharacters[0]?.id ?? null)`

注意：

- 不要删除 `SkillSandbox` 头像双击打开配置面板的逻辑。
- 两个入口必须同时有效。

## [TODO 列表]

### 必须改

1. 修改 `src/components/WorkbenchFrame/WorkbenchFrame.tsx`

   - 将抽屉标签扩展为 5 个：`选人 / 排轴 / 侧边栏 / 角色配置 / 全部显示`。
   - 新增本地 `workbenchMode`。
   - 新增 `isSidePanelVisible` 或等价状态。
   - 新增 `forceOpenOperatorConfig` 或等价触发信号。
   - 非选人入口必须要求 `selectedCharacters.length > 0`。
   - 抽屉仍为顶部下滑，水平标签。

2. 修改 `src/components/WorkbenchFrame/WorkbenchFrame.css`

   - 支持 5 个水平标签。
   - 保持灰底、黑框、黑字、直角、hover 灰字黄底。
   - 禁用态必须可见。
   - 不要改成侧栏、纵向菜单或深色顶部栏。

3. 修改 `src/components/CanvasBoard/index.tsx`

   - 增加 props 接收工作台显示模式。
   - 条件渲染 `SidePanel`。
   - 支持 `角色配置` 入口强制打开配置面板。
   - 支持技能按钮弹窗打开后强制显示 `SidePanel`。
   - `全部显示` 模式必须恢复旧完整排轴体验。

4. 修改 `src/components/CanvasBoard/components/CanvasArea.tsx`

   - 新增 `onSkillButtonModalOpen?: () => void` prop。
   - 传给 `SkillButtonComponent`。

5. 修改 `src/components/CanvasBoard/SkillButton.tsx`

   - 新增 `onModalOpen?: () => void` prop。
   - 双击打开技能弹窗时调用 `onModalOpen?.()`。
   - 不要改变双击打开弹窗的原有逻辑。

### 可选优化

1. 触发区显示当前工作台模式名称。
2. `侧边栏` 标签显示当前状态：`已显示` / `已隐藏`。
3. `角色配置` 标签在未选干员时显示禁用原因。

### 不要动

1. 不要改 `SidePanel` 内部逻辑。
2. 不要改 `DamageTab`。
3. 不要改 `OperatorConfigPanel` 内部逻辑。
4. 不要改 Buff 添加、删除、拖拽、详情逻辑。
5. 不要改缓存 key。
6. 不要改伤害计算。
7. 不要引入路由。
8. 不要把 `SidePanel` 移入工作台抽屉。
9. 不要把 `OperatorConfigPanel` 移入工作台抽屉。

## [验收标准 AC]

### AC1：工作台抽屉入口正确

- 抽屉内显示 5 个水平标签：
  - `选人`
  - `排轴`
  - `侧边栏`
  - `角色配置`
  - `全部显示`
- 未选择干员时，除 `选人` 外，其余入口不可进入或明确禁用。
- 抽屉仍从顶部下滑。
- CSS 仍是灰底、黑框、黑字、直角、hover 灰字黄底。

### AC2：选人模式正确

- 点击 `选人` 显示 `SelectionPanel`。
- 切回选人时清理当前技能按钮选择态。
- 原“开始排轴”按钮仍有效。

### AC3：排轴模式正确

- 点击 `排轴` 后进入排轴工作区。
- 只显示 `CanvasArea + SkillSandbox + DraggingOverlay`。
- 不显示 `SidePanel`。
- 不自动打开 `OperatorConfigPanel`。

### AC4：侧边栏模式正确

- 点击 `侧边栏` 可控制 `SidePanel` 显示/隐藏。
- 隐藏 `SidePanel` 后，画布和技能沙盒仍可用。
- 双击技能按钮打开弹窗后，必须强制显示 `SidePanel`。

### AC5：角色配置模式正确

- 点击 `角色配置` 后进入排轴工作区。
- `OperatorConfigPanel` 强制打开。
- 默认配置对象是当前 active 干员或第一个已选干员。
- 双击 `SkillSandbox` 头像仍能打开配置面板。

### AC6：全部显示模式正确

- 点击 `全部显示` 后进入完整排轴工作区。
- 显示 `SidePanel`。
- 显示 `CanvasArea`。
- 显示 `SkillSandbox`。
- 技能按钮、Buff、配置面板全部按旧排轴体验工作。

### AC7：业务功能不回退

- 从 `SkillSandbox` 拖技能到画布仍有效。
- 技能按钮移动仍有效。
- 技能按钮双击弹窗仍有效。
- Buff 单击添加仍有效。
- Buff 长按拖拽添加仍有效。
- 已选 Buff 删除仍有效。
- 干员配置面板的武器、技能等级、装备输入仍有效。

### AC8：构建通过

- `npm run build` 必须通过。

## [回归检查项]

1. 初始进入应用，确认默认仍是选人。
2. 打开工作台抽屉，确认有 5 个水平标签。
3. 未选干员时，确认 `排轴 / 侧边栏 / 角色配置 / 全部显示` 不可进入。
4. 选择干员后点击 `排轴`，确认只显示画布和技能沙盒。
5. 点击 `侧边栏`，确认 SidePanel 可显示；再次点击确认可隐藏。
6. 在 SidePanel 隐藏状态下双击技能按钮，确认 SidePanel 强制显示。
7. 点击 `角色配置`，确认配置面板打开。
8. 双击技能沙盒头像，确认配置面板仍打开。
9. 点击 `全部显示`，确认恢复旧排轴完整显示。
10. 在全部显示模式下添加 Buff，确认 Buff 添加、保存、重开弹窗不回退。
11. 执行 `npm run build`。

## [给 Trae 的执行指令]

本轮目标是把工作台抽屉从 2 个入口升级为 5 个显示模式入口。

优先顺序：

1. 先改 `WorkbenchFrame` 的 5 标签与模式状态。
2. 再改 `CanvasBoard` 的 `SidePanel` / `OperatorConfigPanel` 受控显示。
3. 再打通 `SkillButton` 双击弹窗向上通知，强制显示 `SidePanel`。
4. 最后做构建和回归。

禁止改业务内部逻辑。只做显示模式控制和必要的事件上报。
