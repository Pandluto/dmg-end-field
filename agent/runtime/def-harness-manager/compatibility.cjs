const {
  classifyDefExecutableTurnPolicy,
  isDirectCurrentNodeQuestion,
} = require('../def-opencode-adapter/harness-turn-router.cjs');

function buildLegacyCheckoutSystem(state, existingSystem, parts) {
  const currentNode = Array.isArray(state.axisContext?.nodes)
    ? state.axisContext.nodes.find((node) => node?.id === state.current?.targetId)
    : null;
  const userText = Array.isArray(parts)
    ? parts.filter((part) => part?.type === 'text').map((part) => String(part.text || '')).join('\n')
    : '';
  const executablePolicy = classifyDefExecutableTurnPolicy(userText);
  const lines = [
    'DEF WORKBENCH AUTHORITATIVE STATE (system instruction, not user text):',
    'This conversation is bound to the timeline document and its Work Node tree. A Work Node is never the conversation identity.',
    `Current checkout: ${currentNode?.label || 'unnamed node'} (${state.current?.targetId || 'none'}).`,
    `Checkout state: ${state.phase}.`,
    'Do not use, repeat, or reconcile any older transcript claim about a bound node or latest applied node.',
    'The current user message is the only active task. Never repeat a previously completed equipment/configuration result unless the user explicitly asks for it.',
    'If the UI-selected node, session-axis boundNodeId, and current checkout do not identify the same Work Node, treat checkout as authoritative and do not mutate until def_workbench_context plus def_node_bind(nodeId="") converges them.',
    'If the same typed-tool failure code occurs twice in this turn, stop calling tools and report that the requested change was not applied, including the failing stage and one recovery action.',
    'If a typed mutation reports retryable=false, stop all later mutations in this turn. A def-tool-mutation-not-attempted result means that later request was never sent to the backend: report it as 未尝试, not as a second backend failure. Report only actual tool execution and the structured nextAction returned by the tool.',
    'The same retry fuse applies to generic tool failures such as outside-session file permission denials. After one such denial, do not try another path or generic file tool for that resource.',
    'A loaded Skill is complete. Never scan, glob, grep, or read its runtime directory; use the Skill content and trusted def_data resources.',
    'Never report a mutation as successful from queue state or record count alone. Native approval and the exact visible postcondition must both pass.',
    'For 重新发出审核 / 重新提交审批 / 提交审核 / wait for my personal approval, validation alone is not enough: call def_node_use in this turn to create the native pending approval. Never say 待审批 if interop pending is null.',
  ];
  if (executablePolicy?.kind === 'exact-skill-facts') {
    lines.push(
      'EXACT SKILL FACT CONTRACT: this read-only turn is about one named skill or hit, not the current canvas.',
      'Call def_data_skill as the first and only tool. Pass the user\'s complete named variant in query, including every numeric layer/id; never shorten it to a parent skill or isolated hit term.',
      'Do not call def_workbench_context, game knowledge, operator, buttons, damage, Buff, or any mutation tool. The skill resolver scopes selected operators and returns trusted operator-catalog hit facts.',
      'Answer from per-hit element, skillType, and levels. A named Q skill can contain a B-classified hit; do not copy the parent skillType onto every hit.',
    );
  } else if (state.phase === 'checkout-changed') {
    lines.push(
      'HARD GATE: before answering the user request or calling any other DEF node tool, call def_node_bind with nodeId="".',
      'After that succeeds, call def_workbench_context again, reason at high effort from the returned checkout only, then answer or continue.',
      'Do not report a current-node result, mutate a draft, or infer timeline content until the gate is cleared.',
    );
  } else {
    lines.push('Before answering a current-canvas or current-node question, call def_workbench_context and use its checkout as the only source of truth.');
  }
  if (isDirectCurrentNodeQuestion(userText)) {
    lines.push(
      'DIRECT CURRENT-NODE CONTRACT: call def_workbench_current_node before replying.',
      'Reply with exactly its label and nodeId. Do not mention axis bindings, node cursors, parents, latest-applied nodes, summaries, or any earlier answer.',
    );
  }
  if (typeof existingSystem === 'string' && existingSystem.trim()) lines.push(existingSystem.trim());
  return lines.join('\n');
}

function buildLegacyWorkbenchContextSystem(selectedNode, existingSystem) {
  const lines = [
    'DEF WORKBENCH LIVE SELECTION (authoritative system context; not user text):',
    'This value is refreshed from the Work Node tree before every user message. Treat every older transcript claim about the current node as stale. The outer authoritative checkout state wins if the identities differ.',
  ];
  if (selectedNode) {
    lines.push(
      `Selected node ID: ${selectedNode.id}`,
      `Selected node name: ${selectedNode.name}`,
      `Selected node description: ${selectedNode.description || '（无描述）'}`,
      'When asked for the current node, answer directly from these three fields. Do not ask the user to confirm and do not call a tool merely to rediscover them.',
    );
  } else {
    lines.push('No Work Node has been selected in this UI session. State that fact plainly if the user asks for the current node.');
  }
  if (typeof existingSystem === 'string' && existingSystem.trim()) lines.push(existingSystem.trim());
  return lines.join('\n');
}

function composeLegacyWorkbenchSystem({
  harnessSystem,
  workbenchContext,
  checkoutState,
  incomingSystem,
  diagnosticSystem,
  parts,
}) {
  const selectedSystem = buildLegacyWorkbenchContextSystem(
    workbenchContext,
    [harnessSystem, incomingSystem, diagnosticSystem].filter(Boolean).join('\n\n'),
  );
  return checkoutState
    ? buildLegacyCheckoutSystem(checkoutState, selectedSystem, parts)
    : selectedSystem;
}

module.exports = {
  buildLegacyCheckoutSystem,
  buildLegacyWorkbenchContextSystem,
  composeLegacyWorkbenchSystem,
};
