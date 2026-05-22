# Sheet Equipment 编辑交互增强 Phase 2 Spec

## Why

当前 Sheet Equipment 已具备基础页面、数据迁移、资源管理器、Lv0-Lv3 编辑和导入导出，但编辑体验仍偏普通表单，未达到 Sheet-Weapon / Sheet-Buff 的工作表交互完成度。

主要问题：

- 表格一次性摊开所有套装、装备、fixedStat、effect、effectLevels 行。
- 缺少与资源管理器同步的层级展开/折叠。
- 单元格选中、fx 栏编辑、键盘导航、右键操作、批量编辑、typeKey 搜索选择都不完整。
- 表格展示内容没有严格限制，不符合现有 Sheet-Weapon 的行显示模型。

## What Changes

- 重构 Sheet Equipment 的行展示逻辑，改为 Sheet-Weapon 式 `visibleRows`。
- 新增统一折叠状态：
  - `collapsedGearSetIds`
  - `collapsedEquipmentIds`
  - `collapsedEffectIds`
- 默认进入页面时只展示套装行，全部折叠。
- 资源管理器与表格共用同一套折叠状态。
- 套装行、装备行、effect 行显示 `[+] / [-]` toggle。
- fixedStat 行不显示 toggle。
- 补齐单元格选中、fx 栏编辑、键盘导航、右键增强、批量编辑、typeKey 搜索选择。

## Reference Behavior

Sheet Equipment SHALL 参考现有 Sheet-Weapon / Sheet-Buff 的以下实现模式：

- Sheet-Weapon `visibleRows` 过滤模型。
- Sheet-Weapon `collapsedDraftIds / collapsedSkills / collapsedLevels` 层级折叠模型。
- Sheet-Weapon `effectLevels` 内联等级格模型。
- Sheet-Weapon / Sheet-Buff `selectedWorkbookCell` 单元格选择模型。
- Sheet-Weapon / Sheet-Buff `formulaBinding` / `formulaTextBinding` fx 栏编辑模型。
- Sheet-Weapon `search-select` 类型选择模型。
- Sheet-Weapon 右键菜单行为：展开/折叠、自动补全等级、复制、删除。
- Sheet-Weapon 输入框键盘事件拦截策略。

## Requirements

### Requirement: 严格行展示

系统 SHALL 不再一次性展示所有行，而是按展开状态计算 visibleRows。

#### Scenario: 默认展示

- WHEN 用户首次进入 `/sheet-equipment`
- THEN 表格只展示套装行
- AND 所有套装、装备、effect 均为折叠状态

#### Scenario: 展开套装

- WHEN 用户展开某个套装
- THEN 表格展示该套装下的装备行
- AND 不展示装备下的 fixedStat/effect，直到装备被展开

#### Scenario: 展开装备

- WHEN 用户展开某个装备
- THEN 表格展示该装备下的 fixedStat 和 effect 行
- AND 不展示 effectLevels，直到 effect 被展开

#### Scenario: 展开 effect

- WHEN 用户展开某个 effect
- THEN 表格展示该 effect 的 Lv0/Lv1/Lv2/Lv3 内联等级编辑行

### Requirement: 表格与资源管理器折叠同步

系统 SHALL 让资源管理器和表格共用同一套折叠状态。

#### Scenario: 资源管理器点击套装

- WHEN 用户点击资源管理器中的套装节点
- THEN 系统展开该套装
- AND 表格定位到该套装行

#### Scenario: 资源管理器点击装备

- WHEN 用户点击资源管理器中的装备节点
- THEN 系统展开父套装和该装备
- AND 表格定位到该装备行

#### Scenario: 资源管理器点击 fixedStat

- WHEN 用户点击 fixedStat 节点
- THEN 系统展开父套装和装备
- AND 表格定位到 fixedStat 行

#### Scenario: 资源管理器点击 effect

- WHEN 用户点击 effect 节点
- THEN 系统展开父套装、装备和 effect
- AND 表格定位到 effect 行

### Requirement: Toggle 展示

系统 SHALL 在可展开行显示 `[+] / [-]` toggle。

- 套装行 SHALL 显示 toggle。
- 装备行 SHALL 显示 toggle。
- effect 行 SHALL 显示 toggle。
- fixedStat 行 SHALL NOT 显示 toggle。
- effectLevels 行 SHALL NOT 显示 toggle。

### Requirement: 单元格选择

系统 SHALL 对齐 Sheet-Weapon / Sheet-Buff 的 `selectedWorkbookCell` 选择模型。

#### Scenario: 点击单元格

- WHEN 用户点击任意单元格
- THEN 单元格进入选中状态
- AND 对应行高亮
- AND fx 栏显示该单元格值

#### Scenario: 行定位

- WHEN 资源管理器或右键动作要求定位某行
- THEN 表格滚动到对应行
- AND 选中该行首个可见单元格

### Requirement: 单元格直接编辑

系统 SHALL 支持单击直接编辑当前单元格。

- 可编辑单元格单击后直接显示 input/select/search-select。
- 不可编辑单元格只允许选中，不允许修改。
- 输入框内部 SHALL 拦截 Backspace/Delete/方向键，避免误触发表格导航。

### Requirement: fx 栏编辑

系统 SHALL 实现 Sheet-Weapon / Sheet-Buff 式 fx 栏绑定。

- fx 栏始终显示当前选中单元格值。
- 可编辑单元格可通过 fx 栏修改。
- 不可编辑单元格在 fx 栏只读。
- part 字段在 fx 栏显示 select。
- effect typeKey 在 fx 栏显示 search-select。
- fixedStat typeKey 在 fx 栏显示固定类型 select。
- Enter 提交 fx 栏输入。
- Escape 取消 fx 栏输入并恢复原值。
- blur 时提交 fx 栏输入。

### Requirement: 键盘导航

系统 SHALL 支持表格键盘导航。

- ArrowUp / ArrowDown / ArrowLeft / ArrowRight 在可见单元格间移动。
- 导航范围只包含 visibleRows。
- 方向键跳过被折叠隐藏的行。
- Tab / Shift+Tab 在可见单元格间前后移动。
- Enter 提交当前编辑；非编辑状态下保持当前单元格编辑焦点。
- Escape 取消当前编辑。
- Delete / Backspace 清空当前可编辑单元格。
- ID 字段 SHALL NOT 被清空。
- part 字段 SHALL NOT 被清空，只能在护甲/护手/配件中选择。
- fixedStat.value 和 effect Lv 值 MAY 被清空。
- effect typeKey MAY 被清空，并显示为未映射。

### Requirement: 右键菜单增强

系统 SHALL 对齐 Sheet-Weapon 的右键菜单能力。

#### Blank 右键

- 新建套装
- 全部折叠
- 全部展开

#### 套装行右键

- 新增装备
- 展开/折叠此套装
- 导出当前套装
- 删除套装

#### 装备行右键

- 新增 fixedStat
- 新增 effect
- 展开/折叠此装备
- 复制装备
- 删除装备

#### fixedStat 行右键

- 清空固定数值
- 复制 fixedStat JSON
- 删除 fixedStat

#### effect 行右键

- 展开/折叠等级
- 复制 effect
- 清空 Lv0-Lv3
- 按端点补全 Lv0-Lv3
- 删除 effect

#### effectLevels 行右键

- 清空 Lv0-Lv3
- Lv0 复制到 Lv1-Lv3
- 从 raw 重新解析 Lv0-Lv3
- 复制等级 JSON

### Requirement: 批量编辑

系统 SHALL 支持 effect 等级批量操作。

- 清空 Lv0-Lv3。
- Lv0 复制到 Lv1-Lv2-Lv3。
- 按 Lv0/Lv3 线性补全 Lv1/Lv2。
- 从 raw 重新解析 Lv0-Lv3。
- 批量操作后保持当前 effect 展开并定位到 effectLevels 行。

### Requirement: typeKey 搜索选择

系统 SHALL 将 effect typeKey 从普通 select 升级为 Sheet-Weapon 式 search-select。

- 支持按中文 label 搜索。
- 支持按 typeKey 搜索。
- 支持按关键词搜索。
- 搜索结果显示：`中文 label · typeKey`。
- 允许选择空值，表示未映射。
- 未映射状态应可被清楚看见，但不阻止保存。

## Acceptance Criteria

### AC1: 默认折叠

- 打开 `/sheet-equipment` 后，表格只展示套装行。
- 不展示装备、fixedStat、effect、effectLevels 行。

### AC2: 展开层级正确

- 展开套装后只显示装备。
- 展开装备后显示 fixedStat 和 effect。
- 展开 effect 后显示 Lv0-Lv3 内联等级行。
- fixedStat 永远不显示子级。

### AC3: 表格与资源管理器同步

- 在资源管理器展开/点击节点时，表格同步展开对应父级。
- 表格定位到对应行。
- 表格中的 `[+] / [-]` 状态与资源管理器一致。

### AC4: 单元格编辑

- 点击可编辑单元格后可直接编辑。
- 不可编辑单元格只读。
- 修改后数据立即写入 draft，并标记未保存。

### AC5: fx 栏

- 选中单元格后 fx 栏显示当前值。
- fx 栏修改能同步回单元格。
- typeKey 使用 search-select。
- part 使用护甲/护手/配件 select。

### AC6: 键盘导航

- 方向键、Tab、Shift+Tab 只在 visibleRows 中导航。
- Delete/Backspace 清空规则符合 spec。
- 输入框内部按键不会误触发表格导航。

### AC7: 右键菜单

- blank、套装、装备、fixedStat、effect、effectLevels 均有对应菜单。
- 全部折叠/全部展开可用。
- effect 批量编辑操作可用。

### AC8: 批量编辑

- Lv0 复制到 Lv1-Lv3 可用。
- 按 Lv0/Lv3 线性补全可用。
- 从 raw 重新解析可用。
- 清空 Lv0-Lv3 可用。

### AC9: 构建通过

- 执行 `npm run build` 必须通过。
