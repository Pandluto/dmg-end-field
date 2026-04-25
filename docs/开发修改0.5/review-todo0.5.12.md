# review-todo0.5.12：重选角色后的主从表同步与恢复渲染

## [本轮目标]

本轮只解决一件事：

- 当用户在选人页重新确认角色列表后，系统必须正确处理：
  - 哪些角色被保留
  - 哪些角色是新增
  - 哪些角色被移除
  - 哪些角色虽然保留，但 1/2/3/4 位次发生了变化

最终要达到的结果是：

1. 当前生效角色列表有明确主表，并进入持久化。
2. 重选确认后，`timeline.data.v1` 和 `ddd.skill-button.v1` 按差量迁移，不再直接清空。
3. 保留角色的按钮、排轴、Buff 不丢失，只跟着新位次迁移。
4. 被移除角色的按钮和关联数据被清理。
5. 浏览器刷新后，只有关键主表完整时才恢复渲染；否则直接冷启动。

一句话收口：

- 本轮要建立“主表 -> 从表 -> UI 恢复”的完整顺序。

---

## [总原则]

### 1. 主表先行

当前生效角色列表必须是主表。

- 主表：`selectedCharacters`
- 从表：
  - `ddd.timeline.data.v1`
  - `ddd.skill-button.v1`
  - `ddd.all-buff-list.v1`
  - `character-input/computed/display`

原则是：

- 主表决定当前是谁、顺序是什么。
- 从表只能跟随主表迁移和恢复。
- 不允许从表脱离主表单独恢复。

### 2. 重选必须做差量迁移

重选角色确认后，不允许继续使用：

- 直接 `CLEAR_SKILL_BUTTONS`
- 再重新生成空画布

因为这会把“保留角色”的旧排轴和按钮一起抹掉。

正确做法是：

- 先对比旧角色列表和新角色列表
- 再按对比结果改持久化层
- 最后再触发画布恢复

### 3. 浏览器刷新只认关键主表

本轮把浏览器刷新的恢复门槛明确成两个 key：

- `selectedCharacters`
- `ddd.timeline.data.v1`

规则固定为：

- 两个都在：允许恢复渲染
- 任意一个缺失：直接冷启动

冷启动时：

- `selectedCharacters = []`
- `skillButtons = []`
- `currentView = selection`
- 不恢复任何从表

---

## [实现细节]

### 一、建立 `selectedCharacters` 主表持久化

文件：

- `src/constants/storage-keys.ts`
- `src/utils/storage.ts`
- `src/context/AppContext.tsx`

要做的事：

- 新增一个主表 key，例如：
  - `ddd.selected-characters.v1`
- 只存最小必要数据：
  - `characterIds: string[]`
- 顺序必须保留，因为顺序就是 1/2/3/4 位次。

实现要求：

- `AppContext.tsx` 中读取主表，恢复“当前生效角色列表”
- `AppContext.tsx` 中监听当前生效角色列表变化，回写主表
- 不要把完整 `Character` 对象整份落盘

验证方式：

- 刷新页面后，主表能按原顺序恢复
- `/storage` 页面能看到 `ddd.selected-characters.v1`

---

### 二、把选人页拆成“草稿选人”和“已生效选人”

文件：

- `src/components/SelectionPanel/index.tsx`
- `src/context/AppContext.tsx`
- `src/components/WorkbenchFrame/WorkbenchFrame.tsx`

要做的事：

- 选人页中的勾选，不应立即污染当前画布上下文。
- 当前应该至少分成两份状态：
  - `draftSelectedCharacters`
  - `confirmedSelectedCharacters`

角色配置面板、技能沙盒、排轴、按钮恢复，必须统一吃：

- `confirmedSelectedCharacters`

实现要求：

- 用户在选人页勾选时，只改 `draft`
- 用户点击“开始排轴”时，才把 `draft` 提交为 `confirmed`
- 提交时进入差量迁移，不允许先清空画布

验证方式：

- 在选人页还没确认前，画布不被临时勾选干扰
- 点击“开始排轴”后，工作台才切到新角色顺序

---

### 三、确认重选时先做 diff

文件：

- `src/components/SelectionPanel/index.tsx`
- `src/context/AppContext.tsx`
- 如有需要可新增 `src/core/services/selectedCharacterService.ts`

要做的事：

- 在“旧 confirmed 列表”和“新 draft 列表”之间做对比

对比结果必须产出 4 类：

1. `keptCharacters`
   - 旧有，新也有

2. `addedCharacters`
   - 旧没有，新有

3. `removedCharacters`
   - 旧有，新没有

4. `movedCharacters`
   - 人没变，但位次变化

实现要求：

- 身份只看 `character.id`
- 位次只看数组下标

示例：

- 旧：`[A, B, C]`
- 新：`[B, A, D]`

diff 结果必须是：

- 保留：`A, B`
- 新增：`D`
- 移除：`C`
- 位次变化：`A, B`

验证方式：

- 把 diff 结果打印到日志或调试输出里，确保和预期一致

---

### 四、对 `ddd.timeline.data.v1` 做差量迁移

文件：

- `src/core/services/timelineService.ts`
- `src/hooks/useTimelineData.ts`

要做的事：

- 新增一个专门处理“角色重选确认后”迁移时间轴的入口，例如：
  - `reconcileTimelineDataBySelectedCharacters(...)`

迁移规则：

- 对保留角色：
  - 保留原按钮和 occupiedNodes
  - staffLine 跟着新位次重排

- 对移除角色：
  - 删除对应 staffLine

- 对新增角色：
  - 新建空 staffLine

实现要求：

- `timeline.staffLines` 的最终顺序必须严格等于新的角色顺序
- 不允许继续按旧数组下标硬继承
- `normalizeTimelineData()` 可以复用，但不能代替整个迁移流程

验证方式：

- `[A, B, C] -> [B, A, D]` 后：
  - `staffLines[0].characterName === B`
  - `staffLines[1].characterName === A`
  - `staffLines[2].characterName === D`
  - `A/B` 旧按钮仍在
  - `C` 的 staffLine 被移除

---

### 五、对 `ddd.skill-button.v1` 做差量迁移

文件：

- `src/core/repositories/skillButtonRepository.ts`
- `src/core/services/timelineService.ts`
- `src/core/services/buffService.ts`

要做的事：

- `ddd.skill-button.v1` 里按钮是从属于角色和位次的。
- 角色重选后，按钮不能留在旧 staffIndex。

迁移规则：

- 对保留角色：
  - 保留按钮
  - 更新按钮的 `staffIndex`
  - 如果 UI 依赖 `lineIndex`，也要一起更新

- 对移除角色：
  - 删除该角色全部按钮
  - 同时清理其 Buff 引用

- 对新增角色：
  - 不生成旧按钮
  - 保持空位

实现要求：

- 迁移完成后，如按钮级面板依赖角色位次上下文，统一重算一次：
  - `recomputeSkillButtonPanel(buttonId)`

验证方式：

- `[A, B, C] -> [B, A, D]` 后：
  - `A/B` 的按钮仍在
  - 它们的 `staffIndex` 已更新
  - `C` 的按钮从 `ddd.skill-button.v1` 中消失

---

### 六、去掉 `CanvasBoard` 的一次性恢复门闩

文件：

- `src/components/CanvasBoard/index.tsx`

要做的事：

- 当前恢复逻辑被 `hasRestoredRef` 限制为只执行一次。
- 这不适合“角色集合确认后再恢复”。

实现要求：

- 不再让恢复逻辑永久只跑一次
- 恢复触发条件改成：
  - 当前生效角色列表已就绪
  - `timeline.data.v1` 已完成迁移或可正常读取
- 画布按钮恢复时：
  - `staffIndex`
  - `lineIndex`
  必须按新位次重新映射

验证方式：

- 重选角色确认后，不刷新页面，画布能立即按新顺序恢复

---

### 七、浏览器刷新后的恢复门槛

文件：

- `src/context/AppContext.tsx`
- `src/components/CanvasBoard/index.tsx`
- `src/hooks/useTimelineData.ts`
- `src/utils/storage.ts`

要做的事：

- 浏览器刷新后，不能继续“有啥读啥”。
- 必须先判断关键主表是否完整。

关键主表只认两个：

- `selectedCharacters`
- `ddd.timeline.data.v1`

实现要求：

- 两个都在：允许恢复渲染
- 任意一个缺失：直接冷启动

冷启动统一行为：

- `selectedCharacters = []`
- `skillButtons = []`
- `currentView = selection`
- 不恢复：
  - `ddd.skill-button.v1`
  - `ddd.all-buff-list.v1`
  - `character-input/computed/display`

验证方式：

- 只删 `selectedCharacters`，保留 `timeline.data.v1`：冷启动
- 只删 `timeline.data.v1`，保留 `selectedCharacters`：冷启动
- 两者都在：正常恢复

---

## [不要动]

- 不要改武器、装备、Buff、伤害公式。
- 不要顺手重构整个 `AppContext` 架构。
- 不要再用“确认选人时直接 `CLEAR_SKILL_BUTTONS`”。
- 不要让从表在关键主表缺失时单独恢复。
- 不要只做 `selectedCharacters` 持久化而不处理差量迁移。

---

## [验收标准 AC]

- AC1：`selectedCharacters` 有独立主表持久化，并且顺序可恢复。
- AC2：重选确认时，系统能正确区分保留、新增、移除、位次变化。
- AC3：保留角色的按钮和排轴不丢失，只迁移到新位次。
- AC4：移除角色的按钮、排轴和关联 Buff 被清理。
- AC5：新增角色生成空 staffLine，不继承旧按钮。
- AC6：不刷新页面，确认重选后：
  - 技能沙盒
  - 角色配置面板
  - 画布按钮
  一起切到新顺序。
- AC7：浏览器刷新后：
  - 两个关键主表都在时，完整恢复渲染
  - 任意一个缺失时，直接冷启动
- AC8：`npm run build` 通过。

---

## [回归检查项]

1. `[A, B, C] -> [A, B, C]`
   - 无变化时，不误删按钮。

2. `[A, B, C] -> [B, A, C]`
   - 只有位次变化时，按钮保留并交换位次。

3. `[A, B, C] -> [B, A, D]`
   - `C` 被删
   - `D` 新增空位
   - `A/B` 保留并迁移

4. `[A, B] -> [A]`
   - `B` 的 staffLine、按钮、Buff 一起被清理。

5. 浏览器刷新
   - 两个关键主表都在：恢复正常
   - 缺任意一个：直接冷启动

---

## [给 Trae 的执行指令]

1. 先新增 `selectedCharacters` 主表持久化，只存角色 `id` 顺序。
2. 再把选人页拆成“草稿选人”和“已生效选人”。
3. 再实现确认重选时的 diff 逻辑。
4. 再实现 `timeline.data.v1` 的差量迁移。
5. 再实现 `ddd.skill-button.v1` 的差量迁移和清理。
6. 最后改 `CanvasBoard` 的恢复逻辑和浏览器刷新门槛。
7. 完成后必须提交：
   - 修改文件清单
   - 旧选人 / 新选人 / diff 结果示例
   - `timeline.data.v1` 迁移前后片段
   - `ddd.skill-button.v1` 迁移前后片段
   - 三组重选场景手测结果
   - 两组浏览器刷新结果
   - `npm run build` 结果
