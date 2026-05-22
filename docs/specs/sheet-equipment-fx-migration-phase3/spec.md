# Sheet Equipment FX 与 imgUrl 迁移 Phase 3 Spec

## Why

Sheet Equipment 已具备基础 CRUD、资源管理器、层级折叠、局部装备视图和配图选择器，但单元格选中后的 fx 行为还需要被规格化，否则后续继续开发时容易出现：

- 某些单元格可在表格内编辑，但 fx 行为不一致。
- `description` 字段同时承载普通描述、raw 文本和 `imgUrl`，需要按行类型区分。
- `imgUrl` 已有字段和配图选择器，但迁移完成标准不明确。
- 旧 Phase 2 spec 中仍包含 Lv 自动补全要求，已不符合当前决策。

本阶段目标是把 Sheet Equipment 的 fx 交互定义为稳定契约，并把 `imgUrl` 迁移视为完成项。

## What Changes

- 明确单元格选中后 fx 栏展示的控件类型。
- 明确 fx 栏提交、取消、清空、只读行为。
- 明确 `imgUrl` 字段只在 `gear-set` 和 `equipment` 行的 `description` 单元格中使用图片搜索选择器。
- 明确 `fixedStat.description` 和 `effect.description` 仍为 raw/说明文本，不使用图片选择器。
- 明确 Lv0-Lv3 不再提供任何自动补全动作。
- 明确 `imgUrl` 迁移完成标准：数据模型、初始 JSON、运行时编辑、保存、分享导入导出均支持 `imgUrl`。

## Reference Behavior

Sheet Equipment SHALL 参考 Sheet-Weapon 的以下模式：

- `selectedWorkbookCell` 作为唯一单元格选择状态。
- `formulaBinding` 根据当前行类型和列类型生成 fx 控件。
- 图片字段使用 `image-search-select`，并复用 `imageBridge.listAssets()`、`getUserImageUrl()`、`resolvePublicPath()`。
- 图片选择器使用 Sheet-Weapon 的 `weapon-sheet-image-formula-*` 样式族，保持一致体验。

## Requirements

### Requirement: 单元格选中状态

系统 SHALL 在用户点击表格单元格时记录当前单元格。

#### Scenario: 选中普通单元格

- WHEN 用户点击任意普通单元格
- THEN 当前单元格高亮
- AND 当前行高亮
- AND fx 地址显示该单元格地址
- AND fx 输入区域显示该单元格绑定值

#### Scenario: 选中 effectLevels 内联等级格

- WHEN 用户点击 Lv0/Lv1/Lv2/Lv3 内联输入
- THEN fx 地址显示对应 Lv
- AND fx 输入区域绑定到对应 `effect.levels[levelKey]`

### Requirement: fx 控件矩阵

系统 SHALL 按行类型和列类型生成稳定的 fx 控件。

| 行类型 | 列 | fx 控件 | 写回字段 |
| --- | --- | --- | --- |
| set | name | text input | `gearSet.name` |
| set | idText | readonly | `gearSet.gearSetId` |
| set | effectKey | text input | `gearSet.buffId` |
| set | description | image-search-select | `gearSet.imgUrl` |
| equipment | name | text input | `equipment.name` |
| equipment | idText | readonly | `equipment.equipmentId` |
| equipment | field | select | `equipment.part` |
| equipment | description | image-search-select | `equipment.imgUrl` |
| fixedStat | name | text input | `fixedStat.label` |
| fixedStat | effectKey | select | `fixedStat.typeKey` |
| fixedStat | valueText | number input | `fixedStat.value` |
| fixedStat | description | text input | `fixedStat.raw` |
| effect | name | text input | `effect.label` |
| effect | field | select | `effect.category` |
| effect | effectKey | search-select | `effect.typeKey` |
| effect | valueText | select/text compatible unit editor | `effect.unit` |
| effect | description | text input | `effect.raw` |
| effectLevels | Lv0-Lv3 | number input | `effect.levels['0'...'3']` |

#### Scenario: set/equipment 配图

- WHEN 用户选中 set 或 equipment 行的 description 单元格
- THEN fx 栏显示图片搜索选择器
- AND 选择图片后写入对应 `imgUrl`
- AND 点击无图后清空对应 `imgUrl`

#### Scenario: raw/说明文本

- WHEN 用户选中 fixedStat 或 effect 行的 description 单元格
- THEN fx 栏显示普通文本输入
- AND 不显示图片搜索选择器

### Requirement: 图片搜索选择器

系统 SHALL 复用 Sheet-Weapon 的图片选择体验。

#### Scenario: 加载图片资源

- WHEN Sheet Equipment 页面初始化
- THEN 系统调用 `imageBridge.listAssets()`
- AND 将文件资源转为图片选项
- AND 过滤目录项
- AND builtin 图片通过 `resolvePublicPath()` 生成 URL
- AND user 图片通过 `getUserImageUrl()` 生成 URL

#### Scenario: 搜索图片

- WHEN 用户在 fx 图片搜索框输入关键词
- THEN 系统按文件名、baseName、路径、displayUrl、来源搜索
- AND 下拉结果显示缩略图、文件名、路径、来源

#### Scenario: 关闭图片下拉

- WHEN 用户点击图片选择器外部
- THEN 图片下拉关闭
- WHEN 用户按 Escape
- THEN 图片下拉关闭

### Requirement: fx 提交与取消

系统 SHALL 统一 fx 编辑行为。

- Enter SHALL 提交当前 fx 输入。
- blur SHALL 提交当前 fx 输入。
- Escape SHALL 恢复原值并取消当前输入。
- select/search-select/image-search-select 选择后 SHALL 立即写回。
- 输入框内部 SHALL 拦截方向键、Backspace、Delete、Tab、Enter、Escape，避免误触发表格导航。

### Requirement: 清空行为

系统 SHALL 限制危险清空。

- idText SHALL 只读，不允许清空。
- equipment.field SHALL 不允许清空，只能选择护甲、护手、配件。
- set/equipment description 的清空 SHALL 清空 `imgUrl`。
- fixedStat/effect description 的清空 SHALL 清空 raw 文本。
- Lv0-Lv3 单格清空 SHALL 删除对应 level key。

### Requirement: 禁用 Lv 自动补全

系统 SHALL 禁用 Lv0-Lv3 自动补全能力。

#### Scenario: 右键 effect/effectLevels

- WHEN 用户右键 effect 或 effectLevels
- THEN 菜单 SHALL NOT 展示 `Lv0 复制到 Lv1-Lv3`
- AND 菜单 SHALL NOT 展示 `按 Lv0/Lv3 补全`
- AND 系统代码 SHALL NOT 保留未使用的补全 helper

### Requirement: 当前装备展开

系统 SHALL 在单元格区域右键菜单提供当前装备范围展开动作。

#### Scenario: 当前装备展开

- WHEN 用户在 equipment、fixedStat、effect、effectLevels 行右键
- THEN 菜单展示 `全部展开当前装备`
- WHEN 用户点击该动作
- THEN 系统只展开当前装备
- AND 展开当前装备下所有 effect 的 effectLevels
- AND 不展开同套装的其他装备

### Requirement: imgUrl 迁移完成标准

系统 SHALL 将 `imgUrl` 作为已完成迁移字段处理。

#### Scenario: 数据模型

- WHEN 系统读取 equipment JSON
- THEN `gearSet.imgUrl` 和 `equipment.imgUrl` SHALL 被保留
- AND 缺失时归一为空字符串

#### Scenario: 初始 JSON

- WHEN `public/data/equipments/equipments.json` 被加载
- THEN 每个 gearSet SHALL 允许存在 `imgUrl`
- AND 每个 equipment SHALL 允许存在 `imgUrl`
- AND 页面运行时不依赖 `docs/装备.txt` 补充图片字段

#### Scenario: 保存

- WHEN 用户通过 fx 图片选择器修改 `imgUrl`
- THEN localStorage 中的 `def.equipment-sheet.draft.v1` SHALL 同步更新
- AND 桌面端保存 SHALL 写入 `public/data/equipments/equipments.json`

#### Scenario: 分享

- WHEN 用户导出当前套装或全部装备库
- THEN 导出的 JSON SHALL 包含 gearSet/equipment 的 `imgUrl`
- WHEN 用户导入分享 JSON
- THEN `imgUrl` SHALL 被保留并可继续编辑

## Acceptance Criteria

### AC1: fx 控件矩阵完整

- set/equipment/fixedStat/effect/effectLevels 的可编辑列均有对应 fx 控件。
- 不可编辑列在 fx 中只读。
- fx 修改后数据即时写回并标记未保存。

### AC2: 配图 fx 正确

- 选中 set.description 时，fx 编辑 `gearSet.imgUrl`。
- 选中 equipment.description 时，fx 编辑 `equipment.imgUrl`。
- fixedStat.description 和 effect.description 不触发图片选择器。

### AC3: 图片资源选择

- 图片搜索下拉可以搜索 builtin/user 图片。
- 选择图片后单元格值、fx 值、内存数据一致。
- 清空图片后对应 `imgUrl` 为空字符串。

### AC4: Lv 补全禁用

- effect/effectLevels 右键菜单不存在 Lv 自动补全入口。
- 代码中不存在未使用的 Lv 补全 helper。

### AC5: 当前装备展开

- 在任意当前装备相关行右键，可执行 `全部展开当前装备`。
- 执行后只展开当前装备及其 effectLevels。
- 同套装其他装备保持原折叠状态。

### AC6: imgUrl 迁移完成

- `public/data/equipments/equipments.json` 能保存并重新加载 `imgUrl`。
- localStorage 草稿能保存并恢复 `imgUrl`。
- 导入导出 JSON 能保留 `imgUrl`。
- 页面运行时不读取 `docs/装备.txt` 来补充 `imgUrl`。
