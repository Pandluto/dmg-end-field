# Agent Notes

- 默认不写测试，除非本次代码改动确实非常需要测试覆盖。
- 默认不使用 superpowers；只有在编写 specs / tasks 且确实必要时才使用。
- 开启新一轮 spec / tasks 时，必须先等待用户提供标题、目标或具体内容；如果用户没有给出规格内容，只能创建空壳或询问补充，不能自行编写需求、范围、验收标准或任务拆分。
- 自动提交时机：research / spec+task 完成时、task 对应 coding 完成时、每次修复完成时，都要自动提交。
- `npm run dev` 是最常用的本地 Web 开发指令，固定监听 `127.0.0.1:3030`。已运行时不要主动关闭或重启；遇到端口阻塞时先确认进程归属，再按需重启。
- `npm run electron:dev` 一键启动 Desktop Shell、3030 浏览器工作台与 MCP。AI/Agent 的实现暂时保留，但 Electron 入口、preload 和 IPC 已冻结，不得在日常启动中初始化；普通 Web 调试仍优先使用 `npm run dev`。

## 1.8 LTS 分支合同

- `v1.8-LTS` 是共同祖先与审计锚点，不是当前开发或生产部署分支。
- `codex/v1.8-lts-slimming` 是唯一共享 Web 基线和国内生产分支，拥有普通工作台、SQLite/存档、移动端、通知、资源消费者/物化和服务器部署。
- `codex/v1.8-lts-desktop-overlay` 是当前桌面分支，也是 Slimming 的单向下游叠加层，只增加 Electron、MCP、保留但入口冻结的 DEF Agent、Desktop Host Adapter、资源发包实现和相应文档。
- `codex/v1.8-lts-desktop-shell` 已被 Overlay 取代，只保留远端旧历史和迁移前归档，不是开发、推送或发布目标。
- 除桌面专属能力外，Buff、伤害计算、SQLite/存档、导出 schema、通用交互以及会影响网站或移动端的修复，必须先在 Slimming 实现、验证并提交，再把已验证的 Slimming tip 合入 Desktop Overlay。Overlay 专属提交严禁反向进入 Slimming。
- 不得因为主工作区停留在旧 Desktop Shell，就先在该分支编写共通、Web 或桌面补丁；共通工作进入 Slimming worktree，桌面专属工作进入 Desktop Overlay worktree。
- 共享 `src/core/`、数据库、资源消费者、普通 Timeline/Canvas、移动端和 Web/PWA 文件必须与记录的 Slimming 基线一致；宿主差异只能通过中性扩展合同和 Desktop 独占目录接入。
- Desktop 的 Electron、MCP、Agent、桌面代理和打包宿主不得进入 Slimming；Desktop 分支继承的生产源码不代表它获得网站部署职责。
- 完整规则与当前同步清单见 `docs/architecture/lts-branch-contract.md`。

## 数据发包与部署

- Electron Shell 的资源打包入口已冻结。收到完整 `def.localdata.archive.v1` Share Data 与图片目录后，由 Agent 按项目 Skill 调用保留的底层发包实现，生成并校验统一 `dmg.resource-release.v1` ZIP；员工增量、单一资料库导出或 `operator-library-share.v1` 不能直接作为发布输入。
- 用户给出完整 Share Data JSON 路径和图片目录路径，并明确说“打包上传、发包、发布资源、更新线上资料”时，即构成完整交接与国内资源发布授权：直接按项目 Skill 完成打包、校验、Slimming 物化、提交推送和 `.cloud` 部署，不再要求用户提供输出目录、版本号或中间 ZIP 路径；若只说“打包、生成、校验”，则停在已校验的本地产物，不推送也不上线。
- 资源版本固定使用本次实际打包时的北京时间，格式为 `YYYYMMDD.HHmmss.<内容哈希>`；Share Data 的 `exportedAt` 只保留为来源信息。
- 统一资源 ZIP 只能在 `codex/v1.8-lts-slimming` 中物化到 `public/` 并部署。Desktop 分支不是网站部署源，也不得上传 GitHub Release。
- 用户提出“部署、上线、重新部署、更新线上站点、发数据包、发资源包”等请求时，必须读取并使用 `.agents/skills/dmg-dual-deploy/SKILL.md`。
- `dmgendfield.cloud` 是唯一维护中的应用与资源源站，默认只部署国内服务器。海外 Sites 已退役，只保留同路径跳转、PWA 迁移端点和历史分享 API；只有用户明确要求修复海外兼容层时才部署 Sites。
- 纯数据重发只做打包所需校验和上线后的最小健康检查；只有本次变更触及对应能力或用户明确要求时，才增加桌面端、移动端、离线 PWA、缓存策略或海外路由等聚焦验证。
