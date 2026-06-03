import { runAiCliCommand, createFallbackDraft } from './aiCliCommandService';
import { overwriteSessionState, readAgentSession, readAgentProposals } from './aiCliAgentInfrastructure';

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assertTrue(value: unknown, message: string): void {
  if (!value) {
    throw new Error(`${message}: expected truthy, got ${value}`);
  }
}

function assertFalse(value: unknown, message: string): void {
  if (value) {
    throw new Error(`${message}: expected falsy, got ${value}`);
  }
}

// Mock localStorage for Node SSR test environment
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

function clearTestStorage() {
  storage.clear();
  storage.set('def.ai-agent.proposals.v1', '[]');
  storage.set('def.ai-agent.operation-logs.v1', '[]');
  storage.set('def.ai-agent.sessions.v1', '[]');
}

const baseDraft = createFallbackDraft();

// 1. 空命令返回 type help
{
  clearTestStorage();
  const result = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-empty', client: 'rest', command: '' },
    baseDraft,
    { sourceText: '' }
  );
  assertEqual(result.ok, true, 'empty command should be ok');
  assertTrue(result.lines[0]?.includes('type help'), 'empty command should prompt type help');
}

// 2. 未知命令返回 unknown-command
{
  clearTestStorage();
  const result = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-unknown', client: 'rest', command: 'nonexistent.command' },
    baseDraft,
    { sourceText: '' }
  );
  assertFalse(result.ok, 'unknown command should not be ok');
  assertEqual(result.error?.code, 'unknown-command', 'unknown command should have code unknown-command');
}

// 3. fill.check 无效 modifier type 返回 fill-invalid
{
  clearTestStorage();
  const invalidDraft = {
    id: 'test-invalid',
    name: 'Test',
    sourceName: 'test',
    source: 'ai',
    description: 'test',
    items: [
      {
        name: 'Item',
        sourceName: 'test',
        description: 'test',
        effects: [
          {
            displayName: 'Bad Effect',
            name: 'bad-effect',
            level: '',
            source: 'ai',
            sourceName: 'test',
            description: 'test',
            condition: '',
            effectKind: 'modifier',
            type: 'invalidType',
            value: 0.2,
            evidenceText: 'test',
            confidence: 0.9,
          },
        ],
      },
    ],
  };
  const result = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-fill-invalid', client: 'rest', command: `fill.check ${JSON.stringify({ protocolVersion: 1, requestId: 'test', draft: invalidDraft })}` },
    baseDraft,
    { sourceText: '' }
  );
  assertFalse(result.ok, 'invalid fill.check should not be ok');
  assertEqual(result.error?.code, 'fill-invalid', 'invalid modifier type should return fill-invalid');
}

// 4. fill.task REST 返回 data 且无 copyText
{
  clearTestStorage();
  const result = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-fill-task-rest', client: 'rest', command: 'fill.task' },
    baseDraft,
    { sourceText: '' }
  );
  assertEqual(result.ok, true, 'fill.task REST should be ok');
  assertTrue(typeof result.data === 'object' && result.data !== null, 'fill.task should return data');
  const data = result.data as { tool?: unknown; mainStorage?: unknown };
  assertEqual(data.tool, 'buff.fill', 'fill.task should return data.tool');
  assertEqual(data.mainStorage, 'def.buff-editor.library.v1', 'fill.task should point mainStorage to library');
  assertEqual(result.copyText, undefined, 'fill.task REST should not have copyText');
}

// 5. fill.task web-cli 返回 data 且有可解析 copyText
{
  clearTestStorage();
  const result = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-fill-task-webcli', client: 'web-cli', command: 'fill.task' },
    baseDraft,
    { sourceText: '' }
  );
  assertEqual(result.ok, true, 'fill.task web-cli should be ok');
  assertTrue(typeof result.data === 'object' && result.data !== null, 'fill.task web-cli should return data');
  const data = result.data as { tool?: unknown };
  assertEqual(data.tool, 'buff.fill', 'fill.task web-cli should return data.tool');
  assertTrue(typeof result.copyText === 'string', 'fill.task web-cli should have copyText string');
  const parsed = JSON.parse(result.copyText!);
  assertEqual(parsed.tool, 'buff.fill', 'copyText should be parseable task package');
}

// 6. proposal.list 命令在空数据时返回 no pending proposals
{
  clearTestStorage();
  const result = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-proposal-list-empty', client: 'rest', command: 'proposal.list' },
    baseDraft,
    { sourceText: '' }
  );
  assertEqual(result.ok, true, 'proposal.list should be ok');
  assertTrue(result.lines.some((l) => l.includes('no pending proposals')), 'proposal.list empty should show info');
}

// 7. 普通读命令不抹掉 session 里的 proposal 状态（回归测试）
{
  clearTestStorage();
  overwriteSessionState({ proposalId: 'p1', approval: 'Wait', save: 'Wait', extra: 'keep' });
  runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-session-preserve', client: 'rest', command: 'buff.list' },
    baseDraft,
    { sourceText: '' }
  );
  const session = readAgentSession();
  const state = session?.state as Record<string, unknown> | undefined;
  assertEqual(state?.proposalId, 'p1', 'session state should preserve proposalId after read command');
  assertEqual(state?.approval, 'Wait', 'session state should preserve approval after read command');
  assertEqual(state?.save, 'Wait', 'session state should preserve save after read command');
}

// 8. fill.apply 创建 proposal 后不写 library
{
  clearTestStorage();
  const validDraft = {
    id: 'test-apply-proposal',
    name: 'Test Apply',
    sourceName: 'test',
    source: 'ai',
    description: 'test',
    items: [
      {
        name: 'Item',
        sourceName: 'test',
        description: 'test',
        effects: [
          {
            displayName: 'Atk +20%',
            name: 'atk-boost',
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
          },
        ],
      },
    ],
  };
  const result = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-fill-apply-proposal', client: 'web-cli', command: `fill.apply ${JSON.stringify(validDraft)}` },
    baseDraft,
    { sourceText: '' }
  );
  assertEqual(result.ok, true, 'fill.apply should be ok');
  assertEqual(result.effects?.writes, false, 'fill.apply should not write');
  assertTrue(result.proposal?.id, 'fill.apply should return proposal.id');
  assertEqual(result.proposal?.approval, 'Wait', 'fill.apply proposal should be Wait');
  assertEqual(result.proposal?.save, 'Wait', 'fill.apply proposal should be save=Wait');
  // library should not exist
  const libraryRaw = storage.get('def.buff-editor.library.v1');
  assertEqual(libraryRaw, undefined, 'library should not be written after fill.apply');
}

// 9. proposal.approve 后、save 前 library 不变化
{
  clearTestStorage();
  const validDraft = {
    id: 'test-approve-flow',
    name: 'Test Approve',
    sourceName: 'test',
    source: 'ai',
    description: 'test',
    items: [
      {
        name: 'Item',
        sourceName: 'test',
        description: 'test',
        effects: [
          {
            displayName: 'Atk +20%',
            name: 'atk-boost',
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
          },
        ],
      },
    ],
  };
  const applyResult = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-approve-apply', client: 'web-cli', command: `fill.apply ${JSON.stringify(validDraft)}` },
    baseDraft,
    { sourceText: '' }
  );
  const proposalId = applyResult.proposal!.id;
  // approve
  const approveResult = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-approve-approve', client: 'web-cli', command: `proposal.approve ${proposalId}` },
    baseDraft,
    { sourceText: '' }
  );
  assertEqual(approveResult.ok, true, 'proposal.approve should be ok');
  assertEqual(approveResult.proposal?.approval, 'Yes', 'proposal should be approved');
  assertEqual(approveResult.effects?.writes, true, 'proposal.approve should report writes=true');
  assertTrue(approveResult.effects?.storage?.includes('def.buff-editor.draft.v1'), 'approve storage should include draft key');
  assertFalse(approveResult.effects?.storage?.includes('def.buff-editor.library.v1'), 'approve storage should not include library key');
  // library still not written
  const libraryRaw = storage.get('def.buff-editor.library.v1');
  assertEqual(libraryRaw, undefined, 'library should not be written after approve');
  // draft should be written
  const draftRaw = storage.get('def.buff-editor.draft.v1');
  assertTrue(draftRaw, 'draft should be written after approve');
}

// 10. proposal.save 后 library 才变化
{
  clearTestStorage();
  const validDraft = {
    id: 'test-save-flow',
    name: 'Test Save',
    sourceName: 'test',
    source: 'ai',
    description: 'test',
    items: [
      {
        name: 'Item',
        sourceName: 'test',
        description: 'test',
        effects: [
          {
            displayName: 'Atk +20%',
            name: 'atk-boost',
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
          },
        ],
      },
    ],
  };
  const applyResult = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-save-apply', client: 'web-cli', command: `fill.apply ${JSON.stringify(validDraft)}` },
    baseDraft,
    { sourceText: '' }
  );
  const proposalId = applyResult.proposal!.id;
  runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-save-approve', client: 'web-cli', command: `proposal.approve ${proposalId}` },
    baseDraft,
    { sourceText: '' }
  );
  const saveResult = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-save-save', client: 'web-cli', command: `proposal.save ${proposalId}` },
    baseDraft,
    { sourceText: '' }
  );
  assertEqual(saveResult.ok, true, 'proposal.save should be ok');
  assertEqual(saveResult.effects?.writes, true, 'proposal.save should have writes=true');
  assertTrue(saveResult.effects?.storage?.includes('def.buff-editor.draft.v1'), 'buff save should touch draft');
  assertTrue(saveResult.effects?.storage?.includes('def.buff-editor.library.v1'), 'buff save should touch library');
  assertTrue(saveResult.effects?.storage?.includes('def.buff-editor.undo.v1'), 'buff save should touch undo');
  const libraryRaw = storage.get('def.buff-editor.library.v1');
  assertTrue(libraryRaw, 'library should be written after save');
  const library = JSON.parse(libraryRaw!);
  assertTrue(library['test-save-flow'], 'library should contain saved draft');
}

// 11. Y 快捷命令：approval=Wait 时执行 approve
{
  clearTestStorage();
  const validDraft = {
    id: 'test-y-approve',
    name: 'Test Y',
    sourceName: 'test',
    source: 'ai',
    description: 'test',
    items: [
      {
        name: 'Item',
        sourceName: 'test',
        description: 'test',
        effects: [
          {
            displayName: 'Atk +20%',
            name: 'atk-boost',
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
          },
        ],
      },
    ],
  };
  const applyResult = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-y-apply', client: 'web-cli', command: `fill.apply ${JSON.stringify(validDraft)}` },
    baseDraft,
    { sourceText: '' }
  );
  const proposalId = applyResult.proposal!.id;
  const yResult = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-y-command', client: 'web-cli', command: 'Y' },
    baseDraft,
    { sourceText: '' }
  );
  assertEqual(yResult.ok, true, 'Y should approve pending proposal');
  assertEqual(yResult.proposal?.approval, 'Yes', 'Y should set approval=Yes');
  const proposals = readAgentProposals();
  const p = proposals.find((pp) => pp.id === proposalId);
  assertEqual(p?.approvalStatus, 'Yes', 'proposal should be approved after Y');
}

// 12. N 快捷命令：approval=Wait 时执行 reject
{
  clearTestStorage();
  const validDraft = {
    id: 'test-n-reject',
    name: 'Test N',
    sourceName: 'test',
    source: 'ai',
    description: 'test',
    items: [
      {
        name: 'Item',
        sourceName: 'test',
        description: 'test',
        effects: [
          {
            displayName: 'Atk +20%',
            name: 'atk-boost',
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
          },
        ],
      },
    ],
  };
  const applyResult = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-n-apply', client: 'web-cli', command: `fill.apply ${JSON.stringify(validDraft)}` },
    baseDraft,
    { sourceText: '' }
  );
  const proposalId = applyResult.proposal!.id;
  const nResult = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-n-command', client: 'web-cli', command: 'N' },
    baseDraft,
    { sourceText: '' }
  );
  assertEqual(nResult.ok, true, 'N should reject pending proposal');
  assertEqual(nResult.proposal?.approval, 'No', 'N should set approval=No');
  const proposals = readAgentProposals();
  const p = proposals.find((pp) => pp.id === proposalId);
  assertEqual(p?.approvalStatus, 'No', 'proposal should be rejected after N');
}

// 13. 无 pending proposal 时 Y 返回失败
{
  clearTestStorage();
  const yResult = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-y-empty', client: 'web-cli', command: 'Y' },
    baseDraft,
    { sourceText: '' }
  );
  assertEqual(yResult.ok, false, 'Y with no pending should fail');
  assertTrue(yResult.lines.some((l) => l.includes('no pending proposals')), 'Y empty should show error');
}

// 14. 同 domain + 同 target id 已有 pending 时第二次 apply 返回错误
{
  clearTestStorage();
  const validDraft = {
    id: 'test-duplicate',
    name: 'Test Duplicate',
    sourceName: 'test',
    source: 'ai',
    description: 'test',
    items: [
      {
        name: 'Item',
        sourceName: 'test',
        description: 'test',
        effects: [
          {
            displayName: 'Atk +20%',
            name: 'atk-boost',
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
          },
        ],
      },
    ],
  };
  const first = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-dup-first', client: 'web-cli', command: `fill.apply ${JSON.stringify(validDraft)}` },
    baseDraft,
    { sourceText: '' }
  );
  assertEqual(first.ok, true, 'first apply should be ok');
  const second = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-dup-second', client: 'web-cli', command: `fill.apply ${JSON.stringify(validDraft)}` },
    baseDraft,
    { sourceText: '' }
  );
  assertFalse(second.ok, 'duplicate apply should fail');
  assertEqual(second.error?.code, 'duplicate-proposal', 'duplicate should return duplicate-proposal');
}

// 15. readonly-agent 不能执行 proposal.approve
{
  clearTestStorage();
  const validDraft = {
    id: 'test-readonly-approve',
    name: 'Test Readonly',
    sourceName: 'test',
    source: 'ai',
    description: 'test',
    items: [
      {
        name: 'Item',
        sourceName: 'test',
        description: 'test',
        effects: [
          {
            displayName: 'Atk +20%',
            name: 'atk-boost',
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
          },
        ],
      },
    ],
  };
  const applyResult = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-ro-apply', client: 'web-cli', command: `fill.apply ${JSON.stringify(validDraft)}` },
    baseDraft,
    { sourceText: '' }
  );
  const proposalId = applyResult.proposal!.id;
  const roApprove = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-ro-approve', client: 'rest', command: `proposal.approve ${proposalId}` },
    baseDraft,
    { sourceText: '' }
  );
  assertFalse(roApprove.ok, 'readonly should not approve');
  assertEqual(roApprove.error?.code, 'permission-denied', 'readonly approve should be permission-denied');
}

// 16. weapon.fill.check 拒绝非法 effect type
{
  clearTestStorage();
  const invalidWeapon = {
    id: 'test-weapon-invalid',
    name: 'Test Weapon',
    rarity: 5,
    description: 'test',
    sourceName: 'test',
    source: 'ai',
    skills: {
      skill1: {
        name: 'Skill 1',
        statType: 'atk',
        effects: {
          badEffect: {
            name: 'Bad',
            type: 'unknownEffectType',
            category: 'value',
            levels: { L1: 10 },
          },
        },
        levels: {},
      },
    },
  };
  const result = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-weapon-check-invalid', client: 'rest', command: `weapon.fill.check ${JSON.stringify(invalidWeapon)}` },
    baseDraft,
    { sourceText: '' }
  );
  assertFalse(result.ok, 'weapon.fill.check should reject invalid effect type');
  assertEqual(result.error?.code, 'fill-invalid', 'invalid weapon effect type should return fill-invalid');
}

// 17. weapon.fill.apply 创建 domain='weapon' proposal
{
  clearTestStorage();
  const validWeapon = {
    id: 'test-weapon-apply',
    name: 'Test Weapon',
    rarity: 5,
    description: 'test',
    sourceName: 'test',
    source: 'ai',
    skills: {
      skill1: {
        name: 'Skill 1',
        statType: 'atk',
        effects: {
          atkBoost: {
            name: 'Atk Boost',
            type: 'atkPercent',
            category: 'value',
            levels: { L1: 0.1 },
          },
        },
        levels: {},
      },
    },
  };
  const result = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-weapon-apply', client: 'web-cli', command: `weapon.fill.apply ${JSON.stringify(validWeapon)}` },
    baseDraft,
    { sourceText: '' }
  );
  assertEqual(result.ok, true, 'weapon.fill.apply should be ok');
  assertEqual(result.proposal?.domain, 'weapon', 'weapon.apply should create weapon domain proposal');
  assertEqual(result.effects?.writes, false, 'weapon.apply should not write');
  // buff library should not be touched
  const buffLibraryRaw = storage.get('def.buff-editor.library.v1');
  assertEqual(buffLibraryRaw, undefined, 'buff library should not be touched by weapon.apply');
  // session context/state should reflect weapon.fill workflow
  const session = readAgentSession();
  assertEqual(session?.context?.currentWorkflow, 'weapon.fill', 'session context currentWorkflow should be weapon.fill after weapon.fill.apply');
  assertEqual((session?.state as Record<string, unknown> | undefined)?.currentWorkflow, 'weapon.fill', 'session state currentWorkflow should be weapon.fill after weapon.fill.apply');
}

// 18. weapon proposal.approve 返回正确的 effects/storage
{
  clearTestStorage();
  const validWeapon = {
    id: 'test-weapon-approve',
    name: 'Test Weapon Approve',
    rarity: 5,
    description: 'test',
    sourceName: 'test',
    source: 'ai',
    skills: {
      skill1: {
        name: 'Skill 1',
        statType: 'atk',
        effects: {
          atkBoost: {
            name: 'Atk Boost',
            type: 'atkPercent',
            category: 'value',
            levels: { L1: 0.1 },
          },
        },
        levels: {},
      },
    },
  };
  const applyResult = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-weapon-approve-apply', client: 'web-cli', command: `weapon.fill.apply ${JSON.stringify(validWeapon)}` },
    baseDraft,
    { sourceText: '' }
  );
  assertEqual(applyResult.ok, true, 'weapon.apply should be ok');
  const proposalId = applyResult.proposal!.id;
  const approveResult = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-weapon-approve-approve', client: 'web-cli', command: `proposal.approve ${proposalId}` },
    baseDraft,
    { sourceText: '' }
  );
  assertEqual(approveResult.ok, true, 'weapon proposal.approve should be ok');
  assertEqual(approveResult.proposal?.approval, 'Yes', 'weapon proposal should be approved');
  assertEqual(approveResult.effects?.writes, true, 'weapon proposal.approve should report writes=true');
  assertTrue(approveResult.effects?.storage?.includes('def.weapon-sheet.draft.v1'), 'weapon approve storage should include draft key');
  assertFalse(approveResult.effects?.storage?.includes('def.weapon-sheet.library.v1'), 'weapon approve storage should not include library key');
  const weaponLibraryRaw = storage.get('def.weapon-sheet.library.v1');
  assertEqual(weaponLibraryRaw, undefined, 'weapon library should not be written after approve');
}

// 19. weapon proposal.save 返回正确的 effects/storage
{
  clearTestStorage();
  const validWeapon = {
    id: 'test-weapon-save',
    name: 'Test Weapon Save',
    rarity: 5,
    description: 'test',
    sourceName: 'test',
    source: 'ai',
    skills: {
      skill1: {
        name: 'Skill 1',
        statType: 'atk',
        effects: {
          atkBoost: {
            name: 'Atk Boost',
            type: 'atkPercent',
            category: 'value',
            levels: { L1: 0.1 },
          },
        },
        levels: {},
      },
    },
  };
  const applyResult = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-weapon-save-apply', client: 'web-cli', command: `weapon.fill.apply ${JSON.stringify(validWeapon)}` },
    baseDraft,
    { sourceText: '' }
  );
  assertEqual(applyResult.ok, true, 'weapon.apply should be ok');
  const proposalId = applyResult.proposal!.id;
  runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-weapon-save-approve', client: 'web-cli', command: `proposal.approve ${proposalId}` },
    baseDraft,
    { sourceText: '' }
  );
  const saveResult = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-weapon-save-save', client: 'web-cli', command: `proposal.save ${proposalId}` },
    baseDraft,
    { sourceText: '' }
  );
  assertEqual(saveResult.ok, true, 'weapon proposal.save should be ok');
  assertEqual(saveResult.effects?.writes, true, 'weapon proposal.save should report writes=true');
  assertTrue(saveResult.effects?.storage?.includes('def.weapon-sheet.draft.v1'), 'weapon save should touch draft');
  assertTrue(saveResult.effects?.storage?.includes('def.weapon-sheet.library.v1'), 'weapon save should touch library');
  assertFalse(saveResult.effects?.storage?.includes('def.buff-editor.undo.v1'), 'weapon save should not touch buff undo');
  const weaponLibraryRaw = storage.get('def.weapon-sheet.library.v1');
  assertTrue(weaponLibraryRaw, 'weapon library should be written after save');
}

// 20. fill.foo 不是已知命令，返回 unknown-command
{
  clearTestStorage();
  const result = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-registry-bad-action', client: 'rest', command: 'fill.foo' },
    baseDraft,
    { sourceText: '' }
  );
  assertFalse(result.ok, 'fill.foo should fail');
  assertEqual(result.error?.code, 'unknown-command', 'fill.foo should return unknown-command');
}

console.log('[ai-cli-command-service-test] passed');
