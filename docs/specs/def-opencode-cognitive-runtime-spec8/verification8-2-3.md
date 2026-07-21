# Verification 8-2-3：受控本地资料原生检索桥接

## 代码与合同证据

- `npm run test:def-native-catalog`
  - materialize 必须同时具备 native governance token 与由 native session create/recover 路径登记的未过期 session；未登记或无 token 都返回 `denied-native-catalog-session`，登记操作本身是 internal-governance only；
  - exact `潮涌套` 生成单一 `entity-full` JSON，含四件、两个配件、三件套效果与 stable id，且没有寒流套泄漏；
  - `力量` 生成跨套装的 `substring-minimal` JSONL，记录 id 与实际命中的字段，不携带完整无关 effects；
  - weapon domain 的 exact full artifact 与无确定性命中的 `domain-full-fallback` 均通过；
  - canonical hash 对对象键序稳定，业务字段变化会生成新 source revision；
  - session artifact 通过临时目录+rename 落盘，manifest hash、TTL reuse/cleanup、sidecar 重启后的持久化 TTL cleanup 和 `../` 文件名拒绝均通过；
  - adapter 合同确认 `retrieval/**` 只有 read allow，edit 仍仅允许 `node/working/**`，并保留 `external_directory: deny`；native pre-execute guard 进一步把 `read/grep/glob` 收紧到本 session 当前、未过期且由 tool 返回的精确 artifact root。
- `npm run test:def-equipment-resource`
- `npm run test:def-harness-turn-routing`
  - pinned operator-config candidate 的纯 catalog turn 路由到 stable Harness；装备应用句仍保留该 candidate。
- `npm run interop:check`
- `npm run harness:check`
- `git diff --check`

## v1 / Desktop 状态

本次未发送真实模型 turn、未创建或 promotion Harness，也未改变 Workbench / approval / checkout。原生 materialize tool 会作为普通 native `def_*` 工具进入 DefCodexInteropProtocol v1 的 tool record；实际模型回归应按 [DEF Agent Blackbox](../../testing/def-agent-blackbox.md) 从全新 native session 运行，并记录 materialize、manifest `read` 与至少两次 artifact 内 `grep/read`。

## 已知边界

- 本轮只做 deterministic exact / substring / fallback artifact，不做 ASR、拼音别名、语义排序、3+1 枚举或自动推荐；这些是下一轮 specialized retrieval runtime 的范围。
- `grep`/`glob` 的 upstream permission 只按 pattern 判定；DEF 的 native pre-execute guard 会拒绝泛用 `retrieval/**`、其他 artifact root 及无路径 glob。DEF 保持 `external_directory: deny`，不开放项目、raw storage、Share Data 或其他 session。
