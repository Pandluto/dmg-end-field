import fs from 'node:fs'
import path from 'node:path'
import { createHash, createHmac, randomUUID } from 'node:crypto'
// DEF tools are loaded from this repository rather than a package workspace.
import { tool } from './tool-api.js'
import { decodeDefNodePayload, hashDefNodeValue } from '../../def-node-workspace/codec.mjs'
import { executeDefOperatorConfigAtomic, executeDefOperatorConfigPreview } from './operator-config-input.mjs'
import turnRouter from '../../def-opencode-adapter/harness-turn-router.cjs'

const restBase = process.env.DEF_REST_BASE_URL || 'http://127.0.0.1:17321'
const bindingFile = '.def-node.json'
const workingFile = 'working-payload.json'
const baseFile = 'base-payload.json'
const workbenchContextFile = '.def-workbench-context.json'
const nodeRoot = 'node'
const nodeManifest = 'node/manifest.json'
const nodeSelection = 'node/working/selection.json'
const nodeTimeline = 'node/working/timeline.json'
const nodeBuffs = 'node/working/buffs.json'
const nodeInputs = 'node/working/inputs.json'
const retrievalRoot = 'retrieval'
const nativeCatalogArtifactContract = 'DefNativeCatalogArtifactV1'
const nativeCatalogArtifactTtlMs = 15 * 60 * 1000
const nativeCatalogArtifactsBySession = new Map()
const defToolFailureBudget = new Map()
const defToolTurnMutationStops = new Map()
const defToolTurnEvidenceStops = new Map()
const defToolTurnPolicies = new Map()
const activeDefToolTurns = new Map()
const defOperatorConfigTurnIntents = new Map()
const { classifyDefExecutableTurnPolicy } = turnRouter
const NON_RETRYABLE_MUTATION_CODES = new Set([
  'operator-config-timeline-invariant-failed',
  'prepared-capability-invalid',
  'prepared-capability-session-mismatch',
  'prepared-capability-consumed',
  'approval-capability-required',
  'operator-config-apply-intent-required',
])
const NON_RETRYABLE_EVIDENCE_CODES = new Set([
  'weapon-fit-combat-convention-incomplete',
  'weapon-fit-convention-bundle-mismatch',
  'weapon-fit-convention-bundle-required',
  'weapon-fit-convention-bundle-unexpected',
  'equipment-3plus1-catalog-invalid',
  'equipment-3plus1-source-revision-stale',
  'equipment-3plus1-set-not-found',
  'equipment-3plus1-set-ambiguous',
  'equipment-set-fit-shortlist-failed',
])

function defToolFailureScope(context) {
  const sessionId = typeof context?.sessionID === 'string' ? context.sessionID : 'unknown-session'
  const turnId = activeDefToolTurns.get(sessionId)
    || (typeof context?.messageID === 'string' ? context.messageID : 'unknown-message')
  return `${sessionId}:${turnId}`
}

export function beginDefToolTurn(sessionID, turnID) {
  if (typeof sessionID !== 'string' || !sessionID || typeof turnID !== 'string' || !turnID) return
  activeDefToolTurns.set(sessionID, turnID)
  const currentPrefix = `${sessionID}:${turnID}:`
  for (const key of defToolFailureBudget.keys()) {
    if (key.startsWith(`${sessionID}:`) && !key.startsWith(currentPrefix)) defToolFailureBudget.delete(key)
  }
  for (const key of defToolTurnMutationStops.keys()) {
    if (key.startsWith(`${sessionID}:`) && key !== `${sessionID}:${turnID}`) defToolTurnMutationStops.delete(key)
  }
  for (const key of defToolTurnEvidenceStops.keys()) {
    if (key.startsWith(`${sessionID}:`) && key !== `${sessionID}:${turnID}`) defToolTurnEvidenceStops.delete(key)
  }
  for (const key of defToolTurnPolicies.keys()) {
    if (key.startsWith(`${sessionID}:`) && key !== `${sessionID}:${turnID}`) defToolTurnPolicies.delete(key)
  }
}

function userTextFromChatParts(parts) {
  return (Array.isArray(parts) ? parts : [])
    .filter((part) => part?.type === 'text')
    .map((part) => String(part.text || ''))
    .join('\n')
    .trim()
}

function hasExplicitOperatorConfigApplyIntent(text) {
  const normalized = String(text || '').normalize('NFKC').replace(/\s+/g, '')
  if (!normalized) return false
  if (/(?:不要|先不|暂不|别|不)\s*(?:应用|换上|执行|配置)/.test(normalized)) return false
  if (/^确认(?:[。！!]|$)/.test(normalized)) return true
  return /(?:确认(?:应用|换上|执行|装备|配置)|同意(?:应用|换上|执行)|(?:请|就|直接|现在)?(?:应用|换上|执行)(?:这套|该方案|此方案|它|吧|。|！|$)|按(?:这套|该方案|此方案).{0,12}(?:应用|换上|执行))/.test(normalized)
}

function operatorConfigApplyIntentSignature(sessionID, turnID) {
  const secret = typeof process.env.DEF_INTERNAL_GOVERNANCE_TOKEN === 'string'
    ? process.env.DEF_INTERNAL_GOVERNANCE_TOKEN
    : ''
  if (!secret || !sessionID || !turnID) return ''
  return createHmac('sha256', secret)
    .update(`def-operator-config-apply:v1:${sessionID}:${turnID}`)
    .digest('base64url')
}

export function beginDefToolTurnFromChatMessage(sessionID, turnID, parts = []) {
  beginDefToolTurn(sessionID, turnID)
  if (typeof sessionID !== 'string' || !sessionID || typeof turnID !== 'string' || !turnID) return
  defOperatorConfigTurnIntents.set(sessionID, {
    turnID,
    explicitApply: hasExplicitOperatorConfigApplyIntent(userTextFromChatParts(parts)),
    updatedAt: Date.now(),
  })
  const scope = `${sessionID}:${turnID}`
  const classified = classifyDefExecutableTurnPolicy(userTextFromChatParts(parts))
  if (classified) defToolTurnPolicies.set(scope, {
    ...classified,
    allowedTools: new Set(['def_data_skill']),
    attemptedTools: new Map(),
  })
  else defToolTurnPolicies.delete(scope)
  if (defOperatorConfigTurnIntents.size > 256) defOperatorConfigTurnIntents.delete(defOperatorConfigTurnIntents.keys().next().value)
}

export function getDefOperatorConfigTurnIdentity(context = {}) {
  const sessionID = typeof context?.sessionID === 'string' ? context.sessionID : ''
  const turnID = activeDefToolTurns.get(sessionID)
    || (typeof context?.messageID === 'string' ? context.messageID : '')
  const intent = defOperatorConfigTurnIntents.get(sessionID)
  const explicitApply = Boolean(intent?.explicitApply && intent.turnID === turnID)
  return {
    turnID,
    applyIntent: explicitApply ? operatorConfigApplyIntentSignature(sessionID, turnID) : '',
  }
}

function stableToolInput(value) {
  if (Array.isArray(value)) return value.map(stableToolInput)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['__defSessionId', '__defTurnId', '__defApplyIntent', 'waitMs', 'snapshotWaitMs'].includes(key))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, stableToolInput(entry)]))
}

function mutationTargetFingerprint(toolName, input = {}) {
  // Generic tool denials are process-wide for the user turn, as before. A
  // typed mutation is different: Bieli and Saixi (or two reviewed inputs for
  // one operator) must not consume each other's retry budget.
  if (!isDefMutationTool(toolName)) return 'generic'
  return `${toolName}:${JSON.stringify(stableToolInput(input))}`
}

function isDefMutationTool(toolName) {
  return /(?:operator[_.]config|worknode[_.](?:sync|create|delete|checkout|restore)|node_(?:sync|fork|use|restore)|team[_.](?:selection|loadout[_.]plan[_.]apply))/i.test(String(toolName || ''))
}

function isDefTerminalEvidenceTool(toolName) {
  return /^(?:def\.weapon\.fit\.plan|def\.equipment\.(?:set_fit\.shortlist|3plus1\.(?:facts|plan))|def_data_weapon_fit_plan|def_data_equipment_(?:set_fit_shortlist|3plus1_(?:facts|plan)))$/.test(String(toolName || ''))
}

function normalizeToolFailureCode(error) {
  const text = String(error || '').trim()
  if (/prevents you from using this specific tool call|permission/i.test(text)) {
    if (/external_directory/i.test(text)) return 'denied-external-directory'
    return 'denied-tool-permission'
  }
  const match = /^([a-z0-9][a-z0-9-]{2,80})\s*:/i.exec(text)
  return match ? match[1].toLowerCase() : 'tool-execution-failed'
}

function recordTurnFailure({ sessionID, toolName, input, code, callID }) {
  const turnId = activeDefToolTurns.get(sessionID)
  if (!turnId || !code) return null
  const scope = `${sessionID}:${turnId}`
  const targetFingerprint = mutationTargetFingerprint(toolName, input)
  const budgetKey = `${scope}:${targetFingerprint}`
  const prior = defToolFailureBudget.get(budgetKey)
  const stableCallId = typeof callID === 'string' && callID ? callID : ''
  if (stableCallId && prior?.seenCallIds?.has(stableCallId)) return prior
  const sameFailure = prior?.code === code
  const count = sameFailure ? prior.count + 1 : 1
  const seenCallIds = sameFailure ? new Set(prior?.seenCallIds || []) : new Set()
  if (stableCallId) seenCallIds.add(stableCallId)
  const next = { tool: toolName, code, count, blocked: count >= 2, targetFingerprint, seenCallIds, updatedAt: Date.now() }
  defToolFailureBudget.set(budgetKey, next)
  if (defToolFailureBudget.size > 512) defToolFailureBudget.delete(defToolFailureBudget.keys().next().value)
  return next
}

function retryBudgetFor(scope, toolName, input) {
  return defToolFailureBudget.get(`${scope}:${mutationTargetFingerprint(toolName, input)}`) || null
}

function retryBudgetBlockedForScope(scope) {
  for (const [key, budget] of defToolFailureBudget) {
    if (key.startsWith(`${scope}:`) && budget?.blocked) return budget
  }
  return null
}

function stopFurtherTurnMutations({ sessionID, toolName, code, failure }) {
  const turnId = activeDefToolTurns.get(sessionID)
  if (!turnId || !isDefMutationTool(toolName)) return null
  const scope = `${sessionID}:${turnId}`
  const existing = defToolTurnMutationStops.get(scope)
  if (existing) return existing
  const stop = {
    tool: toolName,
    code,
    failureStage: failure?.failureStage || failure?.diagnostics?.stage || 'typed mutation',
    nextAction: failure?.nextAction || 'Report the typed failure; do not issue another mutation in this turn.',
    updatedAt: Date.now(),
  }
  defToolTurnMutationStops.set(scope, stop)
  if (defToolTurnMutationStops.size > 256) defToolTurnMutationStops.delete(defToolTurnMutationStops.keys().next().value)
  return stop
}

function notAttemptedMutationError(stop, attemptedTool) {
  const error = new Error(`def-tool-mutation-not-attempted: ${attemptedTool} was not sent because ${stop.tool} returned non-retryable ${stop.code} at ${stop.failureStage}. Next action: ${stop.nextAction}`)
  error.code = 'def-tool-mutation-not-attempted'
  error.details = {
    attempted: false,
    attemptedTool,
    originalTool: stop.tool,
    originalCode: stop.code,
    failureStage: stop.failureStage,
    nextAction: stop.nextAction,
  }
  return error
}

function stopFurtherTurnEvidence({ sessionID, toolName, code, failure }) {
  const turnId = activeDefToolTurns.get(sessionID)
  if (!turnId || !isDefTerminalEvidenceTool(toolName)) return null
  const scope = `${sessionID}:${turnId}`
  const existing = defToolTurnEvidenceStops.get(scope)
  if (existing) return existing
  const stop = {
    tool: toolName,
    code,
    nextAction: failure?.nextAction || 'Report the typed evidence failure and stop this recommendation turn.',
    updatedAt: Date.now(),
  }
  defToolTurnEvidenceStops.set(scope, stop)
  if (defToolTurnEvidenceStops.size > 256) defToolTurnEvidenceStops.delete(defToolTurnEvidenceStops.keys().next().value)
  return stop
}

function notAttemptedEvidenceError(stop, attemptedTool) {
  const error = new Error(`def-tool-evidence-not-attempted: ${attemptedTool} was not sent because ${stop.tool} returned terminal ${stop.code}. Next action: ${stop.nextAction}`)
  error.code = 'def-tool-evidence-not-attempted'
  error.details = {
    attempted: false,
    attemptedTool,
    originalTool: stop.tool,
    originalCode: stop.code,
    nextAction: stop.nextAction,
  }
  return error
}

function compactTypedFailureDetails(failure) {
  if (!failure || typeof failure !== 'object') return null
  const diagnostics = failure.diagnostics
  const compactIssues = (issues) => (Array.isArray(issues) ? issues.slice(0, 8).map((issue) => ({ code: issue?.code, path: issue?.path, stableId: issue?.stableId, message: issue?.message })) : [])
  if (!diagnostics || typeof diagnostics !== 'object') {
    return failure.nextAction || failure.retryable !== undefined || Array.isArray(failure.catalogIssues)
      ? { retryable: failure.retryable, failureStage: failure.failureStage, nextAction: failure.nextAction, catalogIssues: compactIssues(failure.catalogIssues) }
      : null
  }
  return {
    retryable: failure.retryable,
    failureStage: failure.failureStage,
    nextAction: failure.nextAction,
    stage: diagnostics.stage,
    beforeCanonicalHash: diagnostics.beforeCanonicalHash,
    afterCanonicalHash: diagnostics.afterCanonicalHash,
    changedPaths: Array.isArray(diagnostics.changedPaths) ? diagnostics.changedPaths.slice(0, 24) : [],
    validatorIssues: {
      before: compactIssues(diagnostics.validatorIssues?.before),
      after: compactIssues(diagnostics.validatorIssues?.after),
    },
    catalogIssues: compactIssues(diagnostics.catalogIssues || failure.catalogIssues),
  }
}

export function recordDefToolEventFailure(event) {
  if (event?.type !== 'message.part.updated') return
  const part = event?.properties?.part
  if (part?.type !== 'tool' || part?.state?.status !== 'error') return
  const code = normalizeToolFailureCode(part.state.error)
  if (code === 'def-tool-turn-policy-blocked') return
  recordTurnFailure({
    sessionID: part.sessionID,
    toolName: part.tool,
    input: part.input || part.state?.input,
    code,
    callID: part.callID,
  })
  if (NON_RETRYABLE_MUTATION_CODES.has(code)) {
    stopFurtherTurnMutations({
      sessionID: part.sessionID,
      toolName: part.tool,
      code,
      failure: { failureStage: 'typed mutation', nextAction: 'Report the first non-retryable typed failure; do not issue another mutation in this turn.' },
    })
  }
  if (NON_RETRYABLE_EVIDENCE_CODES.has(code)) {
    stopFurtherTurnEvidence({
      sessionID: part.sessionID,
      toolName: part.tool,
      code,
      failure: { nextAction: 'Report the typed planner failure; do not issue fallback data tools in this turn.' },
    })
  }
}

export function assertDefToolTurnNotBlocked(sessionID, toolName, args = {}) {
  const turnId = activeDefToolTurns.get(sessionID)
  if (!turnId) return
  const scope = `${sessionID}:${turnId}`
  const turnPolicy = defToolTurnPolicies.get(scope)
  if (turnPolicy?.kind === 'exact-skill-facts') {
    if (!turnPolicy.allowedTools.has(toolName)) {
      const error = new Error(`def-tool-turn-policy-blocked: ${toolName} was not attempted. This turn asks for exact skill hit facts; call def_data_skill once with the user's complete skill id/name and no context, knowledge, button, damage, or operator probe.`)
      error.code = 'def-tool-turn-policy-blocked'
      error.details = { attempted: false, attemptedTool: toolName, policy: turnPolicy.kind, nextAction: 'Call def_data_skill once with the complete named skill variant from the user message.' }
      throw error
    }
    const priorAttempts = turnPolicy.attemptedTools.get(toolName) || 0
    if (priorAttempts >= 1) {
      const error = new Error(`def-tool-turn-policy-blocked: ${toolName} was not attempted again. Exact skill facts allow one typed lookup per turn.`)
      error.code = 'def-tool-turn-policy-blocked'
      error.details = { attempted: false, attemptedTool: toolName, policy: turnPolicy.kind, attempts: priorAttempts, nextAction: 'Use the first typed result or report its exact missing fact without another tool call.' }
      throw error
    }
    const sourceDigits = turnPolicy.sourceText.match(/\d+/g) || []
    const queryDigits = String(args?.query || '').normalize('NFKC').match(/\d+/g) || []
    if (sourceDigits.some((digit) => !queryDigits.includes(digit))) {
      const error = new Error('def-tool-turn-policy-blocked: def_data_skill was not attempted because its query dropped the named skill variant number. Preserve the user\'s complete skill id/name.')
      error.code = 'def-tool-turn-policy-blocked'
      error.details = { attempted: false, attemptedTool: toolName, policy: turnPolicy.kind, nextAction: 'Retry the single allowed lookup with the complete named skill variant, including its numeric layer/id.' }
      throw error
    }
    turnPolicy.attemptedTools.set(toolName, priorAttempts + 1)
  }
  const mutationStop = defToolTurnMutationStops.get(scope)
  if (mutationStop && isDefMutationTool(toolName)) throw notAttemptedMutationError(mutationStop, toolName)
  const evidenceStop = defToolTurnEvidenceStops.get(scope)
  if (evidenceStop) throw notAttemptedEvidenceError(evidenceStop, toolName)
  const budget = retryBudgetBlockedForScope(scope)
  if (!budget?.blocked) return
  const error = new Error(`def-tool-retry-limit-reached: ${budget.tool} failed twice with ${budget.code}. All tool use is stopped for this user turn; report that the requested change was not applied before ${toolName}.`)
  error.code = 'def-tool-retry-limit-reached'
  error.details = { tool: budget.tool, attemptedTool: toolName, originalCode: budget.code, attempts: budget.count }
  throw error
}

async function callDefTool(tool, input = {}, context = null) {
  const failureScope = defToolFailureScope(context)
  const evidenceStop = defToolTurnEvidenceStops.get(failureScope)
  if (evidenceStop) throw notAttemptedEvidenceError(evidenceStop, tool)
  const mutationStop = defToolTurnMutationStops.get(failureScope)
  if (mutationStop && isDefMutationTool(tool)) throw notAttemptedMutationError(mutationStop, tool)
  const budget = retryBudgetFor(failureScope, tool, input)
  if (budget?.blocked) {
    const error = new Error(`def-tool-retry-limit-reached: ${budget.tool} already failed twice with ${budget.code}. All tool use is stopped for this user turn; report that the requested change was not applied before ${tool}.`)
    error.code = 'def-tool-retry-limit-reached'
    error.details = { tool: budget.tool, attemptedTool: tool, originalCode: budget.code, attempts: budget.count }
    throw error
  }
  const response = await fetch(`${restBase}/api/def-tools/call`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(process.env.DEF_INTERNAL_GOVERNANCE_TOKEN ? { 'x-def-internal-token': process.env.DEF_INTERNAL_GOVERNANCE_TOKEN } : {}),
    },
    body: JSON.stringify({ tool, input, ...(context?.sessionID ? { sessionId: context.sessionID } : {}) }),
  })
  const payload = await response.json()
  if (!response.ok || payload?.ok !== true || payload?.result?.ok === false) {
    // `/api/def-tools/call` returns typed failures in `error`, while successful
    // executions use `result`. Preserve structured diagnostics so a
    // canonical-gate 409 is never misreported as a missing Work Node or team.
    const failure = payload?.result || payload?.error || payload
    const code = failure?.code || payload?.code || 'def-tool-failed'
    const message = failure?.message || failure?.note || payload?.message || `${tool} failed with HTTP ${response.status}`
    const recorded = recordTurnFailure({
      sessionID: context?.sessionID,
      toolName: tool,
      input,
      code,
      callID: context?.callID,
    })
    if (failure?.retryable === false) stopFurtherTurnMutations({
      sessionID: context?.sessionID,
      toolName: tool,
      code,
      failure,
    })
    if (failure?.retryable === false) stopFurtherTurnEvidence({
      sessionID: context?.sessionID,
      toolName: tool,
      code,
      failure,
    })
    const count = recorded?.count || 1
    const blocked = recorded?.blocked === true
    const structuredDetails = compactTypedFailureDetails(failure)
    const detailSuffix = structuredDetails ? ` Structured details: ${JSON.stringify(structuredDetails)}` : ''
    const error = new Error(blocked
      ? `def-tool-retry-limit-reached: ${tool} failed twice with ${code}. Stop tool use and report that the requested change was not applied at this stage. Last error: ${message}`
      : `${code}: ${message}${detailSuffix}`)
    error.code = blocked ? 'def-tool-retry-limit-reached' : code
    error.status = response.status
    error.details = blocked
      ? { tool, originalCode: code, attempts: count, lastFailure: failure }
      : failure
    throw error
  }
  if (budget && budget.tool === tool && !budget.blocked) {
    defToolFailureBudget.delete(`${failureScope}:${mutationTargetFingerprint(tool, input)}`)
  }
  return payload.result
}

async function askWithApproval(context, input) {
  const requested = await callDefTool('def.approval.request', {
    summary: input.summary,
    riskLevel: input.riskLevel || 'high',
    mode: 'blocking',
    workNodeId: input.nodeId,
    sessionId: context.sessionID,
    workspaceId: input.workspaceId,
    timelineId: input.timelineId,
    axisBindingId: input.axisBindingId,
    sessionBindingId: input.sessionBindingId,
    parentNodeId: input.parentNodeId,
    parentRevision: input.parentRevision,
    candidateNodeId: input.candidateNodeId || input.nodeId,
    candidateRevision: input.candidateRevision || input.revision,
    planId: input.planId,
    planHash: input.planHash,
    nodeRevision: input.revision,
    diffHash: input.diffHash,
    riskHash: input.riskHash,
    workingHash: input.workingHash,
    toolCallId: context.messageID,
    diffSummary: input.diff,
    riskFlags: input.riskFlags || [],
  }, context)
  try {
    await context.ask({
      permission: input.permission,
      // OpenCode's native permission dock renders patterns, not arbitrary
      // metadata. Supply the reviewed values as bounded display patterns so
      // the user approves the exact resolved loadout rather than a name-only
      // request. The child node remains the first, stable authorization key.
      patterns: Array.isArray(input.patterns) && input.patterns.length
        ? input.patterns
        : input.nodeId ? [input.nodeId] : ['operator-config'],
      always: [],
      metadata: {
        action: input.action,
        nodeId: input.nodeId || null,
        workspaceId: input.workspaceId || null,
        revision: input.revision,
        timelineId: input.timelineId || null,
        axisBindingId: input.axisBindingId || null,
        parentNodeId: input.parentNodeId || null,
        parentRevision: input.parentRevision ?? null,
        candidateNodeId: input.candidateNodeId || input.nodeId || null,
        candidateRevision: input.candidateRevision ?? input.revision ?? null,
        planId: input.planId || null,
        planHash: input.planHash || null,
        diff: input.diff,
        riskFlags: input.riskFlags || [],
        consequence: input.consequence,
        approvalId: requested.approval.id,
      },
    })
  } catch (error) {
    await callDefTool('def.approval.record_decision', {
      approvalId: requested.approval.id,
      decision: 'rejected',
      decidedBy: 'user',
      rationale: `${input.action} rejected through OpenCode native permission UI.`,
    }, context)
    throw error
  }
  const decided = await callDefTool('def.approval.record_decision', {
    approvalId: requested.approval.id,
    decision: 'approved',
    decidedBy: 'user',
    rationale: `${input.action} approved through OpenCode native permission UI.`,
  }, context)
  return { ...requested.approval, approvalCapability: decided.approvalCapability }
}

function formatOperatorConfigApprovalPatterns(prepared) {
  const config = prepared?.finalConfig || {}
  const weapon = config?.weapon || {}
  const skill = weapon?.skillLevels || {}
  const operator = config?.operatorSkillLevels || {}
  const checkout = prepared?.checkout || {}
  const equipment = Array.isArray(config?.equipment) ? config.equipment : []
  const displayValue = (value) => typeof value === 'number' ? String(value) : value ?? '-'
  return [
    `节点标题: ${prepared?.nodeTitle || '-'}`,
    `修改描述: ${prepared?.nodeDescription || '-'}`,
    `节点位置: ${prepared?.nodePlacement || '-'}`,
    `审批 Work Node: ${prepared?.nodeId || '-'} @ r${prepared?.nodeRevision ?? '-'}`,
    `Checkout: ${checkout?.nodeId || '-'} @ r${checkout?.revision ?? '-'}`,
    `干员: ${config?.characterName || config?.characterId || '-'}`,
    `武器: ${weapon?.name || weapon?.id || '-'} · Lv${weapon?.level ?? '-'} · ${weapon?.potential || '-'} · ${skill.skill1 ?? '-'}/${skill.skill2 ?? '-'}/${skill.skill3 ?? '-'}`,
    ...equipment.map((piece) => `${piece?.slotKey || '-'}: ${piece?.name || piece?.equipmentId || '-'} · ${(Array.isArray(piece?.effects) ? piece.effects : []).map((effect) => `${effect?.label || effect?.effectId || '-'} Lv${effect?.level ?? '-'}=${displayValue(effect?.value)}`).join('；') || '无词条'}`),
    `干员技能: A ${operator.A || '-'} · B ${operator.B || '-'} · E ${operator.E || '-'} · Q ${operator.Q || '-'}`,
  ]
}

function inside(directory, name) {
  const root = path.resolve(directory)
  const target = path.resolve(root, name)
  const relative = path.relative(root, target)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing node workspace path outside ${root}: ${name}`)
  }
  return target
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function sha256Text(value) {
  return createHash('sha256').update(value).digest('hex')
}

function nativeArtifactFileName(value) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9._-]*\.(?:json|jsonl)$/.test(value)) {
    throw new Error(`native-catalog-artifact-invalid-file: ${String(value || '')}`)
  }
  return value
}

function nativeArtifactRoot(context) {
  return inside(context.directory, retrievalRoot)
}

function nativeArtifactPathIsInside(root, target) {
  const relative = path.relative(root, target)
  return !relative.startsWith('..') && !path.isAbsolute(relative)
}

function nativeArtifactSessionRegistry(sessionID) {
  const existing = nativeCatalogArtifactsBySession.get(sessionID)
  if (existing) return existing
  const created = new Map()
  nativeCatalogArtifactsBySession.set(sessionID, created)
  return created
}

function removeNativeCatalogArtifact(context, artifactId, artifactRoot) {
  const root = nativeArtifactRoot(context)
  if (typeof artifactId !== 'string' || !/^catalog-[a-z0-9-]{20,}$/i.test(artifactId)) return
  if (!nativeArtifactPathIsInside(root, artifactRoot) || path.basename(artifactRoot) !== artifactId) return
  fs.rmSync(artifactRoot, { recursive: true, force: true })
  const registry = nativeCatalogArtifactsBySession.get(context.sessionID)
  const entry = registry?.get(artifactId)
  if (entry?.timer) clearTimeout(entry.timer)
  registry?.delete(artifactId)
  if (registry?.size === 0) nativeCatalogArtifactsBySession.delete(context.sessionID)
}

function registerNativeCatalogArtifact(context, artifactRoot, manifest) {
  if (!context?.sessionID || !manifest?.artifactId || !Number.isFinite(Number(manifest.expiresAt))) return
  const registry = nativeArtifactSessionRegistry(context.sessionID)
  const previous = registry.get(manifest.artifactId)
  if (previous?.timer) clearTimeout(previous.timer)
  const entry = { root: artifactRoot, expiresAt: Number(manifest.expiresAt), timer: null }
  const delay = entry.expiresAt - Date.now()
  if (delay > 0 && delay <= 0x7fffffff) {
    entry.timer = setTimeout(() => {
      if (Date.now() >= entry.expiresAt) removeNativeCatalogArtifact(context, manifest.artifactId, artifactRoot)
    }, delay + 1)
    entry.timer.unref?.()
  }
  registry.set(manifest.artifactId, entry)
}

function pruneNativeCatalogArtifactRegistry(context, now = Date.now()) {
  const registry = nativeCatalogArtifactsBySession.get(context?.sessionID)
  if (!registry) return
  for (const [artifactId, entry] of registry) {
    if (entry.expiresAt <= now) removeNativeCatalogArtifact(context, artifactId, entry.root)
  }
}

function looksLikeRetrievalPath(value) {
  if (typeof value !== 'string') return false
  const normalized = value.replaceAll('\\', '/')
  return normalized === 'retrieval' || normalized.startsWith('retrieval/') || /\/retrieval(?:\/|$)/.test(normalized)
}

function isNativeArtifactToolPathAllowed(sessionID, rawPath) {
  const registry = nativeCatalogArtifactsBySession.get(sessionID)
  if (!registry || typeof rawPath !== 'string' || !rawPath.trim()) return false
  for (const entry of registry.values()) {
    const target = path.isAbsolute(rawPath)
      ? path.resolve(rawPath)
      : path.resolve(path.dirname(entry.root), '..', rawPath)
    if (nativeArtifactPathIsInside(entry.root, target)) return true
  }
  return false
}

function isNodeWorkingToolPath(rawPath) {
  if (typeof rawPath !== 'string' || !rawPath.trim() || path.isAbsolute(rawPath)) return false
  const normalized = path.posix.normalize(rawPath.replaceAll('\\', '/')).replace(/^\.\//, '')
  return normalized === 'node/working' || normalized.startsWith('node/working/')
}

// OpenCode's static permission map cannot name a dynamic artifact id. Its
// plugin lifecycle hook runs immediately before the native read/grep/glob
// implementation, which gives DEF the missing exact-root guard without
// changing vendor code or opening an external directory.
export function assertDefNativeArtifactToolScope(input = {}, args = {}) {
  const toolName = input?.tool
  if (!['read', 'grep', 'glob'].includes(toolName)) return
  const sessionID = typeof input?.sessionID === 'string' ? input.sessionID : ''
  const rawPath = toolName === 'read' ? args?.filePath : args?.path
  const registry = nativeCatalogArtifactsBySession.get(sessionID)
  if (registry?.size) {
    const context = { sessionID, directory: path.resolve([...registry.values()][0].root, '..', '..') }
    pruneNativeCatalogArtifactRegistry(context)
  }
  if (toolName === 'read') {
    if (!looksLikeRetrievalPath(rawPath)) return
    if (isNativeArtifactToolPathAllowed(sessionID, rawPath)) return
    throw new Error('denied-native-catalog-artifact-scope: read is limited to an unexpired artifact root returned in this session')
  }
  if (isNativeArtifactToolPathAllowed(sessionID, rawPath) || isNodeWorkingToolPath(rawPath)) return
  throw new Error(`denied-native-file-scope: ${toolName} requires an explicit node/working or unexpired native artifact path`)
}

function readNativeArtifactManifest(root) {
  const manifestPath = path.join(root, 'manifest.json')
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    return manifest && typeof manifest === 'object' ? manifest : null
  } catch {
    return null
  }
}

function nativeArtifactFilesMatch(root, manifest) {
  if (!Array.isArray(manifest?.files) || manifest.files.length === 0) return false
  return manifest.files.every((file) => {
    try {
      const name = nativeArtifactFileName(file?.path)
      const content = fs.readFileSync(path.join(root, name), 'utf8')
      return typeof file?.sha256 === 'string' && sha256Text(content) === file.sha256
    } catch {
      return false
    }
  })
}

function cleanupExpiredNativeArtifacts(context, now = Date.now()) {
  const root = nativeArtifactRoot(context)
  if (!fs.existsSync(root)) {
    pruneNativeCatalogArtifactRegistry(context, now)
    return
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    // Never recursively clean a caller-supplied path. The only deletable
    // cache entries are artifact ids this bridge itself minted below.
    if (!entry.isDirectory() || !/^catalog-[a-z0-9-]{20,}$/i.test(entry.name)) continue
    const artifactRoot = path.join(root, entry.name)
    const manifest = readNativeArtifactManifest(artifactRoot)
    if (!manifest || Number(manifest.expiresAt) <= now) removeNativeCatalogArtifact(context, entry.name, artifactRoot)
  }
  pruneNativeCatalogArtifactRegistry(context, now)
}

export function cleanupNativeCatalogArtifacts(context, now = Date.now()) {
  if (!context?.directory || !context?.sessionID) throw new Error('native-catalog-artifact-session-directory-required')
  cleanupExpiredNativeArtifacts(context, now)
}

function findReusableNativeArtifact(context, snapshot, expectedFiles, now = Date.now()) {
  const root = nativeArtifactRoot(context)
  if (!fs.existsSync(root)) return null
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^catalog-[a-z0-9-]{20,}$/i.test(entry.name)) continue
    const artifactRoot = path.join(root, entry.name)
    const manifest = readNativeArtifactManifest(artifactRoot)
    if (!manifest || manifest.contract !== nativeCatalogArtifactContract || Number(manifest.expiresAt) <= now) continue
    if (manifest.domain !== snapshot.domain || manifest.query !== snapshot.query || manifest.selectionMode !== snapshot.selectionMode
      || manifest.source?.revision !== snapshot.source?.revision) continue
    if (!Array.isArray(manifest.files) || manifest.files.length !== expectedFiles.length
      || expectedFiles.some((file, index) => manifest.files[index]?.path !== file.path || manifest.files[index]?.sha256 !== file.sha256)) continue
    if (!nativeArtifactFilesMatch(artifactRoot, manifest)) continue
    return { root: artifactRoot, manifest }
  }
  return null
}

function validateNativeCatalogSnapshot(snapshot) {
  if (!snapshot || snapshot.ok !== true || snapshot.contract !== nativeCatalogArtifactContract) {
    throw new Error('native-catalog-artifact-invalid-snapshot: typed bridge did not return DefNativeCatalogArtifactV1')
  }
  if (!['equipment', 'weapon'].includes(snapshot.domain) || typeof snapshot.query !== 'string' || !snapshot.query.trim()) {
    throw new Error('native-catalog-artifact-invalid-snapshot: domain and non-empty query are required')
  }
  if (!['entity-full', 'substring-minimal', 'domain-full-fallback'].includes(snapshot.selectionMode)) {
    throw new Error('native-catalog-artifact-invalid-snapshot: unsupported selection mode')
  }
  if (!snapshot.source || typeof snapshot.source.storageKey !== 'string' || typeof snapshot.source.revision !== 'string') {
    throw new Error('native-catalog-artifact-invalid-snapshot: source revision is required')
  }
  if (!Array.isArray(snapshot.files) || snapshot.files.length === 0 || snapshot.files.length > 4) {
    throw new Error('native-catalog-artifact-invalid-snapshot: one to four catalog data files are required')
  }
  const names = new Set()
  const files = snapshot.files.map((file) => {
    const fileName = nativeArtifactFileName(file?.path)
    if (names.has(fileName)) throw new Error(`native-catalog-artifact-invalid-snapshot: duplicate data file ${fileName}`)
    names.add(fileName)
    if (typeof file?.content !== 'string' || !file.content) {
      throw new Error('native-catalog-artifact-invalid-snapshot: data file content is required')
    }
    return {
      path: fileName,
      records: Number(file.records) || 0,
      content: file.content,
      sha256: sha256Text(file.content),
    }
  })
  return files
}

function nativeArtifactManifestFiles(files) {
  return files.map((file) => ({
    path: file.path,
    sha256: file.sha256,
    records: file.records,
  }))
}

function writeNativeArtifactFiles(directory, files) {
  for (const file of files) {
    const target = path.join(directory, file.path)
    fs.writeFileSync(target, file.content, 'utf8')
    if (sha256Text(fs.readFileSync(target, 'utf8')) !== file.sha256) {
      throw new Error(`native-catalog-artifact-hash-mismatch: ${file.path}`)
    }
  }
}

export function materializeNativeCatalogArtifact(context, snapshot, now = Date.now()) {
  const files = validateNativeCatalogSnapshot(snapshot)
  if (!context?.directory || typeof context.directory !== 'string' || !context.sessionID) throw new Error('native-catalog-artifact-session-directory-required')
  const root = nativeArtifactRoot(context)
  fs.mkdirSync(root, { recursive: true })
  cleanupExpiredNativeArtifacts(context, now)
  const reusable = findReusableNativeArtifact(context, snapshot, files, now)
  if (reusable) {
    registerNativeCatalogArtifact(context, reusable.root, reusable.manifest)
    return {
      ...reusable.manifest,
      root: path.relative(context.directory, reusable.root),
      manifestPath: path.relative(context.directory, path.join(reusable.root, 'manifest.json')),
      reused: true,
    }
  }
  const artifactId = `catalog-${randomUUID()}`
  const temporary = path.join(root, `.tmp-${artifactId}`)
  const artifactRoot = path.join(root, artifactId)
  const expiresAt = now + nativeCatalogArtifactTtlMs
  const manifest = {
    contract: nativeCatalogArtifactContract,
    artifactId,
    domain: snapshot.domain,
    selectionMode: snapshot.selectionMode,
    selectionReason: snapshot.selectionReason || null,
    query: snapshot.query,
    source: snapshot.source,
    files: nativeArtifactManifestFiles(files),
    createdAt: now,
    expiresAt,
    readOnly: true,
    nativeAccessRoot: `${retrievalRoot}/${artifactId}`,
  }
  try {
    fs.mkdirSync(temporary, { recursive: false })
    writeNativeArtifactFiles(temporary, files)
    fs.writeFileSync(path.join(temporary, 'README.md'), [
      '# DEF native retrieval artifact',
      '',
      `Domain: ${manifest.domain}`,
      `Mode: ${manifest.selectionMode}`,
      `Source revision: ${manifest.source.revision}`,
      '',
      'This directory is immutable retrieval evidence. Read manifest.json first, then use native read or grep only within this artifact root. Do not edit it or use it as Work Node input.',
      '',
    ].join('\n'), 'utf8')
    fs.writeFileSync(path.join(temporary, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    fs.renameSync(temporary, artifactRoot)
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true })
    // A completed artifact can only be reached by the final rename. Never
    // leave a half-written directory for the model to mistake as evidence.
    if (!fs.existsSync(path.join(artifactRoot, 'manifest.json'))) fs.rmSync(artifactRoot, { recursive: true, force: true })
    throw error
  }
  registerNativeCatalogArtifact(context, artifactRoot, manifest)
  return {
    ...manifest,
    root: `${retrievalRoot}/${artifactId}`,
    manifestPath: `${retrievalRoot}/${artifactId}/manifest.json`,
    reused: false,
  }
}

function materialize(context, node, options = {}) {
  if (!node?.id || !node?.workingPayload || !node?.basePayload) throw new Error('Work node payload is incomplete')
  fs.mkdirSync(context.directory, { recursive: true })
  const source = decodeDefNodePayload(node.workingPayload)
  const baseSource = decodeDefNodePayload(node.basePayload)
  const manifest = {
    schemaVersion: 1,
    nodeId: node.id,
    workspaceId: node.timelineId || node.saveId,
    parentNodeId: node.parentNodeId || null,
    saveId: node.saveId,
    branchId: node.branchId,
    sessionId: context.sessionID,
    revision: node.contentRevision || node.updatedAt,
    baseHash: hashDefNodeValue(node.basePayload),
    workingHash: hashDefNodeValue(node.workingPayload),
    sourceHash: hashDefNodeValue(source),
    checkoutAnchorNodeId: options.checkoutAnchorNodeId || null,
    materializedAt: Date.now(),
  }
  writeJson(inside(context.directory, bindingFile), {
    ...manifest,
    schemaVersion: 2,
  })
  writeJson(inside(context.directory, nodeManifest), manifest)
  writeJson(inside(context.directory, 'node/base/snapshot.json'), node.basePayload)
  writeJson(inside(context.directory, 'node/base/selection.json'), baseSource.selection)
  writeJson(inside(context.directory, 'node/base/timeline.json'), baseSource.timeline)
  writeJson(inside(context.directory, 'node/base/buffs.json'), baseSource.buffs)
  writeJson(inside(context.directory, 'node/base/inputs.json'), baseSource.inputs)
  writeJson(inside(context.directory, nodeSelection), source.selection)
  writeJson(inside(context.directory, nodeTimeline), source.timeline)
  writeJson(inside(context.directory, nodeBuffs), source.buffs)
  writeJson(inside(context.directory, nodeInputs), source.inputs)
  writeJson(inside(context.directory, 'node/context/derived.json'), {
    anomalyStateSnapshots: node.workingPayload.anomalyStateSnapshots || [],
    characterComputedMap: node.workingPayload.characterComputedMap || {},
    characterDisplayCacheMap: node.workingPayload.characterDisplayCacheMap || {},
  })
  writeJson(inside(context.directory, 'node/generated/payload.json'), node.workingPayload)
  writeJson(inside(context.directory, baseFile), node.basePayload)
  writeJson(inside(context.directory, workingFile), node.workingPayload)
  fs.writeFileSync(inside(context.directory, 'README.md'), [
    '# DEF child node workspace',
    '',
    `Node: ${node.id}`,
    '',
    `Edit only ${nodeRoot}/working/*.json with OpenCode read/edit/apply_patch.`,
    'The normalized timeline keeps every button once; generated storage mirrors are rebuilt by the codec.',
    `${nodeRoot}/base, ${nodeRoot}/context, ${nodeRoot}/generated and ${nodeManifest} are read-only evidence.`,
    'Run def_node_sync_validate to rebuild, validate and review before requesting approval or using the node.',
    '',
  ].join('\n'), 'utf8')
  return {
    nodeId: node.id,
    workspaceId: manifest.workspaceId,
    timelineId: manifest.workspaceId,
    directory: context.directory,
    revision: manifest.revision,
    editableFiles: [nodeSelection, nodeTimeline, nodeBuffs, nodeInputs],
    readOnlyFiles: [nodeManifest, 'node/base/snapshot.json', 'node/context/derived.json', 'node/generated/payload.json'],
  }
}

function readBinding(context) {
  const target = inside(context.directory, bindingFile)
  if (!fs.existsSync(target)) throw new Error('No child node is bound to this OpenCode session. Call def_node_fork or def_node_bind first.')
  return JSON.parse(fs.readFileSync(target, 'utf8'))
}

function readBoundWorkspaceId(context, nodeId) {
  const target = inside(context.directory, bindingFile)
  if (!fs.existsSync(target)) return ''
  try {
    const binding = JSON.parse(fs.readFileSync(target, 'utf8'))
    if (binding?.nodeId !== nodeId) return ''
    return typeof binding.workspaceId === 'string' && binding.workspaceId.trim()
      ? binding.workspaceId.trim()
      : typeof binding.saveId === 'string' && binding.saveId.trim()
        ? binding.saveId.trim()
        : typeof binding.timelineId === 'string' && binding.timelineId.trim()
          ? binding.timelineId.trim()
          : ''
  } catch {
    return ''
  }
}

function writeBinding(context, binding) {
  writeJson(inside(context.directory, bindingFile), binding)
  writeJson(inside(context.directory, nodeManifest), { ...binding, schemaVersion: 1 })
  return binding
}

function readWorkbenchApprovalIdentity(context, binding) {
  const target = inside(context.directory, workbenchContextFile)
  let attached = null
  try {
    if (fs.existsSync(target)) attached = JSON.parse(fs.readFileSync(target, 'utf8'))
  } catch {
    attached = null
  }
  return {
    timelineId: binding.saveId || attached?.context?.timeline?.id || '',
    axisBindingId: attached?.axisBindingId || attached?.context?.axisContext?.binding?.id || '',
    sessionBindingId: attached?.axisBindingId || attached?.context?.axisContext?.binding?.id || '',
  }
}

function activeCheckoutNodeId(snapshot) {
  const checkout = snapshot?.axisContext?.checkout
  return checkout?.targetType === 'work-node' && typeof checkout.targetId === 'string' && checkout.targetId
    ? checkout.targetId
    : null
}

function writeSessionCheckoutObservation(context, checkout) {
  const target = inside(context.directory, '.def-session.json')
  if (!fs.existsSync(target)) return { changed: false, previous: null }
  const session = JSON.parse(fs.readFileSync(target, 'utf8'))
  const previous = session.workbenchCheckout || null
  const next = checkout
    ? { targetType: checkout.targetType, targetId: checkout.targetId, updatedAt: checkout.updatedAt || null }
    : null
  const changed = Boolean(previous) && (previous?.targetType !== next?.targetType || previous?.targetId !== next?.targetId)
  const existing = session.workbenchCheckoutState && typeof session.workbenchCheckoutState === 'object'
    ? session.workbenchCheckoutState
    : {}
  session.workbenchCheckout = next
  if (next?.targetType === 'work-node') session.boundNodeId = next.targetId
  else delete session.boundNodeId
  session.workbenchCheckoutState = {
    phase: changed ? 'checkout-changed' : (existing.phase === 'checkout-changed' ? 'checkout-changed' : 'ready'),
    current: next,
    previous: changed ? previous : (existing.previous || null),
    observedAt: Date.now(),
  }
  fs.writeFileSync(target, `${JSON.stringify(session, null, 2)}\n`, 'utf8')
  return { changed, previous, phase: session.workbenchCheckoutState.phase }
}

function readSessionCheckoutState(context) {
  const target = inside(context.directory, '.def-session.json')
  if (!fs.existsSync(target)) return null
  return JSON.parse(fs.readFileSync(target, 'utf8'))?.workbenchCheckoutState || null
}

function markWorkbenchCheckoutReady(context, checkoutNodeId) {
  const target = inside(context.directory, '.def-session.json')
  if (!fs.existsSync(target)) return
  const session = JSON.parse(fs.readFileSync(target, 'utf8'))
  const current = session.workbenchCheckout || null
  if (!checkoutNodeId || current?.targetType !== 'work-node' || current.targetId !== checkoutNodeId) return
  session.workbenchCheckoutState = {
    phase: 'ready',
    current,
    previous: null,
    acknowledgedAt: Date.now(),
  }
  fs.writeFileSync(target, `${JSON.stringify(session, null, 2)}\n`, 'utf8')
}

function requireWorkbenchCheckoutReady(context) {
  const state = readSessionCheckoutState(context)
  if (state?.phase !== 'checkout-changed') return
  const error = new Error(`Workbench checkout changed to ${state.current?.targetId || 'an unknown node'}. Call def_node_bind with nodeId="" before any other node operation.`)
  error.code = 'def-workbench-checkout-rebind-required'
  throw error
}

function requireWorkbenchSelectionMatchesCheckout(workbench) {
  if (!workbench || workbench.selectionMatchesCheckout) return
  const error = new Error(`Workbench UI selection ${workbench.selectedNodeId || 'none'} does not match authoritative checkout ${workbench.checkoutNodeId || 'none'}. Select/use the checkout node, refresh context, then retry the mutation.`)
  error.code = 'def-workbench-selection-checkout-mismatch'
  throw error
}

async function readWorkbenchState(context) {
  const target = inside(context.directory, workbenchContextFile)
  if (!fs.existsSync(target)) throw new Error('No live Workbench context is attached to this session.')
  const attached = JSON.parse(fs.readFileSync(target, 'utf8'))
  const snapshot = await callDefTool('def.workbench.snapshot', { sessionBindingId: attached.axisBindingId }, context)
  const checkout = snapshot?.axisContext?.checkout || null
  const observation = writeSessionCheckoutObservation(context, checkout)
  const selectedNodeId = typeof attached?.context?.selectedWorkbenchNode?.id === 'string'
    ? attached.context.selectedWorkbenchNode.id.trim()
    : null
  const checkoutNodeId = activeCheckoutNodeId(snapshot)
  return {
    attached,
    snapshot,
    checkout,
    checkoutNodeId,
    selectedNodeId,
    selectionMatchesCheckout: !selectedNodeId || selectedNodeId === checkoutNodeId,
    checkoutChanged: observation.changed,
    previousCheckout: observation.previous,
    checkoutPhase: observation.phase,
  }
}

async function readOptionalWorkbenchState(context) {
  if (!fs.existsSync(inside(context.directory, workbenchContextFile))) return null
  return readWorkbenchState(context)
}

function workspaceIsDirty(context, binding) {
  try {
    return Boolean(binding?.sourceHash) && hashDefNodeValue(readWorkspaceSource(context)) !== binding.sourceHash
  } catch {
    return false
  }
}

async function readBindingForCurrentCheckout(context) {
  let binding = readBinding(context)
  const workbench = await readOptionalWorkbenchState(context)
  if (!workbench) return { binding, workbench: null }
  requireWorkbenchCheckoutReady(context)
  requireWorkbenchSelectionMatchesCheckout(workbench)
  if (!binding.checkoutAnchorNodeId && workbench.checkoutNodeId) {
    if (binding.nodeId !== workbench.checkoutNodeId) {
      const error = new Error(`The active Workbench checkout is ${workbench.checkoutNodeId}, but this legacy workspace is materialized for ${binding.nodeId}. Call def_node_bind with nodeId="" before continuing; unsynchronized edits were preserved.`)
      error.code = 'def-workbench-checkout-changed'
      throw error
    }
    binding = writeBinding(context, { ...binding, checkoutAnchorNodeId: workbench.checkoutNodeId })
  }
  if (workbench.checkoutNodeId && binding.checkoutAnchorNodeId && binding.checkoutAnchorNodeId !== workbench.checkoutNodeId) {
    const error = new Error(`The Workbench checkout changed from ${binding.checkoutAnchorNodeId} to ${workbench.checkoutNodeId}. Call def_node_bind with nodeId="" before continuing; unsynchronized edits were preserved.`)
    error.code = 'def-workbench-checkout-changed'
    throw error
  }
  return { binding, workbench }
}

function readForkMetadata(args) {
  const name = typeof args?.name === 'string' ? args.name.trim() : ''
  const description = typeof args?.description === 'string' ? args.description.trim() : ''
  if (name.length < 2 || name.length > 48) {
    throw new Error('def_node_fork requires a 2-48 character short name that summarizes this change.')
  }
  if (description.length < 8 || description.length > 240) {
    throw new Error('def_node_fork requires an 8-240 character description of this change and its scope.')
  }
  return { name, description }
}

async function syncWorkspace(context) {
  const { binding } = await readBindingForCurrentCheckout(context)
  const workspaceSource = {
    schemaVersion: 1,
    selection: JSON.parse(fs.readFileSync(inside(context.directory, nodeSelection), 'utf8')),
    timeline: JSON.parse(fs.readFileSync(inside(context.directory, nodeTimeline), 'utf8')),
    buffs: JSON.parse(fs.readFileSync(inside(context.directory, nodeBuffs), 'utf8')),
    inputs: JSON.parse(fs.readFileSync(inside(context.directory, nodeInputs), 'utf8')),
  }
  const result = await callDefTool('def.worknode.sync_workspace', {
    nodeId: binding.nodeId,
    sessionId: context.sessionID,
    expectedRevision: binding.revision,
    expectedBaseHash: binding.baseHash,
    expectedWorkingHash: binding.workingHash,
    workspaceSource,
  }, context)
  const nextBinding = { ...binding, revision: result.revision, workingHash: result.workingHash, synchronizedAt: Date.now() }
  nextBinding.sourceHash = hashDefNodeValue(workspaceSource)
  writeBinding(context, nextBinding)
  if (result.generatedPayload) {
    writeJson(inside(context.directory, workingFile), result.generatedPayload)
    writeJson(inside(context.directory, 'node/generated/payload.json'), result.generatedPayload)
  }
  writeJson(inside(context.directory, 'node/generated/validation.json'), result.validation)
  writeJson(inside(context.directory, 'node/generated/diff.json'), result.diff)
  writeJson(inside(context.directory, 'node/generated/risk.json'), { riskFlags: result.riskFlags, checkoutDecision: result.checkoutDecision })
  return result
}

function readWorkspaceSource(context) {
  return {
    schemaVersion: 1,
    selection: JSON.parse(fs.readFileSync(inside(context.directory, nodeSelection), 'utf8')),
    timeline: JSON.parse(fs.readFileSync(inside(context.directory, nodeTimeline), 'utf8')),
    buffs: JSON.parse(fs.readFileSync(inside(context.directory, nodeBuffs), 'utf8')),
    inputs: JSON.parse(fs.readFileSync(inside(context.directory, nodeInputs), 'utf8')),
  }
}

export const node_code_materialize = {
  description: 'Materialize an existing DEF Work Node as normalized editable node/working sources in this isolated session.',
  args: { nodeId: { type: 'string', description: 'Existing Work Node id.' } },
  async execute(args, context) {
    const workbench = await readOptionalWorkbenchState(context)
    if (workbench) {
      requireWorkbenchCheckoutReady(context)
      requireWorkbenchSelectionMatchesCheckout(workbench)
    }
    const current = fs.existsSync(inside(context.directory, bindingFile)) ? readBinding(context) : null
    if (current?.nodeId !== args.nodeId && workspaceIsDirty(context, current)) {
      throw new Error(`Cannot replace ${current.nodeId} because node/working has unsynchronized edits. Sync, discard, or explicitly preserve that draft first.`)
    }
    const read = await callDefTool('def.worknode.read', { nodeId: args.nodeId, includePayload: true }, context)
    return { title: 'DEF node code workspace materialized', output: JSON.stringify(materialize(context, read.node, { checkoutAnchorNodeId: workbench?.checkoutNodeId }), null, 2), metadata: { family: 'def-node-code', nodeId: args.nodeId } }
  },
}

export const node_code_status = {
  description: 'Read the current DEF node code workspace revision, hashes, dirty state, and latest generated validation reports.',
  args: {},
  async execute(_args, context) {
    const manifest = JSON.parse(fs.readFileSync(inside(context.directory, nodeManifest), 'utf8'))
    const source = readWorkspaceSource(context)
    const report = (name) => {
      const target = inside(context.directory, `node/generated/${name}.json`)
      return fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : null
    }
    const output = {
      nodeId: manifest.nodeId,
      revision: manifest.revision,
      baseHash: manifest.baseHash,
      workingHash: manifest.workingHash,
      dirty: hashDefNodeValue(source) !== manifest.sourceHash,
      validation: report('validation'),
      diff: report('diff'),
      risk: report('risk'),
    }
    return { title: 'DEF node code workspace status', output: JSON.stringify(boundResourceValue(output), null, 2), metadata: { family: 'def-node-code', nodeId: manifest.nodeId, dirty: output.dirty } }
  },
}

export const node_code_rebuild = {
  description: 'Rebuild the bound Work Node payload from normalized node/working sources with revision checks, validation, semantic diff, and risk analysis.',
  args: {},
  async execute(_args, context) {
    const result = await syncWorkspace(context)
    return { title: result.validation?.ok ? 'DEF node source rebuilt' : 'DEF node rebuild failed', output: JSON.stringify(result, null, 2), metadata: { family: 'def-node-code', nodeId: result.nodeId, revision: result.revision } }
  },
}

export const node_code_discard = {
  description: 'Discard unsynchronized node/working file edits after native confirmation and re-materialize the repository Work Node revision.',
  args: {},
  async execute(_args, context) {
    const { binding } = await readBindingForCurrentCheckout(context)
    await askWithApproval(context, {
      action: 'Discard node code edits',
      summary: `Discard unsynchronized code edits for ${binding.nodeId}`,
      permission: 'def_node_code_discard',
      nodeId: binding.nodeId,
      revision: binding.revision,
      workingHash: binding.workingHash,
      consequence: 'All unsynchronized node/working edits will be replaced from the repository Work Node.',
    })
    const read = await callDefTool('def.worknode.read', { nodeId: binding.nodeId, includePayload: true }, context)
    return { title: 'DEF node code edits discarded', output: JSON.stringify(materialize(context, read.node, { checkoutAnchorNodeId: binding.checkoutAnchorNodeId }), null, 2), metadata: { family: 'def-node-code', nodeId: binding.nodeId } }
  },
}

export const node_fork = {
  description: 'Fork the current DEF Work Node/current checkout into an isolated node-code workspace. You must provide a short Agent-written change name and description. Timeline edits use child placement; a selected-operator replacement uses horizontal-branch placement.',
  args: {
    name: { type: 'string', description: 'Short phrase naming this change, for example "调整莱万汀燃烬顺序". Do not use ids or timestamps.' },
    description: { type: 'string', description: 'Concise description of the intended timeline change and scope.' },
    placement: { type: 'string', enum: ['child', 'horizontal-branch'], description: 'Use child for timeline edits. Use horizontal-branch when replacing a selected operator so the new state appears beside the current configuration.' },
    approvalPolicy: { type: 'string', enum: ['auto-low-risk', 'ask-on-risk', 'manual'], description: 'Approval policy for using this node. Defaults to manual for Agent-created timeline mutations.' },
  },
  async execute(args, context) {
    const placement = args.placement === 'horizontal-branch' ? 'horizontal-branch' : 'child'
    context.metadata({ title: placement === 'horizontal-branch' ? 'Fork DEF horizontal branch' : 'Fork DEF child node' })
    const metadata = readForkMetadata(args)
    const workbench = await readOptionalWorkbenchState(context)
    if (workbench) {
      requireWorkbenchCheckoutReady(context)
      requireWorkbenchSelectionMatchesCheckout(workbench)
    }
    const current = fs.existsSync(inside(context.directory, bindingFile)) ? readBinding(context) : null
    if (workspaceIsDirty(context, current)) {
      throw new Error(`Cannot fork over ${current.nodeId} because node/working has unsynchronized edits. Sync, discard, or explicitly preserve that draft first.`)
    }
    const created = await callDefTool('def.worknode.create_from_current', {
      approvalPolicy: args.approvalPolicy || 'manual',
      label: metadata.name,
      description: metadata.description,
      placement,
    }, context)
    return {
      title: placement === 'horizontal-branch' ? 'DEF horizontal branch ready' : 'DEF child node ready',
      output: JSON.stringify(materialize(context, created.node, { checkoutAnchorNodeId: workbench?.checkoutNodeId }), null, 2),
      metadata: { nodeId: created.node.id, family: 'def-node-crud' },
    }
  },
}

export const workbench_context = {
  description: 'Read the bound DEF timeline tree and live current-checkout context. Detects manual checkout changes and requires a current-checkout rebind before stale node work can continue.',
  args: {},
  async execute(_args, context) {
    const workbench = await readWorkbenchState(context)
    const binding = fs.existsSync(inside(context.directory, bindingFile)) ? readBinding(context) : null
    const checkoutTransition = {
      changed: workbench.checkoutChanged,
      previous: workbench.previousCheckout,
      current: workbench.checkout,
      activeCheckoutNodeId: workbench.checkoutNodeId,
      boundWorkspaceNodeId: binding?.nodeId || null,
      checkoutAnchorNodeId: binding?.checkoutAnchorNodeId || null,
      requiresRebind: workbench.checkoutPhase === 'checkout-changed' || Boolean(workbench.checkoutNodeId && binding && (
        (binding.checkoutAnchorNodeId && binding.checkoutAnchorNodeId !== workbench.checkoutNodeId)
        || (!binding.checkoutAnchorNodeId && binding.nodeId !== workbench.checkoutNodeId)
      )),
      selectedNodeId: workbench.selectedNodeId,
      selectionMatchesCheckout: workbench.selectionMatchesCheckout,
      reasoningEffort: workbench.checkoutChanged ? 'high' : 'normal',
      phase: workbench.checkoutPhase,
    }
    return {
      title: 'DEF Workbench context',
      output: JSON.stringify(boundResourceValue({ attached: workbench.attached, snapshot: workbench.snapshot, checkoutTransition }), null, 2),
      metadata: { family: 'def-node-crud', host: 'workbench', updatedAt: workbench.attached.updatedAt, checkoutChanged: workbench.checkoutChanged },
    }
  },
}

export const workbench_current_node = {
  description: 'Read the one authoritative current Workbench checkout node. Never infer it from a node list, node cursor, parent, or latest-applied status.',
  args: {},
  async execute(_args, context) {
    const workbench = await readWorkbenchState(context)
    requireWorkbenchCheckoutReady(context)
    const checkout = workbench.checkout
    if (checkout?.targetType !== 'work-node' || !workbench.checkoutNodeId) {
      throw new Error('The current Workbench checkout is not a Work Node.')
    }
    const nodes = Array.isArray(workbench.snapshot?.axisContext?.nodes) ? workbench.snapshot.axisContext.nodes : []
    const node = nodes.find((candidate) => candidate?.id === workbench.checkoutNodeId)
    if (!node) throw new Error(`Current Workbench checkout node is missing from its bound tree: ${workbench.checkoutNodeId}`)
    const result = {
      nodeId: node.id,
      label: node.label,
      description: node.description || '',
      status: node.status,
      parentNodeId: node.parentNodeId || null,
      updatedAt: node.updatedAt,
    }
    return {
      title: 'DEF current checkout node',
      output: JSON.stringify(result, null, 2),
      metadata: { family: 'def-node-crud', host: 'workbench', nodeId: node.id, checkoutUpdatedAt: checkout.updatedAt },
    }
  },
}

export const workbench_buttons = {
  description: 'Read current-checkout buttons using exact coordinates. @N-L always means nodeIndex=N-1 and lineIndex=L-1; use this before resolving a button for deletion or edit.',
  args: {
    characterName: { type: 'string', description: 'Optional character name.' },
    skillName: { type: 'string', description: 'Optional skill display name.' },
    nodeIndex: { type: 'number', description: 'Zero-based timeline node index.' },
    lineIndex: { type: 'number', description: 'Zero-based timeline line index.' },
  },
  async execute(args, context) {
    context.metadata({ title: 'Find DEF timeline buttons' })
    const result = await callDefTool('def.workbench.find_buttons', args, context)
    return {
      title: 'DEF timeline button candidates',
      output: JSON.stringify(result, null, 2),
      metadata: { family: 'def-node-crud', count: result.count, snapshotUpdatedAt: result.snapshotUpdatedAt },
    }
  },
}

export const workbench_buff_ranking = {
  description: 'Rank current-checkout buttons for one character by selected Buff count. Use this for questions about which skill has the most Buffs; do not count Buffs manually.',
  args: {
    characterName: { type: 'string', description: 'Character name to rank. Required for character-specific questions.' },
  },
  async execute(args, context) {
    context.metadata({ title: 'Rank DEF timeline button Buffs' })
    const result = await callDefTool('def.workbench.rank_buttons_by_buff', args, context)
    return {
      title: 'DEF timeline Buff ranking',
      output: JSON.stringify(result, null, 2),
      metadata: { family: 'def-node-crud', count: result.count, snapshotUpdatedAt: result.snapshotUpdatedAt },
    }
  },
}

export const node_bind = {
  description: 'Bind an existing DEF Work Node to this isolated workspace. Pass an empty nodeId to bind the current Workbench checkout after a manual node switch.',
  args: {
    nodeId: { type: 'string', description: 'Existing DEF Work Node id. Pass an empty string to bind the active Workbench checkout.' },
    workspaceId: { type: 'string', description: 'Exact SQLite workspace id returned by def_node_fork. Optional when the active session already owns the workspace binding.' },
  },
  async execute(args, context) {
    context.metadata({ title: 'Bind DEF child node' })
    const workbench = await readOptionalWorkbenchState(context)
    const explicitlyRequestedNodeId = typeof args.nodeId === 'string' && args.nodeId.trim() ? args.nodeId.trim() : ''
    const nodeId = explicitlyRequestedNodeId || workbench?.checkoutNodeId
    if (!nodeId) throw new Error('No current Workbench Work Node is checked out. Provide nodeId explicitly.')
    if (explicitlyRequestedNodeId && workbench?.checkoutPhase === 'checkout-changed') {
      const error = new Error(`Workbench checkout changed to ${workbench.checkoutNodeId || 'an unknown node'}. Bind it first with nodeId="", then bind the explicitly requested draft.`)
      error.code = 'def-workbench-checkout-rebind-required'
      throw error
    }
    const current = fs.existsSync(inside(context.directory, bindingFile)) ? readBinding(context) : null
    if (current?.nodeId !== nodeId && workspaceIsDirty(context, current)) {
      throw new Error(`Cannot replace ${current.nodeId} because node/working has unsynchronized edits. Sync, discard, or explicitly preserve that draft first.`)
    }
    const workspaceId = typeof args.workspaceId === 'string' && args.workspaceId.trim() ? args.workspaceId.trim() : ''
    const read = await callDefTool('def.worknode.read', {
      nodeId,
      includePayload: true,
      ...(workspaceId ? { workspaceId } : {}),
    }, context)
    const materialized = materialize(context, read.node, { checkoutAnchorNodeId: workbench?.checkoutNodeId })
    if (workbench?.checkoutNodeId) markWorkbenchCheckoutReady(context, workbench.checkoutNodeId)
    return {
      title: 'DEF child node bound',
      output: JSON.stringify(materialized, null, 2),
      metadata: { nodeId: read.node.id, family: 'def-node-crud', checkoutAnchorNodeId: workbench?.checkoutNodeId || null },
    }
  },
}

export const node_sync_validate = {
  description: 'Synchronize working-payload.json to the bound Work Node, validate it, and return parent/child diff evidence without touching current checkout.',
  args: {},
  async execute(_args, context) {
    context.metadata({ title: 'Validate DEF child node' })
    const synced = await syncWorkspace(context)
    return {
      title: synced.validation?.ok ? 'DEF child node validated' : 'DEF child node invalid',
      output: JSON.stringify(synced, null, 2),
      metadata: { nodeId: synced.nodeId, family: 'def-node-crud', validation: synced.validation },
    }
  },
}

export const node_diff = {
  description: 'Synchronize and show the validated diff between the bound child node and its base.',
  args: {},
  async execute(_args, context) {
    context.metadata({ title: 'Diff DEF child node' })
    const synced = await syncWorkspace(context)
    return {
      title: 'DEF child node diff',
      output: JSON.stringify({ nodeId: synced.nodeId, diff: synced.diff, diffSummary: synced.diffSummary, checkoutDecision: synced.checkoutDecision }, null, 2),
      metadata: { nodeId: synced.nodeId, family: 'def-node-crud' },
    }
  },
}

export const node_list = {
  description: 'List bounded DEF Work Node metadata without loading node payloads.',
  args: { limit: { type: 'number', description: 'Maximum nodes, from 1 to 100.' } },
  async execute(args, context) {
    context.metadata({ title: 'List DEF child nodes' })
    const result = await callDefTool('def.worknode.list', { limit: args.limit }, context)
    return {
      title: 'DEF child nodes',
      output: JSON.stringify(boundResourceValue(result), null, 2),
      metadata: { family: 'def-node-crud', count: result.nodes?.length || 0 },
    }
  },
}

export const node_delete = {
  description: 'Delete one non-checked-out DEF Work Node subtree after native user approval and repository protection checks.',
  args: {
    nodeId: { type: 'string', description: 'Work Node id to delete.' },
    workspaceId: { type: 'string', description: 'Exact SQLite workspace id returned by def_node_fork. Optional when deleting the draft bound in this session workspace.' },
  },
  async execute(args, context) {
    context.metadata({ title: 'Delete DEF child node' })
    const explicitWorkspaceId = typeof args.workspaceId === 'string' && args.workspaceId.trim() ? args.workspaceId.trim() : ''
    const workspaceId = explicitWorkspaceId || readBoundWorkspaceId(context, args.nodeId)
    const read = await callDefTool('def.worknode.read', {
      nodeId: args.nodeId,
      includePayload: false,
      ...(workspaceId ? { workspaceId } : {}),
    }, context)
    const resolvedWorkspaceId = workspaceId || read.node?.workspaceId || read.node?.timelineId || ''
    const approvalIdentity = readWorkbenchApprovalIdentity(context, { saveId: resolvedWorkspaceId })
    await askWithApproval(context, {
      action: 'Delete Work Node',
      summary: `Delete DEF Work Node ${args.nodeId}`,
      permission: 'def_node_delete',
      nodeId: args.nodeId,
      workspaceId: resolvedWorkspaceId,
      timelineId: approvalIdentity.timelineId || resolvedWorkspaceId,
      axisBindingId: approvalIdentity.axisBindingId,
      sessionBindingId: approvalIdentity.sessionBindingId,
      revision: read.node?.contentRevision || read.node?.updatedAt,
      consequence: 'The Work Node subtree will be permanently deleted; the current checkout remains protected.',
    })
    const result = await callDefTool('def.worknode.delete', {
      nodeId: args.nodeId,
      ...(resolvedWorkspaceId ? { workspaceId: resolvedWorkspaceId } : {}),
    }, context)
    return {
      title: 'DEF child node deleted',
      output: JSON.stringify(result, null, 2),
      metadata: { family: 'def-node-crud', nodeId: args.nodeId },
    }
  },
}

export const node_use = {
  description: 'Synchronize, validate, approve when required, and directly use the bound child Work Node as the current checkout.',
  args: {},
  async execute(_args, context) {
    context.metadata({ title: 'Use DEF child node' })
    const synced = await syncWorkspace(context)
    const binding = readBinding(context)
    const approvalIdentity = readWorkbenchApprovalIdentity(context, binding)
    const approval = await askWithApproval(context, {
      action: 'Apply Work Node',
      summary: `Apply DEF Work Node ${binding.nodeId} to the main Workbench`,
      permission: 'def_node_use',
      nodeId: binding.nodeId,
      revision: binding.revision,
      timelineId: approvalIdentity.timelineId,
      axisBindingId: approvalIdentity.axisBindingId,
      diffHash: hashDefNodeValue(synced.diff),
      riskHash: hashDefNodeValue(synced.riskFlags || []),
      workingHash: binding.workingHash,
      diff: synced.diff,
      riskFlags: synced.riskFlags || [],
      consequence: 'The validated Work Node becomes the current checkout and is sent to the Workbench renderer.',
    })
    const used = await callDefTool('def.worknode.checkout_and_verify', {
      nodeId: binding.nodeId,
      expectedRevision: binding.revision,
      expectedWorkingHash: binding.workingHash,
      approvalCapability: approval.approvalCapability,
      reload: false,
    }, context)
    if (used.currentCheckoutTouched === true) {
      writeBinding(context, { ...readBinding(context), checkoutAnchorNodeId: binding.nodeId })
    }
    return {
      title: used.ok ? 'DEF child node in use' : 'DEF child node use pending',
      output: JSON.stringify(used, null, 2),
      metadata: { nodeId: binding.nodeId, family: 'def-node-crud', currentCheckoutTouched: used.currentCheckoutTouched === true },
    }
  },
}

export const node_restore = {
  description: 'Restore the current checkout from the bound child node immutable base after native user approval.',
  args: {},
  async execute(_args, context) {
    context.metadata({ title: 'Restore DEF node base' })
    const { binding } = await readBindingForCurrentCheckout(context)
    const approvalIdentity = readWorkbenchApprovalIdentity(context, binding)
    const approval = await askWithApproval(context, {
      action: 'Restore Work Node base',
      summary: `Restore immutable base for DEF Work Node ${binding.nodeId}`,
      permission: 'def_node_restore',
      nodeId: binding.nodeId,
      revision: binding.revision,
      timelineId: approvalIdentity.timelineId,
      axisBindingId: approvalIdentity.axisBindingId,
      workingHash: binding.workingHash,
      consequence: 'The Work Node base snapshot becomes the current checkout after renderer verification.',
    })
    const restored = await callDefTool('def.worknode.restore_base_and_verify', {
      nodeId: binding.nodeId,
      expectedRevision: binding.revision,
      approvalCapability: approval.approvalCapability,
      reload: false,
    }, context)
    return {
      title: restored.ok ? 'DEF node base restored' : 'DEF node restore pending',
      output: JSON.stringify(restored, null, 2),
      metadata: { nodeId: binding.nodeId, family: 'def-node-crud', currentCheckoutTouched: restored.currentCheckoutTouched === true },
    }
  },
}

function boundResourceValue(value, depth = 0) {
  if (typeof value === 'string') return value.length > 600 ? `${value.slice(0, 600)}…` : value
  if (value === null || typeof value !== 'object') return value
  if (depth >= 5) return '[bounded]'
  if (Array.isArray(value)) return value.slice(0, 12).map((item) => boundResourceValue(item, depth + 1))
  return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, item]) => [key, boundResourceValue(item, depth + 1)]))
}

function dataResource(definition) {
  return {
    description: definition.description,
    args: definition.args || {
      query: { type: 'string', description: 'Optional id, name, or search text.' },
    },
    async execute(args, context) {
      context.metadata({ title: definition.title })
      const input = typeof definition.input === 'function' ? definition.input(args) : args
      const result = await callDefTool(definition.tool, input, context)
      if (definition.tool === 'def.knowledge.game.section.read' && result?.ok && context?.sessionID) {
        await callDefTool('def.team.loadout.plan.remember_guide', {
          referenceId: result.referenceId,
          sectionId: result.section?.sectionId,
          content: result.content,
        }, context)
      }
      const transformed = typeof definition.transform === 'function' ? definition.transform(result) : result
      // Section reads enforce their own server-side character/cursor contract.
      // Do not silently apply the generic 600-character free-text limiter to
      // an already bounded, continuous Markdown section.
      const bounded = definition.preserveContract === true ? transformed : boundResourceValue(transformed)
      return {
        title: definition.title,
        output: JSON.stringify(bounded, null, 2),
        metadata: { family: 'def-data-resource', legacyTool: definition.tool, ...(definition.contract ? { contract: definition.contract } : {}) },
      }
    },
  }
}

export const data_operator = dataResource({
  title: 'DEF operator resource',
  description: 'Resolve only the currently selected Workbench operators for a question about the current roster. Do not call this before or during an operator-specific weapon/equipment recommendation: def_data_operator_build_guide is the first evidence tool and already resolves exact identity.',
  tool: 'def.character.resolve',
  input: ({ query }) => ({ query, limit: 12 }),
})

function batchLoadoutResource(definition) {
  return {
    description: definition.description,
    args: definition.args,
    async execute(args, context) {
      context.metadata({ title: definition.title })
      const result = await callDefTool(definition.tool, definition.input(args), context)
      // Both server contracts are structurally bounded (selected team and
      // limitPerOperator <= 4). Keep their nested effect values intact rather
      // than applying the generic depth limiter used by free-form searches.
      return {
        title: definition.title,
        output: JSON.stringify(result),
        metadata: { family: 'def-data-resource', legacyTool: definition.tool, contract: definition.contract },
      }
    },
  }
}

const selectedTeamArgs = {
  characterIds: tool.schema.array(tool.schema.string().min(1).max(160)).max(4).optional()
    .describe('Optional exact selected character ids. Omit to read the whole current team.'),
}

export const data_team_loadouts = batchLoadoutResource({
  title: 'DEF selected team loadouts',
  contract: 'DefSelectedTeamLoadoutsV1',
  description: 'Read the exact current loadouts for the whole selected team from one snapshot. For “current four / everyone / what are they equipped with”, call this once and do not call per-operator or catalog resources.',
  tool: 'def.team.loadouts.read',
  args: selectedTeamArgs,
  input: ({ characterIds }) => (Array.isArray(characterIds) && characterIds.length ? { characterIds } : {}),
})

export const data_loadout_candidates = batchLoadoutResource({
  title: 'DEF selected team loadout candidates',
  contract: 'DefLoadoutCandidateBundleV1',
  description: 'Aggregate bounded compatible weapons by structured weaponType plus equipment-set candidates for the whole selected team. Detailed four-piece set facts appear once in top-level equipmentSetCandidates; each operator’s equipmentSetCandidates is an array of those gearSetId references. Use after def_data_team_loadouts for read-only team planning; never search weapons with operator names or apply changes.',
  tool: 'def.loadout.candidates.read',
  args: {
    ...selectedTeamArgs,
    include: tool.schema.array(tool.schema.enum(['weapon', 'equipment'])).min(1).max(2).optional()
      .describe('Candidate groups to include; omit for weapon and equipment.'),
    goal: tool.schema.string().max(240).optional().describe('Optional whole-team goal in the user’s words.'),
    limitPerOperator: tool.schema.number().int().min(1).max(4).optional().describe('Maximum candidates per operator; defaults to 4.'),
  },
  input: ({ characterIds, include, goal, limitPerOperator }) => ({
    ...(Array.isArray(characterIds) && characterIds.length ? { characterIds } : {}),
    ...(Array.isArray(include) && include.length ? { include } : {}),
    ...(typeof goal === 'string' && goal.trim() ? { goal: goal.trim() } : {}),
    ...(limitPerOperator !== undefined ? { limitPerOperator } : {}),
  }),
})

export const data_operator_catalog = dataResource({
  title: 'DEF selection catalog resource',
  description: 'Search the read-only operator catalog used by the selection screen. Use this after a user asks to find someone outside the current selected roster; it never changes that roster.',
  tool: 'def.operator.catalog.search',
  input: ({ query }) => ({ query, limit: 12 }),
})

export const team_selection_apply = {
  description: 'Apply one exact one-to-four operator roster after native user approval. Resolve every stable id with def_data_operator_catalog first. Reordering or any roster with at least one retained operator stays in the current SQLite and creates an Agent-named horizontal Work Node; only a complete four-person roster with zero overlap creates a new temporary SQLite and detaches this DEF session. Never call this for a read-only roster question.',
  args: {
    characterIds: tool.schema.array(tool.schema.string().min(1).max(160)).min(1).max(4)
      .describe('One to four exact stable operator ids from def_data_operator_catalog, in the requested line order.'),
    nodeTitle: tool.schema.string().min(2).max(48)
      .describe('Concise Agent-written title for the roster branch; no [ai] prefix, ids, timestamps, or fixed template.'),
    nodeDescription: tool.schema.string().min(8).max(240)
      .describe('One Agent-written sentence describing the roster change and retained scope.'),
  },
  async execute(args, context) {
    context.metadata({ title: 'Apply DEF team selection' })
    const workbench = await readWorkbenchState(context)
    requireWorkbenchCheckoutReady(context)
    requireWorkbenchSelectionMatchesCheckout(workbench)
    const checkoutNodeId = workbench.checkoutNodeId
    const currentCharacterIds = (Array.isArray(workbench.snapshot?.selectedCharacters)
      ? workbench.snapshot.selectedCharacters
      : []).map((character) => character?.id).filter(Boolean)
    if (JSON.stringify(currentCharacterIds) === JSON.stringify(args.characterIds)) {
      const unchanged = {
        ok: true,
        state: 'UNCHANGED',
        code: 'selection-unchanged',
        transition: 'unchanged',
        timelineId: workbench.snapshot?.axisContext?.binding?.timelineId || null,
        nodeId: checkoutNodeId,
        currentCheckoutTouched: false,
        postcondition: { pass: true, selectedCharacterIds: currentCharacterIds },
      }
      return {
        title: 'DEF team selection unchanged',
        output: JSON.stringify(unchanged, null, 2),
        metadata: { family: 'def-team-selection', transition: 'unchanged', currentCheckoutTouched: false, postcondition: true },
      }
    }
    const currentNode = checkoutNodeId
      ? await callDefTool('def.worknode.read', { nodeId: checkoutNodeId, includePayload: false }, context)
      : null
    const nodeRevision = currentNode?.node?.contentRevision || currentNode?.node?.updatedAt
    const attached = workbench.attached || {}
    const timelineId = attached?.context?.timeline?.id || workbench.snapshot?.axisContext?.binding?.timelineId || ''
    const axisBindingId = attached.axisBindingId || workbench.snapshot?.axisContext?.binding?.id || ''
    const approval = await askWithApproval(context, {
      action: 'Apply team selection',
      summary: `Apply selected roster: ${args.characterIds.join(', ')}`,
      permission: 'def_team_selection_apply',
      nodeId: checkoutNodeId || undefined,
      revision: nodeRevision,
      timelineId,
      axisBindingId,
      sessionBindingId: axisBindingId,
      parentNodeId: checkoutNodeId || undefined,
      parentRevision: nodeRevision,
      patterns: [
        `节点标题: ${args.nodeTitle}`,
        `修改描述: ${args.nodeDescription}`,
        `选中干员: ${args.characterIds.join('、')}`,
        '规则: 保留任一原干员时横向分支；仅四人全不相同时新建临时 SQLite',
      ],
      consequence: 'The exact roster is applied after renderer verification. A disjoint four-person roster enters a new temporary SQLite and detaches this AI session.',
    })
    const result = await callDefTool('def.team.selection.apply', {
      characterIds: args.characterIds,
      nodeTitle: args.nodeTitle,
      nodeDescription: args.nodeDescription,
      approvalCapability: approval.approvalCapability,
    }, context)
    return {
      title: result.ok ? 'DEF team selection applied' : 'DEF team selection not applied',
      output: JSON.stringify(result, null, 2),
      metadata: {
        family: 'def-team-selection',
        transition: result.transition || null,
        currentCheckoutTouched: result.currentCheckoutTouched === true,
        postcondition: result.postcondition?.pass === true,
      },
    }
  },
}

export const data_operator_build_guide = {
  description: 'Required first evidence step only when judging which weapon or equipment better fits a specific operator: an operator-specific recommendation, optimization, 3+1 plan, or suitability comparison. Pure catalog facts, field/ID/slot/effect lookups, and comparisons unrelated to operator fit do not require this tool and should use the narrowest trusted typed catalog resource. For the applicable operator-fit flow, it resolves one exact operator and searches every allowlisted game-knowledge reference for an operator-specific build section. GUIDE_FOUND returns one bounded strategy section plus a server-compiled plannerProfile and same-turn plannerProfileCapability; pass that pair unchanged to planning. Only PARTIAL_GUIDE_FOUND or GUIDE_NOT_FOUND returns a same-session, same-turn fallbackToken for def_data_operator_build_profile. This tool never searches the equipment catalog or mutates configuration.',
  args: {
    operatorQuery: tool.schema.string().min(1).max(160).describe('Exact operator name or stable id, for example 别礼 or bieli.'),
    goal: tool.schema.string().min(1).max(160).optional().describe('Build goal in the user wording; defaults to damage.'),
    setQuery: tool.schema.string().min(1).max(160).optional().describe('Optional user-required equipment set, for example 潮涌.'),
  },
  async execute(args, context) {
    context.metadata({ title: 'DEF operator build guide discovery' })
    const { turnID } = getDefOperatorConfigTurnIdentity(context)
    const result = await callDefTool('def.operator.build.guide', {
      operatorQuery: args.operatorQuery.trim(),
      goal: typeof args.goal === 'string' && args.goal.trim() ? args.goal.trim() : 'damage',
      ...(typeof args.setQuery === 'string' && args.setQuery.trim() ? { setQuery: args.setQuery.trim() } : {}),
      __defTurnId: turnID,
    }, context)
    return {
      title: result.state === 'GUIDE_FOUND' ? 'DEF operator build guide found' : 'DEF operator build fallback authorized',
      output: JSON.stringify(result, null, 2),
      metadata: {
        family: 'def-data-resource',
        contract: result.contract,
        state: result.state,
        operatorId: result.operator?.id,
        fallbackAuthorized: typeof result.fallbackToken === 'string' && result.fallbackToken.length > 0,
        readOnly: true,
      },
    }
  },
}

export const data_operator_build_profile = {
  description: 'Token-gated fallback after def_data_operator_build_guide returns PARTIAL_GUIDE_FOUND or GUIDE_NOT_FOUND. For a support-role operator, first call def_data_combat_conventions and pass its exact conventionBundleHash; the profile then excludes unsupported personal-damage assumptions and uses reviewed utility conditions. After PROFILE_READY, call def_data_weapon_fit_plan directly—do not supplement with generic skill/operator, native catalog materialization, weapon summaries, or loadout candidates. If evidence is incomplete, no capability is issued and planning must stop. Never call this after GUIDE_FOUND or invent a token.',
  args: {
    operatorQuery: tool.schema.string().min(1).max(160).describe('The same exact operator name or stable id used for guide discovery.'),
    fallbackToken: tool.schema.string().min(20).max(160).describe('Exact opaque fallbackToken returned by guide discovery in this user turn.'),
    conventionBundleHash: tool.schema.string().min(64).max(64).optional().describe('Exact bundleHash from def_data_combat_conventions; required when guide discovery marks combat conventions required.'),
  },
  async execute(args, context) {
    context.metadata({ title: 'DEF operator build fallback profile' })
    const { turnID } = getDefOperatorConfigTurnIdentity(context)
    const result = await callDefTool('def.operator.build.profile', {
      operatorQuery: args.operatorQuery.trim(),
      fallbackToken: args.fallbackToken.trim(),
      ...(typeof args.conventionBundleHash === 'string' && args.conventionBundleHash.trim()
        ? { conventionBundleHash: args.conventionBundleHash.trim() }
        : {}),
      __defTurnId: turnID,
    }, context)
    return {
      title: result.state === 'PROFILE_READY' ? 'DEF operator build profile ready' : 'DEF operator build profile incomplete',
      output: JSON.stringify(result, null, 2),
      metadata: {
        family: 'def-data-resource',
        contract: result.contract,
        state: result.state,
        operatorId: result.character?.id,
        readOnly: true,
      },
    }
  },
}

export const data_combat_conventions = dataResource({
  title: 'DEF combat convention rule bundle',
  contract: 'DefCombatConventionBundleV1',
  preserveContract: true,
  description: 'Resolve reviewed teacher-curated condition rules for trigger analysis, rotation, support builds, or operator/weapon fit. This is a separate branch from source-faithful guide search. It returns connected ruleIds, qualitative certainty, profile preferences, missingEdges/conflicts, and one stable bundleHash. Combine it only with current typed catalog facts; never turn high/low probability into an invented percentage.',
  tool: 'def.knowledge.combat_conventions.resolve',
  args: {
    entities: tool.schema.array(tool.schema.string().min(1).max(160)).min(1).max(16).describe('Stable ids and/or exact entity names, for example saixi, 赛希, 骑士精神.'),
    intent: tool.schema.enum(['operator-fit', 'weapon-fit', 'support-build', 'rotation', 'trigger-analysis']).describe('The current reasoning intent.'),
    terms: tool.schema.array(tool.schema.string().min(1).max(160)).max(16).optional().describe('Optional user terms that narrow the rule bundle.'),
  },
  input: ({ entities, intent, terms }) => ({
    entities: entities.map((value) => value.trim()),
    intents: [intent],
    ...(Array.isArray(terms) && terms.length ? { terms: terms.map((value) => value.trim()) } : {}),
  }),
})

export const data_game_knowledge = dataResource({
  title: 'DEF game knowledge reference search',
  contract: 'DefGameKnowledgeReferenceSearchV1',
  description: 'Search only allowlisted game-knowledge Markdown references. Returns stable referenceId and heading/section indexes; follow with def_data_game_knowledge_section for the exact continuous section. Never use arbitrary filesystem reads.',
  tool: 'def.knowledge.game.search',
  input: ({ query }) => ({ query, limit: 3 }),
})

export const data_game_knowledge_section = dataResource({
  title: 'DEF game knowledge exact section',
  contract: 'DefGameKnowledgeSectionReadV1',
  preserveContract: true,
  description: 'Read one continuous, bounded Markdown section by the exact allowlisted referenceId plus sectionId returned from def_data_game_knowledge. The result includes truncation, nextSection cursor facts, and the reference heading index.',
  tool: 'def.knowledge.game.section.read',
  args: {
    referenceId: tool.schema.string().min(1).max(280).describe('Exact referenceId returned by def_data_game_knowledge.'),
    sectionId: tool.schema.string().min(1).max(160).describe('Exact sectionId returned by def_data_game_knowledge.'),
    cursor: tool.schema.number().int().min(0).max(1_000_000).optional().describe('Only use the returned nextSection.cursor when the prior section response was truncated.'),
  },
  input: ({ referenceId, sectionId, cursor }) => ({
    referenceId: referenceId.trim(),
    sectionId: sectionId.trim(),
    ...(cursor !== undefined ? { cursor } : {}),
  }),
})

export const data_team_loadout_plan = dataResource({
  title: 'DEF guide loadout plan',
  contract: 'DefTeamLoadoutPlanV1',
  preserveContract: true,
  description: 'Resolve the most recently exact-read named-guide section in this native session into one immutable team loadout plan. It uses the same product libraries as mutation, returns exact ids, 3+1 constraints, deviations and computed derived totals. Never use per-item catalog calls; do not apply.',
  tool: 'def.team.loadout.plan.prepare',
  args: {},
  input: () => ({}),
})

export const team_loadout_plan_revise = {
  description: 'Confirm only returned guide-plan decisionId/optionId pairs and produce a new immutable plan hash. This never applies configuration or requests permission.',
  args: {
    planHash: tool.schema.string().min(32).max(128),
    choices: tool.schema.array(tool.schema.object({
      decisionId: tool.schema.string().min(1).max(160),
      optionId: tool.schema.string().min(1).max(160),
    })).min(1).max(8),
  },
  async execute(args, context) {
    const result = await callDefTool('def.team.loadout.plan.revise', args, context)
    return { title: result.state === 'READY' ? 'DEF team loadout plan ready' : 'DEF team loadout plan requires confirmation', output: JSON.stringify(result, null, 2), metadata: { family: 'def-team-loadout-plan', state: result.state, planHash: result.planHash } }
  },
}

export const team_loadout_plan_apply = {
  description: 'Prepare one complete Agent-named horizontal team-configuration branch C from current checkout P, request one native approval for the exact P-to-C diff, then atomically apply C and move checkout once. Rejection discards the uncommitted candidate; partial team application is never a normal result.',
  args: {
    planHash: tool.schema.string().min(32).max(128),
    nodeTitle: tool.schema.string().min(2).max(32).describe('Agent-written concise Chinese title for this team configuration branch.'),
    nodeDescription: tool.schema.string().min(8).max(160).describe('Agent-written one-sentence description of the reviewed team configuration change.'),
  },
  async execute(args, context) {
    const pending = await callDefTool('def.team.loadout.plan.apply.reconcile', { planHash: args.planHash }, context)
    if (pending.state !== 'NOT_PENDING') {
      const outcome = pending.reconciliation || pending
      return {
        title: outcome.state === 'ROLLED_BACK' ? 'DEF delayed team command rolled back' : 'DEF team loadout plan requires reconciliation',
        output: JSON.stringify(outcome, null, 2),
        metadata: { family: 'def-team-loadout-plan', state: outcome.state, candidateNodeId: outcome.nodeId || null, postcondition: outcome.postcondition?.pass === true },
      }
    }
    const prepared = await callDefTool('def.team.loadout.plan.apply.prepare', {
      planHash: args.planHash,
      nodeTitle: args.nodeTitle,
      nodeDescription: args.nodeDescription,
    }, context)
    if (prepared.state !== 'READY') {
      return { title: 'DEF team loadout plan requires confirmation', output: JSON.stringify(prepared, null, 2), metadata: { family: 'def-team-loadout-plan', state: prepared.state } }
    }
    const candidateIdentity = {
      candidateNodeId: prepared.candidateNodeId,
      candidateRevision: prepared.candidateRevision,
      candidateWorkingHash: prepared.candidateWorkingHash,
      parentNodeId: prepared.parentNodeId,
      parentRevision: prepared.parentRevision,
      parentWorkingHash: prepared.parentWorkingHash,
      sessionBindingId: prepared.sessionBindingId,
    }
    try {
      const approval = await askWithApproval(context, {
        action: 'Apply one reviewed atomic team candidate',
        summary: `${prepared.nodeTitle || args.nodeTitle}：${prepared.nodeDescription || args.nodeDescription}`,
        permission: 'def_team_loadout_plan_apply',
        nodeId: prepared.candidateNodeId,
        revision: prepared.candidateRevision,
        workingHash: prepared.candidateWorkingHash,
        timelineId: prepared.timelineId,
        axisBindingId: prepared.axisBindingId,
        sessionBindingId: prepared.sessionBindingId,
        parentNodeId: prepared.parentNodeId,
        parentRevision: prepared.parentRevision,
        candidateNodeId: prepared.candidateNodeId,
        candidateRevision: prepared.candidateRevision,
        planId: prepared.planId,
        planHash: prepared.planHash,
        patterns: prepared.approvalPatterns || [prepared.planHash, prepared.candidateWorkingHash],
        diff: prepared.approvalDiff,
        riskFlags: [{ severity: 'warning', code: 'team-loadout-mutation', message: 'Applies one complete reviewed team candidate.' }],
        consequence: 'The complete candidate is applied once only if its parent, candidate, and workspace identities still match.',
      })
      candidateIdentity.approvalCapability = approval.approvalCapability
    } catch (error) {
      await callDefTool('def.team.loadout.plan.apply.discard', {
        planHash: prepared.planHash,
        ...candidateIdentity,
      }, context).catch(() => {})
      throw error
    }
    const result = await callDefTool('def.team.loadout.plan.apply', {
      planHash: prepared.planHash,
      ...candidateIdentity,
    }, context)
    return { title: result.state === 'APPLIED' ? 'DEF team loadout plan applied' : 'DEF team loadout plan requires reconciliation', output: JSON.stringify(result, null, 2), metadata: { family: 'def-team-loadout-plan', state: result.state, candidateNodeId: prepared.candidateNodeId, postcondition: result.postcondition?.pass === true } }
  },
}

export const data_weapon = dataResource({
  title: 'DEF weapon resource',
  description: 'Search the same complete read-only weapon library shown by Operator Configuration. Use queries for several names in one call. Ranked phonetic/fuzzy candidates expose matchMethod and confidence; confirm ambiguous fuzzy matches instead of retrying shorter fragments.',
  tool: 'def.weapon.resolve',
  args: {
    query: tool.schema.string().max(160).optional().describe('One complete weapon name, id, type, or ASR text.'),
    queries: tool.schema.array(tool.schema.string().min(1).max(160)).min(1).max(8).optional()
      .describe('Several complete weapon names or ASR texts to resolve together; prefer this over repeated fragment searches.'),
  },
  input: ({ query, queries }) => Array.isArray(queries) && queries.length
    ? { queries, limitPerQuery: 5 }
    : { query: query || '', limit: 12 },
})

function compactEquipmentResourceCandidate(item) {
  return {
    kind: item.kind,
    scope: item.scope,
    source: item.source,
    characterName: item.characterName,
    slotKey: item.slotKey,
    equipmentId: item.equipmentId,
    gearSetId: item.gearSetId,
    gearSetName: item.gearSetName,
    name: item.name,
    part: item.part,
    summary: item.summary,
    matchMethod: item.matchMethod,
    confidence: item.confidence,
    equipmentCount: item.equipmentCount,
    equipmentListExhaustive: item.equipmentListExhaustive,
    equipmentListTruncated: item.equipmentListTruncated,
    effectLabels: item.effectLabels,
    fixedStat: item.fixedStat,
    effects: item.effects,
    effectsExhaustive: item.effectsExhaustive,
    currentSelections: item.currentSelections,
    equipments: Array.isArray(item.equipments) ? item.equipments.slice(0, 12).map((equipment) => ({
      id: equipment.id,
      name: equipment.name,
      part: equipment.part,
      fixedStat: equipment.fixedStat,
      effects: equipment.effects,
      effectsExhaustive: equipment.effectsExhaustive,
    })) : undefined,
    threePieceBuffs: Array.isArray(item.threePieceBuffs) ? item.threePieceBuffs.slice(0, 4).map((buff) => ({
      id: buff.id,
      name: buff.name,
      typeKey: buff.typeKey,
      value: buff.value,
    })) : undefined,
  }
}

function transformEquipmentResolution(result) {
  const transformOne = (resolution) => ({
    contract: resolution.contract,
    scope: resolution.scope,
    source: resolution.source,
    query: resolution.query,
    catalogCount: resolution.catalogCount,
    gearSetCount: resolution.gearSetCount,
    count: resolution.count,
    ambiguity: resolution.ambiguity,
    exhaustive: resolution.exhaustive,
    truncated: resolution.truncated,
    suggestedQuestion: resolution.suggestedQuestion,
    candidates: Array.isArray(resolution.candidates)
      ? resolution.candidates.slice(0, 12).map(compactEquipmentResourceCandidate)
      : [],
  })
  if (Array.isArray(result.results)) {
    return {
      contract: result.contract,
      scope: result.scope,
      source: result.source,
      catalogCount: result.catalogCount,
      gearSetCount: result.gearSetCount,
      queryCount: result.queryCount,
      exhaustive: result.exhaustive,
      truncated: result.truncated,
      results: result.results.slice(0, 8).map(transformOne),
    }
  }
  return transformOne(result)
}

export const data_equipment = dataResource({
  title: 'DEF equipment resource',
  description: 'Resolve stable ids from the same complete equipment library as Operator Configuration. Use queries for several full names in one call. Results rank exact, phonetic, and fuzzy matches with honest catalogCount/exhaustive/truncated facts; never infer absence from a displayed subset.',
  tool: 'def.equipment.resolve',
  args: {
    query: tool.schema.string().max(160).optional().describe('One complete equipment or gear-set name, stable id, or ASR text.'),
    queries: tool.schema.array(tool.schema.string().min(1).max(160)).min(1).max(8).optional()
      .describe('Several complete equipment names or ASR texts to resolve together; use this instead of repeated shorter searches.'),
  },
  input: ({ query, queries }) => Array.isArray(queries) && queries.length
    ? { queries, limitPerQuery: 5, catalogOnly: true }
    : { query: query || '', limit: 12, catalogOnly: true },
  transform: transformEquipmentResolution,
})

export const data_native_catalog_materialize = {
  description: 'Materialize one deterministic, read-only equipment or weapon catalog artifact inside this native session. Call once per domain/query turn, then read its manifest and use native grep/read only under the returned retrieval root. This tool never recommends, applies configuration, reads raw local storage, or returns catalog content in its model output.',
  args: {
    domain: tool.schema.enum(['equipment', 'weapon']).describe('Catalog domain to materialize.'),
    query: tool.schema.string().min(1).max(240).describe('The user wording to select an exact entity, deterministic substring records, or an explicit no-match fallback.'),
  },
  async execute(args, context) {
    context.metadata({ title: 'DEF native catalog artifact' })
    const snapshot = await callDefTool('def.native_catalog.materialize', {
      domain: args.domain,
      query: args.query.trim(),
    }, context)
    const artifact = materializeNativeCatalogArtifact(context, snapshot)
    return {
      title: 'DEF native catalog artifact ready',
      output: JSON.stringify({
        contract: artifact.contract,
        artifactId: artifact.artifactId,
        domain: artifact.domain,
        selectionMode: artifact.selectionMode,
        query: artifact.query,
        source: artifact.source,
        root: artifact.root,
        manifestPath: artifact.manifestPath,
        files: artifact.files,
        expiresAt: artifact.expiresAt,
        readOnly: true,
        allowedNativeOperations: ['read', 'grep'],
        reused: artifact.reused,
      }, null, 2),
      metadata: {
        family: 'def-data-resource',
        contract: nativeCatalogArtifactContract,
        domain: artifact.domain,
        selectionMode: artifact.selectionMode,
        artifactId: artifact.artifactId,
        readOnly: true,
      },
    }
  },
}

function readNativeCatalogArtifactForFacts(context, artifactId) {
  const normalizedId = typeof artifactId === 'string' ? artifactId.trim() : ''
  if (!/^catalog-[a-z0-9-]{20,}$/i.test(normalizedId)) {
    throw new Error('native-catalog-artifact-id-required: use the artifactId returned by def_data_native_catalog_materialize')
  }
  cleanupExpiredNativeArtifacts(context)
  const entry = nativeCatalogArtifactsBySession.get(context?.sessionID)?.get(normalizedId)
  if (!entry) throw new Error('native-catalog-artifact-not-found: materialize and read an unexpired artifact in this session first')
  const manifest = readNativeArtifactManifest(entry.root)
  if (!manifest || manifest.contract !== nativeCatalogArtifactContract || manifest.artifactId !== normalizedId || manifest.domain !== 'equipment') {
    throw new Error('native-catalog-artifact-invalid: the supplied artifact is not an intact equipment evidence artifact')
  }
  if (Number(manifest.expiresAt) <= Date.now() || !nativeArtifactFilesMatch(entry.root, manifest)) {
    removeNativeCatalogArtifact(context, normalizedId, entry.root)
    throw new Error('native-catalog-artifact-expired-or-tampered: materialize a fresh equipment artifact and read its manifest')
  }
  return { root: entry.root, manifest }
}

export const data_equipment_3plus1_facts = {
  description: 'After reading an exact native equipment artifact manifest, return a compact complete summary of every physical-slot topology satisfying at least three named-set memberships. Target-set facts are emitted once, large off-set pools are not embedded, and a compatible accessory may legally occupy both accessory slots. This facts tool never ranks or applies equipment.',
  args: {
    artifactId: tool.schema.string().min(20).max(96).describe('artifactId returned by def_data_native_catalog_materialize after its manifest has been read.'),
    setQuery: tool.schema.string().min(1).max(160).describe('One exact equipment set name from that artifact.'),
    characterId: tool.schema.string().min(1).max(160).optional().describe('Optional selected character identity. It is recorded only; it never supplies an unverified attribute preference.'),
  },
  async execute(args, context) {
    context.metadata({ title: 'DEF 3+1 equipment facts' })
    const artifact = readNativeCatalogArtifactForFacts(context, args.artifactId)
    const result = await callDefTool('def.equipment.3plus1.facts', {
      sourceRevision: artifact.manifest.source.revision,
      setQuery: args.setQuery.trim(),
      ...(typeof args.characterId === 'string' && args.characterId.trim() ? { characterId: args.characterId.trim() } : {}),
    }, context)
    if (result?.source?.revision !== artifact.manifest.source.revision) {
      throw new Error('native-catalog-artifact-source-mismatch: the 3+1 facts result is not bound to the manifest revision')
    }
    return {
      title: result.state === 'READY_FOR_CHARACTER_PROFILE' ? 'DEF 3+1 equipment facts ready for profile' : 'DEF 3+1 equipment facts',
      output: JSON.stringify({
        ...result,
        artifact: {
          artifactId: artifact.manifest.artifactId,
          manifestPath: `${retrievalRoot}/${artifact.manifest.artifactId}/manifest.json`,
          root: `${retrievalRoot}/${artifact.manifest.artifactId}`,
          selectionMode: artifact.manifest.selectionMode,
        },
      }, null, 2),
      metadata: {
        family: 'def-data-resource',
        contract: result.contract,
        artifactId: artifact.manifest.artifactId,
        state: result.state,
        readOnly: true,
      },
    }
  },
}

const equipmentPreferenceGroupSchema = tool.schema.object({
  key: tool.schema.string().min(1).max(80).describe('Stable semantic key for this preference group, such as cold-damage.'),
  label: tool.schema.string().min(1).max(80).describe('Human-readable sourced keyword, such as 寒冷伤害.'),
  kind: tool.schema.enum(['primary-attribute', 'secondary-attribute', 'elemental-damage', 'skill-damage', 'general-damage', 'other'])
    .describe('Character-build role of this effect preference. It is never an equipment fixedStat classification.'),
  acceptedTypeKeys: tool.schema.array(tool.schema.string().min(2).max(80)).min(1).max(8)
    .describe('Exact canonical equipment-effect type keys accepted for this group, for example iceDmgBonus and iceElectricDmgBonus.'),
})

export const data_equipment_set_fit_shortlist = {
  description: 'When the user asks which equipment set should anchor a 3+1 build and has not already fixed one exact set, review every set in the current native artifact before choosing. Requires the unchanged same-turn plannerProfile/capability. It requires a typed three-piece effect and a legal minimum-three-slot topology, ranks set-effect fit before piece coverage, returns the evidence for every reviewed set, and never mutates configuration. A typed failure is terminal for this recommendation turn.',
  args: {
    artifactId: tool.schema.string().min(20).max(96).describe('artifactId returned by def_data_native_catalog_materialize after its manifest has been read.'),
    plannerProfileCapability: tool.schema.string().min(20).max(160).describe('Exact opaque same-turn capability returned with the unchanged plannerProfile.'),
    characterProfile: tool.schema.object({
      characterId: tool.schema.string().min(1).max(160),
      derivation: tool.schema.enum(['guide', 'guide-partial', 'skill-analysis', 'guide-and-skill-analysis', 'combat-convention-and-skill-analysis', 'user']),
      evidenceRefs: tool.schema.array(tool.schema.string().min(1).max(240)).min(1).max(32),
      keywords: tool.schema.array(tool.schema.string().min(1).max(80)).min(1).max(12),
      preferenceGroups: tool.schema.array(equipmentPreferenceGroupSchema).min(1).max(12),
    }),
    shortlistLimit: tool.schema.number().int().min(1).max(3).optional(),
  },
  async execute(args, context) {
    context.metadata({ title: 'DEF equipment set fit shortlist' })
    const artifact = readNativeCatalogArtifactForFacts(context, args.artifactId)
    const { turnID } = getDefOperatorConfigTurnIdentity(context)
    const result = await callDefTool('def.equipment.set_fit.shortlist', {
      sourceRevision: artifact.manifest.source.revision,
      plannerProfileCapability: args.plannerProfileCapability.trim(),
      characterProfile: args.characterProfile,
      __defTurnId: turnID,
      ...(args.shortlistLimit !== undefined ? { shortlistLimit: args.shortlistLimit } : {}),
    }, context)
    if (result?.source?.revision !== artifact.manifest.source.revision) {
      throw new Error('native-catalog-artifact-source-mismatch: the set shortlist is not bound to the manifest revision')
    }
    return {
      title: result.state === 'READY' ? 'DEF equipment set shortlist ready' : 'DEF equipment set shortlist unresolved',
      output: JSON.stringify({
        ...result,
        artifact: {
          artifactId: artifact.manifest.artifactId,
          manifestPath: `${retrievalRoot}/${artifact.manifest.artifactId}/manifest.json`,
          selectionMode: artifact.manifest.selectionMode,
        },
      }),
      metadata: {
        family: 'def-data-resource',
        contract: result.contract,
        state: result.state,
        shortlistCount: Array.isArray(result.shortlist) ? result.shortlist.length : 0,
        readOnly: true,
      },
    }
  },
}

export const data_weapon_fit_plan = {
  description: 'Exhaustively compare every current-catalog weapon compatible with one exact operator. Always requires the unchanged same-turn plannerProfile/plannerProfileCapability. Supply conventionBundleHash only when guide/profile evidenceRequirements says combat conventions are required; omit it when GUIDE_FOUND says not-required. For support roles it excludes unsupported personal-damage defaults and verifies reviewed trigger reachability. It returns an unordered READY_WITH_TRADEOFFS matrix: do not label candidates first/second, score them against one another, or claim a universal optimum. A typed failure is terminal for this turn: report its nextAction and never fall back to def_data_weapon, loadout candidates, skill/damage/buff probes, or native artifact ranking.',
  args: {
    operatorQuery: tool.schema.string().min(1).max(160).describe('Exact operator name or stable id used by guide/profile discovery.'),
    conventionBundleHash: tool.schema.string().min(64).max(64).optional().describe('Exact bundleHash returned by def_data_combat_conventions, only when the issued profile capability requires reviewed conventions.'),
    plannerProfileCapability: tool.schema.string().min(20).max(160).describe('Exact opaque same-turn capability returned with the unchanged plannerProfile.'),
    characterProfile: tool.schema.object({
      characterId: tool.schema.string().min(1).max(160),
      derivation: tool.schema.enum(['guide', 'guide-partial', 'skill-analysis', 'guide-and-skill-analysis', 'combat-convention-and-skill-analysis', 'user']),
      evidenceRefs: tool.schema.array(tool.schema.string().min(1).max(240)).min(1).max(32),
      keywords: tool.schema.array(tool.schema.string().min(1).max(80)).min(1).max(12),
      preferenceGroups: tool.schema.array(equipmentPreferenceGroupSchema).min(1).max(12),
    }),
    goal: tool.schema.string().min(1).max(160).optional(),
    shortlistLimit: tool.schema.number().int().min(1).max(3).optional(),
  },
  async execute(args, context) {
    context.metadata({ title: 'DEF exhaustive weapon fit plan' })
    const { turnID } = getDefOperatorConfigTurnIdentity(context)
    const result = await callDefTool('def.weapon.fit.plan', {
      operatorQuery: args.operatorQuery.trim(),
      ...(typeof args.conventionBundleHash === 'string' && args.conventionBundleHash.trim()
        ? { conventionBundleHash: args.conventionBundleHash.trim() }
        : {}),
      plannerProfileCapability: args.plannerProfileCapability.trim(),
      characterProfile: args.characterProfile,
      goal: typeof args.goal === 'string' && args.goal.trim() ? args.goal.trim() : '武器推荐',
      ...(args.shortlistLimit !== undefined ? { shortlistLimit: args.shortlistLimit } : {}),
      __defTurnId: turnID,
    }, context)
    return {
      title: 'DEF weapon fit tradeoffs ready',
      output: JSON.stringify(result, null, 2),
      metadata: {
        family: 'def-data-resource',
        contract: result.contract,
        state: result.state,
        operatorId: result.operator?.id,
        compatibleCount: result.catalogEvidence?.compatibleCount,
        readOnly: true,
      },
    }
  },
}

export const data_equipment_3plus1_plan = {
  description: 'Build one bounded read-only 3+1 shortlist from the same session artifact and the unchanged plannerProfile issued by def_data_operator_build_guide or def_data_operator_build_profile. The exact same-turn plannerProfileCapability is mandatory and prevents model-edited evidence. Primary/secondary attributes are character effect priorities and are never matched against equipment fixedStat. The planner exhaustively checks at least three named-set memberships, all four physical slots, and optional duplicate compatible accessories, then returns exact ids plus per-piece matchKeys/count/rankingBasis/missing/ambiguity. It never invents a character profile, simulates damage, previews mutation, or applies equipment.',
  args: {
    artifactId: tool.schema.string().min(20).max(96).describe('artifactId returned by def_data_native_catalog_materialize after its manifest has been read.'),
    setQuery: tool.schema.string().min(1).max(160).describe('One exact named equipment set from that artifact.'),
    plannerProfileCapability: tool.schema.string().min(20).max(160).describe('Exact opaque same-turn capability returned with the unchanged plannerProfile by guide discovery or authorized fallback.'),
    characterProfile: tool.schema.object({
      characterId: tool.schema.string().min(1).max(160).describe('Exact operator id whose sourced profile is being used.'),
      derivation: tool.schema.enum(['guide', 'guide-partial', 'skill-analysis', 'guide-and-skill-analysis', 'combat-convention-and-skill-analysis', 'user'])
        .describe('Where the caller obtained this profile. The planner does not create or verify the underlying guide/skill reasoning.'),
      evidenceRefs: tool.schema.array(tool.schema.string().min(1).max(240)).min(1).max(8)
        .describe('Stable tool/reference facts supporting this profile.'),
      keywords: tool.schema.array(tool.schema.string().min(1).max(80)).min(1).max(12)
        .describe('Human-readable ordered build keywords, such as 力量、意志、寒冷、终结技、所有技能.'),
      preferenceTypeKeys: tool.schema.array(tool.schema.string().min(2).max(80)).min(1).max(12).optional()
        .describe('Simple ordered canonical effect type keys. Use this or preferenceGroups, never both.'),
      preferenceGroups: tool.schema.array(equipmentPreferenceGroupSchema).min(1).max(12).optional()
        .describe('Ordered semantic groups with accepted canonical effect type keys. Use for families such as iceDmgBonus/iceElectricDmgBonus.'),
    }),
    minimumSetPieces: tool.schema.number().int().min(3).max(4).optional().describe('Minimum named-set memberships across four physical slots; defaults to 3.'),
    minimumMatchesPerPiece: tool.schema.number().int().min(2).max(12).optional().describe('Minimum declared preference groups each selected piece should match; defaults to 2 and cannot be weakened below the two-key acceptable threshold.'),
    allowDuplicateCompatibleAccessories: tool.schema.boolean().optional().describe('Allow one stable accessory id in both compatible accessory slots; defaults to true.'),
    shortlistLimit: tool.schema.number().int().min(1).max(3).optional().describe('One best plan plus at most two close alternatives; defaults to and never exceeds 3.'),
  },
  async execute(args, context) {
    context.metadata({ title: 'DEF 3+1 equipment plan' })
    const artifact = readNativeCatalogArtifactForFacts(context, args.artifactId)
    const { turnID } = getDefOperatorConfigTurnIdentity(context)
    const result = await callDefTool('def.equipment.3plus1.plan', {
      sourceRevision: artifact.manifest.source.revision,
      setQuery: args.setQuery.trim(),
      characterProfile: args.characterProfile,
      plannerProfileCapability: args.plannerProfileCapability.trim(),
      __defTurnId: turnID,
      ...(args.minimumSetPieces !== undefined ? { minimumSetPieces: args.minimumSetPieces } : {}),
      ...(args.minimumMatchesPerPiece !== undefined ? { minimumMatchesPerPiece: args.minimumMatchesPerPiece } : {}),
      ...(args.allowDuplicateCompatibleAccessories !== undefined ? { allowDuplicateCompatibleAccessories: args.allowDuplicateCompatibleAccessories } : {}),
      ...(args.shortlistLimit !== undefined ? { shortlistLimit: args.shortlistLimit } : {}),
    }, context)
    if (result?.source?.revision !== artifact.manifest.source.revision) {
      throw new Error('native-catalog-artifact-source-mismatch: the 3+1 plan result is not bound to the manifest revision')
    }
    return {
      title: result.state === 'READY' ? 'DEF 3+1 equipment shortlist ready' : 'DEF 3+1 equipment shortlist has unresolved facts',
      output: JSON.stringify({
        ...result,
        artifact: {
          artifactId: artifact.manifest.artifactId,
          manifestPath: `${retrievalRoot}/${artifact.manifest.artifactId}/manifest.json`,
          selectionMode: artifact.manifest.selectionMode,
        },
      }),
      metadata: {
        family: 'def-data-resource',
        contract: result.contract,
        artifactId: artifact.manifest.artifactId,
        state: result.state,
        shortlistCount: Array.isArray(result.shortlist) ? result.shortlist.length : 0,
        readOnly: true,
      },
    }
  },
}

export const data_skill = dataResource({
  title: 'DEF skill resource',
  description: 'Resolve trusted selected-operator skill facts by exact operator plus skill id/name, or by semantic query. Exact matches include complete per-hit element, damage skillType and level multipliers from the operator catalog. A parent Q skill may contain a water-tornado hit classified as B damage; per-hit skillType is authoritative. Canonical terms are A=normal/heavy attack, B=battle skill, E=chain skill, Q=ultimate; a heavy attack never means execution or plunging attack.',
  tool: 'def.skill.resolve',
  args: {
    query: tool.schema.string().min(1).max(200).describe('Exact skill id/display name or one semantic skill query.'),
    characterQuery: tool.schema.string().min(1).max(160).optional().describe('Exact selected operator name or stable id used to scope the skill identity.'),
  },
  input: ({ query, characterQuery }) => ({
    query,
    ...(typeof characterQuery === 'string' && characterQuery.trim() ? { characterQuery: characterQuery.trim() } : {}),
    limit: 12,
  }),
  contract: 'DefSkillResolutionV2',
  preserveContract: true,
})

export const data_buff = dataResource({
  title: 'DEF Buff resource',
  description: 'Resolve trusted DEF Buff candidates by id, name, or query.',
  tool: 'def.buff.resolve',
  input: ({ query }) => ({ query, limit: 12 }),
})

export const data_damage = dataResource({
  title: 'DEF damage resource',
  description: 'Read the trusted current DEF damage report.',
  tool: 'def.workbench.damage_report',
  input: () => ({}),
  transform: (result) => ({
    snapshotUpdatedAt: result.snapshotUpdatedAt,
    damageReport: result.damageReport ? {
      generatedAt: result.damageReport.generatedAt,
      buttonCount: result.damageReport.buttonCount,
      totalExpected: result.damageReport.totalExpected,
      totalNonCrit: result.damageReport.totalNonCrit,
      buttons: Array.isArray(result.damageReport.buttons)
        ? result.damageReport.buttons.slice(0, 20).map((button) => ({
          id: button.id,
          label: button.label,
          characterName: button.characterName,
          skillName: button.skillName,
          skillType: button.skillType,
          expected: button.expected,
          damage: button.damage,
        }))
        : [],
    } : null,
  }),
})

export const operator_config_patch = {
  description: 'Apply one complete operator configuration only after def_operator_config_preview returned an unchanged proposalToken in an earlier user turn and the current user explicitly asks to apply it. A correction, suitability comparison, question, changed slot, candidate, or priority does not by itself revoke the token on the server, but the Agent must discard it, never reuse it, and compute a fresh preview. The tool creates one Agent-named horizontal branch, requests native approval, then atomically applies and verifies it. Put all named equipment pieces in equipments and call this tool once; never split one reviewed loadout into one mutation per slot. If this tool errors, it must be the final tool call of the turn: immediately report only the actual typed failure and its structured nextAction, with no context/bind/materialize/read/edit call and no retry unless the error explicitly provides retryable=true plus a concrete safe nextAction. If it reports def-tool-mutation-not-attempted, that later mutation never reached the backend; do not describe it as another failure.',
  args: {
    // These must be actual optional Zod fields.  The legacy JSON-schema
    // adapter marks every property required, which coerced a model that was
    // asked to omit levels into inventing 1/1/1 and Lv0 values.
    nodeTitle: tool.schema.string().min(2).max(32).describe('Agent-written concise Chinese title for this exact configuration change; no [ai] prefix, ids, timestamps, or generic fixed format.'),
    nodeDescription: tool.schema.string().min(8).max(160).describe('Agent-written one-sentence description of what changes and what remains in scope.'),
    characterId: tool.schema.string().optional().describe('Selected operator id.'),
    characterName: tool.schema.string().optional().describe('Selected operator name when id is unavailable.'),
    weaponName: tool.schema.string().optional().describe('Exact weapon name from DEF weapon resource.'),
    weaponLevel: tool.schema.number().int().min(1).max(90).optional().describe('Weapon level. Omit to use the product default Lv90 for a newly selected weapon.'),
    weaponSkill1Level: tool.schema.number().int().min(1).max(9).optional().describe('Weapon skill 1 level. Omit to use product default 9.'),
    weaponSkill2Level: tool.schema.number().int().min(1).max(9).optional().describe('Weapon skill 2 level. Omit to use product default 9.'),
    weaponSkill3Level: tool.schema.number().int().min(1).max(4).optional().describe('Weapon skill 3 base level before the existing potential bonus. Omit to use product default 4.'),
    weaponPotential: tool.schema.enum(['P0', 'PMAX']).optional().describe('Optional weapon potential.'),
    gearSetName: tool.schema.string().optional().describe('Exact equipment set name from DEF equipment resource.'),
    gearSetId: tool.schema.string().optional().describe('Exact equipment set id from DEF equipment resource.'),
    equipmentName: tool.schema.string().optional().describe('Exact single equipment name from DEF equipment resource.'),
    equipmentId: tool.schema.string().optional().describe('Exact single equipment id from DEF equipment resource.'),
    slotKey: tool.schema.enum(['armor', 'accessory2', 'accessory1', 'glove']).optional().describe('Slot for one equipment piece.'),
    fillSlots: tool.schema.boolean().optional().describe('Fill all four slots from the named gear set.'),
    equipmentEntryLevel: tool.schema.number().int().min(0).max(3).optional().describe('Default level for every real entry on newly selected equipment. Omit to use product default Lv3; explicit 0 is preserved.'),
    equipmentEntry1Level: tool.schema.number().int().min(0).max(3).optional().describe('Level for the first actual equipment entry.'),
    equipmentEntry2Level: tool.schema.number().int().min(0).max(3).optional().describe('Level for the second actual equipment entry.'),
    equipmentEntry3Level: tool.schema.number().int().min(0).max(3).optional().describe('Level for the third actual equipment entry.'),
    equipments: tool.schema.array(tool.schema.object({
      equipmentId: tool.schema.string().min(1).max(180).describe('Exact stable equipment id returned by the equipment resolver.'),
      equipmentName: tool.schema.string().min(1).max(180).optional().describe('Exact catalog name, used only as an approval display aid.'),
      slotKey: tool.schema.enum(['armor', 'accessory2', 'accessory1', 'glove']).describe('Exact target slot for this piece.'),
      equipmentEntryLevel: tool.schema.number().int().min(0).max(3).optional().describe('Default level for every real entry on this piece; omit for Lv3.'),
      equipmentEntry1Level: tool.schema.number().int().min(0).max(3).optional(),
      equipmentEntry2Level: tool.schema.number().int().min(0).max(3).optional(),
      equipmentEntry3Level: tool.schema.number().int().min(0).max(3).optional(),
    })).min(1).max(4).optional().describe('The complete reviewed equipment selection. Use one item per target slot and submit all pieces in this single mutation.'),
    operatorSkillA: tool.schema.enum(['L9', 'M3']).optional().describe('Operator A skill level.'),
    operatorSkillB: tool.schema.enum(['L9', 'M3']).optional().describe('Operator B skill level.'),
    operatorSkillE: tool.schema.enum(['L9', 'M3']).optional().describe('Operator E skill level.'),
    operatorSkillQ: tool.schema.enum(['L9', 'M3']).optional().describe('Operator Q skill level.'),
    proposalToken: tool.schema.string().min(20).max(96).optional().describe('Required only for def_operator_config_patch: unchanged proposalToken returned by def_operator_config_preview in an earlier user turn for this exact configuration.'),
  },
  async execute(args, context) {
    const result = await executeDefOperatorConfigAtomic(args, context, {
      callDefTool,
      askWithApproval,
      formatApprovalPatterns: formatOperatorConfigApprovalPatterns,
      getOperatorConfigTurnIdentity: getDefOperatorConfigTurnIdentity,
    })
    return {
      title: 'DEF operator configuration applied',
      output: JSON.stringify(result, null, 2),
      metadata: { family: 'def-operator-config', currentCheckoutTouched: result.ok === true, postcondition: result.postcondition?.pass === true },
    }
  },
}

export const operator_config_preview = {
  description: 'Compute and verify one exact operator weapon/equipment proposal without creating a Work Node, requesting approval, or applying a change. Return a short-lived proposalToken. Show the verified result and wait for a later explicit user application instruction. After a correction or suitability comparison changes the reviewed proposal, the Agent must discard the prior token, never reuse it, and compute a fresh preview; do not claim server-side revocation.',
  args: operator_config_patch.args,
  async execute(args, context) {
    const result = await executeDefOperatorConfigPreview(args, context, { callDefTool, getOperatorConfigTurnIdentity: getDefOperatorConfigTurnIdentity })
    return {
      title: 'DEF operator configuration preview',
      output: JSON.stringify(result, null, 2),
      metadata: { family: 'def-operator-config-preview', readOnly: true, currentCheckoutTouched: false },
    }
  },
}
