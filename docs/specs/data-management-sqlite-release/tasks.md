# 数据管理 SQLite 与网络发布：实施任务

## 基线与原则

本清单实施 [Spec](spec.md)，不改写主界面 Spec。2026-07-17 的独立工作树研究已证明分库、全量替换、版本钉死、原子激活/回滚、模板克隆、恢复事务和旧档幂等导入在技术上可行；这些只是 Demo 证据，**不能标记为生产功能已完成**。

已确认的生产缺口是：Shell 尚无数据发布更新链路，Renderer 仍有正式 browser storage 写入，旧本机/共享存档尚未迁入统一 Repository，Shell 仍显示双存档语义。因此任务以先建立数据层，再迁移调用方，最后收敛 UI 和旧介质为顺序。

## T0：冻结边界、运行时布局与验收基线

- [ ] 定义 `DataManagementRepository`、`CatalogRepository`、`UserRepository` 和 `DataReleaseService` 的主进程 API、错误码与诊断结构。
- [ ] 固定 `<runtime-data>/catalog`、`user`、`staging`、`backups` 的路径解析，不与现有 `data/localdata`、`data/sharedata` 混用。
- [ ] 定义 catalog、user 两库 schema version、迁移版本、审计事件和 catalog 引用缺失诊断的兼容策略。
- [ ] 将研究 Demo 的断言转为可在主工作树运行的测试基线；不依赖临时目录或手工检查。
- [ ] 为现有 browser storage、本机/共享存档、`now-storage.json`、Timeline/Work Node SQLite 制作只读清单和迁移前备份计划。

验收：所有新写入入口都有唯一 Repository 归属；目录、错误和诊断语义可由 Renderer 和 Shell 稳定调用。

## T1：实现 catalog 构建、校验与只读查询

- [ ] 定义并创建 `catalog.sqlite` 的 `catalog_meta`、干员、武器、装备、系统 Buff、预载模板与不可变 payload 表。
- [ ] 以稳定业务 ID 建立关联、外键和必要索引；禁止用显示名、路径或数组下标关联用户数据。
- [ ] 实现 catalog 构建命令：由现有静态数据生成完整 SQLite 和 manifest 所需计数/hash。
- [ ] 实现 SQLite `integrity_check`、schema version、必要表和 catalog SHA-256 校验。
- [ ] 实现 builtin catalog 的只读打开、查询缓存和结构化“缺失目录项”诊断。

验收：断网时 builtin catalog 可读取；删除或改名 catalog 条目不会删除用户记录，并能返回可读诊断。

## T2：实现 Shell 全量数据发布与版本切换

- [ ] 实现 `data-release-manifest.v1` 生成、固定公钥签名和 Shell 端签名验证。
- [ ] 实现远端 manifest 检查、版本比较、Shell 最低版本拦截和可读错误提示。
- [ ] 实现全量 ZIP 下载至 staging，并限制路径穿越、文件数量、单文件大小和解压总大小。
- [ ] 校验包 hash、catalog hash、SQLite 完整性和 schema 后，写入 `versions/<version>/`。
- [ ] 通过原子 `active.json` 指针激活 catalog；失败时保留当前版本并记录诊断。
- [ ] 实现重新打开 catalog 连接、刷新只读查询缓存，以及保留上一成功版本的回滚入口。
- [ ] 实现同版本同 hash 重复安装幂等；发现同版本不同 hash 时拒绝并诊断。

验收：Shell 可检查、下载、校验、激活和回滚全量包；任意失败不影响当前 catalog 或 `user.sqlite`。

## T3：建立统一 user.sqlite 与 Timeline Repository 接入

- [ ] 在现有 Timeline SQLite schema 基础上创建/升级 `user.sqlite`，迁入 timeline document、payload blob、snapshot、Work Node、checkout 和审计表。
- [ ] 新增 `user_operator_configs`、`user_buffs`、`user_schema_meta`、`legacy_migration_records` 与必要的 catalog 引用投影。
- [ ] 保持 TimelineDocument、Snapshot、Work Node 和 CheckoutRef 的既有语义与事务约束；不得将 Snapshot 当作 Work Node。
- [ ] 将保存、恢复和 AI checkout 收敛为同一个 `BEGIN IMMEDIATE` 事务，成功后再更新界面内存态。
- [ ] 实现启动时由 active catalog 和 user checkout 重建应用状态；不能读取时显示数据层错误，禁止静默回写旧 storage。

验收：用户排轴、配置、Buff、Work Node、checkout 和审计只写入 `user.sqlite`；catalog 更新前后用户数据 hash 不变。

## T4：分批迁移 Renderer 写入并移除 browser storage 事实源

- [ ] 迁移角色个人配置 Repository 的正式读写到主进程 UserRepository，旧 storage 只保留只读兼容入口。
- [ ] 迁移用户 Buff Repository 的正式读写到主进程 UserRepository，保留数据版本和错误回执。
- [ ] 迁移当前排轴、快照和恢复后的工作副本，使刷新、重启和多窗口均由 `user.sqlite` 重建。
- [ ] 移除 `timelineSnapshotStorage` 等运行时写路径；明确内存镜像的生命周期，禁止其成为事实源。
- [ ] 为每一批迁移建立旧/新数据比对、失败回退和重复启动验证。

验收：新建或修改的角色配置、用户 Buff、排轴和快照不再以 `localStorage`、`sessionStorage` 或 `now-storage.json` 为正式写入目标。

## T5：实现预载模板的用户副本流程

- [ ] 从 catalog 的 `preloaded_timeline_templates` 提供只读模板列表和内容摘要。
- [ ] 选择模板时，由 UserRepository 创建新的 TimelineDocument、初始 Snapshot、CheckoutRef 和审计事件。
- [ ] 禁止 catalog 模板直接成为用户 checkout，禁止后续 catalog 更新修改已创建副本。
- [ ] 为 catalog 版本删除/变更模板添加用户副本可恢复性与缺失引用诊断。

验收：使用预载排轴后生成独立用户文档；更新或删除 catalog 模板不改变该文档与其恢复点。

## T6：实现旧数据备份与可重试迁移

- [ ] 在首次迁移前备份 browser archive、`now-storage.json`、本机/共享存档与现有 Timeline/Work Node SQLite，并记录备份位置。
- [ ] 将当前可恢复排轴导入默认 TimelineDocument、Snapshot 和 CheckoutRef。
- [ ] 逐个导入旧本机/共享存档，记录 `legacy_origin`、文件名、来源 hash、迁移时间、结果和失败原因。
- [ ] 导入现有 Work Node，维持其与 TimelineDocument 的关系，并保护异常历史数据不被自动删除。
- [ ] 以单个逻辑存档为事务边界实现幂等重试；迁移失败保留原文件并提供可见诊断。
- [ ] 完成计数、payload hash、checkout 和 Work Node 关系的迁移后校验，再将旧介质降为只读兼容。

验收：旧本机/共享存档可迁移、可审计、可重试；失败或中断不删除原文件、不制造半写入数据。

## T7：收敛存档 UI 与导入导出边界

- [ ] 将 Shell 和主界面的新建/保存/恢复入口统一为“当前排轴、排轴文档、恢复点、AI 草稿”语义。
- [ ] 移除“本机存档 / 共享存档”作为持续读写和新建流程的双分支；旧文件只在迁移诊断中出现。
- [ ] 保持 `dmg.timeline-bundle.v2` 导入导出可用，并将导入默认落为新的 TimelineDocument。
- [ ] 导入时校验 schema、hash、引用完整性和本机路径泄漏；拒绝直接导入或覆盖 `user.sqlite` / `catalog.sqlite`。
- [ ] 确认不新增云同步、协作、CRDT 或远程用户数据库能力。

验收：UI 不再引导用户选择本机或共享存档；Bundle 仍可跨本地库导入，且不复制 SQLite 文件。

## T8：端到端验证、灰度与旧介质清理决策

- [ ] 为 catalog 生成、发布、签名、恶意 ZIP、损坏包、Shell 版本不兼容、激活/回滚和重复安装建立自动化测试。
- [ ] 为 user.sqlite 的事务、catalog 隔离、缺失目录项、模板克隆、重启、多窗口和迁移幂等建立针对性 smoke。
- [ ] 使用真实 Electron/Chrome UI 完成离线启动、数据更新、保存/恢复、预载模板、旧档迁移、Bundle 导入导出和错误诊断手测。
- [ ] 回归现有 Timeline Repository、Bundle V2 和 Work Node SQLite smoke，确保不回退已交付排轴语义。
- [ ] 将验收标准 1–10 逐项记录为“生产通过 / 不通过”，不得以 Demo 结果替代生产验证。
- [ ] 至少经过一个稳定版本并核验备份可恢复后，再单独提出旧介质删除方案；本任务不执行删除。

验收：Spec 的 10 条验收标准均有可复现的生产证据；旧数据始终可恢复，且主界面 Spec 仅依赖稳定 Repository API。

## 2026-07-17：P1 事实源与双存档流程收口

- [x] `user.sqlite` 新增当前工作副本；干员配置、用户 Buff、当前排轴、恢复后的工作副本均经主进程 API 读写，Renderer 只保留内存镜像。
- [x] 恢复 SQLite 快照时在同一事务更新 CheckoutRef、当前工作副本、投影表和审计事件，再更新 Renderer 内存态。
- [x] browser archive、`now-storage.json` 与旧本机/共享 JSON 首次迁移前备份；按单个逻辑存档幂等导入，并记录来源 hash、结果、备份路径和失败原因。
- [x] Shell 移除本机/共享存档的新建、应用与删除流程，改为统一数据状态与旧档迁移诊断；旧介质不删除。
- [x] 已通过数据管理、Timeline Bundle、Work Node SQLite/REST/备份恢复、Timeline 迁移 smoke，以及 Web 构建；Shell 数据页已用真实可见 UI 检查。
- [ ] 尚未完成 T1/T2 数据网络发布客户端、T5 预载模板、完整多窗口/重启手测和旧介质删除决策；这些保持原任务验收门槛，不以本次 P1 收口替代。

## 推荐顺序

`T0 → T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8`

T0–T3 先建立不可覆盖用户数据的底座；T4–T6 再逐步迁移事实源和历史数据；T7 只在数据链路稳定后收敛 UI；T8 作为上线前门槛。
