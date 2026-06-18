# 武器 Skill3 与装备三件套 Buff 机制统一 Spec

## Why

`operator-studio` 已经形成当前项目最完整的 Buff 编辑与数据表达能力，支持：

- `passive / condition / countable / multiplier / extraHit` 五类业务类型。
- 固定数值与来源值派生。
- 可叠层 Buff 的最大层数。
- 独立乘算系数。
- 额外伤害段。
- 统一 Buff typeKey、自动单位、描述和原文。
- 统一归一化、校验和旧数据兼容。

武器的 `skill3.effects` 和装备套装的 `threePieceBuffs` 已经能够维护基础 Buff 和额外伤害段，但仍使用各自的字段、校验和表格编辑逻辑，没有完整继承 `operator-studio` 的最新 Buff 机制。

当前 UI 还存在一个明确风险：如果继续把新增字段直接铺进 Sheet-Weapon 和 Sheet-Equipment 表格，会增加列、嵌套行和内联控件，破坏现有表格宽度、行高、键盘导航、fx 栏和资源管理器布局。

本轮目标是将 `operator-studio` 的完整 Buff 机制推广到：

- 武器 `skill3.effects`。
- 装备套装 `threePieceBuffs`。

同时吸取旧 UI 经验：表格只承担定位和摘要展示，完整 Buff 编辑统一放入可重复使用的小抽屉（小弹窗）中，不再为复杂字段扩展表格结构。

## Goals

- 武器 Skill3 和装备三件套可以表达与 `operator-studio` 等价的 Buff 业务能力。
- 三处 Buff 编辑器复用同一套领域定义、归一化、校验和表单规则。
- `operator-studio`、Sheet-Weapon、Sheet-Equipment 三处 GUI 全部切换到同一套小抽屉编辑方式。
- Sheet 表格的列数、基础行高、滚动区域和键盘导航不因 Buff 字段增加而改变。
- 用户可以从表格行快速打开、编辑、保存和切换 Buff。
- 旧武器、旧装备数据继续可读，并在编辑或保存时安全归一化。
- 下游配置、候选 Buff 和伤害计算不再为三种来源维护互相偏离的 Buff 解释规则。

## Non-Goals

本轮不处理：

- 将武器 `skill1 / skill2` 改造成完整 Buff 集合；本轮只处理 `skill3.effects`。
- 将单件装备的普通 `effects` 改造成完整 Buff；本轮只处理套装 `threePieceBuffs`。
- 重做 Sheet-Weapon 或 Sheet-Equipment 的整体表格结构。
- 在表格中新增 derived、层数、乘算、额外伤害等专用列。
- 将 Buff 抽屉做成新的独立 Buff Sheet。
- 修改武器 Skill3 的 Lv1-Lv9 等级体系。
- 为装备三件套增加不存在的等级体系。
- 自动改写历史分享文件或磁盘文件；迁移只在读取、编辑和显式保存链路发生。
- 修改 `weapon.fill`、`equipment.fill`、`equipment.setBuff` 等 AI schema、prompt、validator、adapter 或 Agent CLI。
- 要求旧 AI payload 支持本轮新增字段；AI 链路留到后续独立阶段。

## Core Decision

### 统一能力，不强制统一来源容器

三种来源 SHALL 复用同一套 Buff effect 核心定义和业务规则，但允许保留来源自身的容器差异：

- 干员 Buff：挂在 `buffs.talent / potential / skill`。
- 武器 Buff：挂在 `skills.skill3.effects`，保留 Lv1-Lv9 数值。
- 装备 Buff：挂在套装 `threePieceBuffs`，使用单值。

不得为了表面结构一致而删除武器等级数据，或为装备虚构等级数据。

### 表格只显示摘要

Sheet-Weapon 和 Sheet-Equipment SHALL 保持现有工作表定位。

复杂 Buff 字段 SHALL NOT 继续平铺为新列或新子行。表格中的 Buff 行只显示稳定摘要，例如：

- 名称。
- Effect ID。
- 业务类型。
- typeKey 或额外伤害类型。
- 当前值、当前等级值或简短公式摘要。
- 原文摘要。

完整编辑 SHALL 在小抽屉中完成。

## Shared Buff Capability

### 业务类型

统一业务类型为：

```ts
type BuffBusinessType =
  | 'passive'
  | 'condition'
  | 'countable'
  | 'multiplier'
  | 'extraHit';
```

语义：

- `passive`：无条件生效。
- `condition`：条件成立或用户选择后生效。
- `countable`：可按层数结算，必须提供最大层数。
- `multiplier`：对支持乘算的 Buff 区域提供独立乘算系数。
- `extraHit`：产生独立额外伤害段。

业务类型是编辑器层的统一概念。持久化时可以继续由 `category / multiplier / effectKind` 推导，但三处来源 SHALL 使用同一个推导和切换 helper。

### 核心字段

统一逻辑模型至少包含：

```ts
interface UnifiedBuffEffect {
  schemaVersion?: 2;
  effectId: string;
  name: string;
  type: string;
  category: 'passive' | 'condition' | 'countable';
  value?: number;
  maxStacks?: number;
  unit?: 'flat' | 'percent' | string;
  description?: string;
  raw?: string;
  valueMode?: 'fixed' | 'derived';
  derivedValue?: {
    source:
      | 'hp'
      | 'atk'
      | 'strength'
      | 'agility'
      | 'intelligence'
      | 'will'
      | 'sourceSkill';
    perPointValue: number;
  };
  effectKind?: 'modifier' | 'extraHit';
  extraHitConfig?: BuffExtraHitConfig;
  multiplier?: BuffMultiplier;
}
```

这是领域能力定义，不要求武器和装备立即把持久化接口改成完全相同的 TypeScript 名称。来源适配器 SHALL 将各自数据转换为该逻辑模型，再交给共享编辑器和共享校验器。

### typeKey

- 三种来源 SHALL 复用统一 Buff type registry。
- 不再分别维护互相偏离的 type 选项和中文标签。
- 搜索 SHALL 支持中文名称、typeKey 和已有关键词。
- 业务类型为 `extraHit` 时 SHALL 禁用普通 typeKey。
- `countable` 和 `multiplier` 只允许选择运行时支持的系数区类型。
- 单位 SHALL 根据 type registry 自动推导并只读展示，不允许来源页面自行写出冲突单位。

### 固定数值与来源值派生

- `fixed` 使用固定数值。
- `derived` 使用 `sourceValue * perPointValue`。
- 来源值固定为 `hp / atk / strength / agility / intelligence / will / sourceSkill`。
- 单个 effect 只允许一个来源值。
- 不支持任意公式字符串。
- `extraHit` 和 `multiplier` 不使用普通 fixed/derived value。
- `countable` 本轮只支持固定数值，不支持来源值派生。

### 可叠层

- `countable` SHALL 提供 `maxStacks`。
- `maxStacks` SHALL 为大于等于 1 的整数。
- 表格摘要 SHOULD 显示“每层值 × 最大层数”。
- 下游候选 Buff SHALL 保留层数能力，不得在来源适配阶段直接乘满层。

### 独立乘算

- `multiplier` SHALL 使用共享 `BuffMultiplier` 结构。
- 乘算系数必须大于 0。
- 只有 registry 标记为支持乘算的 typeKey 才能选择该业务类型。
- 切换离开 `multiplier` 时 SHALL 清理失效的 multiplier 字段。

### 额外伤害段

`extraHit` SHALL 复用共享 `BuffExtraHitConfig`，至少编辑：

- 伤害段 key。
- 伤害属性。
- 技能类型：空、`A / B / E / Q / Dot`。
- 攻击力倍率。

切换到 `extraHit` 时：

- `effectKind` 设为 `extraHit`。
- 清理普通 type、derived、multiplier 和 countable 专用字段。
- 使用统一默认值和归一化 helper。

切换离开 `extraHit` 时：

- `effectKind` 恢复为普通 modifier。
- 清理 `extraHitConfig`。

## Weapon Skill3 Rules

### 保留等级结构

武器 `skill3.effects.*.levels` SHALL 继续保存 Lv1-Lv9 数值。

共享编辑器打开武器 effect 时 SHALL 提供等级区域，但不把九个等级重新铺回主表格。

不同业务类型下，`levels[level]` 的含义为：

- `passive / condition / countable + fixed`：该等级的 Buff 数值。
- `derived`：该等级的 `perPointValue`。
- `multiplier`：该等级的乘算系数。
- `extraHit`：该等级的攻击力倍率。

共享领域层 SHALL 通过武器来源适配器解释这些等级值，不允许下游根据业务类型自行猜测。

### 当前等级预览

武器 Buff 抽屉 SHALL 允许选择一个预览等级。

- 默认使用当前已选单元格对应等级。
- 如果从 effect 摘要行打开，默认使用 Lv9，或沿用上次预览等级。
- 切换预览等级只改变编辑上下文，不改变当前武器配置。
- 等级输入 SHALL 保留现有明确录入原则，不自动线性补全。

### 分类兼容

- 旧 `category = passive` 保持 `passive`。
- 旧 `category = condition` 保持 `condition`。
- 新增 `countable`。
- 业务类型 `multiplier / extraHit` 仍通过专用字段表达，category 使用共享规范化结果。

## Equipment Three-Piece Rules

### 单值结构

装备 `threePieceBuffs` 不增加等级。每个 effect 使用单个：

- `value`。
- `derivedValue.perPointValue`。
- `multiplier.coefficient`。
- `extraHitConfig.baseMultiplier`。

具体使用哪个字段由业务类型决定。

### 旧 category 兼容

旧装备数据中的：

- `positive` SHALL 归一化为 `passive`。
- `passive` 保持 `passive`。
- `condition` 保持 `condition`。
- 空 category SHALL 使用安全默认值 `passive`，并允许用户在抽屉中修改。

新保存的数据 SHOULD 使用统一的 `passive / condition / countable` category，不再新增 `positive`。

### 多 Buff 保留

- `threePieceBuffs` 继续支持多个 effect。
- 旧单数 `threePieceBuff` 只作为读取兼容入口。
- 归一化后 SHALL 写入 `threePieceBuffs`。
- 保存新数据时 SHOULD 不再生成新的单数 `threePieceBuff`。

## Reusable Small Drawer

### 定位

系统 SHALL 提供一个可复用的紧凑 Buff 编辑抽屉，例如：

```ts
<BuffEffectEditorDrawer
  source="operator" | "weapon-skill3" | "equipment-three-piece"
  effect={...}
  levelContext={...}
  onChange={...}
  onClose={...}
/>
```

具体组件名可以调整，但 SHALL 只有一套核心表单和字段切换规则。

本轮 SHALL 同时改造三处 GUI，不保留两套并行的完整 Buff 表单：

- `operator-studio` 原右侧常驻完整 Buff 表单改为紧凑 Buff 列表、摘要和打开抽屉入口。
- Sheet-Weapon 的 Skill3 effect 使用同一抽屉。
- Sheet-Equipment 的三件套 Buff 使用同一抽屉。

共享抽屉 SHALL 是三处完整 Buff 字段的唯一主要编辑入口。来源页面可以保留新增、复制、删除、选择和摘要，但不得继续各自维护一套完整字段表单。

### 布局要求

- 抽屉作为 workspace 上层浮层出现，不参与表格 grid 布局计算。
- 打开和关闭抽屉不得改变表格列宽。
- 打开和关闭抽屉不得改变表格行高。
- 打开和关闭抽屉不得重建 visibleRows。
- 抽屉内容过长时内部滚动，不推动页面整体高度。
- 桌面宽度足够时优先使用右侧小抽屉。
- 窄窗口下可以退化为居中的小弹窗，但不得变成全屏编辑页。
- 同一时间只允许打开一个 Buff 抽屉。

### Header

抽屉 header SHALL 显示：

- 来源：干员、武器 Skill3 或装备三件套。
- 当前 effect 名称。
- Effect ID。
- 武器来源时显示当前预览等级。
- 关闭按钮。

### Form Sections

抽屉表单 SHOULD 按以下顺序组织：

1. 基础：名称、Effect ID、业务类型。
2. 类型：typeKey 搜索选择和自动单位。
3. 数值：fixed/derived、等级值、来源值、每点提升。
4. 专用配置：最大层数、乘算系数或额外伤害段。
5. 文本：描述、原文。

不适用于当前业务类型的字段 SHALL 隐藏，而不是禁用后长期占位。

### 打开入口

Operator Studio：

- 双击 Buff effect 列表项打开。
- 选中 effect 后通过“编辑 Buff”按钮打开。
- 新增或复制 effect 后 SHOULD 自动打开抽屉。
- 原右侧常驻表单 SHALL 移除，右侧区域只保留分组切换、effect 列表、摘要和基础操作。

Sheet-Weapon：

- 双击 `skill3` effect 行打开。
- effect 行右键菜单提供“编辑 Buff”。
- 选中 effect 行后可通过 fx 区或明确按钮打开。
- 新增或复制 effect 后 SHOULD 自动打开抽屉。

Sheet-Equipment：

- 双击 `threePieceBuff` 行打开。
- 三件套 Buff 行右键菜单提供“编辑 Buff”。
- 选中三件套 Buff 行后可通过 fx 区或明确按钮打开。
- 新增或复制三件套 Buff 后 SHOULD 自动打开抽屉。

单击仍只负责表格选中，不直接弹出抽屉，避免破坏现有键盘和单元格编辑节奏。

Operator Studio 的 effect 列表同样遵循单击选中、双击编辑，避免用户浏览列表时反复弹出抽屉。

### 编辑与关闭

- 抽屉字段修改 SHALL 实时写入当前 draft，并标记未保存。
- 关闭抽屉不等于保存到本地库。
- Escape 关闭抽屉；如果搜索下拉正在打开，第一次 Escape 只关闭下拉。
- 点击抽屉外部 MAY 关闭，但不得丢失已写入 draft 的修改。
- 删除 effect 仍需要确认，避免误操作。
- 抽屉关闭后 SHALL 保持来源表格当前行选中并可继续键盘导航。

## Table Protection Requirements

### Operator Studio

- 原 Buff 区域的完整字段表单 SHALL 移除。
- 保留 `天赋 / 潜能 / 技能` 分组切换。
- 保留 effect 列表、新增、复制、删除。
- 列表项显示名称、业务类型、typeKey 和数值摘要。
- 选中 effect 时显示紧凑详情摘要和“编辑 Buff”入口。
- 打开抽屉不得压缩技能预览、Hit 细节或 Buff 列表宽度。
- 抽屉关闭后保持当前 Buff 分组和 effect 选中状态。

### Sheet-Weapon

- 不新增 Buff 机制专用列。
- 不因 derived、countable、multiplier、extraHit 增加新的层级行。
- 现有 effect 行和 effectLevels 行数量规则保持稳定。
- effectLevels 行可继续承担紧凑等级摘要或快速值编辑，但完整业务编辑以抽屉为准。
- 当业务类型导致原单元格无法安全表达时，单元格显示摘要并通过抽屉编辑，不塞入复合控件。

### Sheet-Equipment

- 不新增三件套 Buff 专用列。
- `threePieceBuffHeader` 和 `threePieceBuff` 行结构保持稳定。
- 不为 derived、countable、multiplier、extraHit 新增子行。
- 三件套 Buff 的复杂字段统一由抽屉编辑。

### fx 栏

- fx 栏继续反映当前单元格，不承担完整 Buff 表单。
- 简单字段若已有稳定直接编辑行为可以保留。
- 业务类型切换、来源值派生、层数、乘算和额外伤害配置 SHALL 进入抽屉。
- fx 栏 MAY 提供“打开 Buff 编辑器”按钮或只读摘要。

## Shared Domain Extraction

当前 `operatorDraftBuffModel.ts` 中与干员来源无关的能力 SHOULD 下沉到共享 Buff 领域模块，包括：

- 业务类型列表和显示名。
- typeKey 搜索、label 和 registry 访问。
- 单位推导。
- business type 推导与切换。
- fixed/derived 切换。
- derived source 和 perPointValue 更新。
- countable 最大层数。
- multiplier 归一化与校验。
- extraHit 默认值、归一化与校验。
- effect 摘要生成。
- 字段互斥清理。

`operatorDraftBuffModel.ts` SHOULD 只保留干员分组、干员 draft 适配等来源特有逻辑。

武器和装备 SHALL 各自提供薄适配器：

- 将来源数据转换为共享编辑模型。
- 将共享编辑结果写回来源结构。
- 处理武器等级值或装备单值差异。
- 处理旧字段兼容。

不得复制一份新的 operator Buff helper 到两个页面组件中。

## Normalization and Validation

### 读取归一化

读取旧武器或装备数据时 SHALL：

- 补 `schemaVersion` 或按旧版本解释。
- 规范 category。
- 规范 valueMode。
- 规范 derivedValue。
- 规范 maxStacks。
- 规范 multiplier。
- 规范 extraHitConfig。
- 清理与当前业务类型冲突的字段。
- 保留未知 typeKey 和原文，不因 registry 未识别而静默丢弃数据。

### 保存校验

保存当前武器或装备库前 SHALL 使用共享校验器。

至少阻止：

- 缺失 Effect ID。
- 同一容器内 Effect ID 冲突。
- derived 缺失来源或 perPointValue。
- countable 缺失合法 maxStacks。
- multiplier 缺失合法系数或使用不支持乘算的 typeKey。
- extraHit 缺失合法配置。
- 武器需要的等级值非法。

校验失败时：

- 不写入本地库或磁盘文件。
- 保持抽屉打开。
- 将焦点定位到首个错误字段。
- 错误信息使用业务字段名，不只输出内部路径。

## Import and Export Compatibility

- 武器当前草稿、本地库、分享导入导出 SHALL 保留新增 Buff 字段。
- 装备当前草稿、本地库、磁盘 JSON、分享导入导出 SHALL 保留新增 Buff 字段。
- 干员当前草稿、本地库、分享导入导出 SHALL 继续保留完整 Buff 字段。
- 本轮不修改任何 AI、Agent CLI、fill schema、prompt、validator 或 adapter。
- 现有 AI 写入的数据继续按当前能力工作；若无法表达本轮新增字段，不在本轮补齐。
- GUI 手工编辑、保存、导入和导出是本轮唯一要求完整支持的新数据入口。

## Downstream Consumption

### 配置阶段

- `passive` 继续按来源规则在配置阶段自动结算。
- `condition` 不默认自动结算，进入候选 Buff。
- `countable` 进入候选 Buff 并保留最大层数。
- `multiplier` 进入统一乘区链路。
- `extraHit` 进入统一额外伤害段链路。
- `derived` 在运行时读取当前配置上下文中的来源值。

### 来源信息

标准化 Buff SHALL 保留来源信息：

```ts
interface BuffSourceRef {
  source: 'operator' | 'weapon' | 'equipment';
  ownerId: string;
  slot: string;
  effectId: string;
  level?: number;
}
```

示例：

- 武器：`source=weapon, slot=skill3, level=9`。
- 装备：`source=equipment, slot=threePiece`。

候选 Buff、日志和伤害明细不得只显示 effect 名称而丢失来源。

## Requirements

### Requirement: 武器完整 Buff

- WHEN 用户编辑武器 Skill3 effect
- THEN 可以选择五种统一业务类型
- AND 可以使用适用于该业务类型的完整字段
- AND Lv1-Lv9 数据仍被保留

### Requirement: 装备完整 Buff

- WHEN 用户编辑装备三件套 effect
- THEN 可以选择五种统一业务类型
- AND 可以使用固定值、来源值、层数、乘算或额外伤害配置
- AND 不新增装备等级结构

### Requirement: 共享编辑器

- WHEN 用户从 operator-studio、武器表格或装备表格打开 Buff
- THEN 使用同一套小抽屉核心表单
- AND 字段显示、切换清理、校验和摘要规则与 operator-studio 一致

### Requirement: 三处 GUI 全量切换

- WHEN 本轮 GUI 改造完成
- THEN operator-studio SHALL 不再保留原完整 Buff 常驻表单
- AND 武器 Skill3 SHALL 不再依赖表格复合控件完成复杂 Buff 编辑
- AND 装备三件套 SHALL 不再依赖表格复合控件完成复杂 Buff 编辑
- AND 三处完整编辑 SHALL 统一进入小抽屉

### Requirement: 表格不重排

- WHEN Buff 抽屉打开、编辑或关闭
- THEN 表格列宽、行高和 visibleRows SHALL 保持不变
- AND 当前选择和滚动位置 SHALL 保持稳定

### Requirement: 旧数据兼容

- WHEN 页面读取旧武器或装备 Buff
- THEN 系统 SHALL 正常展示和编辑
- AND 不因缺少新字段而报错
- AND 只有显式保存时才持久化归一化后的新结构

### Requirement: 统一下游语义

- WHEN 相同业务类型分别来自干员、武器或装备
- THEN 下游计算 SHALL 使用同一套解释规则
- AND 不应因来源不同产生 category、单位、层数、乘算或额外伤害语义偏差

## Acceptance Criteria

- 武器 Skill3 支持 `passive / condition / countable / multiplier / extraHit`。
- 装备三件套支持 `passive / condition / countable / multiplier / extraHit`。
- 两者支持 operator-studio 已有的 fixed/derived、maxStacks、multiplier 和 extraHit 能力。
- typeKey、label、搜索、单位和乘算支持范围来自统一 registry。
- 武器保留 Lv1-Lv9；装备保持单值。
- 武器和装备使用同一个 Buff 小抽屉核心表单。
- operator-studio 同步使用该 Buff 小抽屉核心表单。
- operator-studio 原右侧完整 Buff 常驻表单已移除，替换为紧凑列表、摘要和编辑入口。
- 新增和复制 Buff 后可以直接进入抽屉编辑。
- 表格不新增复杂 Buff 列或嵌套行。
- 打开抽屉不改变表格列宽、行高、visibleRows、滚动位置和当前选择。
- 旧 `positive` 装备 category 可读取并归一为 `passive`。
- 旧 `threePieceBuff` 可读取并归一到 `threePieceBuffs`。
- 旧武器 Skill3 effect 可继续读取和编辑。
- 保存前使用共享校验器，并能定位首个错误字段。
- 干员、武器、装备的 GUI 保存和分享导入导出保留完整字段。
- 本轮未修改 AI schema、prompt、validator、adapter 或 Agent CLI。
- 配置、候选 Buff、乘算和额外伤害链路能消费三种来源的统一语义。
- `npm run build` 通过。

## Open Questions

- 武器 effectLevels 行是否继续允许快速编辑数值，还是全部改为只读等级摘要。
- 抽屉是否需要显式“完成”按钮；本 spec 默认采用实时写入 draft、关闭即完成编辑。
- 武器 derived、multiplier、extraHit 的 Lv1-Lv9 是否全部复用现有 `levels` 字段，还是在持久化层拆分为更明确的字段；无论选择哪种实现，下游必须通过武器适配器读取，不能直接猜测。
