const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { EventEmitter } = require('events');
const { spawn, spawnSync } = require('child_process');
const defHarness = require('../../harness/def-harness.cjs');
const { routeNativeTurnHarness } = require('./harness-turn-router.cjs');
const { createAgentRelease } = require('./agent-release.cjs');
const {
  SESSION_HARNESS_SEAL_KEY_ENV,
  createSessionHarnessSeal,
  ensurePersistentSessionHarnessSealKey,
  normalizeSealKey,
  sameSessionHarnessIdentity,
  verifySessionHarnessSeal,
} = require('./session-harness-seal.cjs');

const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-pro';
const OPENCODE_HOST = '127.0.0.1';
const OPENCODE_PORT_BASE = Number(process.env.DEF_OPENCODE_PORT || 17445);
const OPENCODE_PORT_MAX_ATTEMPTS = 20;

const projectRoot = path.resolve(__dirname, '..', '..', '..');
const runtimeRoot = path.join(projectRoot, 'agent', 'runtime', 'opencode-core');
const skillsRoot = path.join(projectRoot, 'agent', 'runtime', 'def', 'skills');
const defOpenCodeToolSource = path.join(projectRoot, 'agent', 'runtime', 'def-tools', 'opencode', 'def.js');
const defOpenCodePluginSource = path.join(projectRoot, 'agent', 'runtime', 'def-tools', 'opencode', 'plugin.js');
const defNodeWorkspaceCodecSource = path.join(projectRoot, 'agent', 'runtime', 'def-node-workspace', 'codec.mjs');
const runtimeLogDir = path.join(projectRoot, '.runtime', 'def-agent');
const agentWorkspaceDir = path.join(os.tmpdir(), 'dmg-end-field', 'def-agent-workspace');
let resolvedAgentWorkspaceDir = null;
const defaultDefOpenCodeHome = path.join(projectRoot, '.runtime', 'def-opencode');
const DEF_TRANSCRIPT_SCHEMA_VERSION = 1;
const harnessRuntimeRoot = path.join(projectRoot, '.runtime', 'def-harness');
const harnessBaselineSource = path.join(projectRoot, 'agent', 'harness', 'baseline', 'stable-v0');
const sessionHarnessSealKeyFile = path.join(runtimeLogDir, 'session-harness-seal.key');
const nativeHarnessLoader = defHarness.createLoader(harnessRuntimeRoot);
const nativeHarnessBySession = new Map();
let sessionHarnessSealKey = '';
let sessionHarnessSealKeySignature = '';

const capabilityPolicy = {
  name: 'def-runtime-native-tools-v2',
  workspace: agentWorkspaceDir,
  allowed: ['model-chat', 'structured-output', 'skill', 'native-question', 'def-node-code', 'def-node-crud', 'def-data-resource'],
  denied: [
    'bash',
    'arbitrary-project-read',
    'arbitrary-project-edit',
    'task',
    'todowrite',
    'websearch',
    'lsp',
    'external_directory',
    'plan_enter',
    'plan_exit',
  ],
  webfetchAllow: [],
};

const skillMap = {
  operator: { agent: 'def-operator', skill: 'operator-fill', label: '填干员' },
  weapon: { agent: 'def-weapon', skill: 'weapon-fill', label: '填武器' },
  equipment: { agent: 'def-equipment', skill: 'equipment-fill', label: '填装备' },
  workbench: { agent: 'def-workbench', skill: 'timeline-workbench', label: '主界面排轴' },
  search: { agent: 'def-search', skill: 'rest-search', label: '查库' },
  repair: { agent: 'def-repair', skill: 'check-error-repair', label: '修复错误' },
  audit: { agent: 'def-audit', skill: 'akedatabase-fill-tool', label: '审计数据' },
};

const DEF_EMBEDDED_PROFILE_VERSION = 1;

function buildNativeHostProfile(host = 'ai-cli') {
  const normalizedHost = host === 'workbench' ? 'workbench' : 'ai-cli';
  const skillId = normalizedHost === 'workbench' ? 'workbench' : 'operator';
  const selected = skillMap[skillId];
  return Object.freeze({
    schemaVersion: DEF_EMBEDDED_PROFILE_VERSION,
    host: normalizedHost,
    agent: selected.agent,
    skillId,
    theme: 'def-line-blue',
    lockedAgent: true,
    lockedModel: true,
    features: Object.freeze({
      sessionCreate: true,
      sessionList: true,
      sessionArchive: true,
      nodeReview: true,
      nodeFiles: true,
      nodeApproval: true,
      modelSelect: false,
      providerManage: false,
      serverManage: false,
      projectManage: false,
      terminalOpen: false,
      gitManage: false,
      shareSession: false,
      settingsAppearance: false,
      settingsShortcuts: false,
    }),
  });
}

let opencodeProcess = null;
let opencodeConfigHash = '';
let opencodeReadyUrl = '';
let opencodeReadyPort = 0;
let opencodeStartPromise = null;
let opencodeStartConfigHash = '';
let activeRun = null;
const streamSessions = new Map();

function normalizeDeepSeekModel(model) {
  const value = typeof model === 'string' ? model.trim() : '';
  if (!value || value === 'deepseek-chat') return DEFAULT_DEEPSEEK_MODEL;
  return value;
}

function sanitizeDeepSeekConfig(config = {}) {
  return {
    apiKey: typeof config.apiKey === 'string' ? config.apiKey.trim() : '',
    baseUrl: typeof config.baseUrl === 'string' && config.baseUrl.trim()
      ? config.baseUrl.trim().replace(/\/+$/, '')
      : DEFAULT_DEEPSEEK_BASE_URL,
    model: normalizeDeepSeekModel(config.model),
  };
}

function normalizeKnowledgeText(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s_\-·・.]/g, '');
}

function readGameKnowledge() {
  try {
    const knowledgePath = path.join(projectRoot, 'src', 'data', 'gameKnowledge.json');
    return JSON.parse(fs.readFileSync(knowledgePath, 'utf8'));
  } catch {
    return null;
  }
}

function buildGameKnowledgePromptLines() {
  const knowledge = readGameKnowledge();
  if (!knowledge) return [];
  const operatorAliases = Array.isArray(knowledge.operatorAliases)
    ? knowledge.operatorAliases.flatMap((entry) => (
      Array.isArray(entry.terms) ? entry.terms.map((term) => `${term}=${entry.name}`) : []
    )).join(', ')
    : '';
  const gearAliases = Array.isArray(knowledge.gearSetAliases)
    ? knowledge.gearSetAliases.flatMap((entry) => (
      Array.isArray(entry.terms)
        ? entry.terms
          .filter((term, index, terms) => terms.findIndex((item) => normalizeKnowledgeText(item) === normalizeKnowledgeText(term)) === index)
          .map((term) => `${term}=${entry.gearSetId}(${entry.name})`)
        : []
    )).join(', ')
    : '';
  return [
    operatorAliases ? `- Common operator aliases: ${operatorAliases}.` : '',
    gearAliases ? `- Common gear-set aliases: ${gearAliases}. When an alias matches, prefer gearSetId over gearSetName.` : '',
  ].filter(Boolean);
}

function summarizeConfig(config = {}) {
  const next = sanitizeDeepSeekConfig(config);
  return {
    provider: 'deepseek',
    baseUrl: next.baseUrl,
    model: next.model,
    apiKeyConfigured: Boolean(next.apiKey),
  };
}

function normalizeThinkingEffort(value) {
  return ['low', 'medium', 'high'].includes(value) ? value : 'medium';
}

function describeThinkingEffort(value) {
  const effort = normalizeThinkingEffort(value);
  if (effort === 'low') {
    return 'Use a quick pass. Prefer concise Chinese answers and ask for missing critical inputs.';
  }
  if (effort === 'high') {
    return 'Use a careful pass. Check assumptions, missing conditions, tool results, and repair options before answering. Reply in Chinese unless the user asks otherwise. Do not reveal hidden chain-of-thought.';
  }
  return 'Use a balanced pass. Be concise, reply in Chinese unless the user asks otherwise, and reason through incomplete conditions before answering.';
}

function deepSeekReasoningEffort(value) {
  const effort = normalizeThinkingEffort(value);
  if (effort === 'high') return 'max';
  return 'high';
}

function buildCapabilityPermission(_webfetchAllow = [], options = {}) {
  const nodeCode = options.nodeCode === true;
  return {
    bash: 'deny',
    edit: nodeCode ? { '*': 'deny', 'node/working/**': 'allow', '*/node/working/**': 'allow', '**/node/working/**': 'allow' } : 'deny',
    read: nodeCode ? {
      '*': 'deny',
      'node/**': 'allow',
      '*/node/**': 'allow',
      '**/node/**': 'allow',
      'retrieval/**': 'allow',
      '*/retrieval/**': 'allow',
      '**/retrieval/**': 'allow',
      '.def-workbench-context.json': 'allow',
      'README.md': 'allow',
      'AGENTS.md': 'allow',
    } : 'deny',
    grep: nodeCode ? 'allow' : 'deny',
    glob: nodeCode ? 'allow' : 'deny',
    task: 'deny',
    todowrite: 'deny',
    websearch: 'deny',
    lsp: 'deny',
    external_directory: 'deny',
    question: 'allow',
    plan_enter: 'deny',
    plan_exit: 'deny',
    skill: 'allow',
    'def_*': 'allow',
    // This is a user-visible renderer mutation.  It must not inherit the
    // broad native-tool allow rule, otherwise context.ask() is auto-approved.
    def_operator_config_patch: 'ask',
    def_team_selection_apply: 'ask',
    def_team_loadout_plan_apply: 'ask',
    def_node_use: 'ask',
    def_node_delete: 'ask',
    def_node_restore: 'ask',
    def_node_code_discard: 'ask',
    webfetch: 'deny',
  };
}

function buildAgentPermission(skillId) {
  return buildCapabilityPermission([], { nodeCode: true });
}

function capabilityPolicySummary() {
  return {
    name: capabilityPolicy.name,
    workspace: getAgentWorkspaceDir(),
    allowed: capabilityPolicy.allowed,
    denied: capabilityPolicy.denied,
    webfetchAllow: capabilityPolicy.webfetchAllow,
  };
}

function deepSeekRequestOptions(model, thinkingEffort) {
  const normalizedModel = String(model || '').toLowerCase();
  const supportsThinking = normalizedModel.includes('v4') || normalizedModel.includes('reasoner') || normalizedModel.includes('r1');
  if (!supportsThinking) return {};
  return {
    thinking: { type: 'enabled' },
    reasoningEffort: deepSeekReasoningEffort(thinkingEffort),
  };
}

function buildAgentPrompt(skillId) {
  const info = skillMap[skillId] || skillMap.operator;
  if (skillId === 'workbench') {
    return [
      'You are the embedded DEF main-workbench assistant operating an isolated child-node workspace.',
      'Reply in Chinese by default. Keep the final answer short and describe only the visible outcome.',
      'Do not expose API keys, hidden configuration, internal protocol noise, session ids, REST URLs, or adapters.',
      '',
      '## Tree-bound execution',
      '- You can arrange and edit the DEF timeline. 排轴、调轴、改顺序、改格位、添加/删除/复制技能和组合 Buff are core Workbench responsibilities.',
      '- This conversation is permanently bound to one timeline document and its Work Node tree, never to one Work Node. A Work Node is only a flexible checkout or draft.',
      '- Call def_workbench_context before every answer about the current canvas except a direct current-node question, and before every mutation. It is the only source for the active checkout after a user manually switches nodes. Never call it for a read-only question about the current selected team’s loadouts or team-wide equipment planning: those turns must use only the dedicated batch data resources below.',
      '- When the checkout gate is ready, a direct current-node question uses def_workbench_current_node as its only discovery tool. Reply with that tool result only; never derive a current node from a UI selection, a parent, a node cursor, a latest-applied node, or the transcript.',
      '- When the injected Workbench state or def_workbench_context reports checkoutPhase="checkout-changed", checkoutTransition.changed, or requiresRebind, the hard gate is active: do not answer, read another node tool, or mutate. First call def_node_bind with nodeId="". After it succeeds, call def_workbench_context again, reason at high effort from that checkout only, then continue.',
      '- If def_node_bind rejects because node/working has unsynchronized edits, stop node-tool activity immediately. Never retry bind, write/edit node files, discard, rebuild, or fork around that error. Tell the user the existing isolated draft is preserved and ask whether to review it in this session or start a new DEF session.',
      '- @N-L is immutable coordinate notation: nodeIndex=N-1 and lineIndex=L-1. Before editing or saying that a coordinate is empty, call def_workbench_buttons with both exact indices. If it returns no candidate, report that it is empty; never reinterpret it as an ordinal or choose another button.',
      '- For “which skill has the most Buffs”, call def_workbench_buff_ranking with the character name and report its first result. Never manually count, mix drafts with checkout, or infer a visible-range cutoff.',
      '- Mutations happen through typed state transitions. Timeline edits use an isolated child Work Node; weapon and equipment configuration changes use a horizontal sibling branch. Explicit roster selection uses def_team_selection_apply and must not be recreated through node files or generic commands.',
      '- If a timeline-edit session has no draft workspace, call def_node_fork. Before calling it, compose a concise Chinese change name and one-sentence scope description; both are Agent-written and must never use ids, timestamps, [ai] prefixes, or generic fixed names. Use placement=child for timeline edits. To continue the active checkout after a manual switch, call def_node_bind with nodeId="". After that guard converges, if the user explicitly named a different existing ready draft, bind that exact node before validation/use; never call def_node_use while still bound to the checkout anchor.',
      '- ROSTER SELECTION: For an explicit request to choose or replace operators, resolve every requested operator to an exact stable id with def_data_operator_catalog, then call def_team_selection_apply once with an Agent-written title and description. The typed policy, not the Agent, decides storage: identical ordered roster is a no-op; reordering, adding/removing, or any roster retaining at least one current operator creates a horizontal Work Node in the same SQLite; only a complete four-person result with zero overlap creates a new temporary SQLite and detaches this AI session. Native approval and the returned visible postcondition are mandatory. Never call def_node_fork, edit selection.json, or report success from queue acknowledgement.',
      '- An unambiguous mutation request authorizes creating and editing the correctly placed isolated draft immediately. Never ask whether to fork or preview. 先看看 means complete rebuild/validation/diff, then stop before approval/use.',
      '- Use native read/edit/apply_patch only on node/working/*.json. The codec rebuilds storage mirrors; node/base, node/context, node/generated, and manifest are read-only. A retrieval artifact is the sole exception: it is read/grep-only under the exact retrieval/<artifactId> root returned by def_data_native_catalog_materialize; never edit it or use it as Work Node source.',
      '- Native file tools are allowed only inside this session directory. Never access project source, another session, another node directory, raw local storage, Share Data, or a retrieval artifact other than the one returned in this session.',
      '- The skill tool returns the complete selected Skill instructions. After it succeeds, never glob, grep, list, or read the runtime Skill directory. Use the loaded instructions plus trusted def_data_* resources. If any generic file tool is denied outside the session directory once, do not try another path or file tool for that resource.',
      '- DEF 技能术语固定为：A=普通重击/普通攻击，B=战技，E=连携技，Q=终结技/大招，Dot=持续伤害；绝不可把 B 与 E 对调。用户说“重击”时，处决和下落攻击不是可替代项：只可选择 def_data_skill 返回的普通重击（heavy）候选；若无唯一候选，发 native question，不得猜测。用户以战技/连携/大招/重击等语义词而非精确技能名排轴时，先调用 def_data_skill 一次取得该干员的可信语义候选，再写入节点。',
      '- The live Workbench snapshot skillCatalog is a trusted selected-operator identity catalog. If it contains an exact characterId + skillType + skillDisplayName match, use its skillId directly as runtimeSkillId and do not call def_data_skill merely to place that exact timeline button. customHits, icon URLs, runtime snapshots, and damage multipliers are optional only for button placement. For a read-only question about a skill multiplier, hit composition, element, or damage classification, call def_data_skill exactly once with the exact operator plus the user\'s complete skill id/name; never shorten the name, split out a hit term, or probe operator/knowledge/buttons first. Use its operator-catalog facts. Exact skill/hit names take priority over semantic aliases: 图腾下落 is a named Q skill, not the A-type 下落攻击 variant. Per-hit facts are authoritative: a parent Q skill may include a hit whose skillType is B. Never infer every hit from the parent A/B/E/Q type, and never claim values are unavailable before making that exact typed query.',
      '- After editing, call def_node_sync_validate. Use def_node_diff when the user needs review evidence.',
      '- Call def_node_use only after validation and any required approval. It is the only normal step that may touch current checkout.',
      '- When the current user says 重新发出审核, 重新提交审批, 提交审核, or asks you to wait for their personal approval, validation is not the terminal step. Call def_node_use in that same turn; it creates the real native pending approval and blocks. Never claim 待审批 when no native pending approval exists.',
      '- Do not translate a completed node file back into button-by-button commands or a legacy Patch DSL.',
      '- Weapon and equipment assignment is not a Work Node inputs.json edit. First call def_operator_config_preview for one exact proposed configuration and show only its verified result. That preview does not create a branch or apply anything. Only after the user’s later, explicit application instruction (for example “确认应用/换上/就按这套应用”) may you call def_operator_config_patch once with the unchanged proposalToken. A suitability comparison, correction, question such as “为什么不用…”, or any changed slot/candidate/priority requires the Agent to discard the old proposalToken and never reuse it; do not assume that this Agent-side rule revoked the token on the server. Recompute a preview and wait for a new explicit application instruction. Supply a short Agent-written nodeTitle and a concise nodeDescription for the visible horizontal configuration branch; do not use a fixed operator-config title. Its native approval and live operator-config postcondition are required; never treat Work Node checkout, queue acknowledgement, or validation alone as loadout success.',
      '',
      '## Tool families',
      '- def-node-code: native read/edit/apply_patch in the bound child-node workspace.',
      '- def-node-crud: fork, bind, validate, diff, approval, use, restore, and simple structured node operations.',
      '- def-data-resource: trusted operator, weapon, equipment, skill, Buff, and damage data.',
      '- Legacy REST tools are compatibility fallbacks while migration is incomplete; do not treat their current list as the architecture.',
      '',
      '## Interaction rules',
      '- Read-only questions do not create or use a node.',
      '- For “当前四人 / 全队 / 他们 / 每个人” asking what is currently equipped or configured, call def_data_team_loadouts exactly once. Do not call def_workbench_context, def_data_operator, def_data_weapon, or def_data_equipment for that answer.',
      '- EQUIPMENT EVIDENCE: Native catalog artifacts are an optional evidence tool, not a Harness or turn route. Use def_data_native_catalog_materialize when a request needs exhaustive matching, full fixedStat/effects fields, a multi-piece comparison, or another specialized full-field equipment comparison; native-read its manifest before grep/read inside the returned artifact root. Exact/simple lookups may use a trusted typed resource directly. Legacy summaries may help discovery but cannot prove omitted fixedStat/effects, dropped main stats, elemental triggers, or benefits. Read-only research never creates a Work Node or applies a configuration.',
      '- GUIDE-FIRST OPERATOR FIT: Call def_data_operator_build_guide first only when the request judges which weapon or equipment better fits a specific operator: an operator-specific recommendation, optimization, or suitability comparison. It must be the first tool of that flow: do not pre-read Workbench context, selected operators, team loadouts, generic operator/skill resources, or catalog candidates. Pure catalog facts, field/ID/slot/effect lookups, and comparisons that do not judge operator fit use the narrowest trusted typed catalog resource and do not require guide discovery. For the applicable operator-fit flow, the guide tool resolves exact operator identity and returns GUIDE_FOUND, PARTIAL_GUIDE_FOUND, or GUIDE_NOT_FOUND; never derive this state from an arbitrary def_data_game_knowledge candidate. GUIDE_FOUND includes one bounded operator-specific build section plus a server-compiled plannerProfile and same-turn plannerProfileCapability; pass both unchanged to planning, never transcribe or edit them, and do not call def_data_game_knowledge, def_data_game_knowledge_section, or the fallback profile. For PARTIAL_GUIDE_FOUND or GUIDE_NOT_FOUND only, call def_data_operator_build_profile with the exact fallbackToken returned by discovery; pass its authorized plannerProfile and plannerProfileCapability unchanged. Partial fallback preserves explicit guide priorities and fills only named gaps, while not-found fallback derives the whole trusted profile. If no capability is returned because evidence is incomplete, do not plan. Do not bypass this token-gated boundary with generic operator or skill resources. The current catalog or native artifact, not the guide, verifies every equipment name, stable id, slot, fixedStat, effect, and set membership.',
      '- GUIDE SCOPE: A guide claim tied to one named team, rotation, potential level, or equipment mode remains scoped to that condition. Never rewrite “在这个阵容里输出占比约10%” as the operator\'s general identity or say the operator is inherently support-oriented. Separate guide context from current-catalog facts, and present the planner\'s unresolved conditional effects as unresolved rather than using the guide to settle them.',
      '- WEAPON FIT BRANCH: Follow def_data_operator_build_guide.evidenceRequirements literally. When combatConvention=not-required and GUIDE_FOUND supplies a profile capability, call def_data_weapon_fit_plan directly and omit conventionBundleHash. Only when combat conventions are required use def_data_combat_conventions and the exact role-aware profile sequence. Do not add def_workbench_context, generic operator/skill, native materialization, weapon summaries, loadout candidates, damage or buff probes. A typed planner error is terminal for this turn: report its structured nextAction and do not construct a fallback ranking. Missing edges/conflicts stop ranking. Preserve deterministic/high-probability/low-probability/unknown exactly; never invent percentages or causal edges. READY_WITH_TRADEOFFS is an unordered tradeoff matrix: present only its shortlist facts; never label candidates first/second, mention diagnostic non-shortlist candidates, call one more comprehensive, invent claims such as rare/independent multiplier or best team scenario, turn evidence dimensions into an overall score, or substitute another teammate for a condition that requires the equipped operator.',
      '- SOURCE-ONLY GUIDE ROUTE: When the user explicitly asks what a named guide, author, link, or quoted passage says, call def_data_game_knowledge once with the user wording, then def_data_game_knowledge_section exactly once using that candidate’s exactReadPolicy.requiredSectionId (or recommendedSection.sectionId only if no policy exists). Do not call def_data_team_loadouts when the returned guide title itself identifies the four-person roster: the title is the sole roster source for this answer. Only if a returned guide does not identify its requested roster may team state be read once before its single section read. Then stop tool use and answer. A later user confirmation such as “那你配装吧” must call def_data_team_loadout_plan exactly once; it reuses this session’s exact guide section and never searches the guide or catalog again. If its state is REQUIRES_CONFIRMATION, show every returned decision and option exactly, then stop. After the user plainly chooses an offered option, call def_team_loadout_plan_revise with only that returned decisionId/optionId; if its new state is READY and the user asked to equip, call def_team_loadout_plan_apply exactly once. Never guess a decision id, substitute products, apply a non-READY plan, or call per-item resources. exactReadPolicy is a hard execution limit, not advice: never read a second section, including 阵容概述. “先让我确认” means a source-faithful draft only; it never authorizes mapping guide names to product-library ids or preparing an application. For a four-person source question, list the four names exactly as the matched title gives them, but never say or imply that they equal, match, differ from, or are equipped by the current team. State only verbatim-level facts from that one section; preserve its names, thresholds, and notation exactly (for example, never rename 专1+ as M1+). Mark anything absent as 待确认. End at the source-faithful draft itself. Never call def_data_loadout_candidates, def_data_weapon, def_data_equipment, any per-person resource, file tool, permission, or Work Node tool after this source-only route starts.',
      '- For any other read-only current-team operator-fit weapons/equipment recommendation or “先让我确认” request, first call def_data_team_loadouts once only when current team identity is actually needed. After the applicable guide-first evidence stage, choose the narrowest trusted catalog resource that can support the question; upgrade to a native catalog artifact when a full-field comparison or evidence trail is needed. Return one best evidence-backed combination and at most two close alternatives, never an exhaustive topology/candidate dump. Pure catalog fact queries and comparisons unrelated to operator fit skip guide discovery and use the narrowest typed resource. Do not materialize/fork/edit/use a Work Node, or request permission.',
      '- Within one turn, never repeat the same data resource with the same input. A reference search is for recall; after it returns a matching reference, do not try aliases, pinyin, abbreviations, or keyword searches against that guide. Use its exact section reader once, then report scoped missing facts rather than guessing. A user correction, a suitability comparison that challenges the reviewed loadout, or “为什么不用……” requires the Agent to discard the affected conclusion and any prior proposalToken and never reuse them; server-side token revocation is not assumed. Restart from the earliest affected guide/profile/filter stage, answer the correction, and never restate the old plan as if nothing changed or treat the correction as approval.',
      '- Any two tool failures with the same root code in one user turn end tool use for that turn, including generic file permission denials. Report 未应用, the failing stage, and one recovery action; never continue until max-step.',
      '- A confirmed named-guide plan uses def_team_loadout_plan_apply exactly once, never four def_operator_config_patch calls. Give its horizontal branch a concise Agent-written nodeTitle and nodeDescription rather than a fixed team-loadout label. It owns one native approval and serial server application. A timeline mutation is not complete until node validation passes and, when requested, def_node_use confirms the checkout. An operator loadout mutation is complete only when its plan postcondition reports APPLIED.',
      '- Ask only when the target or approval is genuinely ambiguous. Do not invent operator, equipment, skill, or Buff data.',
      '- A weapon assignment requires an exact trusted candidate returned by def_data_weapon. If that resource returns no candidate for a requested operator/loadout, do not fork or edit a “full weapon and equipment” draft, do not claim a weapon was assigned, and report the loadout as blocked by unavailable weapon data. Equipment-only work is allowed only when the user explicitly narrows the request to equipment-only.',
      '- For an occupied-slot ambiguity, keep or restore a valid draft and use the native question tool with business choices; never ask only in ordinary assistant prose.',
      '- Never say that you lack timeline-arrangement capability merely because there is no single tool named 排轴. Use node code editing plus CRUD and trusted resources.',
      '- Do not narrate plans, chain of thought, tool names, URLs, command ids, step tables, or suggested next steps.',
      '- If application is still pending, say it is waiting for execution confirmation; never claim success without evidence.',
      ...buildGameKnowledgePromptLines(),
    ].join('\n');
  }
  return [
    'You are the embedded OpenCode agent inside DEF Shell.',
    'Reply in Chinese by default. Use another language only when the user explicitly asks for it or quotes text that must remain unchanged.',
    'Keep replies practical, short, and action-oriented.',
    'Do not expose API keys, hidden configuration, or internal protocol noise.',
    'Do not use webfetch, shell, task/subagents, git, or arbitrary project files.',
    'Use the registered def_data_* tools for operator, weapon, equipment, skill, Buff, and damage resources.',
    'When this AI CLI task explicitly creates or binds a Work Node, use native read/edit/apply_patch only on that session node/working/*.json and rebuild through DEF node tools; never inherit the main Workbench context.',
    'Use native OpenCode permission prompts for approval. Never claim a write succeeded without tool evidence.',
    'When required information is missing, ask for the smallest missing input. Never invent game data.',
    `Current DEF capability: ${info.label}.`,
    `Load the native skill "${info.skill}" when its detailed workflow is needed.`,
  ].join('\n');
}

function buildOpenCodeConfig(config) {
  const deepseek = sanitizeDeepSeekConfig(config);
  const modelRef = `deepseek/${deepseek.model}`;
  const agents = {};
  for (const id of Object.keys(skillMap)) {
    const info = skillMap[id];
    if (agents[info.agent]) {
      throw new Error(`Duplicate DEF OpenCode agent identity: ${info.agent}`);
    }
    agents[info.agent] = {
      model: modelRef,
      mode: 'primary',
      prompt: buildAgentPrompt(id),
      options: deepSeekRequestOptions(deepseek.model, 'high'),
      permission: buildAgentPermission(id),
      steps: id === 'workbench' ? 24 : 12,
    };
  }

  return {
    model: modelRef,
    default_agent: skillMap.operator.agent,
    disabled_providers: ['opencode'],
    permission: buildCapabilityPermission(),
    skills: {
      paths: [skillsRoot],
    },
    plugin: [pathToFileURL(defOpenCodePluginSource).href],
    provider: {
      deepseek: {
        name: 'DeepSeek',
        npm: '@ai-sdk/openai-compatible',
        options: {
          apiKey: deepseek.apiKey,
          baseURL: deepseek.baseUrl,
        },
        models: {
          [deepseek.model]: {
            id: deepseek.model,
            name: deepseek.model,
            status: 'active',
            temperature: true,
            reasoning: /(?:v4|reasoner|r1)/i.test(deepseek.model),
            tool_call: true,
            limit: {
              context: /v4.*pro/i.test(deepseek.model) ? 100000000 : 64000,
              output: 4096,
            },
          },
        },
      },
    },
    agent: agents,
  };
}

function hashConfig(config) {
  return crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex');
}

function appendLog(line) {
  try {
    fs.mkdirSync(runtimeLogDir, { recursive: true });
    fs.appendFileSync(path.join(runtimeLogDir, 'opencode-adapter.log'), `${new Date().toISOString()} ${line}\n`);
  } catch {
    // Logging must not break chat.
  }
}

function getAgentWorkspaceDir() {
  fs.mkdirSync(agentWorkspaceDir, { recursive: true });
  if (!resolvedAgentWorkspaceDir) {
    resolvedAgentWorkspaceDir = fs.realpathSync(agentWorkspaceDir);
  }
  return resolvedAgentWorkspaceDir;
}

function getDefOpenCodeHome() {
  const configured = typeof process.env.DEF_OPENCODE_HOME === 'string' ? process.env.DEF_OPENCODE_HOME.trim() : '';
  return path.resolve(configured || defaultDefOpenCodeHome);
}

function getSessionHarnessSealKey() {
  let signature = '';
  try {
    const stat = fs.statSync(sessionHarnessSealKeyFile);
    signature = `${stat.size}:${stat.mtimeMs}`;
  } catch {
    signature = 'missing';
  }
  if (sessionHarnessSealKey && signature === sessionHarnessSealKeySignature) return sessionHarnessSealKey;
  sessionHarnessSealKey = ensurePersistentSessionHarnessSealKey(sessionHarnessSealKeyFile);
  const stat = fs.statSync(sessionHarnessSealKeyFile);
  sessionHarnessSealKeySignature = `${stat.size}:${stat.mtimeMs}`;
  return sessionHarnessSealKey;
}

function buildOpenCodeRuntimeEnv(openCodeConfig, options = {}) {
  const home = path.resolve(options.openCodeHome || getDefOpenCodeHome());
  const dataHome = path.join(home, 'data');
  const stateHome = path.join(home, 'state');
  const cacheHome = path.join(home, 'cache');
  const configHome = path.join(home, 'config');
  const dbPath = path.join(home, 'db', 'def-opencode.db');
  for (const dir of [dataHome, stateHome, cacheHome, configHome, path.dirname(dbPath)]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const configuredSealKey = options.harnessSealKey === undefined
    ? getSessionHarnessSealKey()
    : normalizeSealKey(options.harnessSealKey);
  if (!configuredSealKey) throw new Error('DEF Session Harness seal key is unavailable.');
  return {
    ...process.env,
    XDG_DATA_HOME: dataHome,
    XDG_STATE_HOME: stateHome,
    XDG_CACHE_HOME: cacheHome,
    XDG_CONFIG_HOME: configHome,
    OPENCODE_DB: dbPath,
    OPENCODE_DISABLE_PROJECT_CONFIG: '1',
    OPENCODE_DISABLE_SHARE: '1',
    OPENCODE_CONFIG_CONTENT: JSON.stringify(openCodeConfig),
    DEF_HARNESS_RUNTIME_ROOT: path.resolve(options.harnessRuntimeRoot || harnessRuntimeRoot),
    [SESSION_HARNESS_SEAL_KEY_ENV]: configuredSealKey,
  };
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function platformRuntimeTarget() {
  const platform = process.platform === 'win32'
    ? 'win32'
    : process.platform === 'darwin'
      ? 'darwin'
      : process.platform === 'linux'
        ? 'linux'
        : process.platform;
  return `${platform}-${process.arch}`;
}

function runtimeBinaryName() {
  return process.platform === 'win32' ? 'opencode.exe' : 'opencode';
}

function resolveAsarUnpackedPath(filePath) {
  const marker = `${path.sep}app.asar${path.sep}`;
  if (!filePath.includes(marker)) return filePath;
  return filePath.replace(marker, `${path.sep}app.asar.unpacked${path.sep}`);
}

function getRuntimeManifest() {
  return readJsonFile(path.join(runtimeRoot, 'manifest.json'));
}

function getRuntimeChecksums() {
  return readJsonFile(path.join(runtimeRoot, 'checksums.json'));
}

function resolveOpenCodeBinary() {
  const target = platformRuntimeTarget();
  const binaryName = runtimeBinaryName();
  const manifest = getRuntimeManifest();
  const candidates = [];

  if (manifest?.runtimeTarget === target && typeof manifest.binary === 'string' && manifest.binary) {
    candidates.push(path.join(runtimeRoot, manifest.binary));
  }
  candidates.push(path.join(runtimeRoot, 'bin', target, binaryName));

  for (const candidate of candidates) {
    const resolved = resolveAsarUnpackedPath(candidate);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;
  }

  throw new Error(
    `OpenCode runtime binary is missing for ${target}. Run "npm run build:opencode-runtime" before starting DEF agent.`,
  );
}

function processRunning(child) {
  return Boolean(child && child.exitCode === null && !child.killed);
}

function stopOpenCodeProcess() {
  if (!processRunning(opencodeProcess)) {
    opencodeProcess = null;
    opencodeReadyUrl = '';
    opencodeReadyPort = 0;
    return;
  }
  killProcessTree(opencodeProcess.pid);
  opencodeProcess = null;
  opencodeReadyUrl = '';
  opencodeReadyPort = 0;
}

function killProcessTree(pid) {
  if (!pid) return false;
  try {
    if (process.platform === 'win32') {
      const result = spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      return result.status === 0;
    }
    process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

function cleanupStaleOpenCodeProcesses() {
  if (process.platform !== 'win32') return;
  const script = `
$hostName = '${OPENCODE_HOST.replace(/'/g, "''")}'
$processes = Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -and
  $_.CommandLine -like '*opencode.exe*' -and
  $_.CommandLine -like '* serve *' -and
  $_.CommandLine -like ('*--hostname=' + $hostName + '*')
}
foreach ($process in $processes) {
  taskkill.exe /PID $process.ProcessId /T /F | Out-Null
}
`.trim();
  spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    stdio: 'ignore',
    windowsHide: true,
  });
}

function canListenOnPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, OPENCODE_HOST);
  });
}

async function findOpenCodePort() {
  for (let offset = 0; offset < OPENCODE_PORT_MAX_ATTEMPTS; offset += 1) {
    const port = OPENCODE_PORT_BASE + offset;
    if (await canListenOnPort(port)) return port;
  }
  throw new Error(`No available OpenCode port from ${OPENCODE_PORT_BASE} to ${OPENCODE_PORT_BASE + OPENCODE_PORT_MAX_ATTEMPTS - 1}`);
}

function waitForOpenCodeReady(child, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`OpenCode source server startup timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout?.off('data', onStdout);
      child.stderr?.off('data', onStderr);
      child.off('exit', onExit);
      child.off('error', onError);
    };
    const parse = () => {
      for (const line of output.split(/\r?\n/)) {
        if (!line.startsWith('opencode server listening')) continue;
        const match = /on\s+(https?:\/\/[^\s]+)/.exec(line);
        if (match) {
          cleanup();
          resolve(match[1]);
        }
      }
    };
    const onStdout = (chunk) => {
      const text = chunk.toString();
      output += text;
      appendLog(`[stdout] ${text.trim()}`);
      parse();
    };
    const onStderr = (chunk) => {
      const text = chunk.toString();
      output += text;
      appendLog(`[stderr] ${text.trim()}`);
    };
    const onExit = (code, signal) => {
      cleanup();
      reject(new Error(`OpenCode source server exited before ready: code=${code} signal=${signal}`));
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    child.stdout?.on('data', onStdout);
    child.stderr?.on('data', onStderr);
    child.once('exit', onExit);
    child.once('error', onError);
  });
}

async function ensureOpenCodeServer(config, skillId, thinkingEffort) {
  const openCodeConfig = buildOpenCodeConfig(config);
  const harnessSealKey = getSessionHarnessSealKey();
  const nextHash = hashConfig({
    config: openCodeConfig,
    opencodeHome: getDefOpenCodeHome(),
    harnessRuntimeRoot,
    harnessSealKeyHash: crypto.createHash('sha256').update(harnessSealKey).digest('hex'),
  });
  if (processRunning(opencodeProcess) && opencodeConfigHash === nextHash && opencodeReadyUrl) {
    return opencodeReadyUrl;
  }

  if (opencodeStartPromise) {
    if (opencodeStartConfigHash === nextHash) return opencodeStartPromise;
    try {
      await opencodeStartPromise;
    } catch {
      // The next configuration still needs its own startup attempt.
    }
    return ensureOpenCodeServer(config, skillId, thinkingEffort);
  }

  const startPromise = (async () => {
    stopOpenCodeProcess();
    cleanupStaleOpenCodeProcesses();
    const directory = getAgentWorkspaceDir();
    fs.mkdirSync(runtimeLogDir, { recursive: true });
    opencodeConfigHash = nextHash;
    opencodeReadyPort = await findOpenCodePort();
    const binaryPath = resolveOpenCodeBinary();
    appendLog(`[policy] ${JSON.stringify(capabilityPolicySummary())}`);
    const child = spawn(binaryPath, [
      'serve',
      `--hostname=${OPENCODE_HOST}`,
      `--port=${opencodeReadyPort}`,
    ], {
      cwd: directory,
      env: buildOpenCodeRuntimeEnv(openCodeConfig, { harnessSealKey, harnessRuntimeRoot }),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    opencodeProcess = child;
    child.once('exit', (code, signal) => {
      appendLog(`[exit] code=${code} signal=${signal}`);
      if (opencodeProcess !== child) return;
      opencodeProcess = null;
      opencodeReadyUrl = '';
      opencodeReadyPort = 0;
    });

    const readyUrl = await waitForOpenCodeReady(child);
    if (opencodeProcess !== child || !processRunning(child)) {
      throw new Error('OpenCode runtime startup was superseded before it became ready.');
    }
    opencodeReadyUrl = readyUrl;
    return readyUrl;
  })();
  opencodeStartPromise = startPromise;
  opencodeStartConfigHash = nextHash;
  try {
    return await startPromise;
  } finally {
    if (opencodeStartPromise === startPromise) {
      opencodeStartPromise = null;
      opencodeStartConfigHash = '';
    }
  }
}

async function getOpenCodeServerForRead(config, skillId, thinkingEffort) {
  if (processRunning(opencodeProcess) && opencodeReadyUrl) {
    return opencodeReadyUrl;
  }
  return ensureOpenCodeServer(config, skillId, thinkingEffort);
}

function requestJson(method, url, body, signal, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const target = new URL(url);
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method,
      headers: {
        Accept: 'application/json',
        ...(payload ? {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(payload),
        } : {}),
      },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        let parsed = null;
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch {
          parsed = raw;
        }
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          const message = typeof parsed?.message === 'string'
            ? parsed.message
            : typeof parsed?.name === 'string'
              ? parsed.name
              : `OpenCode HTTP ${response.statusCode}`;
          reject(new Error(`${message}${typeof parsed === 'string' ? `: ${parsed.slice(0, 300)}` : ''}`));
          return;
        }
        resolve(parsed);
      });
    });
    const timer = setTimeout(() => request.destroy(new Error('OpenCode request timeout')), timeoutMs);
    request.on('close', () => clearTimeout(timer));
    request.on('error', reject);
    if (signal) {
      if (signal.aborted) request.destroy(signal.reason || new Error('aborted'));
      signal.addEventListener('abort', () => request.destroy(signal.reason || new Error('aborted')), { once: true });
    }
    if (payload) request.write(payload);
    request.end();
  });
}

async function subscribeEvents(baseUrl, directory, sink, signal) {
  const url = `${baseUrl}/event?directory=${encodeURIComponent(directory)}`;
  const response = await fetch(url, { signal, headers: { Accept: 'text/event-stream' } });
  if (!response.ok || !response.body) {
    throw new Error(`OpenCode event stream failed: HTTP ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (!signal.aborted) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = frame.split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (data) {
        try {
          sink(JSON.parse(data));
        } catch {
          sink({ type: 'event.parse.failed', properties: { raw: data.slice(0, 500) } });
        }
      }
      boundary = buffer.indexOf('\n\n');
    }
  }
}

function extractText(parts = []) {
  return parts
    .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

async function ensureRuntime(config = {}) {
  const deepseek = sanitizeDeepSeekConfig(config);
  const serverUrl = await ensureOpenCodeServer(deepseek, 'operator', 'medium');
  return { serverUrl, ...runtimeSummary(deepseek) };
}

function encodeDirectorySlug(directory) {
  return Buffer.from(directory, 'utf8').toString('base64url');
}

function resolveNativeHarness(selector = 'stable') {
  defHarness.ensureBaseline(harnessRuntimeRoot, harnessBaselineSource);
  return nativeHarnessLoader.resolve(selector || 'stable');
}

function isStrictLegacyStableHarnessBinding(binding) {
  const pinned = binding?.harnessBinding;
  const releaseHarness = binding?.agentRelease?.harness;
  return Boolean(
    !binding?.harnessIdentitySeal
    && Number(binding?.schemaVersion) === 5
    && typeof binding?.sessionID === 'string'
    && binding.sessionID
    && typeof binding?.directory === 'string'
    && path.isAbsolute(binding.directory)
    && pinned?.kind === defHarness.BINDING_SCHEMA
    && Number(pinned.schemaVersion) === defHarness.SCHEMA_VERSION
    && pinned.sessionId === binding.sessionID
    && pinned.selector === 'stable'
    && pinned.harness?.harnessId === 'def-stable'
    && typeof pinned.harness.version === 'string'
    && pinned.harness.version
    && /^[a-f0-9]{64}$/.test(String(pinned.harness.contentHash || ''))
    && Number(pinned.harness.schemaVersion) === defHarness.SCHEMA_VERSION
    && (!releaseHarness
      || (releaseHarness.selector === 'stable' && defHarness.sameRef(releaseHarness.ref, pinned.harness)))
  );
}

function getNativeHarnessSystem(binding, userText = '') {
  const pinned = binding?.harnessBinding;
  if (!pinned?.harness?.harnessId || !pinned?.harness?.version || !pinned?.harness?.contentHash) return { system: '', binding: null, warning: null };
  if (pinned.sessionId !== binding.sessionID) {
    const error = new Error('native-harness-session-binding-mismatch');
    error.code = 'HARNESS_BINDING_INVALID';
    throw error;
  }
  const harnessSealKey = getSessionHarnessSealKey();
  if (!isStrictLegacyStableHarnessBinding(binding)
    && !verifySessionHarnessSeal(binding, harnessSealKey)) {
    const error = new Error('native-harness-session-seal-invalid');
    error.code = 'HARNESS_BINDING_INVALID';
    throw error;
  }
  const turnRoute = routeNativeTurnHarness(binding, userText, {
    runtimeRoot: harnessRuntimeRoot,
    sealKey: harnessSealKey,
  });
  const cacheKey = `${binding.sessionID}:${pinned.harness.contentHash}`;
  let loaded = nativeHarnessBySession.get(cacheKey);
  if (!loaded) {
    const resolved = nativeHarnessLoader.resolve(`${pinned.harness.harnessId}@${pinned.harness.version}`);
    if (!defHarness.sameRef(resolved.ref, pinned.harness)) {
      const error = new Error('native-harness-binding-hash-mismatch');
      error.code = 'HARNESS_HASH_MISMATCH';
      throw error;
    }
    loaded = { resolved, binding: pinned };
    nativeHarnessBySession.set(cacheKey, loaded);
  }
  if (!defHarness.sameRef(loaded.resolved.ref, pinned.harness)) {
    const error = new Error('native-harness-cached-binding-mismatch');
    error.code = 'HARNESS_HASH_MISMATCH';
    throw error;
  }
  return {
    system: defHarness.composeHarnessSystem(pinned, loaded.resolved.artifactView),
    binding: pinned,
    sessionBinding: pinned,
    turnRoute,
    warning: binding.harnessWarning || null,
  };
}
async function createNativeHostSession({ config = {}, host = 'ai-cli', skillId, thinkingEffort = 'medium', harnessSelector = 'stable', timelineId = '', boundNodeId = '' } = {}) {
  const normalizedTimelineId = typeof timelineId === 'string' ? timelineId.trim() : '';
  if (host === 'workbench' && !normalizedTimelineId) {
    const error = new Error('Workbench DEF sessions require an explicit timelineId.');
    error.code = 'BLOCKED_BINDING';
    throw error;
  }
  const resolvedSkillId = host === 'workbench'
    ? 'workbench'
    : skillMap[skillId] && skillId !== 'workbench'
      ? skillId
      : 'operator';
  const selected = skillMap[resolvedSkillId] || skillMap.operator;
  const deepseek = sanitizeDeepSeekConfig(config);
  const resolvedHarness = resolveNativeHarness(harnessSelector);
  const directory = createAgentSessionWorkspace(resolvedSkillId);
  const serverUrl = await ensureOpenCodeServer(deepseek, resolvedSkillId, thinkingEffort);
  const query = `directory=${encodeURIComponent(directory)}`;
  const payload = buildSessionCreatePayload({ selected, deepseek, skillId: resolvedSkillId, thinkingEffort });
  const session = await requestJson('POST', `${serverUrl}/session?${query}`, payload, undefined, 15000);
  const profile = buildNativeHostProfile(host);
  const harnessBinding = defHarness.createSessionBinding({ sessionId: session.id, resolved: resolvedHarness });
  const agentRelease = createAgentRelease({
    projectRoot,
    skillId: resolvedSkillId,
    modelId: deepseek.model,
    requestedThinkingEffort: normalizeThinkingEffort(thinkingEffort),
    basePrompt: buildAgentPrompt(resolvedSkillId),
    harnessBinding,
  });
  nativeHarnessBySession.set(`${session.id}:${harnessBinding.harness.contentHash}`, { resolved: resolvedHarness, binding: harnessBinding });
  writeSessionBinding(directory, { id: session.id, agent: selected.agent, skillId: resolvedSkillId, profile, harnessBinding, agentRelease, harnessWarning: resolvedHarness.error || null, timelineId: normalizedTimelineId, boundNodeId });
  return {
    id: session.id,
    sessionID: session.id,
    host,
    skillId: resolvedSkillId,
    agent: selected.agent,
    directory,
    serverUrl,
    profile,
    harnessBinding,
    agentRelease,
    harnessWarning: resolvedHarness.error || null,
    timelineId: normalizedTimelineId || undefined,
    boundNodeId: typeof boundNodeId === 'string' && boundNodeId.trim() ? boundNodeId.trim() : undefined,
    uiPath: `/${encodeDirectorySlug(directory)}/session/${encodeURIComponent(session.id)}`,
  };
}

async function recoverNativeHostSession({ config = {}, directory, sessionID } = {}) {
  const binding = readNativeSessionBinding(directory, sessionID, { includeNodeRelation: false });
  if (!binding) throw new Error('Native session binding not found.');

  const resolvedSkillId = skillMap[binding.skillId]
    ? binding.skillId
    : binding.host === 'workbench'
      ? 'workbench'
      : 'operator';
  const selected = skillMap[resolvedSkillId] || skillMap.operator;
  const deepseek = sanitizeDeepSeekConfig(config);
  const recoveryThinkingEffort = normalizeThinkingEffort(binding.agentRelease?.model?.requestedThinkingEffort || 'medium');
  const observedAgentRelease = binding.harnessBinding?.harness?.contentHash
    ? createAgentRelease({
      projectRoot,
      skillId: resolvedSkillId,
      modelId: deepseek.model,
      requestedThinkingEffort: recoveryThinkingEffort,
      basePrompt: buildAgentPrompt(resolvedSkillId),
      harnessBinding: binding.harnessBinding,
    })
    : null;
  const serverUrl = await ensureOpenCodeServer(deepseek, resolvedSkillId, recoveryThinkingEffort);
  const query = `directory=${encodeURIComponent(binding.directory)}`;
  const existing = await fetch(`${serverUrl}/session/${encodeURIComponent(sessionID)}?${query}`, {
    signal: AbortSignal.timeout(5000),
  });
  if (existing.ok) {
    const previousAgentReleaseHash = binding.agentRelease?.releaseHash || null;
    const releaseChanged = Boolean(observedAgentRelease && previousAgentReleaseHash && observedAgentRelease.releaseHash !== previousAgentReleaseHash);
    if (observedAgentRelease && observedAgentRelease.releaseHash !== previousAgentReleaseHash) {
      writeSessionBinding(binding.directory, {
        id: sessionID,
        agent: selected.agent,
        skillId: resolvedSkillId,
        profile: binding.profile,
        harnessBinding: binding.harnessBinding,
        agentRelease: observedAgentRelease,
        previousAgentReleaseHash: releaseChanged ? previousAgentReleaseHash : undefined,
        harnessWarning: binding.harnessWarning,
        timelineId: binding.timelineId,
        boundNodeId: binding.boundNodeId,
      });
    }
    return {
      id: sessionID,
      sessionID,
      directory: binding.directory,
      host: binding.host,
      skillId: resolvedSkillId,
      agent: selected.agent,
      profile: binding.profile,
      harnessBinding: binding.harnessBinding,
      agentRelease: observedAgentRelease || binding.agentRelease || null,
      previousAgentReleaseHash: releaseChanged ? previousAgentReleaseHash : undefined,
      releaseChanged,
      releaseWarning: observedAgentRelease || binding.agentRelease ? null : 'legacy-session-release-unknown',
      timelineId: binding.timelineId || undefined,
      boundNodeId: binding.boundNodeId || undefined,
      recovered: false,
      uiPath: `/${encodeDirectorySlug(binding.directory)}/session/${encodeURIComponent(sessionID)}`,
    };
  }
  if (existing.status !== 404) throw new Error(`OpenCode session check failed: HTTP ${existing.status}`);

  const payload = buildSessionCreatePayload({ selected, deepseek, skillId: resolvedSkillId, thinkingEffort: recoveryThinkingEffort });
  const session = await requestJson('POST', `${serverUrl}/session?${query}`, payload, undefined, 15000);
  const profile = buildNativeHostProfile(binding.host);
  const priorHarness = binding.harnessBinding?.harness;
  const resolvedHarness = priorHarness
    ? nativeHarnessLoader.resolve(`${priorHarness.harnessId}@${priorHarness.version}`)
    : resolveNativeHarness('stable');
  if (priorHarness && resolvedHarness.ref.contentHash !== priorHarness.contentHash) {
    const error = new Error('native-harness-recovery-hash-mismatch');
    error.code = 'HARNESS_HASH_MISMATCH';
    throw error;
  }
  const harnessBinding = defHarness.createSessionBinding({
    sessionId: session.id,
    resolved: resolvedHarness,
    selector: binding.harnessBinding?.selector,
  });
  const agentRelease = createAgentRelease({
    projectRoot,
    skillId: resolvedSkillId,
    modelId: deepseek.model,
    requestedThinkingEffort: recoveryThinkingEffort,
    basePrompt: buildAgentPrompt(resolvedSkillId),
    harnessBinding,
  });
  const previousAgentReleaseHash = binding.agentRelease?.releaseHash || null;
  const releaseChanged = Boolean(previousAgentReleaseHash && agentRelease.releaseHash !== previousAgentReleaseHash);
  nativeHarnessBySession.set(`${session.id}:${harnessBinding.harness.contentHash}`, { resolved: resolvedHarness, binding: harnessBinding });
  writeSessionBinding(binding.directory, { id: session.id, agent: selected.agent, skillId: resolvedSkillId, profile, harnessBinding, agentRelease, previousAgentReleaseHash: releaseChanged ? previousAgentReleaseHash : undefined, harnessWarning: resolvedHarness.error || null, timelineId: binding.timelineId, boundNodeId: binding.boundNodeId }, { allowSessionRecoveryRebind: true });
  return {
    id: session.id,
    sessionID: session.id,
    directory: binding.directory,
    host: binding.host,
    skillId: resolvedSkillId,
    agent: selected.agent,
    profile,
    harnessBinding,
    agentRelease,
    previousAgentReleaseHash: releaseChanged ? previousAgentReleaseHash : undefined,
    releaseChanged,
    harnessWarning: resolvedHarness.error || null,
    timelineId: binding.timelineId || undefined,
    boundNodeId: binding.boundNodeId || undefined,
    recovered: true,
    uiPath: `/${encodeDirectorySlug(binding.directory)}/session/${encodeURIComponent(session.id)}`,
  };
}

function createAgentSessionWorkspace(skillId) {
  const root = getAgentWorkspaceDir();
  const host = skillId === 'workbench' ? 'workbench' : 'ai-cli';
  const directory = path.join(root, 'sessions', host, crypto.randomUUID());
  const toolsDir = path.join(directory, '.opencode', 'tools');
  fs.mkdirSync(toolsDir, { recursive: true });
  if (!fs.existsSync(defOpenCodeToolSource)) {
    throw new Error(`Missing DEF OpenCode native tool module: ${defOpenCodeToolSource}`);
  }
  fs.copyFileSync(defOpenCodeToolSource, path.join(toolsDir, 'def.js'));
  const workspaceCodecDir = path.join(directory, 'def-node-workspace');
  fs.mkdirSync(workspaceCodecDir, { recursive: true });
  fs.copyFileSync(defNodeWorkspaceCodecSource, path.join(workspaceCodecDir, 'codec.mjs'));
  fs.writeFileSync(path.join(directory, 'AGENTS.md'), [
    '# DEF isolated session workspace',
    '',
    'This directory belongs to one OpenCode session.',
    'For Work Node changes, call def_node_fork or def_node_bind before using read/edit/apply_patch.',
    'Only node/working/*.json is editable node truth. node/base, node/context, node/generated and manifest are read-only.',
    'Run def_node_sync_validate to rebuild and validate before def_node_use.',
    '',
  ].join('\n'), 'utf8');
  return fs.realpathSync(directory);
}

function cleanupNativeRetrievalArtifacts(directory, now = Date.now()) {
  const retrieval = path.join(directory, 'retrieval');
  if (!fs.existsSync(retrieval)) return;
  for (const entry of fs.readdirSync(retrieval, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^catalog-[a-z0-9-]{20,}$/i.test(entry.name)) continue;
    const artifactRoot = path.join(retrieval, entry.name);
    let manifest = null;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'manifest.json'), 'utf8'));
    } catch {
      manifest = null;
    }
    if (!manifest || manifest.contract !== 'DefNativeCatalogArtifactV1'
      || manifest.artifactId !== entry.name || Number(manifest.expiresAt) <= now) {
      fs.rmSync(artifactRoot, { recursive: true, force: true });
    }
  }
}

function maintainNativeSessionWorkspace(directory) {
  // Project-level .opencode discovery is disabled. Native DEF tools come from
  // the process plugin, so session source copies are never refreshed on read.
  cleanupNativeRetrievalArtifacts(directory);
}

function writeSessionBinding(directory, session, options = {}) {
  const existing = readJsonFile(path.join(directory, '.def-session.json'));
  const axisBindingId = typeof existing?.axisBindingId === 'string' && existing.axisBindingId.trim()
    ? existing.axisBindingId.trim()
    : `axis-${crypto.randomUUID()}`;
  const binding = {
    schemaVersion: 5,
    sessionID: session.id,
    axisBindingId,
    directory: path.resolve(directory),
    agent: session.agent,
    skillId: session.skillId,
    host: session.skillId === 'workbench' ? 'workbench' : 'ai-cli',
    profile: session.profile || buildNativeHostProfile(session.skillId === 'workbench' ? 'workbench' : 'ai-cli'),
    ...(session.harnessBinding ? { harnessBinding: session.harnessBinding } : existing?.harnessBinding ? { harnessBinding: existing.harnessBinding } : {}),
    ...(session.agentRelease ? { agentRelease: session.agentRelease } : existing?.agentRelease ? { agentRelease: existing.agentRelease } : {}),
    ...(session.previousAgentReleaseHash ? { previousAgentReleaseHash: session.previousAgentReleaseHash } : existing?.previousAgentReleaseHash ? { previousAgentReleaseHash: existing.previousAgentReleaseHash } : {}),
    ...(session.harnessWarning ? { harnessWarning: session.harnessWarning } : existing?.harnessWarning ? { harnessWarning: existing.harnessWarning } : {}),
    ...(typeof session.timelineId === 'string' && session.timelineId.trim() ? { timelineId: session.timelineId.trim() } : existing?.timelineId ? { timelineId: existing.timelineId } : {}),
    ...(typeof session.boundNodeId === 'string' && session.boundNodeId.trim() ? { boundNodeId: session.boundNodeId.trim() } : existing?.boundNodeId ? { boundNodeId: existing.boundNodeId } : {}),
    createdAt: Date.now(),
  };
  if (binding.harnessBinding && binding.agentRelease?.harness) {
    const sealKey = options.harnessSealKey === undefined
      ? getSessionHarnessSealKey()
      : normalizeSealKey(options.harnessSealKey);
    if (!sealKey) throw new Error('DEF Session Harness seal key is unavailable.');
    if (existing) {
      const existingSealValid = verifySessionHarnessSeal(existing, sealKey);
      const legacyStableIdentity = isStrictLegacyStableHarnessBinding(existing);
      const legacyStable = legacyStableIdentity
        && existing.sessionID === binding.sessionID
        && path.resolve(existing.directory || directory) === binding.directory
        && JSON.stringify(existing.harnessBinding) === JSON.stringify(binding.harnessBinding)
        && binding.agentRelease?.harness?.selector === existing.harnessBinding.selector
        && defHarness.sameRef(binding.agentRelease?.harness?.ref, existing.harnessBinding.harness);
      const sameSealedIdentity = existingSealValid && sameSessionHarnessIdentity(existing, binding);
      const recoveryReleaseMatches = existing.agentRelease?.harness
        ? existing.agentRelease.harness.selector === binding.agentRelease?.harness?.selector
          && defHarness.sameRef(existing.agentRelease.harness.ref, binding.agentRelease?.harness?.ref)
        : legacyStableIdentity
          && binding.agentRelease?.harness?.selector === existing.harnessBinding.selector
          && defHarness.sameRef(binding.agentRelease?.harness?.ref, existing.harnessBinding.harness);
      const sameRecoveryHarness = options.allowSessionRecoveryRebind === true
        && typeof binding.sessionID === 'string'
        && binding.sessionID
        && existing.harnessBinding?.sessionId === existing.sessionID
        && binding.harnessBinding?.sessionId === binding.sessionID
        && path.resolve(existing.directory || directory) === binding.directory
        && existing.harnessBinding?.selector === binding.harnessBinding?.selector
        && defHarness.sameRef(existing.harnessBinding?.harness, binding.harnessBinding?.harness)
        && JSON.stringify(existing.harnessBinding?.slotHashes || {}) === JSON.stringify(binding.harnessBinding?.slotHashes || {})
        && recoveryReleaseMatches
        && (existingSealValid || legacyStableIdentity);
      if (!sameSealedIdentity && !legacyStable && !sameRecoveryHarness) {
        const error = new Error('Existing DEF Session Harness identity cannot be replaced or re-sealed.');
        error.code = 'HARNESS_BINDING_INVALID';
        throw error;
      }
    }
    binding.harnessIdentitySeal = createSessionHarnessSeal(binding, sealKey);
  }
  fs.writeFileSync(path.join(directory, '.def-session.json'), `${JSON.stringify(binding, null, 2)}\n`, 'utf8');
  return axisBindingId;
}

function readNativeNodeRelation(directory) {
  const manifest = readJsonFile(path.join(directory, 'node', 'manifest.json'));
  if (!manifest?.nodeId) return null;
  const validation = readJsonFile(path.join(directory, 'node', 'generated', 'validation.json'));
  const risk = readJsonFile(path.join(directory, 'node', 'generated', 'risk.json'));
  const workingRoot = path.join(directory, 'node', 'working');
  let latestWorkingEdit = 0;
  try {
    for (const entry of fs.readdirSync(workingRoot, { withFileTypes: true })) {
      if (entry.isFile()) latestWorkingEdit = Math.max(latestWorkingEdit, fs.statSync(path.join(workingRoot, entry.name)).mtimeMs);
    }
  } catch {
    latestWorkingEdit = 0;
  }
  return {
    schemaVersion: 1,
    nodeId: manifest.nodeId,
    parentNodeId: manifest.parentNodeId || null,
    revision: manifest.revision,
    baseHash: manifest.baseHash,
    workingHash: manifest.workingHash,
    synchronizedAt: manifest.synchronizedAt || null,
    dirty: latestWorkingEdit > Number(manifest.synchronizedAt || manifest.materializedAt || 0),
    validation: validation ? { ok: validation.ok !== false, issueCount: Array.isArray(validation.issues) ? validation.issues.length : 0 } : null,
    risk: risk ? { riskFlags: Array.isArray(risk.riskFlags) ? risk.riskFlags : [], checkoutDecision: risk.checkoutDecision || null } : null,
  };
}

function readNativeSessionBinding(directory, sessionID, options = {}) {
  if (typeof directory !== 'string' || !directory.trim()) return null;
  const sessionsRoot = path.resolve(getAgentWorkspaceDir(), 'sessions');
  const resolved = path.resolve(directory);
  const relative = path.relative(sessionsRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  const binding = readJsonFile(path.join(resolved, '.def-session.json'));
  if (!binding?.sessionID || binding.sessionID !== sessionID) return null;
  if (path.resolve(binding.directory || resolved) !== resolved) return null;
  if (binding.harnessIdentitySeal) {
    try {
      const sealKey = options.harnessSealKey === undefined
        ? getSessionHarnessSealKey()
        : normalizeSealKey(options.harnessSealKey);
      if (!verifySessionHarnessSeal(binding, sealKey)) return null;
    } catch {
      return null;
    }
  } else if (binding.harnessBinding && !isStrictLegacyStableHarnessBinding(binding)) {
    return null;
  }
  maintainNativeSessionWorkspace(resolved);
  const host = binding.host === 'workbench' ? 'workbench' : 'ai-cli';
  const expected = buildNativeHostProfile(host);
  return {
    ...binding,
    directory: resolved,
    host,
    agent: expected.agent,
    skillId: expected.skillId,
    profile: expected,
    axisBindingId: typeof binding.axisBindingId === 'string' && binding.axisBindingId.trim() ? binding.axisBindingId.trim() : null,
    harnessBinding: binding.harnessBinding || null,
    agentRelease: binding.agentRelease || null,
    releaseWarning: binding.agentRelease ? null : 'legacy-session-release-unknown',
    harnessWarning: binding.harnessWarning || null,
    timelineId: typeof binding.timelineId === 'string' && binding.timelineId.trim() ? binding.timelineId.trim() : null,
    boundNodeId: typeof binding.boundNodeId === 'string' && binding.boundNodeId.trim() ? binding.boundNodeId.trim() : null,
    nodeRelation: options.includeNodeRelation === false ? null : readNativeNodeRelation(resolved),
  };
}

function ensureNativeSessionAxisBinding(directory, sessionID) {
  const binding = readNativeSessionBinding(directory, sessionID, { includeNodeRelation: false });
  if (!binding || binding.axisBindingId) return binding;
  const target = path.join(binding.directory, '.def-session.json');
  const stored = readJsonFile(target);
  if (!stored) return binding;
  stored.axisBindingId = `axis-${crypto.randomUUID()}`;
  fs.writeFileSync(target, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');
  return readNativeSessionBinding(binding.directory, sessionID, { includeNodeRelation: false });
}

function findNativeSessionBinding(sessionID) {
  if (typeof sessionID !== 'string' || !sessionID.trim()) return null;
  const sessionsRoot = path.join(getAgentWorkspaceDir(), 'sessions');
  if (!fs.existsSync(sessionsRoot)) return null;
  for (const hostEntry of fs.readdirSync(sessionsRoot, { withFileTypes: true })) {
    if (!hostEntry.isDirectory()) continue;
    const hostRoot = path.join(sessionsRoot, hostEntry.name);
    for (const sessionEntry of fs.readdirSync(hostRoot, { withFileTypes: true })) {
      if (!sessionEntry.isDirectory()) continue;
      const directory = path.join(hostRoot, sessionEntry.name);
      const binding = readJsonFile(path.join(directory, '.def-session.json'));
      if (binding?.sessionID === sessionID) {
        return readNativeSessionBinding(directory, sessionID, { includeNodeRelation: false });
      }
    }
  }
  return null;
}

function writeNativeWorkbenchContext(directory, sessionID, context) {
  const binding = ensureNativeSessionAxisBinding(directory, sessionID);
  if (!binding || binding.host !== 'workbench') return null;
  const contextTimelineId = typeof context?.timeline?.id === 'string' ? context.timeline.id.trim() : '';
  if (!binding.timelineId || !contextTimelineId || contextTimelineId !== binding.timelineId) {
    const error = new Error('Workbench context timeline does not match the immutable session binding.');
    error.code = 'BLOCKED_SESSION_MISMATCH';
    throw error;
  }
  const target = path.join(binding.directory, '.def-workbench-context.json');
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  const payload = {
    schemaVersion: 1,
    host: 'workbench',
    sessionID,
    axisBindingId: binding.axisBindingId,
    updatedAt: Date.now(),
    context: context && typeof context === 'object' ? context : {},
  };
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, target);
  return payload;
}

function listSessionBindings() {
  const sessionsRoot = path.join(getAgentWorkspaceDir(), 'sessions');
  const bindings = [];
  if (!fs.existsSync(sessionsRoot)) return bindings;
  for (const hostEntry of fs.readdirSync(sessionsRoot, { withFileTypes: true })) {
    if (!hostEntry.isDirectory()) continue;
    const hostRoot = path.join(sessionsRoot, hostEntry.name);
    for (const sessionEntry of fs.readdirSync(hostRoot, { withFileTypes: true })) {
      if (!sessionEntry.isDirectory()) continue;
      const directory = path.join(hostRoot, sessionEntry.name);
      const binding = readJsonFile(path.join(directory, '.def-session.json'));
      if (binding?.sessionID && path.resolve(binding.directory || directory) === path.resolve(directory)) {
        bindings.push({ ...binding, directory, nodeRelation: readNativeNodeRelation(directory) });
      }
    }
  }
  return bindings;
}

function extractReplyError(reply) {
  if (!reply || typeof reply !== 'object') return '';
  const info = reply.info && typeof reply.info === 'object' ? reply.info : reply;
  const error = info.error || reply.error;
  if (!error) return '';
  const statusCode = Number(error?.data?.statusCode || error?.statusCode || error?.status) || 0;
  const code = statusCode ? `AI_MODEL_${statusCode}` : 'AI_MODEL_REJECTED';
  const message = typeof error === 'string'
    ? error
    : typeof error.message === 'string'
      ? error.message
      : typeof error.data?.message === 'string'
        ? error.data.message
        : compactValue(error);
  return `${code}: ${message}`;
}

function collectEventTypes(events) {
  return Array.from(new Set(events.map((event) => event.type).filter(Boolean)));
}

function normalizeTokens(tokens) {
  if (!tokens || typeof tokens !== 'object') return undefined;
  const prompt = Number(tokens.prompt ?? tokens.input ?? 0) || 0;
  const completion = Number(tokens.completion ?? tokens.output ?? 0) || 0;
  const reasoning = Number(tokens.reasoning ?? 0) || 0;
  const total = Number(tokens.total ?? prompt + completion + reasoning) || 0;
  return { total, prompt, completion, reasoning };
}

function compactValue(value, limit = 1200) {
  if (value === undefined || value === null) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function sanitizeError(value, limit = 300) {
  const text = compactValue(value, limit)
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(/api[-_ ]?key["'\s:=]+[A-Za-z0-9._~+/-]+/gi, 'apiKey=[redacted]')
    .replace(/token["'\s:=]+[A-Za-z0-9._~+/-]+/gi, 'token=[redacted]');
  return text;
}

function metadataSkillId(metadata) {
  const value = metadata && typeof metadata === 'object' ? metadata.skillId : '';
  return typeof value === 'string' && skillMap[value] ? value : undefined;
}

function metadataThinkingEffort(metadata) {
  const value = metadata && typeof metadata === 'object' ? metadata.thinkingEffort : '';
  return ['low', 'medium', 'high'].includes(value) ? value : undefined;
}

function isDefOpenCodeSession(info) {
  const metadata = info?.metadata || {};
  if (metadata.defOpencode === true || metadata.app === 'dmg-end-field') return true;
  return info?.directory === getAgentWorkspaceDir();
}

function buildSessionCreatePayload({ selected, deepseek, skillId, thinkingEffort }) {
  const normalizedSkillId = skillMap[skillId] ? skillId : 'operator';
  return {
    title: normalizedSkillId === 'workbench' ? '排轴助手' : 'DEF 数据助手',
    agent: selected.agent,
    model: {
      providerID: 'deepseek',
      id: deepseek.model,
    },
    metadata: {
      defOpencode: true,
      app: 'dmg-end-field',
      schemaVersion: DEF_TRANSCRIPT_SCHEMA_VERSION,
      skillId: normalizedSkillId,
      host: normalizedSkillId === 'workbench' ? 'workbench' : 'ai-cli',
      thinkingEffort: normalizeThinkingEffort(thinkingEffort),
    },
  };
}

function mapOpenCodeSessionSummary(info) {
  const skillId = metadataSkillId(info?.metadata) || Object.keys(skillMap).find((id) => skillMap[id].agent === info?.agent);
  return {
    id: info.id,
    sessionID: info.id,
    title: info.title,
    agent: info.agent,
    model: modelIdFromOpenCodeSession(info),
    skillId,
    directory: info.directory,
    active: false,
    stopped: Boolean(info.time?.archived),
    archived: Boolean(info.time?.archived),
    createdAt: info.time?.created,
    updatedAt: info.time?.updated,
    tokens: normalizeTokens(info.tokens),
    lastSeq: 0,
    persisted: true,
  };
}

function modelIdFromOpenCodeSession(info, fallback) {
  const model = info?.model;
  if (typeof model === 'string' && model.trim()) return model.trim();
  if (typeof model?.id === 'string' && model.id.trim()) return model.id.trim();
  if (typeof model?.modelID === 'string' && model.modelID.trim()) return model.modelID.trim();
  return fallback;
}

function proposalIdFromValue(value) {
  if (!value || typeof value !== 'object') return undefined;
  for (const key of ['proposalId', 'proposalID', 'id', 'recordId']) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

function summarizeToolPart(part) {
  const state = part?.state || {};
  const metadata = state.metadata && typeof state.metadata === 'object' ? state.metadata : {};
  const output = state.output && typeof state.output === 'object' ? state.output : {};
  const proposalId = proposalIdFromValue(metadata) || proposalIdFromValue(output);
  const status = state.status === 'completed' ? 'done' : state.status === 'error' ? 'error' : 'running';
  return {
    id: part.id,
    kind: 'tool',
    title: String(state.title || part.tool || part.name || '工具调用'),
    detail: proposalId ? `提案 ${proposalId}` : status === 'running' ? '运行中' : status === 'error' ? '执行异常' : '已返回结果',
    result: proposalId ? `proposal=${proposalId}` : undefined,
    proposalId,
    status,
  };
}

function safeToolTitle(part, fallback = '工具调用') {
  return String(part?.state?.title || part?.tool || part?.name || fallback);
}

function defBusinessToolName(part) {
  const input = part?.state?.input;
  if (!input || typeof input !== 'object') return undefined;
  let body = input.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = undefined;
    }
  }
  if (body && typeof body === 'object' && typeof body.tool === 'string') {
    return body.tool;
  }
  const url = typeof input.url === 'string' ? input.url : '';
  const directMatch = /\/api\/def-tools\/([^/?]+)\/call(?:[/?]|$)/.exec(url);
  if (!directMatch) return undefined;
  try {
    return decodeURIComponent(directMatch[1]);
  } catch {
    return directMatch[1];
  }
}

function buildSafeToolPayload(part) {
  const summary = summarizeToolPart(part);
  return {
    id: part.id,
    partId: part.id,
    callId: part.callID,
    messageId: part.messageID,
    toolName: part.tool || part.name || 'tool',
    businessToolName: defBusinessToolName(part),
    status: summary.status,
    title: summary.title,
    result: summary.result,
    proposalId: summary.proposalId,
    summary: summary.detail,
    error: summary.status === 'error' ? sanitizeError(part.state?.error) : undefined,
  };
}

function textFromMessageParts(parts = []) {
  return parts
    .filter((part) => part?.type === 'text' && part.ignored !== true && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

function userVisibleReply(text) {
  let normalized = typeof text === 'string' ? text.trim() : '';
  if (normalized.length >= 8) {
    const prefix = normalized.slice(0, 4);
    const occurrences = [];
    for (let index = normalized.indexOf(prefix); index >= 0; index = normalized.indexOf(prefix, index + prefix.length)) {
      occurrences.push(index);
    }
    if (occurrences.length >= 3 || (occurrences.length >= 2 && /[`"'>]{2,}/.test(normalized.slice(0, 200)))) {
      normalized = normalized.slice(occurrences.at(-1)).trim();
    }
  }
  if (!normalized || !/\b(?:Goal|Constraints|Progress|Key Decisions|Next Steps|Critical Context|Relevant Files)\b/i.test(normalized)) return normalized;
  if (/checkout\s*[:=]\s*false|暂不应用|尚未应用/i.test(normalized)) return '已生成排轴草稿，尚未应用到当前时间轴。';
  if (/\bpending\b|等待(?:浏览器|执行|确认)|queued/i.test(normalized)) return '正在应用到当前时间轴，等待执行确认。';
  return '已完成本轮排轴操作。';
}

const DEF_EMPTY_ASSISTANT_RESPONSE = 'DEF_EMPTY_ASSISTANT_RESPONSE: 工具或推理步骤已经结束，但模型没有生成任何可见回答；本轮未判定为成功。请保留当前会话并重新提问，Agent 必须基于已有工具证据作答，不能口头声称已经完成。';

function mapOpenCodeMessagesToDefTranscript(messages = [], sessionInfo) {
  const transcript = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    const info = message?.info || {};
    const parts = Array.isArray(message?.parts) ? message.parts : [];
    if (info.role === 'user') {
      const text = textFromMessageParts(parts) || (typeof info.text === 'string' ? info.text : '');
      if (!text) continue;
      transcript.push({
        id: info.id,
        role: 'user',
        text,
        sessionId: info.sessionID || sessionInfo?.id,
        createdAt: info.time?.created,
      });
      continue;
    }

    if (info.role !== 'assistant') continue;
    const text = textFromMessageParts(parts);
    const toolActivity = parts.filter((part) => part?.type === 'tool').map(summarizeToolPart);
    const hasReasoning = parts.some((part) => part?.type === 'reasoning');
    const finish = [...parts].reverse().find((part) => part?.type === 'step-finish');
    const tokens = normalizeTokens(finish?.tokens || info.tokens);
    const activity = [];
    if (hasReasoning) {
      activity.push({
        id: `${info.id || 'assistant'}-reasoning`,
        kind: 'reasoning',
        title: '思考',
        detail: '隐藏推理已保护',
        status: 'done',
      });
    }
    activity.push(...toolActivity);
    if (info.error) {
      activity.push({
        id: `${info.id || 'assistant'}-error`,
        kind: 'event',
        title: '运行异常',
        detail: sanitizeError(info.error),
        status: 'error',
      });
    }
    transcript.push({
      id: info.id,
      role: 'agent',
      text: userVisibleReply(text) || (info.error ? sanitizeError(info.error) : ''),
      sessionId: info.sessionID || sessionInfo?.id,
      activity,
      tokens,
      isStreaming: false,
      createdAt: info.time?.created,
      updatedAt: info.time?.completed || info.time?.updated,
    });
  }
  return transcript;
}

function makeStreamState({ baseUrl, directory, sessionID, agent, model, skillId, thinkingEffort }) {
  const state = {
    id: sessionID,
    sessionID,
    baseUrl,
    directory,
    agent,
    model,
    skillId,
    thinkingEffort,
    eventEmitter: new EventEmitter(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    active: false,
    stopped: false,
    nextSeq: 1,
    buffer: [],
    partText: new Map(),
    partTypes: new Map(),
    toolStatus: new Map(),
    reasoningStatus: new Map(),
    assistantMessages: new Set(),
    tokens: undefined,
    currentTurnId: null,
    controller: null,
    eventController: null,
    eventPromise: null,
  };
  streamSessions.set(sessionID, state);
  return state;
}

function emitStreamEvent(state, type, payload = {}) {
  if (!state) return null;
  const event = {
    seq: state.nextSeq++,
    type,
    at: Date.now(),
    sessionId: state.sessionID,
    turnId: payload.turnId || state.currentTurnId || undefined,
    ...payload,
  };
  state.updatedAt = event.at;
  state.buffer.push(event);
  if (state.buffer.length > 800) {
    state.buffer.splice(0, state.buffer.length - 800);
  }
  state.eventEmitter.emit('event', event);
  return event;
}

function emitPartTextDelta(state, part, eventType) {
  if (!part?.id || typeof part.text !== 'string' || !part.text) return;
  const previous = state.partText.get(part.id) || '';
  const next = part.text;
  const delta = next.startsWith(previous) ? next.slice(previous.length) : next;
  state.partText.set(part.id, next);
  if (!delta) return;
  emitStreamEvent(state, eventType, {
    partId: part.id,
    messageId: part.messageID,
    text: delta,
  });
}

function emitReasoningProgress(state, part, status = 'running') {
  if (!part?.id) return;
  const nextStatus = status === 'done' || part.time?.end ? 'done' : 'running';
  const previousStatus = state.reasoningStatus.get(part.id);
  if (previousStatus === nextStatus) return;
  state.reasoningStatus.set(part.id, nextStatus);
  emitStreamEvent(state, 'reasoning', {
    partId: part.id,
    messageId: part.messageID,
    status: nextStatus,
    redacted: true,
    summary: nextStatus === 'done' ? '隐藏推理已保护' : '正在分析上下文',
  });
}

function emitToolPart(state, part) {
  if (!part?.id) return;
  const toolName = part.tool || part.name || 'tool';
  if (toolName === 'task') {
    if (!state.toolStatus.has(part.id)) {
      emitStreamEvent(state, 'tool.start', {
        id: part.id,
        partId: part.id,
        callId: part.callID,
        messageId: part.messageID,
        toolName,
        status: 'running',
        title: safeToolTitle(part),
      });
    }
    state.toolStatus.set(part.id, 'error');
    const error = 'DEF 面板不使用 task 子代理；请在当前会话内直接完成。';
    emitStreamEvent(state, 'tool.error', {
      id: part.id,
      partId: part.id,
      callId: part.callID,
      messageId: part.messageID,
      toolName,
      status: 'error',
      result: undefined,
      error,
      title: safeToolTitle(part, '子代理已拦截'),
      summary: '子代理调用已拦截',
    });
    if (state.controller && !state.controller.signal.aborted) {
      state.controller.abort(new Error(error));
    }
    return;
  }
  const status = part.state?.status || 'running';
  const previousStatus = state.toolStatus.get(part.id);
  if (!previousStatus) {
    emitStreamEvent(state, 'tool.start', {
      id: part.id,
      partId: part.id,
      callId: part.callID,
      messageId: part.messageID,
      toolName,
      status: 'running',
      title: safeToolTitle(part),
    });
  }
  state.toolStatus.set(part.id, status);
  emitStreamEvent(state, status === 'error' ? 'tool.error' : 'tool.content', buildSafeToolPayload(part));
}

function emitStepFinishPart(state, part) {
  const tokens = normalizeTokens(part?.tokens);
  if (tokens) state.tokens = tokens;
  emitStreamEvent(state, 'step.finish', {
    partId: part?.id,
    messageId: part?.messageID,
    tokens,
    finish: part?.finish,
  });
}

function normalizeOpenCodeEventForStream(state, event) {
  if (!event || !state) return;
  const type = String(event.type || '');
  const properties = event.properties || {};
  const eventSessionID = properties.sessionID || properties.info?.sessionID || properties.part?.sessionID;
  if (eventSessionID && eventSessionID !== state.sessionID) return;

  if (type === 'session.error') {
    emitStreamEvent(state, 'error', {
      error: sanitizeError(properties.error || properties),
    });
    return;
  }

  if (type === 'message.updated') {
    const info = properties.info || {};
    if (info.role === 'assistant' && info.id && !state.assistantMessages.has(info.id)) {
      state.assistantMessages.add(info.id);
      emitStreamEvent(state, 'step.start', {
        messageId: info.id,
        agent: info.agent || info.mode || state.agent,
        model: info.modelID || state.model,
      });
    }
    if (info.error) {
      emitStreamEvent(state, 'error', {
        messageId: info.id,
        error: sanitizeError(info.error),
      });
    }
    return;
  }

  if (type === 'message.part.updated') {
    const part = properties.part || {};
    if (part.sessionID && part.sessionID !== state.sessionID) return;
    if (part.messageID && !state.assistantMessages.has(part.messageID)) return;
    if (part.id && part.type) state.partTypes.set(part.id, part.type);
    if (part.type === 'text' && part.ignored !== true) {
      emitPartTextDelta(state, part, 'text');
    } else if (part.type === 'reasoning') {
      emitReasoningProgress(state, part);
    } else if (part.type === 'tool') {
      emitToolPart(state, part);
    } else if (part.type === 'step-finish') {
      emitStepFinishPart(state, part);
    }
    return;
  }

  if (type === 'message.part.delta') {
    if (properties.sessionID && properties.sessionID !== state.sessionID) return;
    if (properties.messageID && !state.assistantMessages.has(properties.messageID)) return;
    if (properties.field !== 'text' || typeof properties.delta !== 'string' || !properties.delta) return;
    const partId = properties.partID;
    const partType = state.partTypes.get(partId);
    if (partType !== 'text' && partType !== 'reasoning') return;
    if (partType === 'reasoning') {
      emitReasoningProgress(state, {
        id: partId,
        messageID: properties.messageID,
        sessionID: properties.sessionID,
      });
      return;
    }
    const previous = state.partText.get(partId) || '';
    state.partText.set(partId, `${previous}${properties.delta}`);
    emitStreamEvent(state, 'text', {
      partId,
      messageId: properties.messageID,
      text: properties.delta,
    });
  }
}

function emitReplyRemainder(state, reply) {
  const parts = Array.isArray(reply?.parts) ? reply.parts : [];
  for (const part of parts) {
    if (!part?.id) continue;
    if (part.type === 'text' && part.ignored !== true) emitPartTextDelta(state, part, 'text');
    if (part.type === 'reasoning') emitReasoningProgress(state, part);
    if (part.type === 'tool') emitToolPart(state, part);
    if (part.type === 'step-finish') emitStepFinishPart(state, part);
  }
}

function listChatSessions() {
  return Array.from(streamSessions.values())
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map((session) => ({
      id: session.sessionID,
      sessionID: session.sessionID,
      agent: session.agent,
      model: session.model,
      skillId: session.skillId,
      active: session.active,
      stopped: session.stopped,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      tokens: session.tokens,
      lastSeq: session.nextSeq - 1,
    }));
}

async function listPersistedDefSessions({ config = {}, skillId = 'operator', thinkingEffort = 'medium', limit = 100 } = {}) {
  const deepseek = sanitizeDeepSeekConfig(config);
  const baseUrl = await getOpenCodeServerForRead(deepseek, skillId, thinkingEffort);
  const sessions = await Promise.all(listSessionBindings().slice(-Math.max(limit, 1)).map(async (binding) => {
    try {
      const session = await requestJson('GET', `${baseUrl}/session/${encodeURIComponent(binding.sessionID)}?directory=${encodeURIComponent(binding.directory)}`, undefined, undefined, 15000);
      return { session, binding };
    } catch {
      return null;
    }
  }));
  return sessions.filter((item) => item?.session && isDefOpenCodeSession(item.session))
    .map(({ session, binding }) => ({ ...mapOpenCodeSessionSummary(session), host: binding.host, skillId: binding.skillId, directory: binding.directory }))
    .sort((left, right) => (right.updatedAt || right.createdAt || 0) - (left.updatedAt || left.createdAt || 0));
}

async function getPersistedDefSession(sessionID, { config = {}, skillId = 'operator', thinkingEffort = 'medium' } = {}) {
  if (!sessionID) throw new Error('session id is required');
  const deepseek = sanitizeDeepSeekConfig(config);
  const rootDirectory = getAgentWorkspaceDir();
  const baseUrl = await getOpenCodeServerForRead(deepseek, skillId, thinkingEffort);
  const binding = listSessionBindings().find((item) => item.sessionID === sessionID);
  if (binding) {
    const query = `directory=${encodeURIComponent(binding.directory)}`;
    const session = await requestJson('GET', `${baseUrl}/session/${encodeURIComponent(sessionID)}?${query}`, undefined, undefined, 15000);
    return {
      baseUrl,
      directory: binding.directory,
      session,
      summary: { ...mapOpenCodeSessionSummary(session), host: binding.host, skillId: binding.skillId, directory: binding.directory },
    };
  }
  const listQuery = new URLSearchParams({ directory: rootDirectory, roots: 'true', limit: '500' });
  const sessions = await requestJson('GET', `${baseUrl}/session?${listQuery.toString()}`, undefined, undefined, 15000);
  const candidate = (Array.isArray(sessions) ? sessions : []).find((item) => item?.id === sessionID && isDefOpenCodeSession(item));
  if (!candidate) {
    const error = new Error('persisted DEF session not found');
    error.code = 'DEF_SESSION_NOT_FOUND';
    throw error;
  }
  const directory = typeof candidate.directory === 'string' && candidate.directory.trim()
    ? candidate.directory
    : rootDirectory;
  const query = `directory=${encodeURIComponent(directory)}`;
  const session = await requestJson('GET', `${baseUrl}/session/${encodeURIComponent(sessionID)}?${query}`, undefined, undefined, 15000);
  if (!isDefOpenCodeSession(session)) {
    const error = new Error('persisted DEF session not found');
    error.code = 'DEF_SESSION_NOT_FOUND';
    throw error;
  }
  return {
    baseUrl,
    directory,
    session,
    summary: mapOpenCodeSessionSummary(session),
  };
}

async function hydrateDefSession(sessionID, options = {}) {
  const persisted = await getPersistedDefSession(sessionID, options);
  const query = `directory=${encodeURIComponent(persisted.directory)}`;
  const messages = await requestJson(
    'GET',
    `${persisted.baseUrl}/session/${encodeURIComponent(sessionID)}/message?${query}`,
    undefined,
    undefined,
    20000,
  );
  return {
    session: persisted.summary,
    messages: mapOpenCodeMessagesToDefTranscript(messages, persisted.session),
  };
}

async function ensurePersistedStreamSession(sessionID, { config = {}, skillId, thinkingEffort } = {}) {
  const existing = streamSessions.get(sessionID);
  if (existing) {
    if (skillId && existing.skillId !== skillId) {
      const error = new Error(`DEF session skill mismatch: expected ${skillId}, received ${existing.skillId || 'unknown'}`);
      error.code = 'DEF_SESSION_SKILL_MISMATCH';
      throw error;
    }
    return existing;
  }

  const persisted = await getPersistedDefSession(sessionID, {
    config,
    skillId: skillId || 'operator',
    thinkingEffort: thinkingEffort || 'medium',
  });
  const session = persisted.session || {};
  const metadataSkill = metadataSkillId(session.metadata);
  if (skillId && metadataSkill && metadataSkill !== skillId) {
    const error = new Error(`DEF session skill mismatch: expected ${skillId}, received ${metadataSkill}`);
    error.code = 'DEF_SESSION_SKILL_MISMATCH';
    throw error;
  }
  const persistedSkillId = metadataSkill || skillId || Object.keys(skillMap).find((id) => skillMap[id].agent === session.agent) || 'operator';
  const selected = skillMap[persistedSkillId] || skillMap.operator;
  const persistedThinkingEffort = metadataThinkingEffort(session.metadata) || thinkingEffort || 'medium';
  const liveBaseUrl = await ensureOpenCodeServer(sanitizeDeepSeekConfig(config), persistedSkillId, persistedThinkingEffort);
  const state = makeStreamState({
    baseUrl: liveBaseUrl,
    directory: persisted.directory,
    sessionID,
    agent: session.agent || selected.agent,
    model: modelIdFromOpenCodeSession(session, sanitizeDeepSeekConfig(config).model),
    skillId: persistedSkillId,
    thinkingEffort: persistedThinkingEffort,
  });
  state.createdAt = session.time?.created || state.createdAt;
  state.updatedAt = session.time?.updated || state.updatedAt;
  state.tokens = normalizeTokens(session.tokens);
  return state;
}

function getChatSessionStream(sessionID) {
  const state = streamSessions.get(sessionID);
  if (!state) return null;
  return {
    id: state.sessionID,
    sessionID: state.sessionID,
    active: state.active,
    buffer: state.buffer,
    eventEmitter: state.eventEmitter,
    lastSeq: state.nextSeq - 1,
  };
}

function getLiveDefTranscript(sessionID) {
  const state = streamSessions.get(sessionID);
  if (!state) return null;

  const turns = new Map();
  for (const event of state.buffer) {
    const turnId = event.turnId || 'default';
    if (!turns.has(turnId)) {
      turns.set(turnId, {
        turnId,
        userText: '',
        assistantText: '',
        activity: [],
        tokens: undefined,
        createdAt: event.at,
        updatedAt: event.at,
        done: false,
      });
    }
    const turn = turns.get(turnId);
    turn.updatedAt = event.at || turn.updatedAt;

    if (event.type === 'message.start') {
      turn.userText = event.text || turn.userText;
    } else if (event.type === 'text') {
      turn.assistantText += event.text || '';
    } else if (event.type === 'reasoning') {
      const existing = turn.activity.find((item) => item.kind === 'reasoning');
      if (existing) {
        existing.status = event.status === 'done' ? 'done' : 'running';
        existing.detail = event.summary || existing.detail;
      } else {
        turn.activity.push({
          id: `${turnId}-reasoning`,
          kind: 'reasoning',
          title: '思考',
          detail: event.summary || '隐藏推理已保护',
          status: event.status === 'done' ? 'done' : 'running',
        });
      }
    } else if (event.type === 'tool.start' || event.type === 'tool.content' || event.type === 'tool.error') {
      const toolId = event.partId || event.id || `${turnId}-tool-${turn.activity.length}`;
      const existing = turn.activity.find((item) => item.id === toolId);
      const next = {
        id: toolId,
        kind: 'tool',
        title: event.title || event.toolName || '工具调用',
        detail: event.summary || event.result || event.error || '',
        status: event.type === 'tool.error' ? 'error' : event.status === 'running' ? 'running' : 'done',
      };
      if (existing) Object.assign(existing, next);
      else turn.activity.push(next);
    } else if (event.type === 'step.finish') {
      turn.tokens = event.tokens || turn.tokens;
    } else if (event.type === 'done') {
      turn.done = true;
      turn.assistantText = event.content || turn.assistantText;
      turn.tokens = event.tokens || turn.tokens;
    } else if (event.type === 'error' || event.type === 'stopped') {
      turn.activity.push({
        id: `${turnId}-${event.type}`,
        kind: 'event',
        title: event.type === 'stopped' ? '已停止' : '运行异常',
        detail: event.error || '',
        status: event.type === 'stopped' ? 'done' : 'error',
      });
    }
  }

  const messages = [];
  for (const turn of turns.values()) {
    if (turn.userText) {
      messages.push({
        id: `${turn.turnId}-user`,
        role: 'user',
        text: turn.userText,
        sessionId: state.sessionID,
        createdAt: turn.createdAt,
      });
    }
    if (turn.assistantText || turn.activity.length) {
      messages.push({
        id: `${turn.turnId}-agent`,
        role: 'agent',
        text: userVisibleReply(turn.assistantText),
        sessionId: state.sessionID,
        activity: turn.activity,
        tokens: turn.tokens,
        isStreaming: state.active && !turn.done,
        createdAt: turn.createdAt,
        updatedAt: turn.updatedAt,
      });
    }
  }

  return {
    session: {
      id: state.sessionID,
      sessionID: state.sessionID,
      title: `DEF ${state.skillId || 'agent'} live session`,
      agent: state.agent,
      model: state.model,
      skillId: state.skillId,
      active: state.active,
      stopped: state.stopped,
      archived: false,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      tokens: state.tokens,
      lastSeq: state.nextSeq - 1,
      persisted: false,
      live: true,
    },
    messages,
  };
}

async function sendMessageOnStreamSession(state, message, clientTurnId) {
  if (!state) throw new Error('stream session not found');
  if (state.active) throw new Error('stream session is already running');

  const userMessage = typeof message === 'string' && message.trim() ? message.trim() : 'hi';
  const turnId = typeof clientTurnId === 'string' && clientTurnId.trim() ? clientTurnId.trim() : crypto.randomUUID();
  const runController = new AbortController();
  const eventController = new AbortController();
  state.currentTurnId = turnId;
  state.controller = runController;
  state.eventController = eventController;
  state.active = true;
  state.stopped = false;
  emitStreamEvent(state, 'message.start', { turnId, text: userMessage });

  try {
    const eventPromise = subscribeEvents(state.baseUrl, state.directory, (event) => {
      normalizeOpenCodeEventForStream(state, event);
    }, eventController.signal).catch((error) => {
      if (!eventController.signal.aborted) {
        appendLog(`[stream-event-error] ${error instanceof Error ? error.message : String(error)}`);
        emitStreamEvent(state, 'error', { error: sanitizeError(error instanceof Error ? error.message : String(error)) });
      }
    });
    state.eventPromise = eventPromise;
    await new Promise((resolve) => setTimeout(resolve, 80));

    const query = `directory=${encodeURIComponent(state.directory)}`;
    const payload = {
      agent: state.agent,
      model: {
        providerID: 'deepseek',
        modelID: state.model,
      },
      system: describeThinkingEffort(state.thinkingEffort),
      parts: [{ type: 'text', text: userMessage }],
    };
    const reply = await requestJson(
      'POST',
      `${state.baseUrl}/session/${encodeURIComponent(state.sessionID)}/message?${query}`,
      payload,
      runController.signal,
      120000,
    );
    const replyError = extractReplyError(reply);
    if (replyError) {
      throw new Error(replyError);
    }
    emitReplyRemainder(state, reply);
    const visibleContent = userVisibleReply(extractText(reply.parts));
    if (!visibleContent) throw new Error(DEF_EMPTY_ASSISTANT_RESPONSE);
    emitStreamEvent(state, 'done', {
      turnId,
      ok: true,
      content: visibleContent,
      tokens: state.tokens || normalizeTokens(reply.parts?.find((part) => part.type === 'step-finish')?.tokens),
    });
  } catch (error) {
    const stopped = runController.signal.aborted;
    state.stopped = stopped;
    emitStreamEvent(state, stopped ? 'stopped' : 'error', {
      turnId,
      error: sanitizeError(error instanceof Error ? error.message : String(error)),
    });
  } finally {
    eventController.abort();
    state.active = false;
    state.controller = null;
    state.eventController = null;
    const closingEventPromise = state.eventPromise;
    state.eventPromise = null;
    if (closingEventPromise) {
      void closingEventPromise.catch(() => {
        // ignored
      });
    }
  }
}

async function runChatStream({ config, message, thinkingEffort, skillId = 'operator', clientTurnId, workbenchContext }) {
  const deepseek = sanitizeDeepSeekConfig(config);
  if (!deepseek.apiKey) {
    throw new Error('DeepSeek API key is not configured in DEF Shell 05 Agent.');
  }

  const selected = skillMap[skillId] || skillMap.operator;
  const directory = createAgentSessionWorkspace(skillId);
  const baseUrl = await ensureOpenCodeServer(deepseek, skillId, thinkingEffort);
  const query = `directory=${encodeURIComponent(directory)}`;
  const sessionPayload = buildSessionCreatePayload({ selected, deepseek, skillId, thinkingEffort });
  const session = await requestJson('POST', `${baseUrl}/session?${query}`, sessionPayload, undefined, 15000);
  writeSessionBinding(directory, { id: session.id, agent: selected.agent, skillId });
  if (skillId === 'workbench' && workbenchContext && typeof workbenchContext === 'object') {
    writeNativeWorkbenchContext(directory, session.id, workbenchContext);
  }
  const state = makeStreamState({
    baseUrl,
    directory,
    sessionID: session.id,
    agent: selected.agent,
    model: deepseek.model,
    skillId,
    thinkingEffort,
  });
  emitStreamEvent(state, 'session.created', {
    turnId: clientTurnId,
    sessionId: session.id,
    agent: selected.agent,
    skillId,
    model: deepseek.model,
  });
  void sendMessageOnStreamSession(state, message, clientTurnId);
  return {
    sessionId: session.id,
    sessionID: session.id,
    directory,
    eventEmitter: state.eventEmitter,
  };
}

async function continueChat(sessionID, message, clientTurnId, options = {}) {
  const deepseek = sanitizeDeepSeekConfig(options.config || {});
  let state = streamSessions.get(sessionID);
  if (state && options.skillId && state.skillId !== options.skillId) {
    const error = new Error(`DEF session skill mismatch: expected ${options.skillId}, received ${state.skillId || 'unknown'}`);
    error.code = 'DEF_SESSION_SKILL_MISMATCH';
    throw error;
  }
  if (!state) {
    if (!deepseek.apiKey) {
      throw new Error('DeepSeek API key is not configured in DEF Shell 05 Agent.');
    }
    state = await ensurePersistedStreamSession(sessionID, {
      config: deepseek,
      skillId: options.skillId,
      thinkingEffort: options.thinkingEffort,
    });
    emitStreamEvent(state, 'session.created', {
      turnId: clientTurnId,
      sessionId: state.sessionID,
      agent: state.agent,
      skillId: state.skillId,
      model: state.model,
      resumed: true,
    });
  }
  if (state.skillId === 'workbench' && options.workbenchContext && typeof options.workbenchContext === 'object') {
    writeNativeWorkbenchContext(state.directory, state.sessionID, options.workbenchContext);
  }
  void sendMessageOnStreamSession(state, message, clientTurnId);
  return {
    sessionId: state.sessionID,
    sessionID: state.sessionID,
    directory: state.directory,
    eventEmitter: state.eventEmitter,
  };
}

function mapOpenCodeActivity(reply, events) {
  const parts = Array.isArray(reply?.parts) ? reply.parts : [];
  const activity = [{
    id: 'opencode-start',
    kind: 'step',
    title: '接入 OpenCode',
    detail: events.some((event) => event?.type === 'session.created') ? '会话已创建' : '运行时已启动',
    status: 'done',
  }];

  const reasoningParts = parts.filter((part) => part?.type === 'reasoning');
  if (reasoningParts.length) {
    activity.push({
      id: 'opencode-reasoning',
      kind: 'reasoning',
      title: '思考',
      detail: '已完成隐藏推理',
      status: reasoningParts.some((part) => !part.time?.end) ? 'running' : 'done',
    });
  }

  const toolParts = parts.filter((part) => part?.type === 'tool').slice(0, 3);
  for (const part of toolParts) {
    const toolName = part.tool || part.name || '工具调用';
    activity.push({
      id: part.id || `tool-${activity.length}`,
      kind: 'tool',
      title: String(toolName),
      detail: part.state?.status === 'error' ? '执行异常' : '已处理',
      status: part.state?.status === 'error' ? 'error' : part.state?.status === 'running' ? 'running' : 'done',
    });
  }

  const errorEvent = events.find((event) => String(event?.type || '').includes('error') || String(event?.type || '').includes('failed'));
  if (errorEvent) {
    activity.push({
      id: 'opencode-error',
      kind: 'event',
      title: '运行异常',
      detail: '后台已返回错误信息',
      status: 'error',
    });
  }

  const text = extractText(parts);
  if (text) {
    activity.push({
      id: 'opencode-answer',
      kind: 'message',
      title: '回复',
      detail: '已整理为可读结果',
      status: 'done',
    });
  }

  const result = [];
  const seen = new Set();
  for (const item of activity) {
    const key = `${item.kind}:${item.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result.slice(0, 6);
}

function mapOpenCodeLoopSteps(reply, events, ok) {
  const parts = Array.isArray(reply?.parts) ? reply.parts : [];
  const partTypes = parts.map((part) => part.type).filter(Boolean);
  const eventTypes = collectEventTypes(events);
  const finish = parts.find((part) => part.type === 'step-finish');
  const text = extractText(parts);
  const status = ok ? 'done' : 'error';
  return [
    {
      phase: 'think',
      label: '思考',
      detail: eventTypes.some((type) => String(type).includes('reasoning'))
        ? 'OpenCode reasoning event received'
        : 'OpenCode step-start event/part received',
      status,
    },
    {
      phase: 'act',
      label: '执行',
      detail: partTypes.includes('tool')
        ? 'OpenCode tool part executed'
        : 'OpenCode LLM step executed',
      status,
    },
    {
      phase: 'observe',
      label: '观察',
      detail: finish?.tokens
        ? `OpenCode step-finish tokens total=${finish.tokens.total ?? 0}`
        : `OpenCode events=${events.length}`,
      status,
    },
    {
      phase: 'answer',
      label: '回复',
      detail: text ? 'OpenCode text part completed' : 'OpenCode returned no text part',
      status,
    },
  ];
}

function buildErrorSteps(error) {
  const detail = sanitizeError(error instanceof Error ? error.message : String(error));
  return [
    { phase: 'think', label: '思考', detail: 'OpenCode request started', status: 'done' },
    { phase: 'act', label: '执行', detail: 'OpenCode runtime returned an error', status: 'error' },
    { phase: 'observe', label: '观察', detail, status: 'error' },
    { phase: 'answer', label: '回复', detail: 'Error surfaced to GUI', status: 'error' },
  ];
}

async function runChat({ config, message, thinkingEffort, skillId = 'operator' }) {
  const deepseek = sanitizeDeepSeekConfig(config);
  if (!deepseek.apiKey) {
    return {
      ok: false,
      provider: 'embedded-opencode-source',
      model: deepseek.model,
      error: 'DeepSeek API key is not configured in DEF Shell 05 Agent.',
      usedRemoteModel: false,
      realOpenCode: true,
      steps: buildErrorSteps(new Error('DeepSeek API key is not configured')),
    };
  }

  const selected = skillMap[skillId] || skillMap.operator;
  const directory = createAgentSessionWorkspace(skillId);
  const events = [];
  const eventController = new AbortController();
  const runController = new AbortController();
  const userMessage = typeof message === 'string' && message.trim() ? message.trim() : 'hi';

  activeRun = {
    baseUrl: '',
    directory,
    sessionID: null,
    controller: runController,
    eventController,
  };

  try {
    const baseUrl = await ensureOpenCodeServer(deepseek, skillId, thinkingEffort);
    if (runController.signal.aborted) throw runController.signal.reason || new Error('stopped by user');
    activeRun.baseUrl = baseUrl;
    const eventPromise = subscribeEvents(baseUrl, directory, (event) => events.push(event), eventController.signal)
      .catch((error) => {
        if (!eventController.signal.aborted) appendLog(`[event-error] ${error instanceof Error ? error.message : String(error)}`);
      });
    await new Promise((resolve) => setTimeout(resolve, 80));
    const query = `directory=${encodeURIComponent(directory)}`;
    const sessionPayload = buildSessionCreatePayload({ selected, deepseek, skillId, thinkingEffort });
    const session = await requestJson('POST', `${baseUrl}/session?${query}`, sessionPayload, runController.signal, 15000);
    writeSessionBinding(directory, { id: session.id, agent: selected.agent, skillId });
    activeRun.sessionID = session.id;
    const payload = {
      agent: selected.agent,
      model: {
        providerID: 'deepseek',
        modelID: deepseek.model,
      },
      system: describeThinkingEffort(thinkingEffort),
      parts: [
        {
          type: 'text',
          text: userMessage,
        },
      ],
    };
    const reply = await requestJson(
      'POST',
      `${baseUrl}/session/${encodeURIComponent(session.id)}/message?${query}`,
      payload,
      runController.signal,
      120000,
    );
    eventController.abort();
    await eventPromise;
    const content = userVisibleReply(extractText(reply.parts));
    if (!content) {
      return {
        ok: false,
        provider: 'embedded-opencode-source',
        model: deepseek.model,
        error: DEF_EMPTY_ASSISTANT_RESPONSE,
        usedRemoteModel: true,
        realOpenCode: true,
        sessionID: session.id,
        agent: selected.agent,
        eventTypes: collectEventTypes(events),
        activity: mapOpenCodeActivity(reply, events),
        openCodeParts: Array.isArray(reply.parts) ? reply.parts.map((part) => part.type).filter(Boolean) : [],
        steps: buildErrorSteps(new Error(DEF_EMPTY_ASSISTANT_RESPONSE)),
      };
    }
    return {
      ok: true,
      provider: 'embedded-opencode-source',
      model: deepseek.model,
      content,
      usedRemoteModel: true,
      realOpenCode: true,
      sessionID: session.id,
      agent: selected.agent,
      eventTypes: collectEventTypes(events),
      activity: mapOpenCodeActivity(reply, events),
      openCodeParts: Array.isArray(reply.parts) ? reply.parts.map((part) => part.type).filter(Boolean) : [],
      rawUsage: reply.parts?.find((part) => part.type === 'step-finish')?.tokens,
      steps: mapOpenCodeLoopSteps(reply, events, true),
    };
  } catch (error) {
    eventController.abort();
    return {
      ok: false,
      provider: 'embedded-opencode-source',
      model: deepseek.model,
      error: sanitizeError(error instanceof Error ? error.message : String(error)),
      usedRemoteModel: true,
      realOpenCode: true,
      eventTypes: collectEventTypes(events),
      activity: mapOpenCodeActivity(undefined, events),
      steps: buildErrorSteps(error),
    };
  } finally {
    if (activeRun?.controller === runController) activeRun = null;
  }
}

async function stopChat(sessionID) {
  if (sessionID) {
    const state = streamSessions.get(sessionID);
    if (!state) {
      return { ok: true, stopped: false, sessionID, reason: 'session-not-found' };
    }
    state.stopped = true;
    state.controller?.abort(new Error('stopped by user'));
    state.eventController?.abort();
    if (state.sessionID && state.baseUrl) {
      const query = `directory=${encodeURIComponent(state.directory)}`;
      try {
        await requestJson('POST', `${state.baseUrl}/session/${encodeURIComponent(state.sessionID)}/abort?${query}`, {}, undefined, 15000);
      } catch (error) {
        const detail = sanitizeError(error instanceof Error ? error.message : String(error));
        emitStreamEvent(state, 'error', { error: detail });
        return {
          ok: false,
          stopped: true,
          sessionID: state.sessionID,
          reason: detail,
        };
      }
    }
    emitStreamEvent(state, 'stopped', { reason: 'stopped by user' });
    return { ok: true, stopped: true, sessionID: state.sessionID };
  }

  const run = activeRun;
  if (!run) {
    return { ok: true, stopped: false, reason: 'no-active-run' };
  }
  run.controller.abort(new Error('stopped by user'));
  run.eventController.abort();
  if (run.sessionID && run.baseUrl) {
    const query = `directory=${encodeURIComponent(run.directory)}`;
    try {
      await requestJson('POST', `${run.baseUrl}/session/${encodeURIComponent(run.sessionID)}/abort?${query}`, {}, undefined, 15000);
    } catch (error) {
      return {
        ok: false,
        stopped: true,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return { ok: true, stopped: true, sessionID: run.sessionID, reason: run.sessionID ? undefined : 'session-not-created' };
}

function runtimeSummary(config = {}) {
  const actualPort = opencodeReadyPort || OPENCODE_PORT_BASE;
  const manifest = getRuntimeManifest();
  const checksums = getRuntimeChecksums();
  let binaryPath = '';
  let binaryAvailable = false;
  let binaryError = '';
  try {
    binaryPath = resolveOpenCodeBinary();
    binaryAvailable = true;
  } catch (error) {
    binaryError = error instanceof Error ? error.message : String(error);
  }
  return {
    kind: 'embedded-opencode-runtime-binary',
    runtimeRoot: path.relative(projectRoot, runtimeRoot).replace(/\\/g, '/'),
    runtimeTarget: platformRuntimeTarget(),
    binaryPath: binaryPath ? path.relative(projectRoot, binaryPath).replace(/\\/g, '/') : '',
    binaryAvailable,
    binaryError,
    manifest: manifest ? {
      upstreamVersion: manifest.upstreamVersion,
      runtimeTarget: manifest.runtimeTarget,
      binary: manifest.binary,
      checksumSha256: manifest.checksumSha256,
      builtAt: manifest.builtAt,
    } : null,
    checksumAvailable: Boolean(checksums?.files),
    serverUrl: opencodeReadyUrl || `http://${OPENCODE_HOST}:${actualPort}`,
    portBase: OPENCODE_PORT_BASE,
    port: actualPort,
    running: processRunning(opencodeProcess),
    deepseek: summarizeConfig(config),
    capabilityPolicy: capabilityPolicySummary(),
    opencodeHome: getDefOpenCodeHome(),
  };
}

function shutdownRuntime() {
  stopOpenCodeProcess();
  cleanupStaleOpenCodeProcesses();
}

module.exports = {
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_MODEL,
  OPENCODE_PORT_BASE,
  buildAgentPrompt,
  buildCapabilityPermission,
  buildOpenCodeRuntimeEnv,
  sanitizeDeepSeekConfig,
  summarizeConfig,
  runtimeSummary,
  ensureRuntime,
  createNativeHostSession,
  getNativeHarnessSystem,
  recoverNativeHostSession,
  buildNativeHostProfile,
  readNativeSessionBinding,
  writeSessionBinding,
  ensureNativeSessionAxisBinding,
  findNativeSessionBinding,
  writeNativeWorkbenchContext,
  runChat,
  runChatStream,
  continueChat,
  stopChat,
  listChatSessions,
  listPersistedDefSessions,
  getPersistedDefSession,
  hydrateDefSession,
  cleanupNativeRetrievalArtifacts,
  createAgentSessionWorkspace,
  getChatSessionStream,
  getLiveDefTranscript,
  shutdownRuntime,
};
