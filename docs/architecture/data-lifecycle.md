# 数据生命周期

## 存储分区

| 数据 | 位置 | 删除/恢复 |
| --- | --- | --- |
| 排轴文档、快照、Work Node、checkout、审计 | SQLite WASM / OPFS | 设置页导出或导入完整数据库 |
| 角色配置、编辑库与工作台投影 | 同一 SQLite 数据库 | 随数据库备份 |
| 自定义图片 | SQLite `image_assets` BLOB | 随数据库备份 |
| 官方 JSON 资料 | Cache Storage + `data_packages` 安装记录 | 可删除并重新下载 |
| 官方图片 | Cache Storage + 图片包安装记录 | 可删除并重新下载 |
| 30 天门禁 | 浏览器站点存储 | 到期或设置页退出后重新输入 |

## 首次安装

```text
用户确认
  → 获取同源 manifest
  → 下载 JSON 文件与图片 ZIP
  → 校验文件大小和 SHA-256
  → 图片在内存解压并逐文件校验
  → 写入 Cache Storage
  → SQLite 记录已安装版本
  → 进入开始页
```

安装失败不会写入完成标记；残留缓存可由下一次安装覆盖。官方资料更新与用户数据库相互独立。

## 工作区写入

Timeline mutation 在事务中检查 document identity、checkout 和 `contentRevision`。Work Node 更新使用 CAS 拒绝过期写入；应用 checkout 后才更新当前工作区投影。第二标签页默认只显示占用页，显式接管后才初始化写连接。

## 数据流转

- 导出：设置页先刷新持久存储，再导出当前 SQLite 数据库文件。
- 导入：用户选择备份，校验后替换浏览器数据库并重新启动应用。
- 分享：排轴 bundle 对 payload、父子节点和本地路径做校验，不等同于完整数据库备份。
- 清理浏览器站点数据会删除私人数据；用户应先导出备份。

旧桌面数据库、AppData 和 SQLite 文件不参与自动探测或迁移。
