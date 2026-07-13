const crypto = require('crypto');

const PROTOCOL = 'def-codex-interop';
const PROTOCOL_VERSION = 1;
const CAPABILITIES = Object.freeze([
  'turn.start', 'turn.continue', 'turn.stop', 'events.subscribe',
  'transcript.read', 'state.read', 'ui-events.subscribe',
]);
const CLIENT_TURN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function createError(code, message, component, options = {}) {
  return {
    code,
    message,
    component,
    retryable: Boolean(options.retryable),
    ids: options.ids || {},
    ...(options.nextAction ? { nextAction: options.nextAction } : {}),
  };
}

function isDevelopmentProfile(value) {
  return !['production', 'release'].includes(String(value || '').toLowerCase());
}

function createDefCodexInteropProtocol(options) {
  const runs = new Map();
  const turnsByClient = new Map();
  const consumers = new Map();
  const events = [];
  const clients = new Set();
  const audit = [];
  const tokens = new Map();
  let seq = 0;

  const developmentOnly = isDevelopmentProfile(options.profile);
  const baseUrl = options.baseUrl.replace(/\/$/, '');

  function idsFor(record = {}) {
    return {
      ...(record.testRunId ? { testRunId: record.testRunId } : {}),
      ...(record.sessionId ? { sessionId: record.sessionId } : {}),
      ...(record.turnId ? { turnId: record.turnId } : {}),
      ...(record.clientTurnId ? { clientTurnId: record.clientTurnId } : {}),
    };
  }

  function emit(kind, record = {}, payload = {}) {
    const event = {
      protocol: PROTOCOL,
      protocolVersion: PROTOCOL_VERSION,
      seq: ++seq,
      cursor: String(seq),
      at: Date.now(),
      type: kind,
      ...idsFor(record),
      payload,
    };
    events.push(event);
    if (events.length > 256) events.splice(0, events.length - 256);
    for (const client of clients) {
      try { options.writeSse(client, kind, event); } catch { clients.delete(client); }
    }
    return event;
  }

  function appendAudit(action, record, result) {
    audit.push({ at: Date.now(), action, ingressMode: record?.ingressMode, ...idsFor(record), result });
    if (audit.length > 512) audit.splice(0, audit.length - 512);
  }

  function json(response, status, payload) { options.writeJson(response, status, payload); }

  function reject(response, status, error) {
    json(response, status, { ok: false, protocol: PROTOCOL, protocolVersion: PROTOCOL_VERSION, error });
  }

  function authorize(request, response) {
    const host = String(request.headers.host || '');
    const origin = String(request.headers.origin || '');
    if ((host && !/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host)) || (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin))) {
      reject(response, 403, createError('teacher-local-origin-required', 'Teacher ingress accepts loopback Host and Origin only.', 'bridge'));
      return false;
    }
    const supplied = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const expiry = tokens.get(supplied);
    if (!supplied || !expiry || expiry <= Date.now()) {
      reject(response, 401, createError('teacher-authorization-required', 'A current local teacher authorization is required.', 'bridge', {
        retryable: true,
        nextAction: 'POST /def-agent/interop/v1/authorize from loopback, then retry with Authorization: Bearer <token>.',
      }));
      return false;
    }
    return true;
  }

  function validateRequest(body, continuation) {
    if (body?.protocolVersion !== undefined && Number(body.protocolVersion) !== PROTOCOL_VERSION) {
      return createError('unsupported-protocol-version', `Only protocolVersion ${PROTOCOL_VERSION} is supported.`, 'protocol');
    }
    const rawUserText = typeof body?.rawUserText === 'string' ? body.rawUserText.trim() : '';
    const clientTurnId = typeof body?.clientTurnId === 'string' ? body.clientTurnId.trim() : '';
    if (!rawUserText) return createError('missing-user-text', 'rawUserText must be a non-empty string.', 'protocol');
    if (!CLIENT_TURN_ID.test(clientTurnId)) return createError('invalid-client-turn-id', 'clientTurnId must be 1-128 URL-safe identifier characters.', 'protocol');
    if (!continuation && body?.sessionId !== undefined && typeof body.sessionId !== 'string') {
      return createError('invalid-session-id', 'sessionId must be a string when present.', 'protocol');
    }
    const ingressMode = body?.ingressMode || 'pure-blackbox';
    if (!['pure-blackbox', 'diagnostic'].includes(ingressMode)) {
      return createError('invalid-ingress-mode', 'ingressMode must be pure-blackbox or diagnostic.', 'protocol');
    }
    if (ingressMode === 'diagnostic' && (!body?.diagnostic || typeof body.diagnostic.purpose !== 'string')) {
      return createError('invalid-diagnostic-request', 'Diagnostic turns require diagnostic.purpose.', 'protocol');
    }
    return null;
  }

  async function snapshot() {
    try {
      const response = await options.fetchJson(options.snapshotUrl);
      if (response.status >= 200 && response.status < 300 && response.body?.ok !== false) {
        const value = response.body?.snapshot || response.body?.data || response.body;
        return { available: true, value };
      }
    } catch {}
    return { available: false, value: null };
  }

  function summarizeState(value) {
    const snapshot = value && typeof value === 'object' ? value : {};
    const operators = Array.isArray(snapshot.selectedCharacters)
      ? snapshot.selectedCharacters.slice(0, 32).map((item) => ({ id: item?.id || '', name: item?.name || '' }))
      : Array.isArray(snapshot.operators)
        ? snapshot.operators.slice(0, 32).map((item) => ({ id: item?.id || '', name: item?.name || '' }))
        : [];
    return {
      checkout: snapshot.checkout || snapshot.checkoutRef || snapshot.currentCheckout || null,
      revision: snapshot.revision || snapshot.checkoutRevision || null,
      selectedOperators: operators,
      pending: snapshot.pendingApproval || snapshot.pendingNode || snapshot.pendingCommand || null,
    };
  }

  async function observeTurn(record) {
    let firstToken = false;
    const seenTools = new Set();
    for (let attempt = 0; attempt < 90 && record.status === 'accepted'; attempt += 1) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 1000);
        timer.unref?.();
      });
      try {
        const upstream = await options.fetchJson(`${options.sidecarUrl}/api/native/session/${encodeURIComponent(record.sessionId)}/interop-transcript`);
        const messages = Array.isArray(upstream.body?.messages) ? upstream.body.messages : [];
        const latest = messages[messages.length - 1];
        const parts = Array.isArray(latest?.parts) ? latest.parts : [];
        for (const part of parts) {
          if (!firstToken && part?.type === 'text' && String(part.text || '').trim()) {
            firstToken = true;
            emit('response-first-token', record, {});
          }
          if (String(part?.type || '').includes('tool')) {
            const toolKey = String(part.callID || part.id || part.tool || JSON.stringify(part.input || {}));
            if (!seenTools.has(toolKey)) { seenTools.add(toolKey); emit('tool-start', record, { tool: part.tool || part.name || 'native-tool' }); }
            if (part.state?.status === 'completed' || part.status === 'completed') emit('tool-result', record, { tool: part.tool || part.name || 'native-tool' });
            if (part.state?.status === 'error' || part.status === 'error') emit('tool-error', record, { tool: part.tool || part.name || 'native-tool' });
          }
        }
        if (latest?.info?.time?.completed || latest?.info?.completedAt) {
          record.status = 'completed'; appendAudit('turn.completed', record, 'completed'); emit('completed', record, {}); return;
        }
      } catch {
        // A transient transcript read does not cancel the native OpenCode run.
      }
    }
    if (record.status === 'accepted') { record.status = 'timeout'; appendAudit('turn.timeout', record, 'timeout'); emit('timeout', record, { component: 'provider' }); }
  }

  function currentConsumer(sessionId = '') {
    const list = [...consumers.values()]
      .filter((consumer) => consumer.host === 'workbench' && (!sessionId || consumer.sessionId === sessionId))
      .sort((left, right) => right.updatedAt - left.updatedAt);
    return list[0] || null;
  }

  async function startOrContinue(request, response, body, continuation) {
    if (!developmentOnly) {
      reject(response, 403, createError('teacher-ingress-disabled', 'Teacher ingress is disabled outside development/test profiles.', 'bridge'));
      return true;
    }
    if (!authorize(request, response)) return true;
    const validation = validateRequest(body, continuation);
    if (validation) { reject(response, 400, validation); return true; }

    const sessionId = continuation ? String(body.sessionId || '').trim() : String(body.sessionId || '').trim();
    const consumer = currentConsumer(sessionId);
    if (!consumer) {
      reject(response, 409, createError('ui-consumer-unavailable', 'No current DEF OpenCode Workbench UI consumer is registered for this session.', 'ui-consumer', {
        retryable: true,
        ids: sessionId ? { sessionId } : {},
        nextAction: 'Open the Workbench AI mode and wait for DEF OpenCode ready before starting this turn.',
      }));
      return true;
    }
    if (continuation && !runs.has(consumer.sessionId)) {
      reject(response, 404, createError('interop-session-not-found', 'This native session has no active DefCodexInteropProtocol run.', 'session', { ids: { sessionId: consumer.sessionId } }));
      return true;
    }

    const idempotencyKey = `${consumer.sessionId}:${body.clientTurnId}`;
    const existing = turnsByClient.get(idempotencyKey);
    if (existing) {
      json(response, 200, { ok: true, protocol: PROTOCOL, protocolVersion: PROTOCOL_VERSION, idempotent: true, turn: existing.response });
      return true;
    }

    const state = await snapshot();
    const run = runs.get(consumer.sessionId) || {
      testRunId: crypto.randomUUID(), sessionId: consumer.sessionId, host: 'workbench', createdAt: Date.now(), turns: [],
    };
    runs.set(consumer.sessionId, run);
    const record = {
      testRunId: run.testRunId,
      sessionId: consumer.sessionId,
      turnId: crypto.randomUUID(),
      clientTurnId: body.clientTurnId,
      ingressMode: body.ingressMode || 'pure-blackbox',
      rawUserText: body.rawUserText.trim(),
      providerVisibleUserText: body.rawUserText.trim(),
      snapshotAvailable: state.available,
      status: 'accepted',
      acceptedAt: Date.now(),
    };
    // Pure Blackbox deliberately has no per-message system/tutorial injection.
    const diagnostic = record.ingressMode === 'diagnostic' ? {
      purpose: String(body.diagnostic.purpose).slice(0, 240),
      scope: typeof body.diagnostic.scope === 'string' ? body.diagnostic.scope.slice(0, 240) : '',
      mutationAllowed: body.diagnostic.mutationAllowed === true,
    } : null;
    record.diagnostic = diagnostic;
    if (diagnostic?.mutationAllowed && !state.available) {
      reject(response, 409, createError('snapshot-unavailable', 'Mutation preview is blocked because the Workbench snapshot is unavailable.', 'snapshot', {
        retryable: true, ids: idsFor(record), nextAction: 'Restore the Workbench snapshot service, then retry the same clientTurnId.',
      }));
      return true;
    }
    const sidecar = await options.postJson(`${options.sidecarUrl}/api/native/session/${encodeURIComponent(record.sessionId)}/interop-prompt`, {
      rawUserText: record.rawUserText,
      providerVisibleUserText: record.providerVisibleUserText,
      ingressMode: record.ingressMode,
      diagnostic,
      thinkingEffort: body.thinkingEffort,
      correlation: idsFor(record),
    });
    if (sidecar.status < 200 || sidecar.status >= 300 || sidecar.body?.ok === false) {
      reject(response, sidecar.status === 404 ? 404 : 502, createError('sidecar-turn-rejected', sidecar.body?.error || 'The DEF OpenCode sidecar rejected the turn.', 'sidecar', {
        retryable: sidecar.status >= 500, ids: idsFor(record), nextAction: 'Check sidecar status and retry the same clientTurnId only after it is ready.',
      }));
      return true;
    }
    record.providerVisibleMessages = sidecar.body?.providerVisibleMessages || [{ role: 'user', text: record.providerVisibleUserText }];
    record.response = {
      accepted: true,
      testRunId: record.testRunId,
      sessionId: record.sessionId,
      turnId: record.turnId,
      clientTurnId: record.clientTurnId,
      ingressMode: record.ingressMode,
      rawUserText: record.rawUserText,
      providerVisibleUserText: record.providerVisibleUserText,
      ...(record.ingressMode === 'diagnostic' ? { diagnostic, providerVisibleMessages: record.providerVisibleMessages } : {}),
      snapshotAvailable: record.snapshotAvailable,
      eventCursor: String(seq + 1),
      links: {
        events: `${baseUrl}/def-agent/interop/v1/sessions/${encodeURIComponent(record.sessionId)}/events`,
        transcript: `${baseUrl}/def-agent/interop/v1/sessions/${encodeURIComponent(record.sessionId)}/transcript`,
        state: `${baseUrl}/def-agent/interop/v1/state`,
        uiEvents: `${baseUrl}/def-agent/interop/v1/ui-events`,
      },
    };
    run.turns.push(record);
    turnsByClient.set(idempotencyKey, record);
    appendAudit(continuation ? 'turn.continue' : 'turn.start', record, 'accepted');
    emit('accepted', record, { ingressMode: record.ingressMode, snapshotAvailable: record.snapshotAvailable });
    if (!continuation) emit('session-created', record, { host: 'workbench', nativeSession: true });
    if (!state.available) emit('snapshot-unavailable', record, { source: 'workbench-snapshot' });
    emit('ui-prompt-consumed', record, { uiConsumerId: consumer.id, nativeSession: true });
    void observeTurn(record);
    json(response, 202, { ok: true, protocol: PROTOCOL, protocolVersion: PROTOCOL_VERSION, turn: record.response });
    return true;
  }

  async function status(response) {
    let sidecar = { ready: false, state: 'not-started' };
    try {
      const health = await options.fetchJson(`${options.sidecarUrl}/health`);
      sidecar = health.status === 200 && health.body?.ok
        ? { ready: true, state: 'ready', version: health.body?.service || 'def-agent-sidecar' }
        : { ready: false, state: health.status ? 'unhealthy' : 'not-started' };
    } catch {}
    const state = await snapshot();
    json(response, 200, {
      ok: true, protocol: PROTOCOL, protocolVersion: PROTOCOL_VERSION, developmentOnly: true,
      bridge: { ready: true, version: options.bridgeVersion || 'local' }, agent: sidecar,
      workbench: { snapshotAvailable: state.available, uiConnected: currentConsumer() !== null, uiConsumerCount: consumers.size },
      capabilities: CAPABILITIES,
      authorization: { required: true, authorizeUrl: `${baseUrl}/def-agent/interop/v1/authorize`, expiresInSeconds: 900 },
    });
  }

  async function handle(request, response, requestUrl, readBody) {
    const method = request.method || 'GET';
    const path = requestUrl.pathname;
    if (method === 'GET' && path === '/def-agent/interop/v1/status') { await status(response); return true; }
    if (method === 'POST' && path === '/def-agent/interop/v1/authorize') {
      if (!developmentOnly) { reject(response, 403, createError('teacher-ingress-disabled', 'Teacher ingress is disabled outside development/test profiles.', 'bridge')); return true; }
      const token = crypto.randomBytes(24).toString('base64url');
      tokens.set(token, Date.now() + 15 * 60 * 1000);
      json(response, 201, { ok: true, protocol: PROTOCOL, protocolVersion: PROTOCOL_VERSION, token, expiresAt: Date.now() + 15 * 60 * 1000 });
      return true;
    }
    if (method === 'POST' && path === '/def-agent/workbench-test/prompt') {
      const legacy = await readBody(request);
      return startOrContinue(request, response, {
        protocolVersion: legacy.protocolVersion,
        sessionId: legacy.sessionId,
        rawUserText: legacy.rawUserText || legacy.message || legacy.prompt,
        clientTurnId: legacy.clientTurnId,
        thinkingEffort: legacy.thinkingEffort,
        ingressMode: legacy.ingressMode || 'pure-blackbox',
        diagnostic: legacy.diagnostic,
      }, Boolean(legacy.sessionId));
    }
    if (method === 'POST' && path === '/def-agent/interop/v1/turns') return startOrContinue(request, response, await readBody(request), false);
    const continueMatch = /^\/def-agent\/interop\/v1\/sessions\/([^/]+)\/turns$/.exec(path);
    if (method === 'POST' && continueMatch) {
      const body = await readBody(request);
      body.sessionId = decodeURIComponent(continueMatch[1]);
      return startOrContinue(request, response, body, true);
    }
    const stopMatch = /^\/def-agent\/interop\/v1\/sessions\/([^/]+)\/turns\/([^/]+)\/stop$/.exec(path);
    if (method === 'POST' && stopMatch) {
      if (!authorize(request, response)) return true;
      const sessionId = decodeURIComponent(stopMatch[1]);
      const turnId = decodeURIComponent(stopMatch[2]);
      const record = [...turnsByClient.values()].find((turn) => turn.sessionId === sessionId && turn.turnId === turnId);
      if (!record) { reject(response, 404, createError('turn-not-found', 'Turn was not found.', 'session', { ids: { sessionId, turnId } })); return true; }
      if (['completed', 'stopped'].includes(record.status)) {
        json(response, 200, { ok: true, protocol: PROTOCOL, protocolVersion: PROTOCOL_VERSION, status: `already-${record.status}`, ids: idsFor(record) }); return true;
      }
      const upstream = await options.postJson(`${options.sidecarUrl}/api/native/session/${encodeURIComponent(sessionId)}/interop-stop`, {});
      record.status = 'stopped'; appendAudit('turn.stop', record, 'stopped'); emit('stopped', record, { reason: upstream.body?.reason || 'requested' });
      json(response, 200, { ok: true, protocol: PROTOCOL, protocolVersion: PROTOCOL_VERSION, status: 'stopped', ids: idsFor(record) }); return true;
    }
    const transcriptMatch = /^\/def-agent\/interop\/v1\/sessions\/([^/]+)\/transcript$/.exec(path);
    if (method === 'GET' && transcriptMatch) {
      const sessionId = decodeURIComponent(transcriptMatch[1]);
      const run = runs.get(sessionId);
      if (!run) { reject(response, 404, createError('interop-session-not-found', 'No protocol run exists for this session.', 'session', { ids: { sessionId } })); return true; }
      const upstream = await options.fetchJson(`${options.sidecarUrl}/api/native/session/${encodeURIComponent(sessionId)}/interop-transcript`);
      json(response, upstream.status || 502, { ok: upstream.status >= 200 && upstream.status < 300, protocol: PROTOCOL, protocolVersion: PROTOCOL_VERSION, testRunId: run.testRunId, sessionId, turns: run.turns.map((turn) => ({ ...idsFor(turn), ingressMode: turn.ingressMode, rawUserText: turn.rawUserText, providerVisibleUserText: turn.providerVisibleUserText, ...(turn.ingressMode === 'diagnostic' ? { diagnostic: turn.diagnostic, providerVisibleMessages: turn.providerVisibleMessages } : {}), status: turn.status })), transcript: upstream.body?.messages || [] }); return true;
    }
    if (method === 'GET' && path === '/def-agent/interop/v1/state') {
      const state = await snapshot();
      json(response, 200, { ok: true, protocol: PROTOCOL, protocolVersion: PROTOCOL_VERSION, source: 'main-workbench-snapshot', schemaVersion: 1, updatedAt: Date.now(), snapshotAvailable: state.available, state: state.available ? summarizeState(state.value) : null, uiConsumerCount: consumers.size }); return true;
    }
    const eventsMatch = /^\/def-agent\/interop\/v1\/sessions\/([^/]+)\/events$/.exec(path);
    if (method === 'GET' && eventsMatch) { subscribe(request, response, requestUrl, decodeURIComponent(eventsMatch[1]), false); return true; }
    if (method === 'GET' && path === '/def-agent/interop/v1/ui-events') { subscribe(request, response, requestUrl, '', true); return true; }
    if (method === 'POST' && path === '/def-agent/interop/v1/ui/consumer') {
      const body = await readBody(request);
      if (body?.host !== 'workbench' || typeof body?.sessionId !== 'string' || !body.sessionId.trim()) { reject(response, 400, createError('invalid-ui-consumer', 'A workbench sessionId is required.', 'ui-consumer')); return true; }
      const id = typeof body.consumerId === 'string' && body.consumerId ? body.consumerId : crypto.randomUUID();
      const consumer = { id, host: 'workbench', sessionId: body.sessionId.trim(), directory: typeof body.directory === 'string' ? body.directory : '', updatedAt: Date.now() };
      consumers.set(id, consumer); emit('ui-session-opened', { sessionId: consumer.sessionId }, { uiConsumerId: id });
      json(response, 200, { ok: true, protocol: PROTOCOL, protocolVersion: PROTOCOL_VERSION, consumer }); return true;
    }
    if (method === 'POST' && path === '/def-agent/interop/v1/ui/rendered') {
      const body = await readBody(request); const turn = [...turnsByClient.values()].find((item) => item.turnId === body?.turnId && item.sessionId === body?.sessionId);
      if (!turn) { reject(response, 404, createError('turn-not-found', 'Turn was not found.', 'ui-consumer')); return true; }
      emit('ui-rendered', turn, { uiConsumerId: body.consumerId || null }); json(response, 200, { ok: true }); return true;
    }
    return false;
  }

  function subscribe(request, response, requestUrl, sessionId, uiOnly) {
    const from = Number(requestUrl.searchParams.get('from') || requestUrl.searchParams.get('cursor') || 0) || 0;
    options.writeSseHeaders(response); clients.add(response);
    const earliest = events[0]?.seq || seq;
    options.writeSse(response, 'ready', { protocol: PROTOCOL, protocolVersion: PROTOCOL_VERSION, headCursor: String(seq), earliestCursor: String(earliest), gap: from > 0 && from < earliest - 1 });
    for (const event of events) if (event.seq > from && (!sessionId || event.sessionId === sessionId) && (!uiOnly || event.type.startsWith('ui-'))) options.writeSse(response, event.type, { ...event, replay: true });
    request.on('close', () => clients.delete(response));
  }

  return { handle, audit, emit };
}

module.exports = { PROTOCOL, PROTOCOL_VERSION, CAPABILITIES, createError, createDefCodexInteropProtocol };
