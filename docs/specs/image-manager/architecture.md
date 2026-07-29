# 浏览器图片管理架构

## 状态

已实现。图片管理是纯浏览器能力，不依赖桌面文件系统或 localhost bridge。

## 两类图片

| 类型 | 存储 | 权限 |
| --- | --- | --- |
| 官方图片 | 版本化 ZIP → SHA-256 → Cache Storage | 只读，可整包删除重装 |
| 用户图片 | SQLite `image_assets` BLOB | 可导入、重命名、分目录、删除 |

`public/web-image-manifest.json` 同时定义安装文件集合和图片管理索引来源，避免文件数、路径和显示清单漂移。

## 路径

- 官方和用户逻辑路径统一为 `assets/images/...`。
- 官方 URL 由 Service Worker/Cache Storage 提供同源响应。
- 用户 BLOB 在启动时创建 object URL，并按逻辑路径解析。
- 新引用不保存 `blob:` URL；它们只在当前页面生命周期有效。
- 路径必须拒绝空段、`.`、`..`、绝对路径和不支持的扩展名。

## 写入

`imageBridge.ts` 是页面唯一入口：

- `listAssets`
- `importToDir`
- `createDirectory`
- `renameFile` / `renameDirectory`
- `deleteFile` / `deleteDirectory`

目录用 `inode/directory` marker row 表示；文件 BLOB 与 metadata 在 SQLite transaction/batch 中更新。官方路径永远不可写。浏览器没有“在访达中显示”能力。

## 备份

用户图片随完整 SQLite 导出；官方图片不进入数据库备份，可按 manifest 重新下载。

## 验证

- manifest 与 ZIP 559 个文件逐项 size/SHA 一致；
- 图片管理器显示 559 个官方资源与“浏览器可写”；
- 典型装备、干员、技能和百科半身图 `naturalWidth > 0`；
- 用户导入后刷新仍能显示，重命名/删除只影响用户行。
