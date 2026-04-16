# review-todo0.4.4

[任务理解]
- 当前目标不是继续重构 storage 方案，而是修正 `review-todo0.4.3` 后遗留的两个关键问题，确保“技能按钮弹窗-伤害/信息”相关链路稳定可用。
- 这轮的重点是把 `OperatorConfigPanel -> storage -> SkillButton` 这条读取/写入链路统一起来，消除异步写入时序问题和错误的 session 初始化路径。

[约束]
- 技术约束
  - 继续沿用当前 v3 三段存储方案，不回退结构。
  - 本轮只做最小修复，不做新的大规模架构调整。
  - 必须兼容当前 `SkillButton` 通过 `getCharacterConfig()` 读取旧结构兼容层的方式。
- 不可破坏部分
  - `OperatorConfigPanel` 现有角色配置编辑逻辑不能破坏。
  - `SkillButton` 弹窗的伤害区、信息区不能再次出现空数据。
  - 刷新页面后重新打开弹窗，数据必须还能恢复。
- 风格/架构要求
  - 不允许同一条持久化链路里混用“同步写 input + 异步补写 computed/display”。
  - 组件内部如果需要从 storage 恢复旧结构，必须统一走 `storage.ts` 的兼容层，不允许手工只从 input map 拼装。

[TODO 列表]
1. 修改 `src/components/CanvasBoard/components/OperatorConfigPanel.tsx` 中的 `writeCharacterConfigMapToSession`，去掉对 `setCharacterComputedMap`、`setCharacterDisplayCacheMap` 的动态 `import(...).then(...)` 写法，改为静态导入后同步写入。
2. 确保 `writeCharacterConfigMapToSession` 在同一轮调用中完整写入：
   - `character-input-map.v3`
   - `character-computed-map.v3`
   - `character-display-cache.v3`
   不允许先写 input、后异步补写 computed/display。
3. 修改 `src/components/CanvasBoard/components/OperatorConfigPanel.tsx` 中的 `readCharacterConfigMapFromSession()`，不要再只调用 `getCharacterInputMap()` 然后手工填默认空值；改为直接调用 `src/utils/storage.ts` 提供的 `getCharacterConfigMap()`。
4. 检查 `OperatorConfigPanel.tsx` 内所有“初始化 characterConfigMap”的入口，确保不会再通过“只读 input map”的旧路径恢复状态。
5. 复测 `src/components/CanvasBoard/SkillButton.tsx` 依赖的以下字段在页面刷新后仍可读取：
   - `panelSnapshot`
   - `infoSnap`
   - `infoSnapshot`
   - `weaponBuffSnapshot`
6. 跑构建并确认不再出现 `storage.ts` 被同时静态导入和动态导入的 Vite 警告。

[验收标准 AC]
- AC1: `OperatorConfigPanel.tsx` 中不再存在对 `setCharacterComputedMap` / `setCharacterDisplayCacheMap` 的动态导入写法。
- AC2: `readCharacterConfigMapFromSession()` 不再只基于 `getCharacterInputMap()` 手工拼旧结构，而是统一走 `getCharacterConfigMap()`。
- AC3: 双击技能按钮时，“伤害”区域能稳定显示，不再出现“加载面板数据...”长期不消失的情况。
- AC4: 双击技能按钮时，“信息”区域能稳定显示，不再出现“暂无信息快照”的错误空态。
- AC5: 刷新页面后重新进入画布并再次打开技能按钮弹窗，伤害和信息仍能恢复。
- AC6: `npm run build` 通过，且构建输出不再包含 `storage.ts` 被同时动态/静态导入的警告。

[给 Cursor 的执行指令]
- 需要修改的文件
  - `src/components/CanvasBoard/components/OperatorConfigPanel.tsx`
  - 如有必要，只允许辅助检查 `src/utils/storage.ts`
- 实现顺序
  1. 先改 `OperatorConfigPanel.tsx` 的 storage 写入逻辑
  2. 再改 `readCharacterConfigMapFromSession()` 的读取入口
  3. 全文件搜索确认没有残留动态导入 `storage.ts`
  4. 跑 `npm run build`
  5. 手动复测技能按钮弹窗
- 必须实现的逻辑
  - 三段存储同步写入
  - 初始化统一通过兼容层恢复完整旧结构
  - 修复弹窗“伤害/信息”数据丢失问题
- 不能动的部分
  - 不要改 `SkillButton.tsx` 的业务逻辑
  - 不要继续扩大到 v4 结构重构
  - 不要新增 migration 或双轨兼容方案
- 测试要求
  - 手动验证：配置角色后打开技能按钮弹窗，伤害区正常
  - 手动验证：信息区正常显示 `infoSnapshot`
  - 手动验证：刷新页面后再次打开弹窗仍正常
  - 执行 `npm run build`
