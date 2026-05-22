# Sheet Equipment FX 与 imgUrl 迁移 Phase 3 Tasks

## Status

本任务拆分用于验证并收口 Phase 3 的 fx 与 imgUrl 迁移行为。

## Tasks

- [ ] 对照 fx 控件矩阵检查 `formulaBinding` 分支。
- [ ] 确认 set.description 绑定 `gearSet.imgUrl`，并使用 `image-search-select`。
- [ ] 确认 equipment.description 绑定 `equipment.imgUrl`，并使用 `image-search-select`。
- [ ] 确认 fixedStat.description 仍绑定 `fixedStat.raw`，使用普通文本输入。
- [ ] 确认 effect.description 仍绑定 `effect.raw`，使用普通文本输入。
- [ ] 确认图片资源通过 `imageBridge.listAssets()` 加载，过滤目录项。
- [ ] 确认 builtin 图片 URL 使用 `resolvePublicPath()`，user 图片 URL 使用 `getUserImageUrl()`。
- [ ] 确认图片搜索支持 fileName、baseName、relativePath、displayUrl、source。
- [ ] 确认选择图片立即写回对应 `imgUrl`，并标记未保存。
- [ ] 确认“无图”清空对应 `imgUrl`。
- [ ] 确认图片下拉支持点击外部关闭和 Escape 关闭。
- [ ] 确认 Enter、blur、Escape、方向键等 fx 输入行为与表格导航不冲突。
- [ ] 确认 effect/effectLevels 右键菜单不再出现 Lv 自动补全动作。
- [ ] 确认代码中不存在未使用的 Lv 自动补全 helper。
- [ ] 确认单元格右键菜单提供 `全部展开当前装备`。
- [ ] 确认 `全部展开当前装备` 只展开当前装备及其 effectLevels，不展开同套装其他装备。
- [ ] 确认 `public/data/equipments/equipments.json` 读取、保存均保留 gearSet/equipment 的 `imgUrl`。
- [ ] 确认 `def.equipment-sheet.draft.v1` localStorage 草稿保留 gearSet/equipment 的 `imgUrl`。
- [ ] 确认导出当前套装、导出全部、导入分享 JSON 均保留 `imgUrl`。
- [ ] 运行 `npm run build`。
