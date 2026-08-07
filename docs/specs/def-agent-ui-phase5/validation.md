# DEF Agent Product UI Phase 5 验证记录

## 当前结论

Phase 5 的代码和自动化纵向链路已经完成：Slim React AI 模式现在只通过 DEF Product API 创建 Session、发送/停止 Turn，并完全从 DEF Event Journal 重建用户消息、回答、Tool 过程和终态。浏览器不读取 OpenCode Session/消息协议，Electron 仍只负责 Host 生命周期与代理。

本阶段实现、本地验收和独立审查均已完成。重新启动 `npm run electron:dev` 后，lazy Agent Host 正常就绪，Shell 发出的单次授权能够进入完整 Slim Workbench/AI 面板；面板全高布局、收起/展开、Timeline binding 和 engine unavailable 禁用态均经真实 Chrome 手工检查。当前机器没有配置 OpenCode provider profile，因此没有擅自写入凭据；真实问答由 Product HTTP 自动黑盒覆盖。最终治理把独立审查留下的 P2 全部收口，当前无未关闭 P0/P1/P2。

## 已实现链路

| 层 | 本阶段结果 |
| --- | --- |
| Product HTTP | scoped Session list/create/read、bounded Event cursor、Turn start/retry/abort |
| Host | consumer/binding 校验、全 Host 单 active Turn、`clientTurnId` 幂等与冲突 |
| Browser bridge | capability header、typed response、401/403 fail-closed、无 browser-submitted binding/engine |
| Event Journal | `turn.accepted` 持有用户消息；delta、Tool lifecycle、terminal 可纯投影重建 |
| Slim UI | 右侧可收起工作面板、会话、Markdown 回答、Tool 卡、发送与停止 |
| Real Engine | calculation 路线经 Product HTTP 进入真实 OpenCode adapter，中文结果来自 Event Journal |
| Retention | 硬容量上限、满额背压、轻量 terminal tombstone、压缩幂等记录；不截断 Event |

## 自动化证据

- 完整实现后 `npm run check`：通过；覆盖整仓类型、Web/SQLite/计算测试、Agent Core/Host/Harness、Electron supervisor、真实 OpenCode、Slim build、原子 Service Worker 与离线工作区。
- `npm run test:agent-engine:opencode`：通过；真实 OpenCode 五业务黑盒中 calculation 使用新 Product HTTP API，16 次 provider request 全部得到预期中文结果。
- `npm run electron:smoke:agent-package`：通过；未配置 provider profile 时按合同报告 engine unavailable，不泄露内部身份。
- 最终审计修复后再次执行 `npm run typecheck`、`npm test`、`npm run test:agent-host`：全部通过；StrictMode 并发初始化修复后又执行一次 `npm run typecheck` 与 `npm test`，均通过。
- Browser bridge 回归覆盖 Product 请求体、精确 Session/Turn/Page envelope、Event diagnostics 拒绝、typed conflict 与失权清 capability。
- Event poller 回归覆盖多页追赶、停止保留 cursor、失败重试和切换 Session 时丢弃在途旧事件。
- Transcript model 回归覆盖用户消息、assistant delta、Tool requested/started/result/error、terminal first-wins、单调 sequence 与 active Turn。
- 容量回归覆盖 16 Session、64 Turn、单 Turn/Session Event 条数与体积、Harness transaction、Product command、前端 transcript 条数与体积；验证满额旧重试优先、Engine 只 abort 一次、Event sequence 仍连续。

## 最终自审修复

1. 运行中的 Turn 原先仍可切换或新建 Session，可能让停止入口暂时离开视野；现在 active Turn 会锁定会话选择和新建。
2. 新 checkout/revision 发布后，consumer binding 原先最多等待 5 秒定时心跳才更新；用户立即发送可能用旧 binding 读取新 snapshot。现在 `refreshEligibility()` 会在同一 Timeline 内检测完整 binding 变化并立即 heartbeat，且有专门回归测试。
3. client Turn reservation、跨 Timeline read/abort、poller in-flight Session switch 和 Host binding mutation 顺序均复核通过。
4. 开发模式 React StrictMode 会并发执行两次授权 effect，原先第二次初始化可能在第一次交换 grant 前误判为未授权。现在 `DesktopAgentBridge.initialize()` 合并并发初始化，共享同一个 grant exchange，并有 StrictMode 回归测试。
5. Sol 实际复现 consumer 在 `engine.startTurn()` 延迟期间关闭后 Turn 仍会被接受。Host 现在把 starting Turn 纳入 active identity 与取消路径；引擎返回后会重新验证 consumer，丢失时只 abort 一次 Engine handle、回滚 Harness、拒绝启动且不写 `turn.accepted`，随后仍可重新启动。
6. Host shutdown 现在也标记 starting Turn；显式停止、consumer loss 和 Host shutdown 使用各自确定错误归因，Engine/Harness 终止码一致。
7. Event bridge 现在要求 sequence 严格连续，并对每种 Event 的顶层字段、payload 和 correlation 做 fail-closed 精确校验。
8. `/agent-host/ui/state` 只向 active consumer 的 capability 返回 consumer、Session 和 Turn identity；另一份合法 capability 只能看到 Engine readiness。
9. Browser snapshot 发布现在在 Host 内同步推进 consumer binding；同范围更新不再先 heartbeat 后传快照，失败发布不会通过后续 heartbeat 偷跑新 binding。
10. settled Turn 立即释放 Engine 重对象，成功 `clientTurnId` 压缩为结果记录；Session/Event/Harness/command/transcript 全部采用有限容量与确定背压，不删除旧 Event，因此协议仍为 v2。

## 独立审查

Sol xhigh 首轮报告 1 个 P1 和后续治理 P2。P1 已修复并加入延迟 Engine start + consumer close 黑盒回归；随后逐项完成 starting shutdown/error、owner state、原子 snapshot、Event fail-closed 和有限 retention。第二轮只读容量审查确认应采用“硬上限 + 满额背压”、不得滚动截断 Event，且无需升级协议；实现与该结论一致。审查者未修改文件。

复审通过：`npm run typecheck:agent`、`npm run test:agent-harness`、`npm run test:agent-host`、`npm test`。本次修复没有改动 OpenCode adapter 或 Product HTTP 路径，因此未重复运行真实模型黑盒。

## 边界确认

- Session/Event 仍只存在于本次 Host 进程；重启恢复和归档未伪装为已完成。
- 当前上限为 16 Session/Host、64 Turn/Session、4096 Event 与 4 Mi code units/Session、1024 Event 与 1 Mi code units/Turn；达到上限会显示明确提示，历史保持完整。
- 本阶段没有 Question、Approval、mutation、会话删除、Provider 凭据编辑或 AI CLI。
- 普通 Slim 页面没有 AI 导航入口；直接访问隐藏路由会 fail-closed 并提示从 Electron Shell 打开。
- Browser SQLite/OPFS 仍是唯一业务事实源；旧 Node SQLite、旧 REST 和 OpenCode Web UI 没有恢复。

## 治理 P2 收口

| 项目 | 状态 |
| --- | --- |
| starting Turn shutdown 与错误归因 | 完成 |
| consumer binding + Browser snapshot 原子发布 | 完成 |
| UI state capability owner 隔离 | 完成 |
| Event 连续序号与精确字段校验 | 完成 |
| settled Turn、clientTurn、Journal、Harness、command、transcript 容量策略 | 完成 |
