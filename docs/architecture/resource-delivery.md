# 统一资源发包与交接

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
