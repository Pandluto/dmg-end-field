# 验证矩阵

| 层级 | 命令或操作 | CI | 证明什么 |
| --- | --- | --- | --- |
| 仓库契约 | `npm run check:repo` | 是 | 已删除运行时不回流、manifest/hash/路径/文档链接有效 |
| 依赖审计 | `npm run audit:dependencies` | 是 | 无 high/critical 已知漏洞 |
| 类型检查 | `npm run typecheck` | 是 | TypeScript 合同可编译 |
| 单元/合同 | `npm test` | 是 | 计算、选择策略、Timeline session 与 checkout 逻辑 |
| Timeline bundle | `npm run smoke:timeline-bundle` | 是 | 分享范围、hash、节点关系与本地路径过滤 |
| Web/PWA 构建 | `npm run build:web` | 是 | 静态应用、Worker、WASM 和 Service Worker 可构建 |
| 页面更新策略 | `pageVersionRuntime.test.ts` + `serviceWorkerRuntime.test.ts` + atomic shell check | 是 | 自动检查只读取版本清单；受控导航保留当前壳；点击更新才激活完整 waiting worker |
| 自包含本地包 | `npm run build:local` | Release/人工 | 31 MB 图片 sidecar 存在且 hash 匹配 |
| 首次安装 | 真实 Chromium | 否 | 密码、确认、99+559 文件、进度与页面放行 |
| 数据持久化 | 真实 Chromium | 否 | 刷新后工作区、快照、配置和图片仍存在 |
| 单写入 | 两个真实标签页 | 否 | 第二页阻止写入，接管后旧页让出 |
| PWA/离线 | production preview | 否 | Service Worker 控制后离线壳与已装资源可读 |
| 自动检查/手动更新 | 已部署站点 | 否 | 当前版本可见；发现新版前不开放更新；点击后才下载、激活并重新载入 |

`npm run check` 是合并门，但不能替代真实浏览器验收。涉及 OPFS、Cache Storage、Service Worker、文件选择器或多标签页的改动必须补做对应人工或浏览器自动化检查。
