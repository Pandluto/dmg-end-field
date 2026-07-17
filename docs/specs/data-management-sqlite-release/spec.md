# 数据管理 SQLite 与网络发布 Spec

## 目标

建立独立于主界面功能 Spec 的数据管理底座，使产品数据与用户数据均以 SQLite 为正式持久化方式，并让 Shell 可以像更新图片资源一样检查、下载、校验、激活和回滚游戏数据全量包。

本 Spec 只规定数据来源、更新、持久化、迁移和导入导出边界。它不改变主界面排轴交互、画布布局、AI 对话流程或具体页面视觉设计；这些调用数据管理能力时必须遵守本 Spec 的接口与事务约束。

## 背景

当前数据分布在 `public/data`、`src/data`、`localStorage`、`sessionStorage`、`now-storage.json`、本机/共享存档目录和排轴 SQLite Repository 中。排轴 Repository 已能保存文档、快照、Work Node、checkout 与审计，但主界面实时状态、角色配置和已选 Buff 仍以浏览器存储为主要读写位置。

该状态会导致：

- 游戏知识数据无法独立于 App 二进制进行可靠更新；
- 用户的当前排轴与恢复点可能跨多种存储介质分裂；
- 本机/共享存档的产品语义与实现路径混杂；
- `now-storage.json` 既容易被误当作事实源，也不具备事务、关系或可靠回滚能力；
- 数据更新若直接覆盖唯一数据库，可能危及用户排轴与配置。

## 核心决策

### 1. SQLite 是唯一正式持久化技术

- 运行时事实数据只写入 SQLite。
- `localStorage`、`sessionStorage` 与 `now-storage.json` 只在迁移期用于一次性导入、旧版本兼容读取或 Renderer 短生命周期镜像；新功能不得将其作为版本事实来源。
- JSON 只用于发布包、导入导出和诊断，不用于运行时版本管理。

### 2. 逻辑统一、物理分库

系统由两个 SQLite 数据库组成，二者同属数据管理服务，但不得互相覆盖：

| 数据库 | 内容 | 写入者 | 生命周期 |
| --- | --- | --- | --- |
| `catalog.sqlite` | 干员、武器、装备、系统 Buff、静态关系、预载排轴模板 | 已校验的数据发布包 | 版本化、可回滚、只读 |
| `user.sqlite` | 当前排轴、用户配置、用户 Buff、恢复点、AI Work Node、checkout、审计事件 | 本地应用 Repository | 本机长期持久化 |

此分库不是退回多事实源：每类数据仅有一个正式事实库。分库用于确保网络更新、版本切换和回滚永远不会覆盖用户数据。

### 3. 预载模板不是用户存档

- 发布包中的排轴为只读 `preloaded_timeline_templates`。
- 用户选择预载排轴时，系统必须将其克隆为 `user.sqlite` 中新的 `TimelineDocument` 和初始 Snapshot。
- 后续 catalog 更新不得修改已经创建的用户文档。

### 4. 存档只保留一种产品语义

产品不再新建“本机存档 / 共享存档”两套功能。用户侧统一呈现为：

- 当前排轴；
- 排轴文档；
- 恢复点（Snapshot）；
- AI 草稿（Work Node）。

旧本机/共享文件可以迁移，且保留其 `legacy_origin` 以便审计；迁移后不再作为持续读写位置。

## 数据边界

| 类型 | 正式来源 | 可否网络更新 | 备注 |
| --- | --- | --- | --- |
| 干员、武器、装备、系统 Buff | `catalog.sqlite` | 是 | 用稳定业务 ID 关联 |
| 预载排轴 | `catalog.sqlite` | 是 | 模板，只读 |
| 角色个人配置、装备选择 | `user.sqlite` | 否 | 允许引用 catalog ID |
| 用户创建/编辑的 Buff | `user.sqlite` | 否 | 不随 catalog 更新删除 |
| 当前排轴、恢复点、Work Node、审计 | `user.sqlite` | 否 | Repository 事务写入 |
| 计算缓存 / UI 临时状态 | 内存或可重建投影 | 否 | 不得作为事实源 |

当 catalog 条目被删除或改名时，更新不得级联删除用户记录。系统应保留最后可解析快照、记录 `catalog_version`，并在解析失败时返回结构化“缺失目录项”诊断。

## 存储布局

```text
<runtime-data>/
├─ catalog/
│  ├─ builtin/catalog.sqlite             # 安装包自带只读基线
│  ├─ versions/<version>/catalog.sqlite  # 已校验的网络版本
│  ├─ versions/<version>/manifest.json
│  └─ active.json                        # 当前 catalog 版本指针
├─ user/
│  ├─ user.sqlite
│  └─ backups/<timestamp>/               # 迁移前备份
└─ staging/<release-id>/                 # 下载、解压、校验中的临时目录
```

`active.json` 只保存版本选择和激活时间，不能保存业务数据。激活失败时必须保留并继续使用上一个可用版本；首次安装或无网络时回退到内置 catalog。

## SQLite 模型

### catalog.sqlite

最低需要：

- `catalog_meta(key, value)`：schema 与发布版本；
- `operators`、`weapons`、`equipments`；
- `buff_definitions` 与必要关联表；
- `preloaded_timeline_templates`；
- `preloaded_timeline_payloads`：不可变 payload 或其内容哈希；
- 可选检索投影表与全文索引。

catalog 使用稳定业务 ID，不得用显示名称、文件路径或数组下标作为外键。发布生成的 catalog 必须启用外键并通过 `PRAGMA integrity_check`。

### user.sqlite

在现有 Timeline Repository 的 `timeline_documents`、`timeline_payload_blobs`、`timeline_snapshots`、`timeline_work_nodes`、`checkout_refs` 和 `timeline_audit_events` 基础上，新增或迁入：

- `user_operator_configs`；
- `user_buffs`；
- `user_catalog_references`（可选诊断投影）；
- `user_schema_meta`；
- `legacy_migration_records`。

完整排轴 payload 可以作为按内容哈希去重的不可变 blob；常用筛选字段可以建立投影索引，但索引不是事实来源。一次保存、恢复或 AI checkout 必须在同一 `BEGIN IMMEDIATE` 事务中完成。

## 数据发布协议

### 全量包优先

首版只要求全量包，发布物为：

```text
data-release-manifest.json
catalog-<dataVersion>.zip
  ├─ catalog.sqlite
  └─ manifest.json
```

以后可加增量包，但不得改变 manifest、暂存、校验和原子激活契约。

### Manifest

`data-release-manifest.v1` 至少包含：

```ts
type DataReleaseManifestV1 = {
  type: 'dmg.data-release-manifest.v1';
  manifestVersion: 1;
  releaseTag: string;
  dataVersion: string;
  generatedAt: string;
  minShellVersion: string;
  catalogSchemaVersion: number;
  package: {
    fileName: string;
    downloadUrl?: string;
    packagePath?: string;
    sizeBytes: number;
    sha256: string;
  };
  catalog: {
    sha256: string;
    operators: number;
    weapons: number;
    equipments: number;
    buffs: number;
    preloadedTimelineTemplates: number;
  };
};
```

发布端应使用固定公钥对 manifest 或其 canonical payload 进行签名；Shell 使用内置公钥验证签名。HTTPS 与 SHA-256 可检测损坏，但只有签名能阻止 manifest 和包同时被替换。

## 更新流程

```text
检查远端 manifest
→ 校验签名、类型、schema、Shell 兼容性
→ 发现 dataVersion 更新
→ 下载全量包至 staging
→ 校验包 SHA-256、压缩包路径、大小限制
→ 解压至 staging
→ 校验 catalog.sqlite SHA-256 + SQLite integrity_check + schema
→ 写入 versions/<version>/
→ 原子更新 active.json
→ 重新打开 catalog 连接并刷新只读查询缓存
```

要求：

- 禁止边下载边覆盖当前生效 catalog；
- 禁止网络更新触及 `user.sqlite`；
- 更新失败必须留下诊断并继续使用旧版本；
- 对 ZIP 条目实施路径穿越、防 zip bomb、文件数量与单文件大小限制；
- 同一数据版本重复安装应幂等；
- catalog 激活后应保留至少上一个成功版本，以支持手动或自动回滚；
- `minShellVersion` 不兼容时，不下载、不激活，并给出可读错误。

## 主界面集成契约

本 Spec 不定义主界面 UI，但定义其数据调用约束：

1. 启动时读取 active catalog 与 user checkout；无法读取时显示数据层错误，不得悄悄回退到浏览器存储写入。
2. 写角色配置、用户 Buff、排轴、快照或 Work Node 时，只能经 Renderer 到主进程的 Repository API；Renderer 不直写 SQLite，也不直写旧 storage。
3. 恢复 Snapshot 时，Repository 原子更新 `CheckoutRef`、审计事件和当前工作副本；成功后再更新界面内存状态。
4. 选择预载模板时，Repository 创建新的用户 TimelineDocument；不得把 catalog 模板设为用户 checkout。
5. UI 可在一次会话内保留内存镜像，但刷新、重启和多窗口恢复必须从 SQLite 重新建立。

## 旧数据迁移

首次启用新数据管理服务时：

1. 关闭写入并备份 `now-storage.json`、浏览器快照 archive、本机存档、共享存档和现有 Work Node/Timeline SQLite。
2. 创建或升级 `user.sqlite` schema。
3. 将当前可恢复排轴导入为默认 TimelineDocument、Snapshot 和 CheckoutRef。
4. 将旧本机/共享存档逐个导入为独立文档或恢复点，记录原文件名、来源、哈希和迁移时间。
5. 导入现有 Work Node，保持其与对应 TimelineDocument 的关系；用户快照不得变成 Work Node。
6. 迁移在每个逻辑存档内以事务执行，支持幂等重试；失败记录可见，不删除原数据。
7. 校验迁移计数、内容哈希与 checkout 后，才将旧 storage 切换为只读兼容模式。

旧介质的删除不属于首次迁移。至少跨一个稳定版本并完成可验证备份后，才能单独设计清理策略。

## 导入导出

- 排轴分享、备份与跨设备导入继续使用版本化 `dmg.timeline-bundle.v2` 或后继格式。
- 导入必须校验 schema、hash、引用完整性和本机路径泄漏；默认创建新的 TimelineDocument，不得覆盖既有文档。
- 不支持也不建议用户直接导入或覆盖 `user.sqlite`、`catalog.sqlite` 文件。
- “共享存档”功能在本阶段搁置；这不阻止以后将 Bundle 作为明确的共享协议重新设计。

## 非目标

- 不做云同步、多用户协作、CRDT 或远程用户数据库；
- 不做 catalog 数据编辑后台；
- 不做首版增量包；
- 不改变主界面页面结构、排轴交互或 AI 审批策略；
- 不允许 AI 或浏览器脚本绕过 Repository 直接写 SQLite；
- 不将计算缓存、hover、拖拽态等 UI 细节纳入版本事实。

## 验收标准

1. 无网络时，应用可使用内置或上一个已激活的 catalog 和完整 user 数据启动。
2. Shell 能检查、下载、校验、激活和回滚一个 catalog 全量包，且失败不会影响当前数据版本。
3. catalog 更新后，用户排轴、配置、Buff、Work Node 和审计数据的哈希均不变。
4. 新创建或修改的角色配置、用户 Buff、快照和排轴不再以 localStorage/sessionStorage/now-storage 作为正式写入目标。
5. 用户恢复一个 Snapshot 后，当前工作副本、CheckoutRef 和审计事件在一次成功事务中一致。
6. 预载排轴被使用时创建用户副本；更新或删除 catalog 模板不改变该副本。
7. 旧本机/共享存档可迁移、可审计、可重试；迁移失败不删除原文件。
8. UI 不再将“本机存档 / 共享存档”作为新建或保存流程的分支，只有统一文档与恢复点语义。
9. Bundle 导入导出仍可用，且不依赖复制 SQLite 文件。
10. 主界面功能 Spec 不需要包含本 Spec 的表结构、更新协议或迁移细节；它只依赖稳定 Repository API。
