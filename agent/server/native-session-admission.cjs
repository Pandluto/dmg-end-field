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
  turnInProgressError,
};
