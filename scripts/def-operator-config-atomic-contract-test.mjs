import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildDefOperatorConfigInput, executeDefOperatorConfigAtomic } from '../agent/runtime/def-tools/opencode/operator-config-input.mjs';

const args = {
  characterId: 'saixi',
  weaponName: '骑士精神',
  weaponLevel: 90,
  weaponSkill1Level: 9,
  weaponSkill2Level: 9,
  weaponSkill3Level: 4,
  weaponPotential: 'PMAX',
  equipments: [
    { equipmentId: 'armor-id', equipmentName: '护甲', slotKey: 'armor', equipmentEntryLevel: 3 },
    { equipmentId: 'accessory-1-id', slotKey: 'accessory1', equipmentEntryLevel: 3 },
    { equipmentId: 'accessory-2-id', slotKey: 'accessory2', equipmentEntryLevel: 3 },
    { equipmentId: 'glove-id', slotKey: 'glove', equipmentEntryLevel: 3 },
  ],
};

const input = buildDefOperatorConfigInput(args);
assert.equal(input.weapon.name, '骑士精神');
assert.equal(input.weapon.potential, 'PMAX');
assert.equal(input.equipments.length, 4);
assert.deepEqual(input.equipments.map((piece) => [piece.equipmentId, piece.slotKey, piece.entryLevel]), [
  ['armor-id', 'armor', 3],
  ['accessory-1-id', 'accessory1', 3],
  ['accessory-2-id', 'accessory2', 3],
  ['glove-id', 'glove', 3],
]);

const calls = [];
const prepared = {
  nodeId: 'candidate-node', nodeRevision: 12, parentNodeId: 'parent-node', parentRevision: 7,
  timelineId: 'timeline', axisBindingId: 'axis', workingHash: 'working-hash',
  finalConfig: { characterId: 'saixi', weapon: { name: '骑士精神' }, equipment: [] },
  checkout: { nodeId: 'parent-node', revision: 7 },
};
const applied = await executeDefOperatorConfigAtomic(args, { sessionID: 'session' }, {
  callDefTool: async (tool, callInput) => {
    calls.push({ tool, input: callInput });
    if (tool === 'def.operator.config.prepare') return prepared;
    if (tool === 'def.operator.config.apply_prepared') return { ok: true, code: 'applied', postcondition: { pass: true } };
    throw new Error(`Unexpected tool: ${tool}`);
  },
  askWithApproval: async (_context, approval) => {
    calls.push({ tool: 'native-approval', input: approval });
    return { approvalCapability: 'approved-capability' };
  },
  formatApprovalPatterns: () => ['complete-reviewed-config'],
});
assert.equal(applied.code, 'applied');
assert.deepEqual(calls.map((call) => call.tool), [
  'def.operator.config.prepare',
  'native-approval',
  'def.operator.config.apply_prepared',
]);
assert.equal(calls[2].input.approvalCapability, 'approved-capability');
assert.equal(calls[2].input.input.equipments.length, 4);

const rejectedCalls = [];
await assert.rejects(() => executeDefOperatorConfigAtomic(args, { sessionID: 'session' }, {
  callDefTool: async (tool) => {
    rejectedCalls.push(tool);
    if (tool === 'def.operator.config.prepare') return prepared;
    if (tool === 'def.operator.config.discard_prepared') return { ok: true, discarded: true };
    throw new Error(`Unexpected tool: ${tool}`);
  },
  askWithApproval: async () => { throw new Error('User rejected native approval.'); },
  formatApprovalPatterns: () => ['complete-reviewed-config'],
}), /User rejected/);
assert.deepEqual(rejectedCalls, ['def.operator.config.prepare', 'def.operator.config.discard_prepared']);

const pluginSource = fs.readFileSync(new URL('../agent/runtime/def-tools/opencode/def.js', import.meta.url), 'utf8');
assert.match(pluginSource, /equipments:\s*tool\.schema\.array\(tool\.schema\.object/);
assert.match(pluginSource, /executeDefOperatorConfigAtomic\(args, context/);

console.log(JSON.stringify({
  ok: true,
  checks: ['four-piece-schema', 'single-approval-apply', 'approval-capability-scope', 'reject-discard', 'no-partial-mutation'],
}));
