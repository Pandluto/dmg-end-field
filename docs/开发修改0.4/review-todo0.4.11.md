# review-todo0.4.11

[任务理解]
- 当前这轮不是继续扩 Buff 架构，而是把上一轮修到一半的拖拽/恢复/保存主链路收口。
- 重点只剩 3 个必须继续修的点：
  - 去掉错误的手动保存
  - 修跨谱线移动后 Buff 关联丢失
  - 把 normalize 后的数据立即回写到 sessionStorage

[约束]
- 技术约束
  - 不继续改 `useSkillButtonBuffs.ts` 的整体架构。
  - 不新增新的 storage key。
  - 继续沿用当前 `timelineData` 结构，只修主链路 bug。
- 不可破坏部分
  - 第二个干员拖技能到谱线不能再崩。
  - 已修好的武器 Buff 显示不能回退。
  - 当前按钮恢复、锁定、右键删除、弹窗查看不能被破坏。
- 风格/架构要求
  - 自动保存只能保留一条链路，不能“debounce 保存”和“事件里手动保存”并存。
  - 跨线移动必须保留原按钮 `id` 和原有 `buffIds`。
  - 规范化旧缓存后，要立即回写修正结果，不允许继续把坏结构留在 storage。

[TODO 列表]
1. 修改 `src/components/CanvasBoard/hooks/useCanvasDrag.ts`，删除 `mouseup` 末尾对 `saveTimelineData()` 的手动调用。
   - 当前已经有 `useTimelineData.ts` 里的 debounce 自动保存。
   - 这里继续手动保存，会把旧 ref 数据写回 sessionStorage。
   - 本轮要求：只保留一条保存链路，禁止混用。

2. 修改 `src/components/CanvasBoard/hooks/useCanvasDrag.ts` 和 `src/hooks/useTimelineData.ts`，修复“跨谱线移动后 Buff 丢失”。
   - 当前跨线移动还是：
     - `removeTimelineButton(oldStaff, buttonId)`
     - `addTimelineButton(newStaff, buttonId)`
   - 这条链路没有把旧按钮的 `buffIds` 带过去。
   - 本轮要求：
     - 跨线移动必须保留原按钮 `id`
     - 跨线移动必须保留原按钮 `buffIds`
     - 不允许移动后按钮 Buff 清空
   - 可选实现方式二选一：
     - 方案 A：新增一个“跨 staff 移动按钮”的 timelineData 更新函数，直接搬整颗按钮对象
     - 方案 B：扩展 `addTimelineButton` 的入参，让它接收并写入 `buffIds`
   - 这轮优先推荐方案 A，因为更符合“移动按钮”语义。

3. 修改 `src/hooks/useTimelineData.ts` 的 `loadTimelineData()`，在 `normalizeTimelineData()` 后立即回写 storage。
   - 当前只是把修正后的数据塞进 React state。
   - 但旧 sessionStorage 里的坏结构仍然可能保留。
   - 本轮要求：
     - 如果 `parsed` 与 `normalized` 有结构差异，就立刻 `setStorageJson(...)` 回写
     - 确保下次进入页面时直接读到修正后的结构

4. 保持 `CanvasBoard/index.tsx` 当前的“只恢复一次”保护，不要回退这部分改动。
   - 这轮不要求继续重写恢复逻辑。
   - 只要求确认上面 1-3 的修复不会把恢复链路重新打坏。

5. 跑构建并手测以下链路：
   - 清空 sessionStorage 后：
     - 第一个干员拖技能到谱线成功
     - 第二个干员拖技能到谱线成功
   - 保留旧 sessionStorage 后：
     - 第二个干员拖技能到谱线不崩
   - 跨线移动后：
     - 按钮 ID 不变
     - 已选 Buff 不丢
   - 刷新后：
     - 按钮仍能恢复
     - 按钮 Buff 仍能恢复

[验收标准 AC]
- AC1: `useCanvasDrag.ts` 中不再保留 `mouseup` 末尾的手动 `saveTimelineData()`。
- AC2: 自动保存只由 `timelineData` 变化后的 debounce 统一处理。
- AC3: 跨谱线移动按钮后，原按钮 `id` 不变，原有 `buffIds` 不丢失。
- AC4: 第二个干员拖技能到谱线不再触发 `staffLine.buttons is not iterable`。
- AC5: `loadTimelineData()` 规范化旧数据后，会把修正后的结构立即写回 sessionStorage。
- AC6: 刷新后按钮和按钮 Buff 都能恢复。
- AC7: `npm run build` 通过。

[给 Cursor 的执行指令]
- 需要修改的文件（如果已知）
  - `src/components/CanvasBoard/hooks/useCanvasDrag.ts`
  - `src/hooks/useTimelineData.ts`
  - 如跨线移动需要单独新增 reducer 支持，可小幅检查 `src/context/AppContext.tsx`

- 实现顺序
  1. 先删 `useCanvasDrag.ts` 里的手动保存
  2. 再修跨线移动时 `buffIds` 保留
  3. 最后补 `loadTimelineData()` 的 normalize 回写
  4. 再跑构建和手测

- 必须实现的逻辑
  - 自动保存不能再混用两条链路
  - 跨线移动必须保留 `id + buffIds`
  - normalize 后必须立即回写 storage

- 不能动的部分
  - 不要再扩 `useSkillButtonBuffs.ts` 架构
  - 不要再改角色配置 storage
  - 不要回退武器 Buff 显示修复
  - 不要把这轮又扩成 0.4.8 的整套重构

- 测试要求
  - 执行 `npm run build`
  - 手测：
    1. 清空缓存后拖第一个干员技能
    2. 清空缓存后拖第二个干员技能
    3. 保留旧缓存后拖第二个干员技能
    4. 跨线移动后检查 Buff 是否还在
    5. 刷新后检查按钮和 Buff 是否恢复
