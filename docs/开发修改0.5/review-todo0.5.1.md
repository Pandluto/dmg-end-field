# review-todo0.5.1

[任务理解]
- 本轮进入 0.5 第一阶段执行规划。
- 目标是落实 `修改大纲—层级分类.md` 的第一批拆层：`repository + service + events`。
- 本轮不是 UI 重构，不拆 `OperatorConfigPanel.tsx`，不迁移伤害计算层。
- 本轮核心是把数据读写、业务规则、事件契约从组件和 hooks 中抽离出来，建立可维护边界。

[当前结论]
- 当前项目的数据链路已经基本修通，但层级仍混杂。
- 主要混杂点：
  - `src/utils/storage.ts` 是事实上的数据层，但所有领域混在一个文件。
  - `useSkillButtonBuffs.ts` 同时承担 Hook、service、repository 调用。
  - `useTimelineData.ts` 同时承担 Hook、timeline service、skill-button 写表、Buff 清理。
  - `DamageTab.tsx` 仍直接写 candidate storage，并手写 Buff 添加事件。
  - `SkillButton.tsx` 仍手写 Buff 删除事件，并直接读 storage 配置。
  - `CanvasBoard/index.tsx` 仍手写 Buff 事件监听。
- 本轮先建立边界，不改变业务行为。

[必须改]
1. 新建 repository 层
   - 新建目录：
     - `src/core/repositories`
   - 新增 repository：
     - `skillButtonRepository`
     - `buffRepository`
     - `candidateBuffRepository`
     - `timelineRepository`
     - `operatorConfigRepository`
   - 要求：
     - repository 只负责数据读写。
     - repository 可以暂时复用 `src/utils/storage.ts` 里的旧函数。
     - repository 不写业务规则。
     - repository 不引入 React。
     - repository 不派发 UI 事件。
   - 主从约束：
     - `skillButtonRepository` 只管 `ddd.skill-button.v1`。
     - `buffRepository` 只管 `ddd.all-buff-list.v1`。
     - `candidateBuffRepository` 只管 `ddd.candidate-buff-list.v1`。
     - `timelineRepository` 只管 `ddd.timeline.data.v1`。
     - `operatorConfigRepository` 只管角色配置和计算缓存相关读取。

2. 新建 service 层
   - 新建目录：
     - `src/core/services`
   - 新增 service：
     - `buffService`
     - `timelineService`
   - 本轮可暂不抽 `operatorConfigService`，只保留 repository 包装。
   - `buffService` 必须承接：
     - 添加 Buff 到 button
     - 获取 button 的 Buff 列表
     - 删除单个 Buff
     - 清空 button Buff
     - 删除 button 时清理旧 Buff 引用
     - 检查 Buff 是否仍被其他 button 引用
     - 当前选中技能按钮 id 的读写
   - `timelineService` 必须承接：
     - 新增 timeline button
     - 删除 timeline button
     - 更新 button 位置
     - 跨 staff 移动 button
     - 保存 timeline
     - 加载并 normalize timeline
   - 要求：
     - service 不依赖 React。
     - service 不访问 DOM。
     - service 不手写 `window.dispatchEvent`。

3. 迁移 `useSkillButtonBuffs.ts`
   - 修改文件：
     - `src/hooks/useSkillButtonBuffs.ts`
   - 要求：
     - Hook 只保留 React state、effect、对外 API。
     - 添加、删除、清空、引用检查全部调用 `buffService`。
     - `addSkillButtonBuff()` 独立函数也必须调用 `buffService`，不能调用 Hook。
     - `clearBuffs` 的规则只允许存在于 `buffService.clearButtonBuffs()`：
       - 先保存旧 `selectedBuff`
       - 先解绑当前 button
       - 再查引用
       - 再删除无引用实体

4. 迁移 `useTimelineData.ts`
   - 修改文件：
     - `src/hooks/useTimelineData.ts`
   - 要求：
     - Hook 只保留 timeline React state、debounce 保存、调用 service。
     - button 增删改移动逻辑下沉到 `timelineService`。
     - 删除 button 时的 Buff 清理调用 `buffService` 或由 `timelineService` 组合调用。
     - `updateButtonBuffIds()` 保持 no-op 或删除，不得恢复写主表。

5. 新建 events 层
   - 新建目录：
     - `src/core/events`
   - 新增事件封装：
     - `emitSkillButtonBuffAdded`
     - `onSkillButtonBuffAdded`
     - `emitSkillButtonBuffRemoved`
     - `onSkillButtonBuffRemoved`
   - 要求：
     - 统一事件名。
     - 统一 payload 类型。
     - 返回 unsubscribe 函数。
     - 组件不得继续手写 `skillbutton-buff-added` / `skillbutton-buff-removed` 字符串。

6. 迁移组件入口
   - 修改文件：
     - `src/components/SidePanel/components/DamageTab.tsx`
     - `src/components/CanvasBoard/SkillButton.tsx`
     - `src/components/CanvasBoard/index.tsx`
   - 要求：
     - `DamageTab.tsx` 不再直接调用 `setStorageJson`。
     - `DamageTab.tsx` 通过 `candidateBuffRepository` 或 service 保存候选 Buff。
     - `DamageTab.tsx` 通过 events 层派发 Buff 添加事件。
     - `SkillButton.tsx` 通过 events 层派发/监听 Buff 事件。
     - `CanvasBoard/index.tsx` 通过 events 层监听 Buff 事件。
     - 事件监听器不得写 storage 主表。

[不要动]
- 不拆 `OperatorConfigPanel.tsx`。
- 不迁移 `SkillButton.tsx` 中的伤害计算编排。
- 不改 UI 样式。
- 不引入 Redux/Zustand。
- 不改 sessionStorage key。
- 不把 `timelineData.buttons[].buffIds` 恢复为主真相。
- 不把候选 Buff 写入 `ALL_BUFF_LIST`。
- 不让普通函数调用 Hook。

[实现顺序]
1. 先建 `src/core/repositories`
2. 再建 `src/core/services/buffService`
3. 迁移 `useSkillButtonBuffs.ts`
4. 再建 `src/core/services/timelineService`
5. 迁移 `useTimelineData.ts`
6. 再建 `src/core/events`
7. 替换组件中的手写事件和直接 candidate storage 写入
8. 跑构建和回归手测

[验收标准 AC]
- AC1: `src/core/repositories` 存在，并覆盖 skill-button、buff、candidate、timeline、operator-config 数据读写。
- AC2: `src/core/services/buffService` 存在，并承接 Buff 添加、删除、清空、引用检查、删除 button 清理规则。
- AC3: `src/core/services/timelineService` 存在，并承接 button 增删改移动和 timeline 保存恢复核心逻辑。
- AC4: `useSkillButtonBuffs.ts` 不再直接调用 `upsertBuff / upsertSkillButton / removeBuffById / getBuffById / getSkillButtonById`。
- AC5: `useTimelineData.ts` 不再直接调用 `upsertSkillButton / removeSkillButtonById / removeBuffById / getSkillButtonById`。
- AC6: `DamageTab.tsx` 不再直接调用 `setStorageJson`。
- AC7: `DamageTab.tsx / SkillButton.tsx / CanvasBoard/index.tsx` 不再手写 `skillbutton-buff-added` / `skillbutton-buff-removed` 字符串。
- AC8: `ALL_BUFF_LIST` 仍只保存已选 Buff 实体。
- AC9: `CANDIDATE_BUFF_LIST` 仍只保存候选 Buff 列表。
- AC10: `npm run build` 通过。

[回归检查项]
- 添加 Buff A、Buff B，关闭重开仍显示 A、B。
- 删除单个 Buff 后，引用和实体清理正确。
- 清空 Buff 后，无引用实体被删除。
- 删除整个按钮后，无引用 Buff 被删除。
- 刷新候选 Buff 后，`ddd.all-buff-list.v1` 不被覆盖。
- 跨谱线移动后，button id 和 selectedBuff 不丢。
- 刷新页面后，timeline、button、buff 均恢复。

[给 Trae 的执行指令]
- 本轮只做 0.5.1 分层，不做 UI 大拆分。
- 迁移时必须保持每一步功能可用。
- 可以让新 repository 暂时包装旧 `storage.ts`，不要一口气删除旧函数。
- service 是业务规则唯一承载点，不允许把清理顺序继续留在 hook 或组件。
- 完成后必须提交：
  - 新增层级和文件列表
  - 旧入口迁移说明
  - 仍保留兼容的旧入口列表
  - 构建结果
  - 回归手测结果
