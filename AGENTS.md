# Agent Notes

- 默认不写测试，除非本次代码改动确实非常需要测试覆盖。
- 默认不使用 superpowers；只有在编写 specs / tasks 且确实必要时才使用。
- 开启新一轮 spec / tasks 时，必须先等待用户提供标题、目标或具体内容；如果用户没有给出规格内容，只能创建空壳或询问补充，不能自行编写需求、范围、验收标准或任务拆分。
- 自动提交时机：research / spec+task 完成时、task 对应 coding 完成时、每次修复完成时，都要自动提交。
- `npm run dev` 是最常用的本地 Web 开发指令，固定监听 `127.0.0.1:3030`。已运行时不要主动关闭或重启；遇到端口阻塞时先确认进程归属，再按需重启。
- 网站部署路由：用户提出“部署、上线、重新部署、更新线上站点”等请求时，必须读取并使用 `.agents/skills/dmg-dual-deploy/SKILL.md`。`dmgendfield.cloud` 是唯一维护中的应用，默认只部署国内服务器；海外 Sites 已退役，只保留同路径跳转、PWA 迁移端点和历史分享 API，只有用户明确要求修复或更新海外退役兼容层时才部署 Sites。
- 资源发包路由：用户提出“发数据包、发资源包、更新线上资料”等请求时，资源只发布到国内服务器的统一稳定通道，不得上传 GitHub Release，也不得重建海外完整应用；海外旧资源 URL 由退役 Worker 同路径跳转国内。发布过程同样必须读取并使用 `.agents/skills/dmg-dual-deploy/SKILL.md`。资源版本固定使用本次实际打包时的北京时间，格式为 `YYYYMMDD.HHmmss.<内容哈希>`；Share Data 的 `exportedAt` 只保留为来源信息，严禁再用作对外版本日期或时间。
