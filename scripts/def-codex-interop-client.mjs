import crypto from 'node:crypto';

const baseUrl = String(process.env.DEF_INTEROP_URL || 'http://127.0.0.1:31457').replace(/\/$/, '');
const [command = 'status', ...arguments_] = process.argv.slice(2);

function output(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function fail(message, details = {}) {
  output({ ok: false, message, ...details });
  process.exitCode = 1;
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.json().catch(() => ({ ok: false, error: { code: 'invalid-json-response' } }));
  if (!response.ok || body.ok === false) {
    const error = new Error(body?.error?.message || `Interop request failed with ${response.status}.`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

async function authorizationHeaders() {
  const authorization = await request('/def-agent/interop/v1/authorize', { method: 'POST' });
  return { authorization: `Bearer ${authorization.token}`, 'content-type': 'application/json' };
}

function clientTurnId() {
  return `codex-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

async function start(text, sessionId = '', establishOnSession = false) {
  if (!text) throw new Error('Provide non-empty user text.');
  const headers = await authorizationHeaders();
  const path = sessionId && !establishOnSession
    ? `/def-agent/interop/v1/sessions/${encodeURIComponent(sessionId)}/turns`
    : '/def-agent/interop/v1/turns';
  return request(path, {
    method: 'POST', headers,
    body: JSON.stringify({ protocolVersion: 1, ...(establishOnSession ? { sessionId } : {}), rawUserText: text, clientTurnId: clientTurnId(), ingressMode: 'pure-blackbox' }),
  });
}

async function stop(sessionId, turnId) {
  if (!sessionId || !turnId) throw new Error('stop requires <sessionId> <turnId>.');
  return request(`/def-agent/interop/v1/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/stop`, {
    method: 'POST', headers: await authorizationHeaders(),
  });
}

async function read(path) {
  return request(path, { headers: await authorizationHeaders() });
}

try {
  if (command === 'status') output(await request('/def-agent/interop/v1/status'));
  else if (command === 'state') output(await read('/def-agent/interop/v1/state'));
  else if (command === 'hello') output(await start('你好'));
  else if (command === 'start') output(await start(arguments_.join(' ')));
  else if (command === 'start-session') output(await start(arguments_.slice(1).join(' '), arguments_[0], true));
  else if (command === 'continue') output(await start(arguments_.slice(1).join(' '), arguments_[0]));
  else if (command === 'stop') output(await stop(arguments_[0], arguments_[1]));
  else if (command === 'transcript') {
    if (!arguments_[0]) throw new Error('transcript requires <sessionId>.');
    output(await read(`/def-agent/interop/v1/sessions/${encodeURIComponent(arguments_[0])}/transcript`));
  } else if (command === 'questions') {
    if (!arguments_[0]) throw new Error('questions requires <sessionId>.');
    output(await read(`/def-agent/interop/v1/sessions/${encodeURIComponent(arguments_[0])}/questions`));
  } else {
    fail('Unknown command.', { command, usage: 'status | state | hello | start <text> | start-session <sessionId> <text> | continue <sessionId> <text> | stop <sessionId> <turnId> | transcript <sessionId> | questions <sessionId>' });
  }
} catch (error) {
  fail(error.message, { status: error.status, error: error.body?.error });
}
