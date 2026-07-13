# Task 8-1-2：打通可训练 Harness

## 状态

待实施：任务范围与完成定义已形成。允许按检查点分批编码、验证和提交，但不得提前进入 8-1-3 的真实 Codex 返修。

## 一句话目标

**把 8-1-1 已稳定的 DEF 联调协议接入一条最小但完整的离线 Harness 流水线，使一次受控 DEF 执行能够被版本化记录、隔离重放、独立裁决，并形成可解释、可回滚的返修候选。**

## 任务定位

8-1-1 已回答“Codex 如何稳定接入和观察 DEF”。本任务只回答：

> 接入以后，如何把一次执行变成可以重复训练、比较和回归的证据？

这里的“可训练”不是在线更新模型权重，也不是自动改 prompt，而是建立以下最小闭环：

```text
Harness 版本快照
  → Scenario + 隔离 Fixture
  → DEF turn
  → Trace Bundle
  → Replay
  → Independent Verifier
  → Failure Classification
  → HarnessProposal / HarnessVersion 记录
```

8-1-2 只用受控样例证明这条数据流能工作。高级 Codex 对真实 failure 的观察、返修和 UI 回归属于 8-1-3。

## 前置事实

- `DefCodexInteropProtocol v1` 是 Harness 调用和观察 DEF 的唯一正式入口；
- `status / authorize / start / continue / stop / events / transcript / questions / state` 已可用；
- Pure Blackbox 与 Diagnostic 已分线；
- `testRunId / sessionId / turnId / clientTurnId / scenarioId / seq` 可关联；
- 教师入口只允许 loopback + bearer，token 不得进入 trace；
- 当前 snapshot 服务来自 `127.0.0.1:17321`，不可用时只读场景可降级记录，依赖当前轴的 mutation 场景必须判定为 `BLOCKED_ENVIRONMENT`；
- 真实 UI 是否可见仍由 Computer Use 确认，但 8-1-2 不自动驱动 Computer Use。

## 完成定义

本任务完成必须同时满足：

1. 能生成确定、可比较的 `DefHarnessDescriptor`；
2. 能通过正式 interop 协议运行 scenario，并生成 append-only `DefTurnTraceBundle`；
3. 能在全新 fixture 和 session 中 replay，而不是重复消费原会话；
4. 能运行结构、业务、行为、UI 四层 verifier；
5. 能联合执行 FAIL_TO_PASS、PASS_TO_PASS 和 safety invariants；
6. 能区分环境阻塞、协议失败、Agent 失败和裁判失败；
7. hidden evaluator 输入不会泄露给 Worker 或返修上下文；
8. 能形成只记录、不自动应用的 `HarnessProposal`；
9. 能记录带上一稳定版本和 rollback target 的 `HarnessVersion`；
10. 一个受控单 turn 和一个受控多 turn scenario 完整跑通。

只实现若干 JSON schema、只保存 transcript，或只写一组 smoke test，都不算“可训练 Harness 已打通”。

---

## 一、架构边界

### 1.1 在线执行与离线迭代分离

```text
Electron / DEF sidecar / def-opencode
  = 在线 Worker Runtime

agent/harness + scripts/def-harness-*.mjs
  = 离线采集、Replay、Verifier 与版本记录
```

- 不把 Scenario、Verifier、hidden case 或 HarnessProposal 业务塞进 Electron bridge；
- bridge 只继续提供稳定协议和原始事实；
- Harness 可以读取协议输出和受控 fixture，不得绕过 permission、approval/use 或 typed validation；
- Harness 失败不得影响普通用户聊天和 Workbench 常驻进程；
- 不修改 `agent/vendor/opencode` 来实现 Harness 编排。

### 1.2 Worker、Teacher、Verifier 分离

- Worker 只接收 scenario 中的普通用户消息；
- Teacher/返修上下文可以读取公开 trace、failure classification 和 proposal，不得读取 hidden case 完整输入与答案；
- Verifier 读取原始 trace、fixture truth 和 evaluator-only 数据；
- 同一个模型的自评不能覆盖确定性 verifier；
- safety invariant 一票否决，不能通过提高其他分数抵消。

### 1.3 建议目录

实施时可按实际代码调整命名，但职责必须保持：

```text
agent/harness/
  contracts/          # schema 与 validation
  descriptor/         # HarnessDescriptor 生成与 hash
  trace/              # collector、store、redaction、artifact refs
  scenario/           # scenario loader、fixture adapter、runner、replay
  verifier/           # 四层 verifier、regression、verdict precedence
  failure/            # taxonomy 与 append-only classification
  versioning/         # proposal、version、rollback 记录
  fixtures/           # 仅受控开发 fixture
  scenarios/          # 公开单 turn / 多 turn样例

scripts/
  def-harness-cli.mjs
  def-harness-check.mjs

.runtime/def-harness/
  runs/
  proposals/
  versions/
  evaluator/
```

`.runtime/def-harness` 必须保持本地运行时数据，不提交 token、真实用户 transcript 或临时 evaluator 输出。

---

## 二、合同与版本事实源

### 2.1 首版合同

建立同一事实源并进行运行时校验：

- `DefHarnessDescriptorV1`；
- `DefTurnTraceBundleV1`；
- `DefHarnessScenarioV1`；
- `DefFixtureDescriptorV1`；
- `DefVerifierResultV1`；
- `DefRegressionRunV1`；
- `DefFailureClassificationV1`；
- `HarnessProposalV1`；
- `HarnessVersionV1`。

未知 additive 字段保持兼容，未知 major/schema version 明确拒绝。不得由 CLI、runner、verifier 各自手写一套相似结构。

### 2.2 HarnessDescriptor

至少记录：

- descriptor id/schemaVersion/content hash；
- repository commit 和 dirty 状态；
- `DefCodexInteropProtocol` version；
- Agent Contract、Capability Manifest、TurnState schema 的版本/hash；
- skill 清单与内容 hash；
- visible tool registry/schema hash；
- tool mediation 与 response policy 版本；
- provider/model 与关键运行配置摘要；
- fixture/scenario/verifier suite version；
- knowledge index version，当前允许为 `null`。

相同代码和配置应产生相同 content hash。dirty workspace 可以运行开发场景，但不得记录为可发布 stable HarnessVersion。

### 2.3 Artifact 身份

- 所有持久 artifact 使用稳定 id + schemaVersion + SHA-256；
- 引用必须包含 artifact type、id、hash 和相对位置；
- hash 不匹配、文件缺失或 schema 不兼容时 fail closed；
- 原始事件和状态快照不允许被后续 judgment 原地改写。

---

## 三、Turn Trace Bundle 与存储

### 3.1 采集入口

Collector 必须使用 8-1-1 正式协议：

```text
status → authorize → state(before)
  → start/continue
  → events(cursor resume) + questions
  → transcript + state(after)
  → finalize trace
```

不得为 Harness 新建绕过原生 session 的 prompt route。

### 3.2 Trace 内容

每个 turn 至少保存：

- HarnessDescriptor ref；
- scenario/fixture/version；
- testRun/session/turn/clientTurn ids；
- ingress mode、raw user text、provider-visible user text；
- state before/after、snapshot availability、checkout/revision；
- accepted、首个响应、首个工具、完成时间；
- 有序事件、cursor/gap、工具参数/结果/错误；
- questions、permission、approval/use；
- validation、semantic diff、pending command/node；
- provider/model、终态、环境错误；
- 最终回复摘要和 UI evidence refs；
- 后追加的 judgments/classifications/proposal refs。

token、Authorization header、完整环境变量、任意用户文件和无界工具结果不得进入 trace。

### 3.3 Append-only 存储

首版优先使用可人工检查的文件 artifact，不为“像平台”提前建设复杂数据库：

```text
runs/<runId>/manifest.json
runs/<runId>/events.jsonl
runs/<runId>/transcript.json
runs/<runId>/state-before.json
runs/<runId>/state-after.json
runs/<runId>/judgments.jsonl
runs/<runId>/artifacts/*
```

- 原始事实写入后不可覆盖；
- judgment、classification 和 reviewer decision 只追加；
- finalize 生成 manifest/hash；
- 未 finalize、缺事件或 cursor gap 的 run 标为 incomplete，不得伪装为 Agent FAIL；
- 后续若增加 SQLite，只能作为索引，文件 artifact 仍是可移植证据。

---

## 四、Scenario 与隔离 Fixture

### 4.1 Scenario

Scenario 必须把用户表达与验收定义分开：

- `messages` 只包含正常玩家/用户话术；
- expected tool、case id、安全说明和验收答案不得注入 user text；
- 单 turn 与多 turn 使用同一 scenario schema；
- 明确 ingress mode、fixture、required capabilities、verifier ids；
- 明确允许结果、禁止结果、是否需要 snapshot、是否需要 UI evidence；
- 记录 model/provider/Harness 前置条件。

### 4.2 Fixture 生命周期

每个 fixture adapter 至少提供：

```text
create → inspect → reset/recreate → destroy
```

- 使用唯一 timeline/save/work-node/session 标识；
- 不读取或修改用户当前生产 timeline；
- replay 总是新建 fixture 和 native session；
- cleanup 只能删除本 run 自己创建的资源；
- cleanup 失败进入环境报告，不得全局清库；
- fixture truth 与 Worker 可见上下文分开保存。

### 4.3 首版受控样例

至少提供：

1. 一个只读单 turn scenario，用来证明 trace、工具观察和确定性 verdict；
2. 一个需要自然追问/继续的多 turn scenario，用来证明同一 testRun/session 的关联和 replay。

样例不能依赖大规模 YZ 知识，不能通过在 prompt 中写出期望工具来“演示成功”。

---

## 五、Replay Runner

### 5.1 Replay 语义

Replay 是“重新建立等价环境并重新执行”，不是：

- 重放旧 SSE；
- 复制旧 transcript；
- 对旧 session 再发同一个 `clientTurnId`；
- 用缓存 verdict 代替新执行。

每次 replay 必须产生新的 run/session/turn ids，并记录 baseline 与 replay 的 Harness、fixture、model/provider 和环境差异。

### 5.2 可比较边界

允许模型文本不同，但至少比较：

- 用户意图是否满足；
- 是否选择允许的工具家族；
- typed state/validation/diff 是否满足；
- 是否出现禁止 mutation、越权 use、checkout 污染；
- permission/question 是否正确处理；
- 终态和用户可见结果是否成立。

### 5.3 环境失败

以下情况输出 `BLOCKED_ENVIRONMENT`，不能记为 Agent regression：

- bridge/sidecar/OpenCode 未就绪；
- snapshot 缺失但 scenario 要求 mutation/current-axis truth；
- fixture 无法建立或清理；
- provider 不可用；
- trace cursor gap 无法补齐；
- verifier 依赖缺失。

只读 scenario 在 snapshot 缺失时是否允许继续，必须由 scenario 显式声明，并在 trace 中保留 `snapshotAvailable=false`。

---

## 六、独立 Verifier

### 6.1 统一结果

每个 verifier 输出：

- verifier id/version/layer；
- verdict：`PASS | FAIL | BLOCKED | ERROR`；
- severity；
- evidence refs；
- deterministic checks；
- 可选解释，不得只有自然语言理由；
- evaluator-only 标记和公开摘要。

### 6.2 四层 Verifier

1. **结构层**：合同完整性、ids、cursor、终态、工具事件顺序；
2. **业务层**：fixture truth、typed validation、semantic diff、revision/CAS、checkout；
3. **行为层**：意图满足、是否应追问、预览/应用边界、事实与不确定性；
4. **UI 层**：scenario 要求 UI 时是否存在有效 evidence ref，且 UI 结论与内部 state 不矛盾。

8-1-2 的 UI verifier 只建立 evidence 合同与 fail-closed 规则；真实 Computer Use 回归由 8-1-3 执行。

### 6.3 Verdict 优先级

```text
safety FAIL
  > deterministic business FAIL
  > protocol/trace ERROR
  > environment BLOCKED
  > behavioral/LLM judgment
```

- safety FAIL 永远不能被平均分覆盖；
- verifier 自己异常输出 ERROR，不得把 Worker 判为 FAIL；
- LLM/Codex judgment 只能补充难以结构化的行为判断；
- verifier 版本必须进入每次 regression report。

---

## 七、Regression 与 Hidden Boundary

### 7.1 Regression Suite

一次 regression 至少包含：

- 目标 FAIL_TO_PASS；
- 至少一个相邻 PASS_TO_PASS；
- permission/approval/use/checkout 等 safety invariants；
- 环境 preflight；
- 汇总 report 和稳定进程退出码。

建议退出码：

- `0`：全部通过；
- `1`：Worker/Harness regression；
- `2`：环境阻塞；
- `3`：合同、artifact 或 verifier 错误。

### 7.2 Hidden Boundary

- hidden case 从 evaluator-only root/service 加载；
- scenario id 和公开 rubric 可以暴露，完整 prompt、fixture truth、expected answer 不进入 Teacher bundle；
- proposal 生成器只能获得公开 failure summary 和 evidence refs；
- report 只输出通过/失败类别、必要证据摘要和 reviewer 可见详情；
- focused check 必须证明序列化给 Teacher 的对象不含 hidden 原文与答案。

首版不要求远程评测平台，但不能把 hidden JSON 与返修上下文放在同一可读目录后宣称“隐藏”。

---

## 八、Failure Classification

首版 taxonomy 与 `spec8-1-2.md` 对齐，至少覆盖：

- protocol；
- self-model；
- intent-routing；
- state-staleness；
- tool-selection；
- parameter-grounding；
- workflow-omission；
- ui-observability；
- expression；
- environment；
- verifier-error。

每条 classification 必须：

- 引用一个或多个 trace/evidence refs；
- 区分 primary cause 与 contributing causes；
- 记录 confidence 和 classifier kind（deterministic/Codex/human）；
- 追加写入，不覆盖原始 trace；
- 允许 reviewer 追加更正，但保留历史判断。

单次 provider 波动、环境阻塞或无证据猜测不得直接形成长期 Harness 规则。

---

## 九、HarnessProposal、Version 与 Rollback

### 9.1 HarnessProposal

首版只创建结构化候选记录，不自动编辑或应用生产 Harness。每个 proposal：

- 只对应一个 primary failure；
- 引用 baseline traces 和 classification；
- 记录目标责任层与允许修改面；
- 记录候选 diff/artifact ref，而不是无界大 prompt；
- 声明目标 FAIL_TO_PASS、相邻 PASS_TO_PASS 和 safety 风险；
- 记录 verifier/regression 结果；
- 包含 reviewer、状态、rejection reason 和 rollback target。

禁止修改 verifier、hidden case 或 safety rule 来制造通过。

### 9.2 HarnessVersion

稳定版本至少关联：

- descriptor/hash 和代码 commit；
- scenario/verifier suite versions；
- proposal 与 regression report；
- reviewer decision；
- previous stable version；
- rollback target；
- 已知限制。

dirty workspace、缺 reviewer、存在 safety FAIL、artifact hash 不一致或 regression 未完成时，不得记录为 stable。

### 9.3 Rollback

8-1-2 只证明 rollback target 可解析、目标 artifact 完整且能重新载入 descriptor；不自动执行 Git reset、生产发布或数据回滚。

---

## 十、CLI 与开发工作流

提供一个统一 CLI，命令名可调整，但能力不得散落为只能靠维护者记忆的临时脚本：

```text
def-harness doctor
def-harness describe
def-harness run <scenarioId>
def-harness replay <runId>
def-harness verify <runId>
def-harness regress <suiteId>
def-harness classify <runId>
def-harness proposal create <classificationId>
def-harness version record <proposalId>
def-harness report <runId|regressionId>
```

- `doctor` 只检查依赖，不隐式创建 session 或 mutation；
- 所有命令支持 JSON 输出和稳定退出码；
- token 只保留在进程内；
- 默认输出写入 `.runtime/def-harness`；
- 命令失败返回明确 component、retryability 和 next action；
- 不主动关闭或重启已经运行的 `npm run electron:dev`。

---

## 十一、实施检查点

这些是同一 Task 8-1-2 的实施顺序，不新增 8-1-2-1 等规格层级。

### Checkpoint A：合同、Artifact Store 与 Descriptor

- [ ] 建立 V1 contracts 和统一 validation；
- [ ] 建立 artifact id/hash/ref 与 append-only store；
- [ ] 生成稳定 HarnessDescriptor；
- [ ] 建立 redaction 和 token 泄漏检查；
- [ ] `doctor / describe` 可运行。

### Checkpoint B：Interop Collector 与 Trace Bundle

- [ ] 使用正式 interop client 采集 before/after state；
- [ ] 支持事件 cursor resume、gap 和终态；
- [ ] 收集 transcript/questions/tool/permission/provider error；
- [ ] incomplete/blocked/failure 明确分开；
- [ ] Trace Bundle 可 finalize 并校验 hash。

### Checkpoint C：Scenario、Fixture 与 Replay

- [ ] 建立 scenario loader 和消息/验收分离；
- [ ] 建立隔离 fixture 生命周期；
- [ ] replay 创建全新 fixture/session/ids；
- [ ] 跑通一个单 turn 和一个多 turn受控场景；
- [ ] snapshot 缺失时 mutation scenario 稳定 BLOCKED。

### Checkpoint D：Verifier、Regression 与 Hidden Boundary

- [ ] 四层 verifier 输出统一合同；
- [ ] 建立 verdict precedence；
- [ ] FAIL_TO_PASS、PASS_TO_PASS、safety 联合运行；
- [ ] 环境失败不计 Agent FAIL；
- [ ] Teacher bundle 不泄露 hidden 输入和答案。

### Checkpoint E：Classification、Proposal、Version 与验证记录

- [ ] classification 引用 trace 并追加写入；
- [ ] proposal 为单点、可解释、不可自动应用；
- [ ] stable version gate 和 rollback target 校验；
- [ ] 受控演示跑通 proposal → replay → verifier → accept/reject 数据流；
- [ ] 创建 `verification8-1-2.md`，记录命令、artifact ids、结果和已知限制。

每个 checkpoint 完成并验证后按项目规则自动提交；不要求等整个 Task 一次性完成才提交。

---

## 十二、最小必要检查

本任务属于训练与裁判基础设施，以下聚焦检查确实必要，不受“默认不写测试”限制：

- contract validation 与未知 major 拒绝；
- descriptor/hash 的确定性；
- append-only 与 artifact tamper 检测；
- token/secret redaction；
- cursor resume 不重复 turn；
- fixture 隔离和 cleanup ownership；
- replay 使用新 session/ids；
- snapshot 缺失时 mutation scenario BLOCKED；
- verifier ERROR/BLOCKED/FAIL 优先级；
- safety invariant 一票否决；
- hidden payload 不进入 Teacher bundle；
- dirty commit、缺 reviewer或 regression 失败时不能形成 stable version。

不扩展成对现有业务模块的全面测试重构，不把 vendor OpenCode 测试套件纳入本任务。

## 十三、最终验收演示

最终演示应由一条命令或清晰的最小命令序列完成，并留下机器可读 artifact：

1. `doctor` 确认协议、sidecar、snapshot 和 evaluator 环境；
2. 生成 baseline HarnessDescriptor；
3. 创建隔离 fixture；
4. 运行单 turn 和多 turn scenarios；
5. 生成并校验 Trace Bundles；
6. 在新 fixture/session replay；
7. 运行四层 verifier 与 regression suite；
8. 展示环境 BLOCKED 与 Agent FAIL 的区别；
9. 创建一个受控 failure classification 和 HarnessProposal；
10. 记录 accept 或 reject 的 HarnessVersion 决策及 rollback target；
11. 证明 hidden 原文、token、真实用户数据没有进入 Teacher/public artifacts；
12. 清理本次 fixture，不影响用户当前 Workbench。

该演示只证明 Harness 框架可训练、可裁决、可回滚，不把受控样例包装成真实产品能力提升。

## 十四、明确不做

- 不执行 8-1-3 的真实 Codex failure 返修；
- 不接入或蒸馏 YZ、主播风格和大规模游戏知识；
- 不训练或微调模型权重；
- 不自动修改、提交或发布生产 prompt/skills/code；
- 不建设 Harness Evolution 前端管理页面；
- 不建设云端评测平台、分布式队列或多 Agent swarm；
- 不让 Worker 同时担任最终 Verifier；
- 不用总体成功率替代 safety、业务不变量和失败归因；
- 不以一次受控演示宣称系统已完成自进化。

## 十五、交付物

- Harness V1 contracts 与 validation；
- HarnessDescriptor generator；
- append-only artifact store 与 Turn Trace collector；
- scenario/fixture/replay runner；
- 四层 verifier 与 regression runner；
- hidden evaluator boundary；
- failure classification、proposal、version、rollback records；
- 统一 CLI 与 focused check；
- 一个单 turn、一个多 turn受控 scenario；
- `verification8-1-2.md`；
- 从 8-1-2 移交给 8-1-3 的 runbook 输入和已知限制。

## 完成口径

当维护者不需要临时拼接 curl、复制 transcript 或手工猜测环境状态，便能通过统一命令把一次受控 DEF scenario 变成“可追溯证据 → 隔离 replay → 独立 verdict → 返修候选/版本决策”，并且安全、hidden、rollback 边界可验证时，Task 8-1-2 完成。
