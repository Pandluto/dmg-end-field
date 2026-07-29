# 安全边界

## 边界与控制

| 边界 | 当前控制 |
| --- | --- |
| 访问者 → Web UI | `zmd` 的客户端校验结果保存 30 天 |
| 标签页 → 用户数据库 | Web Locks 独占写租约；BroadcastChannel 协调占用与接管 |
| 应用 → OPFS | Worker 内 SQLite、严格表、外键、事务与 revision/CAS |
| 资源包 → Cache Storage | manifest schema、大小、SHA-256、ZIP 文件集合 |
| 导入文件 → 数据库 | 文件类型、schema、路径、大小与 payload 校验 |
| Git tag → Web 产物 | 锁依赖、质量门、自包含静态构建、checksum、Draft Release |

## 明确不提供的保证

- `zmd` 和其校验逻辑都发往浏览器，因此只能阻挡普通误访问，不能防止有意绕过。
- 浏览器配置、操作系统账户或同源恶意脚本被攻破后，本应用不能提供额外机密性。
- 单写入协议保护正常标签页协作，不是跨恶意脚本的安全锁。
- 没有账号、云同步、服务端备份、远程注销或审计服务。

公开部署必须使用 HTTPS，并在需要真实访问控制时增加服务端网关。浏览器站点数据的备份与清理由用户负责。依赖与报告策略见根目录 [SECURITY.md](../../SECURITY.md)。
