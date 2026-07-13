# Sheet Equipment 装备管理页 Spec

## Why

项目需要一个统一的装备管理页面，用于维护装备数据，并在后续角色配置面板中复用。装备数据初始来源为 [`reference/source-gear-data.txt`](./reference/source-gear-data.txt)，但页面运行时不依赖该文本文件。

页面必须延续现有 Sheet-Buff / Sheet-Weapon 的 sheet page 风格，保持一致的工具栏、资源管理器、右键菜单、表格编辑和分享体验。

## What Changes

- 新增 `/sheet-equipment` 页面。
- 新增装备数据源：`public/data/equipments/equipments.json`。
- 新增本地草稿缓存：`def.equipment-sheet.draft.v1`。
- 从 `reference/source-gear-data.txt` 一次性迁移生成装备 JSON。
- 页面运行时以本地 JSON 为主，localStorage 为辅助。
- 保存时同时写入本地 JSON 和 localStorage。
- 如果本地 JSON 与 localStorage 不一致，提示用户选择使用本地 JSON 或本地草稿。
- 顶部工具栏复制 Sheet-Weapon / Sheet-Buff 的 6 个 SVG 按钮风格与顺序：新建、保存、整理、保护开/关、导出、导入。
- 实现允许复制 Sheet-Weapon / Sheet-Buff 的页面结构，但 Equipment 必须使用独立类型、独立 storage key、独立 share type，避免业务耦合。

## Data Model

装备数据层级：

```txt
套装 -> 装备 -> 固定数值 / effect1-3 -> Lv0-Lv3 数值
```

套装字段：

```ts
interface EquipmentGearSet {
  gearSetId: string;
  name: string;
  buffId?: string;
  imgUrl?: string;
  equipments: Record<string, EquipmentItem>;
}
```

装备字段：

```ts
interface EquipmentItem {
  equipmentId: string;
  name: string;
  part: '护甲' | '护手' | '配件';
  fixedStat?: EquipmentFixedStat;
  effects: Partial<Record<'effect1' | 'effect2' | 'effect3', EquipmentEffect>>;
}
```

固定数值字段：

```ts
interface EquipmentFixedStat {
  label: string;
  typeKey: 'defense' | 'hp' | 'flatAtk';
  value: number;
  unit: 'flat' | 'percent';
  raw?: string;
}
```

增益字段：

```ts
interface EquipmentEffect {
  effectId: 'effect1' | 'effect2' | 'effect3';
  label: string;
  typeKey: string;
  category: 'ability' | 'buff';
  levels: {
    '0'?: number;
    '1'?: number;
    '2'?: number;
    '3'?: number;
  };
  unit: 'flat' | 'percent';
  raw?: string;
}
```

## Requirements

### Requirement: 路由

系统 SHALL 提供 `/sheet-equipment` 页面。

### Requirement: Sheet 风格一致性

系统 SHALL 高度复用 Sheet-Weapon / Sheet-Buff 的视觉和交互风格。

#### Scenario: 工具栏一致

- WHEN 用户打开 Sheet Equipment
- THEN 顶部工具栏展示 6 个 SVG 按钮
- AND 按钮顺序为：新建、保存、整理、保护开/关、导出、导入
- AND 按钮 class、尺寸、hover、active 视觉与 Sheet-Weapon 保持一致

### Requirement: 解耦式复制复用

系统 SHALL 允许复制 Sheet-Weapon / Sheet-Buff 的页面结构，但 Equipment 页面 SHALL 使用独立业务模型。

#### Scenario: 业务解耦

- WHEN 实现 Sheet Equipment
- THEN 不直接复用 Weapon/Buff 的 draft 类型
- AND 不共享 Weapon/Buff 的 storage key
- AND 不把 Equipment CRUD 写入 Weapon/Buff 页面
- AND 可以复用通用工具函数、CSS class、share helper、路由 helper

### Requirement: 装备资源管理器

系统 SHALL 在左侧资源管理器中展示：

```txt
套装
  装备
    固定数值
    effect1
    effect2
    effect3
```

### Requirement: 表格编辑

系统 SHALL 模仿 Sheet-Weapon 的灵活等级编辑模式。

#### Scenario: 可升级 effect

- WHEN 装备 effect 有 Lv0-Lv3 数值
- THEN 表格使用内联等级编辑格展示 Lv0、Lv1、Lv2、Lv3
- AND 用户可直接编辑各等级数值

#### Scenario: 固定数值

- WHEN 装备存在固定数值
- THEN 表格显示固定值
- AND 不展示 Lv0-Lv3 编辑格

### Requirement: 数量限制

系统 SHALL 限制每件装备最多 1 个 fixedStat，最多 3 个 effect。

### Requirement: 部位枚举

系统 SHALL 只允许装备部位为：护甲、护手、配件。

### Requirement: typeKey 映射

系统 SHALL 复用 Sheet-Buff 的 buff type key。

#### Scenario: 中文属性迁移

- WHEN 从 `reference/source-gear-data.txt` 迁移属性
- THEN 系统尝试把中文 label 映射为 typeKey
- AND 能力值映射为 strengthBoost、agilityBoost、intelligenceBoost、willBoost 等
- AND buff 类属性映射为 physicalDmgBonus、ultimateDmgBonus、sourceSkillBoost 等
- AND 无法识别时保留中文 label，typeKey 留空
- AND 迁移完成后提醒用户需要人工复核映射结果

### Requirement: 套装 buffId

系统 SHALL 允许套装 buffId 为空。

#### Scenario: buffId 为空

- WHEN 用户保存 buffId 为空的套装
- THEN 系统允许保存
- AND 给出 warning 提醒

### Requirement: 存储

系统 SHALL 以 `public/data/equipments/equipments.json` 为主数据源，以 localStorage 为辅助缓存。

#### Scenario: 保存

- WHEN 用户点击保存
- THEN 系统写入 `public/data/equipments/equipments.json`
- AND 同步写入 `def.equipment-sheet.draft.v1`

#### Scenario: Web 环境无法写文件

- WHEN 当前环境无法写入本地 JSON
- THEN 系统至少保存到 localStorage
- AND 提供导出 JSON 能力

### Requirement: 分享

系统 SHALL 支持导出当前套装、导出全部装备库、导入装备分享 JSON。

## Acceptance Criteria

### AC1: 页面可访问

- 访问 `/sheet-equipment` 时，系统展示 Sheet Equipment 页面。
- 页面标题、返回按钮、顶部工具栏、资源管理器、表格区域均正常渲染。

### AC2: 工具栏一致

- 顶部工具栏包含 6 个 SVG 按钮。
- 按钮顺序为：新建、保存、整理、保护开/关、导出、导入。
- 按钮样式、hover、active 状态与 Sheet-Weapon / Sheet-Buff 保持一致。

### AC3: 数据源初始化

- 首次打开页面时，系统能读取 `public/data/equipments/equipments.json`。
- 如果 localStorage 中没有草稿，则以本地 JSON 初始化页面数据。
- 页面运行时不读取 `reference/source-gear-data.txt`。

### AC4: localStorage 冲突处理

- 当本地 JSON 与 `def.equipment-sheet.draft.v1` 内容不一致时，系统提示用户选择使用本地 JSON 或本地草稿。
- 用户选择后，页面使用对应数据源初始化。

### AC5: 资源管理器层级

- 左侧资源管理器按以下层级展示：

```txt
套装
  装备
    固定数值
    effect1
    effect2
    effect3
```

- 点击套装、装备、固定数值、effect 节点时，表格能定位或展示对应行。

### AC6: 表格编辑

- 固定数值条目显示为单一数值，不展示 Lv0-Lv3。
- effect 条目展示 Lv0、Lv1、Lv2、Lv3 内联编辑格。
- 用户修改 Lv0-Lv3 任一值后，页面数据即时更新。

### AC7: 数据限制

- 每件装备最多只能存在 1 个 fixedStat。
- 每件装备最多只能存在 3 个 effect。
- effectId 只能是 `effect1`、`effect2`、`effect3`。
- 装备部位只能是 `护甲`、`护手`、`配件`。

### AC8: typeKey 复用

- effect 同时保存中文 `label` 和 Sheet-Buff 兼容的 `typeKey`。
- 能力值支持映射到 `strengthBoost`、`agilityBoost`、`intelligenceBoost`、`willBoost`。
- 无法识别的中文属性保留 label，typeKey 允许为空。
- 迁移完成后必须提示用户人工复核映射结果。

### AC9: 保存行为

- 点击保存时，桌面端环境写入 `public/data/equipments/equipments.json`。
- 同时写入 `def.equipment-sheet.draft.v1`。
- 如果当前环境无法写本地 JSON，至少保存 localStorage，并允许导出 JSON。

### AC10: 分享能力

- 支持导出当前套装 JSON。
- 支持导出全部装备库 JSON。
- 支持导入装备分享 JSON。
- 导入后能合并或覆盖同 ID 数据，并刷新资源管理器和表格。

### AC11: 迁移结果

- 从 `reference/source-gear-data.txt` 一次性迁移生成初始 JSON。
- 迁移后的装备保留套装、装备名、部位、图片、固定数值、effect 数值。
- 页面运行时不依赖 `reference/source-gear-data.txt`。

### AC12: 构建通过

- 执行 `npm run build` 必须通过。
