# DEF Agent Product UI Phase 5 验证记录

## 当前结论

Phase 5 的代码和自动化纵向链路已经完成：Slim React AI 模式现在只通过 DEF Product API 创建 Session、发送/停止 Turn，并完全从 DEF Event Journal 重建用户消息、回答、Tool 过程和终态。浏览器不读取 OpenCode Session/消息协议，Electron 仍只负责 Host 生命周期与代理。

本阶段实现和本地验收已经完成，但暂不宣称最后一道审查门关闭。重新启动 `npm run electron:dev` 后，lazy Agent Host 正常就绪，Shell 发出的单次授权能够进入完整 Slim Workbench/AI 面板；面板全高布局、收起/展开、Timeline binding 和 engine unavailable 禁用态均经真实 Chrome 手工检查。当前机器没有配置 OpenCode provider profile，因此没有擅自写入凭据；真实问答由 Product HTTP 自动黑盒覆盖。Sol 独立审查已发起，但平台额度耗尽而未产出结论，独立审查门保持未勾选。

## 已实现链路

| 层 | 本阶段结果 |
| --- | --- |
| Product HTTP | scoped Session list/create/read、bounded Event cursor、Turn start/retry/abort |
| Host | consumer/binding 校验、全 Host 单 active Turn、`clientTurnId` 幂等与冲突 |
| Browser bridge | capability header、typed response、401/403 fail-closed、无 browser-submitted binding/engine |
| Event Journal | `turn.accepted` 持有用户消息；delta、Tool lifecycle、terminal 可纯投影重建 |
| Slim UI | 右侧可收起工作面板、会话、Markdown 回答、Tool 卡、发送与停止 |
| Real Engine | calculation 路线经 Product HTTP 进入真实 OpenCode adapter，中文结果来自 Event Journal |

## 自动化证据

- 完整实现后 `npm run check`：通过；覆盖整仓类型、Web/SQLite/计算测试、Agent Core/Host/Harness、Electron supervisor、真实 OpenCode、Slim build、原子 Service Worker 与离线工作区。
- `npm run test:agent-engine:opencode`：通过；真实 OpenCode 五业务黑盒中 calculation 使用新 Product HTTP API，16 次 provider request 全部得到预期中文结果。
- `npm run electron:smoke:agent-package`：通过；未配置 provider profile 时按合同报告 engine unavailable，不泄露内部身份。
- 最终审计修复后再次执行 `npm run typecheck`、`npm test`、`npm run test:agent-host`：全部通过；StrictMode 并发初始化修复后又执行一次 `npm run typecheck` 与 `npm test`，均通过。
- Browser bridge 回归覆盖 Product 请求体、精确 Session/Turn/Page envelope、Event diagnostics 拒绝、typed conflict 与失权清 capability。
- Event poller 回归覆盖多页追赶、停止保留 cursor、失败重试和切换 Session 时丢弃在途旧事件。
- Transcript model 回归覆盖用户消息、assistant delta、Tool requested/started/result/error、terminal first-wins、单调 sequence 与 active Turn。

## 最终自审修复

1. 运行中的 Turn 原先仍可切换或新建 Session，可能让停止入口暂时离开视野；现在 active Turn 会锁定会话选择和新建。
2. 新 checkout/revision 发布后，consumer binding 原先最多等待 5 秒定时心跳才更新；用户立即发送可能用旧 binding 读取新 snapshot。现在 `refreshEligibility()` 会在同一 Timeline 内检测完整 binding 变化并立即 heartbeat，且有专门回归测试。
3. client Turn reservation、跨 Timeline read/abort、poller in-flight Session switch 和 Host binding mutation 顺序均复核通过。
4. 开发模式 React StrictMode 会并发执行两次授权 effect，原先第二次初始化可能在第一次交换 grant 前误判为未授权。现在 `DesktopAgentBridge.initialize()` 合并并发初始化，共享同一个 grant exchange，并有 StrictMode 回归测试。

## 边界确认

- Session/Event 仍只存在于本次 Host 进程；重启恢复和归档未伪装为已完成。
- 本阶段没有 Question、Approval、mutation、会话删除、Provider 凭据编辑或 AI CLI。
- 普通 Slim 页面没有 AI 导航入口；直接访问隐藏路由会 fail-closed 并提示从 Electron Shell 打开。
- Browser SQLite/OPFS 仍是唯一业务事实源；旧 Node SQLite、旧 REST 和 OpenCode Web UI 没有恢复。

## 待关闭项目

- 平台额度恢复后补一次独立 Sol 高智能复审，要求明确给出无未关闭 P0/P1。
