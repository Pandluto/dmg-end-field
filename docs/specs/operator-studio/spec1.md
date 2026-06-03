# Operator Studio Spec 1 - 页面功能与职责概述

## Why

`/operator-studio` 是当前项目中维护本地干员模板的独立页面。它负责把官方干员参考数据、本地手工编辑数据和运行时干员模板连接起来，是主界面选择本地干员、`OperatorConfigPage` 读取本地角色数据、伤害计算消费技能 hit 数据之前的上游编辑入口。

这份 Spec 1 只描述当前 `operator-studio` 页面已经承担的内容、功能流程、数据职责和边界。它不是新开发 spec，不定义新增功能，不要求改代码。后续如果要继续开发 `operator-studio`，应先基于本概述写 Spec 2，再进入具体需求、任务和实现。

## Page Identity

- 页面路由：`/operator-studio`
- 兼容别名：`/draft`、`/character-studio`
- 页面组件：`src/components/OperatorDraftPage.tsx`
- 页面样式：`src/components/OperatorDraftPage.css`
- 页面当前标题：`干员模板编辑器`
- 页面主要用途：编辑、导入、保存、分享本地干员模板
- 当前页面命名习惯：代码内多使用 `OperatorDraftPage`、`operator-draft`、`draft`

## Core Responsibility

`operator-studio` 的核心职责是维护本地干员模板草稿和本地干员库。

页面负责：

- 编辑干员基础信息。
- 编辑干员等级属性矩阵。
- 编辑干员技能列表。
- 编辑技能 hit 明细。
- 编辑 hit 在 `L1-L9 / M1-M3` 下的倍率。
- 从官方参考数据导入干员草稿。
- 从本地干员库导入已有草稿。
- 将当前草稿保存到本地干员库。
- 删除本地干员库条目。
- 导出当前草稿 JSON。
- 导出和导入整个本地干员库分享文件。
- 将本地干员数据提供给运行时模板适配器，供其他页面消费。

页面不负责：

- 配置角色当前装备、武器、潜能或战斗状态。
- 计算角色最终面板。
- 维护武器数据。
- 维护装备数据。
- 维护 Buff 数据。
- 写入官方角色 JSON。
- 直接替代主界面选人流程。
- 直接替代 `OperatorConfigPage` 的角色配置流程。

## Data Responsibility

`operator-studio` 维护两类本地数据。

当前编辑草稿：

```txt
localStorage['def.operator-editor.draft.v1']
```

本地干员库：

```txt
localStorage['def.operator-editor.library.v1']
```

本地干员库结构：

```ts
Record<string, OperatorDraft>
```

其中 key 通常为 `OperatorDraft.id`。

`OperatorDraft` 是页面的编辑和保存模型。运行时模板 `RuntimeOperatorTemplate` 是从 `OperatorDraft` 派生出来的消费模型，不是页面保存的主真相。

## Draft Shape

当前干员草稿包含以下顶层字段：

```ts
interface OperatorDraft {
  id: string;
  name: string;
  avatarUrl: string;
  rarity: number;
  profession: string;
  weapon: string;
  element: string;
  mainStat: string;
  subStat: string;
  level: number;
  attributes: OperatorDraftAttributeLevels;
  skills: Record<string, OperatorDraftSkill>;
}
```

基础字段含义：

- `id`：本地干员唯一标识，也是保存到本地库时的 key。
- `name`：展示名称。
- `avatarUrl`：头像资源路径。
- `rarity`：稀有度。
- `profession`：职业。
- `weapon`：武器类型文本。
- `element`：默认元素类型。
- `mainStat`：主能力。
- `subStat`：副能力。
- `level`：当前模板默认等级。
- `attributes`：等级属性矩阵。
- `skills`：技能集合。

## Attribute Matrix

属性矩阵按“属性类型 x 等级档位”组织。

属性类型：

```txt
strength / agility / intelligence / will / atk / hp
```

等级档位：

```txt
level1 / level20 / level40 / level60 / level80 / level90
```

结构：

```ts
type OperatorDraftAttributeLevels = Record<
  OperatorAttributeKey,
  Record<OperatorAttributeLevelKey, number>
>;
```

页面中的“基础数据”区域展示并编辑这张矩阵。

## Skill Model

技能以对象集合保存：

```ts
skills: Record<string, OperatorDraftSkill>
```

单个技能结构：

```ts
interface OperatorDraftSkill {
  displayName: string;
  buttonType: 'A' | 'B' | 'E' | 'Q';
  iconUrl: string;
  hitCount: number;
  hitMeta: Record<string, OperatorDraftHit>;
}
```

字段含义：

- `displayName`：技能显示名。
- `buttonType`：技能归类，映射到 `A / B / E / Q`。
- `iconUrl`：技能图标资源路径。
- `hitCount`：hit 数量，页面根据 `hitMeta` 同步。
- `hitMeta`：技能下属 hit 明细集合。

页面支持新增、复制、删除和拖拽排序技能。

## Hit Model

单个 hit 结构：

```ts
interface OperatorDraftHit {
  displayName: string;
  element: 'physical' | 'fire' | 'ice' | 'electric' | 'nature';
  skillType: 'A' | 'B' | 'E' | 'Q';
  levels: Record<SkillLevelKey, number>;
}
```

技能等级键：

```txt
L1 / L2 / L3 / L4 / L5 / L6 / L7 / L8 / L9 / M1 / M2 / M3
```

页面中的“Hit 细节”区域编辑：

- hit 名称。
- hit 伤害属性。
- hit 技能乘区。
- 每个技能等级下的倍率数值。

## Page Layout

当前页面按多列工作台组织。

左侧命令/导入列：

- 页面标题。
- 导出 JSON。
- 分享库。
- 参考数据导入。
- 从本地导入。
- 分享导入入口。
- 干员信息 markdown 预览。

左侧数据列：

- 基础数据。
- 覆盖保护开关。
- 整理。
- 新建。
- 另存为。
- 保存到本地。
- 基础字段编辑。
- 头像选择。
- 属性矩阵。
- 技能列表。

中间技能列：

- 当前选中技能预览。
- 技能名编辑。
- 技能按钮类型编辑。
- 技能图标编辑。
- 新增 hit。
- 删除 hit。
- hit 列表。

右侧 hit 列：

- 当前选中 hit 详情。
- hit 名称。
- `L1-L9 / M1-M3` 倍率矩阵。
- hit 伤害属性。
- hit 技能乘区。
- 命令输出。
- 页面跳转入口。

## Main User Flows

### Flow: 新建本地干员

1. 用户进入 `/operator-studio`。
2. 用户点击“新建”。
3. 页面创建默认 `OperatorDraft`。
4. 用户编辑基础字段、属性矩阵、技能和 hit。
5. 用户点击“保存到本地”或“另存为”。
6. 页面将草稿写入本地干员库。

### Flow: 从官方参考导入

1. 用户在“参考数据导入”中选择已有官方干员。
2. 用户点击“导入参考数据”。
3. 页面从官方角色数据构建干员草稿。
4. 页面把导入结果载入当前编辑器草稿。
5. 用户可继续手工编辑。
6. 只有用户保存后，结果才进入本地干员库。

### Flow: 从本地库导入

1. 用户在“从本地导入”中选择本地干员。
2. 用户点击“导入本地数据”。
3. 页面从 `def.operator-editor.library.v1` 读取对应草稿。
4. 页面把本地草稿载入当前编辑器。
5. 用户可继续编辑或保存覆盖。

### Flow: 保存到本地

1. 用户点击“保存到本地”。
2. 页面整理当前草稿结构。
3. 页面检查本地库是否已有同 id 条目。
4. 如果覆盖保护开启且存在同 id 条目，页面弹出覆盖确认。
5. 用户确认后，页面写入 `def.operator-editor.library.v1`。
6. 页面同步当前草稿缓存。
7. 页面输出保存结果消息。

### Flow: 另存为

1. 用户点击“另存为”。
2. 页面基于当前草稿生成新 id。
3. 页面将新 id 草稿写入本地干员库。
4. 页面保留原条目不变。

### Flow: 删除本地数据

1. 用户先导入某个本地干员。
2. 用户点击“删除本地数据”。
3. 页面弹出删除确认。
4. 用户确认后，页面从本地库删除该 id。
5. 当前编辑器内容不会因为删除本地库条目而自动清空。

### Flow: 导出当前 JSON

1. 用户点击“导出 JSON”。
2. 页面展示当前草稿 JSON。
3. 用户可以复制该 JSON。

### Flow: 分享本地干员库

1. 用户打开“分享库”。
2. 页面显示当前本地干员库条目数量。
3. 用户可以导出整个本地干员库为分享 JSON。
4. 用户也可以导入分享 JSON。
5. 导入分享 JSON 时，同 id 条目会覆盖本地库现有条目。
6. 覆盖前页面会展示确认信息。

## Normalization Flow

页面和适配器会对导入或编辑后的草稿做归一化。

归一化职责包括：

- 补齐缺失的属性等级矩阵。
- 将旧结构单值属性扩展为多等级属性。
- 补齐技能显示名。
- 补齐 hit 显示名。
- 将旧 hit 的 `multiplier` 迁移到 `levels`。
- 补齐 `L1-L9 / M1-M3` 倍率键。
- 删除旧结构中的 `multiplier` 字段。
- 同步 `hitCount`。

归一化后的草稿仍然是 `OperatorDraft`。

## Runtime Consumption Flow

其他页面不应直接依赖 `OperatorDraftPage` 的 React 状态，而应通过适配器读取本地库。

消费链路：

```txt
def.operator-editor.library.v1
  -> OperatorDraft
  -> normalizeOperatorDraft
  -> RuntimeOperatorTemplate
  -> Character-like runtime data
  -> 主界面 / OperatorConfigPage / 伤害计算
```

关键模块：

- `src/core/templates/operatorTemplate.ts`
- `src/core/services/operatorTemplateAdapter.ts`
- `src/core/services/localOperatorAdapter.ts`

## Relationship To Other Pages

### Workbench / 主界面

主界面可以把本地干员作为可选角色来源。`operator-studio` 提供本地干员模板，但不控制主界面的角色选择状态。

### OperatorConfigPage

`OperatorConfigPage` 可以读取 `operator-studio` 产出的本地角色数据，用于角色配置、技能展示和面板计算。`operator-studio` 不负责武器、装备、面板快照或配置缓存。

### Buff Sheet

Buff Sheet 复用了部分 `operator-draft` 样式和页面布局概念，但它维护的是 Buff 数据。`operator-studio` 不写 Buff storage。

### Weapon Sheet

Weapon Sheet 维护武器数据。`operator-studio` 中的 `weapon` 字段只是干员基础信息文本，不代表选择或写入武器库。

### Equipment Sheet

Equipment Sheet 维护装备数据。`operator-studio` 不维护装备槽位、装备词条或套装效果。

### Image Manager

Image Manager 可以作为资源管理入口。`operator-studio` 中的头像和技能图标字段使用资源路径，但不负责管理资源文件本身。

## Boundaries

`operator-studio` 应保持以下边界：

- 本地库真相源是 `def.operator-editor.library.v1`。
- 当前草稿缓存是 `def.operator-editor.draft.v1`。
- 页面编辑模型是 `OperatorDraft`。
- 派生消费模型是 `RuntimeOperatorTemplate`。
- 页面保存只影响干员本地库和当前草稿。
- 页面不写武器、装备、Buff、角色配置页、伤害页的 storage key。
- 页面不把官方角色 JSON 当作可覆盖保存目标。
- 页面不承担最终面板计算。
- 页面不承担战斗配置。

## Current Known Naming

当前项目中同一页面/概念存在多种命名：

- `operator-studio`：当前路由。
- `OperatorDraftPage`：当前组件名。
- `operator-draft`：当前 CSS class 和部分文档中的旧称。
- `干员模板编辑器`：当前页面显示标题。
- `本地干员库`：页面保存后的本地数据集合。
- `operator-editor`：storage key 命名前缀。

Spec 2 若涉及命名整理，需要先决定是否统一为 `operator-studio`、`operator-sheet` 或继续保留当前命名。

## Acceptance Criteria

- 本 spec 描述 `/operator-studio` 当前页面的功能范围。
- 本 spec 描述页面的核心数据职责和 storage key。
- 本 spec 描述当前草稿、本地干员库、运行时模板之间的关系。
- 本 spec 描述基础字段、属性矩阵、技能、hit、技能等级倍率的页面职责。
- 本 spec 描述官方参考导入、本地库导入、保存、另存为、删除、导出和分享导入流程。
- 本 spec 描述页面与主界面、`OperatorConfigPage`、Buff、Weapon、Equipment、Image Manager 的边界。
- 本 spec 不作为开发 spec，不包含新增功能实现要求。
- 后续 `operator-studio` 开发应基于本 spec 编写 Spec 2。
