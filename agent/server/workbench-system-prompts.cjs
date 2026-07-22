const {
  classifyDefExecutableTurnPolicy,
  isDirectCurrentNodeQuestion,
} = require('../runtime/def-opencode-adapter/harness-turn-router.cjs');

function buildWorkbenchCheckoutSystemPrompt(state, existingSystem, parts, routedTask = '') {
  const currentNode = Array.isArray(state.axisContext?.nodes)
    ? state.axisContext.nodes.find((node) => node?.id === state.current?.targetId)
    : null;
  const userText = Array.isArray(parts)
    ? parts.filter((part) => part?.type === 'text').map((part) => String(part.text || '')).join('\n')
    : '';
  const executablePolicy = classifyDefExecutableTurnPolicy(userText)
    || (routedTask === 'equipment-3plus1-composite' ? { kind: routedTask } : null);
  const directCurrentNodeQuestion = isDirectCurrentNodeQuestion(userText);
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
    'A loaded Skill is complete. Never scan, glob, grep, or read its runtime directory; use the Skill content and trusted DEF data resources.',
    'Never report a mutation as successful from queue state or record count alone. Native approval and the exact visible postcondition must both pass.',
    'For 重新发出审核 / 重新提交审批 / 提交审核 / wait for my personal approval, validation alone is not enough: call def_node_use in this turn to create the native pending approval. Never say 待审批 if interop pending is null.',
  ];
  if (executablePolicy?.kind === 'equipment-3plus1-composite') {
    lines.push(
      '3+1 EQUIPMENT COMPOSITE CONTRACT: this read-only turn is owned by def_data_equipment_3plus1_recommend, not the current canvas.',
      'Call def_data_equipment_3plus1_recommend once. Do not call workbench context, catalog, knowledge, legacy 3+1, file, question, or mutation tools.',
      'READY, NEEDS_INPUT, and UNRESOLVED are terminal for this turn. Answer from the typed result without fallback searches.',
    );
  } else if (executablePolicy?.kind === 'exact-skill-facts') {
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
    if (directCurrentNodeQuestion) {
      lines.push(
        'After the hard gate is cleared, call def_workbench_current_node before replying.',
        'Reply with exactly its label and nodeId. Do not mention axis bindings, node cursors, parents, latest-applied nodes, summaries, or any earlier answer.',
      );
    }
  } else if (directCurrentNodeQuestion) {
    lines.push(
      'DIRECT CURRENT-NODE CONTRACT: call def_workbench_current_node as the only discovery tool before replying.',
      'Reply with exactly its label and nodeId. Do not mention axis bindings, node cursors, parents, latest-applied nodes, summaries, or any earlier answer.',
    );
  } else {
    lines.push('Before answering a current-canvas question, call def_workbench_context and use its checkout as the only source of truth.');
  }
  if (typeof existingSystem === 'string' && existingSystem.trim()) lines.push(existingSystem.trim());
  return lines.join('\n');
}

function buildWorkbenchContextSystemPrompt(selectedNode, existingSystem) {
  const lines = [
    'DEF WORKBENCH LIVE SELECTION (supplementary system context; not user text):',
    'This value is refreshed from the Work Node tree before every user message. It describes the latest UI selection, not the authoritative checkout. The outer checkout state and def_workbench_current_node win if identities differ.',
  ];
  if (selectedNode) {
    lines.push(
      `Selected node ID: ${selectedNode.id}`,
      `Selected node name: ${selectedNode.name}`,
      `Selected node description: ${selectedNode.description || '（无描述）'}`,
      'For a direct current-node question, follow the dedicated current-node contract and use def_workbench_current_node. Do not answer solely from these selection fields.',
    );
  } else {
    lines.push('No Work Node is selected in the live UI context. This alone does not prove that the authoritative checkout has no current Work Node.');
  }
  if (typeof existingSystem === 'string' && existingSystem.trim()) lines.push(existingSystem.trim());
  return lines.join('\n');
}

module.exports = { buildWorkbenchCheckoutSystemPrompt, buildWorkbenchContextSystemPrompt };
