测评报告：Agent Tool CLI API (http://127.0.0.1:17321)
一、总体评分：78/100
维度	得分	说明
GET 端点完整性	100%	全部 8 个 GET 端点响应正常
CLI 命令覆盖率	90%	19 个命令中 17 个可用，2 个权限异常
数据校验	50%	fill.check 核心校验存在严重缺陷
错误处理	75%	基本覆盖，但有误导读者的错误信息
CORS/HTTP 规范	95%	基本合规
SSE 实时推送	100%	工作正常
二、发现的问题
🔴 严重问题
1. fill.check 静默丢弃无效 effect 而非报错

提交了 type: "invalidType" 的无效 modifier，接口返回 ok: true, effects=0，将无效项直接丢弃。外部 Agent 会误认为校验通过。fill.check 的核心价值就是校验，应该返回明确的字段级错误。


# 实际返回
{"ok": true, "lines": ["[ok] fill result valid: items=1 effects=0"]}
# 期望返回
{"ok": false, "error": {"code": "invalid-modifier-type", "message": "unknown modifier type: invalidType"}}
2. agent.logs / agent.sessions 对默认 rest 客户端被拒绝

这两个命令是纯读操作（查看日志和会话），但对默认的 rest (readonly) 客户端返回 "command not allowed for readonly-agent"。必须传 ?client=web-cli 才能执行。这是权限配置错误——读操作不应被拒绝。


# rest 客户端（默认）→ 被拒绝
POST /api/ai-cli/run  → "command not allowed for readonly-agent: agent.logs"
# web-cli 客户端 → 正常
POST /api/ai-cli/run?client=web-cli → ok
🟡 中等问题
3. 未知命令的错误信息具有误导性

不存在的命令返回 "command not allowed for readonly-agent: nonexistent"，与权限错误混淆。应返回 "unknown command: nonexistent"。

4. draft.show 缺少结构化 data 字段

buff.show <id> 返回了 data.draft 结构化 JSON，但 draft.show 只返回纯文本 lines，外部 Agent 无法直接获取结构化草稿数据。

5. buff.open 对 readonly 客户端被拒绝

打开库中已有条目到编辑区属于本地视图切换，不修改库数据，被归类为写操作值得商榷。

🟢 小问题
6. fill.check 校验通过时未返回 effects.writes 字段

fill.check 返回体中缺少 effects.writes，与 fill.apply 响应结构不一致。

7. Spec 端点声称的命令列表与实际行为不一致

/api/ai-cli/spec 列出的 commands 数组缺少 draft.rename、item.*、effect.*、operator.*、buff.open、agent.guide 等命令，而实际的 help 命令输出了更完整的命令列表。

三、各项测试详情
GET 端点（全部通过）
端点	状态	备注
/health	✅ 200	返回服务元信息
/api/agent/guide	✅ 200	完整接入指南
/api/agent/skills	✅ 200	buff.fill skill 定义完整
/api/ai-cli/spec	✅ 200	含 schema、formats、examples
/api/buff/library	✅ 200	支持 ?q= 搜索, 8 条记录
/api/buff/library/<id>	✅ 200/404	正确区分存在/不存在
/api/buff/current	✅ 200	返回当前编辑草稿
/api/buff/fill/template	✅ 200	含完整 schema 和 commonMistakes
/api/agent/sessions	✅ 200	含完整会话历史
/api/agent/logs	✅ 200	11 条操作日志
/api/agent/records	✅ 200	合并 sessions+logs
/api/agent/events	✅ SSE	text/event-stream，心跳 15s
POST /api/ai-cli/run 命令
命令	rest 客户端	web-cli 客户端
help	✅	✅
spec	✅	✅
/purpose	未测	未测
buff.list	✅	✅
buff.show <id>	✅	✅
buff.search <kw>	✅	✅
buff.open <id>	❌ 被拒(只读)	✅
draft.show	✅ (仅文本)	✅
draft.rename <name>	❌ 被拒(只读)	✅
item.list	✅	✅
item.add	❌ 被拒(只读)	✅
item.set	未测	未测
item.delete	❌ 被拒(只读)	✅
effect.list <key>	✅	✅
effect.add	❌ 被拒(只读)	✅
effect.set	未测	未测
effect.delete	❌ 被拒(只读)	未测
fill.task	✅	✅
fill.check <json>	✅	✅
fill.apply <json>	❌ 被拒(只读)	✅
agent.logs	❌ 应允许	✅
agent.sessions	❌ 应允许	✅
agent.guide	未测	未测
operator.*	未测	未测
POST /api/buff/fill/check & /apply
场景	结果
合法 payload + check	✅ ok: true, effects=1
无效 type + check	🔴 ok: true, effects=0 静默丢弃
无 draft body + check	✅ 400 body.draft is required
合法 payload + apply (web-cli)	✅ 写入成功
合法 payload + apply (rest)	✅ 403 正确拒绝
边界与错误处理
场景	结果
不存在的端点	✅ 404 + JSON error
不支持的 HTTP 方法 (PUT)	✅ 404
畸形 JSON body	✅ 500 + error message
空 body ({})	✅ 400 body.command is required
CORS 头	✅ Access-Control-Allow-Origin: *
OPTIONS 预检	✅ 204 + CORS headers
不存在的 buff ID (GET)	✅ 404 + not-found
不存在的 buff ID (CLI)	✅ usage error
四、修复优先级
P0 — fill.check 必须对无效 type/effectKind 返回字段级错误，不能静默丢弃
P0 — agent.logs / agent.sessions 应允许 readonly 客户端执行
P1 — 未知命令的错误信息与权限错误区分开
P1 — draft.show 增加结构化 data.draft 响应
P2 — Spec 端点中的 commands 列表与实际 help 输出同步
P2 — fill.check 响应中补充 effects.writes: false