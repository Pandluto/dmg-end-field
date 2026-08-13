# 服务器资源通道 · Web LTS 合同

## 状态

已实现（2026-08-14 依据代码现状补写）。本规格描述 1.8 Web LTS 当前生效的服务器资源通道契约；架构背景见 [资源交付](../architecture/resource-delivery.md)。

## 目标

官方数据与图片通过同源服务器资源通道交付，客户端只访问当前站点同源路径。发布以"稳定指针 → 版本总清单 → 数据/图片清单"三级绑定，任何一级都使用 SHA-256 校验，避免把两个发布版本拼在一起。

## 发布结构

```text
resources/stable.json                          # 唯一可变稳定通道指针（禁止缓存）
resources/releases/<releaseVersion>/
  resource-release-manifest.json              # 版本总清单（deployment manifest）
  web-data-manifest.json                      # 数据清单
  web-image-manifest.json                     # 图片清单
  data/default-local-data.json                # 标准数据（Share Data 整理产物）
  packages/<archive>.zip.part-001...          # 图片 ZIP 4 MB 分片（区域可选）
assets/images/...                             # 移动端同源逐图（版本查询参数 + 强制重新验证）
packages/                                     # 可清理的旧分片/压缩包残留
# 根目录兼容别名（旧页面稳定版）
web-data-manifest.json  web-image-manifest.json  data/default-local-data.json
```

## 清单契约

- `dmg.resource-channel.v1`（`resources/stable.json`）：`channel: 'stable'`、`releaseVersion`、`publishedAt`、`releaseManifest`（带 SHA-256 的指针）。
- `dmg.resource-deployment.v1`（版本目录内 `resource-release-manifest.json`）：`releaseVersion`、`rootSha256`、`source`（Share Data 文件名、archiveId、exportedAt）、`data`（版本 + 文件描述符 + 干员/武器/图片数量摘要）、`images`（版本、总字节、indexSha256、归档描述符、逐文件描述符）、`delivery`（数据清单与图片清单指针）。
- `dmg.resource-release.v1`：资源发布 ZIP 内的总清单，是 deployment manifest 的来源。
- 数据清单（`schemaVersion: 1`、`packageId: 'dmg-end-field-core-data'`）：`files` 至多 16 项，每项含 `path`、`sha256`、`size` 与可选 `downloadPath`；`totalBytes` ≤ 64 MB；`releaseVersion` 必须等于通道版本。
- 图片清单（`schemaVersion: 1`、`packageId: 'dmg-end-field-image-pack'`）：`files` 逐图描述符、`archive`（ZIP 描述符 + 可选 `parts` 分片列表，单分片 ≤ 25 MB）、`publicBasePath: 'assets/images'`、`releaseTag`。

## 打包

- 输入：一份完整 Share Data（`def.localdata.archive.v1`）与图片目录。
- 只提取四个官方资料库：`def.operator-editor.library.v1`、`def.weapon-sheet.library.v1`、`def.equipment-sheet.library.v1`、`def.buff-editor.library.v1` 与共享排轴。
- 干员 ≥ 30、武器 ≥ 75 才视为完整；缺库直接失败。
- 图片路径归一化：支持 `assets/images/`、`images/`、直接根三种目录形态；旧 `assets/avatars/`、`user-images/`、`public/images/` 引用会被重映射或拒绝（废弃路径直接报错）。
- 每个数据文件与每张图片计算 SHA-256；版本号由 Share Data 导出日期与内容根哈希确定性生成，均为 `YYYYMMDD.<hash 前缀>` 形态（无时分秒）：`releaseVersion = <exportedAt 日期>.<rootSha256 前 12 位>`、`dataVersion = <日期>.<dataSha256 前 8 位>`、`imageVersion = <日期>.<imageIndexSha256 前 12 位>`（见 resourceReleasePackager）。
- 产物：`dmg-resource-release-<version>.zip`（仅含 manifest、`data/default-local-data.json` 与完整图片 ZIP）。
- 命令行入口：`npm run resource:build -- --share-data <json> --images <dir> --output <dir>`；构建后强制 `resource:verify` 自校验。浏览器入口：本地 `#/settings/resource-packager`。

## 物化（materialize）

`npm run resource:materialize -- --bundle <zip> --public public` 将发布 ZIP 展开为站点产物：

1. 校验 ZIP（`resourceReleaseVerifier`）后清理 `resources/releases/`、`assets/images/` 与旧包残留（只动资源目录，不碰应用壳）。
2. 图片 ZIP 按 4 MB 切分写入版本目录 `packages/`。
3. 写版本目录内 data、数据清单、图片清单、deployment manifest 与根目录别名。
4. 写 `resources/stable.json` 指向新版本。
5. 为移动端物化 `assets/images/` 逐图与浏览器图片索引（含 `source: 'release'` 只读根）。

## 客户端策略

- 桌面端：读 `stable.json`（30 秒上下文缓存，可 `fresh` 强制刷新；404 时回退根别名清单）→ 逐级 SHA-256 校验 → 下载数据与图片包写入 Cache Storage（`dmg-resource-pack-v1` / `dmg-image-pack-v1`）→ SQLite `data_packages` / 图片包安装记录记版本。安装失败不写完成标记，残留可被下次覆盖。
- 下载 URL 追加内容哈希查询参数（如 `?sha256=<hash>`），防止陈旧缓存命中；校验失败即失败，不降级。
- 图片包：先下载 ZIP 分片；若当前站点未部署分片（404），自动回退按清单逐文件下载（8 路并发），逐文件 SHA-256 后写入同一缓存。
- 缓存恢复：Cache Storage 键集合与清单完全一致才视为已安装；不一致（如 Service Worker 被清）时走恢复流程重新安装。
- 首次使用且无任何正式资料时才自动应用标准数据；之后必须用户明确点击应用，不自动覆盖当前资料。

## 服务端缓存（Cloudflare Worker）

- `/resources/releases/*`：成功响应 `public, max-age=31536000, immutable`；失败 `no-store`；HTML 回退一律 404。
- `/assets/images/*`：`public, max-age=0, must-revalidate`。
- `/resources/stable.json`、各清单别名、`/version.json`、`/sw.js`、导航与 HTML：`no-store, no-cache, must-revalidate`。

## 发布与回滚

- 物化后随同一源码提交构建国内、海外产物；两路都通过原子版本切换上线，任何一路失败保留或恢复旧版本。
- 旧 Sites 版本与国内时间戳目录是回滚点；用户 SQLite 与 Share Data 不参与静态发布。
- 海外 Sites 云端重建：先按版本清单从国内源站取不可变分片并校验 SHA-256，再生成海外逐图产物；不读 GitHub Release，不接受错版本内容。
