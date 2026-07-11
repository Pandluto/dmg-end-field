import assert from 'node:assert/strict';
import { mergeWorkbenchAiHistory, type PersistedWorkbenchAiMessage } from './workbenchAiHistory';

const message = (id: string, role: PersistedWorkbenchAiMessage['role'], text: string): PersistedWorkbenchAiMessage => ({
  id, role, text, status: 'done',
});

const firstBatch = [message('u1', 'user', '重复问题'), message('a1', 'agent', '第一轮回答')];
const secondBatch = [message('u2', 'user', '重复问题'), message('a2', 'agent', '第二轮回答')];
assert.deepEqual(mergeWorkbenchAiHistory(firstBatch, secondBatch), [...firstBatch, ...secondBatch]);

assert.deepEqual(
  mergeWorkbenchAiHistory(firstBatch, [message('a1', 'agent', '第一轮更新回答')]),
  [message('u1', 'user', '重复问题'), message('a1', 'agent', '第一轮更新回答')],
);

assert.deepEqual(
  mergeWorkbenchAiHistory(firstBatch, [message('a-running', 'agent', '')]),
  firstBatch,
);

console.log('workbench AI history merge passed');
