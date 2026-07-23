const fs = require('fs');
const path = require('path');

const STATE_SCHEMA_VERSION = 1;

function emptyState() {
  return { schemaVersion: STATE_SCHEMA_VERSION, businesses: {} };
}

function readState(statePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (parsed?.schemaVersion !== STATE_SCHEMA_VERSION || !parsed.businesses || typeof parsed.businesses !== 'object') {
      return emptyState();
    }
    return parsed;
  } catch {
    return emptyState();
  }
}

function atomicWriteJson(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, target);
}

class RevisionController {
  constructor({ statePath }) {
    if (!statePath) throw new Error('RevisionController requires statePath.');
    this.statePath = path.resolve(statePath);
    this.state = readState(this.statePath);
  }

  reload() {
    this.state = readState(this.statePath);
    return this.state;
  }

  businessState(businessId) {
    const current = this.state.businesses[businessId] || {};
    return {
      candidate: current.candidate || null,
      active: current.active || null,
      previous: current.previous || null,
      revoked: Array.isArray(current.revoked) ? [...current.revoked] : [],
      updatedAt: Number(current.updatedAt || 0),
    };
  }

  update(businessId, updater) {
    // Revision state is shared by the sidecar, the OpenCode plugin runtime and
    // the development watcher. Always merge against the latest durable state
    // so an activation in one process cannot erase another business update.
    this.reload();
    const current = this.businessState(businessId);
    const next = updater(current);
    this.state = {
      ...this.state,
      businesses: {
        ...this.state.businesses,
        [businessId]: {
          ...next,
          updatedAt: Date.now(),
        },
      },
    };
    atomicWriteJson(this.statePath, this.state);
    return this.businessState(businessId);
  }

  registerCandidate(businessId, revisionRef) {
    return this.update(businessId, (current) => ({ ...current, candidate: revisionRef }));
  }

  activate(businessId, revisionRef) {
    return this.update(businessId, (current) => {
      if (current.revoked.includes(revisionRef.version)) {
        const error = new Error(`Revision is revoked: ${businessId}@${revisionRef.version}`);
        error.code = 'HARNESS_REVISION_REVOKED';
        throw error;
      }
      const activeChanged = current.active
        && (current.active.version !== revisionRef.version
          || current.active.contentHash !== revisionRef.contentHash);
      const previous = activeChanged
        ? current.active
        : current.previous;
      return {
        ...current,
        candidate: revisionRef,
        active: revisionRef,
        previous: previous || null,
      };
    });
  }

  rollback(businessId) {
    return this.update(businessId, (current) => {
      if (!current.previous) {
        const error = new Error(`No previous Revision for ${businessId}.`);
        error.code = 'HARNESS_REVISION_NO_PREVIOUS';
        throw error;
      }
      if (current.revoked.includes(current.previous.version)) {
        const error = new Error(`Previous Revision is revoked: ${businessId}@${current.previous.version}`);
        error.code = 'HARNESS_REVISION_REVOKED';
        throw error;
      }
      return {
        ...current,
        candidate: current.previous,
        active: current.previous,
        previous: current.active || null,
      };
    });
  }

  revoke(businessId, version) {
    return this.update(businessId, (current) => {
      const revoked = [...new Set([...current.revoked, version])];
      let active = current.active;
      let previous = current.previous;
      if (active?.version === version) {
        active = previous && !revoked.includes(previous.version) ? previous : null;
        previous = null;
      } else if (previous?.version === version) {
        previous = null;
      }
      return {
        ...current,
        active,
        previous,
        revoked,
      };
    });
  }

  isRevoked(businessId, version) {
    return this.businessState(businessId).revoked.includes(version);
  }
}

module.exports = {
  RevisionController,
  atomicWriteJson,
};
