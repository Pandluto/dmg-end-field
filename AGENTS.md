# Agent Notes

- 默认不写测试，除非本次代码改动确实非常需要测试覆盖。
- 默认不使用 superpowers；只有在编写 specs / tasks 且确实必要时才使用。
- 开启新一轮 spec / tasks 时，必须先等待用户提供标题、目标或具体内容；如果用户没有给出规格内容，只能创建空壳或询问补充，不能自行编写需求、范围、验收标准或任务拆分。
- 自动提交时机：research / spec+task 完成时、task 对应 coding 完成时、每次修复完成时，都要自动提交。
- `npm run dev` 是最常用的本地 Web 开发指令，固定监听 `127.0.0.1:3030`。已运行时不要主动关闭或重启；遇到端口阻塞时先确认进程归属，再按需重启。

## 1.8 LTS 开发路由

- `codex/v1.8-lts-slimming` 是 Web 与共通产品代码的默认起始分支。除桌面专属能力外，Buff、伤害计算、SQLite/存档、导出 schema、通用交互以及会影响网站或移动端的修复，必须先在 Slimming 实现、验证并提交，再按需向 Desktop Shell 单向移植。
- 不得因为主工作区当前停留在 Desktop Shell，就先在 Desktop 编写共通或 Web 补丁；应直接进入 Slimming worktree 开始工作。
- `codex/v1.8-lts-desktop-shell` 只作为 Electron、MCP、DEF Agent、桌面打包宿主等专属能力的起始分支，并接收从 Slimming 选择性重放的共通补丁。
- 两个分支禁止整分支合并；同步时按目标分支结构 cherry-pick 或手工重放最小行为，保留各自专属实现。

- 网站部署路由：用户提出“部署、上线、重新部署、更新线上站点”等请求时，必须读取并使用 `.agents/skills/dmg-dual-deploy/SKILL.md`。`dmgendfield.cloud` 是唯一维护中的应用，默认只部署国内服务器；海外 Sites 已退役，只保留同路径跳转、PWA 迁移端点和历史分享 API，只有用户明确要求修复或更新海外退役兼容层时才部署 Sites。
- 资源发包路由：用户提出“发数据包、发资源包、更新线上资料”等请求时，资源只发布到国内服务器的统一稳定通道，不得上传 GitHub Release，也不得重建海外完整应用；海外旧资源 URL 由退役 Worker 同路径跳转国内。发布过程同样必须读取并使用 `.agents/skills/dmg-dual-deploy/SKILL.md`。资源版本固定使用本次实际打包时的北京时间，格式为 `YYYYMMDD.HHmmss.<内容哈希>`；Share Data 的 `exportedAt` 只保留为来源信息，严禁再用作对外版本日期或时间。
- 纯数据重发只做打包所需校验和上线后的最小健康检查，不再展开桌面端、移动端、离线 PWA、缓存策略或海外路由等额外验收；只有本次变更触及对应能力或用户明确要求时，才增加聚焦验证。
- 两路径最小交接：用户给出完整 `def.localdata.archive.v1` Share Data JSON 路径和图片目录路径，并明确说“打包上传、发包、发布资源、更新线上资料”时，即构成完整交接与国内资源发布授权；直接按项目 Skill 完成打包、校验、Slimming 物化、提交推送和 `.cloud` 部署，不再要求用户提供输出目录、版本号或中间 ZIP 路径。若只说“打包、生成、校验”，则停在已校验的本地产物，不推送也不上线。
