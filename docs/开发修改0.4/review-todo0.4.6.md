# review-todo0.4.6

[任务理解]
- 当前技能按钮在主界面上通过右键就能直接删除，误触成本太低。
- 目标是新增一个“纯交互层”的锁定能力：在技能按钮弹窗里加一个小锁定开关；锁定后，该技能按钮在主界面上不能被右键删除；解锁后恢复原行为。

[约束]
- 技术约束
  - 这是纯交互层改动，只影响前端运行时行为。
  - 不允许把“锁定”写入 `sessionStorage`、timeline 持久化结构或角色配置 storage。
  - 不允许改动现有 Buff、伤害计算、技能信息弹窗逻辑。
- 不可破坏部分
  - 未锁定的技能按钮仍然可以右键删除。
  - 锁定后仍然可以正常拖拽、双击打开弹窗、查看伤害和信息。
  - 右键删除技能按钮时原有 `timelineData` 移除逻辑不能被破坏。
- 风格/架构要求
  - 锁定状态必须能被主界面的右键删除入口读取到，因此不能只放在 `SkillButton.tsx` 局部 state。
  - 锁定状态只允许存在于运行时的 `skillButtons` 状态层，不进入持久化结构。
  - 弹窗里的锁定 UI 和主界面删除拦截必须共享同一个状态源。

[TODO 列表]
1. 在 `src/types/index.ts` 的 `SkillButton` 类型中新增运行时字段，例如 `isLocked?: boolean`，明确该字段只用于前端交互层，不进入 timeline 持久化结构。
2. 在 `src/context/AppContext.tsx` 中新增一个专门切换技能按钮锁定状态的 action，例如：
   - `TOGGLE_SKILL_BUTTON_LOCK`
   或
   - `SET_SKILL_BUTTON_LOCK`
   并在 reducer 中只更新 `state.skillButtons` 对应按钮的 `isLocked`。
3. 检查技能按钮创建入口，确保新建按钮默认是未锁定状态；如按钮对象在创建时未显式赋值，也要保证读取处按 `false` 处理。
4. 修改 `src/components/CanvasBoard/SkillButton.tsx`，在技能弹窗中加入一个小型锁定 UI：
   - 可放在弹窗标题区或按钮区
   - 能清晰表达“已锁定 / 未锁定”
   - 点击后切换当前按钮的锁定状态
5. `SkillButton.tsx` 中的锁定 UI 不允许只改本地 state，必须通过 `AppContext` 的 action 更新全局 `skillButtons` 中该按钮的锁定状态。
6. 修改 `src/components/CanvasBoard/index.tsx` 中的 `handleButtonContextMenu`，在执行删除前先检查目标按钮的 `isLocked`：
   - 若已锁定，则阻止删除
   - 若未锁定，则继续走原有删除流程
7. 为锁定态补充最小可用 UI 反馈，至少满足其一：
   - 弹窗中锁定控件有明显状态变化
   - 主界面技能按钮本体有轻量锁定标识
   但不要做重设计，只做小改动。
8. 检查 `useTimelineData`、`SkillButtonData`、任何 sessionStorage / timeline 保存逻辑，确保没有把 `isLocked` 混进持久化数据。
9. 跑构建，并手动验证“锁定后右键无效、解锁后右键恢复、刷新页面后锁定状态不保留”这三条行为。

[验收标准 AC]
- AC1: 技能按钮弹窗中存在可用的锁定开关，且能切换当前按钮的锁定状态。
- AC2: 未锁定技能按钮在主界面右键后，仍按原逻辑被删除。
- AC3: 已锁定技能按钮在主界面右键后，不会被删除，也不会误删 timeline 对应节点数据。
- AC4: 锁定状态不会影响拖拽、双击打开弹窗、Buff 查看、伤害/信息查看。
- AC5: 锁定状态不会写入 `sessionStorage`、timeline 数据或其他持久化结构；刷新页面后恢复为未锁定。
- AC6: `npm run build` 通过。

[给 Cursor 的执行指令]
- 需要修改的文件（如果已知）
  - `src/types/index.ts`
  - `src/context/AppContext.tsx`
  - `src/components/CanvasBoard/SkillButton.tsx`
  - `src/components/CanvasBoard/index.tsx`
  - 如需样式反馈，只允许修改 `src/components/CanvasBoard/SkillButton.css`
- 实现顺序
  1. 先补 `SkillButton` 运行时类型
  2. 再补 `AppContext` action 和 reducer
  3. 然后接 `SkillButton.tsx` 弹窗锁定 UI
  4. 最后在 `CanvasBoard.tsx` 的右键删除入口做拦截
  5. 全局检查持久化路径，确认 `isLocked` 没有混进 storage/timeline
  6. 跑构建并手测
- 必须实现的逻辑
  - 锁定状态来自全局 `skillButtons`
  - 右键删除前检查 `isLocked`
  - 锁定只影响删除，不影响其他交互
  - 刷新后锁定状态不保留
- 不能动的部分
  - 不要修改 `SkillButtonData` 持久化结构
  - 不要把锁定写入 `useTimelineData`
  - 不要重做技能弹窗整体布局
  - 不要把“锁定”扩展成 Buff 或伤害层逻辑
- 测试要求
  - 手测未锁定时右键删除正常
  - 手测锁定后右键删除无效
  - 手测解锁后右键删除恢复
  - 手测锁定状态下仍可双击开弹窗、拖拽按钮
  - 手测刷新页面后锁定状态消失
  - 执行 `npm run build`
