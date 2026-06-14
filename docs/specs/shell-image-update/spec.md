# Shell 图片更新 Spec

## Goal

为 Shell 新增图片资源更新能力，使桌面端可以基于独立发布的图片资源清单和增量资源包检查、下载、校验、切换并回滚图片资源。

本轮设计采用主流的“发布工具 + release manifest + Shell 增量拉取”模式：

- 发布端使用独立工具生成图片发布清单和资源包。
- Shell 只消费发布结果，不直接理解 git 仓库。
- 图片更新与 App 二进制版本解耦，但需要保留兼容性约束。

## Non-Goals

- 不在本规格中设计完整图片后台管理系统。
- 不在本规格中设计云端管理面板或上传站点。
- 不在本规格中设计图片编辑、压缩、裁剪工作流。
- 不在本规格中实现 App 二进制自动更新。
- 不在本规格中要求首版必须完成差分压缩算法优化。
- 不在本规格中替换现有 Image Manager 的编辑能力。
- 不在本规格中重做现有 `_manifest.json` 的前端资源选择用途。

## Current Findings

- 当前前端图片资源浏览和选择使用 `public/assets/images/_manifest.json` 作为资源索引来源。
- 当前 `_manifest.json` 是资源目录快照，包含 `relativePath / sizeBytes / updatedAt / writable / source` 等字段，但没有发布版本、文件哈希、资源下载地址。
- `src/utils/imageBridge.ts` 和 `src/utils/assetHostApi.ts` 已将 `_manifest.json` 作为浏览器 fallback 的只读资源列表入口。
- Shell 端已经具备 Electron Runtime 与本地文件系统桥接能力。
- `electron/preload.cjs` 已向渲染层暴露 `desktopRuntime`。
- `electron/main.cjs` 已具备 `/user-images/*` 资源服务能力，以及图片目录扫描、导入、重命名、删除等 IPC/HTTP 桥接。
- 当前资源优先级体系已存在 `builtin / user / legacy` 概念，但没有“下载更新资源”这一层。
- 当前 Shell 尚未定义图片发布清单、版本状态、下载目录、更新事务、回滚策略和更新入口。

## Why Release Manifest

本轮 SHALL 使用“发布工具生成 release manifest，Shell 基于 manifest 更新”的模式，而不是让 Shell 直接基于 git commit 或 git branch 拉取资源。

原因：

- git 适合源码协作，不适合作为桌面用户侧图片分发协议。
- 发布工具可以明确界定“可发布资源版本”，避免开发中提交直接进入用户端。
- release manifest 可以提供版本号、兼容性、文件哈希和下载地址，满足 Shell 侧校验和回滚需要。
- Shell 只需要理解稳定的清单协议，不需要理解仓库结构、提交历史和分支状态。

## Scope

本轮处理：

- Shell 图片更新清单协议。
- Shell 增量更新流程。
- 独立发布工具输入输出约定。
- 本地图片资源目录布局。
- 图片更新状态、失败回滚和切换规则。
- Shell 运行时资源优先级。
- 与现有 `_manifest.json` 的职责分离。

本轮不处理：

- 云端发布平台实现。
- 图片发布权限体系。
- 图片内容审核。
- 用户手动挑选 patch 包。
- 图片 CDN 选型。
- 复杂二进制 diff 算法。

## Terms

- 发布工具：扫描图片源目录、生成发布清单、打包图片资源并输出 release 产物的独立命令行工具。
- Release Manifest：面向 Shell 更新链路的发布清单，保存资源版本、兼容信息、文件哈希、下载地址与删除列表。
- Baseline Manifest：应用内置 `_manifest.json`，用于资源浏览、选图与只读 fallback，不等于 Release Manifest。
- 资源版本：图片资源集合的独立版本标识，不等于 App 版本号。
- 当前生效版本：Shell 当前已切换并用于解析图片的资源版本。
- 暂存版本：Shell 已下载但尚未完成校验或切换的版本。
- 回滚：Shell 在更新失败或激活失败时，恢复到上一版已生效资源。

## Architecture

### Topology

系统 SHALL 使用如下分层：

```text
图片源目录
  -> 发布工具
  -> Release Manifest + 资源包
  -> 静态发布地址 / Release 附件
  -> Shell 检查更新
  -> 下载增量资源
  -> 校验
  -> 激活版本
```

### Responsibility Split

- 发布工具 SHALL 负责扫描图片、计算哈希、输出 manifest、生成增量或完整资源包。
- Shell SHALL 负责检查 manifest、下载资源、校验、切换、回滚和更新状态展示。
- 现有 Image Manager SHALL 继续负责本地图片浏览和手动管理，不直接承担发布职责。

## Release Manifest

### Requirement: 独立发布清单

系统 SHALL 定义一份独立于当前 `_manifest.json` 的发布清单，例如 `assets-release-manifest.json`。

#### Scenario: 与当前图片表分离

- WHEN 生成发布清单
- THEN 不覆盖当前 `public/assets/images/_manifest.json`
- AND 不改变 `_manifest.json` 在资源浏览器中的只读索引职责
- AND 发布清单只服务于 Shell 更新链路

### Requirement: Manifest 顶层字段

发布清单 SHALL 至少包含以下顶层字段：

- `manifestVersion`
- `releaseTag`
- `generatedAt`
- `minShellVersion`
- `assetVersion`
- `baseVersion`
- `files`
- `deletedFiles`

#### Scenario: 版本边界

- WHEN Shell 拉取 manifest
- THEN 可以明确知道当前资源版本、父版本和最小兼容 Shell 版本
- AND 不依赖 `updatedAt` 猜测版本

### Requirement: 文件级字段

发布清单中每个文件项 SHALL 至少包含：

- `relativePath`
- `sha256`
- `sizeBytes`
- `source`
- `packagePath` 或 `downloadUrl`

#### Scenario: 文件校验

- WHEN Shell 下载资源
- THEN SHALL 使用 `sha256` 校验内容
- AND 不只依赖 `sizeBytes` 或 `updatedAt`

### Requirement: 删除列表

发布清单 SHALL 显式提供删除列表 `deletedFiles`。

#### Scenario: 删除废弃资源

- WHEN 新版本 manifest 标记某资源已删除
- THEN Shell 在激活新版本时清理该资源
- AND 不要求用户手动删除旧图

## Publisher Tool

### Requirement: 独立工具

发布端 SHALL 使用独立工具生成发布结果，而不是复用 Shell 主程序。

#### Scenario: 独立命令

- WHEN 执行发布工具
- THEN 输入为图片源目录和上一个资源版本 manifest
- AND 输出为新 manifest、完整包或增量包
- AND 输出不依赖 Electron Runtime

### Requirement: 增量模式优先

本轮策略 SHALL 以 Manifest 增量更新为主。

#### Scenario: 基于上个版本构建增量

- WHEN 发布工具拿到 `baseVersion`
- THEN 计算新增文件、变更文件和删除文件
- AND 只将新增/变更文件写入增量资源包
- AND 删除文件写入 `deletedFiles`

#### Scenario: 无基线版本

- WHEN 没有可用 `baseVersion`
- THEN 允许发布工具输出完整资源包
- AND 该完整包仍使用同一份 Release Manifest 协议

## Shell Update Flow

### Requirement: 更新检查

Shell SHALL 支持检查远端发布清单。

#### Scenario: 启动时检查

- WHEN Shell 启动并具备网络能力
- THEN 可以检查远端最新 manifest
- AND 读取本地当前生效资源版本
- AND 判断是否有可更新版本

#### Scenario: 手动检查

- WHEN 用户在 Shell 中主动点击检查图片更新
- THEN 执行同一套 manifest 检查逻辑

### Requirement: 兼容性判断

Shell SHALL 在下载前进行兼容性判断。

#### Scenario: 低版本 Shell

- WHEN 远端 manifest 的 `minShellVersion` 高于当前 Shell 版本
- THEN Shell 不下载该资源版本
- AND 明确提示当前 Shell 不兼容

### Requirement: 增量下载

Shell SHALL 只下载目标版本需要的新增/变更资源。

#### Scenario: 仅下载差异文件

- WHEN 当前版本与目标版本存在差异
- THEN Shell 只下载 manifest 标识为新增或变更的文件
- AND 不重复下载未变化资源

### Requirement: 事务式激活

Shell SHALL 使用临时目录和事务式切换激活新版本。

#### Scenario: 下载到暂存目录

- WHEN 开始更新
- THEN 先将目标资源写入暂存目录
- AND 不直接覆盖当前生效目录

#### Scenario: 校验通过后切换

- WHEN 所有新增/变更文件校验通过
- THEN 将暂存目录切换为新版本目录
- AND 更新本地版本记录

#### Scenario: 校验失败

- WHEN 任一文件下载失败、解包失败或哈希不匹配
- THEN 保持旧版本继续生效
- AND 不写入半成品版本

### Requirement: 回滚

Shell SHALL 保留上一版已生效资源并支持失败回滚。

#### Scenario: 激活失败

- WHEN 新版本切换后资源解析失败或 manifest 不完整
- THEN 自动回滚到上一版生效资源
- AND 记录失败原因

## Local Storage Layout

### Requirement: 用户目录存储

Shell SHALL 将下载资源保存在用户数据目录，而不是 App 安装目录。

#### Scenario: 本地目录

- WHEN Shell 初始化资源目录
- THEN 使用 `app.getPath('userData')` 下的独立图片更新目录
- AND 不直接覆写内置 `dist/assets` 或安装目录中的静态资源

### Requirement: 版本目录

Shell SHALL 使用按版本隔离的目录结构。

建议结构：

```text
userData/
  asset-releases/
    current.json
    versions/
      <assetVersion>/
        manifest.json
        files...
    staging/
      <assetVersion>/
```

#### Scenario: 生效版本记录

- WHEN Shell 完成切换
- THEN 在本地写入当前生效版本记录
- AND 下次启动优先读取该记录

## Runtime Asset Resolution

### Requirement: 下载资源优先级

Shell 运行时图片解析 SHALL 优先读取已下载的发布资源，其次读取用户手动导入资源，最后回退到内置资源。

#### Scenario: 资源命中优先级

- WHEN 某图片在已下载版本中存在
- THEN 优先使用已下载版本
- AND 不回退到内置资源

#### Scenario: 资源缺失回退

- WHEN 已下载版本中不存在某图片
- THEN 继续按现有逻辑回退到用户资源或内置资源
- AND 不因单张图缺失导致整个资源版本失效

## UI And Observability

### Requirement: 更新状态

Shell SHALL 提供基础更新状态展示。

#### Scenario: 状态字段

- WHEN Shell 展示图片更新状态
- THEN 至少包含 `当前资源版本 / 目标资源版本 / 检查中 / 下载中 / 校验中 / 激活中 / 失败`

### Requirement: 错误记录

Shell SHALL 记录更新失败原因。

#### Scenario: 可诊断失败

- WHEN 更新失败
- THEN 记录失败阶段和错误原因
- AND 不只返回笼统的“更新失败”

## Security

### Requirement: 路径安全

Shell SHALL 拒绝 manifest 中非法路径。

#### Scenario: 非法相对路径

- WHEN manifest 文件项出现 `..`、绝对路径或非法分隔符
- THEN 直接判定 manifest 非法
- AND 拒绝下载与激活

### Requirement: 来源可信

Shell SHALL 只从配置允许的发布地址拉取 manifest 和资源包。

#### Scenario: 固定来源

- WHEN Shell 拉取资源更新
- THEN 只请求预设 release 地址或配置白名单地址
- AND 不接受任意用户输入的下载域名作为正式发布源

## Compatibility With Existing Manifest

### Requirement: 保留现有 `_manifest.json`

当前 `public/assets/images/_manifest.json` SHALL 继续作为资源浏览和 fallback 索引，不直接演化为 Shell 更新清单。

#### Scenario: 双清单并存

- WHEN 系统同时存在 `_manifest.json` 与 `assets-release-manifest.json`
- THEN `_manifest.json` 服务于图片列表与选择器
- AND `assets-release-manifest.json` 服务于 Shell 更新
- AND 两者字段结构允许不同

## Acceptance

- Shell 已具备独立的图片更新清单协议。
- 发布工具已被定义为独立工具，而不是 Shell 内置流程。
- Release Manifest 已包含版本、兼容性、文件哈希、下载定位和删除列表。
- Shell 更新流程已定义检查、下载、校验、切换和回滚。
- 本地资源目录已定义 staging / versions / current 三层结构。
- 运行时资源优先级已明确为“下载资源 > 用户资源 > 内置资源”。
- 当前 `_manifest.json` 与 Release Manifest 职责已分离。
