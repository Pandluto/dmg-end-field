# Spec 9 Verification

## 当前结论

`BLOCKED_EXTERNAL_PROVIDER_AUTH`

五个实现包、W5 跨包接线和 W6 Host 返修已经完成。
Workbench、Interop、候选绑定和 DEF Shell 清理入口均已通过真实界面验证。
DeepSeek Key 尚未配置；真实模型调用返回 401，四类语义场景不能给出通过结论。
候选没有上线，stable pointer 也没有修改。

## 提交基线

| 名称 | SHA |
| --- | --- |
| `SOURCE_BASELINE_COMMIT` | `7c751740f27e1a8af4a2456520677c4e46d6efc5` |
| `DISPATCH_COMMIT` | `772a4dc912b7d4361c108f968a28c0ae5bc4c134` |
| W1 Core + Service | `57fa1e5ff136e4e0411a7f7490358adaf1a8e460`、`3ab9598e276349f06b566c94770ce35888979f10` |
| W2 Tool Surface | `585e18a9b554a70401f0732842c469d77ceb45b9`、`942ed9dbba6c7c3a6fba189c8028da99833dcbb3`、`1ddee1ceb6d1858f85295d06c45d2b3c1adcd602` |
| W3 Runtime + Harness | `ef50ed51644fc4e3e763ac2832b508e4e41e7ae1`、`3e5971edadce7d2edcd07e3b8653ec2581e51cf4` |
| W4 Teacher Audit | `2f8ade5d0a68d60a7a1a2216cff298d555482bbb` |
| WS Session Cleanup | `e218f41ef0aade29ea2486df7a99e88ab9da3fdd` |
| W5 Integration | `9b9b3db8ab30a7a39044c5102420f1737af60999` |
| W6 Shell 入口返修 | `ed9457e135d758ecc1552f377285eb91ac1665af` |
| W6 renderer loopback 返修 | `1ce571845878ee435f35cf8d58d939b6772401b5` |
| W6 Interop loopback 返修 | `6613d24c97975d3c2a8e5af85c0091aeb800bacd` |

## 实现边界

- W1 Domain 与 Service 是 3+1 recommendation 算法的唯一 owner。
- REST 只负责 composition、传输与旧入口适配。
- W2 提供新 V1 Tool、Schema 与 typed error mapping。
- 旧 shortlist、facts、plan primitive 均为 `COMPATIBILITY_RETAINED`。
- W3 候选是 `def-equipment-3plus1-composite@9.1.0-candidate.1`。
- WS 仅提供 Host 手动清理，不含归档、TTL 或自动清扫。

## W5 自动验证

| 验证 | 状态 | 证据 |
| --- | --- | --- |
| Service + Tool Surface + Registration aggregate | PASS | `npm run test:def-equipment-3plus1-recommendation` |
| Cross-package registration wiring | PASS | 真实隔离 sidecar；覆盖 definition、route-map、session policy、dispatcher 与 W1 Service |
| Host session cleanup contract | PASS | `npm run test:def-native-session-cleanup`；使用临时目录与伪上游 |
| Native loopback authority contract | PASS | `npm run test:def-native-loopback-proxy`；覆盖 renderer proxy、Interop GET/POST、401、超时与非回环拒绝 |
| Operator build planning aggregate | PASS | `npm run test:def-operator-build-planning` |
| Harness guide-first policy | PASS | `npm run test:def-harness-guide-first` |
| Harness turn routing | PASS | `npm run test:def-harness-turn-routing` |
| Harness scenario verification | PASS | `npm run test:def-harness-scenario-verification` |
| Model instruction Tool references | PASS | `npm run test:def-model-instruction-tools` |
| Work Node same-session delete | PASS | `npm run test:def-worknode-session-delete` |
| Interop static and protocol check | PASS | `npm run interop:check` |
| Harness aggregate | PASS | `npm run harness:check` |
| Architecture aggregate | PASS | `npm run test:def-architecture-contracts`；包含 cleanup 标准入口 |
| TypeScript | PASS | `npm run typecheck` |
| Patch whitespace | PASS | `git diff --check` |

架构 aggregate 暴露了既有 REST 合同的 Windows 冷启动抖动。
多份合同只等待 4–8 秒，并会在机器繁忙时误报失败。
本入口涉及的 sidecar readiness 已统一为 20 秒上限。
服务就绪后不会增加测试时长；超时仍然抛错并失败闭合。
调整后完整架构 aggregate 为 PASS。

## 候选注册

| 字段 | 当前值 |
| --- | --- |
| Harness selector | `def-equipment-3plus1-composite@9.1.0-candidate.1` |
| Immutable ref | `{ harnessId: "def-equipment-3plus1-composite", version: "9.1.0-candidate.1", contentHash: "34c3e4d6…c15a6" }` |
| `contentHash` | `34c3e4d63ed51df716fcb80c78f7d027eff24d1f4117ae162227a098847c15a6` |
| W5 source commit | `9b9b3db8ab30a7a39044c5102420f1737af60999` |
| W5 source tree | `7c7a3f77ad6c25666b83b2bee5689a943d080536671b545e3070ad9b52e357cd` |
| stable pointer | `def-stable@0.0.0` / `9a9926502c2bb2296f106512a45684cbcc7bad6de2119f32dc70b9aa662c5261`；`previousStable=null` |

候选已从干净 W5 提交构建并注册。
W6 的 Host 返修不修改 Harness package 内容，因此不重写该 immutable ref。

四类 W6 语义场景的静态合同已冻结。以下是已保存的 package-check 记录：

| 场景 | package-check id | 状态 |
| --- | --- | --- |
| `equipment-3plus1-topology-v1` v1 | `package-check-a46c3514-12e4-4475-b754-a337b637e1f2` | `SUPERSEDED_BY_V2_SCENARIO` |
| `equipment-3plus1-set-selection-v1` v1 | `package-check-61fda0ed-4b06-4286-a9f9-e9be41e7459d` | `SUPERSEDED_BY_V2_SCENARIO` |
| `equipment-3plus1-unresolved-v1` v1 | `package-check-cc591b27-45ef-45eb-9d5f-afdcebfc53ef` | `SUPERSEDED_BY_V5_SCENARIO` |

`operator-config-correction-review-v1` 是两轮场景；其“第二轮重新 recommend”
由 `npm run test:def-harness-scenario-verification` 静态合同覆盖，当前没有可核实的
独立 package-check id。当前四类场景分别为 topology v2、set-selection v2、correction v2、
unresolved v5。它们每轮只允许 composite recommend，任何其他 attempted Tool 都失败。
unresolved v5 使用 G2 原文的“寒冷伤害会不会触发潮涌第二段”问题，要求 actual typed result
同时为 `DefEquipmentThreePlusOneRecommendationV1` / `UNRESOLVED`。最后可见回答按 Unicode
`Po` / `Pd` / `Pc` 与换行切分；结构化 `allOf` / `anyOf` / `noneOf` 规则要求同一分句给出
关联同一对象的“不能证明”结论，并拒绝相反断言。
当前 worktree 没有候选 runtime registry，不能诚实地产生新的 package-check id；
`npm run test:def-harness-scenario-verification` 已对当前静态合同 PASS，但这不替代 W6 真实会话。

## W6 fresh-session 证据

| 验证面 | 状态 | 说明 |
| --- | --- | --- |
| AgentRelease / runtime commit / release hash | PASS | W6 runtime `91ac1a28c8b8be724250f968cfe7daa30d5bdfbc`；release `ae5f8cc3f582f69c53442f49c900a4027444ff3dcfe654f48f882b6d52e8bbde`；候选 hash 与注册值一致 |
| 历史 `equipment-3plus1-topology-v1` v1 | BLOCKED_EXTERNAL_PROVIDER | run `native-harness-run-f89cc4d0-bf43-4d4a-8323-242d93f063ca`；Session `ses_07686b64fffeKpIzvTG9bBgoIX`；provider 401；Tool 调用数为 0；runner cleanup 完成；不作为 v2 结论 |
| `equipment-3plus1-topology-v1` v2 | NOT_RUN_AFTER_PROVIDER_BLOCK | 当前静态合同 PASS；尚无当前版本真实会话 |
| `equipment-3plus1-set-selection-v1` v2 | NOT_RUN_AFTER_PROVIDER_BLOCK | 当前静态合同 PASS；旧 v1 package-check 已被替代 |
| `equipment-3plus1-unresolved-v1` v4 | NOT_RUN_AFTER_PROVIDER_BLOCK | 当前静态合同 PASS；旧 v1 package-check 已被替代 |
| `operator-config-correction-review-v1` v2 | NOT_RUN_AFTER_PROVIDER_BLOCK | 当前静态两轮合同 PASS；没有真实会话或独立 package-check |
| candidate regression（candidate vs stable） | NOT_RUN_AFTER_PROVIDER_BLOCK | 需要真实 native session 与可调用 provider；没有用 evaluator-only 结果代替候选回归 |
| G5 相邻只读回归 | NOT_RUN_AFTER_PROVIDER_BLOCK | 精确装备事实、source-only guide、weapon fit 与 operator-config preview 尚未在 fresh session 执行；既有 mutation 审批自动安全合同仍为 PASS，但不替代 G5 黑盒 |
| Interop state / binding | PASS | `snapshotAvailable=true`、`uiConsumerCount=1`、显式绑定完整候选 ref；真实 AgentRelease 可读 |
| Workbench Chrome UI | PASS | 从产品入口进入真实 Workbench 与 AI 模式；旧 caller gate 已消失；renderer snapshot 与 Interop snapshot 均可用 |
| DEF Shell cleanup button | PASS_CANCEL_PATH | Agent 页可见；只列出 1 个合法 `ai-cli` Session；显式选择后才可清理；确认框取消后 1 个 `ai-cli` 与 8 个 Workbench Session 均保留 |
| DEF Shell confirmed delete | USER_CONFIRM_REQUIRED | 真实删除会话是破坏性操作；本轮只验证取消路径，未接受确认框，也没有把取消路径写成确认删除成功 |
| Provider 配置 | BLOCKED | `/api/config/deepseek` 返回 `apiKeyConfigured=false`；首个真实 turn 收到非重试型 401 `Authentication Fails` |

首个真实 run 发生在 loopback 返修之前，因此当时还记录了 `snapshotAvailable=false`。
返修后重新从产品入口验证，Interop 已稳定返回快照与候选绑定。
由于 provider 仍不可用，没有把旧 run 的场景校验失败误记为候选行为失败。

## Activation 边界

- stable pointer 尚未 promotion。
- 默认 Harness 尚未切换。
- 旧 primitive 尚未退休。
- 用户尚未作 activation 决定。
- 配置有效 provider 后，先跑一次最小探针，再顺序执行四类 fresh-session 场景、candidate regression 与 G5 相邻只读回归；全部通过后才能改为 `READY_FOR_ACTIVATION_DECISION`。
