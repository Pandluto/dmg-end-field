# DEF OpenCode Worknode Phase 4 Spec

## 阶段定位

第四阶段不是另起一套 AI 能力，也不是先做攻略知识蒸馏。

本阶段先回到基础建设，补齐第三阶段暴露出来的前端闭环缺口：后端和 tools 已经有 work node、patch、validate、diff、checkout/restore 等基础能力，但主界面还没有把这些能力产品化展示出来。

目标是让 DEF agent 的本地工作节点真正成为用户可见、可理解、可验收、可回退的安全机制。

## 核心目标

- 对齐 work node 后端、typed tools、agent prompt、主界面前端之间的概念。
- 补全主界面对 work node 的展示、验收、应用、回退能力。
- 让用户知道 AI 创建了哪个节点、改了什么、校验是否通过、是否已经 checkout。
- 在写代码过程中，如果发现底层逻辑、数据结构、tool schema、verify 能力不完整，要同步修正，不把问题推给前端。
- 保持低阻塞原则：审批和验收应尽量是可见记录和柔性确认，不做无意义强拦截。

## 暂定范围

### 1. Work Node 前端闭环

需要让主界面至少能看见：

- 当前 AI work node 列表
- 节点状态
- 节点创建时间和来源
- 节点 base / working 的差异摘要
- validate / risk flags
- checkout / restore / discard 等操作入口
- restore 前后状态和当前迁出态变化证据

### 2. Agent 操作可见性

AI 对 work node 做过的事情应该能被用户理解：

- 创建节点
- patch 了什么
- validate 结果
- diff 摘要
- 是否触碰当前迁出态
- 是否等待用户验收

### 3. 当前迁出态与本地节点区分

必须继续明确：

- 当前迁出态不是 localStorage/sessionStorage 的抽象名词。
- work node 是 appdata/localdata 中独立保存的节点。
- checkout 才会把 work node 的 workingPayload 应用到当前主界面排轴。
- restore_base 才会把 work node 的 basePayload 应用回当前主界面排轴。
- 前端文案和状态展示不能把两者混淆。

### 4. 基础建设同步修正

本阶段写代码时，如果发现以下问题，要同步修：

- tool 输入/输出不适合前端展示
- diff 摘要不够结构化
- validate 结果缺字段
- work node 状态机不清晰
- checkout/restore/discard 缺少可验证结果
- restore_base 只能作为“回退到节点基线”，不能被展示成任意历史版本管理。
- agent prompt 与真实工具能力不一致
- REST 后门测试、前端 UI event、agent transcript 三者口径混乱

## 非目标

- 不优先做大型攻略知识库。
- 不优先做高级组合工具优化，除非它阻塞前端闭环验收。
- 不做录制回放式业务脚本。
- 不把固定角色、装备、Buff、排轴套路硬编码进产品逻辑。

## 验收方向

第四阶段完成时，用户应能在主界面回答这些问题：

- AI 是否创建了 work node？
- 这个节点改了什么？
- 当前排轴有没有被改？
- 这个节点是否校验通过？
- 我能不能应用它？
- 我能不能丢弃或回退它？
- 回退到底回到了哪个节点的 basePayload？
- 如果 AI 说完成了，前端是否有对应证据？

## 待明日展开

明日需要继续补充：

- 具体 UI 结构
- 具体 REST / typed tools 缺口
- work node 状态机
- 前端组件拆分
- task 列表
- 手测清单
- 与第三阶段 feedback 的风险项逐条对应
