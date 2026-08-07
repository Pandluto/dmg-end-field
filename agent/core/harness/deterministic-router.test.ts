import assert from 'node:assert/strict';
import { classifyDeterministicHarnessIntent } from './deterministic-router.ts';

for (const text of ['你好', 'hi!', '谢谢', '告诉我你所有能力', '刚才改了什么？', '当前会话 ID 是什么？']) {
  assert.deepEqual(classifyDeterministicHarnessIntent(text), {
    kind: 'route',
    businessId: 'conversation',
    operation: 'respond',
    reason: 'conversation',
  }, text);
}

assert.deepEqual(classifyDeterministicHarnessIntent('当前工作节点是什么？'), {
  kind: 'route', businessId: 'timeline', operation: 'current', reason: 'current-node',
});
assert.deepEqual(classifyDeterministicHarnessIntent('当前队伍有谁？'), {
  kind: 'route', businessId: 'selection', operation: 'inspect', reason: 'current-roster',
});
assert.deepEqual(classifyDeterministicHarnessIntent('告诉我现在的配装'), {
  kind: 'route', businessId: 'loadout', operation: 'inspect', reason: 'current-loadout',
});
assert.deepEqual(classifyDeterministicHarnessIntent('洛茜 E 技能具体倍率是多少？'), {
  kind: 'route', businessId: 'calculation', operation: 'skill_fact', reason: 'skill-fact',
});

assert.deepEqual(classifyDeterministicHarnessIntent('继续'), { kind: 'continuation', intent: 'resume' });
assert.deepEqual(classifyDeterministicHarnessIntent('确认应用'), { kind: 'continuation', intent: 'confirm' });
assert.deepEqual(classifyDeterministicHarnessIntent('取消吧'), { kind: 'continuation', intent: 'reject' });
assert.deepEqual(classifyDeterministicHarnessIntent('刚才那套改成另一套'), { kind: 'continuation', intent: 'correct' });

for (const text of [
  '你好，顺便帮我把洛茜换成余烬',
  '帮我重新做一整套配装并计算伤害',
  '这个技能怎么样',
  '当前伤害报告里的 E 技能为什么是这个倍率',
]) {
  assert.equal(classifyDeterministicHarnessIntent(text), null, text);
}

console.log('DEF_DETERMINISTIC_HARNESS_ROUTER_OK');
