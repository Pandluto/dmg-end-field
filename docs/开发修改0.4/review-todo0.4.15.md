# review-todo0.4.15

[任务理解]
- 本轮只处理 `review-todo0.4.13` 剩余未落实问题。
- 已确认 0.4.14 的添加链路和 candidate key 修复不要回退。
- 本轮聚焦 3 个问题：
  - 删除整个技能按钮时遗留孤儿 Buff
  - `clearBuffs()` 清理顺序错误
  - 旧 `updateButtonBuffIds()` 仍可用 stale `timelineData.buffIds` 覆盖新主表

[Review 结论]
- 当前添加 Buff 主链路已基本恢复。
- 但缓存清理和旧同步覆盖还没有完全收口。
- `skill-button` 总表已经是 button 与 Buff 关联的主真相，任何从 `timelineData.buttons[].buffIds` 派生后再写回 `selectedBuff` 的逻辑，都必须删除或降级为只读兼容。

[问题列表]
1. P1: `removeSkillButton()` 删除按钮前没有读取 `selectedBuff`
   - 文件：`src/hooks/useTimelineData.ts`
   - 函数：`removeSkillButton`
   - 位置：约 `150-153` 行
   - 问题：
     - 当前先调用 `removeSkillButtonById(buttonId)` 删除 button。
     - 删除前没有保存该 button 的 `selectedBuff`。
     - 删除后无法知道哪些 Buff 需要做引用检查。
   - 影响：
     - 删除整个技能按钮后，`def.all-buff-list.v1` 会残留无引用 Buff 实体。
   - 修正要求：
     - 删除 button 前先读取 `getSkillButtonById(buttonId)`。
     - 保存旧 `selectedBuff`。
     - 删除 button 后，对旧 `selectedBuff` 逐个执行引用检查。
     - 对不再被任何 button 引用的 Buff 执行 `removeBuffById(buffId)`。

2. P2: `clearBuffs()` 仍先查引用后解绑
   - 文件：`src/hooks/useSkillButtonBuffs.ts`
   - 函数：`clearBuffs`
   - 位置：约 `173-190` 行
   - 问题：
     - 当前在 button 的 `selectedBuff` 仍存在时调用 `isBuffReferenced()`。
     - 当前 button 自己会让每个 Buff 被判断为仍被引用。
     - 随后才清空 `selectedBuff`，导致已无引用的 Buff 没被删除。
   - 影响：
     - 清空按钮 Buff 后，`def.all-buff-list.v1` 会残留孤儿 Buff。
   - 修正要求：
     - 先保存旧 `selectedBuff`。
     - 先将当前 button 的 `selectedBuff` 写回为空数组。
     - 再对旧 buffIds 执行 `isBuffReferenced()`。
     - 对无引用 Buff 执行 `removeBuffById(buffId)`。
     - 同步清理 `buffCache`。

3. P1: `updateButtonBuffIds()` 仍会用旧 timeline 来源覆盖新主表
   - 文件：`src/hooks/useTimelineData.ts`
   - 函数：`updateButtonBuffIds`
   - 位置：约 `306-324` 行
   - 问题：
     - 函数虽标记 deprecated，但仍调用 `updateSelectedBuffList()`。
     - 现有调用方仍可能从 `timelineData.staffLines[].buttons[].buffIds` 组装列表。
     - 这会用旧从结构覆盖 `skill-button.selectedBuff` 主真相。
   - 影响：
     - 添加 Buff 后，UI 短暂成功，但关闭重开或读取 storage 时丢失部分 Buff。
   - 修正要求：
     - 不允许 `updateButtonBuffIds()` 再从旧 timeline 数据写入 `skill-button` 总表。
     - 优先删除仍依赖 `timelineData.buttons[].buffIds` 的事件同步逻辑。
     - 如果必须保留 `updateButtonBuffIds()` 兼容旧代码，它不能再写 `selectedBuff`，最多只记录 warn 或 no-op。

[必须改]
1. 修复 `removeSkillButton()` 的孤儿 Buff 清理
   - 修改文件：
     - `src/hooks/useTimelineData.ts`
   - 必须引入或使用：
     - `getSkillButtonById`
     - `removeSkillButtonById`
     - `isBuffReferenced`
     - `removeBuffById`
   - 执行顺序：
     - 读取 button
     - 保存旧 `selectedBuff`
     - 删除 button
     - 清理 timeline 引用
     - 检查并删除无引用 Buff

2. 修复 `clearBuffs()` 清理顺序
   - 修改文件：
     - `src/hooks/useSkillButtonBuffs.ts`
   - 执行顺序：
     - 读取 button
     - 保存旧 `selectedBuff`
     - `upsertSkillButton({ ...button, selectedBuff: [] })`
     - 对旧 buffIds 做 `isBuffReferenced`
     - 删除无引用 Buff
     - 清理 `buffCache`
     - 更新本地 `buttonBuffs`

3. 切断旧 `timelineData.buffIds -> selectedBuff` 写回链路
   - 修改文件：
     - `src/components/CanvasBoard/index.tsx`
     - `src/hooks/useTimelineData.ts`
   - 要求：
     - `skillbutton-buff-added` 监听器不得再从 `timelineData.buttons[].buffIds` 组装列表后调用 `updateButtonBuffIds()`。
     - `skillbutton-buff-removed` 同理不得再用旧 `timelineData.buffIds` 作为主数据来源。
     - `updateButtonBuffIds()` 若保留，应改为 no-op 或只做兼容日志，禁止写 `skill-button` 总表。
     - `selectedBuff` 的写入只能来自新主链路：`addBuffToButtonHelper()` / `removeSkillButtonBuff()` / `clearBuffs()` / 删除 button 清理。

[不要动]
- 不要回退 0.4.14 的 `addBuffToButtonHelper()`。
- 不要重新让 `addSkillButtonBuff()` 调 Hook。
- 不要把候选 Buff 列表写回 `ALL_BUFF_LIST`。
- 不要重写缓存大结构。
- 不要把 `timelineData.buttons[].buffIds` 恢复成主真相。

[验收标准 AC]
- AC1: 删除带 Buff 的技能按钮后，`def.skill-button.v1` 中该 button 被删除。
- AC2: 删除带 Buff 的技能按钮后，只有无其他 button 引用的 Buff 会从 `def.all-buff-list.v1` 删除。
- AC3: 清空按钮 Buff 后，该 button 的 `selectedBuff` 为空数组。
- AC4: 清空按钮 Buff 后，无引用 Buff 会从 `def.all-buff-list.v1` 删除。
- AC5: 添加多个 Buff 后，关闭重开弹窗，所有 Buff 仍显示。
- AC6: 添加多个 Buff 后，`CanvasBoard` 的事件监听不会再用旧 `timelineData.buffIds` 覆盖 `selectedBuff`。
- AC7: `npm run build` 通过。

[回归检查项]
- 新建按钮，添加 Buff A、Buff B，关闭重开仍显示 A、B。
- 删除 Buff A，只删除 A 的引用和无引用实体，Buff B 保留。
- 清空按钮 Buff，`selectedBuff` 为空，无引用实体被清理。
- 删除整个按钮，该按钮及无引用 Buff 均被清理。
- 两个按钮共享同一个 Buff 时，删除其中一个按钮不得误删仍被另一个按钮引用的 Buff。
- 点击刷新候选 Buff 列表后，`def.all-buff-list.v1` 不被覆盖。

[给 Trae 的执行指令]
- 本轮只补 3 个剩余问题，不要动已修好的添加链路。
- 最高优先级是切断 `timelineData.buffIds` 对 `selectedBuff` 的写回覆盖。
- 清理逻辑必须遵守统一顺序：先保存旧引用，先解绑当前对象，再查引用，再删实体。
- 完成后必须提交：
  - `removeSkillButton()` 清理逻辑说明
  - `clearBuffs()` 顺序修复说明
  - `updateButtonBuffIds()` / CanvasBoard 旧同步链路处理说明
  - 构建结果
  - 手测结果
    1. 多 Buff 添加后关闭重开
    2. 清空 Buff
    3. 删除按钮
    4. 共享 Buff 不被误删

