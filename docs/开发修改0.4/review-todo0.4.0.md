# review-todo0.4.0

[任务理解]
- 当前目标不是继续加功能，而是把项目里分散、硬编码、缺少保护的 `sessionStorage` 使用先收口。
- 这轮只处理 0.4.0 review 中已经确认的高优先级问题，避免后续改动继续建立在脆弱的存储层之上。

[约束]
- 技术约束
  - 现有业务行为不能变：角色配置恢复、技能按钮 Buff、时间轴数据、伤害面板读取逻辑都必须保持可用。
  - 本轮允许重构 storage 层，但不要引入大规模 UI 改写。
  - 先做统一 key 和统一读写封装，不要求这轮完成完整 migration 体系。
- 不可破坏部分
  - `OperatorConfigPanel` 的角色配置持久化能力不能丢。
  - `SkillButton` / `DamageTab` 对角色配置和 Buff 的读取结果不能变空。
  - `useTimelineData` 的时间轴缓存不能失效。
- 风格/架构要求
  - 所有 storage key 必须集中定义。
  - 组件内不允许继续散落裸 `sessionStorage.getItem/setItem` + 硬编码 key。
  - 所有 JSON 读写必须有统一容错。

[TODO 列表]
1. 新增 `src/constants/storage-keys.ts`，集中定义以下 key，替换项目内重复硬编码：
   - `def.operator-config.character-config-map.v1`
   - `def.skill-button-buffs.v1`
   - `def.selected-skill-button`
   - `def.timeline.data.v1`
   - `def.all-buff-list.v1`
2. 新增 `src/utils/storage.ts`，提供统一工具函数，至少包含：
   - `getStorageJson`
   - `setStorageJson`
   - `removeStorageItem`
   - 读取时 `try/catch` 保护
   - 解析失败时返回默认值，必要时清除损坏数据
3. 替换 `src/components/CanvasBoard/components/OperatorConfigPanel.tsx` 中所有角色配置 key 的硬编码和直接 `JSON.parse/sessionStorage` 读写，统一改走 storage key 常量和工具函数。
4. 替换 `src/components/CanvasBoard/SkillButton.tsx` 中所有角色配置、技能按钮 Buff 的硬编码和直接 `sessionStorage` 读写，统一改走 storage key 常量和工具函数。
5. 替换 `src/components/SidePanel/components/DamageTab.tsx` 中所有角色配置、Buff 列表的硬编码和直接 `sessionStorage` 读写，统一改走 storage key 常量和工具函数；将 `allBuffList` 改成带命名空间和版本号的 key。
6. 替换 `src/hooks/useSkillButtonBuffs.ts` 中所有技能按钮 Buff 相关硬编码和 JSON 解析逻辑，统一改走 storage key 常量和工具函数。
7. 替换 `src/hooks/useTimelineData.ts` 中时间轴缓存相关的硬编码和 JSON 解析逻辑，统一改走 storage key 常量和工具函数。
8. 检查上述文件中所有 `JSON.parse` 调用，确保不再存在无保护直接解析 `sessionStorage` 返回值的路径。
9. 保持现有存储结构不变，不在本轮引入新的拆分结构、migration 逻辑或 UI 层改造。

[验收标准 AC]
- AC1: 项目内不再存在散落的 storage key 字符串硬编码；所有相关 key 均来自 `src/constants/storage-keys.ts`。
- AC2: `OperatorConfigPanel.tsx`、`SkillButton.tsx`、`DamageTab.tsx`、`useSkillButtonBuffs.ts`、`useTimelineData.ts` 中不再存在无 `try/catch` 保护的 `JSON.parse(sessionStorage...)` 路径。
- AC3: `allBuffList` 不再以裸 key 写入，已替换为 `def.*` 命名空间 key。
- AC4: 页面刷新后，角色配置、技能按钮 Buff、时间轴数据仍能正常恢复。
- AC5: `npm run build` 通过。

[给 Cursor 的执行指令]
- 需要修改的文件
  - `src/constants/storage-keys.ts`
  - `src/utils/storage.ts`
  - `src/components/CanvasBoard/components/OperatorConfigPanel.tsx`
  - `src/components/CanvasBoard/SkillButton.tsx`
  - `src/components/SidePanel/components/DamageTab.tsx`
  - `src/hooks/useSkillButtonBuffs.ts`
  - `src/hooks/useTimelineData.ts`
- 实现顺序
  1. 先新增 `storage-keys.ts`
  2. 再新增 `storage.ts`
  3. 先改 hooks，再改组件
  4. 最后统一全局搜索，确认旧 key 和裸 `allBuffList` 已清干净
  5. 跑 `npm run build`
- 必须实现的逻辑
  - storage 统一从常量取 key
  - storage 统一从工具函数做 JSON 读写
  - 解析失败时不能让页面崩溃
  - `allBuffList` 必须改名并统一接入封装
- 不能动的部分
  - 不要改变角色配置对象结构
  - 不要提前做 v2/v3 拆分
  - 不要删除现有业务字段
- 测试要求
  - 手动验证角色配置保存/刷新恢复
  - 手动验证技能按钮 Buff 添加后刷新仍存在
  - 手动验证时间轴数据刷新后仍存在
  - 执行 `npm run build`

