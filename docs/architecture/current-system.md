# 当前系统全景

## 组件

| 组件 | 入口 | 责任 |
| --- | --- | --- |
| 产品前端 | `src/` | 选人、角色配置、排轴、Buff、计算、报告与资料编辑 |
| Electron Shell | `electron/main.cjs` | 窗口、loopback bridge、图片与本地数据能力 |
| Timeline Repository | `electron/timeline-repository.cjs` | 文档、快照、Work Node、checkout、审计与 payload 去重 |
| Work Node 兼容存储 | `electron/ai-timeline-work-node-store.cjs` | 迁移期节点树兼容投影 |
| 数据管理 | `electron/data-management-service.cjs` | user.sqlite、完整数据包、排轴存档、Release 校验与迁移 |

## 依赖方向

前端只能通过显式浏览器存储 API 或 Electron bridge 访问本地能力。SQLite repository 不依赖 React；数据下载不直接写浏览器状态；图片管理不改变数据包或排轴工作区。

## 兼容层

1.8 LTS 继续读取历史 `def.*` storage key、`def.localdata.archive.v1` 和 `def.ai-timeline.worknodes.v1`，避免升级后丢失用户数据。它们只作为数据合同保留，相关 DEF/OpenCode 运行时已删除。
