# Spec 9-1：停用 /AI CLI Def OpenCode 与清除 AI 模式历史会话

## 状态

规格与任务已完成，等待实施。

本规格是独立的新一轮工作，不续写已经无效化归档的旧 Spec 9。

## 一、唯一主旨

本轮只完成两件事：

1. 全线禁用独立 `/AI CLI` 页面的 def-opencode；
2. 在 DEF Shell 增加一个按钮，一键清除主界面 AI 模式的 def-opencode 历史会话。

不围绕这两件事的 Harness、Tool、Skill、Knowledge、模型提示词、训练、候选版本或业务流程改造，全部不属于本轮。

## 二、对象与边界

当前两个 def-opencode 宿主必须明确区分：

| 产品入口 | Host | 本轮处理 |
| --- | --- | --- |
| 独立 `/AI CLI` 页面 | `ai-cli` | 禁用全部产品入口 |
| 主界面排轴的 AI 模式 | `workbench` | 保留；允许从 Shell 清除其历史会话 |

“全线禁用”不是只隐藏一个按钮。当前还存在以下旁路：

- `openWorkbenchPage(page="aiCli")` 可以程序化打开旧页面；
- Shell 的“测试 hi”会调用旧 `/def-agent/chat`，并创建 `host="ai-cli"` Session；
- Electron 与 dev bridge 暴露 `/def-agent/chat*`，Sidecar 暴露 `/api/chat*`；
- native Session 在 Host 缺失或未知时默认降级为 `ai-cli`；
- recover、bootstrap、OpenCode UI 与代理路径仍可能继续旧 `ai-cli` binding；
- bare OpenCode UI 在没有 binding 时默认注入 `ai-cli` profile。

以下共用能力不是禁用对象：

- 主界面 AI 模式的 `workbench` def-opencode；
- Workbench typed tools、审批、Interop、Work Node 与 SQLite 绑定；
- 独立 MCP Fill 和历史 AI REST 服务；
- Workbench 共用的 Def Agent Sidecar、OpenCode runtime、DeepSeek 配置；
- DEF Shell 的启动、停止、健康检查和配置能力。

AI REST 中指向 `/ai-cli` 的旧导航值或提示文案需要移除，但不得借此重构或删除 AI REST/MCP Fill 服务。

## 三、目标行为

### 3.1 `/AI CLI` def-opencode 不再可达

实施后必须同时满足：

- 主界面不再显示打开 `/ai-cli` 的“AI CLI”按钮；
- `APP_ROUTE_PATHS`、`App` 和产品组件中不再存在 `/ai-cli` def-opencode 路由；
- 无调用方的 `AiCliPage.tsx` 被删除；
- `openWorkbenchPage` 不再接受或映射 `aiCli`；
- Shell 不再通过“测试 hi”或其他按钮创建 legacy chat Session；
- `/def-agent/chat*` 与 `/api/chat*` 这组旧产品 chat ingress 被移除或明确拒绝，不能再创建、恢复或继续 `sessions/ai-cli`；
- `POST /api/native/session` 只接受显式 `host="workbench"`；
- internal `def.native_catalog.register_session` 只接受已认证的 `workbench` Session；`ai-cli` 返回 `DEF_OPENCODE_HOST_DISABLED`，热进程中已有的 `ai-cli` registration 也立即失效；
- Host 缺失、未知或为 `ai-cli` 时返回明确 4xx，且零 Session、零目录、零 binding；
- recover、bootstrap、prompt、context、OpenCode UI 和消息代理拒绝旧 `ai-cli` binding；
- 交互式 OpenCode UI 只允许绑定到合法 `workbench` Session；无 binding 的 bare UI 不提供可用会话页，也不再默认生成 `ai-cli` profile。

精确删除旧 `ai-cli` Session 的内部管理入口可以继续识别其 binding。允许清理历史残留，不等于允许恢复使用。

直接访问旧 `/ai-cli` 地址不得启动 Sidecar、加载 iframe 或创建 Session。

### 3.2 Workbench 历史会话采用“关闭后全清”语义

“历史会话”定义为：AI 模式已经关闭后，DEF 管理根目录 `sessions/workbench` 下所有具有合法 `.def-session.json` 且 `binding.host === "workbench"` 的 native Session。

本轮不设计“自动挑选当前 Session”：

- 不传 `keepSessionID`；
- 不让用户选择 Session；
- 不根据更新时间猜测当前 Session；
- 不新增 heartbeat、lease 或 Session 存活管理。

若 Host 已观察到主界面 AI 模式 consumer 仍打开，清理请求直接返回：

```text
WORKBENCH_AI_MODE_ACTIVE
```

并且零删除。现有 consumer 记录只作为额外的拒绝闸，不用于选择或豁免某个 Session。

确认框必须要求用户先退出主界面 AI 模式。退出后点击一个按钮，清除全部合法 `workbench` Session。

### 3.3 清理目标由 Sidecar 自己确定

Shell renderer 的请求为空，不得提交：

- Session id 或目录列表；
- Host；
- 保留项；
- 通配路径。

Sidecar 只枚举 DEF 管理的 `sessions/workbench`，逐项重新验证 binding 和真实目录边界。

不得扫描或删除：

- `sessions/ai-cli`；
- 普通 OpenCode Session；
- TimelineDocument；
- Work Node、checkout 或快照；
- SQLite 业务数据；
- Local Data、Share Data；
- OpenCode runtime、模型配置或 API key。

### 3.4 复用真实单会话删除流程

现有 `DELETE /api/native/session/:sessionID` 与批量清理必须调用同一个精确删除 helper。

每个目标按以下顺序处理：

1. 拒绝或结束遗留 pending question；
2. 请求 OpenCode 删除精确 Session；
3. 删除该 Session 的问题记录；
4. 解绑精确的 Workbench session-axis binding；
5. 删除精确的 Session 工作目录。

OpenCode 返回成功或 404 后才继续本地清理。网络错误、超时或其他非预期状态必须保留足够的 binding 与目录供重试，并在结果中报告失败。

问题记录删除、session-axis 解绑和目录删除也必须检查结果。任一步失败都进入该 Session 的 `failed[]`；尤其是解绑失败时不得继续删除目录。允许 OpenCode 已删除而本地步骤待重试，下次以上游 404 继续收敛。

这里不承诺跨 OpenCode、SQLite 和文件系统的绝对事务原子性。要求是删除顺序固定、失败可见、重复调用幂等并最终收敛。

## 四、接口合同

Shell 到本地 bridge：

```text
POST /def-agent/workbench-sessions/cleanup
```

Electron main 与 `agent/dev-agent.cjs` 必须保持同一合同。请求 body 为空。

本地 bridge 先执行 AI 模式打开状态的拒绝检查，再确保 Def Agent Sidecar 已启动并调用：

```text
POST /api/native/workbench-sessions/cleanup
```

Sidecar 请求 body 同样为空，响应至少为：

```ts
type WorkbenchSessionCleanupResult = {
  ok: boolean;
  targetCount: number;
  deletedCount: number;
  failed: Array<{
    sessionID: string;
    code: string;
  }>;
};
```

规则：

- `ok` 只在 `failed.length === 0` 时为 `true`；
- 存在清理目标时，Sidecar 在任何删除前只确保一次 OpenCode runtime；启动失败返回稳定的整体错误且零删除；
- 单项失败不阻止后续合法目标；
- 上游 404 后成功清除本地残留，计入 `deletedCount`；
- 第二次执行没有目标时返回成功，`targetCount === 0`；
- 同一时刻只允许一个清理请求。

## 五、DEF Shell 交互

按钮位于 DEF Shell 的 Agent 页，名称为：

```text
清除 AI 模式历史会话
```

交互固定为：

1. 点击后出现一次确认；
2. 确认文案要求先退出主界面 AI 模式，并说明删除不可恢复；
3. 取消时零请求；
4. 执行期间按钮禁用；
5. AI 模式仍打开时显示“请先退出 AI 模式”，零删除；
6. 完成后显示目标数、删除数和失败项；
7. 没有目标时显示“没有可清除的 AI 模式历史会话”。

确认文案同时说明 Timeline、Work Node 和业务数据不受影响。

现有“测试 hi”必须删除，或改成不会创建 Session 的健康检查；不得继续调用 legacy chat ingress。

Shell 中所有“服务 `/ai-cli`”的说明改为“服务主界面 AI 模式”。不得因此移除 Workbench 仍需的后台管理能力。

## 六、验收场景

### Scenario A：全部 `ai-cli` 入口关闭

- UI 按钮、直接路由和 `openWorkbenchPage(aiCli)` 均不可达；
- TypeScript 合同和 runtime command schema 都拒绝 `openWorkbenchPage(aiCli)`；
- legacy chat bridge 和 native create 均不能创建 `ai-cli` Session；
- native catalog registration 不能再注册 `ai-cli` Host；
- 旧 `ai-cli` binding 不能 recover、bootstrap、prompt 或继续消息；
- bare OpenCode UI 不提供可用会话页，合法 Workbench binding 之外的代理请求不能命中受管的 `sessions/ai-cli` 目录。

### Scenario B：Workbench 保持可用

- 从正式 Timeline 打开主界面 AI 模式；
- `host="workbench"` Session 正常创建或恢复；
- iframe、上下文同步、typed tools 和 Interop 正常。

### Scenario C：打开 AI 模式时拒绝清理

- 主界面 AI 模式仍打开；
- Shell 发起清理；
- 返回 `WORKBENCH_AI_MODE_ACTIVE`；
- 所有 Session、binding 和目录保持不变。

### Scenario D：退出 AI 模式后全清

- 退出主界面 AI 模式；
- 存在 Workbench Session A、B；
- Shell 点击一次并确认；
- A、B 的 OpenCode Session、问题记录、binding 和目录均被清除；
- TimelineDocument、Work Node、checkout 和业务数据不变。

### Scenario E：失败后可重试

- 一个目标的 OpenCode 删除超时，另一个目标成功；
- 超时目标保留可重试状态，结果明确显示部分失败；
- 再次执行后最终收敛；
- 第二次无目标执行为成功空操作。

### Scenario F：宿主隔离

- 同时存在 Workbench、旧 `ai-cli` 和普通 OpenCode Session；
- 按钮只清除合法 Workbench Session；
- 其他 Session 和用户数据不变。

## 七、明确不做

本轮不做：

- Harness 整包、版本化、候选、promotion、训练或审计平台；
- 3+1、配装或其他业务术语；
- 通用 Session 管理器、列表、筛选、TTL、自动过期或归档；
- 当前 Session 自动识别与保留；
- AI REST、MCP Fill、typed tools、Work Node 或 Timeline 重构；
- OpenCode runtime 升级。

## 八、完成定义

以下条件全部满足，本轮才完成：

- 所有产品和桥接入口都不能新建、恢复或继续 `host="ai-cli"` Session；
- 主界面 AI 模式的 `workbench` def-opencode 保持可用；
- DEF Shell 只有一个无需选择 Session 的清除按钮；
- AI 模式打开时拒绝，退出后清除全部受管 Workbench Session；
- 批量清理复用单会话真实删除 helper；
- 失败可见、可重试，且不跨宿主或业务数据；
- 聚焦合同测试与真实 Electron 验收通过；
- 实现没有扩张到本规格明确排除的领域。
