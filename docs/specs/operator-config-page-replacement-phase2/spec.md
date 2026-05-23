# OperatorConfigPage 主界面角色对齐与真实数据渲染 Phase 2 Spec

## Why

Phase 1 已经让 `OperatorConfigPage` 具备初步配置能力：页面可以初步选择武器和装备，也可以渲染部分角色基础数据。

但当前页面仍未完整对齐主界面的 1-4 个角色上下文，也还没有把角色、武器、装备三类真实数据稳定渲染到所有前端展示区域。Phase 2 的目标是把页面从“能选”推进到“按主界面角色上下文正确展示真实配置数据”。

## What Changes

- `OperatorConfigPage` SHALL 对齐主界面当前 1-4 个角色 `id`。
- 页面角色 id 来源 SHALL 以主界面写入 `sessionStorage` 的角色结果为准。
- 页面角色完整数据 SHALL 根据角色 id 从 `operator-draft` 的 `localStorage` 读取。
- 页面右侧角色切换 SHALL 只在主界面已选 1-4 个角色之间切换。
- 页面 SHALL 不新增独立角色选择器。
- 页面 SHALL 根据当前角色、武器、装备的真实数据渲染前端展示区域。
- 无数据时 SHALL 使用空态或默认态，不伪造占位结果。
- 本阶段 SHALL 顺带补全本地干员模板编辑器的等级维度数据，以支撑 `OperatorConfigPage` 渲染。
- 本阶段先定义渲染接入框架，具体渲染字段继续逐块补充。

## Phase 1 Baseline

Phase 1 已完成或部分完成以下基础能力：

- 初步接入 `OperatorConfigPage` 独立缓存。
- 初步支持按角色 `id` 保存配置。
- 初步支持武器选择与装备选择。
- 初步支持角色数据渲染。
- 初步支持刷新后恢复本页配置。

Phase 2 在这些基础上继续推进，不重新推翻 Phase 1 的缓存结构。

## Scope

本阶段开发范围：

- 对齐主界面 1-4 个角色 id 的 `sessionStorage` 来源。
- 保证 `OperatorConfigPage` 当前角色 id 集合与主界面当前角色 id 集合一致。
- 根据角色 id 从 `operator-draft` 的 `localStorage` 读取完整角色数据。
- 完善右侧角色切换与当前角色配置读取。
- 完善角色真实数据在前端区域的渲染。
- 完善武器真实数据在前端区域的渲染。
- 完善装备真实数据在前端区域的渲染。
- 补全本地干员模板编辑器的等级维度数据结构。
- 明确各展示区域“有数据展示数据，无数据展示空态”的规则。

本阶段不处理：

- 新增独立角色选择器。
- 替代主界面的选人流程。
- 主界面反向读取 `OperatorConfigPage` 新缓存的最终契约。
- 后端能力。
- 云同步。
- `panel` 计算字段最终设计。

## Reference Behavior

`OperatorConfigPage` SHALL 参考以下现有上下文：

- 主界面当前 1-4 个角色 id 选择结果。
- 主界面已写入的 `sessionStorage` 角色 id 上下文。
- Phase 1 中定义的 `OperatorConfigPage` 独立配置缓存。
- `weapon sheet` 已产出的武器数据。
- `sheet-equipment` 已产出的装备数据。
- `operator-draft` 已产出的角色数据。

## Requirements

### Requirement: 主界面角色 id 上下文对齐

系统 SHALL 将主界面当前 1-4 个角色 id 作为 `OperatorConfigPage` 的角色集合来源。

#### Scenario: 进入页面

- WHEN 用户进入 `OperatorConfigPage`
- THEN 页面读取主界面当前 1-4 个角色 id 上下文
- AND 页面右侧角色列表与该角色 id 集合保持一致
- AND 角色上下文来源于 `sessionStorage['def.selected-characters.v1']`
- AND 该 key 的结构为 `string[]`
- AND 数组内容为最多 `4` 个角色 `id`

#### Scenario: 主界面角色为空

- WHEN 主界面没有可用角色 id 上下文
- THEN 页面展示空态
- AND 不自动伪造角色

### Requirement: 角色完整数据来源

系统 SHALL 根据主界面提供的角色 id，从 `operator-draft` 的 `localStorage` 读取角色完整数据。

#### Scenario: 角色 id 可解析

- WHEN 主界面提供某个角色 id
- AND `operator-draft` 的 `localStorage` 中存在该角色完整数据
- THEN 页面将该角色数据写入 `character.data`
- AND 使用该数据渲染角色基础数据区
- AND `operator-draft` 角色库来源于 `localStorage['def.operator-editor.library.v1']`
- AND 角色库结构为 `Record<string, OperatorDraft>`

#### Scenario: 角色 id 缺失数据

- WHEN 主界面提供某个角色 id
- AND `operator-draft` 的 `localStorage` 中不存在该角色完整数据
- THEN 页面展示该角色缺失态
- AND 不使用主界面角色 id 伪造角色名、属性或面板数据

### Requirement: 本地角色模板等级维度补全

系统 SHALL 补全本地干员模板编辑器的等级维度数据，以支撑 `OperatorConfigPage` 和后续主界面消费。

#### Scenario: 本地角色模板等级档位

- WHEN 补全本地角色模板等级结构
- THEN 本地角色模板按 `1 / 20 / 40 / 60 / 80 / 90` 六档组织等级数据

#### Scenario: 本地角色基础属性

- WHEN 补全本地角色基础属性
- THEN 力量、攻击、敏捷、智识、意志、生命都具有等级维度
- AND 不再只保存单组静态值

#### Scenario: 本地角色基础属性挂载层级

- WHEN 定义本地角色基础属性等级结构
- THEN 等级维度挂在单个属性字段下面
- AND 不挂在 `attributes.level1 / level20 / ...` 这一层下面

#### Scenario: 本地角色基础属性等级键

- WHEN 定义本地角色基础属性等级键
- THEN 每个属性统一包含 `level1 / level20 / level40 / level60 / level80 / level90`
- AND 每个等级键的值直接是 `number`

#### Scenario: 数据迁移方向

- WHEN 本阶段推进本地角色模板等级结构
- THEN 允许本地角色属性 JSON 向新的等级维度结构迁移
- AND 后续通过重新导数据完成结构统一

#### Scenario: 本地角色技能倍率

- WHEN 补全本地角色技能倍率结构
- THEN 技能倍率具有等级维度
- AND 不再只保存单组静态倍率

#### Scenario: 技能倍率挂载层级

- WHEN 定义本地角色技能倍率结构
- THEN 等级维度挂在每个 skill 的 hit 层下面
- AND 不挂在整个 skill 根节点下面

#### Scenario: 技能倍率等级键

- WHEN 定义本地角色技能等级键
- THEN 每个 hit 统一包含 `L1-L9` 与 `M1-M3`
- AND 每个等级键的值直接是 `number`
- AND 不额外包裹 `{ multiplier }` 对象

### Requirement: 不新增角色选择器

系统 SHALL 不在 `OperatorConfigPage` 中新增独立选人流程。

#### Scenario: 切换角色

- WHEN 用户点击右侧角色头像
- THEN 页面只在主界面已选 1-4 个角色之间切换当前角色
- AND 不改变主界面角色集合

### Requirement: 当前角色配置对齐

系统 SHALL 按当前角色 `id` 读取或初始化本页配置。

#### Scenario: 当前角色已有配置

- WHEN 当前角色在 `OperatorConfigPage` 缓存中已有配置
- THEN 页面读取该配置并渲染

#### Scenario: 当前角色没有配置

- WHEN 当前角色在 `OperatorConfigPage` 缓存中没有配置
- THEN 页面为该角色初始化默认配置
- AND 使用从 `operator-draft` 读取到的角色数据作为初始角色数据来源

### Requirement: 真实数据渲染原则

系统 SHALL 基于真实数据渲染前端展示区域。

#### Scenario: 有数据

- WHEN 当前角色、武器或装备存在真实数据
- THEN 页面展示真实数据

#### Scenario: 无数据

- WHEN 当前角色、武器或装备没有真实数据
- THEN 页面展示空态或默认态
- AND 不展示伪造占位结果

### Requirement: 角色数据渲染

系统 SHALL 根据当前角色真实数据渲染角色相关区域。

#### Scenario: 角色基础数据

- WHEN 当前角色存在角色数据
- THEN 角色基础数据区展示该角色对应数据

#### Scenario: 角色配置数据

- WHEN 当前角色等级或潜能发生变化
- THEN 页面根据当前配置刷新角色相关展示

#### Scenario: 角色基础数据区字段

- WHEN 页面渲染角色基础数据区
- THEN 当前阶段至少展示 `name / element / level / atk / strength / agility / intelligence / will / hp`

#### Scenario: 角色基础数据区取值来源

- WHEN 页面渲染角色基础数据区
- THEN `name / element` 从角色完整数据读取
- AND `level` 从当前角色配置 `character.config` 读取
- AND `atk / strength / agility / intelligence / will / hp` 从角色属性等级结构读取

#### Scenario: 角色潜能边界

- WHEN 页面处于 Phase 2
- THEN 角色潜能不进入角色基础数据区展示
- AND 角色潜能不参与当前阶段的展示值计算
- AND 角色潜能相关展示与生效规则留到 Phase 3 定义

#### Scenario: 角色属性等级键

- WHEN 页面根据当前角色等级读取属性
- THEN 当前阶段先按已定义等级键读取
- AND 已定义等级键包括 `level1 / level20 / level40 / level60 / level80 / level90`
- AND 更细等级规则后续继续补充

#### Scenario: 角色等级支持范围

- WHEN 页面处于 Phase 2
- THEN 当前阶段只支持固定等级档
- AND 固定等级档为 `1 / 20 / 40 / 60 / 80 / 90`
- AND `30 / 50 / 70` 等中间等级当前阶段不支持
- AND 页面不为未定义等级档补做向上、向下或插值兼容
- AND 页面交互层也不开放未支持的中间等级选项

### Requirement: 武器数据渲染

系统 SHALL 根据当前角色配置中的武器数据渲染武器区域。

#### Scenario: 已选择武器

- WHEN 当前角色已选择武器
- THEN 武器区域展示当前武器真实数据

#### Scenario: 未选择武器

- WHEN 当前角色没有选择武器
- THEN 武器区域展示空态

#### Scenario: 武器展示区字段

- WHEN 页面渲染武器展示区
- THEN 当前阶段至少展示 `weapon name / weapon rarity / weapon type / weapon level / weapon atk / weapon image`
- AND 武器图片区同层预留区域展示武器等级与攻击力

#### Scenario: 武器等级规则

- WHEN 当前阶段渲染武器等级
- THEN 武器等级先按 `90` 处理
- AND 当前阶段不要求补全武器等级切换交互

#### Scenario: 武器等级支持范围

- WHEN 页面处于 Phase 2
- THEN 武器等级当前只支持 `90`
- AND 页面交互层不开放其他武器等级选项
- AND 页面不为其他武器等级补做兼容

#### Scenario: 武器攻击力取值

- WHEN 页面渲染武器攻击力
- THEN 根据当前武器等级从 `attackGrowth` 中读取对应值
- AND 当前阶段按武器等级 `90` 取值

#### Scenario: skill1 与 skill2 展示

- WHEN 页面渲染 `skill1 / skill2`
- THEN 每个 skill 只展示一条摘要信息
- AND 摘要至少包含 `name / type / 当前等级对应数值`

#### Scenario: skill3 展示

- WHEN 页面渲染 `skill3`
- THEN 使用武器区已预留的大文本区域承载详细内容
- AND 若存在多条效果，则整理为纯文本
- AND 按“一行一条”的方式输出

#### Scenario: 武器 skill 取值来源

- WHEN 页面渲染武器 skill
- THEN `skill1 / skill2 / skill3` 的展示内容根据 `weapon.config.skillLevels` 对应等级从 `weapon.data.skills` 读取
- AND 当前阶段不要求将整段 skill 描述都塞进主摘要区

### Requirement: 装备数据渲染

系统 SHALL 根据当前角色配置中的装备数据渲染装备区域。

#### Scenario: 已选择装备

- WHEN 当前装备位已选择装备
- THEN 该装备位展示当前装备真实数据

#### Scenario: 未选择装备

- WHEN 当前装备位没有选择装备
- THEN 该装备位展示空态

#### Scenario: 装备位布局修正

- WHEN 页面渲染 4 个固定装备位
- THEN 装备位布局以页面目标位置为准
- AND 当前实现中护甲位与第一个配件位的位置错误需要修正

#### Scenario: 装备词条展示范围

- WHEN 页面渲染装备词条展示框
- THEN 只展示非固定的 `effect` 词条
- AND 不将 `fixedStat` 渲染进这 3 个词条框

#### Scenario: 装备词条展示格式

- WHEN 页面渲染单条装备词条
- THEN 词条展示格式参考 `意志提升 · wilBoost + 数值`
- AND 至少包含 `label / typeKey / 当前档位对应数值`

#### Scenario: 装备词条框文本约束

- WHEN 页面渲染装备词条文本
- THEN 允许缩小字体
- AND 允许自动换行
- AND 不允许文本撑出词条框
- AND 不允许挤占相邻框的布局空间

#### Scenario: 词条数量不足

- WHEN 当前装备只有 `1` 条或 `2` 条有效词条
- THEN 多余的词条框显示 `无`
- AND 多余词条位不显示伪造词条内容

#### Scenario: 装备按钮档位

- WHEN 页面渲染装备词条档位按钮
- THEN 词条档位范围为 `L0 - L3`
- AND 最小 count 为 `0`
- AND 后续实现可在现有点亮/点灭逻辑基础上小幅修改复用

#### Scenario: 装备词条档位支持范围

- WHEN 页面处于 Phase 2
- THEN 装备词条档位当前只支持 `L0 / L1 / L2 / L3`
- AND 页面交互层不开放其他档位选项
- AND 页面不为其他档位补做兼容

### Requirement: 技能详情弹窗

系统 SHALL 允许用户从 `A / B / E / Q` 占位入口打开当前技能类型的详情弹窗。

#### Scenario: A 类型入口

- WHEN 用户点击主区中的普攻占位
- THEN 页面打开技能详情弹窗
- AND 弹窗展示当前角色所有 `skillType = A` 的 skill

#### Scenario: 技能详情展示内容

- WHEN 页面渲染技能详情弹窗
- THEN 每个 skill 展示其 `displayName`
- AND 展示该 skill 下的 `hit`
- AND 展示每个 `hit` 对应的倍率

#### Scenario: 技能详情弹窗布局

- WHEN 页面渲染技能详情弹窗
- THEN 弹窗整体布局参考现有 `imgUrl` 相关卡片组结构
- AND 每个 skill 使用一个卡片组
- AND 每个 hit 使用一个卡片
- AND hit 卡片尺寸允许缩小为参考卡片的一半

#### Scenario: hit 倍率文本格式

- WHEN 页面渲染某个 `hit` 的倍率文本
- THEN 文本使用短格式
- AND 格式统一为 `hit: number | 物理 | A`
- AND 依次表达 `hit 名称 / 当前倍率值 / 属性类型 / 技能类型`
- AND `物理` 对应 `hit.element`
- AND `A` 对应 `hit.skillType`

#### Scenario: hit 倍率取值规则

- WHEN 页面需要渲染某个 `hit` 的当前倍率值
- THEN 直接根据当前技能配置等级读取该 `hit` 下同名等级键
- AND 当前技能等级为 `L7` 时读取 `hit.levels.L7`
- AND 当前技能等级为 `M3` 时读取 `hit.levels.M3`
- AND 不额外做等级映射或换算

### Requirement: Operator Draft 重构

系统 SHALL 在本阶段重构 `operator-draft` 结构，以支撑 `OperatorConfigPage` 的详细技能展示和等级维度消费。

#### Scenario: Draft 结构重构

- WHEN 本阶段重构 `operator-draft`
- THEN 新结构需要支撑角色等级维度
- AND 支撑技能等级维度
- AND 支撑按 `skillType` 归类技能并展示详细 hit 信息

#### Scenario: 官方角色导入保留

- WHEN 本阶段重构 `operator-draft`
- THEN 必须保留官方角色导入能力
- AND 官方角色导入后也能进入新的 draft 结构
- AND 本地角色与官方导入角色最终统一到同一套编辑器输出模型

## Rendering Details To Be Defined

以下渲染细节在本阶段继续讨论后补充：

- 角色基础数据区具体展示字段。
- 本地角色模板等级维度的精确 JSON 组织方式。
- 本地角色技能倍率等级维度的精确 JSON 组织方式。
- 角色等级如何影响展示值。
- 武器展示区具体展示字段。
- 武器等级、潜能、skill 等级如何影响展示值。
- 装备展示区具体展示字段。
- 装备词条数量、词条档位如何影响展示值。
- 护甲位与第一个配件位修正后的精确页面坐标。
- 技能区是否在 Phase 2 纳入完整真实数据渲染。
- 面板区是否只保留占位，还是开始承接部分展示数据。

## Acceptance Criteria

### AC1: 主界面角色对齐

- `OperatorConfigPage` 的角色 id 集合来自主界面当前 1-4 个角色。
- 页面不新增独立角色选择器。
- 右侧角色切换只在主界面角色集合内发生。
- 角色完整数据根据角色 id 从 `operator-draft` 的 `localStorage` 读取。
- 本地角色模板补全为带等级维度的数据结构后，可支撑 `OperatorConfigPage` 渲染。

### AC2: 当前角色配置正确

- 切换角色后，页面按角色 `id` 读取对应配置。
- 无配置时，页面按默认值初始化当前角色配置。

### AC3: 真实数据渲染原则成立

- 当前前端存在的真实角色数据会显示到角色区域。
- 当前前端存在的真实武器数据会显示到武器区域。
- 当前前端存在的真实装备数据会显示到装备区域。
- 无数据时显示空态或默认态，不显示伪造占位。

### AC4: 渲染细节可继续补充

- 本文档保留渲染细节待补区。
- 后续可以按角色、武器、装备、技能、面板分块继续补充。

## JSON Shape Notes

本地角色模板的基础属性等级结构在本阶段先收敛为：

```ts
attributes: {
  strength: {
    level1: number,
    level20: number,
    level40: number,
    level60: number,
    level80: number,
    level90: number
  },
  agility: {
    level1: number,
    level20: number,
    level40: number,
    level60: number,
    level80: number,
    level90: number
  },
  intelligence: {
    level1: number,
    level20: number,
    level40: number,
    level60: number,
    level80: number,
    level90: number
  },
  will: {
    level1: number,
    level20: number,
    level40: number,
    level60: number,
    level80: number,
    level90: number
  },
  atk: {
    level1: number,
    level20: number,
    level40: number,
    level60: number,
    level80: number,
    level90: number
  },
  hp: {
    level1: number,
    level20: number,
    level40: number,
    level60: number,
    level80: number,
    level90: number
  }
}
```

本地角色模板的技能倍率等级结构在本阶段先收敛为：

```ts
skills: {
  "skill-1": {
    displayName: string,
    buttonType: "A" | "B" | "E" | "Q",
    iconUrl: string,
    hitMeta: {
      hit1: {
        displayName: string,
        element: string,
        skillType: "A" | "B" | "E" | "Q",
        levels: {
          L1: number,
          L2: number,
          L3: number,
          L4: number,
          L5: number,
          L6: number,
          L7: number,
          L8: number,
          L9: number,
          M1: number,
          M2: number,
          M3: number
        }
      }
    }
  }
}
```
