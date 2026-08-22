# Agent Notes

- 默认不写测试，除非本次代码改动确实非常需要测试覆盖。
- 默认不使用 superpowers；只有在编写 specs / tasks 且确实必要时才使用。
- 开启新一轮 spec / tasks 时，必须先等待用户提供标题、目标或具体内容；如果用户没有给出规格内容，只能创建空壳或询问补充，不能自行编写需求、范围、验收标准或任务拆分。
- 自动提交时机：research / spec+task 完成时、task 对应 coding 完成时、每次修复完成时，都要自动提交。
- `npm run dev` 是最常用的本地 Web 开发指令，固定监听 `127.0.0.1:3030`。已运行时不要主动关闭或重启；遇到端口阻塞时先确认进程归属，再按需重启。
- `npm run electron:dev` 启动 Desktop Shell、MCP 与按需 Agent 运行时；普通 Web 调试仍优先使用 `npm run dev`。

## 1.8 LTS 分支合同

- `v1.8-LTS` 是共同祖先与审计锚点，不是当前开发或生产部署分支。
- `codex/v1.8-lts-desktop-shell` 是桌面数据制作分支，保留 Electron、MCP、DEF Agent、桌面发包与相应文档；当前工作区默认在这里完成桌面能力和共通补丁适配。
- `codex/v1.8-lts-slimming` 是唯一维护中的 Web/国内生产分支，拥有移动端、通知、资源物化和服务器部署。
- 两个分支专业职责不同，禁止整分支互相合并。先用 `git merge-base` 与提交/文件差异确认来源，再只移植共同的领域逻辑、SQLite/存档语义、导出 schema、交互修复和资源协议。
- Desktop 的 Electron、MCP、Agent 与打包宿主不得进入 Slimming；Slimming 的移动端、通知中心、生产部署实现和退役海外 Worker 不得整块进入 Desktop。
- 共通补丁在目标分支必须按目标分支现有结构重放并做聚焦验证；不能用 Slim 文件覆盖 Desktop 中已经扩展的 Agent 事务逻辑。
- 完整规则与当前同步清单见 `docs/architecture/lts-branch-contract.md`。

## 数据发包与部署

- Desktop Shell 负责把完整 `def.localdata.archive.v1` Share Data 与图片目录打成统一 `dmg.resource-release.v1` ZIP；员工增量、单一资料库导出或 `operator-library-share.v1` 不能直接作为发布输入。
- 用户给出完整 Share Data JSON 路径和图片目录路径，并明确说“打包上传、发包、发布资源、更新线上资料”时，即构成完整交接与国内资源发布授权：直接按项目 Skill 完成打包、校验、Slimming 物化、提交推送和 `.cloud` 部署，不再要求用户提供输出目录、版本号或中间 ZIP 路径；若只说“打包、生成、校验”，则停在已校验的本地产物，不推送也不上线。
- 资源版本固定使用本次实际打包时的北京时间，格式为 `YYYYMMDD.HHmmss.<内容哈希>`；Share Data 的 `exportedAt` 只保留为来源信息。
- 统一资源 ZIP 只能在 `codex/v1.8-lts-slimming` 中物化到 `public/` 并部署。Desktop 分支不是网站部署源，也不得上传 GitHub Release。
- 用户提出“部署、上线、重新部署、更新线上站点、发数据包、发资源包”等请求时，必须读取并使用 `.agents/skills/dmg-dual-deploy/SKILL.md`。
- `dmgendfield.cloud` 是唯一维护中的应用与资源源站，默认只部署国内服务器。海外 Sites 已退役，只保留同路径跳转、PWA 迁移端点和历史分享 API；只有用户明确要求修复海外兼容层时才部署 Sites。
