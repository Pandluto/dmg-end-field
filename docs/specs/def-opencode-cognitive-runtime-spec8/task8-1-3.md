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
- [ ] 建立可机器执行的 candidate promotion decision 后，交由人工 reviewer 决定是否 promotion。
- [ ] 完成 Spec 8-1-3 的全部独立回归与 reviewer approval。
