# review-todo0.4.8

[任务理解]
- 当前技能按钮缓存只有手动点击“保存”才会写入 `sessionStorage`，这不符合现在的交互强度，用户任意操作后都可能丢数据。
- 同时当前按钮缓存结构过于简单，`timelineData` 只保存按钮位置/节点信息，而按钮对应的“已选 Buff”被单独散落在 `def.skill-button-buffs.*` 中，导致按钮缓存和 Buff 缓存不是同一个数据源。
- 另外当前 `DamageTab` 的 Buff 陈列区存在一个已确认 bug：武器 Buff 无法显示。根因不是 Buff 文件不存在，而是角色 -> 武器映射链路在 storage 兼容层中断了。
- 本轮目标是把技能按钮缓存升级成“自动保存 + 按钮与 Buff 关联缓存”，并明确唯一数据源。

[约束]
- 技术约束
  - 必须继续使用 `sessionStorage`。
  - 必须支持以下操作后自动保存：
    - 拖动并放置技能按钮
    - 移动已有技能按钮
    - 删除技能按钮
    - 修改已选 Buff（添加 / 删除）
  - 不允许保留“双源真相”：按钮布局在一个 key，按钮已选 Buff 又在另一个互相独立 key 里各自维护。
- 不可破坏部分
  - 当前按钮 ID 必须继续稳定可用，不能因为自动保存重构导致已放置按钮在一次会话内丢失关联。
  - `SkillButton` 弹窗里对已选 Buff 的读取、展示、删除逻辑不能被改坏。
  - `DamageTab` 添加 Buff 的交互不能被改坏。
- 风格/架构要求
  - 缓存结构要明确分层：
    - `buttons`
    - `buffRegistry`
    - `selectedBuffList`
  - `selectedBuffList` 只存 Buff ID 列表，不重复内嵌整份 Buff 对象。
  - `buffRegistry` 负责存每个 Buff 的完整快照，字段至少包含：
    - `id`
    - `name`
    - `displayName`
    - `type`
    - `value`
    - `sourceName`
    - `description`
    - 其他当前业务已在用的字段
  - 不要再维持“timelineData 一套、skill-button-buffs 一套”的长期并行逻辑；必须明确主存储。
  - 必须顺手修掉 `DamageTab` 武器 Buff 不显示的问题，不能让新的缓存结构继续建立在错误的角色/武器映射上。

[TODO 列表]
1. 修改 `src/types/index.ts` 中与时间轴缓存相关的类型，扩展当前 `SkillButtonData` / `TimelineData`，至少满足：
   - 每个技能按钮缓存项包含 `selectedBuffList: string[]`
   - `TimelineData` 或等价根结构中新增 `buffRegistry: Record<string, CachedBuffItem>`
   - 为 `CachedBuffItem` 新增清晰类型定义，不要直接用匿名对象
2. 检查 `src/types/storage.ts` 和 `src/types/index.ts` 的职责边界，把“按钮缓存用 Buff 类型”和“UI/运行时 Buff 类型”梳理清楚；避免重复定义但也不要直接互相污染。
3. 重构 `src/hooks/useTimelineData.ts`，把当前“只在点击保存按钮时调用 `saveTimelineData()`”改成自动保存机制：
   - `timelineData` 每次有效变更后自动写入 `sessionStorage`
   - 至少加一个适度 debounce，避免拖动过程每一帧都写
   - `saveTimelineData()` 可以保留，但必须退化为手动触发同一套持久化逻辑，而不是另一套实现
4. 修改 `useTimelineData.ts` 的按钮缓存写入内容，不再只保存基础按钮位置信息；写入时必须带上：
   - `buttons`
   - `buffRegistry`
   - 每个按钮对应的 `selectedBuffList`
5. 梳理当前 `def.skill-button-buffs.*` 的使用链路，决定并落实唯一主数据源：
   - 推荐做法：以升级后的 `timelineData` 为唯一主存储
   - `getSkillButtonBuffMap()` / `setSkillButtonBuffMap()` 不再作为长期独立真相来源
   - 如果为了最小改造保留兼容层，也必须保证最终写入来自同一份 `timelineData`
6. 修改 `src/hooks/useSkillButtonBuffs.ts`，让“添加 Buff / 删除 Buff / 读取按钮 Buff”最终都能映射到新的按钮缓存结构：
   - 添加 Buff 时，为 Buff 生成独立稳定 ID，并写入 `buffRegistry`
   - 同时把该 ID 写入对应按钮的 `selectedBuffList`
   - 删除 Buff 时，只移除按钮的 `selectedBuffList` 引用；是否清理孤儿 Buff 由你实现，但规则必须一致
7. 修改 `src/components/CanvasBoard/SkillButton.tsx`，让它读取按钮 Buff 时不再依赖独立的旧 Buff map 作为唯一来源，而是能从新的按钮缓存结构还原完整 Buff 列表。
8. 修改 `src/components/SidePanel/components/DamageTab.tsx`，保证添加 Buff 时写入的是新结构；不要再只改旧的 `skill-button-buffs` map。
9. 检查 `src/components/CanvasBoard/index.tsx` 当前“保存按钮”的意义。如果自动保存已完整覆盖：
   - 可以保留按钮，但行为必须与自动保存共用同一套逻辑
   - 不允许手动保存和自动保存写出不同结构
10. 为加载流程补全恢复逻辑：页面刷新后，能够从 `sessionStorage` 恢复：
    - 技能按钮位置
    - 每个按钮对应的已选 Buff
    - Buff 完整展示信息
11. 对旧结构读取做最小兼容处理，但不要搞复杂迁移系统：
    - 本轮不要求历史迁移脚本
    - 但不能因为新结构落地导致当前会话内直接读崩
12. 修复 `DamageTab` 武器 Buff 不显示的问题：
    - 检查 `src/utils/storage.ts` 中 `mergeV3ToV2()` 当前把 `characterName` 返回为空字符串的逻辑
    - 恢复 `DamageTab.tsx` 中 `getCharacterWeapons()` 所依赖的角色名映射
    - 明确保证 `getCharacterConfigMap()` 返回结果中的 `characterName` 能正确命中 `selectedCharacters.map(char => char.name)`
13. 跑构建，并手动验证一组完整链路：
    - 放置按钮 -> 刷新 -> 按钮仍在
    - 给按钮加 Buff -> 刷新 -> Buff 仍在
    - 删除按钮 -> 刷新 -> 已删除状态仍保持
    - 删除按钮后，其 `selectedBuffList` 不残留脏引用
    - 在 `DamageTab` 点击“刷新 Buff”后，角色 Buff 和武器 Buff 都能进入陈列区

[验收标准 AC]
- AC1: 用户执行“放置技能按钮、移动技能按钮、删除技能按钮、添加 Buff、删除 Buff”后，无需手动点击保存，也会自动写入 `sessionStorage`。
- AC2: 刷新页面后，技能按钮位置能够恢复。
- AC3: 刷新页面后，技能按钮对应的已选 Buff 能够恢复，且弹窗中显示内容完整。
- AC4: 新的按钮缓存结构中，每个按钮缓存项都包含 `selectedBuffList`，且 `selectedBuffList` 中只存 Buff ID，不重复内嵌整份 Buff 数据。
- AC5: 缓存中存在统一的 `buffRegistry`，每个 Buff 条目至少包含 `id`、`name`、`displayName`、`type`、`value`、`sourceName`、`description`。
- AC6: 不再存在“按钮缓存写一套、Buff 缓存再独立写另一套且互不同步”的主数据源冲突。
- AC7: `DamageTab` 点击“刷新 Buff”后，已选角色对应的武器 Buff 能正常进入陈列区，不再只显示角色 Buff。
- AC8: `getCharacterWeapons()` 生成的 `weaponMap` 不再因为 `characterName` 为空而失效。
- AC9: `npm run build` 通过。

[给 Cursor 的执行指令]
- 需要修改的文件（如果已知）
  - `src/types/index.ts`
  - `src/types/storage.ts`
  - `src/hooks/useTimelineData.ts`
  - `src/hooks/useSkillButtonBuffs.ts`
  - `src/components/CanvasBoard/SkillButton.tsx`
  - `src/components/SidePanel/components/DamageTab.tsx`
  - `src/utils/storage.ts`
- 实现顺序
  1. 先定新缓存结构和类型
  2. 再改 `useTimelineData.ts`，把自动保存和新缓存结构立起来
  3. 再改 `useSkillButtonBuffs.ts`，让 Buff 操作接到新结构
  4. 再改 `SkillButton.tsx` / `DamageTab.tsx` 的读写入口
  5. 再修 `storage.ts` 里影响武器 Buff 映射的 `characterName` 兼容问题
  6. 最后统一检查手动保存按钮是否仍复用同一逻辑
  7. 跑构建并手测刷新恢复与 Buff 陈列区
- 必须实现的逻辑
  - 自动保存
  - `buffRegistry + selectedBuffList`
  - 按钮与 Buff 的唯一主数据源
  - 刷新后按钮和 Buff 一起恢复
  - 修复武器 Buff 无法进入陈列区的问题
- 不能动的部分
  - 不要把锁定这种纯运行时字段混进持久化缓存
  - 不要继续扩大到角色配置 storage 重构
  - 不要留下长期双写方案
- 测试要求
  - 手测放置/移动/删除按钮后自动保存
  - 手测添加/删除 Buff 后自动保存
  - 手测刷新恢复按钮与 Buff
  - 手测删除按钮后无脏 Buff 引用
  - 手测 `DamageTab` 刷新 Buff 后武器 Buff 能显示
  - 执行 `npm run build`

