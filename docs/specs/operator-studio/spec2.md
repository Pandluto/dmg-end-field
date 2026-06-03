# Operator Studio Spec 2 - 干员自带 Buff 内联编辑

## Why

武器和装备已经可以在自身数据里内联维护 Buff / effect，并在后续配置页、候选 Buff 和计算链路中作为数据来源。干员本身也存在同类能力来源，例如天赋、潜能、技能附带的常驻或条件效果。

当前 `/operator-studio` 只维护干员基础信息、属性矩阵、技能和 hit 倍率，没有独立维护干员自带 Buff 的能力。这会导致干员自身的天赋、潜能、技能增益无法像武器、装备一样进入统一的配置和候选 Buff 链路。

Spec 2 的目标是在 `operator-studio` 中新增“干员自带 Buff 内联编辑”能力：Buff 在数据结构上挂到干员顶层，按 `talent / potential / skill` 三类组织，每类可以维护多个 effects。页面保存、导入、导出、分享和旧数据归一化都必须兼容这套新结构。

## What Changes

- `OperatorDraft` 顶层新增干员 Buff 数据。
- 干员 Buff 分为三组：`talent`、`potential`、`skill`。
- 每组支持多个内联 effect。
- effect 不引用外部 Buff 库，不使用 `buffId` 绑定。
- effect 类型与武器/装备内联 effect 思路对齐，但干员自带 Buff 本身不提供档位设置。
- effect 分类至少支持 `positive` 和 `condition`。
- effect 的 `type` SHALL 复用现有 Buff / Weapon / Equipment 已使用的 typeKey 体系，不为干员另开一套字段命名。
- `skill` 分组只表示“技能类 Buff”，不绑定具体技能 id。
- 旧干员草稿首次加载或归一化时自动补空 Buff 结构。
- 保存到本地、当前草稿缓存、导出 JSON、分享库导出、分享库导入均保留 Buff 结构。
- 页面右侧布局重构：压缩“技能预览”和“Hit 细节”，移除原命令输出/日志列，把右侧主要空间用于 Buff 编辑。
- `OperatorConfigPage` 消费干员配置时必须接收干员自带 Buff。
- `OperatorConfigPage` 中干员自身 `positive` Buff 应在配置阶段立即结算到自身配置结果。
- 主界面候选 Buff 搜索后续应能搜到来自干员自身的 Buff。

## Scope

本阶段处理：

- 定义 `OperatorDraft` 顶层 Buff 结构。
- 定义 `talent / potential / skill` 三类 Buff 来源。
- 定义内联 effect 的基础字段。
- 定义旧数据兼容和归一化规则。
- 定义 `operator-studio` 页面布局调整。
- 定义 Buff 编辑区的核心交互。
- 定义保存、导入、导出、分享对新字段的保留规则。
- 定义下游配置页和候选 Buff 链路的消费要求。
- 明确 `positive` 与 `condition` 的配置页处理边界。
- 明确 `potential` Buff 本阶段也是纯 Buff，不做潜能档位或潜能开关。

本阶段不处理：

- 重新设计完整 Buff Sheet。
- 从外部 Buff 库选择并绑定 `buffId`。
- 自动把干员 Buff 写入 Buff Sheet 本地库。
- 在主界面完整展示干员自带 Buff 来源详情。
- 完整实现所有 `condition` Buff 的触发开关和战斗状态。
- 重写 `OperatorConfigPage` 全部 UI。
- 改主界面选人流程。
- 改武器或装备 Buff 数据结构。

## Data Model

### OperatorDraft 顶层结构

`OperatorDraft` SHALL 在顶层新增 `buffs` 字段：

```ts
interface OperatorDraft {
  id: string;
  name: string;
  avatarUrl: string;
  rarity: number;
  profession: string;
  weapon: string;
  element: string;
  mainStat: string;
  subStat: string;
  level: number;
  attributes: OperatorDraftAttributeLevels;
  skills: Record<string, OperatorDraftSkill>;
  buffs: OperatorDraftBuffs;
}
```

### Buff 分组结构

```ts
interface OperatorDraftBuffs {
  talent: OperatorDraftBuffGroup;
  potential: OperatorDraftBuffGroup;
  skill: OperatorDraftBuffGroup;
}
```

三组语义：

- `talent`：干员天赋、职业特性或常驻能力来源。
- `potential`：干员潜能带来的能力来源。
- `skill`：干员技能描述中产生的增益、减益、状态或候选效果。

`skill` group 只表达“该 effect 来源于干员技能体系”，不在 Spec 2 中绑定具体技能 id 或 `skills` 中的 skill key。

`potential` group 在 Spec 2 中同样按纯 Buff 处理，不随潜能档位变化，也不按 0 潜/满潜做开关。

### Buff Group

```ts
interface OperatorDraftBuffGroup {
  effects: Record<string, OperatorDraftBuffEffect>;
}
```

每组可以有 0 到多个 effect。key 可以使用 `effect1 / effect2 / effect3...` 或稳定自定义 key。

### Effect 结构

```ts
type OperatorDraftBuffCategory = 'positive' | 'condition';

interface OperatorDraftBuffEffect {
  effectId: string;
  name: string;
  type: string;
  category: OperatorDraftBuffCategory;
  value?: number;
  unit?: 'flat' | 'percent' | string;
  description?: string;
  raw?: string;
}
```

字段语义：

- `effectId`：effect 在当前 group 内的稳定 id。
- `name`：effect 展示名。
- `type`：效果类型字段，后续映射到统一 Buff / panel / candidate 识别字段。
- `category`：效果分类。
- `value`：纯 Buff 数值。无数值型 Buff 可以不填。
- `unit`：数值单位，例如 `flat` 或 `percent`。
- `description`：结构化描述文本。
- `raw`：原始描述文本，可选。

干员自带 Buff SHALL NOT 在本阶段维护 `levels` 或档位矩阵。它是跟随干员模板存在的纯 Buff，而不是随技能等级、角色等级或潜能档位自动变化的数值表。

`type` SHALL 复用项目现有 typeKey 体系，例如武器、装备、Buff 已使用的 `atkPercentBoost / sourceSkillBoost / physicalDmgBonus` 等字段。系统 SHALL NOT 为干员自带 Buff 创建一套独立的同义 type 字段。

`category` 语义：

- `positive`：无条件正向效果，配置页应立即结算到当前干员自身配置结果。
- `condition`：条件效果，只作为候选 Buff 或后续条件开关来源，不在配置页默认自动结算。

## Default Shape

新建干员时，默认 Buff 结构为：

```ts
buffs: {
  talent: { effects: {} },
  potential: { effects: {} },
  skill: { effects: {} },
}
```

旧草稿缺少 `buffs` 字段时，归一化 SHALL 自动补齐该结构。

旧草稿缺少其中某个 group 时，归一化 SHALL 只补缺失 group，不删除已有 group。

旧草稿中某个 group 缺少 `effects` 时，归一化 SHALL 补为 `{}`。

## Requirements

### Requirement: 顶层 Buff 字段

系统 SHALL 在 `OperatorDraft` 顶层维护干员自带 Buff。

#### Scenario: 新建干员

- WHEN 用户在 `operator-studio` 新建干员
- THEN 新草稿 SHALL 包含 `buffs.talent.effects`
- AND 包含 `buffs.potential.effects`
- AND 包含 `buffs.skill.effects`
- AND 三者默认均为空对象

#### Scenario: 读取旧干员

- WHEN 页面读取旧版 `OperatorDraft`
- AND 该草稿缺少 `buffs`
- THEN 系统 SHALL 自动补齐空白 `buffs` 结构
- AND 不改变旧草稿已有基础字段、属性、技能和 hit 数据

#### Scenario: 导入旧分享

- WHEN 用户导入旧版本地干员库分享 JSON
- AND 条目缺少 `buffs`
- THEN 系统 SHALL 在解析或保存前补齐空白 `buffs`

### Requirement: Buff 来源分组

系统 SHALL 将干员 Buff 按 `talent / potential / skill` 三类维护。

#### Scenario: 天赋 Buff

- WHEN 用户维护干员天赋或职业特性相关效果
- THEN effect SHALL 写入 `buffs.talent.effects`

#### Scenario: 潜能 Buff

- WHEN 用户维护干员潜能相关效果
- THEN effect SHALL 写入 `buffs.potential.effects`

#### Scenario: 技能 Buff

- WHEN 用户维护干员技能相关效果
- THEN effect SHALL 写入 `buffs.skill.effects`
- AND 不要求绑定具体技能 id

### Requirement: 内联 Effect

系统 SHALL 在干员草稿内内联保存 effect，不通过外部 Buff 库引用。

#### Scenario: 新增 effect

- WHEN 用户在某个 Buff group 下新增 effect
- THEN 页面 SHALL 创建一个新的 `OperatorDraftBuffEffect`
- AND 该 effect SHALL 写入当前干员草稿
- AND 不写入 Buff Sheet 本地库

#### Scenario: 编辑 effect

- WHEN 用户编辑 effect 名称、type、category、value、unit、description 或 raw
- THEN 页面 SHALL 更新当前干员草稿中的内联 effect
- AND 当前编辑不应隐式保存到本地干员库，除非用户执行保存

#### Scenario: 删除 effect

- WHEN 用户删除某个 effect
- THEN 页面 SHALL 从对应 group 的 `effects` 中删除该 effect
- AND 不影响其他 group 的 effect

### Requirement: Effect 分类

系统 SHALL 支持 `positive` 和 `condition` 两类 effect。

#### Scenario: Positive effect

- WHEN effect.category 为 `positive`
- THEN 系统 SHALL 视为干员自身无条件正向效果
- AND `OperatorConfigPage` 消费该干员配置时 SHOULD 立即结算该 effect
- AND 结算结果作用于当前干员自身配置

#### Scenario: Condition effect

- WHEN effect.category 为 `condition`
- THEN 系统 SHALL 视为条件效果
- AND 不应在配置页默认自动结算
- AND SHOULD 进入候选 Buff 链路，供后续手动选择、搜索或条件开关消费

### Requirement: 页面布局重构

系统 SHALL 重构 `operator-studio` 右侧编辑空间，为 Buff 编辑区腾出位置。

#### Scenario: 技能预览压缩

- WHEN 页面展示技能预览
- THEN 技能预览区域 SHALL 保留
- AND 高度或内容密度 SHALL 压缩
- AND 不再占用整列主要空间

#### Scenario: Hit 细节压缩

- WHEN 页面展示 Hit 细节
- THEN Hit 编辑能力 SHALL 保留
- AND 与技能预览上下排列或紧凑排列
- AND 不阻塞右侧 Buff 编辑区

#### Scenario: 删除命令输出列

- WHEN 页面进入 Spec 2 布局
- THEN 原右侧命令输出 / 日志区域 SHALL 移除
- AND 该空间 SHALL 用于 Buff 编辑

#### Scenario: Buff 编辑列

- WHEN 页面展示 Spec 2 布局
- THEN 右侧 SHALL 提供干员 Buff 编辑区
- AND 用户可以在 `talent / potential / skill` 三类之间切换或同时查看
- AND 用户可以编辑每类下的 effects

### Requirement: Buff 编辑 UI

系统 SHALL 提供足够完成内联 effect 维护的 UI。

#### Scenario: Group 切换

- WHEN 用户进入 Buff 编辑区
- THEN 页面 SHALL 使用横向三个按钮切换 `天赋 / 潜能 / 技能`
- AND 每组显示当前 effect 数量或空态
- AND 三个按钮互斥，当前选中组高亮
- AND 切换控件 SHALL 尽量节省右侧空间

#### Scenario: Effect 列表

- WHEN 某个 group 有多个 effects
- THEN 页面 SHALL 展示 effect 列表
- AND 支持选择当前 effect
- AND 支持新增、复制、删除 effect

#### Scenario: Effect 表单

- WHEN 用户选中 effect
- THEN 页面 SHALL 展示 effect 表单
- AND 至少可编辑 `name / type / category / value / unit / description`
- AND `category` 可选 `positive / condition`

#### Scenario: 纯 Buff 数值编辑

- WHEN 用户编辑数值型 effect
- THEN 页面 SHALL 支持编辑单个 `value`
- AND `value` SHALL 保存为 number
- AND 页面 SHALL NOT 提供等级或档位矩阵

### Requirement: 保存与缓存

系统 SHALL 在保存和缓存链路中保留干员 Buff。

#### Scenario: 当前草稿缓存

- WHEN 当前草稿写入 `def.operator-editor.draft.v1`
- THEN SHALL 包含 `buffs`

#### Scenario: 保存到本地库

- WHEN 当前草稿写入 `def.operator-editor.library.v1`
- THEN SHALL 包含 `buffs`
- AND 不丢失任何 group 或 effect

#### Scenario: 覆盖旧条目

- WHEN 用户覆盖本地库旧条目
- THEN 新写入条目 SHALL 使用归一化后的 `buffs`

### Requirement: 导入导出分享

系统 SHALL 在导入导出分享链路中保留干员 Buff。

#### Scenario: 导出当前 JSON

- WHEN 用户导出当前草稿 JSON
- THEN JSON SHALL 包含 `buffs`

#### Scenario: 导出本地库分享

- WHEN 用户导出本地干员库分享文件
- THEN 每个导出的 `OperatorDraft` SHALL 包含 `buffs`

#### Scenario: 导入分享

- WHEN 用户导入分享文件
- THEN 系统 SHALL 保留分享文件中的 `buffs`
- AND 对缺失 `buffs` 的旧条目自动补空结构

### Requirement: Runtime 适配

系统 SHALL 将干员 Buff 从 `OperatorDraft` 传递到运行时消费模型。

#### Scenario: Draft 转 Runtime

- WHEN `OperatorDraft` 转换为 `RuntimeOperatorTemplate`
- THEN runtime 模型 SHALL 能携带干员自带 Buff
- AND 不得在转换过程中丢弃 `buffs`

#### Scenario: Local operator adapter

- WHEN 主界面或配置页通过 `localOperatorAdapter` 读取本地干员
- THEN 读取结果 SHALL 能包含干员自带 Buff

### Requirement: OperatorConfigPage 消费

系统 SHALL 让 `OperatorConfigPage` 能接收干员自带 Buff。

#### Scenario: 配置页读取当前干员

- WHEN `OperatorConfigPage` 读取来自 `operator-studio` 的本地干员
- THEN 当前干员数据 SHALL 携带 `buffs`

#### Scenario: Positive Buff 立即结算

- WHEN 当前干员存在 `category = positive` 的自带 Buff
- THEN `OperatorConfigPage` SHALL 在配置阶段将其结算到当前干员自身配置结果
- AND 该结算应发生在生成最终配置快照前
- AND 后续展示是否明确显示该来源可以留到下一阶段

#### Scenario: Condition Buff 不默认结算

- WHEN 当前干员存在 `category = condition` 的自带 Buff
- THEN `OperatorConfigPage` SHALL 保留该 Buff
- AND 不默认自动结算到面板
- AND 后续可通过候选 Buff 或条件开关消费

### Requirement: 主界面候选 Buff 消费

系统 SHALL 让主界面后续能搜索和消费干员自带 Buff。

#### Scenario: 搜索干员 Buff

- WHEN 用户在主界面 Buff 搜索中输入干员自带 Buff 名称
- THEN 系统 SHOULD 能返回来自 `operator-studio` 的候选 Buff
- AND 候选 Buff 应携带来源干员 id
- AND 候选 Buff 应能区分 `talent / potential / skill`
- AND `positive` 与 `condition` 都可以被搜索出来

#### Scenario: 来源标记

- WHEN 干员自带 Buff 进入候选列表
- THEN 候选数据 SHOULD 标记来源为干员自身
- AND 包含 owner operator id
- AND 不与武器、装备、Buff Sheet 来源混淆

## Acceptance Criteria

- `OperatorDraft` 顶层新增 `buffs` 结构。
- `buffs` 按 `talent / potential / skill` 三组组织。
- 每组支持多个内联 effects。
- effect 支持 `name / type / category / value / unit / description / raw`。
- `category` 至少支持 `positive / condition`。
- 干员自带 Buff 不提供 `levels` 或档位设置。
- 旧草稿和旧分享导入时自动补空 `buffs`。
- 新建干员默认包含空 `buffs`。
- 当前草稿缓存、本地库保存、导出 JSON、分享导入导出均保留 `buffs`。
- `operator-studio` 右侧布局为 Buff 编辑区腾出空间。
- 原命令输出 / 日志区域从 Spec 2 布局中移除。
- 技能预览和 Hit 细节保留但压缩。
- Buff 编辑 UI 支持三组切换、effect 列表、effect 增删复制和表单编辑。
- Runtime 适配链路不丢弃干员 Buff。
- `OperatorConfigPage` 能接收干员自带 Buff。
- `OperatorConfigPage` 对 `positive` 干员 Buff 在配置阶段立即结算。
- `condition` 干员 Buff 不默认结算，保留为候选或后续条件消费。
- 主界面候选 Buff 搜索后续能返回干员自带 Buff。
- Buff 编辑区使用横向三个按钮切换 `天赋 / 潜能 / 技能`。
- `skill` group 不绑定具体技能 id。
- `potential` group 不做潜能档位或潜能开关。
- effect `type` 复用现有 typeKey 体系。

## Open Questions

- `positive` 立即结算时，具体进入 `ConfigSnapshot` 的哪个字段映射表需要单独定义。
- 主界面候选 Buff 搜索的来源标记字段命名是否使用 `origin: 'operatorStudio'`。
