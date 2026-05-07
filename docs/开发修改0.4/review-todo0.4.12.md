# review-todo0.4.12

[任务理解]
- 本轮目标不是继续修拖拽主链路，而是把 `skillbutton / buff` 的持久化模型收口成两个总表缓存。
- 最终结构必须明确：
  - `timeline.data`：只保存排轴引用和位置
  - `skill-button`：一个总表，存放所有 button
  - `buff-list`：一个总表，存放所有 buff
  - `skill-button` 表中每个 button 子项的 `selectedBuff` 只保存 `buffId` 引用
- 本轮重点是统一缓存真相，避免现在 `timeline.data`、`skill-button-buffs`、运行时状态三套结构互相拷贝、互相漂移。

[Review 结论]
- 当前实现不满足 0.4.12 的目标缓存模型。
- 当前代码仍然是：
  - `def.timeline.data.v1` 中直接嵌套 `buttons[]`
  - `buttons[]` 中直接带 `buffIds`
  - `def.skill-button-buffs.v1` 中按 `buttonId -> Buff[]` 分组保存 Buff 列表
- 这会导致：
  - `timeline.data` 仍承担了按钮实体缓存职责，不只是时间线引用职责
  - button 没有进入统一 `skill-button` 总表
  - buff 没有进入统一 `buff-list` 总表
  - button 和 buff 的关系仍是“按按钮挂整颗 Buff 数组”，不是“button 存 buffId 引用”
  - `description / condition / source` 等字段在写入时仍存在丢失风险

[当前问题列表]
1. `src/hooks/useTimelineData.ts`
   - `TimelineData.staffLines[].buttons[]` 仍然存的是完整按钮对象，不是轻量引用。
   - `SkillButtonData` 仍直接持有 `buffIds?: string[]`，说明时间线模型仍侵入了按钮配置状态。
   - 当前 `timelineData` 的职责过重：既存排轴位置，又存按钮实体状态。

2. `src/utils/storage.ts`
   - 当前只有 `SKILL_BUTTON_BUFFS` 这种按按钮分组的旧结构。
   - 没有独立的 `skill-button` 总表接口。
   - 没有独立的 `buff-list` 总表接口。
   - `ALL_BUFF_LIST` 已存在，但目前只被当作候选 Buff 列表缓存，不是已选 Buff 的主真相。

3. `src/types/storage.ts`
   - `SkillButtonBuff` 已经是现成的 Buff 结构，不需要再新建另一套 Buff 内容结构。
   - 当前缺的是：
     - 稳定独立 `id`
     - `description`
     - `source`
     - `condition`
   - 当前也没有正式定义“skill-button 总表中的 button 项结构”。

4. `src/components/SidePanel/components/DamageTab.tsx`
   - 加 Buff 时写入的 `newBuff` 丢掉了 `description / condition / source`。
   - 当前逻辑仍直接依赖 `addSkillButtonBuff(buttonId, buff)` 这种“按按钮塞整颗 Buff”的旧模型。

5. `src/hooks/useSkillButtonBuffs.ts`
   - Hook 内部仍围绕 `buttonId -> Buff[]` 工作。
   - `syncBuffsFromTimeline()` 也是从 `timelineData.buffIds` 反推按钮 Buff 分组，并继续落回 `skill-button-buffs.v1`。
   - 这条链路和“skill-button 总表 + buff-list 总表 + button 子项仅存 buffId 引用”的目标模型冲突，不能继续沿用。

6. `src/components/CanvasBoard/SkillButton.tsx`
   - 当前弹窗读取 Buff 仍走 `getButtonBuffs(button.id)`，本质还是从旧的 grouped buff store 读。
   - 这会阻碍后续切换到“先读 skill-button 总表里的 button，再根据 `selectedBuff` 去 `buff-list` 总表解引用”的模式。

[目标数据结构]
1. `timeline.data`
   - 仍按 `staffLines` 组织。
   - 每个 staff 下的按钮节点只保存“排轴引用信息”。
   - 建议结构：
     - `id`
     - `characterName`
     - `skillType`
     - `staffIndex`
     - `nodeIndex`
     - `nodeNumber`
     - `position`
   - 不再在 `timeline.data` 中保存完整 button 配置。
   - 不再在 `timeline.data` 中保存 Buff 关系或 Buff 实体。

2. `skill-button` 总表
   - 一个独立 key，存放所有 button。
   - 建议 key：
     - `def.skill-button.v1`
   - 建议 value：
     - `Record<buttonId, PersistedSkillButton>`
   - 每个 button 子项至少包含：
     - `id`
     - `characterName`
     - `skillType`
     - `staffIndex`
     - `nodeIndex`
     - `nodeNumber`
     - `position`
     - `selectedBuff: string[]`
   - 这里的 `selectedBuff` 只保存 `buffId`，不保存完整 Buff 内容。

3. `buff-list` 总表
   - 一个独立 key，存放所有 buff。
   - 建议继续使用：
     - `def.all-buff-list.v1`
   - 建议 value：
     - `Record<buffId, SkillButtonBuff>`
     - 如果项目更想沿用数组结构，也必须保证每项都有稳定独立 `id`，且提供按 `id` 查询能力。
   - 每个 buff 至少包含：
     - `id`
     - `name`
     - `displayName`
     - `type`
     - `value`
     - `description`
     - `source`
     - `sourceName`
     - `level`
     - `condition`

[三个缓存的主从结构]
- 主结构 1：`def.skill-button.v1`
  - 这是所有 button 的主真相。
  - 管 button 自身字段。
  - 管 button 的 `selectedBuff`。
  - 任何“这个按钮选中了哪些 Buff”的变更，都先写这里。

- 主结构 2：`def.all-buff-list.v1`
  - 这是所有 Buff 内容的主真相。
  - 管每个 buff 的完整字段。
  - 任何“Buff 内容本身”的变更，都先写这里。

- 从结构：`def.timeline.data.v1`
  - 这是排轴展示和恢复用的从结构。
  - 只负责：
    - staff 下有哪些按钮
    - 按钮在时间线上的位置和节点信息
  - 不负责：
    - button 完整配置真相
    - `selectedBuff`
    - Buff 完整内容

- 主从关系结论
  - `skill-button` 总表是 button 的主
  - `buff-list` 总表是 buff 的主
  - `timeline.data` 是排轴引用的从
  - 禁止再把 `timeline.data` 当作 button / Buff 关系的写入真相
  - 禁止再把 `skill-button-buffs.v1 -> Record<buttonId, Buff[]>` 当作主真相

[约束]
- 本轮是缓存模型重构，不是 UI 重构。
- 不要改拖拽交互表现，不要回退 `0.4.11` 已修复的：
  - debounce 自动保存
  - 跨谱线移动保留按钮 id / buffIds
  - normalize 后立即回写
- 不要把这轮扩成整套状态管理重写。
- 不要同时保留旧模型和新模型长期并存。
- 可以做一次性迁移兼容，但迁移完成后读写必须统一走新模型。

[TODO 列表]
1. 先定义新的缓存类型和 key 规范。
   - 修改 `src/types/storage.ts`
   - 新增：
     - `PersistedSkillButton`
   - `PersistedSkillButton` 中明确：
     - `selectedBuff: string[]`
   - 不新建一套与 `SkillButtonBuff` 平行的 Buff 内容结构。
   - 直接扩展现有 `SkillButtonBuff`，补全字段并明确 `id` 为稳定独立 id。
   - 补全 Buff 字段，至少把 `description / source / condition` 纳入正式类型。
   - 修改 `src/constants/storage-keys.ts`
   - 新增明确的总表 key：
     - `SKILL_BUTTON_TABLE`
     - `ALL_BUFF_LIST`

2. 在 `src/utils/storage.ts` 新增两个总表的读写接口。
   - 新增 `skill-button` 总表接口：
     - `getSkillButtonTable()`
     - `setSkillButtonTable(table)`
     - `getSkillButtonById(buttonId)`
     - `upsertSkillButton(button)`
     - `removeSkillButtonById(buttonId)`
   - 新增 `buff-list` 总表接口：
     - `getAllBuffList()`
     - `setAllBuffList(list)`
     - `getBuffById(buffId)`
     - `upsertBuff(buff)`
     - `removeBuffById(buffId)`
   - 明确：旧的 `getSkillButtonBuffMap / setSkillButtonBuffMap` 不再作为主链路使用。

3. 调整 `src/hooks/useTimelineData.ts` 的模型职责。
   - `timeline.data` 只保留 staff 下的按钮引用信息和位置数据。
   - 如果当前 `SkillButtonData` 与 `PersistedSkillButton` 字段重复，要拆分：
     - `TimelineButtonRef` 只服务于时间线
     - `PersistedSkillButton` 服务于 `skill-button` 总表
   - `addSkillButton / removeSkillButton / updateSkillButtonPosition / moveSkillButtonToStaff`
     - 更新 `timeline.data`
     - 同时同步 `skill-button` 总表中的对应 button 子项
   - 当前 `updateButtonBuffIds`
     - 不应再被理解成改 `timeline.data`
     - 应改成更新 `skill-button` 总表里对应 button 的 `selectedBuff`

4. 重写 `src/hooks/useSkillButtonBuffs.ts` 的持久化链路。
   - 目标从“buttonId -> Buff[]”改成：
     - 从 `skill-button` 总表读取 button
     - 从 button 的 `selectedBuff` 读取 `buffId`
     - 再去 `buff-list` 总表解引用 Buff
   - `getButtonBuffs(buttonId)` 改为：
     - 先读 `skill-button` 总表中的 button
     - 再根据 `selectedBuff` 去 `buff-list` 总表拿 Buff
   - `addBuff / removeBuff / clearBuffs`
     - 更新 button 的 `selectedBuff`
     - 更新 `buff-list` 总表
   - `syncBuffsFromTimeline()` 不能再继续围绕 `skill-button-buffs.v1` 做清理。
   - 如需兼容迁移，迁移完成后应把旧 key 清空或废弃。

5. 修改 `src/components/SidePanel/components/DamageTab.tsx`
   - 生成 Buff 时必须给现有 bufflist 项补稳定独立 id，并写完整实体字段。
   - 当前 `newBuff` 至少补齐：
     - `id`
     - `description`
     - `source`
     - `condition`
     - `level`
   - 加 Buff 时不要再默认认为“Buff 挂在按钮数组下”。
   - 改为：
     - 向 `buff-list` 总表写入/更新 Buff
     - 向 `skill-button` 总表对应 button 的 `selectedBuff` 写入 `buffId`

6. 修改 `src/components/CanvasBoard/SkillButton.tsx`
   - 弹窗加载 Buff 时改为：
     - 先读 `skill-button` 总表中的当前 button
     - 再根据 `selectedBuff` 去 `buff-list` 总表解引用 Buff
   - 删除 Buff 时：
     - 从 button 的 `selectedBuff` 删除 `buffId`
     - 再按规则从 `buff-list` 总表清理对应 buff
   - 刷新恢复时验证 UI 仍能完整显示 `displayName / description / value / type`。

7. 做一次旧缓存迁移。
   - 旧数据来源：
     - `def.timeline.data.v1` 中的 `buttons[].buffIds`
     - `def.skill-button-buffs.v1` 中的 `Record<buttonId, Buff[]>`
   - 迁移目标：
     - 建立 `def.skill-button.v1` 总表
     - 建立 `def.all-buff-list.v1` 总表
     - 每个旧 button 迁移成 `skill-button` 总表中的一个子项
     - 每个旧 buff 迁移成 `buff-list` 总表中的一个子项
     - button 子项里的 `selectedBuff` 只回填 `buffId`
     - `timeline.data` 只保留按钮引用和位置
   - 迁移必须幂等，可重复进入页面不重复污染。
   - 迁移完成后应立即回写修正结果。

8. 清理旧结构。
   - `def.skill-button-buffs.v1` 不应再作为主数据源。
   - 若暂时保留兼容读取，必须标注为迁移入口，不能继续写新数据。
   - `ALL_BUFF_LIST` 改为 Buff 总表真相，不能继续只当候选列表缓存。

[实现顺序]
1. 先定类型和总表 key 规范
2. 再补两个总表的 storage 接口
3. 再改 `useTimelineData.ts`，把 button 总表接上
4. 再改 `useSkillButtonBuffs.ts`，切到 `skill-button` 总表 + `buff-list` 总表
5. 再改 `DamageTab.tsx` / `SkillButton.tsx`
6. 最后补迁移与清理逻辑
7. 再跑构建和完整手测

[验收标准 AC]
- AC1: `timeline.data` 中不再保存 button 完整配置和 Buff 实体，只保存按钮引用信息和当前位置。
- AC2: 所有 button 统一保存在 `skill-button` 总表中。
- AC3: 所有 buff 统一保存在 `buff-list` 总表中。
- AC4: `skill-button` 总表里每个 button 子项的 `selectedBuff` 只保存 `buffId`。
- AC5: `SkillButton` 弹窗显示 Buff 时，不再依赖 `def.skill-button-buffs.v1` 这种 grouped map 作为真相。
- AC6: 刷新后，按钮位置恢复正常，按钮已选 Buff 恢复正常。
- AC7: 跨谱线移动后，按钮 `id` 不变，button 子项里的 `selectedBuff` 不丢。
- AC8: 删除按钮时，其 `timeline` 引用、`skill-button` 总表子项、关联 Buff 数据都能按预期清理。
- AC9: 旧缓存可自动迁移到新模型，且迁移后不会反复生成脏数据。
- AC10: `npm run build` 通过。

[回归检查项]
- 第二个干员拖技能到谱线不能崩
- `0.4.11` 的 debounce 自动保存不能回退
- 跨线移动不能再丢 Buff 关联
- 刷新恢复按钮不能失效
- 右键删按钮、锁定、弹窗查看不能被破坏
- DamageTab 刷新 Buff 候选列表功能不能被误伤

[给 Trae 的执行指令]
- 本轮不要再把重点放在拖拽交互上，重点是缓存模型归一。
- 不要继续扩旧的 `skill-button-buffs.v1 -> Record<buttonId, Buff[]>` 方案。
- 直接把“`skill-button` 总表 + `buff-list` 总表 + `timeline.data` 从结构”立起来。
- 任何地方如果仍然出现“从 timeline 直接读完整 buff 对象”或“按 buttonId 保存一整个 Buff 数组”，都视为未完成 0.4.12。
- 完成后必须提交：
  - 新旧缓存结构对照
  - 迁移逻辑说明
  - 构建结果
  - 手测结果
    1. 新建按钮并加 Buff
    2. 刷新恢复
    3. 跨谱线移动
    4. 删除 Buff
    5. 删除按钮
    6. 旧缓存迁移

