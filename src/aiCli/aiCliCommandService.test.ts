import assert from 'node:assert/strict';
import { createFallbackDraft, runAiCliCommand } from './aiCliCommandService';

const storage = new Map<string, string>();
if (typeof globalThis.window === 'undefined') {
  (globalThis as unknown as Record<string, unknown>).window = {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  };
}

const baseDraft = createFallbackDraft();
const context = { sourceText: '' };

function resetStorage() {
  storage.clear();
  storage.set('def.ai-agent.proposals.v1', '[]');
  storage.set('def.ai-agent.operation-logs.v1', '[]');
  storage.set('def.ai-agent.sessions.v1', '[]');
}

function command(commandText: string, client: 'rest' | 'web-cli' = 'web-cli') {
  return runAiCliCommand({
    protocolVersion: 1,
    requestId: `test-${Math.random().toString(36).slice(2)}`,
    client,
    command: commandText,
  }, baseDraft, context);
}

function validDraft(id: string) {
  return {
    id,
    name: `Draft ${id}`,
    sourceName: 'test',
    source: 'ai',
    description: 'test',
    items: [{
      name: 'Item',
      sourceName: 'test',
      description: 'test',
      effects: [{
        displayName: 'Attack bonus',
        name: 'attack-bonus',
        level: '',
        source: 'ai',
        sourceName: 'test',
        description: 'test',
        condition: '',
        effectKind: 'modifier',
        type: 'atkPercentBoost',
        value: 0.2,
        evidenceText: 'test',
        confidence: 0.9,
      }],
    }],
  };
}

resetStorage();
const unknown = command('not-a-command', 'rest');
assert.equal(unknown.ok, false);
assert.equal(unknown.error?.code, 'unknown-command');

resetStorage();
const invalid = validDraft('invalid');
invalid.items[0].effects[0].type = 'invalidType';
const invalidResult = command(`fill.check ${JSON.stringify({
  protocolVersion: 1,
  requestId: 'invalid',
  draft: invalid,
})}`, 'rest');
assert.equal(invalidResult.ok, false);
assert.equal(invalidResult.error?.code, 'fill-invalid');

resetStorage();
const apply = command(`fill.apply ${JSON.stringify(validDraft('approval-flow'))}`);
assert.equal(apply.ok, true);
assert.equal(apply.effects?.writes, false);
assert.equal(storage.has('def.buff-editor.library.v1'), false);
assert.ok(apply.proposal?.id);

const approve = command(`proposal.approve ${apply.proposal.id}`);
assert.equal(approve.ok, true);
assert.equal(approve.proposal?.approval, 'Yes');
assert.equal(storage.has('def.buff-editor.draft.v1'), true);
assert.equal(storage.has('def.buff-editor.library.v1'), false);

const save = command(`proposal.save ${apply.proposal.id}`);
assert.equal(save.ok, true);
assert.equal(save.proposal?.save, 'Yes');
assert.equal(save.effects?.storage?.includes('def.buff-editor.library.v1'), true);
assert.ok(JSON.parse(storage.get('def.buff-editor.library.v1') ?? '{}')['approval-flow']);

resetStorage();
const readonlyApply = command(`fill.apply ${JSON.stringify(validDraft('readonly-flow'))}`);
assert.ok(readonlyApply.proposal?.id);
const readonlyApprove = command(`proposal.approve ${readonlyApply.proposal.id}`, 'rest');
assert.equal(readonlyApprove.ok, false);
assert.equal(readonlyApprove.error?.code, 'permission-denied');
assert.equal(storage.has('def.buff-editor.draft.v1'), false);

resetStorage();
assert.equal(command(`fill.apply ${JSON.stringify(validDraft('pending-a'))}`).ok, true);
assert.equal(command(`fill.apply ${JSON.stringify(validDraft('pending-b'))}`).ok, true);
const ambiguous = command('Y');
assert.equal(ambiguous.ok, false);
const pending = JSON.parse(storage.get('def.ai-agent.proposals.v1') ?? '[]') as Array<{ approvalStatus?: string }>;
assert.equal(pending.length, 2);
assert.equal(pending.every((proposal) => proposal.approvalStatus === 'Wait'), true);

console.log('AI CLI critical workflow passed');
