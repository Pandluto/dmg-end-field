# 安全边界

## 保护对象

- 用户的 SQLite 工作区、完整数据包、排轴存档与浏览器资料投影；
- renderer capability 与 loopback bridge；
- 数据和图片 Release 的完整性；
- Git tag、安装包与 checksum。

## 当前控制

| 边界 | 控制 |
| --- | --- |
| 浏览器 → 本地 bridge | loopback、Origin/Referer 校验、随机 capability |
| bridge → SQLite | 固定路由、输入校验、事务、外键与 revision/CAS |
| 网络 → Share Data | manifest schema、大小、SHA-256、ZIP allowlist、原子替换 |
| 用户 → 删除/应用 | 显式选择；数据包、存档与工作区不隐式级联 |
| Git tag → 安装包 | 版本一致、质量门、跨平台构建、SHA256SUMS、Draft Release |

历史 `def.*` key 与旧合同名不包含授权信息。不要把 userData、capability 文件、完整用户数据或机器绝对路径提交到仓库。

已知边界与依赖风险按根目录 [SECURITY.md](../../SECURITY.md) 处理。
