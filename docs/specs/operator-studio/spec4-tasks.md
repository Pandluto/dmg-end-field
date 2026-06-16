# Operator Studio Spec 4 Tasks - 技能 ID 类型化命名与列表筛选

## Status

本任务用于实现 `docs/specs/operator-studio/spec4.md` 中定义的“技能 ID 类型化命名与列表筛选”。

已确认边界：

- 技能 ID 由系统维护，用户不可直接编辑。
- `skills` 的 key 会进入 `RuntimeOperatorTemplateSkill.id`，并作为画布按钮 `runtimeSkillId` 的来源。
- 当前正式按钮类型仍为 `A / B / E / Q`。
- `Dot` 只属于 hit 技能乘区，不变成技能按钮类型。
- “其他”在本阶段是筛选桶，不要求新增正式 `Other` 类型。
- 不迁移已经存在于画布快照、时间轴或历史报告中的旧 `runtimeSkillId`。
- 兼容补丁只做主界面读取链路解析，不手动转换、不写回历史排轴数据。
- 默认不补测试，除非实现中发现命名迁移风险需要覆盖。

## Tasks

- [ ] Task 1: 补充技能 key helper
  - [ ] 在 `src/components/OperatorDraftPage.tsx` 增加类型化 skill key 构造函数。
  - [ ] 支持 `skill-{type}-{index}` 格式。
  - [ ] 增加从 `buttonType` 读取分桶类型的 helper。
  - [ ] 增加按类型查找下一个可用 key 的 helper。
  - [ ] 保持旧 key 的数字尾号解析只用于显示名 fallback，不作为类型来源。

- [ ] Task 2: 新增技能使用新 key
  - [ ] 修改 `getNextSkillKey` 或替换为 `getNextSkillKeyByType`。
  - [ ] `handleAddSkill` 默认创建 `skill-A-{index}`。
  - [ ] 新增技能仍默认 `buttonType = A`。
  - [ ] 新增后同步 `skillOrder`。
  - [ ] 新增后选中新增技能和 `hit1`。

- [ ] Task 3: 复制技能使用新 key
  - [ ] `duplicateSelectedSkill` 读取被复制技能的 `buttonType`。
  - [ ] 复制结果生成 `skill-{buttonType}-{index}`。
  - [ ] 复制旧 key 技能时也使用新格式。
  - [ ] 复制后保留 displayName、iconUrl、hitMeta、hitCount 等原技能内容。
  - [ ] 复制后同步 `skillOrder` 和选中项。

- [ ] Task 4: 升级整理命名
  - [ ] 将现有 `reorderDraftStructure` 改为按类型重建 skill key。
  - [ ] 整理时按当前 `skillOrder` 或 `orderedDraft` 顺序遍历。
  - [ ] 每个 `buttonType` 单独从 1 开始计数。
  - [ ] 整理结果生成 `skill-A-1 / skill-B-1 / skill-E-1 / skill-Q-1` 等 key。
  - [ ] 整理时保留技能内容、图标、hit、倍率和 buffs。
  - [ ] 整理时继续把 hit key 规范为 `hit1 / hit2...`。
  - [ ] 整理后同步 `selectedSkillKey` 到迁移后的对应 key。
  - [ ] 整理后同步 `selectedHitKey` 到有效 hit。
  - [ ] 将操作消息改为“已整理技能命名与 hit 编号”。

- [ ] Task 5: 调整整理按钮文案
  - [ ] 将基础数据区现有“整理”按钮文案改为“整理命名”。
  - [ ] 确认按钮仍调用升级后的整理命名逻辑。
  - [ ] 不新增重复的全局整理按钮。

- [ ] Task 6: 增加技能列表筛选状态
  - [ ] 在 `OperatorDraftPage` 增加 `activeSkillTypeFilter` 状态。
  - [ ] 筛选值支持 `all / A / B / E / Q / other`。
  - [ ] 计算每个筛选桶数量。
  - [ ] 计算筛选后的 `displayedSkillEntries`。
  - [ ] 其他桶匹配非 `A / B / E / Q` 的异常技能类型。

- [ ] Task 7: 渲染筛选按钮
  - [ ] 在技能列表 header 下方或 header actions 中渲染 6 个按钮。
  - [ ] 按钮文案为 `全部 / A / B / E / Q / 其他`。
  - [ ] 每个按钮显示对应数量。
  - [ ] 当前筛选按钮高亮。
  - [ ] 点击筛选按钮只改变列表展示状态。
  - [ ] 样式沿用现有 `operator-draft` 按钮体系，不引入新的重视觉组件。

- [ ] Task 8: 列表渲染改用筛选结果
  - [ ] 技能列表 map 从 `skillEntries` 改为 `displayedSkillEntries`。
  - [ ] header 数量显示当前筛选结果数量，或以 `当前/总数` 方式展示。
  - [ ] 筛选结果为空时显示空态。
  - [ ] 拖拽排序只在当前展示列表中操作时行为可预期。
  - [ ] 若拖拽排序在筛选状态下容易产生歧义，可在非“全部”筛选下禁用拖拽排序，并给出轻量提示。

- [ ] Task 9: 筛选与选中项同步
  - [ ] 切换筛选后，如果当前 `selectedSkillKey` 仍可见，则保持选中。
  - [ ] 如果当前选中项被筛选隐藏，则选中筛选结果中的第一个技能。
  - [ ] 如果筛选结果为空，则清空 `selectedSkillKey` 和 `selectedHitKey`。
  - [ ] 从空筛选切回全部时，恢复到第一个有效技能。

- [ ] Task 10: 按钮类型变更后的行为
  - [ ] 修改技能 `buttonType` 后不立即重写 key。
  - [ ] 修改后当前筛选如果不再匹配该技能，应按筛选同步规则处理选中项。
  - [ ] 用户点击“整理命名”后再将 key 校正到新类型。
  - [ ] 确认 Markdown 预览、导出 JSON 使用当前 key 和当前 `buttonType`。

- [ ] Task 11: Runtime 链路确认
  - [ ] 确认 `buildRuntimeSkillFromDraft` 继续使用 skill key 作为 runtime skill id。
  - [ ] 确认本地干员技能沙盒读到的是整理后的 `skill-{type}-{index}`。
  - [ ] 确认新拖拽到画布的本地技能按钮 `runtimeSkillId` 为类型化 key。
  - [ ] 不处理旧画布按钮的历史 `runtimeSkillId` 迁移。

- [ ] Task 12: 主界面旧 runtimeSkillId 读取兼容
  - [ ] 找到主界面解析按钮技能模板的入口。
  - [ ] 优先检查 `src/core/services/skillDamageTemplateResolver.ts`。
  - [ ] 当 `button.runtimeSkillId` 直接命中新 runtime skill id 时，保持现有逻辑。
  - [ ] 当旧 `runtimeSkillId` 未命中时，在内存中尝试兼容解析。
  - [ ] 兼容解析不修改按钮对象。
  - [ ] 兼容解析不写回 timeline、canvas、localStorage 或 snapshot。
  - [ ] 对 `skill-1 / skill-2...` 这类旧 key，按当前干员技能顺序建立旧顺序到新 key 的映射。
  - [ ] 若旧 key 无法精确映射，但按钮 `skillType` 对应当前干员同类型唯一技能，可以作为兜底。
  - [ ] 若同类型存在多个候选，则不猜测，继续现有 fallback。
  - [ ] 保留原有未命中 warning 或补充兼容解析日志。

- [ ] Task 13: AI / 导入兼容确认
  - [ ] `parseImportedDraft` 继续接受旧 `skill-1` key。
  - [ ] 分享导入继续接受旧 key。
  - [ ] AI apply 生成的旧 key 不阻塞进入编辑器。
  - [ ] 用户可通过“整理命名”显式迁移 AI 或导入结果。
  - [ ] 如实现成本低，可在导入成功消息中提示可点击“整理命名”。

- [ ] Task 14: Verification
  - [ ] 手测旧数据 `skill-1 / skill-2` 点击整理后变为 `skill-A-1 / skill-B-1` 等。
  - [ ] 手测新增技能生成 `skill-A-{index}`。
  - [ ] 手测复制 E/Q 技能生成同类型下一个 key。
  - [ ] 手测修改 `buttonType` 后点击整理命名，key 进入新类型桶。
  - [ ] 手测 `全部 / A / B / E / Q / 其他` 筛选。
  - [ ] 手测筛选为空、选中项被隐藏、切回全部的行为。
  - [ ] 手测保存到本地、导出 JSON、分享导出保留类型化 key。
  - [ ] 手测旧排轴按钮在不写回数据的情况下能解析到整理后的本地技能。
  - [ ] 手测无法确定映射时沿用现有 fallback，且按钮数据不变。
  - [ ] 运行 `npm run build`。

## Notes

- 若实现过程中需要抽出公共 helper，应优先保持局部简单，不为单页逻辑引入过度抽象。
- 如果拖拽排序在筛选状态下实现复杂，优先限制为“全部”筛选可拖拽，避免局部列表排序影响全量顺序时产生误解。
- 只有当 key 迁移 helper 复杂到容易回归时，再补最小测试；本轮默认以手测和 build 验证为主。
