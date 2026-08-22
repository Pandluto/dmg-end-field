# 统一资源发包、服务器通道与交接

`dmgendfield.cloud` 是唯一维护中的应用与资源源站。Desktop Shell 负责制作发布输入，Slimming 负责物化和上线；GitHub Release 不再承载生产数据或图片。

## 有效输入

一次资源发布必须同时选择：

1. 从“本地数据 / Share Data”导出的完整 `def.localdata.archive.v1` JSON；
2. 包含 `assets/images`、`images` 或直接图片根的目录。

员工增量或编辑器单库导出（例如 `operator-library-share.v1`）不是完整发布输入。应先在 Desktop 工作台合并这些资料，再重新导出全量 Share Data。

## Desktop Shell 生成

运行：

```bash
npm run electron:dev
```

在 Shell 的“国内统一资源包”区域选择 Share Data、图片目录和输出目录。工具会校验四个正式资料库、共享排轴和图片引用，并生成：

```text
<output>/<releaseVersion>/
├── dmg-resource-release-<releaseVersion>.zip
└── dmg-resource-release-<releaseVersion>.manifest.json
```

命令行使用同一实现：

```bash
npm run resource:build -- \
  --share-data <share-data.json> \
  --images <image-directory> \
  --output <output-directory>

npm run resource:verify -- <dmg-resource-release-*.zip>
```

版本格式固定为 `YYYYMMDD.HHmmss.<内容哈希>`，时间来自本次实际打包时的北京时间。Share Data 的 `exportedAt` 只保留在 manifest 的来源字段中。

## ZIP 合同

统一 ZIP 只包含：

- `resource-release-manifest.json`；
- `data/default-local-data.json`；
- 一个完整图片 ZIP。

清单绑定标准数据、每张图片、图片索引和内部图片 ZIP 的体积与 SHA-256。校验器同时限制文件数、解压体积、路径穿越、重复条目、符号链接和额外文件。

## 交给 Slimming 上线

1. 保留 Desktop 分支中的资料制作与发包提交。
2. 在干净的 `codex/v1.8-lts-slimming` 工作树中再次运行 `resource:verify`。
3. 使用 Slimming 的 `resource:materialize` 将 ZIP 物化到 `public/`。
4. 提交并推送 Slimming 的资源状态。
5. 按 `.agents/skills/dmg-dual-deploy/SKILL.md` 构建并部署国内服务器。

不要在 Desktop 分支物化生产资源，不要从 Desktop 构建网站上线，也不要重建已退役的海外完整应用。只有用户明确要求修复海外跳转、PWA 迁移端点或历史分享 API 时，才更新海外兼容层。
## 服务器稳定通道

官方数据与图片不再从 GitHub Release 读取。`dmgendfield.cloud` 是唯一维护中的资源源站；旧海外资源 URL 保留路径与查询参数，永久跳转到国内域名。

### 发布结构

- `resources/stable.json`：唯一可变的稳定通道指针，禁止缓存。
- `resources/releases/<releaseVersion>/resource-release-manifest.json`：当前版本总清单。
- 同一版本目录中的数据清单、图片清单、标准数据和 4 MB 图片分片：不可变缓存。
- 根目录 `web-data-manifest.json`、`web-image-manifest.json` 和 `data/default-local-data.json`：兼容旧页面的稳定版别名。
- `assets/images/`：移动端同源图片文件，使用图片版本查询参数并强制重新验证。

稳定指针先绑定一个总清单；总清单再用 SHA-256 绑定数据与图片清单，因此客户端不会把两个发布版本拼在一起。

### Web 制作入口

本机运行 `npm run dev` 后打开：

`http://127.0.0.1:3030/#/settings/resource-packager`

选择图片目录和一份完整 Share Data。工具会：

1. 识别 `assets/images`、`images` 或直接图片根目录；
2. 只提取干员、武器、装备、Buff 正式资料库和共享排轴；
3. 校验资料中的图片引用；
4. 为数据、每张图片和图片 ZIP 计算 SHA-256；
5. 根据实际打包时的北京时间与内容根哈希生成版本号；
6. 下载一个 `dmg-resource-release-<version>.zip`。

发布 ZIP 只包含 `resource-release-manifest.json`、`data/default-local-data.json` 和一个完整图片 ZIP。把这一个文件交给 Codex 即可。

命令行提供同一套实现：

```bash
npm run resource:build -- --share-data <share.json> --images <image-directory> --output .runtime/resource-releases
npm run resource:verify -- .runtime/resource-releases/dmg-resource-release-<version>.zip
npm run resource:materialize -- --bundle .runtime/resource-releases/dmg-resource-release-<version>.zip --public public
```

### 客户端策略

- 桌面端：发现并下载服务器最新版本，验证后保存为带版本号的 Share Data；不会自动覆盖当前资料。首次使用且没有任何正式资料时才自动应用，之后必须由用户明确点击应用。
- 移动端：每次进入读取稳定通道，强制使用同一个最新数据/图片版本；标准数据下载后执行真实 SHA-256 校验。
- 国内 HTTP 移动端：Web Crypto 不可用时使用内置 SHA-256 实现，仍会完成同等内容校验。
- 图片交付：国内站点提供图片 ZIP 分片和清单中的独立图片文件。桌面端先尝试分片，分片不可用时自动以 8 路并发下载同一批文件，最终都按逐文件 SHA-256 写入相同浏览器缓存。
- 海外兼容：Sites 不再重建资源产物；旧 `/resources/*`、`/assets/*` 与清单 URL 同路径跳转到国内源站。

### 发布与回滚

版本格式固定为 `YYYYMMDD.HHmmss.<内容哈希>`。日期和时间必须来自本次实际打包时的北京时间；Share Data 的 `exportedAt` 只作为来源记录，不得用于对外版本命名。内容根 SHA-256 继续负责完整性校验和内容判重。

资源物化后随源码提交构建国内产物，并通过国内服务器的原子目录切换上线；失败时恢复上一时间戳目录。海外 Sites 退役版本保持不变，用户 SQLite 与 Share Data 不参与静态发布。
