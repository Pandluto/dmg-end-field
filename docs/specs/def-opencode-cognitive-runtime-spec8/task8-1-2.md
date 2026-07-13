# Task 8-1-2：打通可训练 Harness

## 状态

实施中：Checkpoint A/B 已验证；Checkpoint C/D 的旧 package 自检不是 Agent replay，正在替换为真实 native interop 证据。不得提前进入 8-1-3 的真实 Codex 返修。

## 一句话目标

**建立可版本化、按 Session 固定、可并行验证和快速回滚的热插拔 Harness，使角色卡、提示词、知识、Skills 与策略成为安全可训练的候选层。**

## 为什么这样收敛

当前 DEF Harness 虽然不够聪明，但已经能够调用基础功能。8-1-2 的首要目标不是赋予系统无限自改能力，而是在不破坏现有能力的前提下建立第一块可训练表面。

因此本任务采用两条边界：

1. **训练只能修改热插拔教学层**；
2. **运行时、工具实现和裁判保持冻结**。

热插拔仍需要版本、Session 固定、Trace、对照回归和回滚，否则只能算动态读取配置，不能算可安全训练的 Harness。

## 完成定义

本任务完成必须同时证明：

1. 一组教学内容可以被构建为不可变 `DefHarnessPackageV1`；
2. stable 与 candidate 可以同时存在；
3. 新 Session 可以选择并固定某一 Harness 版本；
4. Session 运行中切换 active pointer 不会造成版本漂移；
5. stable/candidate 两个 Session 不会串用 prompt、知识、Skill 或策略；
6. 每个 turn 的 Trace 能追溯实际 Harness id/hash；
7. 同一 Scenario 可在新 fixture、新 Session 下分别对照运行；
8. FAIL_TO_PASS、PASS_TO_PASS 和 safety checks 能阻止明显退化；
9. promotion 和 rollback 都是显式操作，且只影响新 Session；
10. 候选加载失败不会破坏普通 stable 路径，也不会伪装成候选通过。

---

## 一、架构边界

### 1.1 三层架构

```text
DefHarnessPackage
  = 可教学内容；本任务允许形成候选

Harness Host / DEF Runtime
  = 装载、固定版本并执行；本任务只做必要接线

Regression / Verifier
  = 独立裁判；候选不得修改
```

### 1.2 热插拔白名单

首版允许的 package slot：

| Slot | 内容 | 首版要求 |
| --- | --- | --- |
| `agentContract` | 身份、职责、边界、系统提示词 | 支持文本 artifact |
| `roleCards` | 人格、主播语言风格，例如未来 `yz.md` | 支持多个卡片和加载条件 |
| `knowledgePacks` | 游戏知识、项目知识、工作台自我知识 | 支持 manifest/ref，不建设完整 RAG |
| `skills` | 可复用 procedure 与触发条件 | 支持清单、优先级和 hash |
| `routingPolicy` | 意图与知识路由 | 仅声明式配置 |
| `toolGuidance` | 工具说明、选择与调用指导 | 不替换真实 tool schema/实现 |
| `responsePolicy` | 回复、追问、预览、不确定性表达 | 仅声明式配置 |
| `workflows` | 可验证的声明式步骤 | 不允许嵌入任意可执行代码 |

本任务提供最小示例内容证明 slot 生效，但不正式编写 YZ 角色卡，不蒸馏主播数据，也不导入大规模游戏知识。

### 1.3 冻结层

候选不得包含或修改：

- Electron bridge、sidecar 和 interop 实现；
- typed tools、参数 schema 和业务校验实现；
- Workbench 状态存储、数据库和 migration；
- permission、approval/use、安全门禁；
- verifier、hidden case、safety invariant；
- OpenCode vendor 核心代码；
- 任意 `.js/.cjs/.mjs/.ts/.tsx` 可执行 payload。

如果未来训练结论需要修改这些层，应生成工程建议，另开 coding task，经过正常测试和发布；不得借 Harness package 绕过代码审查。

### 1.4 能力分级

Package manifest 必须声明每个 artifact 的能力类型：

- `hotSwappable`：本任务允许装载；
- `restartRequired`：可以被描述，但本任务拒绝作为候选激活；
- `codeChangeRequired`：仅作诊断输出，不能进入 package。

首版 loader 只接受全部生效项均为 `hotSwappable` 的 package。

---

## 二、合同与 Package

### 2.1 单一合同事实源

建立统一运行时校验，不允许 CLI、Registry 和 loader 各自维护相似结构：

- `DefHarnessPackageV1`；
- `DefHarnessManifestV1`；
- `DefHarnessCompatibilityV1`；
- `DefHarnessSessionBindingV1`；
- `DefHarnessTraceRefV1`；
- `DefHarnessRegressionResultV1`；
- `DefHarnessPromotionRecordV1`。

未知 additive 字段保持兼容；未知 major version、未知 slot、可执行 payload 或非法 capability 必须明确拒绝。

### 2.2 Package 身份与不可变性

每个 package 至少记录：

- `harnessId / version / schemaVersion / contentHash`；
- 创建时间、来源 commit、dirty 状态；
- 每个 slot 的 artifact path、hash、media type 和 capability；
- 所需 interop protocol range；
- 所需 Agent Contract、tool registry、state schema、knowledge schema 版本；
- 兼容的 provider/model 条件，可为宽松声明；
- previous stable / rollback target，可为空；
- 创建者和说明。

Package 发布进入 Registry 后不可原地修改。内容变化必须生成新 version 和新 hash。

### 2.3 构建安全

- artifact path 必须限制在 package 根目录内；
- 拒绝 symlink 逃逸、绝对路径和 `..` 穿越；
- manifest、artifact 和最终 package 都进行 SHA-256 校验；
- 不把 token、Authorization、真实用户 transcript 或环境变量打包；
- dirty workspace 可构建开发 candidate，但不得直接 promote 为 stable；
- 角色卡和知识内容视为不可信数据，不能通过内容声明扩大工具权限。

---

## 三、Harness Registry

### 3.1 本地 Registry

首版使用可人工检查的本地 artifact，不建设管理后台：

```text
.runtime/def-harness/
  registry/
    packages/<harnessId>/<version>/
    channels.json
    decisions.jsonl
  runs/<runId>/
```

`.runtime/def-harness` 不提交真实运行数据。仓库内可以提交不含敏感信息的开发 fixture 和示例 package。

### 3.2 Channel 与指针

至少支持：

- `stable`：普通新 Session 默认版本；
- `candidate/<name>`：显式测试版本；
- `previousStable`：最近一次可回滚目标。

active pointer 是对不可变 package 的引用，不复制或改写 package 内容。

### 3.3 激活规则

- 注册 package 不等于激活；
- candidate 不得自动成为 stable；
- promote 必须引用 regression result 和人工 decision；
- safety FAIL、artifact hash 不一致、兼容性失败、dirty source 或回归不完整时禁止 promote；
- rollback 创建新的 append-only decision，不覆盖历史 promotion；
- Registry 更新需要原子写入，失败时保留旧指针。

---

## 四、Session 固定与 Runtime 装载

### 4.1 选择时机

Harness 只在创建 native Session 时解析一次：

```text
create session
  → resolve stable 或显式 candidate
  → validate compatibility + hash
  → create DefHarnessSessionBinding
  → load resolved artifacts
  → pin binding for session lifetime
```

后续 `continue`、问题回答和工具执行都沿用相同 binding。禁止在同一 Session 中无提示漂移版本。

### 4.2 协议接线

在不新建旁路 prompt route 的前提下，对现有正式路径做最小 additive 扩展：

- `start` 测试入口可显式携带 `harnessSelector`；
- 普通 Workbench 创建 Session 时默认解析 stable；
- status/state/transcript 或 Trace 中可观察 resolved harness id/version/hash；
- sidecar/native session binding 保存不可变 resolved ref；
- 旧调用方不传 selector 时保持兼容。

如果现有 native Session 无法安全注入某个 slot，应在 compatibility 中明确标为 unsupported，而不是建立第二套假的聊天运行时。

### 4.3 失败语义

- 显式 candidate 测试加载失败：`BLOCKED_HARNESS_LOAD`，fail closed；
- 普通 stable 路径解析失败：继续使用进程内最近一次已验证 stable，记录告警；
- 没有任何可验证 stable：拒绝创建 Harness-enabled Session，不猜测默认内容；
- 运行中 package 文件被篡改：已装载 Session 保持内存 binding，新 Session 拒绝该 package；
- 不主动关闭或重启已运行的 `npm run electron:dev` 来模拟热插拔。

### 4.4 隔离要求

- stable 与 candidate 使用独立 resolved artifact view；
- package loader 不共享可变 prompt/knowledge/skill 对象；
- cache key 必须包含 content hash；
- active pointer 改变后，已有 Session binding 不变；
- 同一 package 的内容 hash 相同才允许复用只读 cache。

---

## 五、Trace、Scenario 与最小 Replay

### 5.1 Trace 最小扩展

继续使用 8-1-1 正式 interop 采集事实。每个测试 turn 至少追加：

- Harness package ref 与 Session binding ref；
- selector 来源：stable/candidate/explicit version；
- resolved slot hashes；
- package load/compatibility 结果；
- testRun/session/turn/clientTurn/scenario ids；
- transcript、tool events、questions、终态和环境状态；
- verifier/regression refs。

原始事件 append-only；token、Authorization 和真实用户无界数据不得进入 artifact。

### 5.2 Scenario 与 Fixture

首版只建设证明版本切换所需的受控场景：

1. 一个单 turn 场景，能确定性区分 stable/candidate 的 role、knowledge 或 response policy；
2. 一个多 turn 场景，证明同一 Session 始终使用创建时绑定的版本；
3. 一组当前基础功能 PASS_TO_PASS；
4. permission、approval/use、mutation preview 等 safety checks。

Scenario 的普通用户消息和 expected result 必须分开保存，不能把答案或测试说明污染 provider-visible text。

Fixture 必须使用新的 timeline/save/work-node/session 标识，不复用用户当前生产 Session。snapshot 不可用且场景依赖当前轴 mutation 时判定为 `BLOCKED_ENVIRONMENT`，不得计为 Agent FAIL。

### 5.3 Replay 与可比较边界

- replay 总是创建新 fixture 和新 Session；
- stable 与 candidate 使用同一 scenario version 和等价 fixture；
- 记录 provider/model/environment 差异；
- 不要求自然语言逐字一致；
- 比较意图满足、工具路径、业务结果、安全性质和选定风格/知识 rubric；
- 不消费旧 Session，也不通过复用 `clientTurnId` 伪造 replay。

---

## 六、最小 Regression Gate

### 6.1 三类检查

- `FAIL_TO_PASS`：候选是否改善目标教学弱点；
- `PASS_TO_PASS`：当前已经可用的基础能力是否保持；
- `SAFETY`：permission、approval/use、typed validation、preview/apply 等不变量，一票否决。

确定性业务和安全 verifier 优先于 LLM/Codex 自评。同一个 Worker 的自评不能覆盖确定性失败。

### 6.2 结果状态

统一结果至少区分：

- `PASS`；
- `FAIL_AGENT`；
- `BLOCKED_ENVIRONMENT`；
- `ERROR_PROTOCOL`；
- `ERROR_VERIFIER`；
- `INCOMPLETE`。

环境、协议或裁判错误不能被计为候选能力失败，也不能被包装成通过。

### 6.3 本阶段的 hidden 边界

本阶段只保留 evaluator-only 输入与 Worker/候选 package 隔离的接口和一项泄漏检查，不建设完整 hidden regression 平台。高级 Codex 诊断、返修与 hidden 回归闭环属于 8-1-3。

---

## 七、Promotion 与 Rollback

### 7.1 Candidate decision

每次决定以 append-only 记录保存：

- candidate 与 baseline package refs；
- 目标弱点和变更 slot；
- regression report；
- reviewer 与时间；
- `accepted/rejected/rolled-back`；
- rejection reason 或已知限制；
- previous stable / rollback target。

8-1-2 不允许训练系统自己批准自己的候选。

### 7.2 Promotion

Promotion 只更新 `stable` 和 `previousStable` 指针，对已有 Session 无效。必须满足：

- package 与 artifact hash 完整；
- compatibility 通过；
- FAIL_TO_PASS 达标；
- PASS_TO_PASS 无阻塞退化；
- safety 全部通过；
- 环境/协议/verifier 没有未解决错误；
- 存在人工 reviewer decision。

### 7.3 Rollback

Rollback 只把 `stable` 指回可验证的 previous stable：

- 不执行 `git reset`；
- 不改写或删除失败 package；
- 不改变已有 Session；
- 新 Session 立即解析到回滚后的 stable；
- 决策和原因保留在 append-only history。

---

## 八、统一 CLI

命令名可以按现有项目风格微调，但能力不得散落成临时脚本：

```text
def-harness doctor
def-harness package build <sourceDir>
def-harness package validate <packageRef>
def-harness registry list
def-harness registry add <packageRef> --channel candidate/<name>
def-harness run <scenarioId> --harness stable|candidate/<name>|<version>
def-harness compare <baselineRun> <candidateRun>
def-harness regress <suiteId> --baseline stable --candidate <ref>
def-harness promote <candidateRef> --decision <decisionRef>
def-harness rollback
def-harness report <runId|regressionId>
```

- 所有命令支持 JSON 输出和稳定退出码；
- token 只保留在进程内；
- `doctor` 不创建 Session 或 mutation；
- 显式 candidate 失败不能静默改跑 stable；
- 普通用户不需要了解 Registry 才能继续使用当前 stable。

---

## 九、实施检查点

这些是同一 Task 8-1-2 的实施顺序，不继续增加规格层级。

### Checkpoint A：Package 合同与 Registry

- [x] 建立 V1 contracts 与统一 validation；
- [x] 实现 slot 白名单、capability 和 compatibility 检查；
- [x] 实现 package build、hash、路径安全和不可变存储；
- [x] 实现 stable/candidate/previousStable 指针和原子更新；
- [x] 建立 baseline `stable-v0`，记录当前可用 Harness 内容；
- [x] `doctor/package/registry` 命令可运行。

### Checkpoint B：Session Pinning 与 Loader

- [x] 新 Session 默认解析 stable，测试入口可显式选择 candidate；
- [x] 建立不可变 `DefHarnessSessionBindingV1`；
- [x] 将允许的 slot 接入真实 native Session；
- [x] status/trace 可观察 resolved Harness；
- [x] active pointer 改变不影响已有 Session；
- [x] stable/candidate 并行不串配置；
- [x] candidate 加载失败 fail closed，普通 stable 路径有安全 fallback。

### Checkpoint C：Trace、Scenario 与 Replay

- [ ] Trace 保存 package、binding 和 slot hashes；
- [ ] 建立隔离 fixture 与 Scenario loader；
- [ ] replay 使用新 fixture/session/ids；
- [ ] 跑通一个单 turn 与一个多 turn受控场景；
- [ ] provider-visible text 不被测试说明污染；
- [ ] snapshot 缺失时相关 mutation 场景稳定 BLOCKED。

### Checkpoint D：Regression、Promotion 与 Rollback

- [ ] 建立最小 FAIL_TO_PASS、PASS_TO_PASS 和 safety gate；
- [ ] 环境/协议/Agent/verifier 结果明确分开；
- [ ] hidden evaluator-only 数据不进入 Worker/package/公开 Trace；
- [ ] promotion 需要完整证据和人工 decision；
- [ ] rollback 只影响新 Session，且历史可审计；
- [ ] 创建 `verification8-1-2.md`，记录真实命令、ids、结果和限制。

每个 checkpoint 完成并验证后按项目规则自动提交。

---

## 十、聚焦检查

本任务修改版本与运行时选择边界，下列检查确实必要：

- package hash 确定性与篡改拒绝；
- path traversal、symlink escape、可执行 payload 拒绝；
- 未知 major、slot、capability 和不兼容 schema 拒绝；
- Session 创建后 Harness binding 不漂移；
- stable/candidate 并发 Session 不串配置；
- cache key 包含 content hash；
- active pointer 更新只影响新 Session；
- 显式 candidate 加载失败不 fallback 成 stable；
- 普通 stable 加载异常保留上一已验证版本；
- PASS_TO_PASS 或 safety 失败禁止 promotion；
- rollback 原子恢复 previous stable；
- Trace 和 evaluator 边界不泄漏 token、真实用户数据或 hidden 输入。

不扩展为现有业务模块或 vendor OpenCode 的全面测试重构。

---

## 十一、最终验收演示

最终演示应通过统一 CLI 和正式 interop 完成：

1. 将当前可用教学内容冻结为 `stable-v0`；
2. 构建只修改一个热插拔 slot 的 `candidate-v1`；
3. 同时创建 pinned `stable-v0` 和 `candidate-v1` Session；
4. 证明切换 active pointer 后两个已有 Session 仍保持原版本；
5. 在新 fixture/new Session 分别运行单 turn 与多 turn Scenario；
6. Trace 展示准确 package/binding/slot hashes；
7. 运行 FAIL_TO_PASS、PASS_TO_PASS 和 safety gate；
8. 演示一个 rejected candidate 不影响 stable；
9. 经人工 decision promote 一个受控 candidate；
10. 新 Session 使用新 stable，旧 Session不漂移；
11. rollback 后再建 Session，确认恢复 `stable-v0`；
12. 证明 token、真实用户 transcript 和 evaluator-only 输入未进入 package/public artifacts。

该演示只证明热插拔 Harness 已具备安全训练条件，不宣称 YZ 风格、游戏知识或真实产品效果已经提升。

## 明确不做

- 不执行 8-1-3 的 Codex 自主诊断和真实返修；
- 不正式蒸馏或加载 YZ 内容；
- 不建设完整知识库/RAG runtime；
- 不训练模型权重；
- 不让 package 携带任意代码或扩大权限；
- 不热更新 bridge、sidecar、typed tools、数据库或 verifier；
- 不自动批准、发布、提交或推送候选；
- 不建设前端管理页面、云评测平台或多 Agent swarm；
- 不以一次受控演示宣称系统已经自进化。

## 交付物

- Package/manifest/compatibility/session binding/regression/decision V1 contracts；
- immutable package builder 与本地 Registry；
- stable/candidate channel、Session pinning 和 runtime loader；
- Harness-aware Trace、受控 Scenario、fixture 与 replay；
- 最小 regression gate；
- promotion/rollback 记录与统一 CLI；
- baseline `stable-v0` 和一个无真实 YZ 数据的受控 candidate；
- focused checks；
- `verification8-1-2.md`；
- 交给 8-1-3 的 candidate/trace/regression 接口说明。

## 完成口径

当维护者无需覆盖当前稳定 DEF，就能把提示词、角色卡、知识、Skills 与策略打成不可变候选，为新 Session 显式装载，与 stable 并行对照，经过最小回归决定接受或拒绝，并能让之后的新 Session 一步回到上一稳定版本时，Task 8-1-2 完成。
