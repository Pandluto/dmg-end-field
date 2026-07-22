# Spec 9 Verification

## 当前结论

`BLOCKED_EXTERNAL_PROVIDER_AUTH`

五个实现包、W5 跨包接线、W6 Host 返修和最终安全/领域/Scenario 加固已经完成。
最终 W6 运行时已重新构建；Workbench、Interop、候选绑定和 DEF Shell 清理入口均有运行态证据。
DeepSeek Key 尚未配置；真实模型调用返回 401，四类语义场景不能给出通过结论。
候选没有上线，stable pointer 也没有修改。

W8 已在独立源码分支收紧 G5 Scenario、通用 verifier、G5 package preflight 与 CLI selector
解析合同；这些自动合同为 PASS，但没有调用 provider，也没有构建、注册或 promotion 新候选。

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
| 最终集成代码提交 | `8ee48c5c2ac78545dc102c67a2c479494518a544` |
| 最终 W6 运行时提交 | `9e0b6240e1284a7ed574c89ac379ac42e2d99a26` |

## 实现边界

- W1 Domain 与 Service 是 3+1 recommendation 算法的唯一 owner。
- REST 只负责 composition、传输与旧入口适配。
- W2 提供新 V1 Tool、Schema 与 typed error mapping。
- 旧 shortlist、facts、plan primitive 均为 `COMPATIBILITY_RETAINED`。
- W3 候选是 `def-equipment-3plus1-composite@9.1.0-candidate.1`。
- W8 源码候选升级为 `def-equipment-3plus1-composite@9.1.0-candidate.2`；尚未注册，W3 的 `.1` immutable ref 保持不变。
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
| Harness scenario verification | PASS | `npm run test:def-harness-scenario-verification`；含通用 structured input/result/cross-tool assertions、封闭 value map、2/3 词条与单侧遗漏、无 scenario-id 特判，以及无效 schema → pre-provider `ERROR_VERIFIER` |
| G5 package preflight contract | PASS | `npm run test:def-harness-g5`；四个 Scenario 的 package-check 全部先于 provider，任一失败为 `ERROR_VERIFIER` 且 provider 调用数为 0 |
| Harness CLI selector parser | PASS | `npm run test:def-harness-cli`；覆盖 `--x value`、`--x=value` 与 Windows `npm_config_*` fallback，不调用 provider |
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

最终集成在 `8ee48c5` 再次执行 recommendation、operator planning、architecture、
Harness、Interop、TypeScript 与 whitespace 检查，全部 PASS。首次 operator planning
在 Windows 冷启动时超过旧 8 秒门限；`03a987d` 把该就绪门统一为 20 秒并保留早退失败，
随后独立命令与完整 aggregate 均 PASS。

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

### W8 源码候选（尚未注册）

| 字段 | 当前值 |
| --- | --- |
| Source package | `def-equipment-3plus1-composite@9.1.0-candidate.2` |
| Manifest provenance | `e6d08bb2b344b357dcc972859e271875d350884f`（W8 分发基线，不是最终集成 seal） |
| Registry / `contentHash` | `NOT_BUILT_OR_REGISTERED` |
| stable / previousStable pointer | 未修改 |

`.2` 增加 catalog-only 多装备单次 `queries` batch 教学，不能复用 `.1` 的 identity 或 hash。
自动 Registry 合同会同时保留 `.1` 与 `.2`，拒绝同 id/version 的不同 hash，并验证冲突失败后旧
package 字节不变。集成方必须在最终干净提交重新 build/register `.2`，以最终集成提交重封
`sourceCommit` / `sourceTreeHash` / `contentHash`；本分支没有把 dirty build 写成运行时证据。

四类 W6 语义场景的静态合同已冻结。以下是已保存的 package-check 记录：

| 场景 | package-check id | 状态 |
| --- | --- | --- |
| `equipment-3plus1-topology-v1` v1 | `package-check-a46c3514-12e4-4475-b754-a337b637e1f2` | `SUPERSEDED_BY_V2_SCENARIO` |
| `equipment-3plus1-set-selection-v1` v1 | `package-check-61fda0ed-4b06-4286-a9f9-e9be41e7459d` | `SUPERSEDED_BY_V2_SCENARIO` |
| `equipment-3plus1-unresolved-v1` v1 | `package-check-cc591b27-45ef-45eb-9d5f-afdcebfc53ef` | `SUPERSEDED_BY_V6_SCENARIO` |

`operator-config-correction-review-v1` 是两轮场景；其“第二轮重新 recommend”
由 `npm run test:def-harness-scenario-verification` 静态合同覆盖，当前没有可核实的
独立 package-check id。当前四类场景分别为 topology v2、set-selection v2、correction v2、
unresolved v6。它们每轮只允许 composite recommend，任何其他 attempted Tool 都失败。
unresolved v6 使用 G2 原文的“寒冷伤害会不会触发潮涌第二段”问题，要求 actual typed result
同时为 `DefEquipmentThreePlusOneRecommendationV1` / `UNRESOLVED`。最后可见回答按 Unicode
`Po` / `Pd` / `Pc` 与换行切分；结构化 `allOf` / `anyOf` / `noneOf` 规则要求同一分句给出
关联同一对象的“不能证明”结论，并拒绝相反断言。
当前 worktree 没有候选 runtime registry，不能诚实地产生新的 package-check id；
`npm run test:def-harness-scenario-verification` 已对当前静态合同 PASS，但这不替代 W6 真实会话。

## W6 fresh-session 证据

| 验证面 | 状态 | 说明 |
| --- | --- | --- |
| AgentRelease / runtime commit / release hash | PASS | 最终 W6 runtime `9e0b6240e1284a7ed574c89ac379ac42e2d99a26`；release `eaf599b5b6324da74515308d3c5fa080d5a693d0b27b046085429d60eb944bc7`；候选 hash 与注册值一致 |
| 历史 `equipment-3plus1-topology-v1` v1 | BLOCKED_EXTERNAL_PROVIDER | run `native-harness-run-f89cc4d0-bf43-4d4a-8323-242d93f063ca`；Session `ses_07686b64fffeKpIzvTG9bBgoIX`；provider 401；Tool 调用数为 0；runner cleanup 完成；不作为 v2 结论 |
| `equipment-3plus1-topology-v1` v2 | NOT_RUN_AFTER_PROVIDER_BLOCK | 当前静态合同 PASS；尚无当前版本真实会话 |
| `equipment-3plus1-set-selection-v1` v2 | NOT_RUN_AFTER_PROVIDER_BLOCK | 当前静态合同 PASS；旧 v1 package-check 已被替代 |
| `equipment-3plus1-unresolved-v1` v6 | NOT_RUN_AFTER_PROVIDER_BLOCK | 当前静态合同 PASS；旧 v1 package-check 已被替代 |
| `operator-config-correction-review-v1` v2 | NOT_RUN_AFTER_PROVIDER_BLOCK | 当前静态两轮合同 PASS；没有真实会话或独立 package-check |
| candidate regression（candidate vs stable） | NOT_RUN_AFTER_PROVIDER_BLOCK | 需要真实 native session 与可调用 provider；没有用 evaluator-only 结果代替候选回归 |
| G5 相邻只读回归 | NOT_RUN_AFTER_PROVIDER_BLOCK | 自动合同已收紧：equipment v2 只允许一次 weapon + 一次 equipment batch；preview v2 使用 `active-current-readonly` 并锁定当前完整 loadout、renderer `finalConfig`、`REVIEW_REQUIRED`、proposal token 与 `currentCheckoutTouched=false`；G5 在 provider 前逐场景 package-check。真实 fresh session 仍未执行，自动 PASS 不替代 G5 黑盒 |
| Interop state / binding | PASS | `snapshotAvailable=true`、`uiConnected=true`、`uiConsumerCount=1`；Session `ses_07662125efferAdRHBwbvoS6KS` 显式绑定完整候选 ref；真实 AgentRelease 可读 |
| Workbench Chrome UI | PASS | 通过 Chrome Extension 从产品入口进入 Workbench 与 `AI 模式`；真实面板显示 `排轴助手`，textbox 为 `描述你想查看、调整或应用的排轴…`；旧测试文案已同步更正 |
| DEF Shell cleanup renderer（最终 W6） | PASS_AUTH_FAIL_CLOSED | Agent 页可见；最终运行时列出 2 个合法 `ai-cli` Session；未选 keep 时按钮禁用，显式选择后启用；无 Electron renderer capability 的浏览器副本在确认前拒绝请求 |
| DEF Shell native cancel path | PASS_PREVIOUS_W6_RUNTIME | runtime `91ac1a2` 的 Computer Use 已验证确认框取消后 1 个 `ai-cli` 与 8 个 Workbench Session 均保留；取消发生在网络请求之前，最终授权返修未改变该路径 |
| DEF Shell native final recheck | ENVIRONMENT_BLOCKED_FOREGROUND_LOCK | Computer Use 能读取 `DEF Shell Console` 无障碍树，但当前 Windows 前台应用拒绝激活该窗口；没有借助非规范脚本绕过，也没有执行删除 |
| DEF Shell confirmed delete | USER_CONFIRM_REQUIRED | 真实删除会话是破坏性操作；本轮只验证取消路径，未接受确认框，也没有把取消路径写成确认删除成功 |
| Provider 配置 | BLOCKED | 最终 sidecar `http://127.0.0.1:17322/api/config/deepseek` 返回 `apiKeyConfigured=false`；首个真实 turn 收到非重试型 401 `Authentication Fails` |

首个真实 run 发生在 loopback 返修之前，因此当时还记录了 `snapshotAvailable=false`。
返修后重新从产品入口验证，Interop 已稳定返回快照与候选绑定。
由于 provider 仍不可用，没有把旧 run 的场景校验失败误记为候选行为失败。
最终 Shell 原生窗口复核的前台锁只影响该次 Computer Use 重演；cleanup HTTP、授权、
错误语义、Windows CRLF 与 renderer fail-closed 合同均已在最终提交自动 PASS。

## Activation 边界

- stable pointer 尚未 promotion。
- 默认 Harness 尚未切换。
- `.2` 只存在于源码，必须在最终集成提交重建并注册后才能用于 fresh Session。
- 旧 primitive 尚未退休。
- 用户尚未作 activation 决定。
- 配置有效 provider 后，先跑一次最小探针，再顺序执行四类 fresh-session 场景、candidate regression 与 G5 相邻只读回归；全部通过后才能改为 `READY_FOR_ACTIVATION_DECISION`。
