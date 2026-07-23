const fs = require('fs');
const path = require('path');
const { atomicWriteJson } = require('./revision-controller.cjs');

class TransactionTraceStore {
  constructor({ sessionDirectory, traceDirectory } = {}) {
    const directory = traceDirectory || (
      sessionDirectory
        ? path.join(sessionDirectory, '.def-harness-manager', 'traces')
        : ''
    );
    if (!directory) throw new Error('TransactionTraceStore requires a Session directory.');
    this.traceDirectory = path.resolve(directory);
  }

  tracePath(transactionId) {
    if (!/^[a-zA-Z0-9_-]+$/.test(transactionId)) throw new Error('Invalid transaction id.');
    return path.join(this.traceDirectory, `${transactionId}.json`);
  }

  read(transactionId) {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.tracePath(transactionId), 'utf8'));
      return parsed?.schemaVersion === 1 && Array.isArray(parsed.events)
        ? parsed
        : { schemaVersion: 1, transactionId, events: [] };
    } catch {
      return { schemaVersion: 1, transactionId, events: [] };
    }
  }

  append(transactionId, type, details = {}) {
    const current = this.read(transactionId);
    const event = {
      sequence: current.events.length + 1,
      type,
      at: Date.now(),
      details,
    };
    const next = { ...current, events: [...current.events, event] };
    atomicWriteJson(this.tracePath(transactionId), next);
    return event;
  }
}

module.exports = { TransactionTraceStore };
