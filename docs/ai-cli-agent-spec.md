# AI CLI Agent Spec

## Purpose / 用途

This spec defines how an external agent, such as Codex or Claude, should talk to the app-controlled AI CLI bridge.

这个规范定义外部智能体（Codex、Claude 等）如何接入应用本体暴露的 AI CLI 桥接能力。

The key rule is simple: the agent proposes commands or JSON; the app validates, asks for user confirmation when needed, and writes data.

核心规则很简单：智能体只提交命令或 JSON；应用负责校验、必要时让用户确认、最后由应用写入数据。

## Scope

Included:

- A stable command protocol for the current `/ai-cli` page.
- A future REST bridge that uses the same command logic.
- A future MCP wrapper that calls the REST bridge instead of duplicating business logic.
- One first workflow: `buff.fill`.
- CRUD-style commands for Buff draft smoke testing.
- Operator fixture commands for test setup.
- Schema validation before any write.

Not included:

- Desktop-clickable AI CLI entry. Desktop UI must keep the entry disabled.
- Local-data desktop/web dual-end storage sync.
- Direct localStorage or sessionStorage mutation by external agents.
- Direct Claude/Codex process management inside the app.
- MCP implementation in the first one-day build.

## Architecture

```text
Shell / Desktop Host
        |
        | start / stop / port management
        v
Web UI  <------HTTP------>  Local REST Server
                                  |
                                  | request permission
                                  | record session/log
                                  v
                              TypeScript Service
                                  |
                                  | parse
                                  | validate
                                  | confirm when needed
                                  | write
                                  v
                              App Storage
```

Responsibility split:

- Shell / desktop host manages process lifecycle: start, stop, restart, and port checks.
- Web UI renders state in real time and sends user actions to REST.
- Local REST Server exposes HTTP endpoints and applies permission/session/log rules.
- TypeScript Service owns command parsing, schema validation, business rules, and writes.
- App Storage remains the source of truth for Buff drafts, library, undo, agent sessions, logs, and permissions.

The browser page is only one client of this bridge. REST and MCP should call the same TypeScript service.

## Business Truth And Approval Loop

The web app remains the business source of truth. An external agent may keep its own full cache, but that cache is only an agent workspace. It must not be treated as approved app state.

The framework must separate three states:

```text
Agent cache/proposal  ->  Web working state  ->  Saved app truth
        Wait/No/Yes          visible/editable       localStorage save
```

Rules:

- Agent-generated changes first become a proposal, not a saved write.
- The user must approve or reject the proposal before it is applied to the web working state.
- Applying a proposal to the web working state is not the same as saving it.
- The user must still save or cancel the approved working state before it becomes persisted app truth.
- The same approval/save state machine applies to Buff, Operator, Weapon, and Equipment workflows.
- Approval and save transitions are user actions. External agents may create and query proposals, but they must not self-approve or self-save by default.
- Any CLI command or REST endpoint that advances `approval` or `save` must be treated as a user-confirmation entry point and must be gated by permissions/client trust.
- `now-storage.json` and `now-storage-state.json` are local-data bridge artifacts. They are not the Agent CLI write-approval mechanism.

Approval status:

```text
approval: Wait | Yes | No
```

Save status:

```text
save: Wait | Yes | No
```

External-agent responses and agent logs must expose both statuses. A command returning `ok:true` only means the request was accepted or processed; it does not imply `approval=Yes` or `save=Yes`.

## Implementation Language

All first-party implementation code for this agent framework should be TypeScript.

TypeScript-owned parts:

- AI CLI command service.
- Schema validator adapter.
- Buff writer adapter.
- Session memory service.
- Operation log service.
- Permission service.
- Local REST server.
- Web UI client calls.

Shell-owned parts:

- Start local REST server.
- Stop local REST server.
- Check local port.
- Call REST during development or smoke tests.

Shell must not own command parsing, schema validation, permissions, logs, sessions, or Buff writes.

## Trust Boundary

Agents are not trusted writers.

Allowed:

- Read current command help/spec.
- Produce commands.
- Produce `BuffFillAiDraft` JSON.
- Ask the app to dry-run validation.
- Ask the app to apply a valid result.

Not allowed:

- Write app storage directly.
- Skip schema validation.
- Invent unsupported Buff modifier types.
- Apply data without app-side validation.
- Treat AI CLI as part of local-data sync.

## Agent Infrastructure

The agent framework needs three basic infrastructure pieces before it becomes useful outside the browser terminal:

- Session memory.
- Operation logs.
- Explicit permissions.

These are app-owned services. Codex, Claude, PowerShell, REST, and MCP are only clients.

### Session Memory

Session memory stores what the current agent session is working on. It is not the same thing as Buff draft storage.

Recommended memory shape:

```ts
interface AiAgentSession {
  id: string;
  createdAt: number;
  updatedAt: number;
  title: string;
  client: 'web-cli' | 'powershell' | 'codex' | 'claude' | 'rest' | 'mcp';
  status: 'active' | 'archived';
  messages: AiAgentMessage[];
  context: {
    currentWorkflow?: 'buff.fill';
    currentDraftId?: string;
    currentOperatorId?: string;
    lastCommand?: string;
    lastValidationOk?: boolean;
    pendingProposalId?: string;
  };
  state?: {
    proposalId?: string;
    approval?: 'Wait' | 'Yes' | 'No';
    save?: 'Wait' | 'Yes' | 'No';
  };
}

interface AiAgentMessage {
  id: string;
  createdAt: number;
  role: 'user' | 'agent' | 'app' | 'tool';
  text: string;
  data?: unknown;
}
```

Session memory rules:

- It can remember recent commands, validation results, and user decisions.
- It can store copied task packages and agent responses.
- It must not be treated as the source of truth for Buff data.
- It must not bypass `fill.check` or `fill.apply`.
- It should be clearable by the user.

Recommended first storage:

```text
def.ai-agent.sessions.v1
def.ai-agent.active-session-id.v1
```

### Operation Logs

Operation logs record what happened. They are for debugging, replay, and audit.

Recommended log shape:

```ts
interface AiAgentOperationLog {
  id: string;
  createdAt: number;
  sessionId?: string;
  client: 'web-cli' | 'powershell' | 'codex' | 'claude' | 'rest' | 'mcp';
  command: string;
  ok: boolean;
  durationMs?: number;
  writes: boolean;
  storage: string[];
  approval?: 'Wait' | 'Yes' | 'No';
  save?: 'Wait' | 'Yes' | 'No';
  proposalId?: string;
  errorCode?: string;
  errorMessage?: string;
}
```

Log rules:

- Log every command request.
- Log whether validation passed.
- Log whether the command wrote data.
- Log touched storage keys.
- Log proposal id when a command creates or resolves a pending proposal.
- Log approval and save statuses for write-like workflows.
- Do not log huge pasted JSON in full by default.
- Store a short hash or character count for large payloads.
- Logs should be exportable for debugging.

Recommended first storage:

```text
def.ai-agent.operation-logs.v1
```

### Permissions

Permissions define what each client can do. The app should start strict and allow the user to open more access.

Recommended permission shape:

```ts
interface AiAgentPermissionProfile {
  id: string;
  name: string;
  client: 'web-cli' | 'powershell' | 'codex' | 'claude' | 'rest' | 'mcp';
  allowedCommands: string[];
  allowedWorkflows: string[];
  canRead: boolean;
  canDryRun: boolean;
  canWrite: boolean;
  requiresUserConfirmForWrite: boolean;
}
```

Default profiles:

```text
readonly-agent:
  canRead=true
  canDryRun=true
  canWrite=false

confirmed-writer:
  canRead=true
  canDryRun=true
  canWrite=true
  requiresUserConfirmForWrite=true

trusted-local-dev:
  canRead=true
  canDryRun=true
  canWrite=true
  requiresUserConfirmForWrite=false
```

Permission rules:

- Web terminal can start as `confirmed-writer`.
- PowerShell and REST should start as `readonly-agent` until the user enables writes.
- MCP should start as `readonly-agent`.
- `fill.check` requires `canDryRun`.
- `fill.apply` requires `canWrite`.
- Write commands should require confirmation unless the profile explicitly disables it.
- Permission changes must be logged.

Recommended first storage:

```text
def.ai-agent.permission-profiles.v1
```

## Command Request

The internal command request shape should be:

```ts
interface AiCliCommandRequest {
  protocolVersion: 1;
  requestId?: string;
  command: string;
}
```

Example:

```json
{
  "protocolVersion": 1,
  "requestId": "req-001",
    "command": "buff.list"
}
```

For the current terminal UI, the user types only the `command` value. REST can wrap the same string with metadata.

## Command Response

The internal command response shape should be:

```ts
interface AiCliCommandResponse {
  ok: boolean;
  protocolVersion: 1;
  requestId?: string;
  lines: string[];
  data?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  effects: {
    writes: boolean;
    storage: string[];
  };
  proposal?: {
    id: string;
    domain: 'buff' | 'operator' | 'weapon' | 'equipment';
    approval: 'Wait' | 'Yes' | 'No';
    save: 'Wait' | 'Yes' | 'No';
    nextAction?: string;
  };
}
```

Terminal line rules:

- Success lines start with `[ok]`.
- Recoverable failures start with `[err]`.
- Informational lines start with `[info]`.
- Tables use fixed-width text.
- Long JSON input is echoed as `<json:N chars>`.

## Current Command Surface

System commands:

```text
help
/purpose
spec
route home
route buff
```

Operator fixture commands:

```text
operator.add <operatorId> <name> [weapon=] [potential=满潜|0潜] [skillLevel=M3|L9]
operator.show [operatorId]
operator.delete <operatorId>
```

Buff library commands:

```text
buff.list [limit]
buff.show <buffId>
buff.search <keyword>
buff.open <buffId>
```

Draft commands:

```text
draft.show
draft.rename <name>
```

`def.buff-editor.library.v1` is the Buff source of truth. `def.buff-editor.draft.v1` is only the currently opened editor state.

Buff item commands:

```text
item.list
item.add <itemKey> <name> [sourceName=] [desc=]
item.set <itemKey> [name=] [sourceName=] [desc=]
item.delete <itemKey>
```

Buff effect commands:

```text
effect.list <itemKey>
effect.add <itemKey> <effectKey> type=<modifierType> value=<number> [name=] [display=] [desc=] [condition=]
effect.set <itemKey> <effectKey> [type=] [value=] [name=] [display=] [desc=] [condition=]
effect.delete <itemKey> <effectKey>
```

AI fill workflow commands:

```text
fill.source <text>
fill.task
fill.task.copy
fill.check <BuffFillAiDraft JSON>
fill.apply <BuffFillAiDraft JSON>
```

## Buff Fill Contract

The agent must output one JSON object only. No Markdown. No explanation text.

Root shape:

```ts
interface BuffFillAiDraft {
  id: string;
  name: string;
  sourceName: string;
  source: string;
  description: string;
  items: BuffFillAiItem[];
}
```

Item shape:

```ts
interface BuffFillAiItem {
  name: string;
  sourceName: string;
  description: string;
  effects: BuffFillAiEffect[];
}
```

Effect shape:

```ts
interface BuffFillAiEffect {
  displayName: string;
  name: string;
  level: string;
  source: string;
  sourceName: string;
  description: string;
  condition: string;
  effectKind: 'modifier' | 'extraHit';
  type: string;
  value: number;
  evidenceText: string;
  confidence: number;
}
```

Rules:

- `type` must come from the app-provided modifier catalog.
- Percent values use decimals, for example `0.2` for `20%`.
- `value` must be a number, not a string.
- `extraHit.type` must be `""`.
- `extraHit.value` must be `0`.
- Unsupported effects should be dropped, not guessed.
- `evidenceText` should preserve the source text used for the decision.

## Validation And Write Flow

Dry run:

```text
fill.check <BuffFillAiDraft JSON>
```

Expected behavior:

- Parse JSON.
- Validate schema.
- Validate modifier types.
- Return `[ok]` or `[err]`.
- Write nothing.

Apply/propose:

```text
fill.apply <BuffFillAiDraft JSON>
```

Target framework behavior:

- Run the same validation as `fill.check`.
- If invalid, write nothing.
- If valid, create a pending Buff proposal with `approval=Wait` and `save=Wait`.
- Return `proposal.id`, `approval`, `save`, and the next required action.
- Do not treat proposal creation as a saved write.
- `Y` approves the proposal and applies it to the web working state.
- `N` rejects the proposal and leaves app state unchanged.
- `Y` / `N` must represent a user confirmation path. Do not let a readonly external agent complete approval or save transitions on its own.
- After approval, saving is still a separate decision:
  - Save `Y`: persist to app truth.
  - Save `N`: keep/cancel without persisting according to the domain adapter.

Current implementation note:

- Current `fill.apply` already validates and writes `def.buff-editor.library.v1`, mirrors `def.buff-editor.draft.v1`, and creates an undo snapshot.
- That behavior is useful as a smoke path, but it is not the final external-agent business closure.
- The next framework step is to move external-agent writes behind proposal approval and save confirmation.

Storage touched by current direct-write `fill.apply`:

```text
def.buff-editor.draft.v1
def.buff-editor.library.v1
def.buff-editor.undo.v1
```

Storage touched by operator fixture commands:

```text
def.operator-config.character-input-map.v3
def.selected-characters.v1
```

These storage keys are implementation details owned by the app. External agents must never write them directly.

## Future REST Bridge

REST is the first external bridge target because it is simple to call from PowerShell, Codex, Claude, browser tests, and local scripts.

Recommended endpoints:

```text
GET  /api/ai-cli/spec
GET  /api/agent/guide
GET  /api/agent/skills
POST /api/ai-cli/run
GET  /api/buff/library
GET  /api/buff/library/<id>
GET  /api/buff/current
GET  /api/buff/fill/template
POST /api/buff/fill/check
POST /api/buff/fill/apply
GET  /api/agent/sessions
GET  /api/agent/logs
GET  /api/agent/records
GET  /api/agent/events
```

`POST /api/ai-cli/run` request:

```json
{
  "protocolVersion": 1,
  "requestId": "req-001",
  "command": "buff.list"
}
```

`POST /api/ai-cli/run` response:

```json
{
  "ok": true,
  "protocolVersion": 1,
  "requestId": "req-001",
  "lines": ["[ok] draft loaded"],
  "effects": {
    "writes": false,
    "storage": []
  }
}
```

`POST /api/buff/fill/check` request:

Important format distinction:

- Read endpoints return app `BuffDraft` format: `items` and `effects` are object maps.
- Fill endpoints accept agent `BuffFillAiDraft` format: `items` and `effects` are arrays.
- Do not submit a `GET /api/buff/current` or `GET /api/buff/library/<id>` response directly to `fill.check`.
- Use `GET /api/buff/fill/template` for a valid payload template.

```json
{
  "protocolVersion": 1,
  "requestId": "req-002",
  "draft": {
    "id": "ai-result",
    "name": "AI result",
    "sourceName": "source",
    "source": "ai",
    "description": "",
    "items": []
  }
}
```

`POST /api/buff/fill/apply` should use the same request body. In the target external-agent framework, a valid apply creates a pending proposal first. Direct persistence is only allowed after app-side approval and save confirmation.

REST rule:

- REST endpoints must call the same validation and writer code as `/ai-cli`.
- REST must not become a second implementation of Buff writing.
- Agents should read `GET /api/buff/library` first. `GET /api/buff/current` is only active editor state.
- External agents must not infer that `ok:true` means business persistence is complete. They must inspect `proposal.approval` and `proposal.save` when a command enters the approval flow.
- REST proposal endpoints, if added, must distinguish query endpoints from user-confirmation endpoints. Query endpoints may be readonly; approval/save endpoints must not be available to default readonly agents.

Current local development entry:

```text
npm run ai-cli:rest
```

Shell-managed lifecycle endpoints:

```text
POST http://127.0.0.1:31457/open-ai-cli-rest
POST http://127.0.0.1:31457/close-ai-cli-rest
```

The bridge health payload includes:

```text
aiCliRest.running
aiCliRest.pid
aiCliRest.startedAt
aiCliRest.url
```

Default local URL:

```text
http://127.0.0.1:17321
```

Health check:

```text
GET /health
```

REST smoke:

```text
npm run smoke:ai-cli-rest
```

Agent record rendering:

- Shell independent UI has an `Agent` page.
- The page reads `GET http://127.0.0.1:17321/api/agent/records`.
- The page subscribes to `GET http://127.0.0.1:17321/api/agent/events` with SSE.
- The page shows recent operation logs and sessions.
- REST broadcasts `agent.records` when command handling changes records.
- Polling remains only as fallback when SSE is unavailable.
- `/ai-cli` also exposes `agent.logs [limit]` and `agent.sessions [limit]`.

LLM agent onboarding:

- Third-party agents should call `GET /api/agent/guide` first.
- The guide returns recommended flow, safety rules, write rules, and examples.
- Agents can call `GET /api/agent/skills` to discover workflow-specific instructions.
- The first skill is `buff.fill`.
- `/ai-cli` exposes `agent.guide` for the same human-readable guidance in terminal form.

## Future MCP Wrapper

MCP should be added after REST is stable.

MCP tools should be thin wrappers:

```text
ai_cli_spec       -> GET /api/ai-cli/spec
ai_cli_run        -> POST /api/ai-cli/run
buff_current      -> GET /api/buff/current
buff_fill_check   -> POST /api/buff/fill/check
buff_fill_apply   -> POST /api/buff/fill/apply
```

MCP rule:

- MCP owns tool names and tool descriptions only.
- REST owns transport.
- The app command service owns validation and writes.

## One-Day Build Plan

Day-one target:

- Keep `/ai-cli` as the visible web test surface.
- Keep desktop AI CLI navigation disabled.
- Extract command execution into an app-owned command service.
- Make terminal UI call that service.
- Add REST endpoints that call the same service.
- Keep MCP out of the first build unless REST is finished early.

Suggested order:

1. Extract `runCommand` from the page into a reusable service.
2. Keep the page behavior unchanged.
3. Add typed request/response objects.
4. Add REST routes for `spec`, `run`, `fill.check`, and `fill.apply`.
5. Reuse the current Playwright smoke test for the web page.
6. Add one script or test that calls REST with the same `BuffFillAiDraft`.

## Acceptance Checklist

- Web `/ai-cli` still works.
- Desktop navigation shows AI CLI disabled and cannot click through.
- `help`, `/purpose`, and `spec` describe the current command surface.
- `fill.check` validates without writes.
- `fill.apply` rejects invalid data without writes.
- `fill.apply` writes valid data with an undo snapshot.
- REST returns the same line format and error format as the terminal.
- REST and terminal use the same validation and writer code.
- External agents only call commands or JSON contracts.
- Local-data dual-end sync is not touched.
