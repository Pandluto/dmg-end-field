# Shell 图片更新 Tasks

## Status

本任务用于把 Shell 图片资源更新能力落到 `docs/specs/shell-image-update/spec.md` 定义的结构。

当前项目已经具备图片资源索引、Electron 文件桥接和本地图片目录管理能力，但尚未具备发布清单、增量下载、版本切换和回滚链路。本任务要求在不破坏现有图片浏览与导入能力的前提下，为 Shell 增加独立图片更新体系。

## Guardrails

- [ ] 不覆盖当前 `public/assets/images/_manifest.json` 的浏览索引用途。
- [ ] 不将 Shell 图片更新建立在 git 仓库直接拉取之上。
- [ ] 不将发布工具耦合进 Electron 主进程。
- [ ] 不直接覆写 App 安装目录中的内置资源。
- [ ] 不要求首版必须实现二进制 diff 或压缩算法优化。
- [ ] 不改 Image Manager 现有导入、重命名、删除主流程。
- [ ] 不在本轮实现 App 二进制自动更新。

## Phase 0: Reconcile Current Image Manifest Roles

- [ ] 盘点当前 `_manifest.json` 的生成入口、消费入口和字段结构。
- [ ] 明确 `_manifest.json` 继续服务于图片浏览与 fallback。
- [ ] 明确新增的 Release Manifest 不复用 `_manifest.json` 原数组协议。
- [ ] 明确 `builtin / user / legacy` 在图片更新链路中的角色边界。
- [ ] 明确当前 `/user-images/*` 资源服务是否可复用到下载资源层。

## Phase 1: Release Manifest Protocol

- [ ] 定义 `assets-release-manifest.json` 顶层协议。
- [ ] 定义 `manifestVersion`。
- [ ] 定义 `releaseTag`。
- [ ] 定义 `generatedAt`。
- [ ] 定义 `assetVersion`。
- [ ] 定义 `baseVersion`。
- [ ] 定义 `minShellVersion`。
- [ ] 定义 `files` 字段。
- [ ] 定义 `deletedFiles` 字段。
- [ ] 定义文件项字段：`relativePath / sha256 / sizeBytes / source / packagePath 或 downloadUrl`。
- [ ] 明确 manifest 非法路径校验规则。
- [ ] 明确 manifest 与当前 `_manifest.json` 的职责分离说明。

## Phase 2: Publisher Tool

- [ ] 为图片发布定义独立工具目录与入口脚本。
- [ ] 工具输入支持图片源目录。
- [ ] 工具输入支持上一个已发布 manifest。
- [ ] 工具输出支持新版本 Release Manifest。
- [ ] 工具输出支持新增/变更文件集合。
- [ ] 工具输出支持删除文件集合。
- [ ] 为每个文件计算 `sha256`。
- [ ] 以 `relativePath` 作为发布文件主键。
- [ ] 支持在无 `baseVersion` 时输出完整包。
- [ ] 支持在有 `baseVersion` 时输出增量包。
- [ ] 为资源包生成明确版本命名规则。
- [ ] 为发布工具定义失败退出码和基本日志。

## Phase 3: Shell Storage Layout

- [ ] 在 Shell 主进程定义图片更新根目录。
- [ ] 根目录位于 `app.getPath('userData')` 下。
- [ ] 定义 `versions/<assetVersion>` 目录。
- [ ] 定义 `staging/<assetVersion>` 目录。
- [ ] 定义当前生效版本记录文件，例如 `current.json`。
- [ ] 定义上一版保留策略。
- [ ] 不将下载资源写入安装目录。
- [ ] 不破坏现有用户手动导入图片目录。

## Phase 4: Shell Update Service

- [ ] 在 Shell 新增图片更新服务模块。
- [ ] 新增读取本地当前资源版本能力。
- [ ] 新增拉取远端 Release Manifest 能力。
- [ ] 新增 `minShellVersion` 兼容性判断。
- [ ] 新增远端 manifest 路径校验。
- [ ] 新增版本对比逻辑。
- [ ] 新增仅下载新增/变更文件的逻辑。
- [ ] 新增下载到 staging 目录的逻辑。
- [ ] 新增文件哈希校验逻辑。
- [ ] 新增删除列表处理逻辑。
- [ ] 新增激活版本逻辑。
- [ ] 新增激活失败自动回滚逻辑。
- [ ] 新增更新状态机：检查中 / 下载中 / 校验中 / 激活中 / 失败 / 已完成。
- [ ] 新增失败原因记录。

## Phase 5: Runtime Bridge And IPC

- [ ] 在 `preload` 暴露图片更新相关 Runtime 方法。
- [ ] 定义查询图片更新状态接口。
- [ ] 定义手动检查更新接口。
- [ ] 定义手动开始更新接口。
- [ ] 如需支持自动检查，定义启动后后台检查入口。
- [ ] 定义错误信息和状态返回结构。
- [ ] 保持现有 `desktopRuntime` 图片管理接口兼容。

## Phase 6: Runtime Asset Resolution

- [ ] 定义运行时图片查找优先级。
- [ ] 优先读取已下载资源版本。
- [ ] 次级读取用户手动导入资源。
- [ ] 末级回退到内置资源。
- [ ] 明确同名文件冲突时的 winner 规则。
- [ ] 确认图片解析链路与 `canonicalPath / publicUrl / /user-images/*` 的衔接方式。
- [ ] 保证单张图片缺失时仍可回退，不使整个版本失效。

## Phase 7: Shell UI

- [ ] 在 Shell 中定义图片更新入口位置。
- [ ] 展示当前资源版本。
- [ ] 展示目标资源版本。
- [ ] 展示最近检查结果。
- [ ] 展示更新中状态。
- [ ] 展示失败原因。
- [ ] 提供手动检查按钮。
- [ ] 提供手动更新按钮。
- [ ] 不让图片更新入口挤占现有核心工作台布局。

## Phase 8: Validation

- [ ] 增加 manifest 协议纯函数测试。
- [ ] 增加非法路径拒绝测试。
- [ ] 增加版本比较测试。
- [ ] 增加增量文件选择测试。
- [ ] 增加哈希校验失败回滚测试。
- [ ] 增加激活失败回滚测试。
- [ ] 增加资源优先级回归测试。
- [ ] 运行 `npm run build`。

## Acceptance Checklist

- [ ] Release Manifest 协议已定义且独立于当前 `_manifest.json`。
- [ ] 发布端已经按独立工具建模。
- [ ] Manifest 已包含版本、兼容性、文件哈希和删除列表。
- [ ] Shell 已具备检查、下载、校验、激活、回滚的完整更新链路。
- [ ] 下载资源目录位于 `userData` 下，且按版本隔离。
- [ ] 运行时资源优先级已切换为“下载资源 > 用户资源 > 内置资源”。
- [ ] 图片更新入口已能展示状态与失败原因。
- [ ] `npm run build` 通过。
