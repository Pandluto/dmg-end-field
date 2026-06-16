# Operator Studio Spec 4 - 技能 ID 类型化命名与列表筛选

## Why

`operator-studio` 当前用 `skills: Record<string, OperatorDraftSkill>` 维护技能集合，技能 key 通常是 `skill-1 / skill-2 / skill-3...`。这个 key 不只是页面内部列表编号，运行时模板会把它派生为 `RuntimeOperatorTemplateSkill.id`，画布按钮也会把它作为 `runtimeSkillId` 保存。

当一个干员存在多个同类技能，或不同数据版本中技能顺序发生变化时，`skill-1` 这类全局顺序 ID 缺少技能类型信息，跨版本兼容性较差。更稳定的方式是把技能按钮类型写入系统维护 ID，例如 `skill-A-1 / skill-B-1 / skill-E-1 / skill-Q-1`，并让每一类从 1 开始编号。

Spec 4 的目标是优化 `operator-studio` 的技能数据结构命名规则和列表操作体验：技能 ID 由系统维护，支持一键整理旧命名；技能列表提供按类型筛选，方便维护多技能干员。

## What Changes

- 技能 ID 由系统维护，用户不可直接编辑。
- 新增系统技能 ID 格式：`skill-{type}-{index}`。
- `type` 来自 `OperatorDraftSkill.buttonType`，而不是从旧 key 推断。
- `A / B / E / Q` 四类技能各自从 1 开始编号。
- 预留“其他”筛选桶，用于兼容未来或异常数据；当前正式按钮类型仍以现有 `A / B / E / Q` 为准。
- 新增技能和复制技能时使用新 ID 规则。
- 现有“整理”能力升级为“整理命名”，一键把旧的 `skill-1` 等 key 改成类型化 ID。
- 技能列表顶部增加 6 个筛选按钮：`全部 / A / B / E / Q / 其他`。
- 筛选只影响列表展示和选择体验，不改变 `skills` 的保存顺序。
- 运行时模板继续使用技能 key 作为 `RuntimeOperatorTemplateSkill.id`，因此整理后的 ID 会自然成为更稳定的 `runtimeSkillId`。
- 主界面读取旧排轴数据时增加兼容解析补丁：旧 `runtimeSkillId` 不写回、不改 storage，只在数据链路消费时按同一套规律解析到类型化技能。

## Scope

本阶段处理：

- 定义 `operator-studio` 技能 ID 新格式。
- 调整新增技能、复制技能、整理命名的系统 ID 生成规则。
- 保留旧数据读取能力。
- 提供一键整理旧技能命名的页面操作。
- 在技能列表区域增加类型筛选按钮。
- 确保导出 JSON、保存本地库、分享库导出都保留整理后的 key。
- 确保运行时模板消费整理后的技能 ID。
- 确保主界面读取旧排轴数据时可以兼容旧 `runtimeSkillId`。

本阶段不处理：

- 改写官方角色技能 ID，例如 `official-A`。
- 把 hit key 从 `hit1 / hit2` 改成新的命名规则。
- 修改画布按钮实例自身的按钮 id。
- 批量迁移已经保存到时间轴或画布快照里的旧 `runtimeSkillId`。
- 手动或自动写回历史排轴数据中的旧 `runtimeSkillId`。
- 为用户提供手动编辑 skill key 的输入框。
- 引入任意自定义技能类型。
- 将 `Dot` 变成技能按钮类型；`Dot` 仍只属于 hit 技能乘区。

## Current Code Facts

- 页面组件是 `src/components/OperatorDraftPage.tsx`。
- `OperatorDraft.skills` 当前是 `Record<string, SkillDraft>`。
- `SkillDraft.buttonType` 当前只允许 `A / B / E / Q`。
- 新增和复制技能当前通过 `getNextSkillKey(draft)` 找 `skill-${index}`。
- 现有 `handleReorderDraft` 会把技能重排为 `skill-1...n`，并同步 hit key。
- `operatorTemplateAdapter` 会把 `skillKey` 直接写入 `RuntimeOperatorTemplateSkill.id`。
- 画布技能按钮会保存 `runtimeSkillId`，用于技能切换和伤害模板解析。

## Data Model

### Skill Key Format

系统维护的技能 key SHALL 使用以下格式：

```txt
skill-{type}-{index}
```

其中：

- `type` 为技能按钮类型。
- 当前正式类型为 `A / B / E / Q`。
- `index` 为同类型内从 1 开始的正整数。

示例：

```txt
skill-A-1
skill-A-2
skill-B-1
skill-E-1
skill-Q-1
```

### Type Source

类型 SHALL 从技能对象的 `buttonType` 字段读取：

```ts
interface OperatorDraftSkill {
  displayName: string;
  buttonType: 'A' | 'B' | 'E' | 'Q';
  iconUrl: string;
  hitCount: number;
  hitMeta: Record<string, OperatorDraftHit>;
}
```

系统 SHALL NOT 从旧 key 的文本推断技能类型。旧 key 只作为待整理输入。

### Other Bucket

技能列表筛选 SHALL 提供“其他”桶。

当前正式数据结构下，`buttonType` 不包含其他类型，因此“其他”主要用于以下情况：

- 导入或旧数据中存在异常 `buttonType`。
- 未来若扩展按钮类型，可先在 UI 层有稳定位置。

在 Spec 4 中，系统不要求新增 `Other` 到正式 `SkillButtonType` 类型。若后续确实需要第五类正式技能按钮，应另开 spec 明确数据类型、运行时计算、图标和画布交互规则。

## Naming Rules

### 新增技能

新增技能默认 `buttonType = A`。

系统 SHALL 为新增技能生成下一个可用的 `skill-A-{index}`。

示例：

```txt
已有：skill-A-1, skill-B-1
新增：skill-A-2
```

### 复制技能

复制技能 SHALL 保留被复制技能的 `buttonType`，并在同类型下生成下一个可用 key。

示例：

```txt
复制 skill-E-1
生成 skill-E-2
```

如果复制的是旧 key，例如 `skill-5`，但该技能 `buttonType = E`，则新 key SHALL 为 `skill-E-{nextIndex}`。

### 整理命名

“整理命名” SHALL 按当前技能顺序遍历技能，并按 `buttonType` 分桶计数。

每遇到一个技能：

1. 读取其 `buttonType`。
2. 将该类型计数加 1。
3. 生成 `skill-{buttonType}-{count}`。
4. 复制原技能内容到新 key。
5. 保留技能内部字段和 hit 数据。

示例：

```txt
整理前：
skill-1 -> buttonType A
skill-2 -> buttonType A
skill-3 -> buttonType B
skill-4 -> buttonType E
skill-5 -> buttonType E
skill-6 -> buttonType Q

整理后：
skill-A-1
skill-A-2
skill-B-1
skill-E-1
skill-E-2
skill-Q-1
```

整理命名 SHALL 同步更新：

- `draft.skills`
- `skillOrder`
- 当前选中的 `selectedSkillKey`
- 当前选中的 `selectedHitKey`

整理命名 SHOULD 继续整理 hit key 为 `hit1 / hit2...`，保持现有整理能力不倒退。

### Key Collision

系统生成 key 时 SHALL 避免和当前 `draft.skills` 中已有 key 冲突。

在“整理命名”场景中，系统会重建整个 `skills` 对象，因此只需要保证重建结果内唯一。

在新增和复制场景中，系统 SHALL 从目标类型的 1 开始查找下一个未占用 key。

## Requirements

### Requirement: 系统维护 Skill ID

系统 SHALL 维护技能 key，用户不可直接编辑技能 key。

#### Scenario: 用户编辑技能表单

- WHEN 用户选中某个技能
- THEN 页面 SHALL 允许编辑技能名、按钮类型、图标和 hit
- AND 页面 SHALL NOT 提供可手动修改 skill key 的输入框

#### Scenario: 保存草稿

- WHEN 用户保存当前草稿
- THEN 系统 SHALL 使用当前 `skills` 对象 key 作为持久化技能 ID
- AND 不应由用户输入覆盖该 key

### Requirement: 类型化 Skill ID

系统 SHALL 为新增和复制技能生成类型化 key。

#### Scenario: 新增默认技能

- GIVEN 当前草稿没有 `skill-A-1`
- WHEN 用户点击新增技能
- THEN 系统 SHALL 创建 `skill-A-1`
- AND 新技能 `buttonType` SHALL 为 `A`

#### Scenario: 同类型连续新增

- GIVEN 当前草稿已有 `skill-A-1`
- WHEN 用户再次新增默认技能
- THEN 系统 SHALL 创建 `skill-A-2`

#### Scenario: 复制 E 技能

- GIVEN 当前选中技能 `buttonType = E`
- WHEN 用户点击复制技能
- THEN 系统 SHALL 创建下一个 `skill-E-{index}`
- AND 复制后的技能 SHALL 保留原技能内容

### Requirement: 整理旧命名

系统 SHALL 提供一键整理命名能力。

#### Scenario: 旧 key 迁移

- GIVEN 当前技能 key 为 `skill-1 / skill-2 / skill-3`
- AND 对应 `buttonType` 为 `A / B / A`
- WHEN 用户点击整理命名
- THEN 系统 SHALL 重建 key 为 `skill-A-1 / skill-B-1 / skill-A-2`
- AND 保留原技能显示名、图标、hit 和倍率

#### Scenario: 已是新格式

- GIVEN 当前技能 key 已经是 `skill-A-1 / skill-B-1`
- WHEN 用户点击整理命名
- THEN 系统 SHALL 重新按当前顺序和类型校正编号
- AND 如果顺序和类型未变化，输出结果 SHOULD 保持等价

#### Scenario: 选中项同步

- GIVEN 用户整理前选中了某个旧 key
- WHEN 整理命名完成
- THEN 页面 SHALL 选中对应迁移后的新 key
- AND hit 选中项 SHALL 指向该技能下有效 hit

### Requirement: 技能列表筛选

系统 SHALL 在技能列表顶部提供类型筛选。

#### Scenario: 展示筛选按钮

- WHEN 页面展示技能列表
- THEN 列表区域 SHALL 提供 `全部 / A / B / E / Q / 其他` 六个筛选按钮
- AND 每个按钮 SHOULD 显示该筛选下的技能数量

#### Scenario: 点击 A 筛选

- WHEN 用户点击 `A`
- THEN 列表 SHALL 只展示 `buttonType = A` 的技能
- AND 不改变 `draft.skills` 的真实顺序
- AND 不改变 `skillOrder`

#### Scenario: 点击全部

- WHEN 用户点击 `全部`
- THEN 列表 SHALL 展示所有技能

#### Scenario: 当前选中项被筛选隐藏

- GIVEN 当前选中技能是 `buttonType = Q`
- WHEN 用户切换到 `A` 筛选
- THEN 详情区域 SHOULD 切换到筛选结果中的第一个技能
- AND 如果筛选结果为空，详情区域 SHOULD 显示空态

### Requirement: 按钮类型变更后的整理

系统 SHALL 允许用户继续编辑技能 `buttonType`，但 key 不立即由用户手动改写。

#### Scenario: 修改按钮类型

- GIVEN 当前技能 key 为 `skill-A-1`
- WHEN 用户将按钮类型改为 `E`
- THEN 技能内容 SHALL 更新为 `buttonType = E`
- AND key 可以暂时保持 `skill-A-1`
- AND 用户点击整理命名后 SHALL 改为对应的 `skill-E-{index}`

### Requirement: Runtime 消费

系统 SHALL 让运行时模板使用整理后的 skill key。

#### Scenario: Draft 转 Runtime

- WHEN `OperatorDraft` 转换为 `RuntimeOperatorTemplate`
- THEN `RuntimeOperatorTemplateSkill.id` SHALL 等于整理后的 skill key

#### Scenario: 画布拖拽本地技能

- WHEN 用户从本地干员技能沙盒拖拽技能到画布
- THEN 画布按钮的 `runtimeSkillId` SHOULD 使用类型化技能 key

### Requirement: 主界面读取旧排轴引用兼容

系统 SHALL 在主界面数据消费链路中兼容旧排轴数据的 `runtimeSkillId`。

#### Scenario: 旧 runtimeSkillId 解析到新技能

- GIVEN 本地干员技能已经整理为 `skill-{type}-{index}`
- AND 历史排轴按钮仍保存旧 `runtimeSkillId`，例如 `skill-1`
- WHEN 主界面读取该按钮并解析技能模板
- THEN 系统 SHOULD 在内存解析阶段尝试把旧 key 映射到对应的新 key
- AND 使用新 key 对应的技能模板参与展示、切换或伤害计算
- AND 不应把新 key 写回历史排轴 storage

#### Scenario: 已是新格式

- GIVEN 排轴按钮的 `runtimeSkillId` 已经是 `skill-A-1` 等新格式
- WHEN 主界面读取该按钮
- THEN 系统 SHALL 直接按新 key 解析
- AND 不走旧 key 兼容映射

#### Scenario: 无法确定映射

- GIVEN 排轴按钮的旧 `runtimeSkillId` 无法可靠映射到当前干员技能
- WHEN 主界面读取该按钮
- THEN 系统 SHALL 保持现有 fallback 行为
- AND 不应修改按钮数据
- AND 不应清空 `runtimeSkillId`

#### Scenario: 按类型唯一兜底

- GIVEN 排轴按钮缺少可精确映射的新 key
- AND 按钮有 `skillType`
- AND 当前干员同 `skillType` 下只有一个技能
- WHEN 主界面解析技能模板
- THEN 系统 MAY 使用该同类型唯一技能作为兼容结果
- AND 如果同类型存在多个技能，则不应猜测

## UI Requirements

### 技能列表 Header

技能列表 header SHALL 继续显示：

- 标题：`技能列表`
- 当前筛选结果数量或总数量
- 新增技能
- 复制技能
- 删除技能

列表 header 或其下方 SHALL 增加筛选按钮组：

```txt
全部  A  B  E  Q  其他
```

### 整理命名按钮

现有基础数据区的“整理”按钮 SHALL 改为更明确的文案：

```txt
整理命名
```

点击后执行类型化 key 整理，并保留现有 hit 编号整理能力。

## Acceptance Criteria

- 新增技能默认生成 `skill-A-{index}`。
- 复制技能按被复制技能的 `buttonType` 生成 `skill-{type}-{index}`。
- 类型化 key 的 `index` 在每个类型内从 1 开始。
- 整理命名能把旧 `skill-1` 样式 key 改成 `skill-A-1` 等新格式。
- 整理命名以 `buttonType` 为类型来源，不从旧 key 推断。
- 整理命名保留技能内容、图标、hit、倍率和 Buff 结构。
- 整理命名同步 `skillOrder`、当前选中技能和当前选中 hit。
- 整理命名继续整理 hit key 为 `hit1 / hit2...`。
- 技能列表提供 `全部 / A / B / E / Q / 其他` 六个筛选按钮。
- 筛选只影响展示，不改变保存数据顺序。
- 当前正式 `SkillButtonType` 仍为 `A / B / E / Q`。
- `Dot` 不作为技能按钮类型。
- 导出 JSON、保存本地库和分享导出保留类型化 skill key。
- `RuntimeOperatorTemplateSkill.id` 使用类型化 skill key。
- 画布新拖拽的本地技能按钮可获得类型化 `runtimeSkillId`。
- 主界面读取旧排轴数据时可以兼容旧 `runtimeSkillId`。
- 兼容补丁只影响读取和解析，不写回历史排轴数据。
- 无法确定映射时保持现有 fallback，不清空旧字段。

## Open Questions

- “其他”是否后续要成为正式按钮类型，需要另开 spec 决定；Spec 4 只保留筛选桶。
- 是否需要对已存在时间轴、画布快照或历史报告中的旧 `runtimeSkillId` 做真实迁移，本阶段不处理。
- AI apply 是否应在写入编辑器前自动整理 skill key，还是继续交给用户点击“整理命名”；本阶段建议保留用户显式整理。
