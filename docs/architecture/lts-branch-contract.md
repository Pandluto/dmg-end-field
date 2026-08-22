# 1.8 LTS 单向分支合同

## 结论

1.8 LTS 保留两个发布分支，但只有一个共享产品基线：

```text
codex/v1.8-lts-slimming
  └─ Web/PWA、移动端、SQLite、资源、领域与普通工作台
                         ↓ 只允许向下同步
codex/v1.8-lts-desktop-shell
  └─ Electron + MCP + DEF Agent + Desktop Host Adapter + 桌面发包
```

`v1.8-LTS` 只作为历史祖先和审计锚点。国内网站只从 Slimming 部署；Desktop 即使继承了 Web、移动端和 Worker 源码，也不获得网站部署职责。

## 所有权

Slimming 是下列代码和协议的唯一真源：

- 普通 Web/PWA、移动端、通知、分享和访问门禁；
- 浏览器 SQLite、Work Node、存档导入导出与 Timeline 普通事务；
- `src/core/` 的领域与计算、普通 Canvas、AppContext 和路由；
- 官方资源通道、清单、SHA-256 校验、Cache Storage 和物化流程；
- `def.localdata.archive.v1`、`dmg.resource-release.v1` 等跨端格式。

Desktop 只拥有下列叠加内容：

- `electron/`、`agent/`；
- `src/platform/agent/`、`src/platform/desktop/`、`src/components/AgentMode/`、`src/agentSessionSurface/`；
- `src/legacyFillCore/`、`src/legacyFillHost/`、`src/legacyFillService/` 与 MCP 审核界面；
- `.desktop.*` 模块、Desktop 入口、国内资源 loopback 代理、Electron 打包和桌面 smoke；
- Desktop 依赖与构建脚本的超集。

共同 Bug 必须先在 Slimming 修复、验证和提交，再向 Desktop 同步。Desktop 专属提交严禁反向进入 Slimming。

## 组合方式

共享层提供默认无操作、无 Desktop 命名的扩展合同：

- `src/platform/host/appHost.ts`：启动、路由、工作区生命周期和可选 UI；
- `src/platform/resources/resourceTransport.ts`：官方资源路径与内置回退策略；
- `src/utils/mainWorkbenchControl.ts`：普通工作台传输合同。

Desktop 通过 `src/desktop-entry.ts` 在共享 `main.tsx` 之前安装 Host Adapter。Vite、TypeScript 和测试运行器优先解析 `.desktop.*`，因此 Agent 的深层事务可以覆盖少数宿主敏感模块，而同名 Slimming 文件保持逐字节不变。

当前覆盖对登记在仓库根的 `desktop-overlay.json`。该文件同时记录已同步的 Slimming commit；`npm run electron:smoke:overlay` 会检查：

1. 记录的 Slimming commit 是 Desktop `HEAD` 的祖先；
2. 所有已存在的共享源码与该基线一致；
3. 新文件只位于允许的 Desktop 增量边界；
4. 每个 `.desktop.*` 覆盖都有未被修改的 Slimming 基文件；
5. Desktop 入口与构建后缀仍然有效。

## 上游同步流程

1. 在 Slimming 完成共通修改，运行与风险相称的类型、测试和 Web 构建门。
2. 把已验证的 Slimming tip 合入 Desktop；不得从 Desktop 向 Slimming merge 或 cherry-pick。
3. 普通共享文件直接采用上游版本。若 Desktop 需要不同宿主行为，修改对应 `.desktop.*` 或 Desktop adapter，不能编辑共享基文件。
4. 将 `desktop-overlay.json` 的 `slimmingCommit` 更新到实际合入的完整 commit。
5. 至少运行 `npm run electron:smoke:overlay`、`npm run typecheck`、`npm test`、`npm run electron:smoke:boundaries` 和相关 Desktop smoke。
6. 提交中注明同步的 Slimming commit。无需重写历史，也不再使用旧的“双边手工重放”流程。

机器门允许 `package.json`、lockfile、入口、构建配置、Desktop 检查脚本和文档作为明确组装面存在差异；这不是在共享业务文件中继续双线开发的许可。

## 资源与数据

```text
Desktop/MCP 编辑完整资料
        ↓
导出 def.localdata.archive.v1 Share Data
        ↓
Desktop 生成并校验 dmg.resource-release.v1 ZIP
        ↓
Slimming 校验、物化并提交 public/ 稳定通道
        ↓
dmgendfield.cloud 国内服务器
```

Desktop 在线时通过固定 loopback 前缀读取 `https://dmgendfield.cloud/resources/`，上层继续执行 Slimming 的版本绑定、体积和 SHA-256 校验。服务器不可用时才退回随包资源，并明确显示“内置版本”。代理不接受任意 URL，不转发 cookie 或认证头。

员工增量文件必须先合并到资料编辑器，再导出完整 Share Data。资源版本使用实际打包时的北京时间与内容哈希；来源文件的 `exportedAt` 只用于追溯。资源 ZIP 不上传 GitHub Release，Desktop 分支也不直接部署国内网站。

## 1.8.6 已落实

- Slimming 中性 Host、路由、工作台和资源传输接缝；
- Desktop `.desktop.*` 覆盖与独立 Host Adapter；
- 3030/31457 共用的国内资源代理、受限重定向、流式体积上限、超时与内置回退提示；
- MCP/Agent、prepared proposal、审批与 Work Node 事务保留在 Desktop 增量边界；
- 共享 `src` 与记录的 Slimming 基线无未登记差异；
- 路径边界、打包边界和单向祖先关系进入自动检查。

迁移前 Desktop 状态保留在 `codex/archive-v1.8-lts-desktop-shell-pre-overlay-20260822`，用于回退和审计，不作为后续开发分支。
