import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const baseUrl = String(process.env.DEF_INTEROP_URL || 'http://127.0.0.1:31457').replace(/\/$/, '');
const runtimeRoot = path.resolve(process.cwd(), '.runtime/def-harness');

function error(code, message, detail = {}) { return Object.assign(new Error(message), { code, detail }); }
function writeRun(run) {
  const directory = path.join(runtimeRoot, 'runs', run.runId);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(directory, 'native-run.json'), `${JSON.stringify(run, null, 2)}\n`, { mode: 0o600 });
}
async function request(method, pathname, body, token = '') {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok === false) throw error(payload?.error?.code || `HTTP_${response.status}`, payload?.error?.message || payload?.error || `Interop request failed: ${response.status}`, { status: response.status, payload });
  return payload;
}
async function authorize() { return (await request('POST', '/def-agent/interop/v1/authorize')).token; }
async function observeEvents(sessionId, cursor, token, milliseconds = 900) {
  const response = await fetch(`${baseUrl}/def-agent/interop/v1/sessions/${encodeURIComponent(sessionId)}/events?cursor=${encodeURIComponent(cursor || 0)}`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok || !response.body) throw error('ERROR_PROTOCOL', 'Could not subscribe to native turn events.', { status: response.status });
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let raw = '';
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), Math.max(1, deadline - Date.now())));
    const chunk = await Promise.race([reader.read(), timeout]);
    if (!chunk || chunk.done) break;
    raw += decoder.decode(chunk.value, { stream: true });
  }
  await reader.cancel().catch(() => undefined);
  const events = []; let event = '';
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) { try { events.push({ source: 'interop', event, ...JSON.parse(line.slice(5).trim()) }); } catch {} }
  }
  return events;
}
function terminal(turn) { return ['completed', 'stopped', 'timeout', 'provider-error', 'bridge-error', 'max-step'].includes(turn?.status); }
function redactPublic(value) { return JSON.parse(JSON.stringify(value, (key, item) => /authorization|token|secret|evaluator/i.test(key) ? '[redacted]' : item)); }
function textOf(message) { return (message?.parts || []).filter((part) => part?.type === 'text').map((part) => part.text || '').join('\n'); }
function protocolFacts(messages, prompt) {
  const user = messages.find((message) => message?.info?.role === 'user' && textOf(message) === prompt) || null;
  const nativeUserMessageId = user?.info?.id || null;
  const replies = nativeUserMessageId
    ? messages.filter((message) => message?.info?.role === 'assistant' && message?.info?.parentID === nativeUserMessageId)
    : [];
  const toolEvents = replies.flatMap((message) => (message.parts || [])
    .filter((part) => part?.type === 'tool')
    .map((part) => ({
      source: 'interop',
      messageId: message.info?.id || null,
      callId: part.callID || part.callId || null,
      tool: part.tool || null,
      state: part.state || (part.status ? {
        status: part.status,
        output: part.output,
        metadata: part.metadata,
        error: part.error,
      } : null),
    })));
  return { nativeUserMessageId, assistantMessageIds: replies.map((message) => message.info?.id).filter(Boolean), toolEvents };
}

function canonicalScenarioValue(value) {
  if (Array.isArray(value)) return value.map(canonicalScenarioValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().flatMap((key) => (
    value[key] === undefined ? [] : [[key, canonicalScenarioValue(value[key])]]
  )));
}

function scenarioToolEvents(run) {
  return (Array.isArray(run?.turns) ? run.turns : []).flatMap((turn, turnIndex) => (
    (Array.isArray(turn?.toolEvents) ? turn.toolEvents : []).map((event, eventIndex) => ({
      ...event,
      turnIndex,
      turnNumber: turnIndex + 1,
      eventIndex,
    }))
  ));
}

function completedScenarioToolEvent(event) {
  return event?.state?.status === 'completed';
}

function parseScenarioToolOutput(value, depth = 0) {
  if (depth > 5 || value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text || !/^[\[{]/.test(text)) return null;
    try { return parseScenarioToolOutput(JSON.parse(text), depth + 1); } catch { return null; }
  }
  if (typeof value !== 'object') return null;
  if (typeof value.state === 'string' && value.state.trim()) return value.state.trim();
  for (const key of ['metadata', 'result', 'output', 'body', 'data']) {
    const resultState = parseScenarioToolOutput(value[key], depth + 1);
    if (resultState) return resultState;
  }
  return null;
}

function scenarioToolResultState(event) {
  for (const value of [event?.state?.metadata, event?.state?.result, event?.state?.output, event?.output]) {
    const resultState = parseScenarioToolOutput(value);
    if (resultState) return resultState;
  }
  return null;
}

function parseScenarioTypedToolResult(value, depth = 0) {
  if (depth > 5 || value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text || !/^[\[{]/.test(text)) return null;
    try { return parseScenarioTypedToolResult(JSON.parse(text), depth + 1); } catch { return null; }
  }
  if (typeof value !== 'object') return null;
  if (
    typeof value.contract === 'string'
    && value.contract.trim()
    && typeof value.state === 'string'
    && value.state.trim()
  ) {
    return { contract: value.contract.trim(), state: value.state.trim() };
  }
  for (const key of ['result', 'output', 'body', 'data']) {
    const typedResult = parseScenarioTypedToolResult(value[key], depth + 1);
    if (typedResult) return typedResult;
  }
  return null;
}

function scenarioTypedToolResult(event) {
  for (const value of [event?.state?.result, event?.state?.output, event?.output]) {
    const typedResult = parseScenarioTypedToolResult(value);
    if (typedResult) return typedResult;
  }
  return null;
}

function scenarioAssistantText(run) {
  const seen = new Set();
  return (Array.isArray(run?.turns) ? run.turns : []).flatMap((turn) => {
    const assistantIds = new Set(Array.isArray(turn?.assistantMessageIds) ? turn.assistantMessageIds : []);
    return (Array.isArray(turn?.transcript?.messages) ? turn.transcript.messages : [])
      .filter((message) => message?.info?.role === 'assistant' && assistantIds.has(message?.info?.id))
      .filter((message) => {
        const id = message?.info?.id;
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .map(textOf)
      .filter(Boolean);
  }).join('\n');
}

function scenarioFinalVisibleAssistantText(turn) {
  const assistantIds = new Set(Array.isArray(turn?.assistantMessageIds) ? turn.assistantMessageIds : []);
  const visible = (Array.isArray(turn?.transcript?.messages) ? turn.transcript.messages : [])
    .filter((message) => message?.info?.role === 'assistant' && assistantIds.has(message?.info?.id))
    .map(textOf)
    .map((text) => text.trim())
    .filter(Boolean);
  return visible.at(-1) || '';
}

function addScenarioCheck(checks, check) {
  checks.push({ ...check, pass: Boolean(check.pass) });
}

function scenarioToolList(value, field, checks) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((tool) => typeof tool !== 'string' || !tool.trim())) {
    addScenarioCheck(checks, {
      pass: false,
      code: 'verification-config-invalid',
      field,
      message: `${field} must be an array of non-empty tool names.`,
    });
    return [];
  }
  return [...new Set(value.map((tool) => tool.trim()))];
}

function scenarioTextList(value, field, checks) {
  if (!Array.isArray(value) || !value.length || value.some((text) => typeof text !== 'string' || !text.trim())) {
    addScenarioCheck(checks, {
      pass: false,
      code: 'verification-config-invalid',
      field,
      message: `${field} must be a non-empty array of text fragments.`,
    });
    return [];
  }
  return [...new Set(value.map((text) => text.trim()))];
}

function normalizeScenarioTurnToolRules(value, field, checks) {
  if (value === undefined) return [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    addScenarioCheck(checks, {
      pass: false,
      code: 'verification-config-invalid',
      field,
      message: `${field} must be an object keyed by one-based turn number.`,
    });
    return [];
  }
  return Object.entries(value).flatMap(([rawTurnNumber, rawTools]) => {
    const turnNumber = Number(rawTurnNumber);
    const tools = scenarioToolList(rawTools, `${field}.${rawTurnNumber}`, checks);
    if (!Number.isInteger(turnNumber) || turnNumber < 1) {
      addScenarioCheck(checks, {
        pass: false,
        code: 'verification-config-invalid',
        field: `${field}.${rawTurnNumber}`,
        message: `${field} keys must be positive one-based turn numbers.`,
      });
      return [];
    }
    return [{ turnNumber, tools }];
  });
}

function normalizeScenarioTurnTypedToolResultRules(value, field, checks) {
  if (value === undefined) return [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    addScenarioCheck(checks, {
      pass: false,
      code: 'verification-config-invalid',
      field,
      message: `${field} must be an object keyed by one-based turn number.`,
    });
    return [];
  }
  return Object.entries(value).flatMap(([rawTurnNumber, rawToolResults]) => {
    const turnNumber = Number(rawTurnNumber);
    if (!Number.isInteger(turnNumber) || turnNumber < 1 || !rawToolResults || typeof rawToolResults !== 'object' || Array.isArray(rawToolResults)) {
      addScenarioCheck(checks, {
        pass: false,
        code: 'verification-config-invalid',
        field: `${field}.${rawTurnNumber}`,
        message: `${field} entries must map a positive one-based turn number to typed tool results.`,
      });
      return [];
    }
    return Object.entries(rawToolResults).flatMap(([rawTool, rawResult]) => {
      const tool = typeof rawTool === 'string' ? rawTool.trim() : '';
      const contract = typeof rawResult?.contract === 'string' ? rawResult.contract.trim() : '';
      const state = typeof rawResult?.state === 'string' ? rawResult.state.trim() : '';
      if (!tool || !contract || !state || !rawResult || typeof rawResult !== 'object' || Array.isArray(rawResult)) {
        addScenarioCheck(checks, {
          pass: false,
          code: 'verification-config-invalid',
          field: `${field}.${rawTurnNumber}.${rawTool || '<empty>'}`,
          message: `${field} tool entries require non-empty contract and state strings.`,
        });
        return [];
      }
      return [{ turnNumber, tool, expected: { contract, state } }];
    });
  });
}

function normalizeScenarioTurnPatternRules(value, field, checks) {
  if (value === undefined) return [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    addScenarioCheck(checks, {
      pass: false,
      code: 'verification-config-invalid',
      field,
      message: `${field} must be an object keyed by one-based turn number.`,
    });
    return [];
  }
  return Object.entries(value).flatMap(([rawTurnNumber, rawPatterns]) => {
    const turnNumber = Number(rawTurnNumber);
    const sources = scenarioTextList(rawPatterns, `${field}.${rawTurnNumber}`, checks);
    if (!Number.isInteger(turnNumber) || turnNumber < 1 || !sources.length) {
      if (!Number.isInteger(turnNumber) || turnNumber < 1) {
        addScenarioCheck(checks, {
          pass: false,
          code: 'verification-config-invalid',
          field: `${field}.${rawTurnNumber}`,
          message: `${field} keys must be positive one-based turn numbers.`,
        });
      }
      return [];
    }
    const patterns = sources.flatMap((source, index) => {
      try {
        return [{ source, expression: new RegExp(source, 'u') }];
      } catch (caught) {
        addScenarioCheck(checks, {
          pass: false,
          code: 'verification-config-invalid',
          field: `${field}.${rawTurnNumber}[${index}]`,
          message: `Invalid regular expression: ${caught.message}`,
        });
        return [];
      }
    });
    return patterns.length === sources.length ? [{ turnNumber, patterns }] : [];
  });
}

function normalizeConditionalScenarioRule(rule, index, checks) {
  const whenTool = typeof rule?.when?.tool === 'string' ? rule.when.tool.trim() : '';
  const rawStates = rule?.when?.resultState ?? rule?.when?.resultStates;
  const resultStates = (Array.isArray(rawStates) ? rawStates : [rawStates])
    .map((state) => typeof state === 'string' ? state.trim() : '')
    .filter(Boolean);
  const require = scenarioToolList(rule?.require ?? rule?.requiredTools, `conditionalTools[${index}].require`, checks);
  const forbid = scenarioToolList(rule?.forbid ?? rule?.forbiddenTools, `conditionalTools[${index}].forbid`, checks);
  if (!whenTool || !resultStates.length || (!require.length && !forbid.length)) {
    addScenarioCheck(checks, {
      pass: false,
      code: 'verification-config-invalid',
      field: `conditionalTools[${index}]`,
      message: 'A conditional tool rule requires when.tool, when.resultState, and at least one require/forbid tool.',
    });
    return null;
  }
  return { index, whenTool, resultStates: [...new Set(resultStates)], require, forbid };
}

export function evaluateScenarioVerification(run, scenario) {
  const verification = scenario?.verification && typeof scenario.verification === 'object'
    ? scenario.verification
    : {};
  const checks = [];
  const events = scenarioToolEvents(run).map((event) => ({
    ...event,
    resultState: scenarioToolResultState(event),
    typedResult: scenarioTypedToolResult(event),
  }));
  const attemptedCounts = {};
  const completedCounts = {};
  for (const event of events) {
    if (typeof event.tool !== 'string' || !event.tool) continue;
    attemptedCounts[event.tool] = (attemptedCounts[event.tool] || 0) + 1;
    if (completedScenarioToolEvent(event)) completedCounts[event.tool] = (completedCounts[event.tool] || 0) + 1;
  }

  const requiredTools = scenarioToolList(verification.requiredTools, 'requiredTools', checks);
  const forbiddenTools = scenarioToolList(verification.forbiddenTools, 'forbiddenTools', checks);
  for (const tool of requiredTools) {
    addScenarioCheck(checks, {
      pass: (completedCounts[tool] || 0) > 0,
      code: 'required-tool-missing',
      tool,
      expected: 'at-least-one-completed-call',
      actual: completedCounts[tool] || 0,
    });
  }
  for (const tool of forbiddenTools) {
    addScenarioCheck(checks, {
      pass: (attemptedCounts[tool] || 0) === 0,
      code: 'forbidden-tool-called',
      tool,
      expected: 0,
      actual: attemptedCounts[tool] || 0,
    });
  }

  const requiredToolsByTurn = normalizeScenarioTurnToolRules(verification.requiredToolsByTurn, 'requiredToolsByTurn', checks);
  for (const rule of requiredToolsByTurn) {
    const sameTurn = events.filter((event) => event.turnNumber === rule.turnNumber);
    for (const tool of rule.tools) {
      const actual = sameTurn.filter((event) => event.tool === tool && completedScenarioToolEvent(event)).length;
      addScenarioCheck(checks, {
        pass: actual > 0,
        code: 'required-turn-tool-missing',
        tool,
        turnNumber: rule.turnNumber,
        expected: 'at-least-one-completed-call-in-required-turn',
        actual,
      });
    }
  }

  const orderedToolsByTurn = normalizeScenarioTurnToolRules(verification.orderedToolsByTurn, 'orderedToolsByTurn', checks);
  for (const rule of orderedToolsByTurn) {
    const observedToolSequence = events
      .filter((event) => event.turnNumber === rule.turnNumber && completedScenarioToolEvent(event))
      .map((event) => event.tool)
      .filter(Boolean);
    let cursor = -1;
    let violatedTool = null;
    for (const tool of rule.tools) {
      const nextIndex = observedToolSequence.indexOf(tool, cursor + 1);
      if (nextIndex < 0) {
        violatedTool = tool;
        break;
      }
      cursor = nextIndex;
    }
    addScenarioCheck(checks, {
      pass: violatedTool === null,
      code: 'ordered-tool-sequence-violated',
      turnNumber: rule.turnNumber,
      expectedToolSequence: rule.tools,
      observedToolSequence,
      violatedTool,
    });
  }

  const onlyToolsByTurn = normalizeScenarioTurnToolRules(verification.onlyToolsByTurn, 'onlyToolsByTurn', checks);
  for (const rule of onlyToolsByTurn) {
    const allowedTools = new Set(rule.tools);
    const unexpectedTools = events
      .filter((event) => event.turnNumber === rule.turnNumber && !allowedTools.has(event.tool))
      .map((event) => event.tool || '<missing-tool-name>');
    addScenarioCheck(checks, {
      pass: unexpectedTools.length === 0,
      code: 'turn-tool-not-allowed',
      turnNumber: rule.turnNumber,
      allowedTools: rule.tools,
      unexpectedTools,
    });
  }

  const requiredToolResultsByTurn = normalizeScenarioTurnTypedToolResultRules(
    verification.requiredToolResultsByTurn,
    'requiredToolResultsByTurn',
    checks,
  );
  for (const rule of requiredToolResultsByTurn) {
    const observedResults = events
      .filter((event) => event.turnNumber === rule.turnNumber && event.tool === rule.tool && completedScenarioToolEvent(event))
      .map((event) => event.typedResult)
      .filter(Boolean);
    addScenarioCheck(checks, {
      pass: observedResults.some((result) => result.contract === rule.expected.contract && result.state === rule.expected.state),
      code: 'required-turn-typed-tool-result-missing',
      tool: rule.tool,
      turnNumber: rule.turnNumber,
      expected: rule.expected,
      observedResults,
    });
  }

  const repeated = verification.maxRepeatedToolCalls;
  if (repeated !== undefined && (!repeated || typeof repeated !== 'object' || Array.isArray(repeated))) {
    addScenarioCheck(checks, {
      pass: false,
      code: 'verification-config-invalid',
      field: 'maxRepeatedToolCalls',
      message: 'maxRepeatedToolCalls must be an object of non-negative integer limits.',
    });
  } else {
    for (const [tool, rawLimit] of Object.entries(repeated || {})) {
      const limit = Number(rawLimit);
      if (!tool || !Number.isInteger(limit) || limit < 0) {
        addScenarioCheck(checks, {
          pass: false,
          code: 'verification-config-invalid',
          field: `maxRepeatedToolCalls.${tool || '<empty>'}`,
          message: 'Each repeated-tool limit must be a non-negative integer.',
        });
        continue;
      }
      addScenarioCheck(checks, {
        pass: (attemptedCounts[tool] || 0) <= limit,
        code: 'max-repeated-tool-calls-exceeded',
        tool,
        expectedMaximum: limit,
        actual: attemptedCounts[tool] || 0,
      });
    }
  }

  const forbiddenText = verification.forbiddenAssistantText;
  if (forbiddenText !== undefined && (!Array.isArray(forbiddenText) || forbiddenText.some((text) => typeof text !== 'string' || !text))) {
    addScenarioCheck(checks, {
      pass: false,
      code: 'verification-config-invalid',
      field: 'forbiddenAssistantText',
      message: 'forbiddenAssistantText must be an array of non-empty strings.',
    });
  } else {
    const assistantText = scenarioAssistantText(run);
    for (const text of [...new Set(forbiddenText || [])]) {
      addScenarioCheck(checks, {
        pass: !assistantText.includes(text),
        code: 'forbidden-assistant-text-present',
        text,
      });
    }
  }

  const requiredFinalPatternsByTurn = normalizeScenarioTurnPatternRules(
    verification.requiredFinalAssistantPatternsByTurn,
    'requiredFinalAssistantPatternsByTurn',
    checks,
  );
  for (const rule of requiredFinalPatternsByTurn) {
    const assistantText = scenarioFinalVisibleAssistantText(run?.turns?.[rule.turnNumber - 1]);
    for (const pattern of rule.patterns) {
      addScenarioCheck(checks, {
        pass: pattern.expression.test(assistantText),
        code: 'required-final-assistant-pattern-missing',
        pattern: pattern.source,
        turnNumber: rule.turnNumber,
      });
    }
  }

  const forbiddenFinalPatternsByTurn = normalizeScenarioTurnPatternRules(
    verification.forbiddenFinalAssistantPatternsByTurn,
    'forbiddenFinalAssistantPatternsByTurn',
    checks,
  );
  for (const rule of forbiddenFinalPatternsByTurn) {
    const assistantText = scenarioFinalVisibleAssistantText(run?.turns?.[rule.turnNumber - 1]);
    for (const pattern of rule.patterns) {
      addScenarioCheck(checks, {
        pass: !pattern.expression.test(assistantText),
        code: 'forbidden-final-assistant-pattern-present',
        pattern: pattern.source,
        turnNumber: rule.turnNumber,
      });
    }
  }

  if (verification.mustKeepState === true) {
    const beforeAvailable = Boolean(
      run?.stateBefore?.value
      && Object.prototype.hasOwnProperty.call(run.stateBefore.value, 'state')
      && run.stateBefore.value.state !== null
      && run.stateBefore.value.state !== undefined,
    );
    const afterAvailable = Boolean(
      run?.stateAfter?.value
      && Object.prototype.hasOwnProperty.call(run.stateAfter.value, 'state')
      && run.stateAfter.value.state !== null
      && run.stateAfter.value.state !== undefined,
    );
    const unchanged = beforeAvailable && afterAvailable
      && JSON.stringify(canonicalScenarioValue(run.stateBefore.value.state)) === JSON.stringify(canonicalScenarioValue(run.stateAfter.value.state));
    addScenarioCheck(checks, {
      pass: unchanged,
      code: beforeAvailable && afterAvailable ? 'product-state-changed' : 'product-state-unavailable',
      beforeAvailable,
      afterAvailable,
    });
  }

  const rawConditionalRules = verification.conditionalTools;
  if (rawConditionalRules !== undefined && !Array.isArray(rawConditionalRules)) {
    addScenarioCheck(checks, {
      pass: false,
      code: 'verification-config-invalid',
      field: 'conditionalTools',
      message: 'conditionalTools must be an array.',
    });
  }
  const conditionalRules = (Array.isArray(rawConditionalRules) ? rawConditionalRules : [])
    .map((rule, index) => normalizeConditionalScenarioRule(rule, index, checks))
    .filter(Boolean);
  const conditionalTriggerTools = new Set(conditionalRules.map((rule) => rule.whenTool));
  for (const event of events.filter((candidate) => completedScenarioToolEvent(candidate) && conditionalTriggerTools.has(candidate.tool))) {
    addScenarioCheck(checks, {
      pass: Boolean(event.resultState),
      code: 'conditional-tool-result-state-unavailable',
      tool: event.tool,
      turnNumber: event.turnNumber,
      callId: event.callId || null,
    });
  }
  for (const rule of conditionalRules) {
    const triggers = events.filter((event) => (
      event.tool === rule.whenTool
      && completedScenarioToolEvent(event)
      && rule.resultStates.includes(event.resultState)
    ));
    for (const trigger of triggers) {
      const sameTurn = events.filter((event) => event.turnIndex === trigger.turnIndex);
      for (const tool of rule.require) {
        const actual = sameTurn.filter((event) => event.tool === tool && completedScenarioToolEvent(event)).length;
        addScenarioCheck(checks, {
          pass: actual > 0,
          code: 'conditional-required-tool-missing',
          condition: { tool: rule.whenTool, resultState: trigger.resultState },
          tool,
          turnNumber: trigger.turnNumber,
          expected: 'at-least-one-completed-call-in-trigger-turn',
          actual,
        });
      }
      for (const tool of rule.forbid) {
        const actual = sameTurn.filter((event) => event.tool === tool).length;
        addScenarioCheck(checks, {
          pass: actual === 0,
          code: 'conditional-forbidden-tool-called',
          condition: { tool: rule.whenTool, resultState: trigger.resultState },
          tool,
          turnNumber: trigger.turnNumber,
          expected: 0,
          actual,
        });
      }
    }
  }

  const failures = checks.filter((check) => !check.pass);
  return {
    kind: 'DefHarnessScenarioVerificationV1',
    scenarioId: scenario?.id || run?.scenarioId || null,
    scenarioVersion: Number(scenario?.version || run?.scenarioVersion || 1),
    status: failures.length ? 'FAIL' : 'PASS',
    ok: failures.length === 0,
    checks,
    failures,
    observed: {
      attemptedToolCounts: Object.fromEntries(Object.entries(attemptedCounts).sort(([left], [right]) => left.localeCompare(right))),
      completedToolCounts: Object.fromEntries(Object.entries(completedCounts).sort(([left], [right]) => left.localeCompare(right))),
    },
  };
}

export function applyScenarioVerification(run, scenario) {
  const verification = evaluateScenarioVerification(run, scenario);
  return {
    ...run,
    verification,
    status: run?.status === 'EXECUTED' && !verification.ok ? 'FAIL_AGENT' : run?.status,
  };
}

export async function runNativeScenario({ scenario, harnessSelector = 'stable', cleanup = true, timeoutMs = 90000 } = {}) {
  if (!scenario?.id || !Array.isArray(scenario.turns) || !scenario.turns.length) throw error('HARNESS_SCENARIO_INVALID', 'Native Scenario requires a scenario id and user turns.');
  const runId = `native-harness-run-${crypto.randomUUID()}`;
  const startedAt = Date.now(); let token = ''; let runner = null;
  const run = { kind: 'DefHarnessNativeScenarioRunV1', runId, scenarioId: scenario.id, scenarioVersion: Number(scenario.version || 1), selector: harnessSelector, createdAt: startedAt, sources: ['harness'], status: 'INCOMPLETE', turns: [], events: [], questions: [], cleanup: { requested: cleanup, completed: false } };
  try {
    const status = await request('GET', '/def-agent/interop/v1/status');
    run.readiness = { source: 'interop', status };
    if (!status.agent?.ready) throw error('BLOCKED_ENVIRONMENT', 'DEF sidecar is not ready.');
    if (scenario.requiresSnapshot === true && status.workbench?.snapshotAvailable !== true) {
      throw error('BLOCKED_ENVIRONMENT', 'This Scenario requires an available Workbench snapshot.', { code: 'snapshot-unavailable' });
    }
    token = await authorize();
    const before = await request('GET', '/def-agent/interop/v1/state', undefined, token);
    run.stateBefore = { source: 'snapshot', value: before };
    runner = (await request('POST', '/def-agent/interop/v1/harness/sessions', { harnessSelector, fixtureMode: scenario.fixtureMode || 'empty' }, token)).runner;
    run.fixture = { source: 'harness', fixtureId: runner.fixtureId, timelineId: runner.timelineId, mode: runner.fixtureMode, boundNodeId: runner.boundNodeId };
    run.session = { source: 'sidecar', sessionId: runner.sessionId, harnessBinding: runner.harnessBinding, agentRelease: runner.agentRelease || null };
    let cursor = '0'; let first = true;
    for (const userTurn of scenario.turns) {
      const clientTurnId = `harness-${crypto.randomUUID()}`;
      const pathname = first
        ? '/def-agent/interop/v1/turns'
        : `/def-agent/interop/v1/sessions/${encodeURIComponent(runner.sessionId)}/turns`;
      const accepted = await request('POST', pathname, { protocolVersion: 1, sessionId: runner.sessionId, rawUserText: userTurn.userText, clientTurnId, ingressMode: 'pure-blackbox', harnessSelector }, token);
      const turn = { source: 'interop', accepted: accepted.turn, prompt: userTurn.userText, startedAt: Date.now(), eventCursorBefore: accepted.turn.eventCursor || cursor };
      cursor = accepted.turn.eventCursor || cursor;
      const deadline = Date.now() + timeoutMs;
      let transcript;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        transcript = await request('GET', `/def-agent/interop/v1/sessions/${encodeURIComponent(runner.sessionId)}/transcript`, undefined, token);
        const observed = transcript.turns?.find((item) => item.turnId === accepted.turn.turnId);
        if (terminal(observed)) { turn.terminal = { source: 'interop', ...observed }; break; }
      }
      turn.completedAt = Date.now();
      turn.transcript = { source: 'interop', messages: transcript?.transcript || [] };
      Object.assign(turn, protocolFacts(turn.transcript.messages, userTurn.userText));
      const events = await observeEvents(runner.sessionId, cursor, token);
      run.events.push(...events);
      cursor = events.at(-1)?.cursor || cursor;
      turn.eventCursorAfter = cursor;
      if (!turn.terminal) turn.terminal = { status: 'timeout', source: 'harness' };
      run.turns.push(turn); first = false;
      if (!terminal(turn.terminal)) break;
    }
    run.questions = { source: 'interop', value: await request('GET', `/def-agent/interop/v1/sessions/${encodeURIComponent(runner.sessionId)}/questions`, undefined, token) };
    run.stateAfter = { source: 'snapshot', value: await request('GET', '/def-agent/interop/v1/state', undefined, token) };
    const missing = run.turns.some((turn) => !turn.terminal || !turn.transcript?.messages?.length || !turn.accepted?.harness || !turn.nativeUserMessageId || !turn.assistantMessageIds?.length);
    const failure = run.turns.find((turn) => turn.terminal?.status !== 'completed');
    run.status = missing || failure?.terminal?.status === 'timeout' ? 'INCOMPLETE'
      : failure?.terminal?.status === 'provider-error' || failure?.terminal?.status === 'bridge-error' || failure?.terminal?.status === 'max-step' ? 'ERROR_PROTOCOL'
        : failure ? 'INCOMPLETE' : 'EXECUTED';
    const verified = applyScenarioVerification(run, scenario);
    run.verification = verified.verification;
    run.status = verified.status;
  } catch (caught) {
    run.error = { source: 'harness', code: caught.code || 'ERROR_PROTOCOL', message: caught.message, detail: redactPublic(caught.detail || {}) };
    run.status = caught.code === 'BLOCKED_ENVIRONMENT' ? 'BLOCKED_ENVIRONMENT' : 'ERROR_PROTOCOL';
  } finally {
    if (runner && cleanup && token) {
      try { run.cleanup.response = await request('DELETE', `/def-agent/interop/v1/harness/sessions/${encodeURIComponent(runner.sessionId)}`, undefined, token); run.cleanup.completed = true; } catch (caught) { run.cleanup.error = { code: caught.code || 'cleanup-failed', message: caught.message }; }
    }
    run.completedAt = Date.now(); writeRun(redactPublic(run));
  }
  return run;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const file = process.argv[2];
  const selector = process.argv[3] || 'stable';
  if (!file) throw new Error('Usage: def-harness-native-runner <scenario.json> [selector]');
  const scenario = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  process.stdout.write(`${JSON.stringify(await runNativeScenario({ scenario, harnessSelector: selector }), null, 2)}\n`);
}
