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
- Horizontal fill framework skeleton with `buff.fill` and `weapon.fill`.
- Planned Task 13 horizontal branches for `operator.fill` and `equipment.fill`.
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

### Review Operation Contract

Task 12 owns the first concrete review operation loop. The loop is intentionally user-driven:

```text
agent creates proposal (via REST or Web CLI)
  -> app returns proposalId + approval=Wait + save=Wait
  -> REST proposals are automatically handed off to Web CLI via SSE
  -> user opens /ai-cli and sees imported pending proposals
  -> user enters Y/N for approval (or uses proposal.approve #1)
  -> if approved, app applies proposal to the web working state
  -> user enters Y/N for save (or uses proposal.save #1)
  -> if saved, app persists to the domain localStorage truth
```

Cross-store proposal handoff (Task 12 UX Fix 2):

- REST `*.fill.apply` creates a proposal in `now-storage.json`.
- The REST server broadcasts proposals through SSE `agent.records`.
- Web CLI (`/ai-cli`) receives SSE and imports external pending proposals into browser `localStorage`.
- Imported proposals keep their original `client` (rest/codex/claude) and get `reviewedBy='web-cli'`.
- The user does **not** need to re-run `fill.apply` in the browser.
- Single pending: user presses `Y` to approve, then `Y` to save.
- Multiple pending: user runs `proposal.list`, then `proposal.approve #1` / `proposal.save #1`.

Review commands, if implemented through AI CLI, must follow these semantics:

```text
proposal.list
proposal.show <proposalId|alias>
proposal.approve <proposalId|alias>   # user confirmation only
proposal.reject <proposalId|alias>    # user confirmation only
proposal.save <proposalId|alias>      # user confirmation only
proposal.unsave <proposalId|alias>    # user confirmation only
Y                               # special short input, web-cli only
N                               # special short input, web-cli only
```

Rules:

- `proposal.approve/reject/save/unsave` must be denied to default readonly external agents.
- Default `rest`, `powershell`, `codex`, `claude`, and `mcp` clients may query proposals but must not advance `approval` or `save`.
- `web-cli` is the default user-confirmation client for `Y` / `N`.
- A trusted local profile may advance `approval` or `save` only when the app explicitly treats that client as a user-confirmation surface.
- Web CLI may use short `Y` / `N` input only when exactly one pending proposal is active in the current session.
- `Y` and `N` are special short inputs, not normal `namespace.action` commands. They still need explicit handling in command parsing and permission checks.
- The proposal lookup for `Y` / `N` must be session-scoped. Implement `readPendingAgentProposals(sessionId?)` or an equivalent `readPendingAgentProposalsForSession(sessionId)` helper.
- `proposal.list` may show all pending proposals by default, but `Y` / `N` must only consider proposals whose `sessionId` matches the current session.
- If there are zero pending proposals, `Y` / `N` must fail with an informational message.
- If there are multiple pending proposals, `Y` / `N` must fail and ask for an explicit `proposal.show <proposalId|alias>` or `proposal.approve/reject/save/unsave <proposalId|alias>` command.
- The implementation must not silently choose the latest proposal when `Y` / `N` is ambiguous.
- `Y` first resolves approval. If approval is already `Yes` and save is `Wait`, then `Y` resolves save.
- `N` first rejects approval. If approval is already `Yes` and save is `Wait`, then `N` marks unsaved/cancelled.
- Every transition must update proposal storage, session state, operation log, and command response.
- A rejected proposal must set `approval=No` and `save=No`.
- A saved proposal must set `approval=Yes` and `save=Yes`.
- An approved-but-unsaved proposal must set `approval=Yes` and `save=No`.
- External agents must not tell users to re-run `fill.apply` in the browser after REST apply. The handoff mechanism imports the proposal automatically.

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
    currentWorkflow?: 'buff.fill' | 'weapon.fill' | 'operator.fill' | 'equipment.fill';
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
  client: 'web-cli' | 'powershell' | 'codex' | 'claude' | 'rest' | 'mcp';
  command: string;
}
```

Example:

```json
{
  "protocolVersion": 1,
  "requestId": "req-001",
  "client": "rest",
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

Proposal review commands:

```text
proposal.list
proposal.show <proposalId>
proposal.approve <proposalId>
proposal.reject <proposalId>
proposal.save <proposalId>
proposal.unsave <proposalId>
Y
N
```

Operator fill branch commands:

```text
operator.current
operator.library [limit]
operator.library.show <id|name>
operator.fill.task
operator.fill.check <OperatorFillAiDraft JSON>
operator.fill.apply <OperatorFillAiDraft JSON>
```

Equipment fill branch commands:

```text
equipment.current
equipment.library [limit]
equipment.library.show <id|name>
equipment.fill.task
equipment.fill.check <EquipmentFillAiDraft JSON>
equipment.fill.apply <EquipmentFillAiDraft JSON>
```

Weapon fill branch commands:

```text
weapon.fill.task
weapon.fill.check <WeaponFillAiDraft JSON>
weapon.fill.apply <WeaponFillAiDraft JSON>
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

## Horizontal Fill Workflow Framework

Task 12 completes the reusable horizontal fill skeleton. Buff remains the reference implementation, but the framework must no longer be Buff-shaped.

Every fill domain must be registered through one domain adapter instead of branching command logic by hand:

```ts
type AgentFillCommandPrefix = 'fill' | 'weapon.fill' | 'operator.fill' | 'equipment.fill';

interface AgentFillValidationResult<TNormalized> {
  ok: boolean;
  errors: string[];
  normalized?: TNormalized;
}

interface AgentFillProposalPayload<TNormalized = unknown> {
  schemaVersion: 1;
  normalized: TNormalized;
  sourceCommand: string;
}

interface AgentFillDomainAdapter {
  domain: 'buff' | 'weapon' | 'operator' | 'equipment';
  workflow: 'buff.fill' | 'weapon.fill' | 'operator.fill' | 'equipment.fill';
  commandPrefix: AgentFillCommandPrefix;
  draftStorageKey: string;
  libraryStorageKey: string;
  buildTaskPackage(currentDraft: unknown, sourceText: string): unknown;
  validateAiDraft(payload: unknown): AgentFillValidationResult<unknown>;
  summarizeProposal(payload: AgentFillProposalPayload): string;
  createProposalPayload(normalized: unknown, sourceCommand: string): AgentFillProposalPayload;
  applyToWorkingState(payload: AgentFillProposalPayload): { lines: string[]; nextDraft?: unknown };
  saveToLocalTruth(payload: AgentFillProposalPayload): { lines: string[]; storage: string[] };
  discardProposal(payload: AgentFillProposalPayload): { lines: string[] };
}
```

Registry contract:

- The registry should live in the AI CLI domain layer, for example `src/aiCli/aiCliFillDomains.ts`.
- Use `commandPrefix` as the dispatch key:
  - `fill` handles `fill.task/check/apply` and maps to domain `buff`.
  - `weapon.fill` handles `weapon.fill.task/check/apply`.
  - Future `operator.fill` and `equipment.fill` must register without changing the review state machine.
- `executeCommand` should parse the command prefix, look up the adapter, and call shared fill handlers.
- Unknown or unregistered fill prefixes return `unknown-command`.
- Registered prefixes with invalid action names return usage errors, not direct storage writes.

Proposal operation call chain:

```text
*.fill.apply
  -> adapter.validateAiDraft(rawPayload)
  -> adapter.createProposalPayload(validation.normalized, rawCommand)
  -> createAgentProposal({ domain, operation, payload, approval=Wait, save=Wait, summary })
  -> response.proposal

proposal.approve / Y
  -> read proposal
  -> find adapter by proposal.domain
  -> adapter.applyToWorkingState(proposal.payload)
  -> approveAgentProposal(proposal.id)
  -> update session/log/response

proposal.save / Y after approval
  -> read proposal
  -> find adapter by proposal.domain
  -> adapter.saveToLocalTruth(proposal.payload)
  -> markAgentProposalSaved(proposal.id)
  -> update session/log/response
```

Ordering and failure rules:

- For approve, call `applyToWorkingState` before changing `approval` to `Yes`. If the adapter fails, keep `approval=Wait`.
- For save, call `saveToLocalTruth` before changing `save` to `Yes`. If the adapter fails, keep `save=Wait`.
- For reject, no adapter call is required; set `approval=No/save=No`.
- For unsave after approval, call `discardProposal` before changing `save` to `No` if the adapter needs to clear transient working state. If it fails, keep `save=Wait`.
- Adapter exceptions must become `ok:false` command responses and operation log entries.
- Proposal state transitions must be session-scoped where the UX depends on the current session.

Duplicate proposal policy:

- A domain adapter must expose enough normalized identity to detect duplicate pending proposals for the same target.
- For Task 12, if a pending proposal already exists for the same domain and target id, create should fail with a clear message instead of silently creating a second competing proposal.
- A rejected or saved/unsaved closed proposal does not block a new proposal for the same target id.

Domain command shape:

```text
<domain>.fill.task
<domain>.fill.check <DomainFillAiDraft JSON>
<domain>.fill.apply <DomainFillAiDraft JSON>
```

Framework rules:

- `*.fill.task` returns a task package in `data`, with human-readable `lines` only as summary.
- `*.fill.check` validates only and writes nothing.
- `*.fill.apply` validates and creates an `AiAgentProposal`; it does not save directly.
- Proposal approval applies the normalized payload to the web working state only.
- Proposal approval must not write the domain library/local truth.
- Proposal save persists through that domain's existing save path.
- Domain adapters must own their schema, validator, normalizer, storage keys, and proposal summary.
- Domain adapters must not reuse another domain's draft type, storage keys, validators, or prompt contract.
- Buff, Weapon, Operator, and Equipment should differ by adapter configuration and validation logic, not by duplicating the review state machine.

Working-state rules:

- `applyToWorkingState` may update the active draft / visible editor state for that domain.
- `applyToWorkingState` must not write the domain library storage.
- `saveToLocalTruth` is the only adapter method that may write the domain library storage.
- `discardProposal` must not write local truth. It may clear transient UI/proposal state only.

Domain state targets:

| Domain | Working state | Saved app truth |
|--------|---------------|-----------------|
| Buff | current Buff editor draft / visible draft state | `def.buff-editor.library.v1` |
| Weapon | current Sheet-Weapon draft / visible sheet state | `def.weapon-sheet.library.v1` |
| Operator | `def.operator-editor.draft.v1` | `def.operator-editor.library.v1` |
| Equipment | `def.equipment-sheet.draft.v1` | Task 13 must either introduce `def.equipment-sheet.library.v1` or explicitly keep draft-as-truth as a legacy boundary |

Buff migration rule:

- Current direct-write `fill.apply` behavior must move behind the proposal flow.
- `fill.apply` creates a proposal only. It must not call `persistLibraryDraft`, write undo, or write `def.buff-editor.library.v1`.
- `proposal.approve` / `Y` applies the normalized Buff payload to the current working draft.
- `proposal.save` / save `Y` writes `def.buff-editor.library.v1`, mirrors `def.buff-editor.draft.v1` if that is the existing save behavior, and creates the undo snapshot.
- `proposal.unsave` / save `N` must not write the Buff library.

## Weapon Fill Branch

Task 12 also opens the first horizontal branch beyond Buff: `weapon.fill`.

The goal of this branch is to prove the horizontal fill skeleton with a second domain. Weapon does not need every final extraction rule in one pass, but it must use the same adapter/review framework as Buff and must have a real command skeleton, schema boundary, validation path, proposal creation path, and storage boundary.

Weapon workflow requirements:

- `AiAgentProposal.domain` must use `weapon` for weapon fill proposals.
- `AiAgentSession.context.currentWorkflow` may be `weapon.fill`.
- Weapon fill proposals must enter the same `approval/save` state machine as Buff proposals.
- Weapon fill must not reuse Buff draft types, Buff storage keys, or Buff validators.
- Weapon fill must target the Sheet-Weapon business model and storage keys:
  - `def.weapon-sheet.draft.v1`
  - `def.weapon-sheet.library.v1`
- Weapon read/CRUD commands must mirror the Buff command surface enough for external agents to inspect business state before proposing changes:

```text
weapon.list [limit]
weapon.search <keyword>
weapon.show <id|name>
weapon.draft.show
weapon.open <id|name>
```

- Weapon fill commands should mirror the Buff proposal shape:

```text
weapon.fill.task
weapon.fill.check <WeaponFillAiDraft JSON>
weapon.fill.apply <WeaponFillAiDraft JSON>
```

Weapon branch boundary:

- `weapon.fill.check` validates only and writes nothing.
- `weapon.fill.apply` creates a `domain='weapon'` proposal first.
- Approval applies the proposal to the web working state.
- Save persists through the Sheet-Weapon save path.
- External agents must not directly write `def.weapon-sheet.*` storage.
- Task 12 should complete the reusable adapter registration and command path for `weapon.fill`.
- The first Weapon JSON schema may be minimal, but it must be explicit and testable. Do not accept arbitrary `unknown` payloads as valid weapon proposals.

Minimum `WeaponFillAiDraft` shape:

```ts
interface WeaponFillAiDraft {
  id: string;
  name: string;
  rarity: number;
  type?: string;
  description: string;
  imgUrl?: string;
  attackGrowth?: Record<string, number>;
  sourceName: string;
  source: string;
  skills: {
    skill1?: WeaponFillAiSkill;
    skill2?: WeaponFillAiSkill;
    skill3?: WeaponFillAiSkill;
  };
}

interface WeaponFillAiSkill {
  name: string;
  statType: string;
  effects: Record<string, WeaponFillAiEffect>;
  levels: Record<string, {
    value?: number;
    description?: string;
  }>;
}

interface WeaponFillAiEffect {
  name: string;
  type: string;
  category: 'condition' | 'passive';
  levels: Record<string, number>;
}
```

Weapon validation rules:

- `id` and `name` are required non-empty strings.
- `rarity` must be a finite number.
- skill keys are limited to `skill1 | skill2 | skill3`.
- only `skill3.effects` is preserved by Sheet-Weapon; `skill1.effects` and `skill2.effects` must be rejected.
- effect `category` is limited to `condition | passive`.
- `levels`, when present, must be an object whose values are numbers.
- `url` is not accepted as an `imgUrl` fallback. If source data has no image URL, leave `imgUrl` empty.
- unsupported effect types must be rejected or explicitly dropped by the weapon adapter; they must not be guessed into Buff modifier types.
- The weapon adapter must declare a `supportedEffectTypes: string[]` list. The first version may be small, but it must be explicit and used by validation.
- Weapon save behavior must follow existing Sheet-Weapon semantics. If Sheet-Weapon has no undo stack, Task 12 must explicitly keep that behavior and not invent a hidden undo mechanism.

Weapon task package requirements:

- `weapon.fill.task` must include the current weapon draft, the minimal `WeaponFillAiDraft` schema, supported effect types, and the same approval/save warning used by Buff.
- `weapon.fill.task` must not include official/static source data index or source read commands/endpoints.
- `weapon.fill.task` must not expose Buff modifier catalog as the weapon effect catalog.
- `weapon.fill.task` must return a short summary line and put the full package in `data`.

## Task 13 Operator And Equipment Fill Branches

Task 13 extends the Task 12 horizontal adapter framework to `operator.fill` and `equipment.fill`. It must not create a second review system. Operator and Equipment proposals use the same `AiAgentProposal`, `approval/save`, `proposal.approve/reject/save/unsave`, and `Y/N` flow as Buff and Weapon.

Shared Task 13 rules:

- `AiAgentWorkflow` must include `operator.fill` and `equipment.fill`.
- `operator.fill` and `equipment.fill` must register through `AgentFillDomainAdapter`.
- `executeCommand` must not grow a duplicated approval/save state machine for either domain.
- `*.fill.task` returns a structured task package in `data`; `lines` only summarize.
- `*.fill.check` validates only and writes no draft/library storage.
- `*.fill.apply` validates and creates a proposal only.
- Approval applies the proposal to working draft only.
- Save persists through the domain's saved app truth boundary.
- External agents may query proposals but must not advance approval/save by default.
- Domain adapters must own their schema, validator, normalizer, storage keys, supported type lists, and proposal summary.
- Weapon/Operator/Equipment Agent CLI code must not read official/static `public/data` directly. Source data belongs to app data services outside Agent CLI; Agent CLI owns only current/library/fill/proposal boundaries.

### Operator Fill Branch

Operator storage boundary:

```text
working draft: def.operator-editor.draft.v1
saved truth:   def.operator-editor.library.v1
```

Operator read/fill commands:

```text
operator.current
operator.library [limit]
operator.library.show <id|name>
operator.fill.task
operator.fill.check <OperatorFillAiDraft JSON>
operator.fill.apply <OperatorFillAiDraft JSON>
```

Minimum `OperatorFillAiDraft` shape:

```ts
interface OperatorFillAiDraft {
  id: string;
  name: string;
  rarity: number;
  profession: string;
  weapon: string;
  element: 'physical' | 'fire' | 'ice' | 'electric' | 'nature';
  mainStat: '力量' | '敏捷' | '智识' | '意志';
  subStat: '力量' | '敏捷' | '智识' | '意志';
  avatarUrl?: string;
  skills: Record<string, OperatorFillAiSkill>;
  buffs?: OperatorFillAiBuffs;
}

interface OperatorFillAiSkill {
  displayName: string;
  buttonType: 'A' | 'B' | 'E' | 'Q';
  iconUrl?: string;
  hitCount?: number;
  hitMeta?: Record<string, {
    displayName: string;
    element: 'physical' | 'fire' | 'ice' | 'electric' | 'nature';
    skillType: 'A' | 'B' | 'E' | 'Q';
    levels: Record<string, number>;
  }>;
}

type OperatorFillAiBuffs = Record<'talent' | 'potential' | 'skill', {
  effects: Record<string, {
    effectId: string;
    name: string;
    type: string;
    category: 'positive' | 'condition';
    value?: number;
    unit?: 'flat' | 'percent';
    description?: string;
    raw?: string;
  }>;
}>;
```

Operator validation rules:

- `id` and `name` are required non-empty strings.
- `rarity` must be a finite number.
- `profession`, `weapon`, `element`, `mainStat`, and `subStat` must use explicit allowlists from Operator editor options.
- Skill `buttonType` is limited to `A | B | E | Q`.
- Skill hit level values must be numbers, not string numbers.
- If buffs are accepted in v1, `supportedEffectTypes` and category allowlists must be declared and validated.
- If buffs are deferred to v2, the adapter must reject or drop `buffs` explicitly; it must not silently accept unknown buff structures.
- Attributes, talents, potentials, and full multi-hit extraction can be v2. Task 13 v1 should close the proposal loop with the minimal Operator identity and skill structure.

Operator task package requirements:

- Include the current Operator working draft.
- Include the minimal schema and validation allowlists.
- Do not include source data index or source read commands/endpoints.
- Include `supportedEffectTypes` if buffs are in scope, or a clear `buffsDeferred` warning if not.
- Include the standard approval/save warning.

### Equipment Fill Branch

Equipment storage boundary:

```text
working draft: def.equipment-sheet.draft.v1
saved truth:   Task 13 decision required
```

Current UI code uses `def.equipment-sheet.draft.v1` as the Equipment sheet persisted working library. Task 13 must choose one of two paths and document it in code/spec:

- Preferred: introduce `def.equipment-sheet.library.v1` as saved app truth and migrate/compat existing readers.
- Legacy-compatible: keep `def.equipment-sheet.draft.v1` as temporary saved truth and make every response/log call out this legacy boundary.

Equipment read/fill commands:

```text
equipment.current
equipment.library [limit]
equipment.library.show <id|name>
equipment.fill.task
equipment.fill.check <EquipmentFillAiDraft JSON>
equipment.fill.apply <EquipmentFillAiDraft JSON>
```

Minimum `EquipmentFillAiDraft` shape:

```ts
interface EquipmentFillAiDraft {
  updatedAt?: string;
  gearSets: Record<string, EquipmentFillAiGearSet>;
}

interface EquipmentFillAiGearSet {
  gearSetId: string;
  name: string;
  buffId?: string;
  imgUrl?: string;
  threePieceBuff?: EquipmentFillAiThreePieceBuff;
  equipments: Record<string, EquipmentFillAiItem>;
}

interface EquipmentFillAiItem {
  equipmentId: string;
  name: string;
  part: '护甲' | '护手' | '配件';
  imgUrl?: string;
  fixedStat?: {
    label: string;
    typeKey: 'defense' | 'hp' | 'flatAtk';
    value: number;
    unit: 'flat' | 'percent';
    raw?: string;
  };
  effects: Partial<Record<'effect1' | 'effect2' | 'effect3', EquipmentFillAiEffect>>;
}

interface EquipmentFillAiEffect {
  effectId: 'effect1' | 'effect2' | 'effect3';
  label: string;
  typeKey: string;
  category: 'ability' | 'buff';
  levels: Partial<Record<'0' | '1' | '2' | '3', number>>;
  unit: 'flat' | 'percent';
  raw?: string;
}

interface EquipmentFillAiThreePieceBuff {
  effectId: string;
  name: string;
  category: 'positive' | 'condition' | '';
  typeKey: string;
  value: number;
  unit: 'flat' | 'percent';
  raw?: string;
}
```

Equipment validation rules:

- Each gear set requires non-empty `gearSetId` and `name`.
- Equipment `part` is limited to `护甲 | 护手 | 配件`.
- `fixedStat.typeKey` is limited to `defense | hp | flatAtk`.
- Effect slots are limited to `effect1 | effect2 | effect3`.
- Effect category is limited to `ability | buff`.
- Unit is limited to `flat | percent`.
- Level keys are limited to `0 | 1 | 2 | 3`.
- All numeric values must be numbers, not string numbers.
- Unsupported stat/effect types must be rejected or explicitly dropped by the Equipment adapter; they must not be guessed into Buff or Operator effect types.

Equipment task package requirements:

- Include the current Equipment working draft/library.
- Include the minimal schema and stat/effect allowlists.
- Do not include source data index or source read commands/endpoints.
- Include the chosen Equipment saved truth boundary.
- Include the standard approval/save warning.

### Task 13 REST Surface

All domain-specific fill REST endpoints should use the same body format:

```json
{
  "protocolVersion": 1,
  "requestId": "optional-id",
  "draft": {}
}
```

Task 13 REST endpoints:

```text
GET  /api/operator/current
GET  /api/operator/library
GET  /api/operator/library/<id-or-name>
GET  /api/operator/fill/template
POST /api/operator/fill/check
POST /api/operator/fill/apply

GET  /api/equipment/current
GET  /api/equipment/library
GET  /api/equipment/library/<id-or-name>
GET  /api/equipment/fill/template
POST /api/equipment/fill/check
POST /api/equipment/fill/apply
```

REST rules:

- Domain-specific REST fill endpoints must call `runAiCliCommand` and the registered adapter.
- They must not duplicate schema validation or write logic.
- `POST /api/*/fill/apply` creates a proposal only and must not save local truth.
- Approval/save commands remain denied to default external REST clients.
- `GET /api/ai-cli/spec` and `GET /api/agent/skills` must advertise the source-read flow, schema, endpoint list, and write safety rules for Operator and Equipment.
- Task 13 does not require new evaluation, automated tests, or REST smoke coverage. Completion is scoped to implementation boundaries and documentation clarity.

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
- Approval, rejection, save, and unsave then follow the `Review Operation Contract` above.

Current pre-Task-12 behavior:

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
GET  /api/weapon/current
GET  /api/weapon/library
GET  /api/weapon/library/<id-or-name>
GET  /api/weapon/data
GET  /api/weapon/data/<id-or-name>
GET  /api/operator/current
GET  /api/operator/library
GET  /api/operator/library/<id-or-name>
GET  /api/operator/fill/template
POST /api/operator/fill/check
POST /api/operator/fill/apply
GET  /api/equipment/current
GET  /api/equipment/library
GET  /api/equipment/library/<id-or-name>
GET  /api/equipment/fill/template
POST /api/equipment/fill/check
POST /api/equipment/fill/apply
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

Task 13 domain-specific fill endpoints for Operator and Equipment use the same envelope:

```json
{
  "protocolVersion": 1,
  "requestId": "req-domain-check",
  "draft": {}
}
```

The `draft` object must match that domain's fill schema. Read-format responses from `current`, `library`, or `data` endpoints are source material; agents must convert them to the domain fill schema before `fill.check/apply`.

REST rule:

- REST endpoints must call the same validation and writer code as `/ai-cli`.
- REST must not become a second implementation of Buff writing.
- Agents should read `GET /api/buff/library` first. `GET /api/buff/current` is only active editor state.
- External agents must not infer that `ok:true` means business persistence is complete. They must inspect `proposal.approval` and `proposal.save` when a command enters the approval flow.
- REST proposal endpoints, if added, must distinguish query endpoints from user-confirmation endpoints. Query endpoints may be readonly; approval/save endpoints must not be available to default readonly agents.
- REST `*.fill.apply` creates a proposal only. The actual approval and save must happen in Web CLI.
- After REST apply, agents must guide users to open `/ai-cli` and use `Y/Y` or `proposal.approve #1` / `proposal.save #1`. Do not ask users to re-run `fill.apply` in the browser.

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
