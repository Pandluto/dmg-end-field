# 主界面 Buff 计层阶段 Spec

## Status

草案中。

## Why

当前主界面技能按钮上的 Buff 已经有稳定的数据链：`def.all-buff-list.v1` 保存 Buff 定义实体，`def.skill-button.v1` 的 `selectedBuff` 保存技能按钮引用的 buffId，计算器按按钮上的 Buff 列表汇总数值。

现有逻辑默认正确：同一个按钮里，相同内容的 Buff 不允许重复添加；不同 Buff 可以共同参与计算。这个规则避免了误操作造成的重复挂载。

但新的业务需求需要表达一类特殊 Buff：它不是重复挂多个实体，而是同一个 Buff 在同一个按钮上存在层数。层数属于“按钮上的 Buff 实例状态”，不属于全局 Buff 定义。层数需要能被保存、刷新后恢复、参与伤害计算，并且能在主界面单按钮和 Buff 批量模式里被增减。

因此，本阶段要在不破坏默认去重逻辑的前提下，为主界面 Buff 数据链增加 `countable` 类别。

## Goal

本阶段目标是为主界面实际挂载到技能按钮上的 Buff 增加三类业务类别：

- `condition`：条件 Buff，不计层。
- `countable`：计层 Buff，同按钮内重复添加时增加层数。
- `passive`：被动 Buff，不计层。

`countable` Buff 定义使用现有 `value` 表示每层数值，使用 `maxStacks` 表示最大层数。技能按钮实例状态使用 `stackCount` 表示当前层数。计算时生效值为：

```ts
effectiveValue = value * clamp(button.buffStackCounts[buffId], 0, maxStacks)
```

本阶段不引入 `baseValue/perStackValue`。如果后续真实数据需要“初始值 + 每层值”的非等比模型，再作为后续阶段扩展。

## Scope

本阶段处理：

- 为技能按钮实际使用的 `SkillButtonBuff` 增加类别和层数字段。
- 为技能按钮实例状态增加 Buff 层数字段。
- 将可叠层 Buff 的创建入口限定在干员配置的天赋/技能/潜能 Buff 区。
- 让 AI CLI 的可叠层 Buff 数据写入干员配置的天赋/技能/潜能 Buff 区。
- 将干员 Buff 旧类别 `positive` 迁移为 `passive`。
- 兼容老 Buff：没有类别时按 `condition` 处理。
- 兼容老计算：非 `countable` Buff 继续使用 `value`。
- 修改添加 Buff 到按钮的业务规则，使 `countable` 重复添加时加一层。
- 修改移除/删减语义，使 `countable` 可以按层减少。
- 修改 Buff 汇总计算，使 `countable` 按层数计算有效值。
- 在主界面技能按钮 Buff 面板展示 `countable` 层数。
- 在 Buff 批量编辑增加/删减/编辑模式中支持 `countable` 层数操作。
- 保存、刷新、导入后保留层数字段。

本阶段不处理：

- 不改变 Buff 编辑器的完整表格结构。
- 不在 Buff 草稿页新增可叠层 Buff 创建入口。
- 不在主界面或 Buff 批量模式新增可叠层 Buff 创建入口。
- 不引入 `baseValue/perStackValue`。
- 不支持 `countable` 使用 `derivedValue`。
- 不把 `refCount` 改成层数。
- 不在 `selectedBuff` 中保存重复 buffId 表达层数。
- 不改变普通 `condition/passive` 的默认去重规则。
- 不重做伤害公式乘区。
- 不改变非主界面数据域的 category 规则。

## Data Model

系统 SHALL 在 Buff 定义实体中支持以下字段：

```ts
category?: 'condition' | 'countable' | 'passive';
maxStacks?: number;
```

定义字段语义：

- `category` 缺失时等价于 `condition`。
- `countable` 必须有有效 `maxStacks`。
- `condition` 和 `passive` 不读取 `maxStacks` 参与计算。
- `countable.maxStacks` 缺失或无效时，兼容读取时按 `1` 处理，但新建和编辑时必须填有效正整数。
- `refCount` 仍然只表示 Buff 实体被多少技能按钮引用，不表示层数。

系统 SHALL 在技能按钮实例状态中支持以下字段：

```ts
buffStackCounts?: Record<string, number>;
```

实例字段语义：

- key 是 `buffId`。
- value 是该技能按钮上该 Buff 的当前层数。
- 只有 `category=countable` 的 Buff 读取该字段。
- `countable` 首次挂载到按钮时，`buffStackCounts[buffId] = 1`。
- `stackCount` 缺失时兼容读取为 `1`。
- `stackCount` 始终 clamp 到 `0..maxStacks`。
- `buffStackCounts` 属于 `def.skill-button.v1` 中的技能按钮数据，不写入 `def.all-buff-list.v1`。

## Requirements

### Requirement: 唯一创建入口

系统 SHALL 只在干员配置的天赋/技能/潜能 Buff 区创建和维护可叠层 Buff 定义。

#### Scenario: 人工创建 Countable Buff

- WHEN 用户需要创建 `countable` Buff
- THEN 用户只能在干员配置页的天赋/技能/潜能 Buff 区选择 Buff 类别
- AND 当类别为 `countable` 时必须填写 `maxStacks`
- AND `countable` 只支持固定 `value`
- AND `countable` 不支持 `valueMode=derived`
- AND 主界面技能按钮弹窗不提供创建 `countable` Buff 定义的入口
- AND Buff 批量编辑界面不提供创建 `countable` Buff 定义的入口

#### Scenario: AI CLI 写入 Countable Buff

- WHEN AI CLI 生成或修改干员 Buff
- AND Buff 类别为 `countable`
- THEN 数据写入干员配置的天赋/技能/潜能 Buff 区
- AND 必须携带有效 `maxStacks`
- AND 不允许携带 `derivedValue`
- AND 后续主界面只从该干员 Buff 数据链读取并挂载

#### Scenario: 主界面消费 Countable Buff

- WHEN 主界面或 Buff 批量模式展示可添加 Buff
- THEN `countable` Buff 来源于干员配置的天赋/技能/潜能 Buff 数据
- AND 主界面只负责挂载、加层、减层、移除和计算
- AND 不在主界面修改该 Buff 的定义字段

### Requirement: Operator Buff 类别迁移

系统 SHALL 将干员 Buff 类别统一到 `condition/countable/passive`。

#### Scenario: 读取旧 Operator Buff

- WHEN 系统读取旧干员 Buff
- AND 旧类别为 `positive`
- THEN 系统按 `passive` 处理
- AND 保存或导出新数据时使用 `passive`

#### Scenario: 新建 Operator Buff

- WHEN 用户或 AI CLI 新建干员 Buff
- THEN `category` 只能是 `condition/countable/passive`
- AND 不再生成新的 `positive`

### Requirement: 老数据兼容

系统 SHALL 保证没有新字段的历史 Buff 继续按旧逻辑工作。

#### Scenario: 老 Buff 计算

- WHEN Buff 没有 `category`
- THEN 系统按 `condition` 处理
- AND 计算值仍使用原 `value`
- AND 不读取 `buffStackCounts/maxStacks`

#### Scenario: 老 Buff 重复添加

- WHEN 用户向同一按钮重复添加相同内容的老 Buff
- THEN 系统继续按现有重复内容判重
- AND 不新增引用
- AND 不改变该 Buff 的数值

### Requirement: Countable 数据规则

系统 SHALL 用技能按钮实例层数字段表达计层 Buff，而不是复制 Buff 引用，也不是修改全局 Buff 定义。

#### Scenario: Countable 新增到空按钮

- WHEN 用户向某按钮添加一个 `category=countable` 的 Buff
- AND 该按钮当前没有相同内容的 Buff
- THEN 系统创建或复用一个 Buff 实体
- AND 该按钮的 `selectedBuff` 增加该 buffId
- AND 该按钮的 `buffStackCounts[buffId]` 为 `1`
- AND `refCount` 只增加一次

#### Scenario: Countable 重复添加

- WHEN 用户向某按钮添加一个相同内容的 `countable` Buff
- AND 该按钮当前已有该 Buff
- THEN 系统不新增第二个 buffId
- AND 不改变 `refCount`
- AND 将该按钮的 `buffStackCounts[buffId]` 增加 `1`
- AND `buffStackCounts[buffId]` 不超过该 Buff 定义的 `maxStacks`

#### Scenario: Countable 达到最大层数

- WHEN 用户继续添加已达到 `maxStacks` 的 `countable` Buff
- THEN 系统保持 `buffStackCounts[buffId]=maxStacks`
- AND 不新增 buffId
- AND 不改变 `refCount`

### Requirement: Countable 移除规则

系统 SHALL 支持按层减少计层 Buff。

#### Scenario: 减少一层

- WHEN 用户对一个 `stackCount > 1` 的 `countable` Buff 执行一次普通移除
- THEN 系统将该按钮的 `buffStackCounts[buffId]` 减少 `1`
- AND 不从按钮 `selectedBuff` 移除该 buffId
- AND 不改变 `refCount`

#### Scenario: 减到零层

- WHEN 用户对一个 `stackCount = 1` 的 `countable` Buff 执行一次普通移除
- THEN 系统从该按钮 `selectedBuff` 移除该 buffId
- AND 系统移除该按钮的 `buffStackCounts[buffId]`
- AND 该 Buff 实体的 `refCount` 减少 `1`
- AND `refCount` 归零时按现有规则删除实体

#### Scenario: 移除全部

- WHEN 用户选择整条移除一个 `countable` Buff
- THEN 系统直接从该按钮 `selectedBuff` 移除该 buffId
- AND 系统移除该按钮的 `buffStackCounts[buffId]`
- AND 该 Buff 实体的 `refCount` 减少 `1`
- AND 不再逐层减少

### Requirement: 计算规则

系统 SHALL 在进入现有 Buff 汇总前计算有效值。

#### Scenario: 普通 Buff 计算

- WHEN Buff 类别为 `condition` 或 `passive`
- THEN `effectiveValue = value`
- AND 现有各类型加法或乘法逻辑保持不变

#### Scenario: Countable Buff 计算

- WHEN Buff 类别为 `countable`
- THEN `effectiveValue = value * clamp(button.buffStackCounts[buffId], 0, maxStacks)`
- AND 后续仍进入现有 `type` 分支
- AND 多个不同 Buff 仍按现有规则共同累加

### Requirement: 主界面单按钮 UI

系统 SHALL 在技能按钮详情中的 Buff 列表展示并操作层数。

#### Scenario: 展示 Countable

- WHEN 技能按钮已挂载 `countable` Buff
- THEN Buff 卡片显示 `stackCount/maxStacks`
- AND 显示类别为计层
- AND 显示每层数值和当前生效总值

#### Scenario: 单按钮加层

- WHEN 用户在单按钮 Buff 面板对 `countable` 点击增加层数
- THEN `stackCount + 1`
- AND 不超过 `maxStacks`
- AND 伤害结果立即按新层数刷新

#### Scenario: 单按钮减层

- WHEN 用户在单按钮 Buff 面板对 `countable` 点击减少层数
- THEN `stackCount - 1`
- AND 减到 `0` 时移除该 Buff
- AND 伤害结果立即刷新

### Requirement: Buff 批量编辑 UI

系统 SHALL 在批量编辑模式中将 `countable` 的添加和删减解释为层数增减。

#### Scenario: 批量增加一层

- WHEN 用户在 Buff 批量编辑增加模式中选择一个 `countable` Buff
- AND 点击一个目标技能按钮
- THEN 若目标按钮没有该 Buff，系统将其添加为 `1/maxStacks`
- AND 若目标按钮已有该 Buff，系统将其 `stackCount + 1`
- AND 该操作一次只增加一层
- AND 达到 `maxStacks` 的按钮不再增加

#### Scenario: 批量删减一层

- WHEN 用户在 Buff 批量编辑删减模式中选择一个 `countable` Buff
- AND 点击一个拥有该 Buff 的目标技能按钮
- THEN 系统将该按钮上的该 Buff 减少一层
- AND 减到 `0` 时移除该 Buff
- AND 该操作一次只减少一层

#### Scenario: 批量编辑多选按钮层数

- WHEN 用户进入编辑模式并选中多个技能按钮
- AND 共同 Buff 中包含 `countable`
- THEN 右区显示这些按钮各自的层数摘要
- AND 提供 `+1`、`-1`、`移除全部` 操作
- AND `+1/-1` 对所有选中按钮分别按自身层数执行

#### Scenario: 批量筛选

- WHEN 用户在筛选模式选择一个 `countable` Buff
- THEN 系统默认按“是否拥有该 Buff”筛选技能按钮
- AND 本阶段不提供按层数筛选

## Acceptance

- 老 Buff 没有 `category` 时仍可添加、移除和计算。
- `condition/passive` 相同内容重复添加仍被去重。
- `countable` 相同内容重复添加时只增加层数，不新增重复 buffId。
- 技能按钮上的 `buffStackCounts[buffId]` 不超过该 Buff 定义的 `maxStacks`。
- `countable` 计算值等于 `value * buffStackCounts[buffId]`。
- `refCount` 不因同按钮内加层变化。
- 单按钮 Buff 面板能显示并调整 `countable` 层数。
- 批量增加模式中点击一次目标按钮只增加一层。
- 批量删减模式中点击一次目标按钮只减少一层。
- 保存、刷新后层数仍保留。
- `npm run build` 通过。
