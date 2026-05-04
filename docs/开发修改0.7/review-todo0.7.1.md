[Review 结论]

- 本轮 `0.7.1` 只接受 **UI 演示版**，不接受数据链路版。
- 阻塞点不是公式没接，也不是缓存没落，而是当前双击弹窗结构里 **根本没有 `异常伤害` 这一层 UI 容器**。
- Trae 本轮只能改：
  - `src/components/CanvasBoard/SkillButton.tsx`
  - `src/components/CanvasBoard/SkillButton.css`
- 任何对以下文件的改动都视为越界：
  - `src/core/services/*`
  - `src/core/repositories/*`
  - `src/hooks/useSkillButtonBuffs.ts`
  - `src/constants/storage-keys.ts`
  - `src/types/storage.ts`

[问题列表]

1. P0：双击弹窗结构缺少 `异常伤害` 容器，当前无法承载 0.7.1 UI 演示
   - 文件：
     - `src/components/CanvasBoard/SkillButton.tsx`
   - 函数：
     - `SkillButtonComponent()`
   - 调用链：
     - 技能按钮双击
     - `handleClick()`
     - `setIsModalOpen(true)`
     - `isModalOpen && <div className="skill-button-modal-overlay">...`
   - 原因：
     - 当前 JSX 在 `skill-button-modal-pair` 下只渲染 3 个弹窗：
       - `技能信息`
       - `技能伤害`
       - `信息`
     - 代码位置明确在 `SkillButton.tsx` 约 `452-640` 行附近。
     - 本轮如果不先把第 2 个弹窗腾出来，后续异常树、来源角色抽屉、蓝框已选项都无处安放。
   - 影响：
     - `0.7.1` 无法演示异常 UI。
     - Trae 容易误判成“先接 service 再补界面”。
   - 修正要求：
     - 在 `技能信息` 和 `技能伤害` 之间新增第 2 个弹窗 `异常伤害`。
     - 顺序必须改成：
       - `技能信息`
       - `异常伤害`
       - `技能伤害`
       - `信息`
     - 当前 `技能信息`、`技能伤害`、`信息` 的现有内容先保留，先插入中间弹窗，不要重写三者。

2. P0：当前弹窗样式仍按 3 栏设计，直接插第 4 栏会挤爆布局
   - 文件：
     - `src/components/CanvasBoard/SkillButton.css`
   - 函数/样式块：
     - `.skill-button-modal-overlay`
     - `.skill-button-modal-pair`
     - `.skill-button-modal`
     - `.skill-button-modal-info`
     - `.skill-button-modal-damage`
     - `.skill-button-modal-info-snapshot`
   - 原因：
     - `.skill-button-modal-overlay` 现在固定 `right: 240px; bottom: 30px;`
     - `.skill-button-modal-pair` 现在是 `display: flex; gap: 0; max-width: calc(100% - 32px);`
     - `.skill-button-modal` 现在固定 `width: 290px;`
     - 3 栏时总宽已接近上限，直接变 4 栏会：
       - 压缩左区可视空间
       - 让最右侧 `信息` 弹窗超界
       - 导致移动端/小屏直接横向截断
   - 影响：
     - UI 演示无法稳定显示 4 个弹窗。
   - 修正要求：
     - 本轮必须先把 4 栏布局改成可演示版本。
     - 可以接受的 UI 方案：
       - 方案 A：4 栏横排，但缩窄每栏宽度并允许内部独立滚动
       - 方案 B：外层横向滚动容器，内部 4 栏固定宽度
     - 不接受：
       - 4 个弹窗继续硬塞原 3 栏宽度
       - 用缩放 transform 糊过去
       - 让 `异常伤害` 覆盖在别的弹窗上

3. P1：`技能信息` 弹窗当前只有 `已选 Buff` 区，没有“异常已选区”占位
   - 文件：
     - `src/components/CanvasBoard/SkillButton.tsx`
     - `src/components/CanvasBoard/SkillButton.css`
   - 函数：
     - `SkillButtonComponent()`
   - 调用链：
     - `isModalOpen`
     - `技能信息` 弹窗
     - `skill-button-buff-section`
   - 原因：
     - 当前信息弹窗下半区只有：
       - 标题 `已选 Buff`
       - 容器 `skill-button-buff-list`
     - 没有任何“异常状态 / 异常伤害”的展示位。
     - 但你已经明确：0.7.1 只是 UI 演示，不要把异常硬塞进普通 Buff 列表。
   - 影响：
     - Trae 如果没有单独占位，最容易把异常项塞回 `已选 Buff` 区，方向会错。
   - 修正要求：
     - 在 `技能信息` 弹窗下半区新增一个独立展示块，占位名直接写清楚：
       - `已选异常`
     - 这里先做纯前端占位卡片，不读 storage。
     - 必须和 `已选 Buff` 分块显示，不能混排一个列表。

4. P1：`异常伤害` 弹窗必须先做树形选择 UI，不要先做公式或存储
   - 文件：
     - `src/components/CanvasBoard/SkillButton.tsx`
   - 函数：
     - `SkillButtonComponent()`
   - 原因：
     - 0.7.1 的目标是演示“用户会怎么点”，不是“点完写到哪”。
     - 当前代码里完全没有：
       - `法术异常 / 物理异常` 分组
       - 异常项勾选
       - 来源角色展开
       - 蓝框已选异常卡片
   - 影响：
     - 如果 Trae 先接计算链，UI 反而没有定型。
   - 修正要求：
     - `异常伤害` 弹窗内部只做 3 块：
       - 上方：异常分类树
       - 中部：异常项配置区
       - 下方：蓝框已选异常卡片区
     - 这 3 块都允许先用本地 mock state 演示。
     - 树至少包含：
       - `法术异常`
         - `导电`
         - `腐蚀`
         - `燃烧`
         - `冻结`
         - `碎冰`
         - `法术爆发`
       - `物理异常`
         - `倒地`
         - `击飞`
         - `碎甲`
         - `猛击`

5. P1：状态型异常和伤害型异常在 UI 上必须拆开展示，不能混成一个列表
   - 文件：
     - `src/components/CanvasBoard/SkillButton.tsx`
     - `src/components/CanvasBoard/SkillButton.css`
   - 原因：
     - 你已经明确过：
       - `导电 / 腐蚀 / 碎甲` 更像异常状态
       - `猛击 / 碎冰 / 法爆 / 倒地 / 击飞` 是异常独立 hit
     - 两者语义不同，后续接链时也不会落到同一套结构。
   - 影响：
     - 如果 UI 先混排，后面再拆数据层一定要返工。
   - 修正要求：
     - `异常伤害` 弹窗底部蓝框必须拆成两块：
       - `已选异常状态`
       - `已选异常伤害`
     - 每块都允许先用 mock card 演示。
     - 卡片展示字段至少要预留：
       - 名称
       - 等级
       - 来源角色（仅状态型）
       - 单次伤害/效果值/持续时间

6. P1：来源角色抽屉只能做 UI 单选演示，不能提前碰角色缓存读取
   - 文件：
     - `src/components/CanvasBoard/SkillButton.tsx`
   - 原因：
     - 0.7.1 你已经明确要求只做 UI。
     - 但异常状态里又必须演示“来源角色选择”。
   - 影响：
     - Trae 最容易顺手去读：
       - `characterConfig.panelSnapshot`
       - `infoSnap`
       - 甚至去补 `源石技艺强度` 存储
     - 这轮全都不该做。
   - 修正要求：
     - `导电 / 腐蚀 / 碎甲` 下允许展开一个 `来源角色` 抽屉。
     - 角色列表本轮只用当前已选角色名做 UI 单选占位。
     - 允许直接从 `selectedCharacters` 取展示名做 mock，不允许接缓存数值。
     - 勾选来源角色后，只更新当前组件本地 state 的显示卡片文案。

7. P2：异常等级 1/2/3/4 的交互必须先做互斥单选，不要做多选
   - 文件：
     - `src/components/CanvasBoard/SkillButton.tsx`
   - 原因：
     - `猛击 / 碎甲 / 导电 / 腐蚀` 等都天然依赖等级档位。
     - UI 上如果不先做互斥，Trae 后面很容易留成 checkbox 多选。
   - 影响：
     - 演示稿会直接表达错业务语义。
   - 修正要求：
     - 同一异常项下的 `1/2/3/4` 必须是互斥单选。
     - 当前只要求 UI 行为正确，不要求数值联动。

[风险列表]

- 风险 1：Trae 顺手把异常项塞进 `已选 Buff` 列表，导致 UI 语义先天错误。
- 风险 2：Trae 顺手新建 `storage key` 或 repository，导致 0.7.1 范围失控。
- 风险 3：Trae 直接在 `SkillButton.tsx` 里把 4 栏硬塞进去，不处理宽度和滚动，演示版会直接不可用。
- 风险 4：Trae 先做假公式再做 UI，最后演示重点反而看不出交互结构。

[回归检查项]

- 双击技能按钮后，原有 `技能信息 / 技能伤害 / 信息` 仍能正常打开。
- 新增 `异常伤害` 后，锁定按钮、关闭按钮、Buff 列表右键删除不受影响。
- `技能伤害` 弹窗的 hit 列表、详情区、展开公式区不回归。
- `信息` 弹窗仍显示 `infoSnapshotLines`，不被新布局挤没。
- 小屏下 4 栏弹窗至少可以完整浏览，不出现关键区域完全不可见。

[给 Trae 的修正 TODO]

1. 先改 `src/components/CanvasBoard/SkillButton.tsx`，在 `skill-button-modal-pair` 里插入第 2 个弹窗 `异常伤害`。
   - 只插 UI 容器。
   - 不接 service，不接 repository，不接 storage。

2. 再改 `src/components/CanvasBoard/SkillButton.css`，把 3 栏弹窗布局改成 4 栏可演示布局。
   - 优先保证可见性和滚动，不追求最终视觉。
   - 不要用覆盖式绝对定位糊过去。

3. 在 `技能信息` 弹窗里新增 `已选异常` 独立区块。
   - 和 `已选 Buff` 分开。
   - 先用本地 mock 数据或空态占位。

4. 在 `异常伤害` 弹窗里实现树形 UI。
   - `法术异常 / 物理异常`
   - 子项展开
   - 等级单选
   - 来源角色抽屉
   - 蓝框已选项

5. 底部蓝框必须拆成两块：
   - `已选异常状态`
   - `已选异常伤害`
   - 先只做 UI 卡片，不接真实公式。

6. 这轮禁止改动：
   - `src/core/services/*`
   - `src/core/repositories/*`
   - `src/constants/storage-keys.ts`
   - `src/types/storage.ts`
   - `src/hooks/useSkillButtonBuffs.ts`

7. 完成后必须提交给我这 6 项结果：
   - `SkillButton.tsx` 弹窗顺序改动点
   - `SkillButton.css` 4 栏布局改动点
   - `异常伤害` 弹窗树形 UI 的截图或结构说明
   - `来源角色` 抽屉 UI 的实际交互说明
   - `已选异常状态 / 已选异常伤害` 两块蓝框卡片的实际展示结果
   - `npm run build` 结果
