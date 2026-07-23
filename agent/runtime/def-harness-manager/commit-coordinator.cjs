const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { analyzeBusinessMutation } = require('./semantic-write-scope.cjs');

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

class MutationCommitCoordinator {
  constructor({ sessionDirectory, lockDirectory, lockTimeoutMs = 5000 } = {}) {
    const directory = lockDirectory || (
      sessionDirectory
        ? path.join(sessionDirectory, '.def-harness-manager', 'mutation-locks')
        : ''
    );
    if (!directory) throw new Error('MutationCommitCoordinator requires a Session directory.');
    this.lockDirectory = path.resolve(directory);
    this.lockTimeoutMs = lockTimeoutMs;
  }

  lockPath(timelineId, checkoutId) {
    const digest = crypto.createHash('sha256').update(`${timelineId}:${checkoutId}`).digest('hex');
    return path.join(this.lockDirectory, `${digest}.lock`);
  }

  async acquire({ transactionId, timelineId, checkoutId }) {
    fs.mkdirSync(this.lockDirectory, { recursive: true });
    const target = this.lockPath(timelineId, checkoutId);
    const startedAt = Date.now();
    while (Date.now() - startedAt < this.lockTimeoutMs) {
      try {
        const handle = fs.openSync(target, 'wx');
        fs.writeFileSync(handle, JSON.stringify({ transactionId, timelineId, checkoutId, acquiredAt: Date.now() }));
        fs.closeSync(handle);
        return { target, transactionId, timelineId, checkoutId };
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        await wait(25);
      }
    }
    const error = new Error(`Another mutation is committing for ${timelineId}/${checkoutId}.`);
    error.code = 'HARNESS_MUTATION_COMMIT_BUSY';
    throw error;
  }

  release(lease) {
    if (!lease?.target) return;
    try {
      const current = JSON.parse(fs.readFileSync(lease.target, 'utf8'));
      if (current.transactionId !== lease.transactionId) return;
      fs.unlinkSync(lease.target);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  async withCommit({
    transaction,
    readSchemeVersion,
    prepare,
    commit,
  }) {
    const lease = await this.acquire({
      transactionId: transaction.transactionId,
      timelineId: transaction.timelineId,
      checkoutId: transaction.checkoutId,
    });
    try {
      const currentSchemeVersion = await readSchemeVersion();
      if (currentSchemeVersion !== transaction.currentSchemeVersion) {
        const error = new Error('The scheme changed before this mutation could commit.');
        error.code = 'HARNESS_MUTATION_SCHEME_CONFLICT';
        throw error;
      }
      const candidate = await prepare();
      const semantic = analyzeBusinessMutation({
        businessId: transaction.businessId,
        beforePayload: candidate.beforePayload,
        afterPayload: candidate.afterPayload,
      });
      if (!semantic.pass) {
        const error = new Error(`Harness mutation exceeds ${transaction.businessId} write scope.`);
        error.code = 'HARNESS_MUTATION_WRITE_SCOPE_VIOLATION';
        error.details = semantic;
        throw error;
      }
      const result = await commit(candidate);
      if (result?.postcondition?.pass !== true) {
        const error = new Error('Mutation did not satisfy its visible postcondition.');
        error.code = 'HARNESS_MUTATION_POSTCONDITION_FAILED';
        throw error;
      }
      return { result, semantic };
    } finally {
      this.release(lease);
    }
  }
}

module.exports = { MutationCommitCoordinator };
