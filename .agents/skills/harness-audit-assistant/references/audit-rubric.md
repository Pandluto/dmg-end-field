# Harness 会话审计量表

## 证据优先级

1. `DefCodexInteropProtocol v1`：turn、transcript、tool、question、permission、错误与终态的首要事实源。
2. 原生 OpenCode SQLite：用于离线导出和协议不可用时的只读补证，不替代实时 bridge 状态。
3. Computer Use：只证明真实 Workbench UI 可见、审批卡存在或持久化后页面仍一致。
4. 文档和 Agent 自述：只能说明意图，不能证明运行结果。

## 必查维度

| 维度 | 要问的问题 | 常见失败信号 |
| --- | --- | --- |
| Harness 路由 | 是否命中正确 Skill/规则？规则是否互相冲突？ | 同义请求一会通过一会失败；被禁止的发现式读取 |
| typed tool 合同 | 工具的 scope、source、exhaustive、truncated、missingReasons 是否诚实？ | selected-only 被当全库；任意前 N 项冒充推荐 |
| 知识读取 | 是否先定位 reference 再精读准确 section？ | 通用 600 字截断；重复关键词搜索；读错攻略 |
| 调用效率 | 能否批量读取？是否存在逐人/N+1/失败重试？ | 四个人逐个查；相同工具参数反复调用 |
| mutation/审批 | 所有副作用是否有原生审批？拒绝是否零变化？ | 绕审批；拒绝后仍产生 child/commit/live 变化 |
| CAS/持久化 | prepared revision、checkout、commit、live 是否一致？ | UI 短暂变化，重进页面丢失；旧 revision 覆盖新状态 |
| bridge/UI | 协议关联是否稳定？UI 只做显示确认吗？ | 跨 session 串线；用截图代替工具事实 |
| 完成声明 | 回答中的“已完成”是否有 postcondition？ | 工具未注册/失败却声称成功；只验证模拟路径 |

## 严重度

- **P1**：审批绕过、越权 mutation、数据丢失或错误持久化、跨会话泄漏/串线、重复副作用。
- **P2**：核心用户路径稳定失败、错误数据源、工具合同导致系统性误答、极端 N+1 使功能不可用。
- **P3**：低频质量或效率问题、提示/文档不清、已有安全回退且不影响主链路。

严重度由用户影响决定，不由改动行数决定。单次只读误答通常从 P2/P3 评估，不自动升为 P1。

## 通过判据

- 保存用户原文及 provider-visible text，二者未被测试说明污染。
- 记录完整工具序列、输入输出、错误、问题卡和终态。
- mutation 必须同时验证：审批前无副作用、拒绝零变化、批准后 commit/applied/live 一致、重进 UI 仍存在。
- 知识任务必须证明命中目标 reference 和准确 section，而不是只看最终措辞。
- 效率任务必须给调用计数和批量/逐项路径，不用主观“看起来更快”。
- 对偶发问题至少比较一个失败 run 与一个通过 run，找出输入、binding、Harness hash、session pin 或工具轨迹差异。

## 根因分类

- `HARNESS_ROUTING`：提示词、Skill 路由、session pin 或规则冲突。
- `TOOL_CONTRACT`：typed schema、scope、默认值、结果语义或缺失能力。
- `DATA_SOURCE`：读取了错误镜像、selected 集合、旧存储或截断数据。
- `KNOWLEDGE_RETRIEVAL`：reference 搜索、section 精读、allowlist 或内容连续性。
- `MUTATION_SAFETY`：审批、reservation、CAS、rollback、持久化。
- `PROTOCOL_UI`：v1 关联、SSE、consumer、iframe、UI 可见性。
- `AGENT_POLICY`：无界探索、重复调用、过早完成、没按 postcondition 验证。
- `ENVIRONMENT`：plugin 未注册、snapshot/provider/sidecar 不可用。

先用代码和轨迹证明分类；证据不足时写成“假设”，不要伪装成结论。
