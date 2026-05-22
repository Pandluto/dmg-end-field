# Sheet Equipment 保存链路与导入导出对齐 Phase 4 Spec

## Why

当前 Sheet Equipment 已具备基础编辑、层级展开、fx 编辑和导入导出能力，但保存链路与 Sheet-Weapon 仍不一致，导致后续继续开发时容易出现：

- `Ctrl+S` 虽有预期入口，但未形成稳定且一致的手动保存行为。
- 页面存在 `localStorage` 与“本地保存”并行的职责，容易造成状态来源冲突。
- 当前页面不应具备自动保存，但保存边界尚未被规格化。
- 导入/导出弹窗与 Sheet-Weapon 未完全对齐，尤其内容区样式和布局表现存在明显问题。

本阶段目标是把 Sheet Equipment 的保存行为收敛为单一路径，并把导入/导出弹窗对齐到 Sheet-Weapon 的既有实现。

## What Changes

- 对齐 Sheet-Weapon 的手动保存入口与保存反馈。
- 补齐 `Ctrl+S` 行为，并沿用 Sheet-Weapon 的防误触提示逻辑。
- 明确 Sheet Equipment 不提供自动保存。
- 明确保护开关开启时，手动保存前必须弹出保护确认弹窗。
- 收口本地持久化职责，移除“本地保存”并行路径，仅保留 `localStorage` 作为缓存。
- 明确 `localStorage` 不是真实数据源，只从手动保存链路派生更新。
- 对齐导入/导出弹窗的结构、样式和内容区布局。
- 优先复用 Sheet-Weapon 现有导入/导出弹窗实现，而不是在 Equipment 页面继续维护独立表现。

## Reference Behavior

Sheet Equipment SHALL 参考现有 Sheet-Weapon 的以下实现模式：

- 手动保存入口与保存反馈模型。
- `Ctrl+S` 的快捷键监听与防误触提示模型。
- 保护开关开启时的确认弹窗模型。
- 导入/导出弹窗的结构、尺寸、内容区布局和按钮区样式。
- 现有缓存写入时机与页面状态同步方式。

## Requirements

### Requirement: 手动保存入口对齐

系统 SHALL 仅提供手动保存，不提供自动保存。

#### Scenario: 点击保存

- WHEN 用户点击保存按钮
- THEN 系统执行手动保存流程
- AND 保存反馈与 Sheet-Weapon 保持一致

#### Scenario: Ctrl+S 保存

- WHEN 用户在 Sheet Equipment 页面按下 `Ctrl+S`
- THEN 系统触发与 Sheet-Weapon 一致的保存入口
- AND 沿用既有防误触提示逻辑
- AND 不引入自动保存或静默保存

### Requirement: 保护确认

系统 SHALL 在保护开关开启时要求确认后才能保存。

#### Scenario: 保护关闭

- WHEN 用户触发手动保存
- AND 当前保护开关关闭
- THEN 系统直接执行保存
- AND 不弹出额外保护确认弹窗

#### Scenario: 保护开启

- WHEN 用户触发手动保存
- AND 当前保护开关开启
- THEN 系统弹出保护确认弹窗
- AND 用户确认后才执行保存

### Requirement: 禁止自动保存

系统 SHALL NOT 在 Sheet Equipment 页面执行自动保存。

#### Scenario: 编辑过程

- WHEN 用户修改任意可编辑内容
- THEN 系统只更新当前页面编辑状态
- AND 不自动触发保存
- AND 不自动写入独立保存结果

### Requirement: 本地持久化职责收口

系统 SHALL 移除“本地保存”与 `localStorage` 并行存在的双轨逻辑。

#### Scenario: 本地缓存唯一化

- WHEN 页面需要本地缓存
- THEN 系统只使用 `localStorage`
- AND `localStorage` 不作为真实数据源
- AND 不再保留独立“本地保存”路径

#### Scenario: 手动保存后的缓存更新

- WHEN 用户完成一次手动保存
- THEN 系统同步更新 `localStorage`
- AND 缓存内容来源于当前保存结果
- AND 不允许出现内存态、缓存态、保存态不一致

### Requirement: 导入导出弹窗对齐

系统 SHALL 让导入/导出弹窗与 Sheet-Weapon 保持一致体验。

#### Scenario: 弹窗结构

- WHEN 用户打开导入或导出弹窗
- THEN 弹窗整体结构、按钮区和布局与 Sheet-Weapon 保持一致

#### Scenario: 内容区样式

- WHEN 弹窗内容区渲染导入或导出内容
- THEN 内容区尺寸、间距、滚动和显示方式与 Sheet-Weapon 保持一致或等效一致
- AND 当前内容区显示异常问题被修复

#### Scenario: 样式复用

- WHEN 存在可复用的 Sheet-Weapon 弹窗实现
- THEN Sheet Equipment 优先复用既有结构和样式
- AND 不继续维护明显偏离的独立样式实现

## Acceptance Criteria

### AC1: 手动保存可用

- 点击保存按钮可触发保存。
- 保存反馈与 Sheet-Weapon 一致。

### AC2: Ctrl+S 对齐

- 在 Sheet Equipment 页面按下 `Ctrl+S` 可触发保存入口。
- `Ctrl+S` 的提示逻辑与 Sheet-Weapon 一致。

### AC3: 保护确认正确

- 保护开关关闭时，保存不弹保护确认。
- 保护开关开启时，保存前弹出保护确认弹窗。
- 用户确认后才继续保存。

### AC4: 无自动保存

- 编辑页面内容时不会自动触发保存。
- 页面不存在静默保存或隐式保存行为。

### AC5: 本地职责收口

- 原有“本地保存”并行逻辑被移除或停用。
- 页面仅保留 `localStorage` 作为缓存机制。
- 手动保存后页面状态与 `localStorage` 不冲突。

### AC6: 导入导出弹窗对齐

- 导入/导出弹窗整体样式和布局与 Sheet-Weapon 基本一致。
- 内容区显示问题被修复。
- 不再出现当前 Equipment 页面特有的明显错位或异常展示。
