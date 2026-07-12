import assert from 'node:assert/strict';
import { collapseRecalledWorkbenchTurns, mergeWorkbenchAiHistory, resolveRecalledWorkbenchAiHistory, type PersistedWorkbenchAiMessage } from './workbenchAiHistory';

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

const localHistory = [
  message('local-u1', 'user', 'hi'), message('local-a1', 'agent', '排轴已就绪'),
  message('local-u2', 'user', '随便聊聊'), message('local-a2', 'agent', '好的'),
  message('local-u3', 'user', '没什么'), message('local-a3', 'agent', '随时可以调轴'),
];
const recalledTranscript = [
  message('remote-u1', 'user', 'hi'), message('remote-a1', 'agent', '排轴已就绪'),
  message('remote-u2', 'user', '随便聊聊'), message('remote-a2', 'agent', '好的'),
  message('remote-u3', 'user', '没什么'), message('remote-a3', 'agent', '随时可以调轴'),
];
assert.equal(mergeWorkbenchAiHistory(localHistory, recalledTranscript, 200, true).length, 6);

const repeatedTurns = [
  message('local-repeat-u1', 'user', '再试试'), message('local-repeat-a1', 'agent', '正在应用'),
  message('local-repeat-u2', 'user', '再试试'), message('local-repeat-a2', 'agent', '正在应用'),
];
const recalledRepeatedTurns = [
  message('remote-repeat-u1', 'user', '再试试'), message('remote-repeat-a1', 'agent', '正在应用'),
  message('remote-repeat-u2', 'user', '再试试'), message('remote-repeat-a2', 'agent', '正在应用'),
];
assert.equal(mergeWorkbenchAiHistory(repeatedTurns, recalledRepeatedTurns, 200, true).length, 4);
assert.deepEqual(resolveRecalledWorkbenchAiHistory(localHistory, recalledTranscript), recalledTranscript);
assert.deepEqual(resolveRecalledWorkbenchAiHistory(localHistory, []), localHistory);
assert.deepEqual(collapseRecalledWorkbenchTurns([
  message('u-turn', 'user', '添加按钮'),
  message('a-progress-1', 'agent', '正在检查'),
  message('a-progress-2', 'agent', '正在应用'),
  message('a-final', 'agent', '按钮已添加'),
]), [message('u-turn', 'user', '添加按钮'), message('a-final', 'agent', '按钮已添加')]);
assert.deepEqual(collapseRecalledWorkbenchTurns([
  message('u-turn-2', 'user', '添加按钮'),
  message('a-progress-3', 'agent', '正在应用'),
  message('u-auto', 'user', 'Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed.'),
  message('a-final-2', 'agent', '按钮已添加'),
]), [message('u-turn-2', 'user', '添加按钮'), message('a-final-2', 'agent', '按钮已添加')]);

console.log('workbench AI history merge passed');
