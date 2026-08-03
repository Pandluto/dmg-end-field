# 技术栈与技术选择

[← 返回项目入口](../README.md)

| 能力 | 技术 | 责任 |
| --- | --- | --- |
| 界面 | React 18 + TypeScript | 路由、配置、排轴、Buff、计算与报告 |
| 构建 | Vite 7 | 本地开发与静态生产构建 |
| 离线应用 | vite-plugin-pwa + Workbox | Web manifest、应用壳与运行时资源缓存 |
| 用户数据库 | `@sqlite.org/sqlite-wasm` | 在 Worker 中运行 SQLite |
| 持久文件 | OPFS SAH Pool VFS | 保存 SQLite 文件并支持数据库导入导出 |
| 官方资料 | Cache Storage + Web Crypto | 下载、版本记录与 SHA-256 校验 |
| 图片解压 | fflate | 在浏览器中异步解压官方 ZIP |
| 标签页协调 | Web Locks + BroadcastChannel | 单写入租约、占用状态与显式接管 |
| 搜索 | Fuse.js + pinyin-pro | 本地资料模糊检索 |

Damage Sheet、XLSX 导出与 ExcelJS 已在 1.8 slim 中退役；伤害输出保留浏览器内的 PPT 报表。

## 为什么不用浏览器里的“服务器 SQLite”

SQLite WASM 直接运行在用户浏览器中，数据库文件写入 OPFS；没有远端数据库进程。它保留了既有 repository、事务、外键和 CAS 语义，同时让静态 Web 应用可以离线运行。

## 为什么官方资料不全塞进数据库

JSON 与图片是可重新下载的版本化只读资产，放入 Cache Storage 更适合 Service Worker 拦截和按 URL 消费。私人排轴、配置和自定义图片则需要事务与统一备份，所以进入 SQLite。

1.8 LTS 不包含 Electron、Node 运行时服务、OpenCode、Agent、Harness、MCP SDK、账号或云数据库。
