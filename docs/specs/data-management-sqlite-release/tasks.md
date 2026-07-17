# 数据管理：SQLite、数据包、存档与 Release 实施任务

本 Task 实施 [Spec](spec.md)。范围仅为数据管理与恢复入口；不改变伤害计算、编辑器业务和主界面排轴编辑流程。

## UI 现状分析

- Shell 仍保留可用的 Local Data／Share Data 完整包保存、读取、应用、删除逻辑，但数据页被 catalog／参考存档面板覆盖，用户无法以正确的两类数据源进行操作。
- Shell 发布器错误要求选择静态数据源目录，并将待发布参考存档自动塞入 catalog 包；这违背“从 Local Data 或 Share Data 选择一份发布”的业务规则。
- 主界面恢复面板把“本地／待发布／联网／SQLite”并列；待发布和联网是旧实现泄漏，不是用户应见的对象分类。
- 既有“应用数据”已经负责把完整包写入浏览器 storage；本任务将它收敛为唯一拆包入口，并把排轴部分导入共享存档。

## T1：本地对象和兼容迁移

- [x] 将存档库正式命名为 `local` 与 `shared`；移除 UI 与 API 中的 `pending-reference`／`reference` 产品语义。
- [x] 将运行时本地存档与共享存档放入独立目录；本地存档不得位于 Local Data 文件夹之下。
- [x] 兼容读取旧 `reference-archive-outbox`、旧 reference 安装目录和旧 `source: reference` 文件；首次读取前备份，幂等迁入共享存档。
- [x] 扩展完整数据包的 `timelineArchives` 存档部分；旧 timeline storage 字段可被解析但不改写原文件。
- [x] 实现共享存档整体写入 Local Data／Share Data 存档部分，写入前校验目标、写入失败不得损坏数据部分。

验收：Local Data、Share Data、本地存档、共享存档是四个可独立列举的对象；旧文件仍在且可迁移。

## T2：应用数据与 SQLite／存档转换

- [x] 为“应用数据”增加主进程服务：从 Local Data 或 Share Data 读取完整包，拆出数据部分和存档部分。
- [x] 数据部分沿用既有 Web storage 应用流程；存档部分导入共享存档，不直接应用到 SQLite。
- [x] SQLite 支持导出到本地存档和共享存档；共享存档支持转换为本地存档；两类存档均支持转换为新 SQLite 工作区。
- [x] 保持节点树导入根、checkout 映射、payload-only 降级、审计与删除隔离约束。

验收：应用完整包不会直接覆盖 SQLite；存档转换始终新建工作区且来源不删除。

## T3：完整数据 Release

- [x] 以一份已选 Local Data／Share Data 生成 `dmg.local-data-release-manifest.v1`、内部 manifest 和 ZIP；删除数据源目录选择。
- [x] 实现同图片 Release 地址下的数据 manifest 检查：图片-only Release 显示无数据包。
- [x] 下载后校验包大小、hash、ZIP 文件集合和内部 manifest；原子写入 Share Data。
- [x] 相同版本／hash 幂等；同版本不同 hash 拒绝；下载绝不自动应用数据或存档。
- [x] 保留输出目录选择、打开输出目录和结构化错误信息。

验收：从任一数据列表选择一项即可生成发布包；下载结果仅进入 Share Data。

## T4：UI 收敛

- [x] Shell 数据页恢复 Local Data／Share Data 的按钮切换列表、保存、应用、删除与打开位置；显示下载来源和存档数量。
- [x] Shell 数据更新文案和状态改为“下载到 Share Data”；删除 catalog／参考存档卡片和数据源目录输入。
- [x] Shell 发布器改为已选数据项、版本、输出目录；生成器不可在未选项时执行。
- [x] 主界面恢复标签改为“本地存档／共享存档／SQLite”；改正按钮和提示文案，移除联网分类。
- [x] 两处存档列表只显示节点数量，不渲染节点树。

验收：UI 的名称、可用操作和 Spec 三层流程一一对应，不出现旧产品术语。

## T5：验证与审计

- [x] 为服务增加数据包构建／安装、共享存档写入、旧包兼容和 SQLite 转换 smoke。
- [x] 运行相关服务 smoke、TypeScript 检查和 Web 构建。
- [x] 使用真实 Electron Shell 与主界面确认数据页按钮切换、发布器无源目录、恢复标签、下载后的 Share Data 可见性。（Computer Use：重启后的 Electron Shell 列出 1 个 Local Data 与 4 个 Share Data，Share Data 筛选可用；发布器无源目录；主界面本地／共享存档与 SQLite 三标签均可读取，且共享存档实际显示节点数量。全程未写入用户数据。）
- [x] 逐项审计 Spec、Task、API、UI 文案和测试证据；列出已修复项与剩余非阻塞风险。

验收：所有高风险数据流有可复现证据；任何验证失败不得宣称完成。
