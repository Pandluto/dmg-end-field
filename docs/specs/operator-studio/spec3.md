# Operator Studio Spec 3 - 来源值派生 Buff

## Why

Spec 2 已经支持干员顶层 Buff，并支持 `positive` Buff 在 `operator-config` 中立即结算。但有些干员能力的数值不是固定值，而是来自当前面板中的某个来源值。

例如：

```txt
每点智识都会使攻击力额外 +0.10%。
每点意志都会使攻击力额外 +0.10%。
```

这类效果不需要任意公式系统，也不需要用户写表达式。它只需要把 Buff effect 的 `value` 从“手填固定数值”扩展为“从固定来源值读取，并按每点提升多少换算运行时数值”。

Spec 3 的目标是定义这种“来源值派生 Buff”：它仍然是干员顶层 Buff，仍然使用现有 `type` 体系，但其数值可以由当前面板来源值实时派生。

## What Changes

- `OperatorDraftBuffEffect` 的数值来源新增两种模式：
  - 固定数值。
  - 来源值派生。
- 来源值派生不是任意公式，只能选择一个固定来源值。
- 来源值派生的计算形式固定为：

```txt
derivedValue = sourceValue * perPointValue
```

- 不支持多来源求和。如果需要“智识 + 意志”，应拆成两个 effect。
- 不支持用户输入任意公式。
- 不支持派生 Buff 互相递归结算。
- 派生 Buff 应在普通面板值和普通 Buff 结算后段处理，以读取尽量实时的当前面板来源值。
- 百分比字段是否转换为小数，仍由已有 `type` 规则决定，而不是由派生模式决定。

## Scope

本阶段定义：

- 来源值派生 Buff 的数据结构。
- 固定来源值列表。
- 固定数值模式与来源值派生模式的关系。
- `operator-studio` UI 应如何录入来源值派生 Buff。
- `operator-config` 中派生 Buff 的基础结算原则。
- 不做求和、不做任意公式、不做递归的边界。

本阶段先不完整定义：

- `operator-config` display 环节如何具体重算和展示派生链。
- 主界面伤害计算中，勾选 `condition` 派生 Buff 后如何专门计算。
- 派生 Buff 在伤害计算链里的完整代码路径。

上述两个问题会作为 Spec 3 后续章节继续补充。

## Data Model

### Effect 扩展

Spec 3 在 Spec 2 的 `OperatorDraftBuffEffect` 上新增可选 `valueMode` 和 `derivedValue`。

```ts
type OperatorBuffValueMode = 'fixed' | 'derived';

interface OperatorDraftBuffEffect {
  effectId: string;
  name: string;
  type: string;
  category: 'positive' | 'condition';
  value?: number;
  unit?: 'flat' | 'percent' | string;
  description?: string;
  raw?: string;

  valueMode?: OperatorBuffValueMode;
  derivedValue?: OperatorBuffDerivedValue;
}
```

字段语义：

- `valueMode = fixed`：使用 `value` 作为固定数值。
- `valueMode = derived`：使用 `derivedValue` 计算运行时数值。
- 缺少 `valueMode` 时，按 `fixed` 兼容处理。
- `derivedValue` 只在 `valueMode = derived` 时生效。
- `value` 可以在运行时 snapshot 中保存计算后的结果，但草稿真相源不应依赖手填 `value`。

### 来源值派生结构

```ts
interface OperatorBuffDerivedValue {
  source: OperatorBuffDerivedSource;
  perPointValue: number;
}
```

语义：

```txt
runtimeValue = selectedSourceValue * perPointValue
```

### 固定来源值

来源值只能从以下 7 个字段中选择：

```ts
type OperatorBuffDerivedSource =
  | 'hp'
  | 'atk'
  | 'strength'
  | 'agility'
  | 'intelligence'
  | 'will'
  | 'sourceSkill';
```

含义：

- `hp`：当前生命值。
- `atk`：当前攻击力。
- `strength`：当前力量。
- `agility`：当前敏捷。
- `intelligence`：当前智识。
- `will`：当前意志。
- `sourceSkill`：当前源石技艺强度。

不支持的来源：

- 不支持 `mainStat`。
- 不支持 `subStat`。
- 不支持多个来源求和。
- 不支持自定义表达式。

### 示例：顿悟

“每点智识使攻击力额外 +0.10%”：

```json
{
  "effectId": "enlightenment-intelligence",
  "name": "顿悟 - 智识",
  "type": "atkPercentBoost",
  "category": "positive",
  "valueMode": "derived",
  "derivedValue": {
    "source": "intelligence",
    "perPointValue": 0.001
  },
  "description": "每点智识都会使攻击力额外+0.10%。"
}
```

“每点意志使攻击力额外 +0.10%”：

```json
{
  "effectId": "enlightenment-will",
  "name": "顿悟 - 意志",
  "type": "atkPercentBoost",
  "category": "positive",
  "valueMode": "derived",
  "derivedValue": {
    "source": "will",
    "perPointValue": 0.001
  },
  "description": "每点意志都会使攻击力额外+0.10%。"
}
```

如果当前智识为 `97`，意志为 `233`：

```txt
智识派生值 = 97 * 0.001 = 0.097
意志派生值 = 233 * 0.001 = 0.233
```

当 `type = atkPercentBoost` 时，这两个值进入现有百分比归一化/展示规则。是否显示成 `9.7% / 23.3%` 由现有 type 显示逻辑决定。

## Requirements

### Requirement: Value Mode

系统 SHALL 支持 effect 的数值来源模式。

#### Scenario: 固定数值 Buff

- WHEN effect.valueMode 缺失或为 `fixed`
- THEN 系统 SHALL 使用 Spec 2 的 `value` 逻辑
- AND 不要求存在 `derivedValue`

#### Scenario: 来源值派生 Buff

- WHEN effect.valueMode 为 `derived`
- THEN 系统 SHALL 使用 `derivedValue.source` 读取当前来源值
- AND 使用 `derivedValue.perPointValue` 乘以来源值
- AND 计算出的结果作为该 effect 的运行时 value

### Requirement: 单来源限制

系统 SHALL 只允许一个 effect 选择一个来源值。

#### Scenario: 智识和意志都参与

- WHEN 一个能力描述同时提到智识和意志
- THEN 用户 SHALL 创建两个 effect
- AND 一个 effect 使用 `source = intelligence`
- AND 另一个 effect 使用 `source = will`
- AND 系统 SHALL NOT 在单个 effect 内维护来源值求和

### Requirement: 固定来源列表

系统 SHALL 只允许从固定 7 个来源值中选择。

#### Scenario: 选择来源值

- WHEN 用户编辑来源值派生 Buff
- THEN UI SHALL 提供来源值选择器
- AND 选择器只包含 `hp / atk / strength / agility / intelligence / will / sourceSkill`
- AND 不提供主能力、副能力或自定义来源

### Requirement: 每点提升多少

系统 SHALL 使用 `perPointValue` 表达“每一点来源值提升多少”。

#### Scenario: 每点 0.10%

- WHEN 用户需要表达“每点智识提供 0.10%”
- THEN perPointValue SHALL 保存为 `0.001`
- AND 不保存为字符串公式

#### Scenario: 小数与百分比规则

- WHEN 计算得到派生 value
- THEN 系统 SHALL 把该 value 交给现有 type 归一化规则
- AND 是否转小数 SHALL 取决于 `type`
- AND 不由 `valueMode = derived` 单独决定

### Requirement: 结算顺序

系统 SHALL 在普通 Buff 后段处理来源值派生 Buff。

#### Scenario: 来源值被前置 Buff 改变

- GIVEN 当前干员存在普通 positive Buff 提升智识
- AND 另一个 derived Buff 使用 `source = intelligence`
- THEN derived Buff SHOULD 读取提升后的智识
- AND 不应读取最原始基础智识

#### Scenario: 不递归

- GIVEN 存在多个 derived Buff
- THEN 系统 SHALL 不做递归迭代
- AND derived Buff 不应互相反复吃到彼此造成的变化
- AND 后续完整计算链规则需要在 Spec 3 后续章节补充

### Requirement: Operator Studio UI

系统 SHALL 在 `operator-studio` 的 Buff 编辑区支持选择数值模式。

#### Scenario: 固定值模式

- WHEN 用户选择固定数值模式
- THEN UI SHALL 显示数值输入
- AND 保存 `valueMode = fixed`
- AND 使用 `value`

#### Scenario: 来源值模式

- WHEN 用户选择来源值派生模式
- THEN UI SHALL 显示来源值选择器
- AND 显示“每点提升”输入
- AND 不要求用户填写固定 value

### Requirement: Config Page 消费

系统 SHALL 让 `operator-config` 能消费来源值派生 Buff。

#### Scenario: Positive derived Buff

- WHEN effect.category = `positive`
- AND effect.valueMode = `derived`
- THEN config 计算链 SHALL 计算派生 value
- AND 将派生 value 按 effect.type 合入当前干员配置

#### Scenario: Condition derived Buff

- WHEN effect.category = `condition`
- AND effect.valueMode = `derived`
- THEN config 默认不自动结算
- AND 但后续主界面伤害计算在用户勾选该 Buff 时需要专门代码处理

## Acceptance Criteria

- effect 支持 `valueMode = fixed | derived`。
- 缺少 `valueMode` 的旧 effect 按 fixed 兼容。
- fixed 模式继续使用 `value`。
- derived 模式使用 `derivedValue.source` 和 `derivedValue.perPointValue`。
- 来源值固定为 `hp / atk / strength / agility / intelligence / will / sourceSkill`。
- 不支持单 effect 多来源求和。
- 不支持任意公式字符串。
- 不支持 mainStat / subStat 作为来源。
- perPointValue 使用 number 保存。
- 百分比是否按小数处理仍由现有 `type` 规则决定。
- derived positive Buff 应在普通 Buff 后段处理。
- derived Buff 不递归、不迭代。
- `operator-studio` UI 能选择 fixed / derived。
- `operator-studio` UI 能编辑来源值和每点提升。
- `operator-config` 能识别并计算 positive derived Buff。
- condition derived Buff 默认不自动结算，并进入后续伤害计算特例设计。

## Open Questions

- `operator-config` 的 display 环节中，derived Buff 应读取哪个阶段的 `hp / atk / sourceSkill`，需要单独定义完整计算链。
- 主界面伤害计算中，如果用户勾选 condition derived Buff，应如何从当前 hit / button / panel context 计算其 value，需要单独定义。
- derived Buff 是否需要在面板详情中展示“来源值 * 每点提升 = 当前 value”的展开式。
- fixed / derived 的 UI 切换是否需要保留上一次 fixed value，避免用户误切后丢数据。
