---
name: game-knowledge
description: 终末地游戏知识库。提供角色定位、配队攻略、排轴循环、装备养成等玩家社区的实战知识。覆盖弭弗、莱万汀(42)、卡缪三大主C的全体系配队，以及玩家俗语、ASR纠错等参考。
slash: false
---

# game-knowledge

Use this skill when the user asks about 终末地 game mechanics, team compositions, character builds, rotation guides, equipment recommendations, or player slang/terminology.

## Knowledge Architecture

This skill distills game knowledge from 月咒's strategy video transcripts, organized into five layers (inspired by 女娲.skill's distillation methodology):

| Layer | Content | Files |
|-------|---------|-------|
| **怎么说话** | Player slang, nicknames, ASR error patterns | `references/glossary.md` |
| **怎么打** | Rotation cycles, burst sequences, skill combos | 10 team guide files |
| **怎么配** | Equipment sets, weapon priority, stat thresholds | Each guide's equipment section |
| **怎么判断** | Hot-start vs cold-start, boss-specific adaptations | Each guide's tactics section |
| **什么不换** | Core characters that cannot be substituted | Each guide's team overview |

## Trust Order

1. DEF typed tools (`def.workbench.*`, `def.character.resolve`, `def.buff.resolve`, etc.) for real-time game state.
2. This skill's `references/` for verified player-community knowledge.
3. External game databases (wiki, AKEDatabase) as fallback.

## Core Rules

- When the user asks about team building, rotation, or equipment, consult the relevant guide in `references/` first.
- Use `glossary.md` to resolve player nicknames (e.g., "42" → 莱万汀/史尔特尔, "小羊" → 艾尔黛拉) and correct common ASR errors before searching.
- Equipment names: note that "三X" means "3 pieces of X set" (e.g., "三动火" = 3 pieces of 动火用). Search for the set name without the number prefix.
- Character names: the streamer may use nicknames or mispronunciations. Cross-reference with `glossary.md` for the official in-game names.
- Do not hardcode character stats, skill multipliers, or equipment values from the guides — they reflect a specific game version and may be outdated. Use DEF typed tools for live data.
- Guide content is advisory — the user may have different roster, resources, or preferences. Present options, not absolutes.

## Reference Files

All game knowledge is stored in `references/`:

| File | Coverage |
|------|----------|
| `glossary.md` | 玩家俗语、角色外号、ASR纠错、装备套装对照 |
| `【配队攻略】卡缪x洛茜x弭弗x骏卫 ...md` | 双先锋无限火力轴 |
| `【配队攻略】莱万汀+卡缪 ...md` | 42火队简易/进阶轴 |
| `【终末地】卡缪 超详细养成配队指南 ...md` | 卡缪全体系概况 |
| `【萌新推荐】弭弗x陈千语x埃特拉x阿列什 ...md` | 低成本碎冰队 |
| `【YZ配队攻略】弭弗x陈千语x黎风x骏卫 ...md` | 传统物理队四碎八猛 |
| `【超级轮椅】弭弗x洛茜x汤汤x陈千语 ...md` | 四连携四大同开轮椅队 |
| `【懒人配队】弭弗x洛茜x洁尔佩塔x佩丽卡 ...md` | 懒人公式化混伤队 |
| `【终末地】弭弗·首发攻略 ...md` | 弭弗技能拆解/全配队 |
| `【1.2最新】莱万汀传统火队 ...安塔尔.md` | 传统火队安塔尔版 |
| `【1.2最新】莱万汀x狼卫x小羊x秋栗 ...md` | 传统火队秋栗版 |

## Procedure

1. Load this Skill, then use `def_data_game_knowledge` once to search only the allowlisted references. It returns stable `referenceId` plus heading/section indexes, not a guide excerpt. For a named four-person guide, its returned title is the roster source: do not read team state merely to confirm it, and never call the guide roster the “current team”. Do not use direct `read`, `glob`, or `grep` on this directory: typed resources are the only available reference readers.
2. Select the exact returned `referenceId` and call `def_data_game_knowledge_section` exactly once with `exactReadPolicy.requiredSectionId`; use `recommendedSection.sectionId` only if no `exactReadPolicy` is present. `exactReadPolicy.maxSectionReads` is a hard limit, not a hint: never read overview or any second section. For a four-person build question, use the matched guide title for the roster rather than spending a section read on an overview. It returns the continuous bounded Markdown section together with `truncated`, `nextSection`, and `availableSections` facts.
3. Make claims only from that exact section. After the section returns, stop data-tool use and answer; “先让我确认” means present this source-faithful draft, not resolve names against the product catalog, describe a future application, request a catalog lookup, or prepare one. If the section does not specify a weapon, slot, threshold, or condition, label it 待确认 rather than filling it from another guide. A truncated section is not complete evidence; report its returned continuation fact instead of guessing.
4. Do not re-search the same guide with aliases, keywords, pinyin, or one-character queries after a reference is found. Do not use direct filesystem tools.
5. Present findings concisely — do not dump entire guide files. If the user's request goes beyond the guides (e.g., real-time game state), fall back to DEF typed tools.
