# Spec 9 Verification

## 当前结论

`INTEGRATED_AWAITING_W6`

五个实现包已经合入，W5 跨包接线已经完成。
当前不代表候选已上线，也没有修改 stable pointer。
最终 activation 结论等待 W6 fresh-session 与真实界面验证。

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
| W5 Integration | 待本轮验证后提交 |

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
| Immutable ref | NOT RUN |
| `contentHash` | NOT RUN |
| W5 source commit | NOT RUN |
| stable pointer | 未修改；注册后再次核对 |

候选必须从干净 W5 提交重新构建。
工作包阶段产生的临时 hash 不是正式证据。

## W6 fresh-session 证据

| 验证面 | 状态 | 说明 |
| --- | --- | --- |
| AgentRelease / runtime commit / release hash | NOT RUN | 只记录真实运行返回值 |
| `equipment-3plus1-topology-v1` | NOT RUN | 必须显式绑定完整 Harness ref |
| `equipment-3plus1-set-selection-v1` | NOT RUN | 必须显式绑定完整 Harness ref |
| `equipment-3plus1-unresolved-v1` | NOT RUN | 必须显式绑定完整 Harness ref |
| `operator-config-correction-review-v1` | NOT RUN | 需要隔离 snapshot；不能触碰正式数据 |
| Interop events / transcript / questions | NOT RUN | 协议证据是工具与终态的权威来源 |
| Workbench Chrome UI | BLOCKED | W0 遇到 `Workbench local-data transport is unavailable to this caller`；W6 按产品入口重试 |
| DEF Shell cleanup button | NOT RUN | 验证确认、取消、当前 Session 保留和刷新 |

W0 的 UI 阻塞属于环境证据，不等于候选 PASS 或 FAIL。
W6 不得通过伪造 capability、直接 REST 或旧会话绕过它。

## Activation 边界

- stable pointer 尚未 promotion。
- 默认 Harness 尚未切换。
- 旧 primitive 尚未退休。
- 用户尚未作 activation 决定。
