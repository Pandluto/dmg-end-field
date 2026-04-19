# review-todo0.4.13

[任务理解]
- 本轮不再扩缓存模型设计，只修复 review 已确认的 5 个问题。
- 目标是把 `0.4.12` 当前实现拉回可用状态，先消除运行时错误，再修正缓存污染和孤儿数据问题。
- 本轮输出是给 Trae 的修正执行单，不是新一轮方案设计。

[Review 结论]
- `0.4.12` 当前状态不能视为完成。
- 阻塞项有 2 个层级：
  - P0：加 Buff 主链路存在 `Invalid hook call`，浏览器运行时会直接炸。
  - P1：`buff-list` 主表会被候选列表覆盖，同时删除/重复添加路径会制造孤儿 Buff 数据。
- 本轮必须先把运行时错误和主表污染修掉，再处理清理顺序问题。

[问题列表]
1. `src/hooks/useSkillButtonBuffs.ts`
   - `addSkillButtonBuff` 在普通导出函数里直接调用 `useSkillButtonBuffs()`。
   - 这违反 Hooks 规则，会触发 `Invalid hook call`。

2. `src/components/SidePanel/components/DamageTab.tsx`
   - `handleRefresh` 仍把候选 Buff 列表写入 `ALL_BUFF_LIST`。
   - 现在 `ALL_BUFF_LIST` 已是已选 Buff 主表，这里会把主表直接覆盖脏掉。

3. `src/hooks/useTimelineData.ts`
   - `removeSkillButton` 删除按钮时，没有按该按钮的 `selectedBuff` 清理无引用 Buff。
   - 会在 `buff-list` 主表里留下孤儿数据。

4. `src/hooks/useSkillButtonBuffs.ts`
   - `addBuff` 先写 `buff-list`，再做重复判断。
   - 重复添加同一 Buff 时，会先落一条新 Buff，再因为重复被短路，最终留下孤儿 Buff。

5. `src/hooks/useSkillButtonBuffs.ts`
   - `clearBuffs` 先做引用检查，再移除当前按钮上的 `selectedBuff`。
   - 检查时这些 Buff 仍被当前按钮引用，因此会被误判为“仍在使用”，导致清理失败。

[约束]
- 本轮只修这 5 个 review 问题，不新增一轮缓存结构改造。
- 不要回退 `0.4.11` 已修复的拖拽、跨线移动、自动保存、恢复链路。
- 不要再把 `ALL_BUFF_LIST` 混用成“候选 Buff 列表缓存”。
- 不要为了绕过错误而删功能、注释功能或降级为临时写法。
- 修复必须落到真实数据链路，不接受只让 build 通过的表面修正。

[TODO 列表]
1. 修复 `Invalid hook call`
   - 修改文件：
     - `src/hooks/useSkillButtonBuffs.ts`
     - 如有必要联动 `src/components/SidePanel/components/DamageTab.tsx`
   - 要求：
     - 禁止在普通函数内直接调用 `useSkillButtonBuffs()`
     - `addSkillButtonBuff` / `removeSkillButtonBuff` 必须改成纯 storage/helper 调用链，或只在组件内通过 Hook 返回方法调用
     - 最终效果是：点击添加 Buff 时不再触发运行时 Hook 错误

2. 拆开 `ALL_BUFF_LIST` 与候选 Buff 列表
   - 修改文件：
     - `src/components/SidePanel/components/DamageTab.tsx`
     - 如有必要联动 `src/constants/storage-keys.ts`
     - 如有必要联动 `src/utils/storage.ts`
   - 要求：
     - `ALL_BUFF_LIST` 只承载已选 Buff 主表
     - 候选 Buff 列表不得再写入 `ALL_BUFF_LIST`
     - 候选列表如需缓存，必须单独 key；如果没必要持久化，就只留运行时内存态
     - 点击“刷新”后，已有按钮的已选 Buff 不得被覆盖

3. 修复删除按钮时的 Buff 清理
   - 修改文件：
     - `src/hooks/useTimelineData.ts`
     - 如有必要联动 `src/utils/storage.ts`
   - 要求：
     - `removeSkillButton` 删除按钮前先读取该按钮的 `selectedBuff`
     - 删除按钮后，对这些 `buffId` 逐个检查是否仍被其他按钮引用
     - 仅对“已无任何引用”的 Buff，从 `buff-list` 主表中删除
     - 删除按钮后，不能再留下无引用 Buff 脏数据

4. 修复重复添加 Buff 的落库顺序
   - 修改文件：
     - `src/hooks/useSkillButtonBuffs.ts`
   - 要求：
     - 重复判断必须前置
     - 只有确认当前按钮还未绑定等价 Buff 后，才允许写入 `buff-list`
     - 不允许重复添加路径制造孤儿 Buff
     - 去重标准如果当前仍沿用 `displayName`，就保持一致，不要本轮顺手扩规则

5. 修复 `clearBuffs` 的清理顺序
   - 修改文件：
     - `src/hooks/useSkillButtonBuffs.ts`
   - 要求：
     - 先从当前按钮上移除 `selectedBuff`
     - 再对原 Buff 列表做“是否仍被其他按钮引用”的检查
     - 再清理 `buff-list` 中的无引用 Buff
     - 不能再出现“因为当前按钮自己还没解绑，所以永远判断为仍被引用”的情况

6. 补一轮针对缓存一致性的回归验证
   - 至少覆盖：
     - 添加 Buff
     - 重复添加同一 Buff
     - 删除单个 Buff
     - 清空按钮全部 Buff
     - 删除整个按钮
     - 点击刷新候选列表后恢复已有按钮 Buff

[实现顺序]
1. 先修 `Invalid hook call`
2. 再拆开 `ALL_BUFF_LIST` 与候选列表写入
3. 再补删除按钮时的 Buff 清理
4. 再修重复添加的去重顺序
5. 最后修 `clearBuffs` 的顺序问题
6. 再跑构建与手测

[验收标准 AC]
- AC1: 点击添加 Buff 时，不再出现 `Invalid hook call`
- AC2: 点击刷新候选列表后，`ALL_BUFF_LIST` 中的已选 Buff 主表数据不被覆盖
- AC3: 删除按钮后，无引用 Buff 会从 `buff-list` 主表清理掉
- AC4: 重复添加同一 Buff，不会再制造孤儿 Buff 数据
- AC5: `clearBuffs` 后，按钮的 `selectedBuff` 被清空，且无引用 Buff 被正确清理
- AC6: 刷新后，已有按钮的 Buff 仍能正常恢复显示
- AC7: `npm run build` 通过

[回归检查项]
- 单击添加 Buff 到技能按钮是否成功
- 重复单击同一 Buff 是否稳定去重
- 删除单个 Buff 后，按钮显示与主表状态是否一致
- 清空按钮所有 Buff 后，`buff-list` 是否残留孤儿项
- 删除整个按钮后，`buff-list` 是否残留孤儿项
- 点击“刷新”候选列表后，旧按钮 Buff 是否仍能恢复
- `0.4.11` 的拖拽、跨线移动、自动保存是否未回退

[给 Trae 的执行指令]
- 本轮不要再动缓存大结构定义，只修 review 已确认的 5 个问题。
- 最高优先级是：
  - `Invalid hook call`
  - `ALL_BUFF_LIST` 被候选列表覆盖
- 任何修复如果只是“让构建通过”但运行时仍会报错，或主表仍会被污染，都视为未完成。
- 完成后必须提交：
  - 5 个问题逐项修复说明
  - 构建结果
  - 手测结果
    1. 添加 Buff
    2. 重复添加 Buff
    3. 删除单个 Buff
    4. 清空 Buff
    5. 删除按钮
    6. 刷新候选列表后的恢复验证
