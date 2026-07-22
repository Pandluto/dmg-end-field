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
      input: part.state?.input ?? part.input ?? null,
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

function parseScenarioStructuredValue(value, depth = 0) {
  if (depth > 5 || value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try { return parseScenarioStructuredValue(JSON.parse(value), depth + 1); } catch { return null; }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function scenarioStructuredOutputValues(event, depth = 0) {
  if (depth > 5) return [];
  const value = parseScenarioStructuredValue(
    depth === 0 ? event?.state?.output ?? event?.state?.result ?? event?.output : event,
  );
  if (!value) return [];
  return [value, ...['result', 'output', 'body', 'data'].flatMap((key) => scenarioStructuredOutputValues(value[key], depth + 1))];
}

function scenarioStructuredInput(event) {
  return parseScenarioStructuredValue(event?.input ?? event?.state?.input);
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

function visibleTextOf(message) {
  return (message?.parts || [])
    .filter((part) => part?.type === 'text' && part?.ignored !== true)
    .map((part) => part.text || '')
    .join('\n');
}

function scenarioFinalVisibleAssistantText(turn) {
  const assistantIds = new Set(Array.isArray(turn?.assistantMessageIds) ? turn.assistantMessageIds : []);
  const visible = (Array.isArray(turn?.transcript?.messages) ? turn.transcript.messages : [])
    .filter((message) => message?.info?.role === 'assistant' && assistantIds.has(message?.info?.id))
    .map(visibleTextOf)
    .map((text) => text.trim())
    .filter(Boolean);
  return visible.at(-1) || '';
}

function scenarioFinalVisibleAssistantClauses(turn) {
  return scenarioFinalVisibleAssistantText(turn)
    .split(/[\p{Po}\p{Pd}\p{Pc}\r\n]+/u)
    .map((clause) => clause.trim())
    .filter(Boolean);
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

const scenarioStructuredAssertionTypes = new Set(['string', 'number', 'boolean', 'object', 'array', 'null']);
const scenarioStructuredAssertionPathPattern = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;

function scenarioOwn(value, key) {
  return Boolean(value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key));
}

function normalizeScenarioAssertionPath(value, field, checks) {
  const pathValue = typeof value === 'string' ? value.trim() : '';
  if (!pathValue || !scenarioStructuredAssertionPathPattern.test(pathValue)) {
    addScenarioCheck(checks, {
      pass: false,
      code: 'verification-config-invalid',
      field,
      message: `${field} must be a dot-separated structured value path.`,
    });
    return '';
  }
  return pathValue;
}

function normalizeScenarioAssertionReference(value, field, checks, { items = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    addScenarioCheck(checks, {
      pass: false,
      code: 'verification-config-invalid',
      field,
      message: `${field} must reference a prior completed tool result.`,
    });
    return null;
  }
  const allowedFields = items
    ? ['tool', 'path', 'turnNumber', 'callIndex', 'fieldMap', 'order']
    : ['tool', 'path', 'turnNumber', 'callIndex', 'valueMap'];
  const unknownFields = Object.keys(value).filter((key) => !allowedFields.includes(key));
  const tool = typeof value.tool === 'string' ? value.tool.trim() : '';
  const pathValue = normalizeScenarioAssertionPath(value.path, `${field}.path`, checks);
  const turnNumber = value.turnNumber === undefined ? null : Number(value.turnNumber);
  const callIndex = value.callIndex === undefined ? 1 : Number(value.callIndex);
  if (
    unknownFields.length
    || !tool
    || (turnNumber !== null && (!Number.isInteger(turnNumber) || turnNumber < 1))
    || !Number.isInteger(callIndex)
    || callIndex < 1
  ) {
    addScenarioCheck(checks, {
      pass: false,
      code: 'verification-config-invalid',
      field,
      message: `${field} requires tool/path, optional positive turnNumber/callIndex, and no unsupported fields.`,
    });
    return null;
  }
  if (!items) {
    const rawValueMap = value.valueMap;
    let valueMap = null;
    if (rawValueMap !== undefined) {
      const validEntries = Array.isArray(rawValueMap)
        && rawValueMap.length > 0
        && rawValueMap.every((entry) => (
          entry
          && typeof entry === 'object'
          && !Array.isArray(entry)
          && scenarioOwn(entry, 'from')
          && scenarioOwn(entry, 'to')
          && Object.keys(entry).every((key) => ['from', 'to'].includes(key))
        ));
      const distinctSources = validEntries
        ? new Set(rawValueMap.map((entry) => JSON.stringify(canonicalScenarioValue(entry.from)))).size === rawValueMap.length
        : false;
      if (!validEntries || !distinctSources) {
        addScenarioCheck(checks, {
          pass: false,
          code: 'verification-config-invalid',
          field: `${field}.valueMap`,
          message: `${field}.valueMap must contain unique { from, to } entries only.`,
        });
        return null;
      }
      valueMap = rawValueMap.map((entry) => ({ from: entry.from, to: entry.to }));
    }
    return pathValue ? {
      tool,
      path: pathValue,
      turnNumber,
      callIndex,
      ...(valueMap ? { valueMap } : {}),
    } : null;
  }
  const fieldMap = value.fieldMap;
  const order = value.order === undefined ? 'exact' : value.order;
  if (
    !fieldMap
    || typeof fieldMap !== 'object'
    || Array.isArray(fieldMap)
    || !Object.keys(fieldMap).length
    || !['exact', 'any'].includes(order)
  ) {
    addScenarioCheck(checks, {
      pass: false,
      code: 'verification-config-invalid',
      field,
      message: `${field} requires a non-empty fieldMap and order exact|any.`,
    });
    return null;
  }
  const normalizedFieldMap = {};
  for (const [targetPath, sourcePath] of Object.entries(fieldMap)) {
    const normalizedTarget = normalizeScenarioAssertionPath(targetPath, `${field}.fieldMap.${targetPath || '<empty>'}`, checks);
    const normalizedSource = normalizeScenarioAssertionPath(sourcePath, `${field}.fieldMap.${targetPath || '<empty>'}`, checks);
    if (normalizedTarget && normalizedSource) normalizedFieldMap[normalizedTarget] = normalizedSource;
  }
  return pathValue && Object.keys(normalizedFieldMap).length === Object.keys(fieldMap).length
    ? { tool, path: pathValue, turnNumber, callIndex, fieldMap: normalizedFieldMap, order }
    : null;
}

function normalizeScenarioStructuredAssertion(value, field, checks) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    addScenarioCheck(checks, {
      pass: false,
      code: 'verification-config-invalid',
      field,
      message: `${field} must be a structured assertion object.`,
    });
    return null;
  }
  const allowedFields = ['path', 'equals', 'exists', 'type', 'minLength', 'minItems', 'equalsFrom', 'itemsEqualFrom'];
  const unknownFields = Object.keys(value).filter((key) => !allowedFields.includes(key));
  const pathValue = normalizeScenarioAssertionPath(value.path, `${field}.path`, checks);
  const hasEquals = scenarioOwn(value, 'equals');
  const hasExists = scenarioOwn(value, 'exists');
  const hasEqualsFrom = scenarioOwn(value, 'equalsFrom');
  const hasItemsEqualFrom = scenarioOwn(value, 'itemsEqualFrom');
  const type = value.type === undefined ? null : String(value.type);
  const minLength = value.minLength === undefined ? null : Number(value.minLength);
  const minItems = value.minItems === undefined ? null : Number(value.minItems);
  const predicateCount = [hasEquals, hasEqualsFrom, hasItemsEqualFrom].filter(Boolean).length;
  const exists = hasExists ? value.exists : null;
  const invalid = unknownFields.length
    || !pathValue
    || predicateCount > 1
    || (hasExists && typeof exists !== 'boolean')
    || (exists === false && (predicateCount || type !== null || minLength !== null || minItems !== null))
    || (type !== null && !scenarioStructuredAssertionTypes.has(type))
    || (minLength !== null && (!Number.isInteger(minLength) || minLength < 0))
    || (minItems !== null && (!Number.isInteger(minItems) || minItems < 0))
    || (!predicateCount && !hasExists && type === null && minLength === null && minItems === null);
  if (invalid) {
    addScenarioCheck(checks, {
      pass: false,
      code: 'verification-config-invalid',
      field,
      message: `${field} needs one supported equality/reference/existence/type/length assertion.`,
    });
    return null;
  }
  const equalsFrom = hasEqualsFrom
    ? normalizeScenarioAssertionReference(value.equalsFrom, `${field}.equalsFrom`, checks)
    : null;
  const itemsEqualFrom = hasItemsEqualFrom
    ? normalizeScenarioAssertionReference(value.itemsEqualFrom, `${field}.itemsEqualFrom`, checks, { items: true })
    : null;
  if ((hasEqualsFrom && !equalsFrom) || (hasItemsEqualFrom && !itemsEqualFrom)) return null;
  return {
    path: pathValue,
    ...(hasEquals ? { equals: value.equals } : {}),
    ...(hasExists ? { exists } : {}),
    ...(type !== null ? { type } : {}),
    ...(minLength !== null ? { minLength } : {}),
    ...(minItems !== null ? { minItems } : {}),
    ...(equalsFrom ? { equalsFrom } : {}),
    ...(itemsEqualFrom ? { itemsEqualFrom } : {}),
  };
}

function normalizeScenarioTurnStructuredAssertionRules(value, field, checks) {
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
  return Object.entries(value).flatMap(([rawTurnNumber, rawToolAssertions]) => {
    const turnNumber = Number(rawTurnNumber);
    if (!Number.isInteger(turnNumber) || turnNumber < 1 || !rawToolAssertions || typeof rawToolAssertions !== 'object' || Array.isArray(rawToolAssertions)) {
      addScenarioCheck(checks, {
        pass: false,
        code: 'verification-config-invalid',
        field: `${field}.${rawTurnNumber}`,
        message: `${field} entries must map a positive one-based turn number to tool assertions.`,
      });
      return [];
    }
    return Object.entries(rawToolAssertions).flatMap(([rawTool, rawAssertions]) => {
      const tool = typeof rawTool === 'string' ? rawTool.trim() : '';
      if (!tool || !Array.isArray(rawAssertions) || !rawAssertions.length) {
        addScenarioCheck(checks, {
          pass: false,
          code: 'verification-config-invalid',
          field: `${field}.${rawTurnNumber}.${rawTool || '<empty>'}`,
          message: `${field} tool entries must be non-empty assertion arrays.`,
        });
        return [];
      }
      const assertions = rawAssertions
        .map((assertion, index) => normalizeScenarioStructuredAssertion(
          assertion,
          `${field}.${rawTurnNumber}.${tool}[${index}]`,
          checks,
        ))
        .filter(Boolean);
      return assertions.length === rawAssertions.length ? [{ turnNumber, tool, assertions }] : [];
    });
  });
}

function scenarioValueAtPath(value, pathValue) {
  let current = value;
  for (const segment of pathValue.split('.')) {
    if (current === null || current === undefined || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return { found: false, value: undefined };
    }
    current = current[segment];
  }
  return { found: true, value: current };
}

function scenarioStructuredType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function scenarioStructuredValuesEqual(left, right) {
  return JSON.stringify(canonicalScenarioValue(left)) === JSON.stringify(canonicalScenarioValue(right));
}

function scenarioReferenceValue(events, targetEvent, reference) {
  const turnNumber = reference.turnNumber || targetEvent.turnNumber;
  const candidates = events.filter((event) => (
    event.turnNumber === turnNumber
    && event.tool === reference.tool
    && completedScenarioToolEvent(event)
    && (event.turnNumber < targetEvent.turnNumber || (
      event.turnNumber === targetEvent.turnNumber && event.eventIndex < targetEvent.eventIndex
    ))
  ));
  const sourceEvent = candidates[reference.callIndex - 1];
  if (!sourceEvent) return { found: false, value: undefined };
  for (const output of scenarioStructuredOutputValues(sourceEvent)) {
    const resolved = scenarioValueAtPath(output, reference.path);
    if (resolved.found) {
      if (!reference.valueMap) return resolved;
      const mapping = reference.valueMap.find((entry) => scenarioStructuredValuesEqual(entry.from, resolved.value));
      return mapping ? { found: true, value: mapping.to } : { found: false, value: undefined };
    }
  }
  return { found: false, value: undefined };
}

function scenarioProjectedItemsEqual(targetItems, sourceItems, reference) {
  if (!Array.isArray(targetItems) || !Array.isArray(sourceItems) || targetItems.length !== sourceItems.length) return false;
  const mappings = Object.entries(reference.fieldMap);
  const project = (item, source) => mappings.map(([targetPath, sourcePath]) => {
    const resolved = scenarioValueAtPath(item, source ? sourcePath : targetPath);
    return resolved.found ? { found: true, value: resolved.value } : { found: false };
  });
  const targetProjected = targetItems.map((item) => project(item, false));
  const sourceProjected = sourceItems.map((item) => project(item, true));
  if (reference.order === 'any') {
    const canonicalize = (entry) => JSON.stringify(canonicalScenarioValue(entry));
    return scenarioStructuredValuesEqual(
      targetProjected.map(canonicalize).sort(),
      sourceProjected.map(canonicalize).sort(),
    );
  }
  return scenarioStructuredValuesEqual(targetProjected, sourceProjected);
}

function scenarioStructuredAssertionMatches(rootValue, assertion, targetEvent, events) {
  const actual = scenarioValueAtPath(rootValue, assertion.path);
  if (scenarioOwn(assertion, 'exists') && actual.found !== assertion.exists) return false;
  if (!actual.found) return assertion.exists === false;
  if (scenarioOwn(assertion, 'equals') && !scenarioStructuredValuesEqual(actual.value, assertion.equals)) return false;
  if (assertion.type && scenarioStructuredType(actual.value) !== assertion.type) return false;
  if (assertion.minLength !== undefined && (typeof actual.value !== 'string' || actual.value.length < assertion.minLength)) return false;
  if (assertion.minItems !== undefined && (!Array.isArray(actual.value) || actual.value.length < assertion.minItems)) return false;
  if (assertion.equalsFrom) {
    const expected = scenarioReferenceValue(events, targetEvent, assertion.equalsFrom);
    if (!expected.found || !scenarioStructuredValuesEqual(actual.value, expected.value)) return false;
  }
  if (assertion.itemsEqualFrom) {
    const expected = scenarioReferenceValue(events, targetEvent, assertion.itemsEqualFrom);
    if (!expected.found || !scenarioProjectedItemsEqual(actual.value, expected.value, assertion.itemsEqualFrom)) return false;
  }
  return true;
}

function scenarioStructuredAssertionsMatch(rootValue, assertions, targetEvent, events) {
  return assertions.every((assertion) => scenarioStructuredAssertionMatches(rootValue, assertion, targetEvent, events));
}

function scenarioQuestionRequestCount(run) {
  const value = run?.questions?.value ?? run?.questions;
  if (Array.isArray(value)) return value.length;
  return Array.isArray(value?.questions) ? value.questions.length : 0;
}

function normalizeScenarioExactSectionReadRules(value, field, checks) {
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
  return Object.entries(value).flatMap(([rawTurnNumber, rawRule]) => {
    const turnNumber = Number(rawTurnNumber);
    const searchTool = typeof rawRule?.searchTool === 'string' ? rawRule.searchTool.trim() : '';
    const sectionTool = typeof rawRule?.sectionTool === 'string' ? rawRule.sectionTool.trim() : '';
    const expectedReferenceId = typeof rawRule?.expectedReferenceId === 'string' ? rawRule.expectedReferenceId.trim() : '';
    const unknownFields = rawRule && typeof rawRule === 'object' && !Array.isArray(rawRule)
      ? Object.keys(rawRule).filter((key) => !['searchTool', 'sectionTool', 'expectedReferenceId'].includes(key))
      : [];
    if (!Number.isInteger(turnNumber) || turnNumber < 1 || !searchTool || !sectionTool || !expectedReferenceId || unknownFields.length) {
      addScenarioCheck(checks, {
        pass: false,
        code: 'verification-config-invalid',
        field: `${field}.${rawTurnNumber}`,
        message: `${field} entries require positive turn numbers plus searchTool, sectionTool, and expectedReferenceId only.`,
      });
      return [];
    }
    return [{ turnNumber, searchTool, sectionTool, expectedReferenceId }];
  });
}

function exactSectionReadCandidateMatches(searchEvent, sectionEvent, expectedReferenceId) {
  const sectionInput = scenarioStructuredInput(sectionEvent);
  if (!sectionInput || typeof sectionInput.referenceId !== 'string' || typeof sectionInput.sectionId !== 'string') return [];
  const requestedReferenceId = sectionInput.referenceId.trim();
  const requestedSectionId = sectionInput.sectionId.trim();
  if (requestedReferenceId !== expectedReferenceId || !requestedSectionId) return [];
  const sectionOutputs = scenarioStructuredOutputValues(sectionEvent)
    .filter((output) => output.contract === 'DefGameKnowledgeSectionReadV1');
  const sectionOutputMatches = sectionOutputs.some((output) => (
    output.referenceId === requestedReferenceId
    && output.section?.sectionId === requestedSectionId
  ));
  if (!sectionOutputMatches) return [];
  return scenarioStructuredOutputValues(searchEvent)
    .filter((output) => output.contract === 'DefGameKnowledgeReferenceSearchV1' && Array.isArray(output.candidates))
    .flatMap((output) => output.candidates)
    .filter((candidate) => (
      candidate
      && candidate.referenceId === requestedReferenceId
      && candidate.exactReadPolicy?.requiredSectionId === requestedSectionId
    ));
}

function normalizeScenarioClauseRule(value, field, checks) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    addScenarioCheck(checks, {
      pass: false,
      code: 'verification-config-invalid',
      field,
      message: `${field} must be an object with allOf and optional anyOf/noneOf text lists.`,
    });
    return null;
  }
  const unknownFields = Object.keys(value).filter((key) => !['allOf', 'anyOf', 'noneOf'].includes(key));
  if (unknownFields.length) {
    addScenarioCheck(checks, {
      pass: false,
      code: 'verification-config-invalid',
      field,
      message: `${field} contains unsupported fields: ${unknownFields.join(', ')}.`,
    });
    return null;
  }
  const allOf = scenarioTextList(value.allOf, `${field}.allOf`, checks);
  const anyOf = value.anyOf === undefined ? [] : scenarioTextList(value.anyOf, `${field}.anyOf`, checks);
  const noneOf = value.noneOf === undefined ? [] : scenarioTextList(value.noneOf, `${field}.noneOf`, checks);
  if (!allOf.length || (value.anyOf !== undefined && !anyOf.length) || (value.noneOf !== undefined && !noneOf.length)) {
    return null;
  }
  return { allOf, anyOf, noneOf };
}

function normalizeScenarioTurnClauseRules(value, field, checks) {
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
  return Object.entries(value).flatMap(([rawTurnNumber, rawRules]) => {
    const turnNumber = Number(rawTurnNumber);
    if (!Number.isInteger(turnNumber) || turnNumber < 1) {
      addScenarioCheck(checks, {
        pass: false,
        code: 'verification-config-invalid',
        field: `${field}.${rawTurnNumber}`,
        message: `${field} keys must be positive one-based turn numbers.`,
      });
      return [];
    }
    if (!Array.isArray(rawRules) || !rawRules.length) {
      addScenarioCheck(checks, {
        pass: false,
        code: 'verification-config-invalid',
        field: `${field}.${rawTurnNumber}`,
        message: `${field} entries must be non-empty arrays of clause rules.`,
      });
      return [];
    }
    const rules = rawRules
      .map((rule, index) => normalizeScenarioClauseRule(rule, `${field}.${rawTurnNumber}[${index}]`, checks))
      .filter(Boolean);
    return rules.length === rawRules.length ? [{ turnNumber, rules }] : [];
  });
}

function scenarioClauseMatches(clause, rule) {
  return rule.allOf.every((text) => clause.includes(text))
    && (!rule.anyOf.length || rule.anyOf.some((text) => clause.includes(text)))
    && rule.noneOf.every((text) => !clause.includes(text));
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

  const requiredToolInputAssertionsByTurn = normalizeScenarioTurnStructuredAssertionRules(
    verification.requiredToolInputAssertionsByTurn,
    'requiredToolInputAssertionsByTurn',
    checks,
  );
  for (const rule of requiredToolInputAssertionsByTurn) {
    const observedEvents = events.filter((event) => (
      event.turnNumber === rule.turnNumber
      && event.tool === rule.tool
      && completedScenarioToolEvent(event)
    ));
    const matchingCalls = observedEvents.filter((event) => {
      const input = scenarioStructuredInput(event);
      return input && scenarioStructuredAssertionsMatch(input, rule.assertions, event, events);
    });
    addScenarioCheck(checks, {
      pass: matchingCalls.length > 0,
      code: 'required-turn-tool-input-assertions-missing',
      tool: rule.tool,
      turnNumber: rule.turnNumber,
      assertions: rule.assertions,
      observedCompletedCalls: observedEvents.length,
      matchingCalls: matchingCalls.length,
    });
  }

  const requiredToolResultAssertionsByTurn = normalizeScenarioTurnStructuredAssertionRules(
    verification.requiredToolResultAssertionsByTurn,
    'requiredToolResultAssertionsByTurn',
    checks,
  );
  for (const rule of requiredToolResultAssertionsByTurn) {
    const observedEvents = events.filter((event) => (
      event.turnNumber === rule.turnNumber
      && event.tool === rule.tool
      && completedScenarioToolEvent(event)
    ));
    const matchingCalls = observedEvents.filter((event) => (
      scenarioStructuredOutputValues(event)
        .some((output) => scenarioStructuredAssertionsMatch(output, rule.assertions, event, events))
    ));
    addScenarioCheck(checks, {
      pass: matchingCalls.length > 0,
      code: 'required-turn-tool-result-assertions-missing',
      tool: rule.tool,
      turnNumber: rule.turnNumber,
      assertions: rule.assertions,
      observedCompletedCalls: observedEvents.length,
      matchingCalls: matchingCalls.length,
    });
  }

  const requiredExactSectionReadsByTurn = normalizeScenarioExactSectionReadRules(
    verification.requiredExactSectionReadByTurn,
    'requiredExactSectionReadByTurn',
    checks,
  );
  for (const rule of requiredExactSectionReadsByTurn) {
    const sameTurn = events.filter((event) => event.turnNumber === rule.turnNumber);
    const searches = sameTurn.filter((event) => event.tool === rule.searchTool && completedScenarioToolEvent(event));
    const sectionReads = sameTurn.filter((event) => event.tool === rule.sectionTool && completedScenarioToolEvent(event));
    const matchedCandidates = sectionReads.flatMap((sectionEvent) => searches
      .filter((searchEvent) => searchEvent.eventIndex < sectionEvent.eventIndex)
      .flatMap((searchEvent) => exactSectionReadCandidateMatches(searchEvent, sectionEvent, rule.expectedReferenceId)));
    addScenarioCheck(checks, {
      pass: matchedCandidates.length > 0,
      code: 'required-exact-section-read-missing',
      turnNumber: rule.turnNumber,
      searchTool: rule.searchTool,
      sectionTool: rule.sectionTool,
      expectedReferenceId: rule.expectedReferenceId,
      expected: 'completed-section-input-and-output-match-the-expected-reference-from-one-prior-search-candidate-exactReadPolicy.requiredSectionId',
      observedSearchCalls: searches.length,
      observedSectionReadCalls: sectionReads.length,
      matchedCandidates: matchedCandidates.map((candidate) => ({
        referenceId: candidate.referenceId,
        requiredSectionId: candidate.exactReadPolicy.requiredSectionId,
      })),
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

  const requiredFinalClausesByTurn = normalizeScenarioTurnClauseRules(
    verification.requiredFinalAssistantClausesByTurn,
    'requiredFinalAssistantClausesByTurn',
    checks,
  );
  for (const turnRule of requiredFinalClausesByTurn) {
    const clauses = scenarioFinalVisibleAssistantClauses(run?.turns?.[turnRule.turnNumber - 1]);
    for (const rule of turnRule.rules) {
      addScenarioCheck(checks, {
        pass: clauses.some((clause) => scenarioClauseMatches(clause, rule)),
        code: 'required-final-assistant-clause-missing',
        rule,
        observedClauses: clauses,
        turnNumber: turnRule.turnNumber,
      });
    }
  }

  const forbiddenFinalClausesByTurn = normalizeScenarioTurnClauseRules(
    verification.forbiddenFinalAssistantClausesByTurn,
    'forbiddenFinalAssistantClausesByTurn',
    checks,
  );
  for (const turnRule of forbiddenFinalClausesByTurn) {
    const clauses = scenarioFinalVisibleAssistantClauses(run?.turns?.[turnRule.turnNumber - 1]);
    for (const rule of turnRule.rules) {
      const matchedClauses = clauses.filter((clause) => scenarioClauseMatches(clause, rule));
      addScenarioCheck(checks, {
        pass: !matchedClauses.length,
        code: 'forbidden-final-assistant-clause-present',
        rule,
        matchedClauses,
        turnNumber: turnRule.turnNumber,
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

  const maxQuestionRequests = verification.maxQuestionRequests;
  if (maxQuestionRequests !== undefined && (!Number.isInteger(maxQuestionRequests) || maxQuestionRequests < 0)) {
    addScenarioCheck(checks, {
      pass: false,
      code: 'verification-config-invalid',
      field: 'maxQuestionRequests',
      message: 'maxQuestionRequests must be a non-negative integer.',
    });
  } else if (maxQuestionRequests !== undefined) {
    const actual = scenarioQuestionRequestCount(run);
    addScenarioCheck(checks, {
      pass: actual <= maxQuestionRequests,
      code: 'max-question-requests-exceeded',
      expectedMaximum: maxQuestionRequests,
      actual,
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
  const configurationInvalid = failures.some((failure) => failure.code === 'verification-config-invalid');
  return {
    kind: 'DefHarnessScenarioVerificationV1',
    scenarioId: scenario?.id || run?.scenarioId || null,
    scenarioVersion: Number(scenario?.version || run?.scenarioVersion || 1),
    status: configurationInvalid ? 'ERROR_VERIFIER' : failures.length ? 'FAIL' : 'PASS',
    ok: failures.length === 0,
    checks,
    failures,
    observed: {
      attemptedToolCounts: Object.fromEntries(Object.entries(attemptedCounts).sort(([left], [right]) => left.localeCompare(right))),
      completedToolCounts: Object.fromEntries(Object.entries(completedCounts).sort(([left], [right]) => left.localeCompare(right))),
      questionRequestCount: scenarioQuestionRequestCount(run),
    },
  };
}

export function validateScenarioVerificationConfiguration(scenario) {
  const evaluated = evaluateScenarioVerification({ turns: [] }, scenario);
  const failures = evaluated.failures.filter((failure) => failure.code === 'verification-config-invalid');
  return {
    kind: 'DefHarnessScenarioVerificationConfigurationV1',
    scenarioId: scenario?.id || null,
    scenarioVersion: Number(scenario?.version || 1),
    status: failures.length ? 'ERROR_VERIFIER' : 'PASS',
    ok: failures.length === 0,
    failures,
  };
}

export function applyScenarioVerification(run, scenario) {
  const verification = evaluateScenarioVerification(run, scenario);
  return {
    ...run,
    verification,
    status: verification.status === 'ERROR_VERIFIER'
      ? 'ERROR_VERIFIER'
      : run?.status === 'EXECUTED' && !verification.ok ? 'FAIL_AGENT' : run?.status,
  };
}

function activeCurrentReadonlyScenarioAllowlist(scenario) {
  if (scenario?.fixtureMode !== 'active-current-readonly') return [];
  const rules = scenario?.verification?.onlyToolsByTurn;
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) {
    throw error('ERROR_SCENARIO', 'active-current-readonly requires verification.onlyToolsByTurn for every Scenario turn.');
  }
  const union = new Set();
  for (let index = 0; index < scenario.turns.length; index += 1) {
    const tools = rules[String(index + 1)];
    if (!Array.isArray(tools) || !tools.length || tools.some((tool) => typeof tool !== 'string' || !tool.trim())) {
      throw error('ERROR_SCENARIO', `active-current-readonly requires a non-empty onlyToolsByTurn.${index + 1} allowlist.`);
    }
    for (const tool of tools) union.add(tool.trim());
  }
  if (Object.keys(rules).some((key) => !/^[1-9]\d*$/.test(key) || Number(key) > scenario.turns.length)) {
    throw error('ERROR_SCENARIO', 'active-current-readonly onlyToolsByTurn contains a turn outside the Scenario.');
  }
  return [...union].sort();
}

export async function runNativeScenario({ scenario, harnessSelector = 'stable', cleanup = true, timeoutMs = 90000 } = {}) {
  if (!scenario?.id || !Array.isArray(scenario.turns) || !scenario.turns.length) throw error('HARNESS_SCENARIO_INVALID', 'Native Scenario requires a scenario id and user turns.');
  const runId = `native-harness-run-${crypto.randomUUID()}`;
  const startedAt = Date.now(); let token = ''; let runner = null;
  const run = { kind: 'DefHarnessNativeScenarioRunV1', runId, scenarioId: scenario.id, scenarioVersion: Number(scenario.version || 1), selector: harnessSelector, createdAt: startedAt, sources: ['harness'], status: 'INCOMPLETE', turns: [], events: [], questions: [], cleanup: { requested: cleanup, completed: false } };
  try {
    run.verifierConfiguration = validateScenarioVerificationConfiguration(scenario);
    if (!run.verifierConfiguration.ok) {
      throw error('ERROR_VERIFIER', 'Scenario verification configuration is invalid.', {
        failures: run.verifierConfiguration.failures,
      });
    }
    const status = await request('GET', '/def-agent/interop/v1/status');
    run.readiness = { source: 'interop', status };
    if (!status.agent?.ready) throw error('BLOCKED_ENVIRONMENT', 'DEF sidecar is not ready.');
    if (scenario.requiresSnapshot === true && status.workbench?.snapshotAvailable !== true) {
      throw error('BLOCKED_ENVIRONMENT', 'This Scenario requires an available Workbench snapshot.', { code: 'snapshot-unavailable' });
    }
    token = await authorize();
    const before = await request('GET', '/def-agent/interop/v1/state', undefined, token);
    run.stateBefore = { source: 'snapshot', value: before };
    const scenarioToolAllowlist = activeCurrentReadonlyScenarioAllowlist(scenario);
    runner = (await request('POST', '/def-agent/interop/v1/harness/sessions', { harnessSelector, fixtureMode: scenario.fixtureMode || 'empty', scenarioToolAllowlist }, token)).runner;
    run.fixture = { source: 'harness', fixtureId: runner.fixtureId, timelineId: runner.timelineId, mode: runner.fixtureMode, boundNodeId: runner.boundNodeId, projection: runner.projection || null };
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
    run.status = caught.code === 'BLOCKED_ENVIRONMENT'
      ? 'BLOCKED_ENVIRONMENT'
      // Run status stays within the established Harness outcome vocabulary;
      // retain ERROR_SCENARIO as the precise error code for diagnostics.
      : caught.code === 'ERROR_VERIFIER' || caught.code === 'ERROR_SCENARIO'
        ? 'ERROR_VERIFIER'
        : 'ERROR_PROTOCOL';
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
