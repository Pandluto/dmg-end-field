# Tasks

- [x] Task 1: 对齐现有 Sheet 行展示模型
  - [x] 研究 Sheet-Weapon 的 visibleRows、collapsedDraftIds、collapsedSkills、collapsedLevels。
  - [x] 为 Equipment 建立 collapsedGearSetIds、collapsedEquipmentIds、collapsedEffectIds。
  - [x] 默认全部折叠，只展示套装行。
  - [x] fixedStat 不参与展开。

- [x] Task 2: 重写 Equipment visibleRows
  - [x] 套装折叠时隐藏装备。
  - [x] 装备折叠时隐藏 fixedStat/effect。
  - [x] effect 折叠时隐藏 effectLevels。
  - [x] 确保键盘导航和右键菜单只处理 visibleRows。

- [x] Task 3: 同步资源管理器和表格
  - [x] 资源管理器使用同一套 collapsed state。
  - [x] 点击套装展开套装并定位表格。
  - [x] 点击装备展开父套装和装备并定位表格。
  - [x] 点击 fixedStat/effect 展开父级并定位表格。
  - [x] 表格 toggle 与资源管理器 toggle 状态一致。

- [x] Task 4: 单元格选择与定位
  - [x] 完善 selectedWorkbookCell。
  - [x] 单元格 active 样式对齐 Sheet-Weapon。
  - [x] 行号/行样式跟随选中行。
  - [x] 实现滚动定位到指定 rowKey。

- [x] Task 5: fx 栏编辑
  - [x] 建立 Equipment formulaBinding。
  - [x] 文本字段使用 input。
  - [x] part 使用 select。
  - [x] fixedStat typeKey 使用 select。
  - [x] effect typeKey 使用 search-select。
  - [x] 不可编辑字段只读。
  - [x] Enter/blur 提交，Escape 取消。

- [x] Task 6: 键盘导航
  - [x] Arrow 键在 visibleRows 单元格间移动。
  - [x] Tab / Shift+Tab 移动。
  - [x] Delete / Backspace 清空可编辑字段。
  - [x] ID 不允许清空。
  - [x] part 不允许清空。
  - [x] 输入框内部阻止事件冒泡。

- [x] Task 7: 右键菜单增强
  - [x] blank 菜单：新建套装、全部折叠、全部展开。
  - [x] 套装菜单：新增装备、展开/折叠、导出、删除。
  - [x] 装备菜单：新增 fixedStat、新增 effect、展开/折叠、复制、删除。
  - [x] fixedStat 菜单：清空、复制 JSON、删除。
  - [x] effect 菜单：展开/折叠等级、复制、清空等级、补全等级、删除。
  - [x] effectLevels 菜单：清空、Lv0 复制、raw 解析、复制 JSON。

- [x] Task 8: 批量编辑
  - [x] 清空 Lv0-Lv3。
  - [x] Lv0 复制到 Lv1-Lv3。
  - [x] 按 Lv0/Lv3 线性补全 Lv1/Lv2。
  - [x] 从 raw 重新解析 Lv0-Lv3。
  - [x] 操作后保持定位。

- [x] Task 9: typeKey 搜索选择
  - [x] 复用 Sheet-Weapon search-select 交互模式。
  - [x] 支持中文 label / key / keywords 搜索。
  - [x] 显示 `中文 label · typeKey`。
  - [x] 支持空值未映射。

- [x] Task 10: 验证
  - [x] 默认只显示套装行。
  - [x] 展开折叠层级正确。
  - [x] 资源管理器与表格同步。
  - [x] fx 栏编辑正确。
  - [x] 键盘导航正确。
  - [x] 右键菜单和批量编辑正确。
  - [x] 运行 `npm run build`。
