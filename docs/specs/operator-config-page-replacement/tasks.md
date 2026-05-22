# OperatorConfigPage 替代 Panel 大型接入 Tasks

## Status

本任务拆分用于推进 `OperatorConfigPage` 对旧 `OperatorConfigPanel` 的替代开发，当前以页面接入、缓存重构、数据链路打通和选择器交互为主。

## Tasks

- [ ] 确认 `OperatorConfigPage` 作为新的角色配置主页面，不再继续扩展旧 panel。
- [ ] 建立按角色 `id` 组织的总缓存对象结构。
- [ ] 使用 `sessionStorage` 作为 `OperatorConfigPage` 的页面恢复与跨界面读取缓存。
- [ ] 为缓存总对象补齐 `character / weapon / equipment / skills / panel` 五块顶层结构。
- [ ] 实现 `character.id / config / data` 结构。
- [ ] 实现 `weapon.id / config / data` 结构。
- [ ] 实现 `equipment` 按 `2` 个配件位、`1` 个护甲位、`1` 个护手位的固定结构。
- [ ] 实现 `skills.id / config / data` 结构。
- [ ] 为 `character.config` 接入角色等级与角色潜能字段。
- [ ] 为 `weapon.config` 接入武器等级、武器潜能、武器 skill1-3 等级字段。
- [ ] 为 `equipment` 单件结构接入 `id / entryCount / entries / config / data`。
- [ ] 为装备词条结构接入 `id / config / data`。
- [ ] 将单个装备词条 `config` 收敛到“词条档位”字段。
- [ ] 将 `skills.config` 固定为 `A / B / E / Q` 四键结构。
- [ ] 接入 `operator-draft` 角色原始数据到 `character.data`。
- [ ] 接入 `weapon sheet` 武器原始数据到 `weapon.data`。
- [ ] 接入 `sheet-equipment` 装备原始数据到 `equipment.data`。
- [ ] 接入 `operator-draft` 技能原始数据到 `skills.data`。
- [ ] 建立 `operator-draft` skill 到 `A / B / E / Q` 的分类映射逻辑。
- [ ] 接入现有选人界面预留接口，完成角色切换无缝接入。
- [ ] 将武器区预留图片区域接成武器选择入口按钮。
- [ ] 实现武器选择弹窗，并在选择后回写 `weapon.id / data / config`。
- [ ] 将装备区预留图片区域接成装备选择入口按钮。
- [ ] 实现装备选择弹窗，并在选择后回写对应装备位的 `id / data / config`。
- [ ] 让武器和装备选择弹窗的结构与交互对齐 `sheet-weapon` 的 `imgUrl` 选择弹窗。
- [ ] 保留 CTI 只做搜索输入，不直接承担选择动作。
- [ ] 让 CTI 输入词参与角色、武器、装备候选项筛选。
- [ ] 实现页面内任意配置修改后立即写入 `sessionStorage`。
- [ ] 实现切换角色时先检查 `sessionStorage`，存在则恢复，不存在则初始化。
- [ ] 实现首次选择武器时写入武器初始值。
- [ ] 实现首次选择装备时写入装备初始值。
- [ ] 固定角色默认初始值为 `90 / 0潜`。
- [ ] 固定武器默认初始值为 `90 / 0潜 / 9 / 9 / 4`。
- [ ] 固定装备默认词条档位为 `3 / 3 / 3`。
- [ ] 固定技能默认初始值为 `A / B / E / Q` 全部 `M3`。
- [ ] 补齐 `OperatorConfigPage` 当前各占位区域与真实数据的联动渲染。
- [ ] 回归验证角色切换、武器切换、装备切换、技能修改、刷新恢复行为。
- [ ] 保留 `panel` 结构占位，但暂不展开细化字段设计。
- [ ] 记录主界面对新缓存读取链路的后续对齐事项。
