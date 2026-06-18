# 主界面新一轮 Spec

## Status

草案中。

## Goal

本轮 spec 是对主界面中技能按钮双击后的新界面做迭代。

## Requirements

### Requirement: 新界面基底

系统 SHALL 让新界面的基底采用主界面 Buff 批量操作的基底。

#### Scenario: 基底结构

- WHEN 新界面打开
- THEN 新界面采用主界面 Buff 批量操作的基底
- AND 基底是深灰色
- AND 基底带真右区和假右区

### Requirement: 界面轴线

系统 SHALL 让新界面的轴线基于单元格 `A2` 展开。

#### Scenario: A2 轴线

- WHEN 新界面布局
- THEN 界面轴线基于单元格 `A2` 展开
- AND 从 `A2` 向左展开 `x` 轴
- AND 从 `A2` 向下展开 `y` 轴

### Requirement: 非固定灵活布局

系统 SHALL 让新界面采用非固定灵活布局。

#### Scenario: 组件关系

- WHEN 新界面组织组件
- THEN 采用非固定灵活布局
- AND 不强调各组件之间直接依赖或互相关心

### Requirement: Hit 标签区

系统 SHALL 在 `x` 轴上展开 hit 标签。

#### Scenario: Hit 标签排列

- WHEN 新界面展示 hit
- THEN 在 `x` 轴上展开一个一个 hit 标签
- AND hit 标签在高度上有间隔
- AND hit 标签选取原界面一样的 hit
- AND hit 标签使用透明 flex 容器承载
- AND hit 标签容器可滚动

### Requirement: Buff 展区

系统 SHALL 在 `x` 轴右手边放置 Buff 展区。

#### Scenario: Buff 展区内容

- WHEN 新界面布局
- THEN 在 `x` 轴右手边放置一个透明 flex
- AND 该透明 flex 是 Buff 展区
- AND Buff 展区展示 `目标抗性`
- AND Buff 展区展示 `已选 Buff`
- AND Buff 展区展示 `已选状态 / 异常`

#### Scenario: Buff 标签

- WHEN Buff 展区展示单个 Buff、状态或异常
- THEN 单个 Buff、状态或异常使用标签展示
- AND 标签用小间隔串联

#### Scenario: 微调按钮预留

- WHEN Buff 展区布局
- THEN Buff 展区 flex 的底部预留 hit 被选中后的微调按钮区域
- AND 微调按钮区域使用透明 div 承载
- AND 微调按钮 CSS 类似现有按钮样式

### Requirement: 伤害信息区

系统 SHALL 在 Buff 展区右侧放置伤害信息区。

#### Scenario: 总伤与计算过程

- WHEN 新界面布局
- THEN 在 Buff 展区右侧放置一个透明 flex
- AND 该透明 flex 顶部展示总伤
- AND 该透明 flex 在总伤下面展示计算过程

## Acceptance Criteria

- 新界面采用主界面 Buff 批量操作的深灰色基底。
- 新界面带真右区和假右区。
- 新界面轴线基于单元格 `A2` 展开。
- `x` 轴从 `A2` 向左展开。
- `y` 轴从 `A2` 向下展开。
- 新界面采用非固定灵活布局。
- 不强调各组件之间直接依赖或互相关心。
- `x` 轴上展开一个一个 hit 标签。
- hit 标签在高度上有间隔。
- hit 标签选取原界面一样的 hit。
- hit 标签用透明 flex 容器承载。
- hit 标签容器可滚动。
- `x` 轴右手边有透明 flex 的 Buff 展区。
- Buff 展区展示目标抗性、已选 Buff、已选状态 / 异常。
- 单个 Buff、状态或异常标签用小间隔串联。
- Buff 展区底部预留 hit 被选中后的微调按钮区域。
- 微调按钮区域用透明 div 承载。
- 微调按钮 CSS 类似现有按钮样式。
- Buff 展区右侧有透明 flex。
- Buff 展区右侧透明 flex 顶部展示总伤。
- Buff 展区右侧透明 flex 在总伤下面展示计算过程。
