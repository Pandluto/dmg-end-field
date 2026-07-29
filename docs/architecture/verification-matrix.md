# 验证矩阵

| 层级 | 命令 | CI | 证明什么 |
| --- | --- | --- | --- |
| 仓库契约 | `npm run check:repo` | 是 | 锁文件、打包输入、路径、JS 语法与已删除运行时不会回流 |
| 依赖审计 | `npm run audit:dependencies` | 是 | 无 high/critical 已知漏洞 |
| 类型检查 | `npm run typecheck` | 是 | TypeScript 合同可编译 |
| 单元/合同 | `npm test` | 是 | 计算、存储与领域逻辑 |
| Web 构建 | `npm run build:web` | 是 | 前端生产构建 |
| Work Node / SQLite | `npm run smoke:work-node-sqlite` | 否 | 节点、备份恢复与迁移 |
| 数据管理 | `npm run smoke:data-management` | 否 | user.sqlite、完整数据包与存档 |
| 数据 Release | `npm run smoke:data-release-builder` | 否 | manifest、ZIP 与 hash |
| 下载/应用边界 | `npm run smoke:local-data-archive-flow` | 否 | Share Data、显式应用与工作区转换 |
| Electron UI | `npm run smoke:operator-config` | 否 | 真实桌面配置主链 |

`npm run check` 是合并门。涉及 SQLite、数据包、图片或桌面桥接的改动，还应执行对应 focused smoke；CI 绿灯不替代真实桌面验收。
