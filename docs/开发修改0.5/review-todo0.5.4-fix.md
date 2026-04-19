# review-todo0.5.4-fix：顶部下滑工作台抽屉

## [Review 结论]

0.5.4 当前 `WorkbenchFrame` 方向正确，但交互形态需要修正。

正确目标不是左侧抽屉，也不是固定顶部 tab，而是“顶部下滑工作台抽屉”：

- 顶部只保留一个工作台触发区。
- 点击后从顶部向下滑出抽屉。
- 抽屉覆盖在当前界面上方，不挤占 `SelectionPanel` / `CanvasBoard` 的页面高度。
- 抽屉内部使用水平标签选项：`选人`、`排轴`。
- 抽屉只负责流程切换，不介入选人、排轴、Buff、配置、伤害计算。
- CSS 必须贴合现有项目风格：灰底、黑框、黑字、直角、hover 灰字黄底。

本补丁只允许修改：

- `src/components/WorkbenchFrame/WorkbenchFrame.tsx`
- `src/components/WorkbenchFrame/WorkbenchFrame.css`

## [现有风格基准]

Trae 必须参考现有样式，不要自行发明新视觉体系。

参考文件：

- `src/styles/global.css`
- `src/components/SidePanel/SidePanel.css`
- `src/components/SelectionPanel/SelectionPanel.css`

必须沿用的风格规则：

- 页面底色：`#F0F0F0` 或 `var(--bg-primary)`。
- 文字：黑字 `#000`。
- 边框：黑色硬边框，优先使用 `var(--border-width) solid var(--border-color)`。
- 直角：`border-radius: 0`。
- hover：文字变灰 `#555555`，背景变黄色或半透明黄。
- 可使用现有 `SidePanel` 的黄底斜切效果，但不要强制；普通黄底也可以。
- 不要使用紫色、蓝色、柔和阴影、圆角卡片、SaaS 风。

参考 `SidePanel` hover 逻辑：

```css
.side-panel-tab:hover {
  background: transparent;
  color: #555555;
}

.side-panel-tab:hover::after {
  background: rgba(255, 255, 0, 0.5);
  transform: translate(-50%, -50%) skewX(-20deg);
}
```

## [问题列表]

### P1：当前顶部普通 tab 形态错误

文件：

- `src/components/WorkbenchFrame/WorkbenchFrame.tsx`
- `src/components/WorkbenchFrame/WorkbenchFrame.css`

现状：

- 顶部直接平铺 `选人 / 排轴` 两个按钮。
- 顶部栏本身挤占了业务页面高度。
- 视觉使用深色头部，不符合当前灰底黑框黑字的项目风格。

问题：

- 用户要的是顶部下滑抽屉，不是固定 tab。
- 抽屉应该覆盖页面，不应改变 `SelectionPanel` / `CanvasBoard` 原有布局高度。
- 深色 header 与现有 SidePanel、选人页的灰底黑字风格不一致。

修正方向：

- 顶部触发区保持灰底黑框黑字。
- 点击触发区后，从顶部向下滑出抽屉面板。
- 抽屉使用 `position: fixed` 或等价方式覆盖内容，不参与文档流，不挤占高度。
- 抽屉内用水平标签选项展示 `选人 / 排轴`。

### P1：切回选人必须补齐清理语义

文件：

- `src/components/WorkbenchFrame/WorkbenchFrame.tsx`

问题：

- 当前顶部切换到 `selection` 只 dispatch `SET_VIEW selection`。
- 这绕过了 `CanvasBoard.handleBack()` 里的当前技能按钮选择态清理。
- 如果技能按钮弹窗打开后直接从工作台抽屉切回选人，后续可能残留旧 `selectedSkillButton`。

修正方向：

- 封装 `switchWorkbenchView(view)`。
- 切到 `selection` 时执行：

```ts
dispatch({ type: 'SELECT_SKILL_BUTTON', buttonId: null });
setSelectedSkillButton(null);
dispatch({ type: 'SET_VIEW', view: 'selection' });
```

- 切到 `canvas` 时：

```ts
if (selectedCharacters.length === 0) return;
dispatch({ type: 'SET_VIEW', view: 'canvas' });
```

### P2：抽屉不应造成 `100vh + header` 裁切

文件：

- `src/components/WorkbenchFrame/WorkbenchFrame.css`

问题：

- `SelectionPanel` 与 `CanvasBoard` 根节点目前都有 `min-height: 100vh`。
- 如果顶部工作台栏仍占据文档流高度，会产生页面裁切。

修正方向：

- 工作台触发区可以是固定悬浮层，或非常薄的覆盖层。
- 下滑抽屉必须覆盖内容，不占用内容区高度。
- 如果保留一个极薄顶部触发条，也必须确认不裁切底部内容。

建议 CSS：

```css
.workbench-frame {
  position: relative;
  min-height: 100vh;
  background: var(--bg-primary);
}

.workbench-content {
  min-height: 100vh;
}

.workbench-top-trigger {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 3000;
}

.workbench-drawer-overlay {
  position: fixed;
  inset: 0;
  z-index: 2990;
}

.workbench-drawer {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 3010;
}
```

## [给 Trae 的修正 TODO]

### 必须改

1. 修改 `WorkbenchFrame.tsx` 的结构

   删除当前普通顶部 tab 平铺结构：

   - `.workbench-header`
   - `.workbench-tabs`
   - `.workbench-tab`

   改为：

   - 一个顶部工作台触发按钮/触发条。
   - 一个顶部下滑抽屉。
   - 抽屉内两个水平选项：`选人`、`排轴`。

2. 新增抽屉状态

   在 `WorkbenchFrame.tsx` 中增加：

   ```ts
   const [isDrawerOpen, setIsDrawerOpen] = useState(false);
   ```

   行为：

   - 点击触发区：打开/关闭抽屉。
   - 点击遮罩：关闭抽屉。
   - 点击抽屉选项：切换流程并关闭抽屉。
   - 点击抽屉内部不要误触发遮罩关闭。

3. 水平标签选项

   抽屉内部必须是水平排列：

   - `选人`
   - `排轴`

   不要做成左侧列表。
   不要做成纵向菜单。
   不要做成侧边栏。

4. 切换规则

   `选人`：

   - 随时可点击。
   - 点击后清理当前技能按钮选择态。
   - 切到 `selection`。
   - 关闭抽屉。

   `排轴`：

   - `selectedCharacters.length > 0` 时可点击。
   - 未选择干员时禁用。
   - 可点击时切到 `canvas`。
   - 关闭抽屉。

5. 清理当前技能按钮选择态

   在 `WorkbenchFrame.tsx` 引入：

   ```ts
   import { setSelectedSkillButton } from '../../hooks/useSkillButtonBuffs';
   ```

   切到 `selection` 时必须执行：

   ```ts
   dispatch({ type: 'SELECT_SKILL_BUTTON', buttonId: null });
   setSelectedSkillButton(null);
   ```

6. CSS 改成顶部下滑抽屉

   `WorkbenchFrame.css` 必须新增或调整这些类：

   - `.workbench-frame`
   - `.workbench-content`
   - `.workbench-top-trigger`
   - `.workbench-top-summary`
   - `.workbench-drawer-overlay`
   - `.workbench-drawer`
   - `.workbench-drawer-tabs`
   - `.workbench-drawer-tab`
   - `.workbench-drawer-tab.is-active`
   - `.workbench-drawer-tab:disabled`

7. CSS 风格必须匹配原项目

   推荐基础样式：

   ```css
   .workbench-top-trigger {
     background: var(--bg-primary);
     color: #000;
     border: var(--border-width) solid var(--border-color);
     border-radius: 0;
   }

   .workbench-drawer {
     background: var(--bg-primary);
     color: #000;
     border-bottom: var(--border-width) solid var(--border-color);
     border-radius: 0;
   }

   .workbench-drawer-tab {
     position: relative;
     background: transparent;
     color: #000;
     border: var(--border-width) solid var(--border-color);
     border-radius: 0;
   }

   .workbench-drawer-tab:hover:not(:disabled) {
     background: rgba(255, 255, 0, 0.5);
     color: #555555;
   }

   .workbench-drawer-tab.is-active {
     background: rgba(255, 255, 0, 0.8);
     color: #000;
   }
   ```

   如使用斜切黄底，参考 `SidePanel.css` 的 `::after + skewX(-20deg)`。

### 可选优化

1. 抽屉打开/关闭可有短动画：

   - `transform: translateY(-100%) -> translateY(0)`
   - 动画时间控制在 `160ms ~ 220ms`

2. 顶部触发区显示：

   - 当前：`选人` / `排轴`
   - 已选：`X/4`

3. 支持 `Escape` 关闭抽屉。

### 不要动

1. 不要改 `SelectionPanel`。
2. 不要改 `CanvasBoard`。
3. 不要改 `SidePanel`。
4. 不要改 `DamageTab`。
5. 不要改 `OperatorConfigPanel`。
6. 不要改 `SkillButton`。
7. 不要改 Buff 添加、删除、拖拽、详情逻辑。
8. 不要改 sessionStorage key。
9. 不要引入 `react-router-dom`。
10. 不要做左侧抽屉。
11. 不要做纵向菜单。
12. 不要做深色顶部栏。
13. 不要使用圆角卡片、柔和阴影、紫色主视觉。

## [验收标准 AC]

### AC1：顶部下滑抽屉形态正确

- 页面顶部有工作台触发区。
- 点击后抽屉从顶部向下出现。
- 抽屉覆盖当前页面，不挤占 `SelectionPanel` / `CanvasBoard` 高度。
- 抽屉内部是水平标签选项，不是侧栏列表。

### AC2：CSS 风格正确

- 灰底。
- 黑框。
- 黑字。
- 直角。
- hover 灰字黄底。
- 不出现深色 header。
- 不出现圆角 SaaS 卡片风。

### AC3：抽屉交互正确

- 点击触发区可打开/关闭抽屉。
- 点击遮罩可关闭抽屉。
- 点击抽屉内部不误关闭。
- 点击 `选人` / `排轴` 后切换并关闭抽屉。

### AC4：流程切换正确

- 初始仍显示选人。
- 未选干员时 `排轴` 禁用或不可进入。
- 已选干员后可从抽屉进入排轴。
- 从抽屉切回选人时清理当前技能按钮选择态。
- `SelectionPanel` 的“开始排轴”仍有效。
- `CanvasBoard` 的返回按钮仍有效。

### AC5：业务交互不回退

- 技能从 `SkillSandbox` 拖到画布仍有效。
- 技能按钮移动仍有效。
- 技能按钮右键删除和锁定仍有效。
- 技能按钮双击弹窗仍有效。
- Buff 单击添加、双击详情、长按拖拽添加仍有效。
- 干员头像双击打开配置面板仍有效。

### AC6：构建通过

- `npm run build` 必须通过。

## [回归检查项]

1. 初始进入应用，确认显示选人界面。
2. 点击顶部工作台触发区，确认顶部下滑抽屉出现。
3. 确认抽屉为灰底黑框黑字直角，hover 为灰字黄底。
4. 未选干员时确认 `排轴` 不可进入。
5. 选择干员后，从抽屉点击 `排轴`，确认进入排轴且抽屉关闭。
6. 从抽屉点击 `选人`，确认回到选人且抽屉关闭。
7. 打开技能按钮弹窗后，从抽屉切回选人，再回排轴，确认不会把 Buff 加到旧按钮。
8. 检查选人页底部按钮不被抽屉或触发区挤压裁切。
9. 检查排轴画布、SidePanel、SkillSandbox 不被抽屉常态挤压。
10. 执行 `npm run build`。

## [给 Trae 的执行指令]

只修改 `WorkbenchFrame.tsx` 和 `WorkbenchFrame.css`。

目标是把 0.5.4 的普通顶部 tab 改成“顶部下滑抽屉 + 水平标签选项”。抽屉必须覆盖界面，不挤占页面高度。CSS 必须贴近现有 `SidePanel.css` 风格：灰底、黑框、黑字、直角、hover 灰字黄底。

禁止改业务组件，禁止做侧边抽屉，禁止做纵向菜单，禁止做深色顶部栏。
