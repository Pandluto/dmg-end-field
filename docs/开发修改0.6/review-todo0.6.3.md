# review-todo0.6.3

## [任务理解]

- 本轮不是改沙盒，不是改拖拽，不是改模板缓存职责。
- 本轮要改的是 **SkillButton 伤害弹窗**，把它从“技能主导”改成“hit 主导”。
- 当前官方角色伤害弹窗仍直接读取 `public/data/characters/<角色名>/<角色名>max.json`，没有走 `sessionStorage['ddd.operator-runtime.template-map.v1']`。
- 当前伤害计算器仍是“整技能共用一锅 Buff 汇总”，而你现在要求的是：
  - 一个技能下有多个 hit
  - 每个 hit 自己决定吃哪些 Buff
  - 每个 hit 自己有元素、skillType、倍率、乘区、脆弱、易伤、增幅、期望/暴击/不暴结果
  - UI 层也要以 hit 为主，而不是技能为主

---

## [当前代码事实]

### 1. 官方角色伤害弹窗当前仍直连 `max.json`

文件：[src/components/CanvasBoard/SkillButton.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/SkillButton.tsx)

当前事实：

- `loadCharacterSkillData()` 仍然存在
- 读取路径是：

```ts
fetch(`/data/characters/${encodeURIComponent(characterName)}/${encodeURIComponent(characterName)}max.json`)
```

- 弹窗伤害区仍通过：
  - `skillKeyMap = { A: normalAttack, B: skill, E: chainSkill, Q: ultimate }`
  - `skillLevelModeMap[skillType] -> '9' | 'M3'`
  - `skillData?.damage?.[levelKey]`
  得到伤害数据

这说明：

- 官方角色当前走的是 **本地 data 文件链**
- 不是运行时模板缓存链
- 本地自定义角色理论上也会走这条 fetch 链，但本地角色没有对应 `max.json`，这条链本来就不是统一结构

结论：

- **主修复点 1**：必须取缔 `SkillButton.tsx` 中的 `fetch max.json` 逻辑
- 弹窗数据源必须统一切到：
  - `getRuntimeOperatorTemplateById(button.characterId)`
  - 再定位到 `RuntimeOperatorTemplateSkill`

---

### 2. 当前伤害计算器仍然是“技能主导”

文件：[src/core/calculators/skillButtonDamageCalculator.ts](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/core/calculators/skillButtonDamageCalculator.ts)

当前输入结构：

```ts
export interface SkillButtonDamageInput {
  buffList: SkillButtonBuff[];
  characterElement?: string;
  skillType: string;
  levelKey: string;
  damage: Record<string, number>;
  panelData: ...;
  infoSnap: Record<string, number>;
}
```

当前计算流程：

1. `calculateBuffTotals(buffList)`：先把所有 Buff 一次性汇总
2. 统一算：
   - `elementDmgBonus`
   - `skillDmgBonus`
   - `damageBonusRate`
   - `amplifyRate`
   - `fragileRate`
   - `vulnerabilityRate`
3. `processDamageMultiplier(damage, ...)`：对整个技能伤害倍率处理
4. 遍历 hit key 生成 `hitResults`

当前结果结构：

```ts
export interface SkillButtonDamageResult {
  buffTotals: BuffCalculationResult;
  elementDmgBonus: number;
  skillDmgBonus: number;
  ...
  hitResults: HitResult[];
  totalExpected: number;
  totalCrit: number;
  totalNonCrit: number;
}
```

这说明：

- 虽然最后能列出多个 `hitResults`
- 但这些 hit 本质上仍然共用一套技能级 Buff 上下文
- 这不是“hit 主导”，只是“技能结果里挂多个 hit”

结论：

- **主修复点 2**：计算器输入和输出结构都要改
- 必须从：
  - `damage: Record<string, number>`
  - `buffTotals` 整体汇总
  切到：
  - `hits[]`
  - `每个 hit 单独过滤 Buff`
  - `每个 hit 单独生成 buffTotals 和各区倍率`

---

### 3. `multiplierBonus / multiplierMultiplier` 现在还是旧逻辑：默认只改最后一段

文件：[src/core/calculators/skillButtonDamageCalculator.ts](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/core/calculators/skillButtonDamageCalculator.ts)

当前事实：

- `processDamageMultiplier()` 会从 `damage` 里找所有 hit key
- 然后只改 `lastHitKey`

这条逻辑的旧假设是：

- 技能倍率附加默认给最后一段

但你当前要的结构是：

- Buff 可以指向某个特定 hit
- 也可以作用于所有 hit
- 不允许继续用“默认改最后一段”这种技能级补丁逻辑

结论：

- **主修复点 3**：这条逻辑必须废掉
- 改成每个 hit 单独决定是否吃 multiplier 类 Buff

---

### 4. `SkillButtonBuff` 目前没有 hit 作用域表达能力

文件：[src/types/storage.ts](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/types/storage.ts)

当前 `SkillButtonBuff` 结构只有：

- `id`
- `name`
- `displayName`
- `sourceName`
- `type`
- `value`
- `description`
- `source`
- `condition`
- `refCount`

没有：

- 指向哪个 hit
- 指向哪个 `damageKey`
- 指向哪个 `skillType`
- 指向哪个 `element`

这意味着：

- 即便你把计算器改成 per-hit
- Buff 本身也没法表达“只作用 hit2”

结论：

- **主修复点 4**：必须先扩 `SkillButtonBuff` 的 target 结构

---

### 5. 弹窗 UI 现在仍是“技能总览 + 技能展开”，不是“hit 列表 + hit 详情”

文件：[src/components/CanvasBoard/SkillButton.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/SkillButton.tsx)

当前事实：

- 顶部标题：`技能伤害`
- 中间按 `hitResults` 渲染 `1hit / 2hit / 3hit`
- 详细区受一个 `isExpanded` 布尔值控制
- 展开后是整个技能统一的计算过程区域，再附加每个 hit 的明细块

这说明：

- 现在 UI 的主语还是技能
- hit 只是技能内部的一组结果
- `isExpanded` 也还是技能级状态，不是 hit 级状态

你现在要的是：

- 顶部仍可保留技能汇总
- 但中间必须是 **hit 列表**
- 下面必须是 **当前选中 hit 的详情**
- `hit1` 点开看 `hit1`
- `hit2` 点开看 `hit2`
- 不是“整个技能一起展开”

结论：

- **主修复点 5**：`SkillButton.tsx` 的弹窗结构必须重排

---

## [当前结论]

- 当前伤害弹窗链仍是旧链：
  - 官方角色：`max.json`
  - 计算器：技能主导
  - UI：技能主导
- 你现在要的不是“把每个 hit 列出来”，而是：
  - **数据结构 hit 主导**
  - **计算 hit 主导**
  - **UI 展示 hit 主导**
- 本轮不能只改其中一层。

必须按这个顺序做：

1. 扩 `SkillButtonBuff.target`
2. 改计算器输入/输出
3. 改 SkillButton 弹窗数据源
4. 改 SkillButton 弹窗 UI 结构

---

## [必须改]

### 1. 取缔 `SkillButton.tsx` 里的 `max.json` 数据链

文件：[src/components/CanvasBoard/SkillButton.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/SkillButton.tsx)

#### 问题

- `loadCharacterSkillData()` 仍然直接 fetch 官方 `max.json`
- 这让官方角色和本地角色无法走统一模板层

#### 原因

- 旧伤害弹窗默认认为“技能详情一定来自官方四槽 JSON”

#### 修正要求

- 删除：
  - `characterSkillData` state
  - `loadCharacterSkillData()`
  - `useEffect` 里对 `loadCharacterSkillData()` 的调用
- 新增一个统一解析入口，例如：

```ts
function resolveRuntimeSkillTemplate(
  button: SkillButtonType
): RuntimeOperatorTemplateSkill | null
```

解析顺序：

1. `getRuntimeOperatorTemplateById(button.characterId)`
2. 若存在 `button.runtimeSkillId`
   - `template.skills.find(skill => skill.id === button.runtimeSkillId)`
3. 否则 fallback：
   - `template.skills.find(skill => skill.buttonType === button.skillType)`

#### 验证方式

- 官方角色打开弹窗时，不再发起 `fetch ...max.json`
- 本地角色打开弹窗时，也能拿到技能与 hit 数据

---

### 2. 重新定义伤害计算输入：从 `damage` 切到 `hits[]`

文件：[src/core/calculators/skillButtonDamageCalculator.ts](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/core/calculators/skillButtonDamageCalculator.ts)

#### 问题

- 当前输入核心还是：
  - `skillType`
  - `damage: Record<string, number>`

#### 原因

- 这是旧四槽官方技能 + 技能主导伤害模型

#### 修正要求

新的输入结构至少改成：

```ts
export interface SkillButtonDamageInput {
  buffList: SkillButtonBuff[];
  hits: RuntimeOperatorTemplateHit[];
  panelData: ...;
  infoSnap: Record<string, number>;
}
```

说明：

- `hits[]` 里的每个 hit 已经包含：
  - `key`
  - `displayName`
  - `multiplier`
  - `element`
  - `skillType`
- 计算器不再依赖 `levelKey` 去查 `damage[levelKey]`

#### 验证方式

- 计算器可以直接吃本地角色 `customHits`
- 也可以直接吃官方角色模板里的 `skills[].hits`

---

### 3. 重写伤害计算结果结构：hit 为主，summary 为辅

文件：[src/core/calculators/skillButtonDamageCalculator.ts](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/core/calculators/skillButtonDamageCalculator.ts)

#### 问题

- 当前返回值顶层仍是技能级字段，再挂 `hitResults[]`

#### 原因

- 旧结构默认“技能主语”

#### 修正要求

推荐结果结构：

```ts
export interface HitDamageResult {
  hit: RuntimeOperatorTemplateHit;
  appliedBuffs: SkillButtonBuff[];
  buffTotals: BuffCalculationResult;
  elementDmgBonus: number;
  skillDmgBonus: number;
  allDmgBonus: number;
  damageBonusRate: number;
  amplifyRate: number;
  fragileRate: number;
  vulnerabilityRate: number;
  comboDamageBonus: number;
  defenseZone: number;
  nonCrit: DamageBreakdown;
  crit: DamageBreakdown;
  expected: DamageBreakdown;
}

export interface SkillButtonDamageResult {
  hits: HitDamageResult[];
  summary: {
    totalExpected: number;
    totalCrit: number;
    totalNonCrit: number;
  };
}
```

要求：

- 顶层不再保留整技能唯一 `buffTotals`
- 每个 hit 有自己的 `buffTotals`
- summary 只做总伤汇总

#### 验证方式

- 任意一个 hit 都可以独立表达完整计算链

---

### 4. Buff 过滤改成 per-hit，先过滤再汇总

文件：

- [src/core/calculators/skillButtonDamageCalculator.ts](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/core/calculators/skillButtonDamageCalculator.ts)
- [src/core/calculators/buffCalculator.ts](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/core/calculators/buffCalculator.ts)

#### 问题

- 当前先 `calculateBuffTotals(buffList)` 一次汇总，然后所有 hit 共用

#### 原因

- 旧模型默认 buff 对整技能生效

#### 修正要求

新增一个 hit 级过滤函数，例如：

```ts
function filterBuffsForHit(
  hit: RuntimeOperatorTemplateHit,
  buffList: SkillButtonBuff[]
): SkillButtonBuff[]
```

每个 hit 的流程改成：

1. `appliedBuffs = filterBuffsForHit(hit, buffList)`
2. `buffTotals = calculateBuffTotals(appliedBuffs)`
3. 用这个 hit 自己的 `buffTotals` 算：
   - 元素加成
   - 技能加成
   - 脆弱
   - 易伤
   - 增幅
   - 倍率修正
4. 输出该 hit 的完整结果

#### 验证方式

- 只命中 `hit2` 的 Buff 不影响 `hit1/hit3`

---

### 5. 扩展 `SkillButtonBuff`：必须有 target 结构

文件：[src/types/storage.ts](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/types/storage.ts)

#### 问题

- 当前 Buff 没有作用域字段，无法表达“只作用 hit2”

#### 原因

- 旧模型只服务整技能

#### 修正要求

至少新增：

```ts
target?: 
  | { mode: 'all' }
  | { mode: 'damageKey'; key: string }
  | { mode: 'skillType'; skillType: SkillType }
  | { mode: 'element'; element: ElementType }
```

要求：

- `mode: 'all'` 表示整技能所有 hit 都吃
- `mode: 'damageKey'` 表示只吃某个 hit，如 `hit2`
- `mode: 'skillType'` 表示只吃某种乘区 hit
- `mode: 'element'` 表示只吃某种元素 hit

这轮先不要求做更复杂组合逻辑。

#### 验证方式

- 一个 `multiplierBonus` 可以稳定保存为：

```json
{
  "type": "multiplierBonus",
  "value": 0.4,
  "target": {
    "mode": "damageKey",
    "key": "hit2"
  }
}
```

---

### 6. 废掉“默认改最后一段”的 `processDamageMultiplier()` 逻辑

文件：[src/core/calculators/skillButtonDamageCalculator.ts](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/core/calculators/skillButtonDamageCalculator.ts)

#### 问题

- 当前 multiplier 类 Buff 默认打到最后一个 hit

#### 原因

- 这是旧技能级补丁逻辑

#### 修正要求

- 删除这条“只改最后一段”的实现
- 改成 per-hit：
  - 若该 hit 命中 multiplier 类 Buff，则对该 hit 的 `multiplier` 进行先加后乘
  - 若 Buff `target.mode === 'all'`，则所有 hit 都处理

推荐新增：

```ts
function applyMultiplierBuffToHit(
  hit: RuntimeOperatorTemplateHit,
  buffTotals: BuffCalculationResult
): number
```

返回该 hit 最终用于结算的倍率值。

#### 验证方式

- `target = hit2` 的 multiplier buff 只改 hit2
- 不再默认影响最后一段

---

### 7. SkillButton 弹窗 UI 改成“三段式”：技能总览 / hit 列表 / hit 详情

文件：

- [src/components/CanvasBoard/SkillButton.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/SkillButton.tsx)
- [src/components/CanvasBoard/SkillButton.css](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/SkillButton.css)

#### 问题

- 当前 UI 只有一个 `isExpanded`
- 展开后还是整个技能一起看

#### 原因

- 展开状态和数据结构都还是技能级

#### 修正要求

新增状态：

```ts
const [selectedDamageHitKey, setSelectedDamageHitKey] = useState<string | null>(null);
```

推荐 UI 结构：

#### 7.1 顶部：技能总览

- 技能名
- `skillType`
- 总期望
- 总暴击
- 总不暴

#### 7.2 中部：hit 列表

每个 hit 一张卡，展示：

- `displayName`
- `key`
- `element`
- `skillType`
- `multiplier`
- 期望
- 暴击
- 不暴

点击某个 hit：

- `setSelectedDamageHitKey(hit.hit.key)`

#### 7.3 底部：hit 详情

只展示当前选中 hit 的：

- 命中的 Buff
- `buffTotals`
- 元素加成区
- 技能加成区
- 全伤区
- 脆弱区
- 易伤区
- 增幅区
- 防御区
- 最终伤害公式

#### 验证方式

- `hit1` 点开只看 `hit1`
- `hit2` 点开只看 `hit2`
- 不再是“技能整体展开”

---

### 8. SkillButton 弹窗标题和汇总语义要降级，避免继续误导成“技能级公式”

文件：[src/components/CanvasBoard/SkillButton.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/SkillButton.tsx)

#### 问题

- 当前标题是 `技能伤害`
- 用户会默认这是整技能统一公式

#### 修正要求

正文结构改为：

- `技能总览`
- `Hit 列表`
- `Hit 详情`

可以保留总伤汇总，但详细区必须明确是 hit 主语。

#### 验证方式

- 用户一眼能分清：
  - 上面是整技能汇总
  - 下面是单个 hit 的具体计算链

---

## [可选优化]

- 可选 1：
  - 在 hit 卡片上直接显示“命中的 Buff 数量”
- 可选 2：
  - 在 hit 详情区显示“该 hit 的 target 规则命中了哪些 Buff”

没有就先不做。

---

## [不要动]

- 不要改 `SelectionPanel`
- 不要改 `SkillSandbox` 分页布局
- 不要改拖拽吸附、复制、恢复位置逻辑
- 不要把 `ddd.operator-runtime.template-map.v1` 又改回全量角色仓库
- 不要顺手重写 `buffService` 的引用计数模型
- 不要回头再读 `max.json`

---

## [分阶段执行顺序]

### 阶段 1：先改数据结构，不碰大 UI

目标：

- `SkillButtonBuff.target` 落地
- `SkillButtonDamageInput` 改为 `hits[]`
- `SkillButtonDamageResult` 改为 `hits + summary`

产物：

- `types/storage.ts`
- `skillButtonDamageCalculator.ts`

### 阶段 2：切弹窗数据源

目标：

- `SkillButton.tsx` 不再 fetch `max.json`
- 统一从 `runtime template map` 解析当前技能

### 阶段 3：切 hit 主导 UI

目标：

- 顶部技能总览
- 中部 hit 列表
- 底部 hit 详情

### 阶段 4：最后再扩 Buff 展示细节

目标：

- 显示命中 Buff
- 显示 per-hit 公式详情

---

## [验收标准 AC]

- AC1：SkillButton 伤害弹窗不再请求 `/data/characters/<角色名>/<角色名>max.json`
- AC2：官方角色和本地角色都从 `ddd.operator-runtime.template-map.v1` 读取技能与 hit 数据
- AC3：计算器输入结构以 `hits[]` 为主，不再以 `damage: Record<string, number>` 为主真相
- AC4：每个 hit 有独立的 `appliedBuffs`、`buffTotals`、加成区、脆弱区、易伤区、增幅区、期望/暴击/不暴
- AC5：`multiplierBonus` / `multiplierMultiplier` 不再默认只作用最后一段
- AC6：UI 可以单独点开 `hit1` / `hit2` / `hit3` 查看各自详情
- AC7：只作用于 `hit2` 的 Buff 不影响 `hit1`
- AC8：顶部仍保留技能总伤汇总，但正文主语已切为 hit
- AC9：`npm run build` 通过

---

## [回归检查项]

1. 官方角色伤害弹窗
   - 选一个官方角色
   - 拖一个技能按钮到画布
   - 双击打开弹窗
   - 确认不再 fetch `max.json`

2. 本地角色伤害弹窗
   - 选一个本地多技能角色
   - 拖一个带多个 hit 的技能按钮到画布
   - 打开弹窗
   - 能看到 hit 列表和详情

3. 同技能多 hit 不同乘区
   - 让某技能：
     - `hit1.skillType = A`
     - `hit2.skillType = B`
   - 打开弹窗
   - 确认两个 hit 的技能加成区不同

4. 只作用 hit2 的 Buff
   - 人工塞一个：

```json
{
  "type": "multiplierBonus",
  "value": 0.4,
  "target": {
    "mode": "damageKey",
    "key": "hit2"
  }
}
```

   - 打开弹窗
   - 确认只有 hit2 伤害变化

5. 官方 + 本地统一链
   - 官方角色和本地角色都走 `runtime template map`
   - UI 行为一致

---

## [给 Trae 的执行指令]

1. 先改 [src/types/storage.ts](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/types/storage.ts)
   - 给 `SkillButtonBuff` 增加 `target` 结构
2. 再改 [src/core/calculators/skillButtonDamageCalculator.ts](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/core/calculators/skillButtonDamageCalculator.ts)
   - 输入改成 `hits[]`
   - 输出改成 `hits + summary`
   - 每个 hit 单独过滤 Buff、单独汇总各区倍率
   - 删除“默认改最后一段”的 `processDamageMultiplier()` 逻辑
3. 再改 [src/components/CanvasBoard/SkillButton.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/SkillButton.tsx)
   - 删除 `characterSkillData` 和 `loadCharacterSkillData()`
   - 从 `getRuntimeOperatorTemplateById(button.characterId)` 解析当前技能模板
   - 新增 `selectedDamageHitKey`
   - UI 改成“技能总览 / hit 列表 / hit 详情”
4. 最后改 [src/components/CanvasBoard/SkillButton.css](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/SkillButton.css)
   - 补 hit 卡片和 hit 详情区样式
5. 完成后必须回报：
   - 删除了哪些 `max.json` 读取代码
   - 新的 `SkillButtonBuff.target` shape
   - 新的 `SkillButtonDamageInput` / `SkillButtonDamageResult` shape
   - 一个只作用 `hit2` 的 Buff 验证结果
   - `npm run build` 结果
