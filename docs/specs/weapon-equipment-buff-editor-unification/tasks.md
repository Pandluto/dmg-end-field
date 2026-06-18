# 武器 Skill3 与装备三件套 Buff 机制统一 Tasks

## Status

本任务实现 `spec.md` 定义的 GUI 与本地数据链路改造。

已确认边界：

- 本轮同时改造 operator-studio、Sheet-Weapon、Sheet-Equipment。
- 三处完整 Buff 编辑统一使用一个小抽屉。
- 不修改 AI、Agent CLI、fill schema、prompt、validator 或 adapter。
- 不为复杂 Buff 字段增加表格列或嵌套行。
- 武器 Skill3 保留 Lv1-Lv9；装备三件套保持单值。
- 默认不新增测试，以构建和针对性手测为主。

## Tasks

- [x] Task 1: 抽取共享 Buff 领域能力
  - [x] 将与干员来源无关的 Buff 类型、业务类型、来源值、单位、摘要和校验能力整理为共享模块。
  - [x] 保持 operator-studio 旧数据归一化兼容。
  - [x] 为武器等级值和装备单值提供薄适配入口。

- [x] Task 2: 建立共享 Buff 小抽屉
  - [x] 创建可复用抽屉组件。
  - [x] 支持基础字段、业务类型、typeKey 搜索、fixed/derived、countable、multiplier、extraHit、描述和原文。
  - [x] 支持武器 Lv1-Lv9 编辑上下文。
  - [x] 支持 Escape、遮罩关闭和内部滚动。
  - [x] 抽屉不参与来源页面表格布局。

- [x] Task 3: 改造 operator-studio
  - [x] 移除右侧完整 Buff 常驻表单。
  - [x] 保留分组、列表、新增、复制、删除和摘要。
  - [x] 增加“编辑 Buff”入口和双击打开。
  - [x] 新增、复制 effect 后自动打开抽屉。
  - [x] 保持当前分组和选中项。

- [x] Task 4: 扩展武器 Skill3 数据
  - [x] Skill3 effect 支持统一业务字段。
  - [x] 读取旧 effect 时补默认字段并保留未知数据。
  - [x] 定义 Lv1-Lv9 在 fixed/derived/multiplier/extraHit 下的写回规则。
  - [x] 保存、当前草稿和分享导入导出保留完整字段。

- [x] Task 5: 改造 Sheet-Weapon GUI
  - [x] 双击 Skill3 effect 行打开抽屉。
  - [x] 右键菜单增加“编辑 Buff”。
  - [x] 新增、复制 effect 后自动打开抽屉。
  - [x] 表格只显示稳定摘要，不新增复杂字段列。
  - [x] 抽屉关闭后保持行选择和滚动位置。

- [x] Task 6: 扩展装备三件套数据
  - [x] `threePieceBuffs` 支持统一业务字段。
  - [x] `positive` 读取时归一为 `passive`。
  - [x] 旧 `threePieceBuff` 继续归一到 `threePieceBuffs`。
  - [x] 保存、磁盘 JSON、当前草稿和分享导入导出保留完整字段。

- [x] Task 7: 改造 Sheet-Equipment GUI
  - [x] 双击三件套 Buff 行打开抽屉。
  - [x] 右键菜单增加“编辑 Buff”。
  - [x] 新增、复制 Buff 后自动打开抽屉。
  - [x] 复杂字段只在抽屉编辑。
  - [x] 不改变 `threePieceBuffHeader` 和 `threePieceBuff` 行结构。
  - [x] 表格单元格与 fx 栏的业务类型下拉补齐五类统一选项。
  - [x] 新 UI 不再提供 `positive`，仅在旧数据读取时兼容。
  - [x] 除三件套外，普通装备 fixedStat 与 Lv0-Lv3 effect 数值直接读取装备库 JSON，表格、fx 栏和右键菜单不提供手填或清空入口。
  - [x] 三件套数值继续允许通过统一 Buff 抽屉和表格编辑。

- [x] Task 8: 统一下游本地消费
  - [x] 三处 GUI 使用同一领域语义和归一化入口。
  - [x] 补齐武器、装备本地保存中会丢失的新字段。
  - [x] 未修改 AI 入口。

- [x] Task 9: Verification
  - [x] 静态检查三处新增、复制、编辑和删除入口。
  - [x] 类型检查 fixed/derived/countable/multiplier/extraHit。
  - [x] 类型检查武器 Lv1-Lv9 和装备单值适配。
  - [x] 检查旧武器、旧装备与 `positive` category 归一化。
  - [x] 抽屉使用 fixed overlay，不进入表格布局。
  - [x] 检查武器和装备表格残留的旧业务类型下拉并统一。
  - [x] 运行 `npm run build`。
