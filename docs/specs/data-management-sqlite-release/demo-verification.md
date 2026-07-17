# 数据管理 SQLite 与网络发布 Spec：Demo 逐项验证

## 结论

前一版 Demo 只能证明 catalog 全量替换不会覆盖 `user.sqlite`，不足以代表整个 Spec 已可实施。本轮将 Spec 的运行时要求与 10 条验收标准逐项追踪；结果明确区分“已由 Demo 验证”“已有实现验证”“部分验证”和“尚未实现”。

当前结论是：**分库、版本钉死、原子 catalog 激活与安全迁移在技术上可行；完整 Spec 尚未实现，尤其是 Shell 网络更新、Renderer 去 browser storage、旧存档迁移和统一存档 UI。**

## 可重复执行的证据

在此 Demo 工作树执行：

```bash
npm run demo:data-management-sqlite
node scripts/data-management-spec-audit.mjs
```

既有底座的实测证据在主工作树执行：

```bash
node scripts/timeline-repository-smoke.mjs
node scripts/timeline-bundle-v2-smoke.mjs
node scripts/ai-timeline-work-node-sqlite-smoke.mjs
```

三条既有 smoke 在本次审计中均通过。Demo 工作树不安装完整前端依赖，因此 Bundle smoke 复用主工作树的同提交基线执行。

## 核心数据与更新契约

| ID | Spec 内容 | 结果 | 证据 / 限制 |
| --- | --- | --- | --- |
| DM-01 | SQLite 为正式事实源 | 部分验证 | Demo 的 catalog/user/checkout/迁移记录均为 SQLite；当前产品仍写 browser storage。 |
| DM-02 | `catalog.sqlite` 与 `user.sqlite` 分库 | Demo 通过 | catalog 激活只移动 versioned catalog 与 `active.json`，user DB SHA-256 不变。 |
| DM-03 | 预载模板克隆为用户文档 | Demo 通过 | `template.demo` 被复制为独立 document、snapshot、checkout 与 audit。 |
| DM-04 | 本机/共享存档统一为单一语义 | 未实现 | Shell 仍显示并管理“本机存档 / 共享存档”。 |
| DM-05 | catalog 使用稳定 ID，不能级联删用户数据 | 部分验证 | Demo 使用稳定 ID 且全量替换不写 user DB；缺失 catalog 项的结构化诊断未实现。 |
| DM-06 | 版本目录、暂存目录、active 指针、builtin fallback | Demo 通过 | Demo 验证 `versions/`、staging、原子 pointer 与 active 缺失时 builtin fallback。 |
| DM-07 | catalog 完整表模型 | 部分验证 | Demo 验证 operators/weapons/equipments/buffs/templates；尚未实现 payload blob、检索投影与全文索引。 |
| DM-08 | user 完整表模型 | 部分验证 | Demo 验证用户配置、Buff、文档、快照、checkout、审计、迁移记录；尚未迁入实际 `user.sqlite`。 |

## 发布包与更新流程

| ID | Spec 内容 | 结果 | 证据 / 限制 |
| --- | --- | --- | --- |
| DM-09 | 全量 catalog 包优先 | Demo 通过 | 每次以完整 `catalog.sqlite` 暂存并激活。ZIP 容器尚未实现。 |
| DM-10 | manifest 类型、版本、哈希、最低 Shell 版本 | Demo 通过 | Demo 拒绝错误 hash 和高于 `1.8.2` 的最低 Shell 版本。 |
| DM-11 | `integrity_check` 与必要表校验 | Demo 通过 | staged catalog 通过 SQLite 完整性与必需表校验后才能激活。 |
| DM-12 | 失败更新保留旧版本 | Demo 通过 | hash/兼容性失败后 active 仍为 v2，未生成目标 version 目录。 |
| DM-13 | 同版本重复安装幂等 | Demo 通过 | 同 hash 的 v2 重装复用已安装版本。 |
| DM-14 | 签名验真 | 未实现 | Demo 与现有 Shell 均未实现 pinned-public-key 签名验证。 |
| DM-15 | 网络检查、下载、ZIP 路径穿越 / bomb 限制 | 未实现 | 尚无数据 release 客户端或 ZIP 包处理。 |
| DM-16 | 下载成功后重开 catalog 连接和刷新查询缓存 | 未实现 | Demo 是短生命周期进程，未覆盖长驻 Electron 连接。 |

## 主界面契约与迁移

| ID | Spec 内容 | 结果 | 证据 / 限制 |
| --- | --- | --- | --- |
| DM-17 | 恢复在一个事务中更新 checkout 与 audit | Demo 通过 | 恢复成功写 checkout/audit；缺失 snapshot 回滚，旧 checkout/audit 数不变。 |
| DM-18 | Renderer 只经 Repository 写入 | 未实现 | `timelineSnapshotStorage.ts`、Buff/角色 Repository 仍写 browser storage。 |
| DM-19 | Renderer 不直写 SQLite | 现状通过 | `src/` 不使用 `DatabaseSync`；但这不抵消 browser storage 仍为事实源的问题。 |
| DM-20 | 启动从 active catalog + user checkout 恢复 | 未实现 | Demo 可离线 resolve catalog；当前主界面启动仍 bootstrap local-data bridge。 |
| DM-21 | 预载模板在主界面选择后生成用户副本 | 未实现 | 只在 Demo 中验证，无生产 API/UI。 |
| DM-22 | 重启 / 多窗口从 SQLite 重建 | 未实现 | 当前 active document 与工作副本仍依赖 local/sessionStorage。 |
| DM-23 | 旧档备份、逐档迁移、来源 / hash 记录 | 部分验证 | Demo 证明 source 保留、hash 记录、重复导入不复制；生产备份和 local/share 扫描未实现。 |
| DM-24 | Work Node 保持关联且不与 Snapshot 混淆 | 既有底座通过 | `timeline-repository-smoke` 与 Work Node SQLite smoke 均通过；尚未完成统一 user DB 迁移。 |
| DM-25 | 迁移失败不删除原文件 | Demo 通过 | Demo 的 legacy archive 在迁移后保留；缺少生产失败注入与恢复 UI。 |

## 导入导出、非目标与验收

| ID | Spec 内容 | 结果 | 证据 / 限制 |
| --- | --- | --- | --- |
| DM-26 | Bundle 导入导出而非复制数据库 | 既有底座通过 | `timeline-bundle-v2-smoke` 通过，使用可移植 `dmg.timeline-bundle.v2`。 |
| DM-27 | 不直接导入 / 覆盖 SQLite 文件 | 未验证 | 尚无新数据管理 UI；需要在实现导入入口时加拒绝测试。 |
| DM-28 | 不做云同步、协作、CRDT | 未实现且未引入 | Demo 不含远程用户数据库；后续实现需继续保持。 |
| DM-29 | 不改变主界面交互或 AI 审批 | 本 Demo 遵守 | Demo 位于隔离工作树，不改主界面、Canvas 或审批代码。 |
| DM-30 | 主界面 Spec 只依赖稳定 Repository API | 未验证 | 需在生产 API 定稿后对 Spec 交叉审查。 |

## 验收标准追踪

| 验收 | 结果 | 说明 |
| --- | --- | --- |
| 1. 离线启动 | Demo 通过 | active 指针缺失时可用 builtin catalog，并可读取 user DB。 |
| 2. Shell 检查/下载/校验/激活/回滚 | 部分验证 | 本地 staged 全量包的校验、激活、失败回滚已验证；网络、Shell、ZIP、签名未实现。 |
| 3. catalog 更新不改用户数据 | Demo 通过 | 更新前后 `user.sqlite` SHA-256 相同。 |
| 4. 不再以 browser storage 为事实源 | 未实现 | 静态审计仍检出正式写入路径。 |
| 5. Snapshot 恢复三方一致 | 部分验证 | checkout/audit 事务已验证；当前 Renderer 工作副本尚未迁入 SQLite。 |
| 6. 预载模板克隆 | Demo 通过 | 新用户 document 与 snapshot 不受 catalog v2 影响。 |
| 7. local/share 可迁移、可审计、可重试 | 部分验证 | Demo 验证单档 idempotent import；批量扫描、备份、失败 UI 未实现。 |
| 8. UI 统一文档 / 恢复点语义 | 未实现 | Shell 仍是本机/共享存档双分支。 |
| 9. Bundle 保持可用 | 既有底座通过 | Bundle V2 smoke 通过。 |
| 10. 与主界面 Spec 解耦 | 未验证 | 需在生产 API 收敛后做文档边界审查。 |

## 下一步

这份矩阵不应直接转为“实现完成”结论。下一阶段应先实现数据发布服务和 user Repository adapter，再把当前 browser storage 写入逐组迁移；每完成一组，必须把上表对应项从 Demo/部分验证提升为生产验证。
