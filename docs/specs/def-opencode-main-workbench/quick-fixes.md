# def-opencode 主界面立竿见影修复专刊

## Status

草案中。

本文件补充 `def-opencode 主界面初版 Spec`，只记录当前可快速改善可用性的修复点。它不替代长期 Agent Runtime Execution Model。

## 背景

当前主界面口述排轴不可用的核心问题分两层：

- 长期问题：缺少完整 DEF Agent Kernel、强 schema tools、目标 verifier 和 repair loop。
- 短期问题：现有桥接链路中存在若干小范围缺陷，已经足以造成假完成、队列卡死、只读请求误判、排轴状态不一致。

本专刊优先处理短期问题，目标是降低“agent 口头完成但状态没变”的概率，并修复明显破坏排轴事实源一致性的 bug。

## 修复目标

本轮快速修复 SHALL 达成：

- 新增技能按钮后，画布 runtime 状态、timelineData、skill-button 持久化、快照中的坐标语义一致。
- REST 不接受未知主界面 op。
- 只读问题不因出现 `Buff` 等词被误判为变更操作。
- 小型变更不默认插入回退点命令。
- 验证逻辑只把完成状态的命令当作有效证据。
- 本轮等待命令完成时不被历史 pending/running 命令拖死。

## Scope

本轮处理：

- `addSkillButton` 写入 timelineData 的 staffIndex/nodeIndex 语义修正。
- `/api/main-workbench/commands/enqueue` 的 op 白名单校验。
- AI 面板中只读/变更意图识别规则修正。
- AI 面板中回退点创建规则修正。
- AI 面板中命令证据筛选和 settle 等待范围修正。
- `addBuff` 缺少 buff payload 时的显式错误。
- `refreshSnapshot` 的显式处理。

本轮不处理：

- 不实现完整 DEF Agent Kernel。
- 不实现 batchId / turnId 全链路。
- 不实现 Buff 名称解析器。
- 不实现批量命令事务执行器。
- 不重构 UI。
- 不新增完整单元测试体系。

## Requirements

### Requirement: 坐标事实源一致

系统 SHALL 保证通过 workbench command 新增技能按钮时，runtime button 和 timelineData 使用一致的坐标语义。

#### Scenario: 新增技能按钮

- WHEN `addSkillButton` 命令执行成功
- THEN runtime button 的 `staffIndex` 表示排轴组
- AND runtime button 的 `lineIndex` 表示干员行
- AND timelineData 中对应按钮使用同一 `staffIndex`
- AND timelineData 中对应按钮使用同一局部 `nodeIndex`
- AND 不把 `staffIndex * GRID_NODE_COUNT + nodeIndex` 写作按钮 nodeIndex

### Requirement: REST op 白名单

系统 SHALL 拒绝未知主界面命令。

#### Scenario: 未知 op

- WHEN `/api/main-workbench/commands/enqueue` 收到未知 `op`
- THEN REST 返回 400
- AND 命令不进入 pending 队列
- AND 响应包含可读错误码和消息

### Requirement: 只读意图优先

系统 SHALL 避免把查询当前状态的问题误判为变更操作。

#### Scenario: 查询 Buff

- WHEN 用户询问“当前有哪些 Buff”
- THEN 系统按只读查询处理
- AND 读取主界面快照
- AND 不启动 def-opencode 变更链路

#### Scenario: 明确添加 Buff

- WHEN 用户要求“给某技能加 Buff”
- THEN 系统按变更请求处理

### Requirement: 小操作不默认保存回退点

系统 SHOULD 只对高风险变更默认保存回退点。

#### Scenario: 单个按钮或 Buff 操作

- WHEN 用户只添加或删除一个技能按钮 / Buff
- THEN 系统不默认保存回退点
- AND 用户明确要求可回退时除外

#### Scenario: 高风险操作

- WHEN 用户要求清空排轴、批量替换干员、批量改动或恢复快照
- THEN 系统默认保存回退点

### Requirement: 验证只接受完成证据

系统 SHALL 只把 `done` 状态的实际命令作为完成证据。

#### Scenario: 命令仍 pending

- WHEN 本轮存在符合意图但仍为 `pending` 或 `running` 的命令
- THEN 系统不得回复执行成功
- AND 应提示执行未确认或超时

### Requirement: 等待范围限定到本轮

系统 SHALL 避免历史命令污染当前轮次验证。

#### Scenario: 存在历史 pending 命令

- GIVEN 命令队列中存在本轮之前遗留的 pending 命令
- WHEN 当前轮次等待命令完成
- THEN 系统只等待本轮创建的 pending/running 命令
- AND 不因历史 pending 命令拖到超时

### Requirement: 显式错误

系统 SHALL 对缺少关键 payload 的命令返回可读错误。

#### Scenario: addBuff 缺少 buff

- WHEN `addBuff` 命令没有 `buff` 对象
- THEN 系统返回 `addBuff requires buff`
- AND 不抛出非业务 TypeError

### Requirement: refreshSnapshot 语义清晰

系统 SHALL 显式处理 `refreshSnapshot` 命令。

#### Scenario: refreshSnapshot

- WHEN `refreshSnapshot` 命令执行
- THEN 系统返回当前快照或刷新摘要
- AND 不把它混同为伤害计算命令

## Acceptance Criteria

- 快速修复不改变现有主界面 AI 面板整体 UI。
- 快速修复不改变业务事实源位置。
- 未知 op 不会进入主界面命令队列。
- “当前有哪些 Buff”这类查询走快照只读路径。
- 单个 add/remove button/buff 不自动创建回退点。
- 验证时 pending/running 命令不被当作成功。
- 等待 settle 时不被旧命令污染。
- `addBuff` 缺 payload 返回明确业务错误。
- `refreshSnapshot` 有独立执行分支。
