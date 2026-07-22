const crypto = require('crypto');
const fs = require('fs');

const PROTOCOL = 'def-codex-interop';
const PROTOCOL_VERSION = 1;
const CAPABILITIES = Object.freeze([
  'turn.start', 'turn.continue', 'turn.stop', 'events.subscribe',
  'transcript.read', 'state.read', 'questions.read', 'ui-events.subscribe',
]);
const CLIENT_TURN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
// Native transcript reads may wait for OpenCode to resolve a session message.
// Keep that allowance local to Interop observation: the bridge's normal GET
// budget remains deliberately short, and no observation may retry forever.
const NATIVE_INTEROP_OBSERVATION_TIMEOUT_MS = 30000;
const NATIVE_INTEROP_OBSERVATION_RETRIES = 0;

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

function resolveCanonicalWorkbenchTimelineId(value, native = null) {
  const outer = value && typeof value === 'object' ? value : {};
  const snapshot = outer.snapshot && typeof outer.snapshot === 'object' ? outer.snapshot : outer;
  const candidates = [
    snapshot.timelineId,
    snapshot.activeTimelineId,
    snapshot.checkout?.timelineId,
    snapshot.checkoutRef?.timelineId,
    native?.binding?.timelineId,
    native?.axisContext?.binding?.timelineId,
    native?.axisContext?.checkout?.timelineId,
  ].map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean);
  const unique = [...new Set(candidates)];
  return unique.length === 1 ? unique[0] : '';
}

function readExactCheckoutPayload(bundle) {
  const checkout = bundle?.checkoutRef;
  if (!checkout?.targetId) return null;
  if (checkout.targetType === 'work-node') {
    const node = (Array.isArray(bundle.workNodes) ? bundle.workNodes : [])
      .find((item) => item?.id === checkout.targetId);
    return node?.workingPayload || node?.basePayload || null;
  }
  if (checkout.targetType === 'snapshot') {
    const snapshot = (Array.isArray(bundle.snapshots) ? bundle.snapshots : [])
      .find((item) => item?.id === checkout.targetId && !item?.archivedAt);
    return snapshot?.payload || null;
  }
  return null;
}

function createDefCodexInteropProtocol(options) {
  const runs = new Map();
  const turnsByClient = new Map();
  const consumers = new Map();
  const harnessRunners = new Map();
  const events = [];
  // Keep the subscription predicate with the connection.  Replaying with a
  // predicate but broadcasting live events to every response leaks activity
  // between native Workbench sessions.
  const clients = new Set();
  const audit = [];
  const tokens = new Map();
  const questionOwners = new Map();
  let seq = 0;

  const developmentOnly = isDevelopmentProfile(options.profile);
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  const nativeInteropObservationTimeoutMs = Number.isFinite(Number(options.nativeInteropObservationTimeoutMs))
    && Number(options.nativeInteropObservationTimeoutMs) > 0
    ? Math.min(Math.floor(Number(options.nativeInteropObservationTimeoutMs)), NATIVE_INTEROP_OBSERVATION_TIMEOUT_MS)
    : NATIVE_INTEROP_OBSERVATION_TIMEOUT_MS;

  function nativeInteropObservationOptions() {
    return {
      timeoutMs: nativeInteropObservationTimeoutMs,
      retries: NATIVE_INTEROP_OBSERVATION_RETRIES,
    };
  }

  function readNativeInteropTranscript(sessionId) {
    return options.fetchJson(
      `${options.sidecarUrl}/api/native/session/${encodeURIComponent(sessionId)}/interop-transcript`,
      nativeInteropObservationOptions(),
    );
  }

  function readNativeInteropQuestions(sessionId) {
    return options.fetchJson(
      `${options.sidecarUrl}/api/native/session/${encodeURIComponent(sessionId)}/interop-questions`,
      nativeInteropObservationOptions(),
    );
  }

  function idsFor(record = {}) {
    return {
      ...(record.testRunId ? { testRunId: record.testRunId } : {}),
      ...(record.sessionId ? { sessionId: record.sessionId } : {}),
      ...(record.turnId ? { turnId: record.turnId } : {}),
      ...(record.clientTurnId ? { clientTurnId: record.clientTurnId } : {}),
      ...(record.scenarioId ? { scenarioId: record.scenarioId } : {}),
      ...(record.uiEventId ? { uiEventId: record.uiEventId } : {}),
    };
  }

  function emit(kind, record = {}, payload = {}) {
    const uiEventId = kind.startsWith('ui-') ? crypto.randomUUID() : undefined;
    const event = {
      protocol: PROTOCOL,
      protocolVersion: PROTOCOL_VERSION,
      seq: ++seq,
      cursor: String(seq),
      at: Date.now(),
      type: kind,
      ...idsFor(record),
      ...(uiEventId ? { uiEventId } : {}),
      payload,
    };
    events.push(event);
    if (events.length > 256) events.splice(0, events.length - 256);
    for (const client of clients) {
      if ((client.sessionId && event.sessionId !== client.sessionId) || (client.uiOnly && !event.type.startsWith('ui-'))) continue;
      try { options.writeSse(client.response, kind, event); } catch { clients.delete(client); }
    }
    return event;
  }

  function appendAudit(action, record, result) {
    const entry = { at: Date.now(), action, ingressMode: record?.ingressMode, ...idsFor(record), result };
    audit.push(entry);
    if (audit.length > 512) audit.splice(0, audit.length - 512);
    if (options.auditFile) {
      try {
        fs.mkdirSync(require('path').dirname(options.auditFile), { recursive: true });
        fs.appendFileSync(options.auditFile, `${JSON.stringify(entry)}\n`, 'utf8');
      } catch {
        // Audit persistence must not make a local stop request unsafe or non-idempotent.
      }
    }
  }

  function json(response, status, payload) { options.writeJson(response, status, payload); }

  function reject(response, status, error) {
    json(response, status, { ok: false, protocol: PROTOCOL, protocolVersion: PROTOCOL_VERSION, error });
  }

  function hasTrustedLoopbackOrigin(request) {
    const host = String(request.headers.host || '');
    const origin = String(request.headers.origin || '');
    return !((host && !/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host)) || (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin)));
  }

  function requireTrustedLoopbackOrigin(request, response) {
    if (!hasTrustedLoopbackOrigin(request)) {
      reject(response, 403, createError('teacher-local-origin-required', 'Teacher ingress accepts loopback Host and Origin only.', 'bridge'));
      return false;
    }
    return true;
  }

  function authorize(request, response) {
    if (!requireTrustedLoopbackOrigin(request, response)) return false;
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
    if (body?.harnessSelector !== undefined && (typeof body.harnessSelector !== 'string' || !/^(?:stable|previousStable|candidate\/[a-z][a-z0-9-]{0,63}|[a-z][a-z0-9-]{1,63}@[0-9]+(?:\.[0-9]+){0,2}(?:-[a-z0-9.-]+)?)$/.test(body.harnessSelector))) {
      return createError('invalid-harness-selector', 'harnessSelector must be stable, previousStable, candidate/<name>, or id@version.', 'protocol');
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
      const response = await options.fetchJson(options.snapshotUrl, {
        headers: options.snapshotHeaders || {},
      });
      if (response.status >= 200 && response.status < 300 && response.body?.ok !== false) {
        const value = response.body?.snapshot || response.body?.data || response.body;
        return { available: true, value };
      }
    } catch {}
    return { available: false, value: null };
  }

  function summarizeState(value, native = null) {
    const outer = value && typeof value === 'object' ? value : {};
    const snapshot = outer.snapshot && typeof outer.snapshot === 'object' ? outer.snapshot : outer;
    const operators = Array.isArray(snapshot.selectedCharacters)
      ? snapshot.selectedCharacters.slice(0, 32).map((item) => ({ id: item?.id || '', name: item?.name || '' }))
      : Array.isArray(snapshot.operators)
        ? snapshot.operators.slice(0, 32).map((item) => ({ id: item?.id || '', name: item?.name || '' }))
        : [];
    return {
      checkout: native?.axisContext?.checkout || snapshot.checkout || snapshot.checkoutRef || snapshot.currentCheckout || null,
      revision: native?.axisContext?.checkout?.updatedAt || snapshot.revision || snapshot.checkoutRevision || null,
      selectedOperators: operators,
      pending: snapshot.pendingApproval || snapshot.pendingNode || snapshot.pendingCommand || null,
      harness: native?.binding?.harnessBinding || null,
      agentRelease: native?.binding?.agentRelease || null,
    };
  }

  function compactInteropValue(value, limit = 600) {
    const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
    const redacted = text
      .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
      .replace(/(?:api[-_ ]?key|token|authorization|password)["'\s:=]+[A-Za-z0-9._~+/-]+/gi, '$1=[redacted]');
    return redacted.length > limit ? `${redacted.slice(0, limit)}…` : redacted;
  }

  function safeInteropValue(value, depth = 0) {
    if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
    if (typeof value === 'string') return compactInteropValue(value, 600);
    // Keep a question card's option objects structured: question list -> card
    // -> options -> option object.  Deeper values are still bounded text.
    if (depth >= 4) return compactInteropValue(value, 600);
    if (Array.isArray(value)) return value.slice(0, 16).map((item) => safeInteropValue(item, depth + 1));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).slice(0, 32).map(([key, item]) => [
        key,
        /(?:api[-_ ]?key|token|authorization|password|secret)/i.test(key) ? '[redacted]' : safeInteropValue(item, depth + 1),
      ]));
    }
    return compactInteropValue(value, 600);
  }

  function toolPayload(part) {
    const state = part?.state && typeof part.state === 'object' ? part.state : {};
    const status = state.status === 'completed' || part?.status === 'completed'
      ? 'completed'
      : state.status === 'error' || part?.status === 'error'
        ? 'error'
        : 'running';
    const errorText = status === 'error' ? compactInteropValue(state.error || part?.error || 'OpenCode tool failed', 600) : '';
    return {
      toolCallId: String(part?.callID || part?.id || ''),
      tool: String(part?.tool || part?.name || state.title || 'native-tool'),
      status,
      input: safeInteropValue(state.input ?? part?.input ?? {}),
      ...(status === 'completed' ? { result: safeInteropValue(state.output ?? state.result ?? part?.output ?? null) } : {}),
      ...(status === 'error' ? {
        error: {
          code: /timeout/i.test(errorText) ? 'tool-timeout' : 'tool-execution-failed',
          message: errorText,
          component: 'opencode-tool',
          retryable: /timeout|temporar|unavailable|network/i.test(errorText),
        },
      } : {}),
    };
  }

  function providerErrorPayload(value) {
    const message = compactInteropValue(value || 'OpenCode provider failed', 600);
    const aborted = /\baborted?\b/i.test(message);
    return {
      aborted,
      error: {
        code: aborted ? 'provider-aborted' : /timeout/i.test(message) ? 'provider-timeout' : 'provider-message-error',
        message,
        component: 'provider',
        retryable: !aborted && /timeout|temporar|unavailable|network/i.test(message),
        ...(!aborted ? { nextAction: 'Inspect this turn transcript and retry only after the provider is ready.' } : {}),
      },
    };
  }

  function normalizeQuestions(items) {
    return Array.isArray(items) ? items.slice(0, 32).map((item) => ({
      requestId: String(item?.requestId || ''),
      status: String(item?.status || 'open'),
      questions: safeInteropValue(item?.questions || []),
      answers: safeInteropValue(item?.answers || []),
      runtimeStatus: item?.runtimeStatus || null,
      createdAt: item?.createdAt || null,
      updatedAt: item?.updatedAt || null,
    })).filter((item) => item.requestId) : [];
  }

  function attachQuestions(record, items) {
    for (const question of normalizeQuestions(items)) {
      const owner = questionOwners.get(question.requestId) || record;
      questionOwners.set(question.requestId, owner);
      const signature = `${question.requestId}:${question.status}:${question.updatedAt || ''}`;
      owner.observedQuestionStates ||= new Set();
      if (owner.observedQuestionStates.has(signature)) continue;
      owner.observedQuestionStates.add(signature);
      emit(question.status === 'open' ? 'permission' : 'permission-resolved', owner, {
        kind: 'native-question', question,
      });
    }
  }

  function messageId(message) { return String(message?.info?.id || message?.id || ''); }

  function correlatedMessages(record, messages) {
    const list = Array.isArray(messages) ? messages : [];
    let userMessageId = record.nativeUserMessageId || '';
    if (!userMessageId && record.transcriptBaselineKnown) {
      const user = [...list].reverse().find((message) => (
        !record.transcriptBaselineIds.has(messageId(message))
        && message?.info?.role === 'user'
        && (message?.parts || []).some((part) => part?.type === 'text' && part?.text === record.rawUserText)
      ));
      userMessageId = messageId(user);
      if (userMessageId) record.nativeUserMessageId = userMessageId;
    }
    if (!userMessageId) return { userMessageId: '', assistants: [] };
    return {
      userMessageId,
      assistants: list.filter((message) => message?.info?.role === 'assistant' && message?.info?.parentID === userMessageId),
    };
  }

  function assistantTerminalEvidence(message) {
    const info = message?.info && typeof message.info === 'object' ? message.info : message || {};
    const parts = Array.isArray(message?.parts) ? message.parts : [];
    const hasToolPart = parts.some((part) => String(part?.type || '').includes('tool'));
    const hasRunningTool = parts.some((part) => {
      if (!String(part?.type || '').includes('tool')) return false;
      const status = String(part?.state?.status || part?.status || '').toLowerCase();
      return !['completed', 'error', 'failed', 'cancelled', 'canceled'].includes(status);
    });
    const finish = String(info.finish || message?.finish || '').toLowerCase();
    const terminalFinish = Boolean(finish) && !['tool-calls', 'tool_calls', 'unknown'].includes(finish);
    const hasFinalText = !hasToolPart && parts.some((part) => part?.type === 'text' && String(part.text || '').trim())
      && Boolean(info?.time?.completed || info?.completedAt);
    return {
      error: Boolean(info?.error),
      terminal: !hasRunningTool && (terminalFinish || hasFinalText),
    };
  }

  function discardUnacceptedTurn(idempotencyKey, run, record) {
    if (turnsByClient.get(idempotencyKey) === record) turnsByClient.delete(idempotencyKey);
    const index = run.turns.indexOf(record);
    if (index >= 0) run.turns.splice(index, 1);
    record.idempotencyReleasedAt = Date.now();
  }

  async function observeTurn(record) {
    let firstToken = false;
    const seenTools = new Set();
    const maxAttempts = Number.isInteger(options.observerMaxAttempts) && options.observerMaxAttempts > 0
      ? options.observerMaxAttempts
      : 180;
    const pollMs = Number.isFinite(options.observerPollMs) && options.observerPollMs >= 0
      ? options.observerPollMs
      : 1000;
    for (let attempt = 0; attempt < maxAttempts && record.status === 'accepted'; attempt += 1) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, pollMs);
        timer.unref?.();
      });
      // A stop can arrive while this observer is asleep. Do not poll, emit, or
      // reconcile a provider terminal timestamp after the protocol terminal state
      // has already become stopped.
      if (record.status !== 'accepted') return;
      try {
        const [upstream, questions] = await Promise.all([
          readNativeInteropTranscript(record.sessionId),
          readNativeInteropQuestions(record.sessionId).catch(() => ({ status: 0, body: null })),
        ]);
        if (record.status !== 'accepted') return;
        const messages = Array.isArray(upstream.body?.messages) ? upstream.body.messages : [];
        const correlated = correlatedMessages(record, messages);
        // An uncertain submission without a new native user message must stay
        // uncertain. A completed answer from an earlier session turn is never
        // evidence that this clientTurnId ran.
        if (!correlated.userMessageId) continue;
        if (questions.status >= 200 && questions.status < 300) attachQuestions(record, questions.body?.questions);
        const latest = correlated.assistants.at(-1);
        const parts = Array.isArray(latest?.parts) ? latest.parts : [];
        for (const part of parts) {
          if (record.status !== 'accepted') return;
          if (!firstToken && part?.type === 'text' && String(part.text || '').trim()) {
            firstToken = true;
            emit('response-first-token', record, {});
          }
          if (String(part?.type || '').includes('tool')) {
            const toolKey = String(part.callID || part.id || part.tool || JSON.stringify(part.input || {}));
            const payload = toolPayload(part);
            if (!seenTools.has(`${toolKey}:start`)) { seenTools.add(`${toolKey}:start`); emit('tool-start', record, payload); }
            if (payload.status === 'completed' && !seenTools.has(`${toolKey}:completed`)) { seenTools.add(`${toolKey}:completed`); emit('tool-result', record, payload); }
            if (payload.status === 'error' && !seenTools.has(`${toolKey}:error`)) { seenTools.add(`${toolKey}:error`); emit('tool-error', record, payload); }
          }
        }
        if (record.status !== 'accepted') return;
        const terminal = assistantTerminalEvidence(latest);
        if (terminal.error) {
          const provider = providerErrorPayload(latest.info.error);
          record.status = provider.aborted ? 'stopped' : 'provider-error';
          appendAudit(provider.aborted ? 'turn.stopped' : 'turn.provider-error', record, provider.error.code);
          emit(record.status, record, provider.error);
          return;
        }
        if (terminal.terminal) {
          record.status = 'completed'; appendAudit('turn.completed', record, 'completed'); emit('completed', record, {}); return;
        }
      } catch {
        // A transient transcript read does not cancel the native OpenCode run.
      }
    }
    if (record.status === 'accepted') { record.status = 'timeout'; appendAudit('turn.timeout', record, 'timeout'); emit('timeout', record, { component: 'provider' }); }
  }

  function reconcileTranscriptCompletion(run, messages) {
    const record = [...run.turns].reverse().find((turn) => {
      if (!['accepted', 'timeout'].includes(turn.status)) return false;
      const correlated = correlatedMessages(turn, messages);
      turn.nativeUserMessageId ||= correlated.userMessageId;
      turn.reconciledAssistant = correlated.assistants.at(-1);
      turn.reconciledTerminal = assistantTerminalEvidence(turn.reconciledAssistant);
      return Boolean(turn.reconciledTerminal?.error || turn.reconciledTerminal?.terminal);
    });
    const latest = record?.reconciledAssistant;
    if (!record || !latest) return;
    if (record.reconciledTerminal?.error) {
      const provider = providerErrorPayload(latest.info.error);
      record.status = provider.aborted ? 'stopped' : 'provider-error';
      appendAudit(provider.aborted ? 'turn.stopped' : 'turn.provider-error', record, provider.error.code);
      emit(record.status, record, provider.error);
      return;
    }
    record.status = 'completed';
    appendAudit('turn.completed', record, 'completed-reconciled');
    emit('completed', record, { reconciledFromTranscript: true });
  }

  function currentConsumer(sessionId = '') {
    const list = [...consumers.values()]
      .filter((consumer) => consumer.host === 'workbench' && (!sessionId || consumer.sessionId === sessionId))
      .sort((left, right) => right.updatedAt - left.updatedAt);
    if (list[0]) return list[0];
    return sessionId ? harnessRunners.get(sessionId) || null : null;
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
      scenarioId: typeof body.scenarioId === 'string' ? body.scenarioId.slice(0, 128) : undefined,
      harnessSelector: typeof body.harnessSelector === 'string' ? body.harnessSelector : undefined,
      ingressMode: body.ingressMode || 'pure-blackbox',
      rawUserText: body.rawUserText.trim(),
      providerVisibleUserText: body.rawUserText.trim(),
      snapshotAvailable: state.available,
      // Reserve the caller key before the first sidecar byte is sent.  A
      // response can be lost after OpenCode accepted the prompt; treating a
      // retry as a new prompt would be unsafe for mutation previews.
      status: 'accepted',
      submissionState: 'accepted',
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
    record.response = {
      accepted: true,
      testRunId: record.testRunId,
      sessionId: record.sessionId,
      turnId: record.turnId,
      clientTurnId: record.clientTurnId,
      ingressMode: record.ingressMode,
      submissionState: record.submissionState,
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
    try {
      const baseline = await readNativeInteropTranscript(record.sessionId);
      const messages = Array.isArray(baseline.body?.messages) ? baseline.body.messages : [];
      record.transcriptBaselineKnown = baseline.status >= 200 && baseline.status < 300;
      record.transcriptBaselineIds = new Set(messages.map(messageId).filter(Boolean));
    } catch {
      record.transcriptBaselineKnown = false;
      record.transcriptBaselineIds = new Set();
    }
    let sidecar;
    try {
      sidecar = await options.postJson(`${options.sidecarUrl}/api/native/session/${encodeURIComponent(record.sessionId)}/interop-prompt`, {
        rawUserText: record.rawUserText,
        providerVisibleUserText: record.providerVisibleUserText,
        ingressMode: record.ingressMode,
        diagnostic,
        harnessSelector: record.harnessSelector,
        thinkingEffort: body.thinkingEffort,
        correlation: idsFor(record),
      });
    } catch {
      // This is deliberately not retryable by resending the prompt.  The
      // sidecar may have already accepted it; observe the reserved turn and
      // reuse its stable ids to reconcile the native transcript.
      record.submissionState = 'unknown';
      record.response = { ...record.response, submissionState: 'unknown' };
      appendAudit(continuation ? 'turn.continue' : 'turn.start', record, 'acceptance-unknown');
      emit('accepted', record, { ingressMode: record.ingressMode, snapshotAvailable: record.snapshotAvailable, submissionState: 'unknown' });
      void observeTurn(record);
      json(response, 202, { ok: true, protocol: PROTOCOL, protocolVersion: PROTOCOL_VERSION, turn: record.response });
      return true;
    }
    if (sidecar.status < 200 || sidecar.status >= 300 || sidecar.body?.ok === false) {
      const nativeTurnInProgress = sidecar.status === 409 && sidecar.body?.code === 'NATIVE_SESSION_TURN_IN_PROGRESS';
      const error = createError(nativeTurnInProgress ? 'native-session-turn-in-progress' : 'sidecar-turn-rejected', sidecar.body?.error || 'The DEF OpenCode sidecar rejected the turn.', 'sidecar', {
        retryable: nativeTurnInProgress,
        ids: idsFor(record),
        nextAction: nativeTurnInProgress
          ? 'Wait for the active native turn to finish, then retry this same clientTurnId.'
          : 'Inspect sidecar status before retrying with this clientTurnId.',
      });
      record.status = 'bridge-error';
      record.error = error;
      record.response = { ...record.response, accepted: false, status: record.status, error };
      appendAudit(continuation ? 'turn.continue' : 'turn.start', record, error.code);
      emit('bridge-error', record, error);
      discardUnacceptedTurn(idempotencyKey, run, record);
      reject(response, nativeTurnInProgress ? 409 : (sidecar.status === 404 ? 404 : 502), error);
      return true;
    }
    record.providerVisibleMessages = sidecar.body?.providerVisibleMessages || [{ role: 'user', text: record.providerVisibleUserText }];
    record.nativeUserMessageId = String(sidecar.body?.nativeUserMessageId || '');
    record.harnessBinding = sidecar.body?.harnessBinding || null;
    record.harnessWarning = sidecar.body?.harnessWarning || null;
    record.agentRelease = sidecar.body?.agentRelease || null;
    record.submissionState = sidecar.body?.submissionState === 'unknown' ? 'unknown' : 'accepted';
    record.response = { ...record.response, submissionState: record.submissionState, harness: record.harnessBinding, agentRelease: record.agentRelease, ...(record.harnessWarning ? { harnessWarning: record.harnessWarning } : {}) };
    if (record.ingressMode === 'diagnostic') record.response.providerVisibleMessages = record.providerVisibleMessages;
    appendAudit(continuation ? 'turn.continue' : 'turn.start', record, record.submissionState === 'unknown' ? 'acceptance-unknown' : 'accepted');
    emit('accepted', record, { ingressMode: record.ingressMode, snapshotAvailable: record.snapshotAvailable, submissionState: record.submissionState, harness: record.harnessBinding, agentRelease: record.agentRelease, ...(record.harnessWarning ? { harnessWarning: record.harnessWarning } : {}) });
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
    const consumer = currentConsumer();
    let harness = null;
    let agentRelease = null;
    if (consumer?.directory) {
      try {
        const query = new URLSearchParams({ sessionID: consumer.sessionId, directory: consumer.directory });
        const bootstrap = await options.fetchJson(`${options.sidecarUrl}/api/native/bootstrap?${query}`);
        harness = bootstrap.body?.binding?.harnessBinding || null;
        agentRelease = bootstrap.body?.binding?.agentRelease || null;
      } catch {}
    }
    json(response, 200, {
      ok: true, protocol: PROTOCOL, protocolVersion: PROTOCOL_VERSION, developmentOnly: true,
      bridge: { ready: true, version: options.bridgeVersion || 'local' }, agent: sidecar,
      workbench: { snapshotAvailable: state.available, uiConnected: currentConsumer() !== null, uiConsumerCount: consumers.size },
      harness: { enabled: true, activeSessionBinding: harness },
      agentRelease,
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
      if (!requireTrustedLoopbackOrigin(request, response)) return true;
      const token = crypto.randomBytes(24).toString('base64url');
      tokens.set(token, Date.now() + 15 * 60 * 1000);
      json(response, 201, { ok: true, protocol: PROTOCOL, protocolVersion: PROTOCOL_VERSION, token, expiresAt: Date.now() + 15 * 60 * 1000 });
      return true;
    }
    if (method === 'POST' && path === '/def-agent/interop/v1/harness/sessions') {
      if (!developmentOnly) { reject(response, 403, createError('teacher-ingress-disabled', 'Harness runner is disabled outside development/test profiles.', 'bridge')); return true; }
      if (!authorize(request, response)) return true;
      const body = await readBody(request);
      const selector = typeof body?.harnessSelector === 'string' ? body.harnessSelector : 'stable';
      if (!/^(?:stable|candidate\/[a-z][a-z0-9-]{0,63}|[a-z][a-z0-9-]{1,63}@[0-9]+(?:\.[0-9]+){0,2}(?:-[a-z0-9.-]+)?)$/.test(selector)) {
        reject(response, 400, createError('invalid-harness-selector', 'Harness runner needs stable, candidate/<name>, or id@version.', 'protocol')); return true;
      }
      const fixtureId = `fixture-${crypto.randomUUID()}`;
      const timelineId = `harness-${fixtureId}`;
      const fixtureMode = body?.fixtureMode === 'clone-current' ? 'clone-current' : 'empty';
      let boundNodeId = '';
      let fixture;
      if (fixtureMode === 'clone-current') {
        const state = await snapshot();
        const consumer = currentConsumer();
        let native = null;
        if (consumer?.directory) {
          try {
            const query = new URLSearchParams({ sessionID: consumer.sessionId, directory: consumer.directory });
            const bootstrap = await options.fetchJson(`${options.sidecarUrl}/api/native/bootstrap?${query}`);
            native = bootstrap.body?.ok ? bootstrap.body : null;
          } catch {}
        }
        const sourceTimelineId = state.available
          ? resolveCanonicalWorkbenchTimelineId(state.value, native)
          : '';
        const exported = sourceTimelineId
          ? await options.fetchJson(`${baseUrl}/local-data/timeline-bundles/export?timelineId=${encodeURIComponent(sourceTimelineId)}`)
          : { status: 409, body: null };
        const payload = readExactCheckoutPayload(exported.body);
        if (exported.status < 200 || exported.status >= 300 || !payload) {
          reject(response, 409, createError('BLOCKED_ENVIRONMENT', 'A populated Harness fixture needs an available current Workbench payload.', 'fixture', { retryable: true })); return true;
        }
        boundNodeId = `${fixtureId}-node`;
        fixture = await options.postJson(`${baseUrl}/local-data/timeline-bundles/import`, {
          document: { id: timelineId, label: `Harness fixture ${fixtureId}` },
          snapshots: [{ id: `${fixtureId}-snapshot`, label: 'Harness isolated baseline', payload }],
          workNodes: [{ id: boundNodeId, branchId: `${fixtureId}-branch`, label: 'Harness isolated work node', status: 'open', approvalPolicy: 'manual', basePayload: payload, workingPayload: payload }],
          checkoutRef: { targetType: 'work-node', targetId: boundNodeId },
        });
      } else {
        fixture = await options.postJson(`${baseUrl}/local-data/timeline-documents`, { id: timelineId, label: `Harness fixture ${fixtureId}` });
      }
      if (fixture.status < 200 || fixture.status >= 300 || fixture.body?.ok === false) {
        reject(response, 502, createError('harness-fixture-create-failed', 'Could not create isolated Harness timeline fixture.', 'fixture', { retryable: true })); return true;
      }
      const created = await options.postJson(`${options.sidecarUrl}/api/native/session`, { host: 'workbench', harnessSelector: selector, timelineId, boundNodeId });
      if (created.status < 200 || created.status >= 300 || created.body?.ok !== true || !created.body?.session?.id) {
        await options.postJson(`${baseUrl}/local-data/timeline-documents/${encodeURIComponent(timelineId)}/delete`, {}).catch(() => undefined);
        reject(response, 502, createError('BLOCKED_HARNESS_LOAD', 'Could not create a native Harness runner session.', 'sidecar', { retryable: true })); return true;
      }
      const session = created.body.session;
      const runner = { id: `harness-runner-${crypto.randomUUID()}`, host: 'harness-runner', sessionId: session.id, directory: session.directory, timelineId, fixtureId, fixtureMode, boundNodeId: boundNodeId || null, harnessBinding: session.harnessBinding || null, agentRelease: session.agentRelease || null, createdAt: Date.now(), updatedAt: Date.now() };
      harnessRunners.set(runner.sessionId, runner);
      emit('harness-session-created', { sessionId: runner.sessionId }, { fixtureId, timelineId, harness: runner.harnessBinding, agentRelease: runner.agentRelease });
      json(response, 201, { ok: true, protocol: PROTOCOL, protocolVersion: PROTOCOL_VERSION, runner: { id: runner.id, sessionId: runner.sessionId, timelineId, fixtureId, fixtureMode, boundNodeId: boundNodeId || null, harnessBinding: runner.harnessBinding, agentRelease: runner.agentRelease } }); return true;
    }
    const harnessCloseMatch = /^\/def-agent\/interop\/v1\/harness\/sessions\/([^/]+)$/.exec(path);
    if (method === 'DELETE' && harnessCloseMatch) {
      if (!authorize(request, response)) return true;
      const sessionId = decodeURIComponent(harnessCloseMatch[1]);
      const runner = harnessRunners.get(sessionId);
      if (!runner) { json(response, 200, { ok: true, protocol: PROTOCOL, protocolVersion: PROTOCOL_VERSION, status: 'already-closed' }); return true; }
      const deleted = await options.postJson(`${options.sidecarUrl}/api/native/session/${encodeURIComponent(sessionId)}/runner-cleanup`, {});
      if (deleted.status < 200 || deleted.status >= 300) { reject(response, 502, createError('harness-session-cleanup-failed', 'Native Harness runner session could not be cleaned up.', 'sidecar', { retryable: true, ids: { sessionId } })); return true; }
      const fixture = await options.postJson(`${baseUrl}/local-data/timeline-documents/${encodeURIComponent(runner.timelineId)}/delete`, {});
      if (fixture.status < 200 || fixture.status >= 300) { reject(response, 502, createError('harness-fixture-cleanup-failed', 'Harness timeline fixture could not be cleaned up.', 'fixture', { retryable: true, ids: { sessionId } })); return true; }
      harnessRunners.delete(sessionId);
      emit('harness-session-cleaned', { sessionId }, { fixtureId: runner.fixtureId, timelineId: runner.timelineId });
      json(response, 200, { ok: true, protocol: PROTOCOL, protocolVersion: PROTOCOL_VERSION, status: 'cleaned' }); return true;
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
      if (['completed', 'stopped', 'max-step', 'provider-error', 'bridge-error'].includes(record.status)) {
        json(response, 200, { ok: true, protocol: PROTOCOL, protocolVersion: PROTOCOL_VERSION, status: `already-${record.status}`, ids: idsFor(record) }); return true;
      }
      let upstream;
      try {
        upstream = await options.postJson(`${options.sidecarUrl}/api/native/session/${encodeURIComponent(sessionId)}/interop-stop`, {});
      } catch {
        reject(response, 502, createError('native-turn-stop-unavailable', 'Could not confirm the native turn abort because the sidecar transport failed.', 'sidecar', {
          retryable: true,
          ids: idsFor(record),
          nextAction: 'Retry stop after the sidecar is reachable; the native turn remains active until abort is confirmed.',
        }));
        return true;
      }
      if (upstream.status < 200 || upstream.status >= 300 || upstream.body?.ok === false) {
        reject(response, 502, createError('native-turn-stop-failed', `Native turn abort was not confirmed (HTTP ${upstream.status || 0}).`, 'sidecar', {
          retryable: true,
          ids: idsFor(record),
          nextAction: 'Retry stop after resolving the sidecar abort failure; the native turn remains active until abort is confirmed.',
        }));
        return true;
      }
      record.status = 'stopped'; appendAudit('turn.stop', record, 'stopped'); emit('stopped', record, { reason: upstream.body?.reason || 'requested' });
      json(response, 200, { ok: true, protocol: PROTOCOL, protocolVersion: PROTOCOL_VERSION, status: 'stopped', ids: idsFor(record) }); return true;
    }
    const transcriptMatch = /^\/def-agent\/interop\/v1\/sessions\/([^/]+)\/transcript$/.exec(path);
    if (method === 'GET' && transcriptMatch) {
      if (!authorize(request, response)) return true;
      const sessionId = decodeURIComponent(transcriptMatch[1]);
      const run = runs.get(sessionId);
      if (!run) { reject(response, 404, createError('interop-session-not-found', 'No protocol run exists for this session.', 'session', { ids: { sessionId } })); return true; }
      let upstream;
      try {
        upstream = await readNativeInteropTranscript(sessionId);
      } catch {
        reject(response, 502, createError('native-transcript-observation-unavailable', 'OpenCode native transcript could not be read within the bounded observation window.', 'sidecar', {
          retryable: true,
          ids: { testRunId: run.testRunId, sessionId },
          nextAction: 'Check sidecar status, then retry transcript observation.',
        }));
        return true;
      }
      reconcileTranscriptCompletion(run, upstream.body?.messages);
      json(response, upstream.status || 502, { ok: upstream.status >= 200 && upstream.status < 300, protocol: PROTOCOL, protocolVersion: PROTOCOL_VERSION, testRunId: run.testRunId, sessionId, turns: run.turns.map((turn) => ({ ...idsFor(turn), ingressMode: turn.ingressMode, rawUserText: turn.rawUserText, providerVisibleUserText: turn.providerVisibleUserText, harness: turn.harnessBinding || null, ...(turn.harnessWarning ? { harnessWarning: turn.harnessWarning } : {}), ...(turn.ingressMode === 'diagnostic' ? { diagnostic: turn.diagnostic, providerVisibleMessages: turn.providerVisibleMessages } : {}), submissionState: turn.submissionState || 'accepted', status: turn.status })), transcript: upstream.body?.messages || [] }); return true;
    }
    const questionsMatch = /^\/def-agent\/interop\/v1\/sessions\/([^/]+)\/questions$/.exec(path);
    if (method === 'GET' && questionsMatch) {
      if (!authorize(request, response)) return true;
      const sessionId = decodeURIComponent(questionsMatch[1]);
      const run = runs.get(sessionId);
      if (!run) { reject(response, 404, createError('interop-session-not-found', 'No protocol run exists for this session.', 'session', { ids: { sessionId } })); return true; }
      let upstream;
      try {
        upstream = await readNativeInteropQuestions(sessionId);
      } catch {
        reject(response, 502, createError('native-question-observation-unavailable', 'OpenCode native question state could not be read within the bounded observation window.', 'sidecar', {
          retryable: true,
          ids: { testRunId: run.testRunId, sessionId },
          nextAction: 'Check sidecar status, then retry question observation.',
        }));
        return true;
      }
      if (upstream.status < 200 || upstream.status >= 300) {
        reject(response, upstream.status === 404 ? 404 : 502, createError('native-question-observation-unavailable', 'OpenCode native question state could not be read.', 'sidecar', { retryable: upstream.status >= 500 || upstream.status === 0, ids: { testRunId: run.testRunId, sessionId }, nextAction: 'Check sidecar status, then retry question observation.' })); return true;
      }
      const questions = normalizeQuestions(upstream.body?.questions);
      const current = run.turns.find((turn) => turn.status === 'accepted') || run.turns.at(-1) || {};
      attachQuestions(current, questions);
      json(response, 200, { ok: true, protocol: PROTOCOL, protocolVersion: PROTOCOL_VERSION, testRunId: run.testRunId, sessionId, questions: questions.map((question) => ({ ...question, ...(questionOwners.get(question.requestId) ? { turnId: questionOwners.get(question.requestId).turnId, clientTurnId: questionOwners.get(question.requestId).clientTurnId } : {}) })) }); return true;
    }
    if (method === 'GET' && path === '/def-agent/interop/v1/state') {
      if (!authorize(request, response)) return true;
      const state = await snapshot();
      const consumer = currentConsumer();
      let native = null;
      if (consumer?.directory) {
        try {
          const query = new URLSearchParams({ sessionID: consumer.sessionId, directory: consumer.directory });
          const response = await options.fetchJson(`${options.sidecarUrl}/api/native/bootstrap?${query}`);
          native = response.body?.ok ? response.body : null;
        } catch {}
      }
      json(response, 200, { ok: true, protocol: PROTOCOL, protocolVersion: PROTOCOL_VERSION, source: 'main-workbench-snapshot', schemaVersion: 1, updatedAt: Date.now(), snapshotAvailable: state.available, state: state.available ? summarizeState(state.value, native) : null, uiConsumerCount: consumers.size }); return true;
    }
    const eventsMatch = /^\/def-agent\/interop\/v1\/sessions\/([^/]+)\/events$/.exec(path);
    if (method === 'GET' && eventsMatch) { if (!authorize(request, response)) return true; subscribe(request, response, requestUrl, decodeURIComponent(eventsMatch[1]), false); return true; }
    if (method === 'GET' && path === '/def-agent/interop/v1/ui-events') { if (!authorize(request, response)) return true; subscribe(request, response, requestUrl, '', true); return true; }
    if (method === 'POST' && path === '/def-agent/interop/v1/ui/consumer') {
      if (!requireTrustedLoopbackOrigin(request, response)) return true;
      const body = await readBody(request);
      if (body?.host !== 'workbench' || typeof body?.sessionId !== 'string' || !body.sessionId.trim()) { reject(response, 400, createError('invalid-ui-consumer', 'A workbench sessionId is required.', 'ui-consumer')); return true; }
      const id = typeof body.consumerId === 'string' && body.consumerId ? body.consumerId : crypto.randomUUID();
      const renderSecret = typeof body.renderSecret === 'string' && body.renderSecret ? body.renderSecret : crypto.randomUUID();
      // The product has one visible Workbench AI surface.  React development
      // effect replay and a previously unmounted panel must not leave an old
      // session eligible for a bare turn.start request.
      for (const existing of consumers.values()) {
        if (existing.host === 'workbench' && existing.id !== id) consumers.delete(existing.id);
      }
      const consumer = { id, host: 'workbench', sessionId: body.sessionId.trim(), directory: typeof body.directory === 'string' ? body.directory : '', renderSecret, updatedAt: Date.now() };
      consumers.set(id, consumer); emit('ui-session-opened', { sessionId: consumer.sessionId }, { uiConsumerId: id });
      json(response, 200, { ok: true, protocol: PROTOCOL, protocolVersion: PROTOCOL_VERSION, consumer: { id: consumer.id, host: consumer.host, sessionId: consumer.sessionId, updatedAt: consumer.updatedAt } }); return true;
    }
    if (method === 'POST' && path === '/def-agent/interop/v1/ui/consumer/close') {
      if (!requireTrustedLoopbackOrigin(request, response)) return true;
      const body = await readBody(request); const consumer = consumers.get(body?.consumerId);
      if (consumer && consumer.sessionId === body?.sessionId && consumer.renderSecret === body?.renderSecret) consumers.delete(consumer.id);
      json(response, 200, { ok: true, protocol: PROTOCOL, protocolVersion: PROTOCOL_VERSION }); return true;
    }
    return false;
  }

  function subscribe(request, response, requestUrl, sessionId, uiOnly) {
    const from = Number(requestUrl.searchParams.get('from') || requestUrl.searchParams.get('cursor') || 0) || 0;
    const client = { response, sessionId, uiOnly };
    options.writeSseHeaders(response); clients.add(client);
    const earliest = events[0]?.seq || seq;
    options.writeSse(response, 'ready', { protocol: PROTOCOL, protocolVersion: PROTOCOL_VERSION, headCursor: String(seq), earliestCursor: String(earliest), gap: from > 0 && from < earliest - 1 });
    for (const event of events) if (event.seq > from && (!sessionId || event.sessionId === sessionId) && (!uiOnly || event.type.startsWith('ui-'))) options.writeSse(response, event.type, { ...event, replay: true });
    request.on('close', () => clients.delete(client));
  }

  return { handle, audit, emit };
}

module.exports = {
  PROTOCOL,
  PROTOCOL_VERSION,
  CAPABILITIES,
  createError,
  createDefCodexInteropProtocol,
  readExactCheckoutPayload,
  resolveCanonicalWorkbenchTimelineId,
};
