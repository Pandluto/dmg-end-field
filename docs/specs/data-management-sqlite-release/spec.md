# 数据管理 SQLite、排轴存档与网络发布 Spec

## 目标

建立独立于主界面功能 Spec 的数据管理底座：SQLite 工作区是唯一可认证、可编辑、可直接应用的排轴形式；本地存档与参考存档是可搬运格式，只能转换为新的 SQLite 工作区。Shell 还应能像更新图片资源一样检查、下载、校验和登记参考存档发布包。

本 Spec 只规定数据来源、更新、持久化、迁移和导入导出边界。它不定义主界面具体布局；但调用方必须遵守“存档不能直接应用、SQLite 工作区才可应用”的接口与事务约束。

## 背景

当前数据分布在 `public/data`、`src/data`、`localStorage`、`sessionStorage`、`now-storage.json`、本机/共享存档目录和排轴 SQLite Repository 中。历史上“快照”既被当作恢复点，又被当作可搬运存档，且 Work Node 与当前排轴位置未能随导出完整表达。

该状态会导致：

- 游戏知识数据无法独立于 App 二进制进行可靠更新；
- 用户的当前排轴工作态与可搬运存档可能跨多种存储介质分裂；
- 本地存档、参考存档与 SQLite 工作区的产品语义混杂；
- `now-storage.json` 既容易被误当作事实源，也不具备事务、关系或可靠回滚能力；
- 数据更新若直接覆盖唯一数据库，可能危及用户排轴与配置。

## 核心决策

### 1. SQLite 工作区是唯一正式工作态

- 当前排轴、角色配置、用户 Buff、Work Node、checkout 与审计等运行时事实数据只写入 SQLite。
- 本地存档和参考存档是版本化的搬运包，不是运行时工作态；它们可独立保存，但不能直接成为当前排轴。
- `localStorage`、`sessionStorage` 与 `now-storage.json` 只在迁移期用于一次性导入、旧版本兼容读取或 Renderer 短生命周期镜像；新功能不得将其作为版本事实来源。
- JSON 只用于发布包、导入导出和诊断，不用于运行时版本管理。

### 2. 逻辑统一、物理分库

系统由两个 SQLite 数据库组成，二者同属数据管理服务，但不得互相覆盖：

| 数据库 | 内容 | 写入者 | 生命周期 |
| --- | --- | --- | --- |
| `catalog.sqlite` | 干员、武器、装备、系统 Buff、静态关系、预载排轴模板 | 已校验的数据发布包 | 版本化、可回滚、只读 |
| `user.sqlite` | SQLite 工作区、用户配置、用户 Buff、AI Work Node、checkout、审计事件 | 本地应用 Repository | 本机长期持久化 |

此分库不是退回多事实源：每类数据仅有一个正式事实库。分库用于确保网络更新、版本切换和回滚永远不会覆盖用户数据。

### 3. 预载模板不是用户存档

- 发布包中的排轴为只读 `preloaded_timeline_templates`。
- 用户选择预载排轴时，系统必须将其克隆为 `user.sqlite` 中新的 SQLite 工作区及初始根节点。
- 后续 catalog 更新不得修改已经创建的用户文档。

### 4. 排轴存档与 SQLite 工作区是两种对象

“快照”是历史技术名；本 Spec 的产品语义统一称为**排轴存档（TimelineArchive）**。排轴存档搬运的是完整存档角色，而不是 SQLite 内部的即时恢复点。

| 对象 | 权威与用途 | 可直接应用 | 可编辑 |
| --- | --- | --- | --- |
| 本地存档 | `localdata` 单独管理的本机搬运包 | 否 | 否；可删除、可重新从 SQLite 导出 |
| 参考存档 | 联网下载并登记的只读搬运包 | 否 | 否 |
| SQLite 工作区 | `user.sqlite` 中的当前排轴文档、节点树与 checkout | 是 | 是 |

- 存档只能“转换为 SQLite 工作区”；转换始终新建工作区，禁止把存档直接覆盖到已有工作区。
- SQLite 工作区可以直接应用，也可以导出为本地存档或待发布参考存档。
- 本地导出的参考存档在发布前属于“待发布参考包”，不能伪装为已联网获得的参考存档；只有经发布、下载和校验后才登记为参考存档。
- UI 存档列表只显示来源、格式版本、内容摘要、节点数量与是否记录当前节点；不渲染节点树内容。节点树只能在转换后的 SQLite 工作区内查看和操作。

## 数据边界

| 类型 | 正式来源 | 可否网络更新 | 备注 |
| --- | --- | --- | --- |
| 干员、武器、装备、系统 Buff | `catalog.sqlite` | 是 | 用稳定业务 ID 关联 |
| 预载排轴 | `catalog.sqlite` | 是 | 模板，只读 |
| 角色个人配置、装备选择 | `user.sqlite` | 否 | 允许引用 catalog ID |
| 用户创建/编辑的 Buff | `user.sqlite` | 否 | 不随 catalog 更新删除 |
| SQLite 工作区、Work Node、checkout、审计 | `user.sqlite` | 否 | Repository 事务写入；唯一可应用工作态 |
| 本地排轴存档 | `localdata/timeline-archives/` | 否 | 独立本机存档库；只能转换为 SQLite 工作区 |
| 参考排轴存档 | `reference-archives/` 下载缓存 | 是，仅下载更新 | 只读；只能转换为 SQLite 工作区 |
| 计算缓存 / UI 临时状态 | 内存或可重建投影 | 否 | 不得作为事实源 |

当 catalog 条目被删除或改名时，更新不得级联删除用户记录。系统应保留最后可解析的工作区 payload / 存档、记录 `catalog_version`，并在解析失败时返回结构化“缺失目录项”诊断。

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
├─ localdata/
│  └─ timeline-archives/<archive-id>.json # 本地排轴存档，独立于工作区
├─ reference-archives/
│  ├─ versions/<release-id>/             # 已校验的参考存档发布包
│  └─ active.json                        # 已登记的参考存档索引版本
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

在现有 Timeline Repository 的 `timeline_documents`、`timeline_payload_blobs`、`timeline_work_nodes`、`checkout_refs` 和 `timeline_audit_events` 基础上，新增或迁入：

- `user_operator_configs`；
- `user_buffs`；
- `user_catalog_references`（可选诊断投影）；
- `user_schema_meta`；
- `legacy_migration_records`。

完整排轴 payload 可以作为按内容哈希去重的不可变 blob；常用筛选字段可以建立投影索引，但索引不是事实来源。一次 SQLite 工作区的应用、节点 checkout 或存档转换必须在同一 `BEGIN IMMEDIATE` 事务中完成。

历史 `timeline_snapshots` 表可在迁移期读取，用于生成排轴存档；它不再是新增产品功能的主入口，也不得在 UI 中作为可直接应用的对象暴露。

## 排轴存档格式与转换

### 存档格式

排轴存档为版本化的可搬运包。字段名可因实际实现采用 JSON、ZIP 或后继二进制容器，但语义至少包含：

```ts
type TimelineArchive = {
  type: 'dmg.timeline-archive';
  archiveVersion: number;
  source: 'local' | 'reference';
  archiveId: string;
  label: string;
  createdAt: string;
  payload: TimelinePayload;
  worktree?: {
    nodes: ArchiveWorkNode[];
    currentNodeId?: string;
    rootPayloadHash?: string;
    currentPayloadHash?: string;
    nodeCount: number;
  };
  reference?: {
    releaseId: string;
    packageHash: string;
    downloadedAt?: string;
  };
};
```

- 本地存档必须标记 `source: 'local'`；参考存档必须有已校验的 `reference` 发布来源。
- `payload` 是导出时 SQLite 工作区的当前排轴内容。
- `worktree` 可缺失，以兼容旧版平铺快照；存在时必须包含完整节点关系和当前节点位置，不得只导出可见分支的一部分。
- 存档列表只读取 `label`、来源、格式版本、payload 摘要、`nodeCount` 和当前节点是否存在；不得提前向前端下发或渲染节点详情。

### SQLite 工作区导出为存档

1. 读取一个已认证 SQLite 工作区的当前 payload、完整 Work Node 树和 CheckoutRef。
2. 生成存档，并记录导出时的当前节点位置；若 checkout 指向非节点目标，则记录“无当前节点位置”。
3. 选择“导出本地存档”时写入 `localdata/timeline-archives/`。
4. 选择“导出参考存档”时只生成待发布参考包；发布前它不出现在参考存档列表。
5. 导出不得改变 SQLite 工作区、checkout、节点树或当前应用状态。

### 存档转换为 SQLite 工作区

任何本地或参考存档的转换都必须新建 SQLite 工作区，并写入一个**导入根节点**作为存档与本机工作态之间的审计边界：

```text
校验存档与兼容性
→ 创建新的 TimelineDocument
→ 创建导入根节点
→ （如有有效节点树）重映射节点 ID 并将原树根挂到导入根下
→ 映射当前节点位置或回退导入根
→ 原子写入 CheckoutRef、工作副本与导入审计
```

- 旧版平铺快照（无 `worktree`）转换后固定生成 1 个导入根节点，checkout 指向该根。
- 当前版存档（有有效 `worktree`）转换后的节点数为 `1 个导入根 + 有效导入节点数`；UI 必须如实显示该差异，不得把导入根伪装成原存档节点。
- 原节点 ID 必须在新工作区命名空间内重新映射；父子关系必须同工作区、无循环、无悬挂节点。
- 若 `currentNodeId` 存在且其 payload hash 与存档当前 payload 一致，checkout 映射到该导入节点；缺失或不一致时 checkout 回退导入根，并记录结构化兼容诊断。
- 节点树损坏、循环、hash 不匹配或 schema 不可转换时，默认拒绝转换；只能由用户显式选择“仅转换 payload”，该路径创建导入根且审计降级原因，绝不静默丢弃树。
- 转换不得覆盖、合并或修改任何已有 SQLite 工作区。

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

### 参考存档发布包

排轴存档发布与 catalog 发布是两个逻辑单元。catalog 包仍只承载静态游戏目录；**参考存档包只承载参考排轴存档**，不得包含本地存档、`user.sqlite`、用户配置或本机绝对路径。

```text
reference-archive-manifest.json
reference-archives-<releaseId>.zip
  ├─ manifest.json
  └─ archives/<archiveId>.json
```

`reference-archive-manifest.v1` 至少包含发布标识、生成时间、最低 Shell 版本、包名、大小、SHA-256、签名，以及每份存档的 `archiveId`、label、archiveVersion、payload hash、nodeCount、是否记录当前节点位置。Shell 下载后必须：

```text
检查远端 manifest
→ 校验签名、Shell 兼容性、包 hash 与路径限制
→ 校验每份存档 schema、payload hash、节点树关系与 nodeCount
→ 写入 reference-archives/versions/<releaseId>/
→ 原子更新参考存档 active.json 索引
→ 仅登记为只读“参考存档”，不自动转换、不自动应用
```

发布地址可以与图片发布地址共用；发布索引未来可同时列出图片、catalog 与参考存档包，但每类包必须独立校验、独立激活和独立回滚。首版需要提供参考存档包打包器，并与实际发布地址完成下载、校验、登记联调。

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
2. 写角色配置、用户 Buff、SQLite 工作区、排轴存档或 Work Node 时，只能经 Renderer 到主进程的 Repository / Archive API；Renderer 不直写 SQLite，也不直写旧 storage。
3. 只有 SQLite 工作区可以直接应用；应用、节点 checkout 时 Repository 原子更新 `CheckoutRef`、审计事件和当前工作副本，成功后再更新界面内存状态。
4. 存档列表只能请求摘要；选择本地/参考存档时只能调用“转换为新 SQLite 工作区”，不得直接恢复或应用存档 payload。
5. 选择预载模板时，Repository 创建新的用户 TimelineDocument；不得把 catalog 模板设为用户 checkout。
6. UI 可在一次会话内保留内存镜像，但刷新、重启和多窗口恢复必须从 SQLite 重新建立。

## 旧数据迁移

首次启用新数据管理服务时：

1. 关闭写入并备份 `now-storage.json`、浏览器快照 archive、本机存档、共享存档和现有 Work Node/Timeline SQLite。
2. 创建或升级 `user.sqlite` schema。
3. 将旧浏览器快照、`now-storage.json` 与本机/共享文件先归档为本地排轴存档，记录原文件名、来源、hash、格式版本和迁移时间。
4. 用户明确选择转换时，再将每份本地存档新建为 SQLite 工作区；不得把多个历史存档自动合并到当前工作区。
5. 导入现有 Work Node 时，如可识别其所属工作区则保留关系；如随旧存档搬运，则按“存档转换为 SQLite 工作区”规则放到导入根下。
6. 迁移在每个逻辑存档或工作区内以事务执行，支持幂等重试；失败记录可见，不删除原数据。
7. 校验存档计数、payload hash、节点数与 checkout 后，才将旧 storage 切换为只读兼容模式。

旧介质的删除不属于首次迁移。至少跨一个稳定版本并完成可验证备份后，才能单独设计清理策略。

## 导入导出

- 排轴导出统一生成版本化 `dmg.timeline-archive` 或后继格式；SQLite 工作区导出必须携带当前 payload、完整节点树与当前节点位置。
- 本地存档和参考存档导入只执行“转换为新 SQLite 工作区”；不得直接应用，也不得覆盖既有工作区。
- 导入必须校验 schema、hash、节点树关系、节点数、当前节点位置和本机路径泄漏。
- 不支持也不建议用户直接导入或覆盖 `user.sqlite`、`catalog.sqlite` 文件。
- 旧 `dmg.timeline-bundle.v2` 属于兼容输入，可转换为本地存档后再走统一转换链路；不得再以其绕过工作区创建事务。

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
4. 新创建或修改的角色配置、用户 Buff、SQLite 工作区和排轴存档不再以 localStorage/sessionStorage/now-storage 作为正式写入目标。
5. 本地或参考存档不能直接应用；转换完成后，新的 SQLite 工作区、导入根、CheckoutRef、当前工作副本和审计事件在一次成功事务中一致。
6. 预载排轴被使用时创建用户副本；更新或删除 catalog 模板不改变该副本。
7. 旧本机/共享存档可迁移为本地存档、可审计、可重试；迁移失败不删除原文件。
8. UI 明确区分本地存档、参考存档与 SQLite 工作区；存档列表只显示摘要和节点数量，节点树只在工作区中打开。
9. SQLite 工作区导出存档会携带完整节点树与当前节点位置；旧版平铺快照转换后恰好产生一个导入根节点。
10. 参考存档发布包只含参考存档；与实际发布地址的下载、校验、登记联调通过，且不会自动转换或应用。
11. 主界面功能 Spec 不需要包含本 Spec 的表结构、更新协议或迁移细节；它只依赖稳定 Repository API。
