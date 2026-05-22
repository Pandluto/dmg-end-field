# OperatorConfigPage 替代 Panel 大型接入 Spec

## Why

当前 `OperatorConfigPage` 仍处于静态占位和半接线状态，虽然前端结构已经预留了角色、武器、装备、技能、CTI、角色切换等区域，但还没有形成完整可用的配置页面。

现有主界面的 `OperatorConfigPanel` 已承担角色配置职责，但其结构和交互已经不适合继续作为最终承载界面维护。本阶段目标不是继续补旧 panel，而是逐步把角色配置职责迁移到 `OperatorConfigPage`，并最终完成替代。

## What Changes

- 以 `OperatorConfigPage` 作为新的角色配置主页面推进开发。
- 页面职责覆盖角色、武器、装备、技能配置，以及后续面板数据承接。
- 页面配置结果通过自身缓存结构持久化，并提供给其他界面读取。
- 本轮只处理前端接入、联动、缓存和数据链路，不处理后端能力。
- 允许推翻 `OperatorConfigPanel` 当前缓存组织方式，重新定义更适合 `OperatorConfigPage` 的主配置结构。

## Replacement Goal

`OperatorConfigPage` 的目标不是复刻旧 panel，而是逐步接管并最终替代 `OperatorConfigPanel` 的以下职责：

- 角色配置职责
- 缓存读写职责
- 对主界面的配置输出职责

替代完成后，主界面应逐步改为读取 `OperatorConfigPage` 产出的配置结果。

## Reference Surface

当前 `OperatorConfigPage` 已预留以下前端区域，后续 spec 与开发均以这些区域为接入面：

- 角色基础数据区
- 技能等级 / 专精区
- 角色等级 / 潜能区
- 武器展示与配置区
- 装备展示与配置区
- CTI 输入区
- 右侧角色切换区

## Scope

本轮开发范围：

- 接入角色、武器、装备、技能四块真实数据
- 打通页面内部状态与缓存
- 打通缓存与其他界面的读取链路
- 完成主要交互区的前端调试
- 为后续完全替代旧 panel 建立新的主配置结构

本轮不处理：

- 后端能力
- 云同步
- 与前端接入无关的大范围架构重写
- `panel` 区详细字段设计

## Core Decisions

### Decision: 页面职责

系统 SHALL 将 `OperatorConfigPage` 作为新的角色配置主页面推进。

### Decision: 配置主键

系统 SHALL 按角色 `id` 存一份独立配置。

- 一个角色只对应一份配置
- 页面切换角色时读取该角色配置
- 页面修改时写回该角色配置
- 其他界面读取时按角色 `id` 获取

### Decision: 缓存职责

系统 SHALL 使用 `sessionStorage` 承担 `OperatorConfigPage` 的页面恢复与跨界面读取职责。

- 刷新后可恢复页面配置
- 本页编辑结果持续写入缓存
- 其他界面可读取本页产出的缓存

### Decision: 结构策略

系统 SHALL 允许推翻旧 `OperatorConfigPanel` 当前缓存组织方式，并为 `OperatorConfigPage` 定义新的主配置结构。

## Proposed Data Shape

`OperatorConfigPage` 使用一个总对象写入 `sessionStorage`，总对象最多维护 4 个角色配置。

每个角色配置下包含：

- `character`
- `weapon`
- `equipment`
- `skills`
- `panel`

其中前四块统一采用三层结构：

- `id`
- `config`
- `data`

当前结构草案如下：

```ts
{
  [characterId]: {
    character: {
      id: string,
      config: {
        level: number | string,
        potential: string
      },
      data: {}
    },
    weapon: {
      id: string,
      config: {
        level: number | string,
        potential: string,
        skillLevels: {
          skill1?: number,
          skill2?: number,
          skill3?: number
        }
      },
      data: {}
    },
    equipment: {
      accessory1: {
        id: string,
        entryCount: number,
        entries: Array<{
          id: string,
          config: {
            level: number | string
          },
          data: {}
        }>,
        config: {},
        data: {}
      },
      accessory2: {
        id: string,
        entryCount: number,
        entries: Array<{
          id: string,
          config: {
            level: number | string
          },
          data: {}
        }>,
        config: {},
        data: {}
      },
      armor: {
        id: string,
        entryCount: number,
        entries: Array<{
          id: string,
          config: {
            level: number | string
          },
          data: {}
        }>,
        config: {},
        data: {}
      },
      glove: {
        id: string,
        entryCount: number,
        entries: Array<{
          id: string,
          config: {
            level: number | string
          },
          data: {}
        }>,
        config: {},
        data: {}
      }
    },
    skills: {
      id: string,
      config: {
        A: {},
        B: {},
        E: {},
        Q: {}
      },
      data: {}
    },
    panel: {}
  }
}
```

## Requirements

### Requirement: 页面定位

系统 SHALL 将 `OperatorConfigPage` 作为替代旧角色配置 panel 的新页面推进。

#### Scenario: 页面职责

- WHEN 用户进入 `OperatorConfigPage`
- THEN 页面承担角色配置主流程
- AND 后续开发以该页面为核心

### Requirement: 模块接入范围

系统 SHALL 覆盖以下模块：

- 角色区
- 武器区
- 装备区
- 技能区
- CTI 输入区
- 右侧角色切换区
- 缓存与输出链路

#### Scenario: 优先顺序

- WHEN 进入分阶段开发
- THEN 角色区为第一优先级
- AND 其他模块按接入链路逐步推进

### Requirement: CTI 职责边界

系统 SHALL 将 CTI 输入区限定为搜索输入区，而非最终选择控件。

#### Scenario: CTI 输入

- WHEN 用户在 CTI 输入区输入内容
- THEN 系统记录当前搜索词
- AND CTI 本身不直接完成角色、武器、装备选择

#### Scenario: 后续选择联动

- WHEN 用户后续点击头像、切换武器、切换装备
- THEN 系统可使用 CTI 输入词作为候选筛选条件

### Requirement: 角色选择接入

系统 SHALL 直接接入现有选人界面预留接口，而不是在 `OperatorConfigPage` 内重新设计角色选择流程。

#### Scenario: 角色切换

- WHEN 用户从现有选人链路切换角色
- THEN `OperatorConfigPage` 无缝接入该结果
- AND 同步切换当前角色配置与页面展示

### Requirement: 武器选择入口

系统 SHALL 使用武器区现有图片区域作为武器选择入口按钮。

#### Scenario: 打开武器选择弹窗

- WHEN 用户点击武器区预留图片区域
- THEN 系统打开武器选择弹窗
- AND 用户在弹窗中完成武器切换

#### Scenario: 武器选择完成

- WHEN 用户在弹窗中选择武器
- THEN 系统回写 `weapon.id`
- AND 同步更新 `weapon.data`
- AND 保留或初始化 `weapon.config`

### Requirement: 装备选择入口

系统 SHALL 使用装备区现有图片区域作为装备选择入口按钮。

#### Scenario: 打开装备选择弹窗

- WHEN 用户点击某个装备位的预留图片区域
- THEN 系统打开对应装备位的装备选择弹窗
- AND 用户在弹窗中完成装备切换

#### Scenario: 装备选择完成

- WHEN 用户在弹窗中选择装备
- THEN 系统回写该装备位的 `id`
- AND 同步更新该装备位的 `data`
- AND 保留或初始化该装备位的 `config`

### Requirement: 弹窗样式基准

系统 SHALL 以 `sheet-weapon` 中 `imgUrl` 相关选择弹窗作为武器和装备选择弹窗的样式与交互参考。

#### Scenario: 弹窗对齐

- WHEN 实现武器或装备选择弹窗
- THEN 弹窗结构、视觉风格、交互体验尽量对齐 `sheet-weapon` 的 `imgUrl` 选择弹窗
- AND 允许加载数据内容不同
- AND 不重新设计一套明显偏离的选择器交互

### Requirement: 缓存模型

系统 SHALL 按角色 `id` 维护 `OperatorConfigPage` 的独立缓存。

#### Scenario: 首次进入角色

- WHEN 某角色首次进入 `OperatorConfigPage`
- THEN 系统在本页缓存中初始化该角色配置

#### Scenario: 再次进入角色

- WHEN 某角色已有本页缓存
- THEN 系统优先读取已有缓存

#### Scenario: 页面刷新

- WHEN 页面刷新
- THEN 系统从 `sessionStorage` 恢复本页缓存

### Requirement: 写回时机

系统 SHALL 在页面内发生配置修改时立即写入 `sessionStorage`。

#### Scenario: 页面内修改

- WHEN 用户修改角色、武器、装备、技能相关配置
- THEN 系统立即写回当前角色对应缓存
- AND 不等待离开页面或手动保存

### Requirement: 角色切换初始化

系统 SHALL 在切换角色时检查 `sessionStorage` 中是否已有该角色配置。

#### Scenario: 已有角色缓存

- WHEN 用户切换到某个角色
- AND `sessionStorage` 中已存在该角色配置
- THEN 系统直接读取并恢复该角色配置

#### Scenario: 没有角色缓存

- WHEN 用户切换到某个角色
- AND `sessionStorage` 中不存在该角色配置
- THEN 系统为该角色写入一份初始值
- AND 页面使用该初始值继续编辑

### Requirement: 武器与装备初始化

系统 SHALL 在武器或装备首次写入时使用初始值进入配置态。

#### Scenario: 选择武器

- WHEN 用户首次为当前角色选择某个武器
- THEN 系统为该武器配置写入初始值
- AND 后续修改在此基础上继续写回

#### Scenario: 选择装备

- WHEN 用户首次为某个装备位选择装备
- THEN 系统为该装备位配置写入初始值
- AND 后续修改在此基础上继续写回

### Requirement: 默认初始值

系统 SHALL 为角色、武器、装备、技能提供固定默认初始值。

#### Scenario: 角色默认值

- WHEN 系统初始化某角色配置
- THEN 角色等级默认值为 `90`
- AND 角色潜能默认值为 `0潜`

#### Scenario: 武器默认值

- WHEN 系统初始化武器配置
- THEN 武器等级默认值为 `90`
- AND 武器潜能默认值为 `0潜`
- AND 武器各 skill 默认等级为 `9 / 9 / 4`

#### Scenario: 装备默认值

- WHEN 系统初始化装备配置
- THEN 每件装备默认词条档位为 `3 / 3 / 3`

#### Scenario: 技能默认值

- WHEN 系统初始化技能配置
- THEN `A / B / E / Q` 默认均为 `M3`

### Requirement: 主配置结构

系统 SHALL 使用按角色组织的总对象结构承载角色配置。

#### Scenario: 角色配置组织

- WHEN 系统写入某角色配置
- THEN 该配置写入总对象对应角色 `id` 节点下
- AND `character`、`weapon`、`equipment`、`skills` 使用统一的 `id / config / data` 结构

### Requirement: Character 结构

系统 SHALL 将角色本体配置收敛为 `character.id / character.config / character.data`。

#### Scenario: 角色配置字段

- WHEN 页面写入角色本体配置
- THEN `character.config` 当前至少包含角色等级与角色潜能
- AND 角色切换时同步切换对应配置

### Requirement: Weapon 结构

系统 SHALL 将武器配置收敛为 `weapon.id / weapon.config / weapon.data`。

#### Scenario: 武器配置字段

- WHEN 页面写入武器配置
- THEN `weapon.config` 当前至少包含武器等级、武器潜能、各武器 skill 等级
- AND 武器 skill 等级范围当前按 `1-9` 处理

### Requirement: Equipment 结构

系统 SHALL 将装备区按固定装备位组织，而不是按单一装备对象组织。

#### Scenario: 固定装备位

- WHEN 页面写入装备配置
- THEN 装备区固定包含 `2` 个配件位、`1` 个护甲位、`1` 个护手位
- AND 每个装备位独立维护自身配置

#### Scenario: 单件装备结构

- WHEN 页面写入单件装备
- THEN 单件装备至少包含装备 `id`
- AND 包含有效词条数 `entryCount`
- AND 包含词条集合 `entries`

#### Scenario: 装备词条

- WHEN 页面写入装备词条
- THEN 每个词条使用 `id / config / data` 结构
- AND 词条当前唯一必需配置项为词条档位
- AND 每件装备有效词条数允许为 `1-3`
- AND 当前 UI 展示 `3` 个词条位，但实际生效数量由 `entryCount` 决定

### Requirement: Skills 结构

系统 SHALL 将技能配置收敛为统一 `skills` 节点，并在 `skills.config` 中固定维护 `A / B / E / Q` 四键。

#### Scenario: 技能键组织

- WHEN 页面写入技能配置
- THEN `skills.config` 固定包含 `A`、`B`、`E`、`Q`
- AND 四个技能键的具体字段后续继续补充

### Requirement: 数据源边界

系统 SHALL 从现有页面消费数据，但不直接把其他页面的缓存对象当作本页主缓存。

#### Scenario: 外部数据源

- WHEN 页面需要角色、武器、装备原始数据
- THEN 可分别从现有数据源读取
- AND 写入本页自己的配置结构后再使用

### Requirement: Character 数据来源

系统 SHALL 从 `operator-draft` 读取角色原始数据作为 `character.data`。

#### Scenario: 角色原始数据接入

- WHEN 页面需要当前角色原始数据
- THEN 从 `operator-draft` 已产出的角色数据读取
- AND 写入当前角色的 `character.data`

### Requirement: Weapon 数据来源

系统 SHALL 从 `weapon sheet` 读取武器原始数据作为 `weapon.data`。

#### Scenario: 武器原始数据接入

- WHEN 页面需要当前武器原始数据
- THEN 从 `weapon sheet` 已产出的武器数据读取
- AND 写入当前角色的 `weapon.data`

### Requirement: Equipment 数据来源

系统 SHALL 从 `sheet-equipment` 读取装备原始数据作为 `equipment.data`。

#### Scenario: 装备原始数据接入

- WHEN 页面需要当前装备原始数据
- THEN 从 `sheet-equipment` 已产出的装备数据读取
- AND 写入当前角色的 `equipment.data`

### Requirement: Skills 数据来源与映射

系统 SHALL 从 `operator-draft` 读取角色技能原始数据，并按技能类别归类到 `A / B / E / Q`。

#### Scenario: 技能原始数据接入

- WHEN 页面需要当前角色技能原始数据
- THEN 从 `operator-draft` 已产出的技能数据读取
- AND 写入当前角色的 `skills.data`

#### Scenario: 技能分类映射

- WHEN 页面消费技能原始数据
- THEN 根据 `operator-draft` 中 skill 对应的类别进行分类
- AND 将分类结果映射到 `A / B / E / Q`
- AND 页面交互与展示基于归类后的技能视图进行

## Open Questions

以下内容尚未在本版 spec 中定稿，后续继续补充：

- `character.config` 的具体字段
- `weapon.config` 的更完整字段
- `equipment` 装备本体 `config` 的具体字段
- `skills.config` 下 `A / B / E / Q` 的具体字段
- `panel` 的完整结构与来源
- 角色、武器、装备、技能来源的精确字段映射
- 主界面对新缓存读取链路的最终对齐方案
- 弹窗选择器的统一交互模型

## Acceptance Criteria

### AC1: Spec 方向明确

- `OperatorConfigPage` 被定义为替代旧 panel 的新主页面。
- 本轮允许重新定义缓存结构。

### AC2: 缓存主键明确

- 页面按角色 `id` 存配置。
- 页面配置缓存使用 `sessionStorage`。

### AC3: 主结构明确

- 缓存整体为一个总对象。
- 总对象内按角色组织配置。
- `character`、`weapon`、`equipment`、`skills` 采用 `id / config / data` 三层结构。

### AC4: 未定项显式保留

- 未定字段和后续决策被明确列为待补充项。
- 本文档可作为后续继续讨论和拆分任务的基础版本。
