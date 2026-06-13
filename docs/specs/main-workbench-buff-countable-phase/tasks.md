# 主界面 Buff 计层阶段 Tasks

## Status

草案中。

## Tasks

- [ ] 为 `SkillButtonBuff` 增加 `category?: 'condition' | 'countable' | 'passive'`。
- [ ] 为 `SkillButtonBuff` 增加 `maxStacks?: number`。
- [ ] 为技能按钮数据增加 `buffStackCounts?: Record<string, number>`。
- [ ] 在干员配置页天赋/技能/潜能 Buff 区支持选择 `condition/countable/passive`。
- [ ] 在干员配置页天赋/技能/潜能 Buff 区中，`countable` 必须填写 `maxStacks`。
- [ ] 在干员配置页天赋/技能/潜能 Buff 区中，`countable` 不允许使用 `valueMode=derived`。
- [ ] 将干员 Buff 旧类别 `positive` 读取为 `passive`。
- [ ] 保存或导出干员 Buff 时不再生成新的 `positive`。
- [ ] 在干员配置页保存 `countable` Buff 定义。
- [ ] 让 AI CLI operator fill/check/apply 接受并验证 `countable` Buff。
- [ ] 让 AI CLI operator fill/check/apply 要求 `countable.maxStacks` 为有效正整数。
- [ ] 让 AI CLI operator fill/check/apply 拒绝 `countable` 携带 `derivedValue`。
- [ ] 确认主界面和 Buff 批量模式不提供创建 `countable` Buff 定义的入口。
- [ ] 新增 Buff 类别归一化 helper，缺失类别默认 `condition`。
- [ ] 新增 Countable 层数归一化 helper，从技能按钮 `buffStackCounts[buffId]` 读取并 clamp 到 `0..maxStacks`。
- [ ] 新增 Buff 有效值 helper，`countable` 返回 `value * buttonStackCount`，其它返回 `value`。
- [ ] 修改 `calculateBuffTotals`，所有类型分支使用 Buff 有效值。
- [ ] 修改 `getBuffIdentityKey`，把 `category/maxStacks` 纳入同内容签名。
- [ ] 确认 `getBuffIdentityKey` 不包含按钮实例层数。
- [ ] 修改 `addBuffToButton`，非 `countable` 重复添加保持现有 duplicate 行为。
- [ ] 修改 `addBuffToButton`，`countable` 重复添加时对当前按钮的 `buffStackCounts[buffId]` 加一层。
- [ ] 修改 `addBuffToButton`，`countable` 首次添加时写入 `buffStackCounts[buffId]=1`。
- [ ] 修改 `addBuffToButton`，`countable` 加层不改变 `refCount`。
- [ ] 新增 `decrementBuffStackOnButton(buttonId, buffId)`，支持 `countable` 减一层。
- [ ] 保留 `removeBuffFromButton(buttonId, buffId)` 作为整条移除 API。
- [ ] 整条移除时删除 `buffStackCounts[buffId]`。
- [ ] 修改清空按钮 Buff 逻辑，清空时仍按整条解绑处理。
- [ ] 修改复制按钮 Buff 逻辑，复制时保留 `countable` 当前层数。
- [ ] 修改去重/归并逻辑，合并 buffId 时同步迁移每个按钮的 `buffStackCounts` key。
- [ ] 在技能按钮 Buff 列表中显示 Buff 类别。
- [ ] 在技能按钮 Buff 列表中显示 `countable` 的 `stackCount/maxStacks`。
- [ ] 在技能按钮 Buff 列表中显示 `countable` 的当前生效值。
- [ ] 在技能按钮 Buff 列表中为 `countable` 提供 `+1` 操作。
- [ ] 在技能按钮 Buff 列表中为 `countable` 提供 `-1` 操作。
- [ ] `countable` 在单按钮 UI 减到 0 时移除该 Buff。
- [ ] 批量增加模式中，`countable` 点击目标按钮解释为加一层。
- [ ] 批量增加模式中，目标按钮没有该 `countable` 时添加为 1 层。
- [ ] 批量增加模式中，目标按钮已满层时不继续增加。
- [ ] 批量增加模式中，按钮下方的 `+n` 草稿标记能表达本轮将增加的层数。
- [ ] 批量删减模式中，`countable` 点击目标按钮解释为减一层。
- [ ] 批量删减模式中，`countable` 减到 0 时移除该 Buff。
- [ ] 批量删减模式中，按钮下方的 `-n` 草稿标记能表达本轮将减少的层数。
- [ ] 批量编辑模式共同 Buff 区展示 `countable` 层数摘要。
- [ ] 批量编辑模式为共同 `countable` 提供 `+1` 操作。
- [ ] 批量编辑模式为共同 `countable` 提供 `-1` 操作。
- [ ] 批量编辑模式为共同 `countable` 提供 `移除全部` 操作。
- [ ] 筛选模式选择 `countable` 时仍按拥有该 Buff 筛选，不按层数筛选。
- [ ] 确认保存/刷新后，`countable` 的 `stackCount/maxStacks` 保留。
- [ ] 补充单元测试：老 Buff 无 category 仍按旧值计算。
- [ ] 补充单元测试：旧 operator `positive` 读取为 `passive`。
- [ ] 补充单元测试：普通 Buff 重复添加仍去重。
- [ ] 补充单元测试：`countable` 重复添加只加层不增引用。
- [ ] 补充单元测试：`countable` 计算值为 `value * buffStackCounts[buffId]`。
- [ ] 补充单元测试：`countable` 不超过 `maxStacks`。
- [ ] 运行 `npm run build`。

## Explicit Non-Tasks

- [ ] 不引入 `baseValue/perStackValue`。
- [ ] 不支持 `countable` 的 `derivedValue`。
- [ ] 不用重复 buffId 表达层数。
- [ ] 不把 `refCount` 改成层数。
- [ ] 不把按钮实例层数写入 Buff 定义实体。
- [ ] 不在 Buff 草稿页新增可叠层创建入口。
- [ ] 不在主界面或 Buff 批量模式新增可叠层创建入口。
- [ ] 不改变非主界面数据域的 category 规则。
- [ ] 不重做 Buff 编辑器完整表格。
