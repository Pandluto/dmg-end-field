# Spec 8-1-3：最小知识入口与训练就绪闭环

## 状态

规格已形成；必须在 Spec 8-1-1、8-1-2 均验收通过后再启动任务拆分与实现。

## 一句话定调

**接入少量可追溯游戏知识，建立失败归因、Harness 候选和版本记录，并用一次真实的 Codex 返修与独立回归证明 DEF 已经具备开始受控训练的条件。**

## 前置条件

- Runtime Harness 和 Pure Blackbox 已稳定；
- Turn Trace Bundle、Computer Use、Scenario Replay 与独立 verifier 已接通；
- FAIL_TO_PASS、PASS_TO_PASS 和 safety invariants 已能执行；
- Codex 教师修改仓库与 verifier/hidden cases 保持隔离。

## 目标

1. 在 `def-data-resource` 下建立最小 Knowledge Runtime；
2. 用极少量受审阅 YZ/游戏知识证明 provenance → claim → query → evidence；
3. 让知识建议可以与当前 Workbench 状态和官方 resource 核对后生成草稿；
4. 建立首版 failure taxonomy、`HarnessProposal` 和 `HarnessVersion`；
5. 选择一个真实失败完成 Codex 返修、重放、回归、审阅和提交；
6. 用端到端证据判定系统是否达到“training ready”。

## 第一部分：最小 Knowledge Runtime

知识查询继续归入现有 `def-data-resource`，不新增第四类工具：

- `def_knowledge_search`；
- `def_knowledge_get`；
- `def_knowledge_evidence`；
- `def_knowledge_status`。

工具共同约束：

- 不接受任意文件路径；
- 不返回整份 `YZ.md`；
- 输出有界；
- 返回 knowledge index version；
- 记录 query、过滤条件、命中理由和 evidence；
- 不可越过 official resource 和当前 Workbench 事实；
- 全部调用进入 Turn Trace Bundle。

## 第二部分：最小知识模型

本阶段只要求以下对象：

| 对象 | 最小职责 |
| --- | --- |
| Source | URL/视频 id、日期、版本、转录方法、hash |
| Claim | 条件、实体、结论、source span、review/conflict 状态 |
| Terminology | 玩家别名、正式名、ASR 候选 |
| Operator/Decision Card | 角色定位、方案取舍和适用条件 |
| Rotation | 动作、前置状态、分支、恢复与证据引用 |

原始 source/转录不可被摘要覆盖；卡片和 rotation 是可重建派生资产。高风险数值必须说明来源和核验状态。

## 第三部分：样本边界

只选择足以证明架构的极小样本，例如：

- 两个有明确来源和版本的 YZ 视频/攻略；
- 一组玩家别名；
- 两张存在明确取舍的 Decision Card；
- 一条经过人工审阅、能够映射到 Workbench 草稿的 Rotation；
- 至少一个来源冲突或版本过期样本。

样本数量以验证查询、证据、冲突和草稿闭环为准，不以覆盖率为目标。批量导入和完整角色库属于 Spec 8-2。

## 第四部分：知识到 Workbench 草稿

```text
用户自然语言
→ terminology normalize
→ knowledge search/get/evidence
→ 读取当前 WorkbenchTurnState
→ 使用 official resource 核对角色、技能、数值和可用按钮
→ 映射为隔离 Work Node 草稿
→ validation / semantic diff
→ 用户审批前停止
```

不能根据攻略文本猜测 buttonId、slot 或实时配置；条件不足时必须展示缺失信息或替代路线。社区观点与当前事实冲突时，以实时/官方 resource 为准，并保留来源说明。

## 第五部分：训练信号与用户 delta

训练信号按可靠程度使用：

1. typed validation；
2. semantic diff 和 checkout/revision 结果；
3. 用户是否批准应用；
4. 用户应用前后的编辑 delta；
5. 相似 scenario replay；
6. 用户文字反馈；
7. Agent 自我评价。

系统必须关联：

```text
知识命中与 evidence
→ Agent 生成的 draft
→ 用户编辑 delta
→ 最终 applied node
```

本阶段只记录和用于一次人工审阅的返修，不自动形成全局 skill、知识或个人偏好。

## 第六部分：Failure Taxonomy

首版至少包含：

| 类别 | 示例 | 责任层候选 |
| --- | --- | --- |
| self-model | 否认自己能排轴 | Agent Contract |
| intent-routing | 解释请求误进入写入 | routing/skill |
| knowledge-recall | 不识别玩家别名 | terminology/search |
| evidence | 将旧视频阈值当实时事实 | knowledge policy |
| state-staleness | checkout 变化后操作旧 node | TurnState/hard gate |
| tool-selection | 选择错误工具家族 | mediation/tool description |
| parameter-grounding | 猜 buttonId/slot | resource-first procedure |
| workflow-omission | 未 validate/diff 就称完成 | deterministic workflow |
| ui-observability | 内部成功但 UI 不可见 | bridge/frontend |
| expression | 风格掩盖不确定性 | response policy |

failure label 是可修订判断，必须引用代表 trace，不能覆盖原始证据。

## 第七部分：HarnessProposal

一个候选只处理一个可归因弱点，至少包含：

- failure cluster 与代表 trace ids；
- 修改对象和基线 HarnessVersion；
- 修改前后 diff；
- 目标 FAIL_TO_PASS；
- 相邻 PASS_TO_PASS 与安全风险；
- replay、hidden regression、UI 结果；
- reviewer、rollback target 与最终处理状态。

拒绝：

- 单次偶发失败直接形成长期规则；
- 无法归因的整体 system prompt 重写；
- 通过修改 verifier 或降低成功标准提高通过率；
- 将未经核验的模型总结发布为知识事实。

## 第八部分：HarnessVersion

稳定版本至少关联：

- code commit；
- Agent Contract version；
- skill bundle version；
- tool mediation/allowlist version；
- TurnState serializer version；
- knowledge index version；
- scenario/verifier suite version；
- reviewer、发布时间和上一稳定版本。

Spec 8-1-3 可用本地文件、SQLite 与 Git 组合实现，不建设完整管理后台，不要求自动灰度。

## 第九部分：训练就绪证明

必须选择一个真实、非人为写死的 DEF failure 完成：

```text
Pure Blackbox 复现失败
→ Computer Use + trace 收集证据
→ failure taxonomy 归因
→ Codex 形成并实现最小 HarnessProposal
→ 重放目标 FAIL_TO_PASS
→ 执行相邻 PASS_TO_PASS 和 safety invariants
→ 人工审阅代码/知识/行为 diff
→ 提交新 HarnessVersion
→ 再次通过真实 UI 验证
```

如果修复只能在 Diagnostic 提示下成功，或需要修改 hidden case/成功标准，不能判定 training ready。

## 验收标准

### Knowledge Runtime

- [ ] 四个只读知识入口已归入 `def-data-resource` 并输出 index version。
- [ ] Source、Claim、Terminology、Card、Rotation 均保留 provenance/review/conflict。
- [ ] 受审阅小样本能完成 local evidence 与跨卡片查询。
- [ ] 版本/来源冲突不会被摘要静默覆盖。
- [ ] 知识建议能与 official resource 和 WorkbenchTurnState 核对。

### 草稿闭环

- [ ] 至少一条 Rotation 可生成隔离 Work Node 草稿并通过 validation/diff。
- [ ] 映射过程不猜测 buttonId、slot 或实时数值。
- [ ] 未经用户审批不会 use。
- [ ] Agent draft、用户 delta、最终 applied node 与知识 evidence 可以关联。

### 返修闭环

- [ ] 一个真实失败形成带证据的 failure classification。
- [ ] Codex 实现的候选是单点、可解释、可回滚修改。
- [ ] 目标 FAIL_TO_PASS、相邻 PASS_TO_PASS 和 safety invariants 全部运行。
- [ ] hidden/verifier 未被返修 Codex 修改或泄露。
- [ ] 返修经人工审阅、commit 和真实 UI 复验。
- [ ] 新 HarnessVersion 可完整追溯并能回滚上一版本。

## 明确不做

- 不批量迁移全部 YZ/游戏资料；
- 不自动从 trace 修改或发布 skills；
- 不自动生成全局用户偏好；
- 不训练模型权重；
- 不完成 Voice Profile 或主播角色模仿；
- 不开发 Harness Evolution UI；
- 不自动灰度到生产用户；
- 不提前展开 Spec 8-2。

## 完成定义

当少量知识能够安全进入真实 DEF 工作流，且一个真实失败能经过“观察 → 归因 → Codex 返修 → 独立回归 → 人工发布”形成完整、可追溯、可回滚的证据链时，8-1-3 完成，整个 Spec 8-1 才被判定为 training ready。
