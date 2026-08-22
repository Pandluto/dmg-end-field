# Desktop Shell 作为 Slimming 单向叠加层：落实前研究与实施计划

> 研究日期：2026-08-22  
> Desktop 研究基线：`codex/v1.8-lts-desktop-shell@ec0bdf37`  
> Slimming 研究基线：`codex/v1.8-lts-slimming@b16788ad`  
> 状态：实施完成，候选分支等待本地点击验收与长期分支快进
>
> 已同步 Slimming 基线：`9443586b8f0a72d488bd53c6f99dac0cba8d20e8`
>
> 实施候选：`codex/v1.8-lts-desktop-overlay`
>
> 回退引用：`codex/archive-v1.8-lts-desktop-shell-pre-overlay-20260822`

## 实施结果（2026-08-22）

阶段 0—5 已落实：Slimming 先加入中性扩展接缝和共享 SQLite 安全修复，Desktop 候选随后完成受控汇合；共享 `src` 与记录基线保持一致，Agent 深层行为通过 `.desktop.*` 覆盖和 Desktop Host Adapter 叠加。3030/31457 使用同一固定国内资源代理，离线回退明确标注“内置版本”。最终 Electron 冒烟还反向发现了严格模式并发初始化会争抢同一初始快照/checkout 的旧竞态；修复先进入 Slimming，再按本合同同步到候选。

仓库根 `desktop-overlay.json` 记录当前 Slimming 基线和九组覆盖对，`npm run electron:smoke:overlay` 对祖先关系、共享文件和新增路径执行机器校验。剩余阶段 6 只包含最终自动门、实际在线/离线资源检查、本地点击验收，以及验收后把长期 Desktop 分支快进到候选；本次没有部署、上传或改动 Slimming 生产职责。

## 最终结论

这套单向叠加关系可以完整落实，且与 1.8 LTS 最初的“独立薄 Shell + 系统浏览器 Slim 工作台”设计一致。最终应形成：

```text
codex/v1.8-lts-slimming
  └─ Web/PWA、移动端、SQLite、资源消费者、领域与普通工作台的唯一基线
                         ↓ 只允许向下同步
codex/v1.8-lts-desktop-shell
  └─ 完整继承上述基线，再叠加 Electron、MCP、DEF Agent、发包与本地传输适配
```

两个分支仍是不同的发布分支。Slimming 永远不包含 Electron、MCP 或 DEF Agent；Desktop 即使继承 Slimming 的移动端、Worker 和部署源码，也不得成为国内网站部署源。这种“源码继承、发布职责隔离”才是真正可持续的单向叠加。

整体工作量是**中到偏大**，但不是重写：

- 国内资源下载与 MCP 挂载本身是小到中等改动；
- Electron、MCP、Agent Host 大部分已经位于可直接保留的增量目录；
- 最大工作是把 Agent 的产品事务从共享 `CanvasBoard`、选区切换、Context 和 Timeline Store 中抽回 Desktop 挂件；
- 迁移完成后，日常 Slimming 更新进入 Desktop 应变成普通的单向合入，不再依赖逐提交猜测与双边手工重放。

## 为什么“日期很近”仍不等于“小改动”

两个分支最近共同提交是 `622d4cf1`，日期为 2026-08-06。日历上很近，但其后 Desktop 集中完成了 Agent 产品恢复，提交密度和共享代码侵入都很高。

| 量化项 | 结果 |
| --- | ---: |
| Desktop 独立提交 | 206 |
| Slimming 独立提交 | 107 |
| Desktop 从共同基线改动的路径 | 973 |
| Slimming 从共同基线改动的路径 | 233 |
| 两边都改过的路径 | 71 |
| 当前直接 merge 的冲突路径 | 31 |
| Desktop 相对 Slimming 新增的 `src/` 文件 | 86 |
| Desktop 相对 Slimming 修改的 `src/` 文件 | 64 |
| Desktop 相对 Slimming 删除的 `src/` 文件 | 72 |
| 修改文件中出现 Desktop/Agent 专属依赖或标识的共享文件 | 14 |

其中两个热点足以说明实际难度：

| 文件 | Slimming | Desktop | 判断 |
| --- | ---: | ---: | --- |
| `src/components/CanvasBoard/index.tsx` | 4,787 行 | 7,186 行 | Agent 命令、快照、审批、原子应用和 AI 模式 UI 深度嵌入 |
| `src/core/services/selectionWorkspaceTransition.ts` | 318 行 | 1,652 行 | 约 1,334 行 prepared proposal/CAS/回滚逻辑应移出共享服务 |

两处相对 Slimming 合计增加约 4,100 行代码。它们主要是已有能力搬家，不是新增 4,100 行业务，但不能当作一次小型冲突解决。

## 已经具备的有利条件

1. `electron/` 16 个路径、`agent/` 136 个路径，以及大部分 `src/platform/agent/`、MCP、Agent Session UI 都是相对 Slimming 的增量内容，可以保留原实现。
2. 生产桌面静态宿主已经在静态文件前提供可组合的 `requestHandler`，Agent 和 MCP 正通过该接缝工作；国内资源代理可以作为第三个窄处理器加入。
3. 开发态 Vite 已支持 middleware 插件，可以实现与 31457 完全相同的资源代理合同。
4. 浏览器 SQLite/OPFS 已经是唯一业务事实源，Electron、MCP 和 Agent 均未重新取得业务数据库所有权。
5. `resources/stable.json`、版本绑定、体积限制和 SHA-256 校验已经在 Slimming 中形成完整消费者，Desktop 不需要另写一套下载器。
6. 当前只有 14 个已修改共享文件出现 Desktop/Agent 专属依赖或标识。迁移面虽然深，但边界数量可控。

## 目标代码边界

### Slimming 拥有并保持同源的代码

以下内容应以 Slimming 为唯一真源，在两个分支中保持相同实现：

- `src/core/` 中的领域、计算、普通选区与 Timeline 服务；
- `src/platform/database/`、`storage/`、普通 Timeline Store 与 SQLite schema；
- `src/platform/resources/` 的资源通道、清单、校验、缓存和安装流程；
- 普通 `CanvasBoard`、`AppContext`、`WebBootstrap`、路由、移动端、通知与 Web/PWA；
- Web 数据/图片物化脚本、国内部署源文件和相关通用测试。

Desktop 可以继承这些文件，但不能独立修改。发现共通 Bug 时，先在 Slimming 修复并验证，再向下同步。

### 先进入 Slimming 的中性扩展合同

共享代码需要四个无 Desktop 名称、默认 no-op 的扩展接缝：

1. `HostCapabilities`：宿主识别、启动/刷新/释放生命周期与可选设置贡献；
2. `OptionalRoutes`：MCP 审核页、AI 模式等隐藏路由由宿主注册；
3. `WorkbenchExtension`：快照发布、外部命令领取、审批结果和可选 overlay；
4. `OfficialResourceTransport`：只决定官方版本路径如何取得及是否允许退回内置资源，不复制清单、缓存或校验逻辑。

共享组件只依赖这些接口，不得导入 `electron/`、`agent/`、`platform/agent`、`legacyFill*` 或 Desktop bridge。

### Desktop 独占的叠加层

以下内容只存在于 Desktop 下游：

- `electron/`、`agent/`；
- `src/platform/agent/`、`src/components/AgentMode/`、`src/agentSessionSurface/`；
- `src/legacyFillCore/`、`src/legacyFillHost/`、`src/legacyFillService/` 与 MCP 审核页面；
- Desktop Host Adapter、Agent Workbench Controller、prepared proposal 事务实现；
- 3030/31457 国内资源代理、Electron 打包、发包工具和 Desktop smoke；
- Desktop 专属依赖、脚本与构建配置。

`package.json` 和 lockfile 在 Desktop 中采用 Slimming 依赖的超集，不再为了桌面依赖删除移动端、分享或 Web 构建依赖。

## 国内资源下载的落实方式

Desktop 应直接复用 Slimming 的 `resourceChannel`、`resourceIntegrity`、`resourcePackage` 和 `imagePackage`。差异只放在传输层：

- Web/PWA 继续通过同源路径读取 `resources/stable.json`；
- Desktop 3030 与 31457 把固定前缀映射到 `https://dmgendfield.cloud/resources/`；
- 代理仅允许 `GET`、`HEAD`，只接受规范化的 `resources/` 相对路径，不接受任意 URL、Host、cookie、认证头或路径回退；
- 代理保留 `Content-Type`、`Content-Length`、`ETag`、`Last-Modified` 和缓存语义，限制重定向目标与清单体积；
- 上层继续核对同一个 `releaseVersion`、文件大小和 SHA-256；本地代理不能替代这些校验；
- 首次离线或服务器不可达时，Desktop 可显式退回随包资源，界面必须显示“内置版本”，不得把它报告成服务器最新版本；
- 新资料仍作为可确认应用的官方包进入浏览器 Cache Storage/SQLite，不直接覆盖正在编辑的存档。

现有 Electron `requestHandler` 链和 Vite middleware 足以承载这项能力，无需新增端口，也无需开放 `.cloud` 的跨域访问。

## 一次性迁移与长期同步

### 一次性迁移

不能直接在当前 Desktop 分支执行普通 merge。31 个显式冲突之外，还有大量“自动合并成功但语义取错”的共享文件。

实施时采用以下历史策略：

1. 为当前 Desktop tip 建立只读回退引用；
2. 从当前 Desktop tip 新建 `codex/v1.8-lts-desktop-overlay` 候选分支；
3. 先在 Slimming 落地行为不变的中性扩展合同；
4. 在候选分支做一次有清单、暂停提交的 `Slimming → Desktop` 汇合；
5. 共享 Web、移动端、资源和生成文件以 Slimming 为准；Desktop 增量目录保留；根构建文件按超集合成；热点文件通过抽取挂件解决，禁止用 ours/theirs 一键覆盖；
6. 候选通过双端验收后，现有 Desktop 可快进到候选，不强推、不改写既有历史。

### 长期同步

迁移完成后：

- 只允许 Slimming 向 Desktop 合入；
- Desktop 专属提交永不反向进入 Slimming；
- 共通修复先进入 Slimming；
- CI 比较当前 Desktop 与其记录的 Slimming 基线，禁止共享目录产生未登记分叉；
- 更新 `AGENTS.md` 与 `docs/architecture/lts-branch-contract.md`，把当前“禁止整分支合并、双边重放”改为“禁止反向合入、允许受检的上游单向同步”。

## 分阶段实施计划

### 阶段 0：冻结证据与回退点

- 记录双方本地/远端 tip、merge-base 和干净状态；
- 给当前 Desktop 建立回退引用；
- 从 Desktop 创建隔离候选分支，不直接修改长期分支；
- 固化当前 Web、Desktop、MCP、Agent、SQLite 导入导出的可观察基线。

完成门：候选失败时可无损回到当前 Desktop，Slimming 与生产站点未被改动。

### 阶段 1：在 Slimming 建立中性扩展接缝

- 增加 Host、路由、Workbench、资源传输四个小接口及 Web no-op 实现；
- 让共享入口、Bootstrap、AppShell、Canvas 和 Context 通过接口组合；
- 保持普通 Web、移动端、通知、分享、资源打包器与 PWA 行为不变；
- 先提交 Slimming，再作为候选分支的明确上游。

完成门：Slimming 构建中不存在 Desktop/Agent/MCP 依赖，普通 Web 回归与产物边界通过。

### 阶段 2：建立一次性汇合树

- 在候选分支引入阶段 1 的 Slimming tip；
- 逐项解决 31 个显式冲突，并审计 71 个双边修改路径；
- 恢复 Desktop 目前缺失的 Slimming 移动端、通知、资源通道和现行构建逻辑；
- 保留 Electron、MCP、Agent、发包和 Desktop 文档；
- 删除已被 Slimming 物化链替代的旧 Web 清单脚本，不保留双实现。

完成门：候选树能明确分成“与 Slimming 同源”和“Desktop 新增”两类，没有来源不明的混合文件。

### 阶段 3：先闭环国内资源

- 复用 Slimming 资源消费者；
- 增加固定 `.cloud` 上游的 Vite 与 Electron 代理；
- 接入 Desktop Resource Transport 和内置版本回退提示；
- 核对 3030、31457 与 `dmgendfield.cloud` 得到相同稳定 `releaseVersion`；
- 验证网络失败不会破坏已有 Cache Storage、SQLite 或 Local Data。

完成门：Desktop 在线可取得服务器最新包，离线明确使用内置包，Web 行为无变化。

### 阶段 4：把 MCP/Agent 收回挂件层

- 将 `selectionWorkspaceTransition.ts` 恢复为 Slimming 的普通选区/存档事务；prepared proposal、CAS、语义门禁与回滚移入 Desktop Agent 服务；
- 将 Canvas 中的命令领取、快照投影、prepared apply/abandon、AI overlay 和模式切换移入 Agent Workbench Controller；
- 将 `AppContext`、`browserTimelineStore`、`mainWorkbenchControl` 中的 Agent 直接依赖改为窄接口；
- MCP 审核页和 AI 模式路由改由 Optional Routes 注册；
- Host 不存在、未授权或启动失败时，普通工作台必须完整可用。

完成门：共享 `src/core`、数据库、资源与普通组件不再导入 Desktop/Agent runtime；当前 Agent/MCP 行为没有因搬迁而缩水。

### 阶段 5：构建、包与机器门禁

- Desktop `package.json`/lockfile 采用 Slimming + Desktop 依赖超集；
- Web 构建不得包含 Electron、MCP、OpenCode 或 Agent Host；
- Desktop 构建继续只在独立 Shell 使用 preload，系统浏览器没有 Node/Electron 能力；
- 扩展 `check-desktop-runtime-boundaries`，新增单向叠加路径门禁与禁止依赖检查；
- 保留 31457 origin，避免 OPFS、Cache Storage 与 Service Worker 工作区迁移。

完成门：Web build、Desktop build、静态宿主、打包边界、MCP 和 Agent smoke 全部通过。

### 阶段 6：双端验收与切换

- 在同一 Slimming 基线上对比普通工作台、SQLite 节点树、导入导出、图片和资料安装；
- 从 Desktop 导出完整 Share Data，在 Slimming 读取并验证，反向导入也不得产生 schema 损失；
- 验证 MCP 提案审核、Agent Work Node/审批/回滚以及 Host 失效降级；
- 由用户完成本地点击验收；
- 验收后快进接替 Desktop 长期分支，再更新分支合同和项目 Agent 路由。

完成门：当前 Desktop 回退引用仍保留；不需要强推；Slimming 生产部署未因本次架构迁移自动发生。

## 验证矩阵

| 范围 | 最低验证 |
| --- | --- |
| Slimming 中性接缝 | TypeScript、聚焦单测、Web build、现有关键 Web E2E |
| 资源传输 | 路径/重定向/体积安全测试，3030 与 31457 实际下载，版本与 SHA-256 对齐，断网回退 |
| SQLite/Work Node | 当前节点树交互回归、导入导出往返、checkout/CAS/回滚聚焦测试 |
| MCP | Legacy Fill 提案创建、浏览器审核、OPFS 写回、Host 退出回收 |
| DEF Agent | 现有 core/host/harness 合同、Workbench 命令、prepared proposal 原子应用与失败回滚 |
| 构建边界 | Web 产物无 Desktop runtime；Electron 仍为独立 Shell + 系统浏览器；31457 origin 不变 |

测试按阶段执行，不在每个机械搬迁提交上重复完整套件；每个高风险接缝先跑聚焦测试，最终候选再跑完整门禁和人工点击验收。

## 机器可判定的最终标准

1. Desktop 当前记录的 Slimming 基线必须是其祖先；Slimming 不以 Desktop 提交为祖先。
2. `src/core/`、数据库、资源消费者、普通 Timeline/Canvas 业务与 Slimming 基线无未登记差异。
3. 共享代码对 `electron/`、`agent/`、`platform/agent` 和 `legacyFill*` 的直接依赖为零；唯一组装入口位于 Desktop adapter。
4. Desktop 专属差异只出现在允许的增量目录、构建超集和极少数组装入口。
5. 3030 与 31457 能取得与 `.cloud` 相同的稳定资源版本，且继续执行 Slimming 的版本绑定、大小和哈希校验。
6. MCP/Agent 关闭或失败时，普通工作台、SQLite 和本地资源仍可使用。
7. Web 构建不含 Desktop runtime；Desktop 也不能用于国内网站部署。
8. 迁移不改变 SQLite schema、Share Data schema、资源 release schema 或 31457 origin。

## 明确不在本轮扩大处理的事项

- 不借架构搬迁恢复或新增 DEF Agent 的旧 50 项业务能力；本轮只保证当前能力不回归，历史能力补齐另开任务；
- 不更换 Agent 引擎，不重写 OpenCode UI；
- 不改变 SQLite/Share Data/resource release 对外格式；
- 不发布网站、不上传资源、不重建海外应用；
- 不强推、不删除当前 Desktop 历史。

## 当前交接

代码实施已结束。自动门与本地资源链验证通过后，在候选服务器完成普通工作台、SQLite 节点树、MCP 审核和 AI 模式点击验收；确认无误后仅做长期 Desktop 分支的快进切换。回退引用继续保留，不强推、不触发网站部署。
