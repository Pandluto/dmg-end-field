# 合成满乘区 SQLite 双跑样本

- 建立日期：2026-08-04
- 基线：`v1.8-LTS@920a6f94`
- 候选：`codex/v1.8-lts-slimming`
- 数据原则：全部为测试专用合成数据，不读取或复制用户存档

## 目的

这套样本补上了旧回归测试最薄弱的一层：不再只验证页面能打开、存档能恢复，也不只让 LTS 与 Slim 互相比较；同一份完整配置必须在纯计算、Local Data 数据包、Timeline archive、浏览器 SQLite、刷新恢复和伤害报告六个阶段保持同一结果，并同时命中独立硬编码金值。

两边即使同时算错，也不能因为“结果相等”而通过。

## 测试专用资源

| 资源 | 内容 | 主要用途 |
| --- | --- | --- |
| 测试满乘区干员 | 完整 90 级属性；A/B/E/Q/Dot 五类技能；额外 `skill-B-2` 双段综合技能；被动、正向和派生属性 Buff | 验证可信技能目录、技能等级、面板和不同 Hit |
| 测试满乘区武器 | 攻击成长、力量、灼热/法术/战技加成；skill3 条件电磁 Buff 和直接倍率候选 | B 技能专门消费武器条件 Buff |
| 四件测试装备 | 测试配件一、测试配件二、测试护甲、测试护手 | 分别提供物理、连携技、所有技能和失衡加成 |
| 测试三件套 | 攻击、全伤、源石技艺、自然条件四项效果 | E 技能专门消费三件套条件 Buff |
| 两组测试 Buff | 综合满乘区组、按技能目标组 | 分开验证公式完整性和目标筛选 |

## 技能与 Buff 分工

| 技能 | 命中内容 | 明确不应命中 |
| --- | --- | --- |
| A 普通攻击 | 默认生效 Buff；第二段按 `damageKey` 命中物理 Buff | 电磁元素 Buff |
| B 战技 | 测试武器提供的电磁条件 Buff | 只针对 Q 的 Buff |
| E 连携技 | 测试三件套提供的自然条件 Buff | 寒冷元素 Buff |
| Q 终结技 | 寒冷元素 Buff | 只针对 B 的 Buff |
| Dot 持续伤害 | 只针对 Dot 的灼热 Buff | 不存在的 Hit key |
| B2 综合技能 | 灼热 B 段与物理 E 段共同消费完整满乘区 Buff | 无；用于公式总验收 |

每个 A/B/E/Q/Dot 按钮只选择三条定向 Buff，不借用综合按钮的 Buff 列表。测试同时检查应命中的 Buff 至少出现在一个 Hit，明确不命中的 Buff 在全部 Hit 中都不存在。

## Buff 形态与公式覆盖

| 形态 | 固定样本 |
| --- | --- |
| 条件触发 | 元素、技能类型和伤害段 key 三种目标 |
| 默认触发 | `category=passive` |
| 可叠层 | `combo-countable`，上限 3 层，测试明确选择 2 层，结果为 `0.06 × 2 = 0.12` |
| 数值派生 | `combo-derived`，按攻击 `2400 × 0.000025 = 0.06`；另验证干员敏捷派生攻击 |
| 直接乘系数 | 多个 `multiplier.coefficient`，包括技能倍率和元素/易伤/脆弱/增幅乘区 |

综合技能让以下最终公式因子全部处于非默认状态：攻击、技能倍率、暴击、伤害加成、防御、抗性、增幅、易伤（Fragile）、脆弱（Vulnerability）、连击和失衡。纯计算合同还逐层固定 `base`、`afterCrit`、`afterBonus`、`afterDefense`、`afterResistance`、`afterAmplify`、`afterFragile`、`afterVulnerability`、连击后结果与最终值。

## 三层证据

| 层级 | 文件 | 验证内容 |
| --- | --- | --- |
| 独立公式金值 | `skillDamageFullMultiplier.fixture.ts/.test.ts` | 满乘区的面板、五个公开乘区、抗性、隐藏连击/失衡步骤和最终伤害 |
| 完整数据资料 | `skillDamageFullMultiplierData.fixture.ts/.test.ts` | 专用干员/武器/装备/三件套、技能目录、Buff library、refCount、Timeline payload、Local Data archive 和各技能金值 |
| 真实浏览器双跑 | `syntheticRegressionArchiveHarness.ts` + `lts-dual-run.spec.ts` | 保存并应用 Local Data 包、转 Timeline archive 为 SQLite、激活、整页刷新、恢复 6 个按钮、读取结构化伤害报告，再分别对硬金值和两侧公共 observation 作校验 |

浏览器测试使用隔离 context。测试数据只写入该 context 的 IndexedDB/存储，不接触开发者真实浏览器资料。

## 本轮实际结果

| 命令 | 结果 |
| --- | --- |
| 两份满乘区纯合同 | 通过 |
| `npm run typecheck` | 通过 |
| `npm test` | 通过，包含两份新合同 |
| `npm run check` | 通过；554 tracked、0 vulnerabilities、244 modules、atomic shell `7049e002817b1071` / 37 files |
| `npm run test:regression:dual` | 身份锁定 3030/3040 后通过；`1 passed (38.6s)` |

双跑最终确认：LTS 与 Slim 的数据包计数、SQLite 摘要、专用资源、Buff 定义、6 个技能、每段命中 Buff、抗性、五个公开乘区、非暴击伤害、期望伤害和总伤害完全相等；所有数值同时符合硬编码 golden。

## 以后如何复用

1. 日常公式改动先运行 `npm test`；专门调试时只执行两份 `skillDamageFullMultiplier*.test.ts`。
2. LTS/Slim 封版时固定 3030 为基线、3040 为候选，执行 `npm run test:regression:dual`。
3. 新增乘区、Buff 形态或目标规则时，优先扩展同一测试干员和同一数据包，不再复制另一套存档。
4. 公式有意变更时，必须先人工核对中间链，再更新硬编码 golden；禁止在测试运行时从被测实现动态生成期望值。

这套样本证明的是计算和浏览器 SQLite 恢复链。真实用户 profile 原位升级、SQLite 文件选择器往返、双标签并发和生产 Service Worker 断网仍属于独立平台终验。
