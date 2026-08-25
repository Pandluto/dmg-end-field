# 当前系统全景

| 组件 | 入口 | 责任 |
| --- | --- | --- |
| Web 应用 | `src/App.tsx` | 路由、工作台与业务页面 |
| 启动边界 | `src/components/WebApp/WebBootstrap.tsx` | 租约、数据库、存储与资料包启动顺序 |
| 浏览器数据库 | `src/platform/database/` | SQLite WASM、OPFS VFS、schema 与备份 |
| 持久存储 | `src/platform/storage/` | 将既有 Storage API 投影到 SQLite |
| Timeline repository | `src/platform/timeline/browserTimelineStore.ts` | 文档、快照、Work Node、CAS、checkout、审计与存档 |
| 资料包 | `src/platform/resources/` | JSON/图片下载、解压、SHA-256 与 Cache Storage |
| 单写入协调 | `src/platform/runtime/workspaceLease.ts` | Web Locks、BroadcastChannel、占用提示与接管 |
| PWA | `vite.config.ts` | manifest、Service Worker、离线壳与资源运行时缓存 |

## 运行约束

- 需要支持 OPFS、Web Workers、WebAssembly、Web Locks、Cache Storage 和 Web Crypto 的当前桌面 Chromium。
- `localhost` 可作为开发安全上下文；实际联网部署必须使用 HTTPS。
- 同一浏览器配置只允许一个标签页持有写租约。
- 没有服务端数据库、账户、同步或桌面联动。
- 不兼容旧桌面 SQLite；1.8 Web 数据从新浏览器数据库开始。
