# review-todo0.4.9

[任务理解]
- 当前不做 0.4.8 那种整套缓存结构重构，只做单独修 bug。
- 这轮只处理已经确认的直接问题：`DamageTab` 的武器 Buff 不显示，以及技能按钮与已选 Buff 的关联在操作后容易失效的问题。

[约束]
- 技术约束
  - 不要引入新的缓存结构。
  - 不要把 `timelineData`、`skill-button-buffs`、`AppContext.skillButtons` 再重做一轮。
  - 以“最小修复”为原则，修已有链路，不扩展设计。
- 不可破坏部分
  - 当前角色 Buff 陈列区不能被修坏。
  - `SkillButton` 弹窗里的 Buff 显示、删除、伤害和信息功能不能受影响。
  - 现有按钮拖拽、删除、双击弹窗逻辑不能改坏。
- 风格/架构要求
  - 优先修上游数据问题，不要在下游写脆弱兜底。
  - 不要混入新的事件总线、兼容层或“双轨缓存”设计。
  - 如果一条逻辑能通过恢复旧正确行为解决，就不要顺手做架构升级。

[TODO 列表]
1. 修改 `src/utils/storage.ts` 中 `mergeV3ToV2()` 的兼容逻辑，不要再让批量读取的 `characterName` 为空；当前项目里可直接使用 `characterId` 作为兼容值，保证 `getCharacterConfigMap()` 返回的 `characterName` 可用。
2. 复查 `src/components/SidePanel/components/DamageTab.tsx` 中 `getCharacterWeapons()` 的匹配逻辑，确认它能基于 `config.characterName + config.weaponName` 正常构建 `weaponMap`，从而加载武器 Buff。
3. 修复 `DamageTab` 点击“刷新 Buff”后武器 Buff 不进入陈列区的问题，并手动验证：
   - 角色 Buff 正常
   - 武器 Buff 也正常
   - 二者同时存在时不互相覆盖
4. 检查 `src/components/CanvasBoard/SkillButton.tsx` 中已选 Buff 的删除逻辑，确保删除 Buff 时不依赖错误或过期的旧缓存判断；如果当前回退后仍在使用旧 `skill-button-buffs`，则保持同一套数据源，不允许“显示用一套、删除判断用另一套”。
5. 检查已有按钮在移动、删除、重新打开弹窗后的 Buff 列表是否仍正确；这轮如果没有正式做按钮/Buff 统一缓存，就不要假装支持新结构，只要保证当前已回退版本的旧链路稳定。
6. 全局搜索并确认这轮修复不会重新引入半成品结构：
   - 不要残留未接通的 `buffRegistry`
   - 不要残留未接通的 `selectedBuffList`
   - 不要残留只写不读或只读不写的事件中转逻辑
7. 跑 `npm run build`，并按现有交互完整手测以下场景：
   - 配置武器后刷新 Buff，武器 Buff 出现在陈列区
   - 给技能按钮添加 Buff 后，弹窗中可见
   - 删除 Buff 后，弹窗中正确消失
   - 删除技能按钮后，不出现脏 Buff 引用报错

[验收标准 AC]
- AC1: `DamageTab` 点击“刷新 Buff”后，已选角色对应的武器 Buff 能正常出现在陈列区。
- AC2: `getCharacterWeapons()` 生成的 `weaponMap` 不再因 `characterName` 为空而失效。
- AC3: 角色 Buff 和武器 Buff 可以同时显示在陈列区，不互相覆盖。
- AC4: 技能按钮弹窗中的已选 Buff 显示和删除逻辑保持正常。
- AC5: 本轮没有引入新的未接通缓存结构或半成品事件链路。
- AC6: `npm run build` 通过。

[给 Cursor 的执行指令]
- 需要修改的文件（如果已知）
  - `src/utils/storage.ts`
  - `src/components/SidePanel/components/DamageTab.tsx`
  - 如有必要，只允许小幅检查 `src/components/CanvasBoard/SkillButton.tsx`
- 实现顺序
  1. 先修 `storage.ts` 的 `characterName` 兼容值
  2. 再验证 `DamageTab.tsx` 的武器映射和 Buff 加载
  3. 再检查 `SkillButton.tsx` 当前 Buff 删除路径是否仍稳定
  4. 全局搜索确认没有残留半成品缓存改造
  5. 跑构建并手测
- 必须实现的逻辑
  - 修复武器 Buff 不显示
  - 保持当前已选 Buff 链路稳定
  - 不再引入 0.4.8 那种未收口的结构改造
- 不能动的部分
  - 不要重做 `useTimelineData.ts`
  - 不要引入 `buffRegistry + selectedBuffList` 新缓存结构
  - 不要新增事件驱动缓存同步方案
- 测试要求
  - 手测武器 Buff 刷新显示
  - 手测角色 Buff 刷新显示
  - 手测技能按钮 Buff 添加/删除
  - 执行 `npm run build`
