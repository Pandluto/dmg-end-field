# Spec 9-1 Tasks：停用 /AI CLI Def OpenCode 与清除 AI 模式历史会话

## 状态

待实施。

本文件只执行同目录的 [`spec.md`](./spec.md)。旧 Spec 9 不得恢复或续写。

实施前先检查工作树，不得把 `data/sharedata/**` 或 runtime 构建脏文件纳入提交。

## Task 1：关闭 `ai-cli` 的全部产品入口

### 1.1 前端入口

- [ ] 删除主界面的“AI CLI”按钮和导航 handler。
- [ ] 从 `APP_ROUTE_PATHS` 与 `App` 删除 `/ai-cli` 产品路由。
- [ ] 删除无调用方的 `AiCliPage.tsx`。
- [ ] 将 `DefOpenCodeView` 产品 Host 收口为 `workbench`。
- [ ] 直接访问旧 `/ai-cli` 时不得启动 Sidecar、iframe 或 native Session。

### 1.2 程序化入口

- [ ] 从 `openWorkbenchPage` 的类型与路由映射移除 `aiCli`。
- [ ] 在 runtime command schema 中为 `openWorkbenchPage.page` 建立显式 allowlist，并拒绝 `aiCli` 和未知页面。
- [ ] 更新 AI REST adapter 中允许跳转 `aiCli` 的描述。
- [ ] 删除指向已停用 `/ai-cli` 页面的旧 handoff 文案，但不重构 AI REST/MCP Fill 服务。

### 1.3 legacy chat 旁路

- [ ] 删除 Shell 的“测试 hi”，或改成不创建 Session 的 health probe。
- [ ] 退役 Electron main 与 `agent/dev-agent.cjs` 的 `/def-agent/chat*` 产品 bridge。
- [ ] 退役 Sidecar 的 `/api/chat*` 产品 ingress，不能再通过默认 `operator` 创建 `sessions/ai-cli`。
- [ ] 删除确认无调用方的 `src/utils/defAgent.ts` legacy chat helpers；保留 Interop、后台管理和配置 helpers。
- [ ] 若发现仍需旧 chat API 的有效 Workbench 调用方，先停止并证明其必要性；不得靠 `skillId` 或缺省值继续开放通用入口。

### 1.4 native 与 OpenCode UI 入口

- [ ] `POST /api/native/session` 只接受显式 `host === "workbench"`。
- [ ] Sidecar 到 AI REST 的 `registerNativeCatalogSession()` 和 internal `def.native_catalog.register_session` 只接受已认证的 `workbench` Session；`ai-cli` 返回 `DEF_OPENCODE_HOST_DISABLED`。
- [ ] resolve/consume registration 时将现存 `host !== "workbench"` 的记录视为无效并移除，不能等旧 TTL 自然过期。
- [ ] 缺失、未知和 `ai-cli` Host 返回稳定 4xx，且不产生 Session、目录或 binding。
- [ ] 删除 Host/profile/binding reader 中把未知值降级为 `ai-cli` 的逻辑。
- [ ] recover、bootstrap、prompt、context 和消息代理拒绝旧 `ai-cli` binding。
- [ ] 交互式 OpenCode UI 只接受合法 `workbench` binding；bare UI 不提供可用会话页。
- [ ] OpenCode catch-all proxy 拒绝旧 `ai-cli` binding 和指向受管 `sessions/ai-cli` 目录的请求。
- [ ] 精确管理删除仍可识别旧 `ai-cli` binding。
- [ ] Workbench 创建、恢复、context、iframe、typed tools 与 Interop 保持可用。
- [ ] 不借 Host 收口重写 Tool registry；只修改直接允许 `ai-cli` Session 注册或使用的入口。

建议使用稳定错误码：

```text
DEF_OPENCODE_HOST_DISABLED
DEF_OPENCODE_HOST_INVALID
```

### 1.5 Shell 文案

- [ ] 将“服务 `/ai-cli`”改为“服务主界面 AI 模式”。
- [ ] 保留 Workbench 需要的 Sidecar 启停、健康状态和 DeepSeek 配置。
- [ ] 不停止或删除 `scripts/ai-cli-rest-server.mjs`；该共用服务仍被 Workbench typed tools 使用。

## Task 2：实现 Workbench 会话关闭后全清

### 2.1 复用精确删除 helper

- [ ] 从 `DELETE /api/native/session/:sessionID` 抽出唯一的精确删除 helper。
- [ ] 依次处理 pending question、OpenCode Session、问题记录、session-axis binding 和工作目录。
- [ ] OpenCode 成功或 404 后才继续本地清理。
- [ ] 网络错误、超时或其他非预期状态保留足够 binding 与目录供重试。
- [ ] 问题记录删除、session-axis 解绑和目录删除任一步失败都返回该 Session 的失败项。
- [ ] session-axis 解绑必须检查 HTTP/tool result，禁止吞错；解绑失败时不得继续删除目录。
- [ ] 单会话删除与批量清理调用同一 helper。
- [ ] helper 只接受已经验证的精确 binding，不接受根目录、通配符或 renderer 路径。

### 2.2 Sidecar 批量清理

- [ ] 新增：

```text
POST /api/native/workbench-sessions/cleanup
```

- [ ] 请求 body 为空。
- [ ] 只枚举 DEF 管理的 `sessions/workbench`。
- [ ] 每个候选重新验证 `.def-session.json`、真实目录边界和 `host="workbench"`。
- [ ] 不进入 `sessions/ai-cli`，不扫描普通 OpenCode 根目录。
- [ ] 单项失败继续后续目标。
- [ ] 返回 `targetCount / deletedCount / failed[]`。
- [ ] 上游 404 后清除本地残留并计入 `deletedCount`。
- [ ] 重复执行最终返回成功空操作。
- [ ] 同一时刻只允许一个 cleanup。

### 2.3 本地 bridge 的打开状态拒绝

- [ ] Electron main 与 `agent/dev-agent.cjs` 同时新增：

```text
POST /def-agent/workbench-sessions/cleanup
```

- [ ] renderer 请求不携带 Session、Host、目录或保留项。
- [ ] 若现有 Workbench UI consumer 记录仍存在，返回 409 `WORKBENCH_AI_MODE_ACTIVE`，不调用 Sidecar。
- [ ] consumer 记录只作拒绝闸，不返回 `sessionID`，不选择保留项。
- [ ] 不新增 heartbeat、lease、“当前 Session”查询或自动保留机制。
- [ ] 无 consumer 记录时先调用现有 `startDefAgent()` 确保 Sidecar 就绪，再将空请求转发给 Sidecar。
- [ ] Sidecar 枚举出至少一个目标后，在任何目标变更前调用一次 `ensureRuntime()`；启动失败返回稳定整体错误，零本地删除。

### 2.4 DEF Shell 按钮

- [ ] Agent 页增加唯一按钮“清除 AI 模式历史会话”。
- [ ] 不增加 Session 列表、下拉框、多选或保留项设置。
- [ ] 点击后只出现一次确认，要求先退出主界面 AI 模式。
- [ ] 取消时零请求；执行期间按钮禁用。
- [ ] 409 时显示“请先退出 AI 模式”，不显示成删除失败。
- [ ] 成功显示目标数和删除数；无目标显示正常空状态。
- [ ] 部分失败显示 Session id 与稳定错误码。
- [ ] 文案说明 Timeline、Work Node 和业务数据不受影响。

## Task 3：聚焦验证与提交

本轮涉及删除边界和 Host 准入，属于确实需要自动合同覆盖的代码改动。

### 3.1 自动合同

- [ ] 前端不存在 `/ai-cli` 路由、按钮、`AiCliPage` 渲染和 `openWorkbenchPage(aiCli)`。
- [ ] runtime command schema 拒绝 `openWorkbenchPage.page=aiCli` 与未知 page。
- [ ] Shell 不再存在会创建 legacy Session 的“测试 hi”。
- [ ] `/def-agent/chat*`、`/api/chat*` 和 bare UI 均不能创建或继续 `ai-cli` Session。
- [ ] `host=ai-cli`、缺失 Host、未知 Host 全部零副作用拒绝。
- [ ] internal native catalog registration 拒绝 `host=ai-cli`。
- [ ] 热进程中的旧 `ai-cli` native catalog registration 立即失效；对应合同以 `workbench` 模拟合法 native host，并覆盖拒绝断言。
- [ ] `host=workbench` 正常创建与恢复。
- [ ] 有 Workbench UI consumer 时清理返回 409 且零删除。
- [ ] 无 consumer 时只删除合法 `workbench` Session。
- [ ] OpenCode 超时保留可重试状态，404 清理本地残留。
- [ ] 部分失败继续，重复清理最终收敛。
- [ ] `ai-cli`、普通 OpenCode、Timeline、Work Node、checkout 与 SQLite 状态不变。

fixture 必须使用临时 Session 根目录和伪 OpenCode server，严禁读取或删除用户正式 Session。

### 3.2 真实 Electron 验收

1. 启动开发态 Electron；
2. 确认主界面“AI CLI”入口消失；
3. 直接访问 `/ai-cli`，确认不启动 def-opencode；
4. 打开正式 Timeline 的 AI 模式，确认 Workbench Session 可用；
5. 保持 AI 模式打开，从 Shell 点击清除并确认，验证返回 409 且零删除；
6. 退出 AI 模式；
7. 再次点击同一个按钮，验证所有 Workbench Session 被清除；
8. 重新打开 AI 模式，确认可以创建新的 Workbench Session；
9. 确认 TimelineDocument、Work Node、checkout、业务数据、旧 `ai-cli` 与普通 OpenCode Session 未变化；
10. 记录成功、空状态和部分失败的可核对证据。

涉及 DEF Agent/typed tools 的桌面联调按 `docs/testing/def-agent-blackbox.md` 的 Mac Desktop Interop Route 执行。

### 3.3 建议文件范围

- `src/App.tsx`
- `src/utils/appRoute.ts`
- `src/components/AiCliPage.tsx`
- `src/components/WorkbenchFrame/WorkbenchFrame.tsx`
- `src/components/def-opencode/DefOpenCodeView.tsx`
- `src/context/AppContext.tsx`
- `src/utils/mainWorkbenchControl.ts`
- `src/agentKernel/mainWorkbench/commandSchemaRuntime.mjs`
- `src/utils/defAgent.ts`
- `src/aiCli/aiCliRestAdapter.ts`
- `agent/runtime/def-opencode-adapter/index.cjs`
- `agent/runtime/def-codex-interop.cjs`
- `agent/server/def-agent-server.cjs`
- `agent/dev-agent.cjs`
- `scripts/ai-cli-rest-server.mjs`
- `scripts/def-native-catalog-bridge-contract-test.mjs`
- `scripts/def-operator-build-guide-contract-test.mjs`
- `electron/main.cjs`
- `public/shell/index.html`
- `public/shell/shell.js`
- 聚焦合同脚本与 `package.json`

若实现需要修改 Harness、runtime Skills、Tool description、领域 Service 或 `agent/vendor/opencode`，先停止并证明它与两个主旨的直接关系；否则判定偏题。

### 3.4 提交边界

- [ ] `ai-cli` 全入口禁用单独提交。
- [ ] 删除 helper、Workbench bulk cleanup 与 Shell 按钮单独提交。
- [ ] 验证和文档收尾单独提交。
- [ ] 每次提交不包含 `data/sharedata/**` 或 runtime 构建脏文件。
- [ ] 不 push，除非用户另行要求。

只有当 `ai-cli` 全入口不可用、Workbench 保持可用、Shell 在 AI 模式关闭后可一键清除全部 Workbench 历史会话，并且没有扩张到其他领域时，本轮实施才完成。
