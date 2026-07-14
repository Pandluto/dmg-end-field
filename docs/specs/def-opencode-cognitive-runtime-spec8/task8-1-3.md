# Task 8-1-3：首次真实会话诊断与教学返修

## 状态

实施中。首个真实 failure 已完成观察、最小 runtime/tool 修复、Harness candidate 与原始 replay；尚未人工 promotion，也未宣称 Spec 8-1-3 完成。

## 范围与边界

- 原始会话及其导出只在本机只读诊断，绝不提交 transcript、reasoning 或用户数据。
- 复现只用新 native Session 与 runner 拥有的隔离 fixture。
- 只读 catalog/knowledge 查询不能改当前阵容；任何实际阵容或排轴改动仍必须经过 draft、validate、diff、approval/use。
- 不修改 vendor OpenCode、verifier、安全定义或 8-1-2 stable channel；不自动 promotion。

## 本轮清单

- [x] 冻结真实 baseline session 的只读证据并定位 primary cause。
- [x] 将 selected roster resolver 的 scope/source/exhaustive 写入真实 contract/result。
- [x] 新增与选人界面同源的有界只读 catalog resource。
- [x] 新增 allowlisted、bounded game-knowledge resource，保持任意文件读取拒绝。
- [x] 创建完整八 Slot teaching candidate 与脱敏 Scenario。
- [x] 以 v1 新 Session 完成 selected-vs-catalog 多轮 replay。
- [x] 以 v1 新 Session 完成 skill reference readable replay。
- [x] 确认只读 replay state before/after 相同且没有 `def_node_use`。
- [x] 用 Computer Use 确认重载后的真实 Workbench AI iframe。
- [x] 修复第二个真实 failure：`def.weapon.resolve` 已从“当前已装配武器”改为读取干员配置页同源的 `def.weapon-sheet.library.v1`，并返回 `scope/source/catalogCount/exhaustive`，不会再把空装备状态误报成武器库为空。
- [x] 修复第二个真实 Harness failure：旧 Work Node `inputs.json` 里的猜测字段（`weaponId`、`weaponSkillKey`、`gearSetId`、`equipmentIds`）现在会被语义校验拒绝；当前 Workbench snapshot 会同时读取 `sessionStorage.def.operator-config.character-input-map.v3` 与 `sessionStorage.def.operator-config.page-cache.v1`，不再把真实角色配置页状态丢成空对象。
- [x] 新增受控的 `def_operator_config_patch` native route。它只在用户确认后排入真实 CanvasBoard 配置命令；武器与装备组合使用单一 `setOperatorConfig` 命令、一次 checkout 持久写入，并同时核对 live mirror 与 checkout payload。队列确认、Work Node validate/diff 均不再作为成功证据。
- [x] 修复该 route 的 approval 归属：角色配置是 renderer-owned state，不携带虚构的 `current-checkout` Work Node id，因而不会被 Work Node revision verifier 误判为 stale；native permission 仍保留。
- [x] 撤回此前“赤缨/点剑真实回归通过”的错误结论（当时只证明页面缓存，审批可被通配权限绕过，且未做 hydration round-trip）。
- [x] 修复 P1：`def_operator_config_patch` 显式为 `ask`；真实拒绝后没有 renderer mutation、live mirror 或 checkout payload 变化。精确 target 缺失、歧义或 id/name 不一致会失败，绝不回退第一名干员。
- [x] 用新的 v1 Pure Blackbox session 做真实回归：原生审批后把弭弗设为昔日精品与潮涌四件；live mirror、Work Node checkout payload、退出并重新进入角色配置页都确认相同四槽与套装效果仍存在。candidate 未 promotion。
- [x] 返修 Work Node/commit 一致性 P1：配置 preview 现在从审批前 checkout 创建独立 manual child；服务端先 CAS 校验 parent/child revision，再 commit child、应用 renderer、验证 live mirror，最后 mark `checkout-applied` 并同步前端 checkout。成功结果逐字段验证 live mirror = child working payload = checkoutApplied commit payload；旧的无 CAS 整包覆盖链路已 fail-closed。
- [x] 返修 typed operator-config 等级合同：武器 Lv/三技能、装备各词条、A/B/E/Q 均经 schema 进入 preview、child payload、postcondition；新武器默认 Lv90/9-9-4，新装备真实词条默认 Lv3，显式 0/L9 保留。实际库不支持的词条等级会 fail-closed。
- [x] 原生 permission card 现在展示最终解析值：审批 Work Node/revision、checkout/revision、干员、武器 Lv/潜能/三技能、四件装备所有词条 Lv 与计算值、A/B/E/Q；不再只显示名称或 metadata。
- [x] 在此返修后的 native permission card 上完成一次 Computer Use `拒绝` 回归：正确默认等级卡的临时 child 被删除（404），head、live mirror、commit/node 数均不变；桌面删除确认已在操作时取得。
- [ ] 在审批期间切换 checkout 的独立回归：必须返回 `checkout-changed`，不提交/不应用任一 child。
- [x] 建立并运行 `def-operator-config-postcondition@1.0.1` Harness candidate 与显式 preview scenario；candidate 未 promotion。广义“合适的四人配装”仍会触发超范围探索，已保留为限制而非冒充通过。
- [ ] 建立可机器执行的 candidate promotion decision 后，交由人工 reviewer 决定是否 promotion。
- [ ] 完成 Spec 8-1-3 的全部独立回归与 reviewer approval。
