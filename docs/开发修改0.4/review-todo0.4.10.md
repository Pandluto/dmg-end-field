# review-todo0.4.10

[任务理解]
- 当前目标不是继续补零散字段，而是把 `review-todo0.4.8.md` 里真正没落实的主链路收口。
- 这轮重点是三件事：明确唯一持久化真相、补页面刷新恢复链路、修按钮移动时 Buff 关联丢失的问题。

[约束]
- 技术约束
  - 不要再同时推进“大重构 + 小修 bug”。
  - 先解决缓存主链路，再做附加优化。
  - 本轮默认继续以 `sessionStorage` 为持久化介质。
- 不可破坏部分
  - 已经单独修好的“武器 Buff 能显示”不要回退。
  - `SkillButton` 弹窗中的伤害、信息、已选 Buff 基本功能不能再被打断。
  - 当前画布按钮的放置、拖拽、删除、双击弹窗行为不能被破坏。
- 风格/架构要求
  - 必须明确“技能按钮 + 已选 Buff”的唯一持久化真相。
  - 禁止继续维持半成品结构：
    - 只写不读
    - 只读不写
    - 运行时一套、缓存一套、旧 map 再一套
  - 不要再额外引入新的事件总线方案。

[TODO 列表]
1. 明确并落实唯一持久化真相：决定 `技能按钮 + 已选 Buff` 的唯一持久化来源是否为 `timelineData`；如果是，旧的 `skill-button-buffs` 必须退化为兼容层或停止作为主真相参与读写判断。
2. 修改 `src/components/CanvasBoard/index.tsx` 和相关恢复入口，在进入画布时把持久化中的按钮数据恢复到 `AppContext.skillButtons`，让页面刷新后按钮能够重新渲染出来。
3. 修改 `src/hooks/useTimelineData.ts` 和 `src/components/CanvasBoard/hooks/useCanvasDrag.ts`，让已有按钮移动时走“更新位置”而不是“删旧建新”，保留原按钮 ID 和原有 Buff 关联。
4. 修改 `src/components/CanvasBoard/SkillButton.tsx` 与 `src/hooks/useSkillButtonBuffs.ts`，统一 Buff 的读取、添加、删除路径，不能再出现“显示读一套、删除判断看另一套”的情况。
5. 在唯一数据源落实后，检查自动保存覆盖面，确保以下操作都会落到同一套持久化逻辑：
   - 拖动并放置按钮
   - 移动已有按钮
   - 删除按钮
   - 添加 Buff
   - 删除 Buff
6. 清理残留的半成品结构和旁路逻辑，重点检查：
   - 未接通的 `buffRegistry`
   - 未稳定使用的 `selectedBuffList`
   - 旧 `skill-button-buffs` map 的直接判断逻辑
7. 跑构建并手动验证完整链路：
   - 刷新页面后按钮恢复
   - 刷新页面后按钮 Buff 恢复
   - 移动按钮后 Buff 不丢
   - 添加/删除 Buff 正常

[验收标准 AC]
- AC1: 明确并落实唯一持久化数据源，不再长期并存两套真相。
- AC2: 刷新页面后，技能按钮能恢复到画布上。
- AC3: 刷新页面后，技能按钮对应的已选 Buff 也能恢复。
- AC4: 移动已有按钮后，原已选 Buff 不丢失。
- AC5: `SkillButton` 的 Buff 添加、显示、删除全部走同一份数据。
- AC6: 自动保存覆盖“放置、移动、删除按钮，添加、删除 Buff”这几类操作。
- AC7: `npm run build` 通过。

[给 Cursor 的执行指令]
- 需要修改的文件（如果已知）
  - `src/hooks/useTimelineData.ts`
  - `src/components/CanvasBoard/index.tsx`
  - `src/components/CanvasBoard/hooks/useCanvasDrag.ts`
  - `src/components/CanvasBoard/SkillButton.tsx`
  - `src/hooks/useSkillButtonBuffs.ts`
- 实现顺序
  1. 先确定唯一持久化真相
  2. 再补刷新恢复链路
  3. 再修按钮移动逻辑
  4. 再统一 Buff 的读写删路径
  5. 最后检查自动保存覆盖面并清理残留旁路
  6. 跑构建和手测
- 必须实现的逻辑
  - `timelineData -> AppContext.skillButtons` 恢复链路
  - 按钮移动不丢 `selectedBuffList`
  - Buff 读取/添加/删除统一使用同一份数据
  - 自动保存覆盖关键操作
- 不能动的部分
  - 不要再改角色配置 storage 结构
  - 不要重新引入新的事件中转方案
  - 不要把这轮又扩展成整体架构翻新
- 测试要求
  - 手测刷新恢复按钮
  - 手测刷新恢复 Buff
  - 手测移动按钮后 Buff 不丢
  - 手测添加/删除 Buff 正常
  - 执行 `npm run build`
