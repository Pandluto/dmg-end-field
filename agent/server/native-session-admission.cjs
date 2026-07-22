function normalizeSessionID(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeIdempotencyKey(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function turnInProgressError(sessionID, active) {
  const error = new Error('native-session-turn-in-progress');
  error.code = 'NATIVE_SESSION_TURN_IN_PROGRESS';
  error.status = 409;
  error.sessionID = sessionID;
  error.activeSource = active?.source || 'unknown';
  error.activeSince = active?.acceptedAt || 0;
  return error;
}

function nativeMessageInfo(message) {
  return message?.info && typeof message.info === 'object' ? message.info : message || {};
}

function nativeMessageID(message) {
  const id = nativeMessageInfo(message)?.id;
  return typeof id === 'string' ? id : '';
}

function findAdmissionUserMessage(entry, messages) {
  if (!entry.baselineKnown || !entry.baselineMessageIds) return null;
  return messages.findLast((message) => {
    const info = nativeMessageInfo(message);
    return info?.role === 'user' && !entry.baselineMessageIds.has(nativeMessageID(message));
  }) || null;
}

function assistantTerminalEvidence(message) {
  const info = nativeMessageInfo(message);
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  const hasToolPart = parts.some((part) => String(part?.type || '').includes('tool'));
  const hasRunningTool = parts.some((part) => {
    if (!String(part?.type || '').includes('tool')) return false;
    const status = String(part?.state?.status || part?.status || '').toLowerCase();
    // A tool part without a settled state is still capable of producing the
    // next assistant step. Do not mistake a preceding completed step for the
    // end of the user turn.
    return !['completed', 'error', 'failed', 'cancelled', 'canceled'].includes(status);
  });
  const finish = String(info?.finish || message?.finish || '').toLowerCase();
  const terminalFinish = Boolean(finish) && !['tool-calls', 'tool_calls', 'unknown'].includes(finish);
  const hasFinalText = !hasToolPart && parts.some((part) => part?.type === 'text' && String(part.text || '').trim())
    && Boolean(info?.time?.completed || info?.completedAt);
  return {
    error: Boolean(info?.error),
    terminal: !hasRunningTool && (terminalFinish || hasFinalText),
  };
}

function evaluateNativeSessionAdmissionObservation(entry, input = {}) {
  const statuses = input.statuses && typeof input.statuses === 'object' ? input.statuses : null;
  const currentStatus = statuses?.[entry.sessionID] || null;
  if (currentStatus && currentStatus.type !== 'idle') entry.observedBusy = true;

  const messages = Array.isArray(input.messages) ? input.messages : null;
  const now = Number.isFinite(input.now) ? input.now : Date.now();
  if (!statuses && !messages) {
    // Loss of both observations is an acceptance-unknown state, not proof
    // that the native runner ended. Keep the gate until either endpoint
    // recovers with terminal evidence, or an explicit abort/delete resolves it.
    return null;
  }

  if (statuses) {
    const idle = !currentStatus || currentStatus.type === 'idle';
    entry.idleSince = idle ? (entry.idleSince || now) : 0;
  } else {
    entry.idleSince = 0;
  }

  if (messages) {
    const userMessage = entry.nativeUserMessageID
      ? messages.find((message) => nativeMessageID(message) === entry.nativeUserMessageID) || null
      : findAdmissionUserMessage(entry, messages);
    if (userMessage) {
      entry.nativeUserMessageID = nativeMessageID(userMessage);
      entry.observedUserMessage = true;
      for (const message of messages) {
        const info = nativeMessageInfo(message);
        if (info?.role !== 'assistant' || info?.parentID !== entry.nativeUserMessageID) continue;
        const terminal = assistantTerminalEvidence(message);
        if (info?.time?.completed || info?.completedAt || info?.error) entry.observedAssistantStep = true;
        if (terminal.error) entry.observedAssistantError = true;
        if (terminal.terminal) entry.observedAssistantTerminal = true;
      }
    }
  }

  if (statuses && (!currentStatus || currentStatus.type === 'idle')) {
    // A tool turn can contain several completed assistant messages. The status
    // endpoint says that the runner is idle, but we also require this user
    // turn's final assistant message (or error). This avoids a fast
    // user+idle observation releasing a live multi-step tool run.
    if (entry.observedAssistantError) return { terminal: true, reason: 'native-assistant-error-idle' };
    if (entry.observedAssistantTerminal) return { terminal: true, reason: 'native-session-idle-after-final' };

    if (entry.observedUserMessage
      && !entry.observedBusy
      && !entry.observedAssistantStep
      && entry.idleSince
      && now - entry.idleSince >= input.startTimeoutMs) {
      return { terminal: true, reason: 'native-prompt-not-started' };
    }
  }

  // When the status endpoint is unavailable, a terminal assistant result
  // correlated to this user message is sufficient. A completed tool step is
  // deliberately not sufficient.
  if (!statuses && messages) {
    if (entry.observedAssistantError) return { terminal: true, reason: 'native-assistant-error-transcript' };
    if (entry.observedAssistantTerminal) return { terminal: true, reason: 'native-assistant-final-transcript' };
  }
  return null;
}

function createNativeSessionAdmissionGate(options = {}) {
  const activeBySession = new Map();
  const now = typeof options.now === 'function' ? options.now : Date.now;

  function admit(input = {}) {
    const sessionID = normalizeSessionID(input.sessionID);
    if (!sessionID) throw new Error('native-session-admission-requires-session-id');
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
    const active = activeBySession.get(sessionID);
    if (active) {
      if (idempotencyKey && active.idempotencyKey === idempotencyKey) {
        return { kind: 'idempotent', entry: active };
      }
      throw turnInProgressError(sessionID, active);
    }

    const entry = {
      sessionID,
      idempotencyKey,
      source: typeof input.source === 'string' && input.source ? input.source : 'unknown',
      acceptedAt: now(),
      releasedAt: 0,
      releaseReason: '',
    };
    activeBySession.set(sessionID, entry);
    return { kind: 'accepted', entry };
  }

  function active(sessionID) {
    return activeBySession.get(normalizeSessionID(sessionID)) || null;
  }

  function release(entry, reason = 'terminal') {
    if (!entry || activeBySession.get(entry.sessionID) !== entry) return false;
    activeBySession.delete(entry.sessionID);
    entry.releasedAt = now();
    entry.releaseReason = reason;
    return true;
  }

  function releaseSession(sessionID, reason = 'terminal') {
    const entry = active(sessionID);
    return entry ? release(entry, reason) : false;
  }

  async function watch(entry, observeTerminal, options = {}) {
    if (typeof observeTerminal !== 'function') throw new Error('native-session-admission-watch-requires-observer');
    const wait = typeof options.wait === 'function'
      ? options.wait
      : () => new Promise((resolve) => {
        const timer = setTimeout(resolve, Number.isFinite(options.intervalMs) ? options.intervalMs : 250);
        timer.unref?.();
      });

    while (activeBySession.get(entry?.sessionID) === entry) {
      try {
        const terminal = await observeTerminal(entry);
        if (terminal?.terminal === true) {
          release(entry, typeof terminal.reason === 'string' && terminal.reason ? terminal.reason : 'terminal');
          return terminal;
        }
      } catch {
        // An unavailable status/transcript endpoint is not evidence that the
        // native turn stopped. Keep the admission until a later observation can
        // prove a terminal state, or an explicit abort releases it.
      }
      await wait();
    }
    return { terminal: true, reason: entry?.releaseReason || 'released-externally' };
  }

  return { admit, active, release, releaseSession, watch };
}

module.exports = {
  createNativeSessionAdmissionGate,
  evaluateNativeSessionAdmissionObservation,
  nativeMessageID,
  assistantTerminalEvidence,
  turnInProgressError,
};
