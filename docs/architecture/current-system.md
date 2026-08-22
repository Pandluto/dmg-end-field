# 当前系统全景

| 组件 | 入口 | 责任 |
| --- | --- | --- |
| Web 应用 | `src/App.tsx` | 路由、工作台与业务页面 |
| 启动边界 | `src/components/WebApp/WebBootstrap.tsx` | 门禁、租约、数据库、存储与资料包启动顺序 |
| 浏览器数据库 | `src/platform/database/` | SQLite WASM、OPFS VFS、schema 与备份 |
| 持久存储 | `src/platform/storage/` | 将既有 Storage API 投影到 SQLite |
| Timeline repository | `src/platform/timeline/browserTimelineStore.ts` | 文档、快照、Work Node、CAS、checkout、审计与存档 |
| 资料包 | `src/platform/resources/` | JSON/图片下载、解压、SHA-256 与 Cache Storage |
| 单写入协调 | `src/platform/runtime/workspaceLease.ts` | Web Locks、BroadcastChannel、占用提示与接管 |
| PWA | `vite.config.ts` | manifest、Service Worker、离线壳与资源运行时缓存 |
| Desktop Shell | `electron/` | 独立控制壳、静态宿主、系统浏览器启动、托盘与发包入口 |
| MCP 填表 | `src/legacyFillService/`、`dist/legacy-fill/` | 隔离的提案/审计服务与受审写入 |
| DEF Agent | `agent/`、`src/agentSessionSurface/` | 受控 Host、Provider、会话与产品能力桥接 |
| 统一资源生产 | `src/platform/resources/resourceRelease*` | Share Data 规范化、图片校验、统一 ZIP 与 SHA-256 验证 |

## 运行约束

- 需要支持 OPFS、Web Workers、WebAssembly、Web Locks、Cache Storage 和 Web Crypto 的当前桌面 Chromium。
- `localhost` 可作为开发安全上下文；实际联网部署必须使用 HTTPS。
- 同一浏览器配置只允许一个标签页持有写租约。
- 浏览器 SQLite 仍是业务工作区唯一权威数据库；Electron、MCP 与 Agent 不拥有第二套业务 SQLite。
- MCP 的 SQLite 只保存提案与审计，Agent Host 只通过受控产品协议操作浏览器工作台。
- 没有云端账户或自动同步；跨环境数据通过显式 SQLite/Share Data 导入导出流转。
