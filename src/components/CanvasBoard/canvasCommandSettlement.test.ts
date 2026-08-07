import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const sourcePath = fileURLToPath(new URL('./index.tsx', import.meta.url));
const source = fs.readFileSync(sourcePath, 'utf8');
const dispatcherStart = source.indexOf('const processMainWorkbenchCanvasCommand = async');
const dispatcherEnd = source.indexOf('\n  useEffect(', dispatcherStart);

assert.ok(dispatcherStart >= 0, 'Canvas command dispatcher must remain present');
assert.ok(dispatcherEnd > dispatcherStart, 'Canvas command dispatcher boundary must remain detectable');

const dispatcher = source.slice(dispatcherStart, dispatcherEnd);
const supportedListMatch = dispatcher.match(
  /getPendingMainWorkbenchCommands\(\[([\s\S]*?)\]\)\.find/,
);
assert.ok(supportedListMatch, 'dispatcher must declare its supported command list');

const supportedOps = [...supportedListMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
assert.equal(supportedOps.length, 24, 'all 24 Canvas-owned command operations must stay registered');
assert.equal(new Set(supportedOps).size, supportedOps.length, 'supported command operations must be unique');
assert.ok(!supportedOps.includes('queryAgentProductCatalog'), 'catalog reads must be owned by AppContext, not Canvas');
assert.match(
  dispatcher,
  /entry\.command\.intent !== 'selection'/,
  'Canvas must leave selection prepared commands for the AppContext owner',
);

const branchMatches = [...dispatcher.matchAll(/if \(command\.op === '([^']+)'\) \{/g)];
const explicitBranchOps = branchMatches.map((match) => match[1]);
assert.deepEqual(
  explicitBranchOps,
  supportedOps.filter((op) => op !== 'calculateDamage'),
  'every supported operation except the shared damage fallback must keep an explicit branch',
);

const workNodeBoundaryIndex = dispatcher.indexOf('assertAgentWorkNodeCommandTimelineBoundary({');
const firstCommandBranchIndex = dispatcher.indexOf("if (command.op === 'addSkillButton')");
assert.ok(
  workNodeBoundaryIndex >= 0 && workNodeBoundaryIndex < firstCommandBranchIndex,
  'Agent Work Node timeline ownership must be checked once before any command branch can mutate Product state',
);
assert.match(
  dispatcher,
  /phase2ExpectedBinding|entry: commandEntry,[\s\S]*?activeTimelineId,[\s\S]*?readNode:/,
  'the Product boundary must consume the exact Phase 2 binding carried with the queued command',
);
assert.match(
  dispatcher,
  /projectMainWorkbenchWorkNodeListToTimeline\(result, timelineId\)/,
  'Agent Work Node list must project nodes, commits, and heads to the bound current timeline',
);
assert.match(
  dispatcher,
  /deletedCandidateIds\.has\(node\.id\)[\s\S]*?assertMainWorkbenchWorkNodeTimeline\(node, agentWorkNodeTimelineId, command\.op\)/,
  'delete must prove every recursively deleted descendant remains in the bound timeline before writing',
);

branchMatches.forEach((match, index) => {
  const branchStart = match.index ?? 0;
  const branchEnd = index + 1 < branchMatches.length
    ? branchMatches[index + 1].index ?? dispatcher.length
    : dispatcher.indexOf('\n        let timelineSkillButtonIds', branchStart);
  const branchSource = dispatcher.slice(branchStart, branchEnd > branchStart ? branchEnd : dispatcher.length);
  assert.match(
    branchSource,
    /settleCommand\s*\(/,
    `${match[1]} must settle through the shared command result path`,
  );
});

assert.match(
  dispatcher,
  /command\.op === 'calculateDamage' && command\.buttonId[\s\S]*?settleCommand\(\{ status: 'done', result \}\)/,
  'calculateDamage and its shared snapshot fallback must settle through the same path',
);
assert.match(
  dispatcher,
  /catch \(error\) \{[\s\S]*?settleCommand\(\{[\s\S]*?status: 'error'/,
  'thrown command errors must settle through the shared error path',
);

assert.equal(
  (dispatcher.match(/patchMainWorkbenchCommand\s*\(/g) ?? []).length,
  2,
  'the dispatcher may patch directly only for running status and inside settleCommand',
);
assert.equal(
  (dispatcher.match(/pushMainWorkbenchCommandResult\s*\(/g) ?? []).length,
  1,
  'the shared settlement helper must remain the only result push call site',
);

const pumpAnchor = source.indexOf('processMainWorkbenchCanvasCommandRef.current =');
const pumpStart = source.indexOf('\n  useEffect(() => {', pumpAnchor);
const pumpEnd = source.indexOf('\n\n  useEffect(', pumpStart + 1);
assert.ok(pumpAnchor >= 0 && pumpStart > pumpAnchor && pumpEnd > pumpStart, 'AI command pump boundary must remain detectable');
const pump = source.slice(pumpStart, pumpEnd);
assert.match(pump, /processMainWorkbenchCanvasCommandRef\.current\?\./, 'pump must call the latest dispatcher through a ref');
assert.match(pump, /browserAgentRuntime\.cancelCommandPull\(\)/, 'pump cleanup must abort the active Host long-poll');
assert.match(pump, /retryDelay = Math\.min\(retryDelay \* 2, 1000\)/, 'busy/error recovery must use bounded backoff');
assert.match(pump, /\}, \[isAgentMode\]\);/, 'pump must be mounted once per AI lifecycle, not per canvas state change');
assert.doesNotMatch(
  pump,
  /\b(currentView|selectedCharacters|skillButtons|staffCount)\b/,
  'the pump must not restart when the view, roster, button list, or staff count changes',
);
const prepareStart = source.indexOf('const prepareReviewedWorkNodeProposalFromCommand = async');
const applyStart = source.indexOf('const applyReviewedWorkNodeProposalFromCommand = async', prepareStart);
assert.ok(prepareStart >= 0 && applyStart > prepareStart, 'prepared prepare/apply boundaries must remain detectable');
const prepareSource = source.slice(prepareStart, applyStart);
const trustBindIndex = prepareSource.indexOf('bindTrustedTimelineMutation');
const patchApplyIndex = prepareSource.indexOf('applyTimelineWorkNodePatch');
assert.ok(trustBindIndex >= 0, 'prepared prepare must bind model facts to browser-owned facts');
assert.ok(patchApplyIndex > trustBindIndex, 'trusted fact binding must happen before patch application');
assert.match(prepareSource, /skillCatalog:\s*trustedSkillCatalog/, 'prepared prepare must pass the selected roster skill catalog');
assert.match(prepareSource, /candidateBuffs:\s*getCandidateBuffList\(\)/, 'prepared prepare must bind the browser candidate Buff directory');
assert.doesNotMatch(
  prepareSource,
  /addSkillButtonFromWorkbenchCommand|addBuffToButton\(/,
  'prepared prepare must not bypass trust binding through legacy direct skill/Buff writes',
);
const directSkillBranch = dispatcher.indexOf("if (command.op === 'addSkillButton')");
const directBuffBranch = dispatcher.indexOf("if (command.op === 'addBuff')");
const preparedBranch = dispatcher.indexOf("if (command.op === 'prepareReviewedWorkNodeProposal')");
assert.ok(directSkillBranch >= 0 && directBuffBranch >= 0 && preparedBranch > directBuffBranch, 'legacy direct commands and prepared commands must remain distinct dispatcher branches');

assert.match(source, /function buildMainWorkbenchSnapshotSignature\([\s\S]*?candidateBuffs:/, 'snapshot semantic signature must include candidate Buff facts');
assert.match(
  source,
  /getCandidateBuffList\(\)[\s\S]*?projectMainWorkbenchCandidateBuff/,
  'Canvas must project the browser candidate Buff directory without inference',
);
assert.match(source, /candidateBuffs:\s*mirroredCandidateBuffs/, 'published Canvas snapshots must expose candidate Buff facts');
assert.match(source, /previousSnapshot\.candidateBuffs/, 'candidate Buff changes must participate in snapshot deduplication');
assert.match(source, /candidateBuffRevision/, 'candidate Buff refreshes must trigger a fresh snapshot projection');
assert.match(
  source,
  /authoritativeCheckoutContentRevision === null\)[\s\S]*?browserAgentRuntime\.suspendWritableBinding\(\)/,
  'Canvas must revoke an old writable binding whenever the formal checkout revision is unavailable',
);
assert.match(
  source,
  /sameOperatorConfigPayload\(runtimePayload, node\.workingPayload\)[\s\S]*?suspendWritableBinding\(\)/,
  'a newer Work Node revision must not be published until the visible runtime matches its payload',
);
assert.match(
  source,
  /checkout:\s*\{[\s\S]*?contentRevision: nodeRevision,[\s\S]*?updatedAt: checkout\.updatedAt/,
  'node review refreshes must publish the authoritative Work Node revision separately from checkout time',
);
assert.match(source, /candidate\.destination !== 'current-timeline'/, 'unsupported prepared destinations must fail closed in Canvas');
assert.match(source, /candidate\.intent !== 'timeline' && candidate\.intent !== 'buff'/, 'unsupported prepared intents must fail closed in Canvas');
assert.match(source, /parsePreparedRestoreBranchId\(candidate\.proposalId, candidateNode\.branchId\)/, 'apply must re-open restore provenance');
assert.match(source, /restoreTargetRevision !== restoreMetadata\.nodeRevision/, 'apply must CAS-check the restore baseline revision');
assert.match(source, /applyPreparedRestoreScope\([\s\S]*?restoreTarget\.basePayload/, 'apply must rebuild scoped restore from the persisted baseline');

console.log('Canvas command settlement static contract: PASS');
