import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
// DEF tools are loaded from this repository rather than a package workspace.
// Resolve the vendored OpenCode plugin API explicitly so Bun does not look for
// a nonexistent repo-root @opencode-ai/plugin installation. This is a local
// workspace package, so the file URL must include the exported TypeScript
// entrypoint; bare package subpaths are not resolved from this repository.
import { tool } from '../../../vendor/opencode/node_modules/@opencode-ai/plugin/src/tool.ts'
import { decodeDefNodePayload, hashDefNodeValue } from '../../def-node-workspace/codec.mjs'
import { executeDefOperatorConfigAtomic } from './operator-config-input.mjs'

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
const defToolFailureBudget = new Map()
const defToolTurnMutationStops = new Map()
const activeDefToolTurns = new Map()
const NON_RETRYABLE_MUTATION_CODES = new Set([
  'operator-config-timeline-invariant-failed',
  'prepared-capability-invalid',
  'prepared-capability-session-mismatch',
  'prepared-capability-consumed',
  'approval-capability-required',
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
}

function stableToolInput(value) {
  if (Array.isArray(value)) return value.map(stableToolInput)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['__defSessionId', 'waitMs', 'snapshotWaitMs'].includes(key))
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
  return /(?:operator[_.]config|worknode[_.](?:sync|create|delete|checkout|restore)|node_(?:sync|fork|use|restore)|team[_.]loadout[_.]plan[_.]apply)/i.test(String(toolName || ''))
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

function compactTypedFailureDetails(failure) {
  if (!failure || typeof failure !== 'object') return null
  const diagnostics = failure.diagnostics
  if (!diagnostics || typeof diagnostics !== 'object') {
    return failure.nextAction || failure.retryable !== undefined
      ? { retryable: failure.retryable, nextAction: failure.nextAction }
      : null
  }
  const compactIssues = (issues) => (Array.isArray(issues) ? issues.slice(0, 8).map((issue) => ({ code: issue?.code, path: issue?.path, message: issue?.message })) : [])
  return {
    retryable: failure.retryable,
    nextAction: failure.nextAction,
    stage: diagnostics.stage,
    beforeCanonicalHash: diagnostics.beforeCanonicalHash,
    afterCanonicalHash: diagnostics.afterCanonicalHash,
    changedPaths: Array.isArray(diagnostics.changedPaths) ? diagnostics.changedPaths.slice(0, 24) : [],
    validatorIssues: {
      before: compactIssues(diagnostics.validatorIssues?.before),
      after: compactIssues(diagnostics.validatorIssues?.after),
    },
    catalogIssues: compactIssues(diagnostics.catalogIssues),
  }
}

export function recordDefToolEventFailure(event) {
  if (event?.type !== 'message.part.updated') return
  const part = event?.properties?.part
  if (part?.type !== 'tool' || part?.state?.status !== 'error') return
  const code = normalizeToolFailureCode(part.state.error)
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
}

export function assertDefToolTurnNotBlocked(sessionID, toolName) {
  const turnId = activeDefToolTurns.get(sessionID)
  if (!turnId) return
  const scope = `${sessionID}:${turnId}`
  const mutationStop = defToolTurnMutationStops.get(scope)
  if (mutationStop && isDefMutationTool(toolName)) throw notAttemptedMutationError(mutationStop, toolName)
  const budget = retryBudgetBlockedForScope(scope)
  if (!budget?.blocked) return
  const error = new Error(`def-tool-retry-limit-reached: ${budget.tool} failed twice with ${budget.code}. All tool use is stopped for this user turn; report that the requested change was not applied before ${toolName}.`)
  error.code = 'def-tool-retry-limit-reached'
  error.details = { tool: budget.tool, attemptedTool: toolName, originalCode: budget.code, attempts: budget.count }
  throw error
}

async function callDefTool(tool, input = {}, context = null) {
  const failureScope = defToolFailureScope(context)
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
    // `/api/def-tools/call` wraps policy failures in `error`, while successful
    // tool executions use `result`.  Preserve the structured policy contract
    // so a canonical-gate 409 is never misreported to the model as a missing
    // Work Node or an empty team.
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
  if (!fs.existsSync(root)) return
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    // Never recursively clean a caller-supplied path. The only deletable
    // cache entries are artifact ids this bridge itself minted below.
    if (!entry.isDirectory() || !/^catalog-[a-z0-9-]{20,}$/i.test(entry.name)) continue
    const artifactRoot = path.join(root, entry.name)
    const manifest = readNativeArtifactManifest(artifactRoot)
    if (!manifest || Number(manifest.expiresAt) <= now) fs.rmSync(artifactRoot, { recursive: true, force: true })
  }
}

function findReusableNativeArtifact(context, snapshot, now = Date.now()) {
  const root = nativeArtifactRoot(context)
  if (!fs.existsSync(root)) return null
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^catalog-[a-z0-9-]{20,}$/i.test(entry.name)) continue
    const artifactRoot = path.join(root, entry.name)
    const manifest = readNativeArtifactManifest(artifactRoot)
    if (!manifest || manifest.contract !== nativeCatalogArtifactContract || Number(manifest.expiresAt) <= now) continue
    if (manifest.domain !== snapshot.domain || manifest.query !== snapshot.query || manifest.source?.revision !== snapshot.source?.revision) continue
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
  if (!Array.isArray(snapshot.files) || snapshot.files.length !== 1) {
    throw new Error('native-catalog-artifact-invalid-snapshot: exactly one catalog data file is required')
  }
  const file = snapshot.files[0]
  nativeArtifactFileName(file?.path)
  if (typeof file?.content !== 'string' || !file.content) {
    throw new Error('native-catalog-artifact-invalid-snapshot: data file content is required')
  }
}

export function materializeNativeCatalogArtifact(context, snapshot, now = Date.now()) {
  validateNativeCatalogSnapshot(snapshot)
  if (!context?.directory || typeof context.directory !== 'string') throw new Error('native-catalog-artifact-session-directory-required')
  const root = nativeArtifactRoot(context)
  fs.mkdirSync(root, { recursive: true })
  cleanupExpiredNativeArtifacts(context, now)
  const reusable = findReusableNativeArtifact(context, snapshot, now)
  if (reusable) {
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
  const file = snapshot.files[0]
  const fileName = nativeArtifactFileName(file.path)
  const contentHash = sha256Text(file.content)
  const expiresAt = now + nativeCatalogArtifactTtlMs
  const manifest = {
    contract: nativeCatalogArtifactContract,
    artifactId,
    domain: snapshot.domain,
    selectionMode: snapshot.selectionMode,
    selectionReason: snapshot.selectionReason || null,
    query: snapshot.query,
    source: snapshot.source,
    files: [{ path: fileName, sha256: contentHash, records: Number(file.records) || 0 }],
    createdAt: now,
    expiresAt,
    readOnly: true,
    nativeAccessRoot: `${retrievalRoot}/${artifactId}`,
  }
  try {
    fs.mkdirSync(temporary, { recursive: false })
    fs.writeFileSync(path.join(temporary, fileName), file.content, 'utf8')
    if (sha256Text(fs.readFileSync(path.join(temporary, fileName), 'utf8')) !== contentHash) {
      throw new Error('native-catalog-artifact-hash-mismatch')
    }
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
    const read = await callDefTool('def.worknode.read', { nodeId, includePayload: true }, context)
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
  args: { nodeId: { type: 'string', description: 'Work Node id to delete.' } },
  async execute(args, context) {
    context.metadata({ title: 'Delete DEF child node' })
    const read = await callDefTool('def.worknode.read', { nodeId: args.nodeId, includePayload: false }, context)
    await askWithApproval(context, {
      action: 'Delete Work Node',
      summary: `Delete DEF Work Node ${args.nodeId}`,
      permission: 'def_node_delete',
      nodeId: args.nodeId,
      revision: read.node?.contentRevision || read.node?.updatedAt,
      consequence: 'The Work Node subtree will be permanently deleted; the current checkout remains protected.',
    })
    const result = await callDefTool('def.worknode.delete', { nodeId: args.nodeId }, context)
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
  description: 'Resolve only the currently selected Workbench operators. Empty results are scoped to the current selection, not the full catalog.',
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
    currentSelections: item.currentSelections,
    equipments: Array.isArray(item.equipments) ? item.equipments.slice(0, 12).map((equipment) => ({
      id: equipment.id,
      name: equipment.name,
      part: equipment.part,
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

export const data_skill = dataResource({
  title: 'DEF skill resource',
  description: 'Resolve trusted DEF skill data by id, name, or semantic query. Canonical terms are A=normal/heavy attack, B=battle skill, E=chain skill, Q=ultimate; a heavy attack never means execution or plunging attack.',
  tool: 'def.skill.resolve',
  input: ({ query }) => ({ query, limit: 12 }),
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
  description: 'Apply one complete, explicitly reviewed operator configuration through one Agent-named horizontal branch, one typed preview, native approval and atomic apply. Write a concise nodeTitle and nodeDescription for the exact change. Put all named equipment pieces in equipments and call this tool once; never split one reviewed loadout into one mutation per slot. If this tool errors, it must be the final tool call of the turn: immediately report only the actual typed failure and its structured nextAction, with no context/bind/materialize/read/edit call and no retry unless the error explicitly provides retryable=true plus a concrete safe nextAction. If it reports def-tool-mutation-not-attempted, that later mutation never reached the backend; do not describe it as another failure.',
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
  },
  async execute(args, context) {
    const result = await executeDefOperatorConfigAtomic(args, context, {
      callDefTool,
      askWithApproval,
      formatApprovalPatterns: formatOperatorConfigApprovalPatterns,
    })
    return {
      title: 'DEF operator configuration applied',
      output: JSON.stringify(result, null, 2),
      metadata: { family: 'def-operator-config', currentCheckoutTouched: result.ok === true, postcondition: result.postcondition?.pass === true },
    }
  },
}
