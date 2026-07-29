# 技术栈与技术选择

[← 返回项目入口](../README.md)

| 能力 | 技术 | 责任 |
| --- | --- | --- |
| 界面 | React 18 + TypeScript | 配置、排轴、Buff、计算与报告 |
| Web 构建 | Vite | 开发服务器与生产静态构建 |
| 桌面壳 | Electron | 窗口、受控本地桥接、图片与数据能力 |
| 本地数据库 | Node `node:sqlite` / `DatabaseSync` | SQLite 工作区、快照、Work Node 与数据目录 |
| 表格导出 | ExcelJS | 伤害报告工作簿 |
| 搜索 | Fuse.js + pinyin-pro | 本地资料模糊检索 |
| 打包 | electron-builder | Windows portable 与 macOS DMG |

Vite 只在开发和构建期使用，发布包不携带前端源码。1.8 LTS 不包含云端数据库、OpenCode、Agent、Harness 或 MCP SDK。
