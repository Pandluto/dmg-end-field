# Agent Tool CLI API 修复报告

**修复日期**: 2026-06-01  
**测评报告**: [CLI API 验证记录](./verification-cli-api-20260601.md)
**修复人**: Executor Agent  
**验证方式**: Smoke Test + Browser Use 自动化测试

---

## 一、修复概览

| 优先级 | 问题 | 状态 | 修改文件 |
|--------|------|------|----------|
| P0 | fill.check 静默丢弃无效 effect | ✅ 已修复 | `src/aiCli/aiCliCommandService.ts` |
| P0 | agent.logs / agent.sessions 被拒 | ✅ 已修复 | `src/aiCli/aiCliAgentInfrastructure.ts` |
| P1 | 未知命令与权限错误混淆 | ✅ 已修复 | `src/aiCli/aiCliAgentInfrastructure.ts` |
| P1 | draft.show 缺少结构化 data | ✅ 已修复 | `src/aiCli/aiCliCommandService.ts` |
| P2 | Spec commands 列表不完整 | ✅ 已修复 | `src/aiCli/aiCliRestAdapter.ts` |
| P2 | fill.check 缺少 effects.writes | ✅ 已修复 | `src/aiCli/aiCliCommandService.ts` |

---

## 二、详细修改内容

### 2.1 P0 — fill.check 静默丢弃无效 effect

**问题描述**  
fill.check 对无效 modifier type（如 `invalidType`）返回 `ok: true, effects=0`，静默丢弃而非报错。

**根因分析**  
`parseAiFillResult` 在验证前先调用 `sanitizeBuffFillAiDraft`，该函数会过滤掉无效的 effect，导致 `validateBuffFillAiDraft` 根本看不到这些错误。

**修复方案**  
为 `parseAiFillResult` 增加 `skipSanitize` 选项，fill.check 调用时跳过 sanitize，直接对原始数据 validate：

```typescript
// aiCliCommandService.ts
function parseAiFillResult(
  rawText: string,
  options?: { skipSanitize?: boolean }  // 新增选项
): { draft: BuffDraft | null; errors: string[] } {
  // ...
  const toValidate = options?.skipSanitize
    ? rawDraft                              // 原始数据，保留无效项
    : sanitizeBuffFillAiDraft(rawDraft);    // 过滤后的数据
  const validation = validateBuffFillAiDraft(toValidate);
  // ...
}

// fill.check 调用时传入 skipSanitize: true
const parsed = parseAiFillResult(jsonText, { skipSanitize: true });
```

**验证结果**  
提交无效 type 时现在返回：
```json
{
  "ok": false,
  "error": {
    "code": "fill-invalid",
    "message": "fill result invalid",
    "details": [
      "items[0].effects[0].type 不在允许的 modifier.type 白名单内"
    ]
  }
}
```

---

### 2.2 P0 — agent.logs / agent.sessions 允许 readonly 客户端

**问题描述**  
纯读命令 `agent.logs` 和 `agent.sessions` 对默认 `rest` (readonly) 客户端返回 "command not allowed for readonly-agent"。

**修复方案**  
在 `readonly-agent` 的 `allowedCommands` 中增加这三个命令：

```typescript
// aiCliAgentInfrastructure.ts
{
  id: 'readonly-agent',
  allowedCommands: [
    // ...原有命令...
    'agent.logs',      // 新增
    'agent.sessions',  // 新增
    'agent.guide',     // 新增
  ],
}
```

**验证结果**  
- `agent.sessions` ✅ 返回会话信息（sessionId、client、status、messages 等）
- `agent.logs` ✅ 返回操作日志（时间、客户端、命令状态等）

---

### 2.3 P1 — 未知命令与权限错误区分

**问题描述**  
不存在的命令返回 "command not allowed for readonly-agent: nonexistent"，与真正的权限错误混淆。

**修复方案**  
1. 新增 `KNOWN_COMMANDS` 集合定义所有已知命令
2. `assertPermission` 先检查命令是否已知，再检查权限：

```typescript
// aiCliAgentInfrastructure.ts
const KNOWN_COMMANDS = new Set([
  'help', '/help', 'purpose', '/purpose', 'spec', '/spec',
  'route', 'agent.logs', 'agent.sessions', 'agent.guide',
  'buff.list', 'buff.show', 'buff.search', 'buff.open',
  'operator.add', 'operator.show', 'operator.delete',
  'draft.show', 'draft.rename',
  'item.list', 'item.add', 'item.set', 'item.delete',
  'effect.list', 'effect.add', 'effect.set', 'effect.delete',
  'fill.task', 'fill.task.copy', 'fill.check', 'fill.apply', 'fill.source',
]);

export function assertPermission(profile, commandName) {
  if (!KNOWN_COMMANDS.has(commandName)) {
    return `unknown command: ${commandName}`;  // 先检查是否已知
  }
  if (!canRunCommand(profile, commandName)) {
    return `command not allowed for ${profile.id}: ${commandName}`;
  }
  // ...后续权限检查...
}
```

**验证结果**  
- 未知命令 `nonexistent` → `"unknown command: nonexistent"` ✅
- 权限不足 `fill.apply` → `"write not allowed for readonly-agent"` ✅

---

### 2.4 P1 — draft.show 增加结构化 data.draft

**问题描述**  
draft.show 只返回纯文本 lines，外部 Agent 无法直接获取结构化草稿数据。

**修复方案**  
返回体中补充 `data.draft` 字段：

```typescript
// aiCliCommandService.ts
if (command === 'draft.show') {
  return makeResponse({
    lines: formatDraftSummary(draft),
    data: { draft }  // 新增结构化数据
  });
}
```

**响应示例**  
```json
{
  "ok": true,
  "lines": ["id=custom-buff-001", "name=本地 Buff 草稿", "items=0", "effects=0"],
  "data": {
    "draft": {
      "id": "custom-buff-001",
      "name": "本地 Buff 草稿",
      "items": {}
    }
  }
}
```

---

### 2.5 P2 — Spec 端点 commands 列表同步

**问题描述**  
`/api/ai-cli/spec` 返回的 commands 数组缺少大量命令（如 `draft.rename`、`item.*`、`effect.*`、`operator.*` 等）。

**修复方案**  
将 commands 数组扩展为与 help 输出一致的完整列表：

```typescript
// aiCliRestAdapter.ts
commands: [
  'help', '/help',
  'purpose', '/purpose',
  'spec', '/spec',
  'route home|buff',
  'agent.logs', 'agent.sessions', 'agent.guide',
  'buff.list [limit]', 'buff.show <id>', 'buff.search <keyword>', 'buff.open <id>',
  'operator.add <id> <name> [weapon=] [potential=] [skillLevel=]',
  'operator.show [id]', 'operator.delete <id>',
  'draft.show', 'draft.rename <name>',
  'item.list', 'item.add <itemKey> <name> [sourceName=] [desc=]',
  'item.set <itemKey> <field> <value>', 'item.delete <itemKey>',
  'effect.list <itemKey>',
  'effect.add <itemKey> <effectKey> <type> <value> [display=] [level=] [source=] [condition=] [desc=]',
  'effect.set <itemKey> <effectKey> <field> <value>',
  'effect.delete <itemKey> <effectKey>',
  'fill.source <text>', 'fill.task', 'fill.task.copy',
  'fill.check <BuffFillAiDraft JSON>', 'fill.apply <BuffFillAiDraft JSON>',
]
```

---

### 2.6 P2 — fill.check 响应补充 effects.writes

**问题描述**  
fill.check 返回体中缺少 `effects.writes` 字段，与 fill.apply 响应结构不一致。

**修复方案**  
显式返回 `effects` 字段：

```typescript
// aiCliCommandService.ts
return makeResponse({
  lines: [ok(`fill result valid: items=${itemCount} effects=${effectCount}`)],
  effects: { writes: false, storage: [] },  // 新增
});
```

**响应对比**  
| 命令 | effects.writes | 说明 |
|------|---------------|------|
| `fill.check` | `false` | 只读校验，不写入 |
| `fill.apply` | `true` | 写入数据 |

---

## 三、测试验证

### 3.1 自动化测试

```bash
npm run smoke:ai-cli-rest
# [ai-cli-rest-smoke] passed ✅
```

### 3.2 Browser Use 浏览器测试

| 测试场景 | 结果 |
|---------|------|
| 访问 `/#/ai-cli` 页面 | ✅ 页面加载正常 |
| 执行 `help` 命令 | ✅ 显示完整命令列表 |
| 执行 `agent.sessions` | ✅ 返回会话信息 |
| 执行 `agent.logs` | ✅ 返回操作日志 |

### 3.3 API 集成测试

创建测试 Buff 组验证完整流程：

```bash
# 1. 验证数据格式
POST /api/buff/fill/check
→ ok: true, items=3 effects=5

# 2. 写入数据（需 web-cli 客户端）
POST /api/buff/fill/apply?client=web-cli
→ ok: true, writes=true, nextDraft={...}

# 3. 验证已保存
GET /api/buff/library/test-buff-001
→ ok: true, draft={...}, items=3, effects=5
```

---

## 四、修改文件清单

| 文件 | 修改行数 | 说明 |
|------|---------|------|
| `src/aiCli/aiCliCommandService.ts` | +8 / -2 | fill.check skipSanitize、draft.show data、effects.writes |
| `src/aiCli/aiCliAgentInfrastructure.ts` | +18 / -1 | 权限配置、KNOWN_COMMANDS、assertPermission 顺序 |
| `src/aiCli/aiCliRestAdapter.ts` | +20 / -8 | Spec commands 列表同步 |

---

## 五、遗留问题

无。所有 P0/P1/P2 问题均已修复并通过验证。

---

## 六、附录：允许的 Modifier Type 白名单

完整列表见 `src/ai/buffFillCatalog.ts`：

- 攻击类：`atkPercentBoost`, `flatAtk`, `mainStatBoost`, `subStatBoost`, `allStatBoost`
- 属性类：`strengthBoost`, `agilityBoost`, `intelligenceBoost`, `willBoost`
- 暴击类：`critRateBoost`, `critDmgBonusBoost`
- 伤害加成：`physicalDmgBonus`, `magicDmgBonus`, `fireDmgBonus`, `electricDmgBonus`, `iceDmgBonus`, `natureDmgBonus`, `allDmgBonus`, `skillDmgBonus`, `chainSkillDmgBonus`, `ultimateDmgBonus`, `normalAttackDmgBonus`, `allSkillDmgBonus`
- 脆弱/易伤：`physicalFragile`, `fireFragile`, `electricFragile`, `iceFragile`, `natureFragile`, `magicFragile`, `physicalVulnerability`, `fireVulnerability`, `electricVulnerability`, `iceVulnerability`, `natureVulnerability`, `magicVulnerability`
- 腐蚀：`allCorrosion`, `physicalCorrosion`, `magicCorrosion`, `fireCorrosion`, `electricCorrosion`, `iceCorrosion`, `natureCorrosion`
- 无视抗性：`allResistanceIgnore`, `physicalResistanceIgnore`, `magicResistanceIgnore`, `fireResistanceIgnore`, `electricResistanceIgnore`, `iceResistanceIgnore`, `natureResistanceIgnore`
- 增幅：`physicalAmplify`, `magicAmplify`, `fireAmplify`, `electricAmplify`, `iceAmplify`, `natureAmplify`
- 其他：`comboDamageBonus`, `multiplierBonus`, `multiplierMultiplier`, `sourceSkillBoost`
