# Spec 9 Completion Audit

## 审计结论

`INCOMPLETE_EXTERNAL_GATES`

本审计按 `task9-1.md` 的 391 条显式 checkbox 逐段核对。
Task 文件保留为规格清单，不把静态合同或历史运行批量勾成真实黑盒 PASS。

当前集成提交为 `19592d0`。
最新 W6 代码提交为 `87d03e2`，仅比此前通过 UI 验证的 `9e0b624` 多一项测试加固。
该测试把 checkout、pending command、question、approval 与可信数据源组成稳定 state hash，
并在真实 dispatcher 的全部终态前后比较。

代码、合同、职责收口与候选构建已经完成。
目标仍不能标记 complete，因为 provider 黑盒、candidate regression、G5 真实相邻回归、
DEF Shell 确认删除和 activation 决策没有完成。

## 状态定义

| 状态 | 含义 |
| --- | --- |
| `PASS` | 当前源码、自动合同或运行态直接证明该组全部条目 |
| `PARTIAL` | 该组只有部分条目有直接证据；例外逐项列出 |
| `BLOCKED_EXTERNAL_PROVIDER` | 静态合同通过，但真实模型会话因 provider 不可用而未执行 |
| `USER_CONFIRM_REQUIRED` | 最终动作具有破坏性，必须由用户在动作时确认 |
| `PENDING_POST_RESTART_UI` | 最新 W6 已重启，但还需产品 UI 重新绑定后读取新 AgentRelease |

## 逐段完成矩阵

| Task 范围 | 条目数 | 状态 | 当前权威证据与未完成项 |
| --- | ---: | --- | --- |
| 候选实现完成定义，77–96 | 20 | `PARTIAL` | 15/20 已由 A–F、H1/H3/H4 与 I1–I3 证明。77 的真实单调用、91 的原问题/相邻真实回归、92–93 的确认删除、95 的 activation-ready 结论尚未完成。 |
| Checkpoint A，102–167 | 23 | `PASS` | `implementation-map.md` 固化调用链、消费者、owner、基线、迁移映射和文件锁；`SOURCE_BASELINE_COMMIT`、`DISPATCH_COMMIT` 与集成提交均可追溯。 |
| Checkpoint B，173–269 | 58 | `PASS` | `def-equipment-3plus1-tool-surface-contract-test.mjs`、recommendation contract 与 registration contract 证明 Tool/route/schema/terminal/error/correction/digest 边界。 |
| Checkpoint C，275–341 | 52 | `PASS` | `scripts/def-core/**` 是唯一 Domain/Service owner；operator-planning aggregate PASS。`19592d0` 额外证明 checkout、pending command、question、approval 与 source state hash 全部不变。 |
| Checkpoint D，347–398 | 30 | `PASS` | `harness:check` 的 guide-first、system prompt、Tool reference 与 candidate 结构合同证明旧 3+1 编排已从 active Prompt/Skill/Harness 退出；immutable stable 原样保留。 |
| Checkpoint E，404–441 | 20 | `PASS` | 开发侧 audit Skill、rubric、handoff 与 owner examples 均要求一个 primary owner，并把 `ENVIRONMENT` 与产品 Finding 分开。 |
| F1 Service matrix，447–478 | 32 | `PASS` | recommendation + F1 matrix aggregate PASS；覆盖 Guide 三态、合法 set/plan、约束、tie、comparison、revision、digest、shortlist 与三个业务终态只读。 |
| F2 Tool/route，482–487 | 6 | `PASS` | Tool surface、registration、Tool reference 与 native policy 合同 PASS。 |
| F3 运行指纹，491–493 | 3 | `PENDING_POST_RESTART_UI` | `9e0b624` 的 AgentRelease 已证明 component hashes 和候选 ref；测试加固已同步为 W6 `87d03e2`，待 UI 重新绑定后记录新的 runtime commit/releaseHash。 |
| F4 与 F 完成口径，509–520 | 9 | `PASS` | `test:def-operator-build-planning`、`test:def-architecture-contracts`、`harness:check`、`interop:check`、`typecheck`、`git diff --check` 在 `19592d0` 产品树全部 PASS。 |
| G1 测试环境，526–530 | 5 | `PARTIAL` | 正式 Interop、隔离 W6、Chrome UI、候选绑定均已验证；`9e0b624` 新建 fresh Session `ses_076032d4dffejUt648oFqzXwEi`。最终 W6 `87d03e2` 尚待 UI 重新绑定；provider 未就绪，因此无新的 turn/tool/question/error/final trace。 |
| G2 四类自然语言，534–537 | 4 | `BLOCKED_EXTERNAL_PROVIDER` | 当前四个 Scenario 静态合同 PASS；真实 topology、set-selection、correction、unresolved 均未在可用 provider 上执行。 |
| G3 Trace，541–547 | 7 | `BLOCKED_EXTERNAL_PROVIDER` | Scenario verifier 已证明 exact per-turn allowlist、typed result 与禁止旧链；没有真实 turn，故不冒充黑盒 PASS。 |
| G4 结果，551–556 | 6 | `BLOCKED_EXTERNAL_PROVIDER` | Service typed contract 已覆盖结构与只读；真实回答、首字时间、完成时间和 Tool 次数缺失。 |
| G5 相邻回归，560–564 | 5 | `PARTIAL` | mutation 审批自动安全 aggregate PASS；装备事实、source-only guide、weapon fit、operator-config preview 的 fresh-session 回归未执行。 |
| G 完成口径，568–569 | 2 | `BLOCKED_EXTERNAL_PROVIDER` | 四类真实会话没有独立结论，不能以静态 PASS 覆盖。 |
| H1 Verification，575–580 | 6 | `PASS` | `verification.md` 与 `implementation-map.md` 记录 commits、AgentRelease、Harness ref、Scenario 版本、测试、Interop、UI、primitive 保留和删除的旧规则。 |
| H2 Harness 决策，584–587 | 4 | `PARTIAL` | 未 promotion、stable pointer 未改；candidate regression 与 PASS_TO_PASS 缺失，因此尚未向用户提出 activation。 |
| H3/H4，591–602 | 9 | `PASS` | 集成分支干净、无 upstream；baseline 到当前审计树的 60 个文件无 `.runtime`、SQLite、vendor、MCP 或密钥文件；fix、coding 和最终证据均自动提交，未 push。 |
| I1–I3，608–636 | 23 | `PASS` | Host cleanup、显式 keep、Workbench 隔离、幂等、部分失败、renderer capability、内部 loopback token、错误私有化与 Agent 页 UI 均由 architecture aggregate 覆盖。 |
| I4，640–644 | 5 | `PARTIAL` | hermetic cleanup 合同与取消路径通过；真实确认删除仍是 `USER_CONFIRM_REQUIRED`，最终 W6 原生窗口需再做一次可见性复核。 |
| I 完成口径，648–649 | 2 | `PARTIAL` | 隐藏与删除已分离，功能无需归档/TTL；真实删除尚未由用户确认。 |
| W0，670–683 | 8 | `PASS` | 统一 baseline、dispatch、文件锁、预检和分发信封均已记录。 |
| W1，759–768 | 10 | `PASS` | Core、Service、REST composition、共享 stable/catalog utility 与 hermetic tests 已合入。 |
| W2，809–816 | 8 | `PASS` | definition、registry、OpenCode export、typed mapping 与 legacy compatibility 已合入。 |
| W3，864–874 | 11 | `PASS` | active Prompt/Skill、candidate、四类 Scenario、黑盒文档和结构测试已合入；stable 未改。 |
| W4，913–918 | 6 | `PASS` | audit Skill、rubric、handoff 和三个 owner 路由样例已合入，未混入产品 Runtime Skill。 |
| WS，964–970 | 7 | `PASS` | cleanup helper、server-side enumeration、部分失败、Agent 页显式 keep、刷新与摘要合同通过；真实确认属于 I4。 |
| W5，1086–1097 | 12 | `PASS` | 顺序集成、registration contract、唯一 aggregate、architecture 接线、verification 与自动提交均完成。 |
| W6，1104–1112 | 9 | `PARTIAL` | UI/Interop/Harness binding 已验证；G2、G5、candidate regression 与真实确认删除仍缺失。没有 mutation，也没有 promotion。 |

## 当前还必须完成的门

1. 让 `/api/config/deepseek` 返回 `apiKeyConfigured=true`，先执行最小 provider probe。
2. 在最终 W6 fresh Session 顺序执行 topology v2、set-selection v2、correction v2、unresolved v6。
3. 保存每轮 Interop turn/tool/question/error/final、耗时、typed result 与只读状态证据。
4. 执行 candidate vs stable regression，以及 G5 的四项 fresh-session 只读回归。
5. 通过 Computer Use 重验最终 W6 Shell；真实确认删除必须在用户动作时授权。
6. 所有 PASS_TO_PASS 与 safety 门通过后，才向用户提交 candidate ref、收益、退化与回滚目标，等待 activation 决定。

这些门完成前，目标状态保持 active；不得写成 `READY_FOR_ACTIVATION_DECISION` 或 complete。
