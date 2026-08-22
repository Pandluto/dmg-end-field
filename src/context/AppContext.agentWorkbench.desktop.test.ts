import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const sourcePath = fileURLToPath(new URL('./AppContext.desktop.tsx', import.meta.url));
const source = fs.readFileSync(sourcePath, 'utf8');

const snapshotStart = source.indexOf('export function buildSelectionWorkbenchSnapshot');
const reducerStart = source.indexOf('/** 所有支持的 Action', snapshotStart);
assert.ok(snapshotStart >= 0 && reducerStart > snapshotStart);
const snapshotSource = source.slice(snapshotStart, reducerStart);
assert.match(snapshotSource, /timelineId: source\.document\.id/);
assert.match(snapshotSource, /activeTimelineId: source\.document\.id/);
assert.match(snapshotSource, /contentRevision: source\.contentRevision/);
assert.match(snapshotSource, /updatedAt: source\.checkoutRef\.updatedAt/);
assert.doesNotMatch(snapshotSource, /contentRevision:\s*source\.checkoutRef\.updatedAt/);
assert.match(snapshotSource, /Object\.values\(source\.payload\.skillButtonTable\)/);
assert.match(snapshotSource, /projectMainWorkbenchButtonState\(\{/);
assert.match(snapshotSource, /getCandidateBuffList\(\)\.map/);
assert.match(snapshotSource, /candidateBuffs,/);
assert.match(snapshotSource, /source\.payload\.operatorConfigPageCache/);
assert.match(snapshotSource, /buildAiTimelineNodeReviewProjection\(source\.sourceNode/);

const commandStart = source.indexOf('const processMainWorkbenchSelectionCommand = useCallback');
const commandEnd = source.indexOf('// 组件首次挂载时自动加载干员数据', commandStart);
assert.ok(commandStart >= 0 && commandEnd > commandStart);
const commandSource = source.slice(commandStart, commandEnd);
assert.match(commandSource, /'queryAgentProductCatalog'/);
assert.match(commandSource, /executeAgentProductCatalogCommand\(command\)/);
assert.match(commandSource, /entry\.command\.intent === 'selection'/);
assert.match(commandSource, /entry\.command\.candidate\.intent === 'selection'/);
assert.match(commandSource, /prepareReviewedSelectionProposal\(\{/);
assert.match(commandSource, /applyReviewedSelectionProposal\(\{/);
assert.match(commandSource, /if \(result\.ok\) bumpAgentRouteRevision\(\)/);
assert.match(commandSource, /abandonReviewedSelectionProposal\(\{/);
assert.doesNotMatch(
  commandSource.slice(
    commandSource.indexOf("if (command.op === 'queryAgentProductCatalog')"),
    commandSource.indexOf("if (command.op === 'prepareReviewedWorkNodeProposal')"),
  ),
  /selectedCharacters\.length|currentView|skillButtons/,
  'catalog command ownership must not depend on view or roster',
);

assert.match(source, /if \(state\.currentView === 'canvas'\) return undefined;/);
assert.match(source, /processMainWorkbenchSelectionCommandRef\.current\(true\)/);
assert.match(source, /browserAgentRuntime\.cancelCommandPull\(\)/);
assert.match(source, /retryDelay = Math\.min\(retryDelay \* 2, 1000\)/);
assert.match(source, /\}, \[agentRouteRevision, state\.currentView\]\);/);
const selectionPumpStart = source.indexOf("if (state.currentView === 'canvas') return undefined;");
const selectionPumpEnd = source.indexOf('\n\n  useEffect(', selectionPumpStart);
const selectionPump = source.slice(selectionPumpStart, selectionPumpEnd);
assert.doesNotMatch(
  selectionPump,
  /state\.(selectedCharacters|skillButtons|loadedCharacters)/,
  'selection long-poll must remain mounted across roster/button/library changes',
);

const publishStart = source.lastIndexOf('useEffect(() => {', source.indexOf('ensureSelectionWorkspaceSourceCheckout('));
const publishEnd = source.indexOf('\n\n  const contextValue', publishStart);
assert.ok(publishStart >= 0 && publishEnd > publishStart);
const publishSource = source.slice(publishStart, publishEnd);
assert.match(publishSource, /ensureSelectionWorkspaceSourceCheckout\(stateRef\.current\.selectedCharacters\)/);
assert.match(publishSource, /getCurrentTimelineSnapshotPayload\(\)/);
assert.match(publishSource, /diffPreparedPayloads\(source\.payload, runtimePayload\)\.changes\.length === 0/);
assert.match(publishSource, /JSON\.stringify\(storedIds\) === JSON\.stringify\(sourceIds\)/);
assert.match(publishSource, /JSON\.stringify\(currentIds\) === JSON\.stringify\(sourceIds\)/);
assert.match(publishSource, /selection live draft differs from the formal checkout; writable binding is suspended/);
assert.match(publishSource, /browserAgentRuntime\.suspendWritableBinding\(\)/);
assert.match(publishSource, /exactCharacterRosterFromPayload/);
assert.match(publishSource, /buildSelectionWorkbenchSnapshot\(resolvedCharacters/);
assert.match(publishSource, /writeMainWorkbenchSnapshot\(snapshot\)/);
assert.match(publishSource, /await pushMainWorkbenchSnapshot\(snapshot\)/);
assert.doesNotMatch(
  publishSource,
  /state\.selectedCharacters\.length === 0|state\.selectedCharacters\.length > 0/,
  'empty-roster selection page must still bootstrap and publish its persisted source checkout',
);

console.log('AppContext selection Agent ownership contract: PASS');
