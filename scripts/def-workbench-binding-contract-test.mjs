import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createTimelineRepository } = require('../electron/timeline-repository.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'def-workbench-binding-'));
const databasePath = path.join(root, 'timeline.sqlite');

try {
  const repository = createTimelineRepository({ databasePath });
  repository.ensureDocument({ id: 'formal-a', label: 'Formal A' });
  repository.ensureDocument({ id: 'formal-b', label: 'Formal B' });
  repository.ensureDocument({ id: 'temporary-a', label: 'Temporary A', isTemporary: true });

  const binding = repository.upsertSessionAxisBinding({
    id: 'axis-a', timelineId: 'formal-a', host: 'workbench', opencodeSessionId: 'session-a',
  });
  assert.equal(binding.timelineId, 'formal-a');
  assert.equal(repository.getSessionAxisBindingBySession('workbench', 'session-a')?.id, 'axis-a');
  assert.equal(repository.getSessionAxisContext('axis-a')?.document?.id, 'formal-a');

  assert.throws(() => repository.upsertSessionAxisBinding({
    id: 'axis-temp', timelineId: 'temporary-a', host: 'workbench', opencodeSessionId: 'session-temp',
  }), { code: 'blocked-temporary-workspace' });
  assert.throws(() => repository.upsertSessionAxisBinding({
    id: 'axis-missing', timelineId: 'missing', host: 'workbench', opencodeSessionId: 'session-missing',
  }), { code: 'blocked-binding' });
  assert.throws(() => repository.upsertSessionAxisBinding({
    id: 'axis-a', timelineId: 'formal-b', host: 'workbench', opencodeSessionId: 'session-a',
  }), { code: 'blocked-session-mismatch' });

  repository.deleteDocument('formal-a');
  assert.equal(repository.getSessionAxisContext('axis-a'), null);
  assert.equal(repository.getSessionAxisBindingBySession('workbench', 'session-a'), undefined);
  console.log('DEF Workbench binding contract: PASS');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
