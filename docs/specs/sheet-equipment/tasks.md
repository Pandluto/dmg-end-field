# Tasks

- [x] Task 1: 研究现有 Sheet 页面
  - [x] 定位 Sheet-Weapon 的工具栏实现，确认 6 个 SVG 按钮的顺序、class、title、active 状态。
  - [x] 定位 Sheet-Weapon 的资源管理器、右键菜单、分享弹窗实现。
  - [x] 重点研究 Sheet-Weapon 的 Lv1-Lv9 内联等级编辑格，提取可复制到 Lv0-Lv3 的实现模式。
  - [x] 定位 Sheet-Buff 的 buff type key 与中文显示 label 来源。

- [x] Task 2: 建立 Equipment 数据模型
  - [x] 定义 EquipmentGearSet、EquipmentItem、EquipmentFixedStat、EquipmentEffect 类型。
  - [x] 定义部位枚举：护甲、护手、配件。
  - [x] 定义 effectId 枚举：effect1、effect2、effect3。
  - [x] 定义 fixedStat typeKey 初版支持：defense，并预留 hp、flatAtk。

- [x] Task 3: 迁移装备数据
  - [x] 从 `reference/source-gear-data.txt` 解析初始装备数据。
  - [x] 生成 `public/data/equipments/equipments.json`。
  - [x] 将防御力等固定属性迁移为 fixedStat。
  - [x] 将可升级属性迁移为 effect1/effect2/effect3。
  - [x] 将 Lv0-Lv3 数值写入 effect.levels。
  - [x] 映射中文属性到 Sheet-Buff typeKey。
  - [x] 对无法识别的 typeKey 保留 label 并提醒人工复核。

- [x] Task 4: 新增路由
  - [x] 新增 `/sheet-equipment` 路由常量。
  - [x] 新增 SheetEquipmentPage 路由判断函数。
  - [x] 在 App 路由中接入 SheetEquipmentPage。

- [x] Task 5: 实现 Sheet Equipment 页面
  - [x] 复制 Sheet-Weapon 页面结构作为独立实现基底。
  - [x] 替换为 Equipment 独立数据模型、storage key、share type。
  - [x] 实现 Sheet-Weapon 一致的 6 个 SVG 工具按钮：新建、保存、整理、保护开/关、导出、导入。
  - [x] 实现资源管理器层级：套装 -> 装备 -> fixedStat/effect。
  - [x] 实现右键菜单，并确保每件装备最多只能新增 1 个 fixedStat。

- [x] Task 6: 实现表格编辑
  - [x] fixedStat 显示单一固定值。
  - [x] effect 使用 Lv0-Lv3 内联编辑格。
  - [x] 支持中文 label + typeKey 编辑。
  - [x] 支持 category 为 ability 或 buff。
  - [x] 限制每件装备最多 1 个 fixedStat、3 个 effect。
  - [x] 限制装备部位只能为护甲、护手、配件。

- [x] Task 7: 实现整理按钮
  - [x] 套装按名称或现有顺序稳定整理。
  - [x] 套装内装备按部位顺序整理：护甲 -> 护手 -> 配件。
  - [x] 装备内 fixedStat 排在 effect 前。
  - [x] effect 按 effect1 -> effect2 -> effect3 顺序整理。

- [x] Task 8: 实现存储与分享
  - [x] 页面启动读取 `public/data/equipments/equipments.json`。
  - [x] localStorage 使用 `def.equipment-sheet.draft.v1` 作为辅助缓存。
  - [x] 本地 JSON 与 localStorage 冲突时提示用户选择。
  - [x] 保存时同步写入 JSON 和 localStorage。
  - [x] Web 环境无法写 JSON 时保存 localStorage 并允许导出。
  - [x] 支持导出当前套装、导出全部装备库、导入装备分享 JSON。

- [x] Task 9: 验证
  - [x] `/sheet-equipment` 可访问。
  - [x] 工具栏与 Sheet-Weapon 6 个 SVG 按钮一致。
  - [x] 资源管理器层级符合套装 -> 装备 -> fixedStat/effect。
  - [x] Lv0-Lv3 编辑行为正常。
  - [x] 固定数值不展示 Lv0-Lv3。
  - [x] 保存、导入、导出正常。
  - [x] 运行 `npm run build` 并确保通过。
