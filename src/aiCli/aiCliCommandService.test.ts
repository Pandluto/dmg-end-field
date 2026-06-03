import { runAiCliCommand, createFallbackDraft, resolveProposalReference, getProposalAlias, labelApproval, labelSave } from './aiCliCommandService';
import { overwriteSessionState, readAgentSession, readAgentProposals, importExternalProposals, ensureActiveSession } from './aiCliAgentInfrastructure';

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

// 8. fill.apply 创建 proposal 后不写 library，且输出中文 Y/N 提示
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
  // UX assertions
  assertTrue(result.lines.some((l) => l.includes('提案已创建')), 'fill.apply should include Chinese created message');
  assertTrue(result.lines.some((l) => l.includes('输入 Y 批准并应用到草稿')), 'fill.apply should include Chinese Y/N approval prompt');
  assertTrue(result.lines.some((l) => l.includes('输入 N 拒绝')), 'fill.apply should include Chinese reject prompt');
  // library should not exist
  const libraryRaw = storage.get('def.buff-editor.library.v1');
  assertEqual(libraryRaw, undefined, 'library should not be written after fill.apply');
}

// 9. proposal.approve 后、save 前 library 不变化，且输出中文保存 Y/N 提示
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
  // UX assertions
  assertTrue(approveResult.lines.some((l) => l.includes('已批准并应用到当前草稿')), 'approve should include Chinese approved message');
  assertTrue(approveResult.lines.some((l) => l.includes('输入 Y 保存到本地主库')), 'approve should include Chinese save Y/N prompt');
  assertTrue(approveResult.lines.some((l) => l.includes('输入 N 取消保存')), 'approve should include Chinese unsave prompt');
  // library still not written
  const libraryRaw = storage.get('def.buff-editor.library.v1');
  assertEqual(libraryRaw, undefined, 'library should not be written after approve');
  // draft should be written
  const draftRaw = storage.get('def.buff-editor.draft.v1');
  assertTrue(draftRaw, 'draft should be written after approve');
}

// 10. proposal.save 后 library 才变化，且输出中文闭环完成提示
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
  // UX assertions
  assertTrue(saveResult.lines.some((l) => l.includes('已保存到本地主库')), 'save should include Chinese saved message');
  assertTrue(saveResult.lines.some((l) => l.includes('审核闭环完成')), 'save should include Chinese done message');
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

// 11b. proposal.reject 输出中文闭环结束提示
{
  clearTestStorage();
  const validDraft = {
    id: 'test-reject-flow',
    name: 'Test Reject',
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
    { protocolVersion: 1, requestId: 'test-reject-apply', client: 'web-cli', command: `fill.apply ${JSON.stringify(validDraft)}` },
    baseDraft,
    { sourceText: '' }
  );
  const rejectResult = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-reject-cmd', client: 'web-cli', command: `proposal.reject ${applyResult.proposal!.id}` },
    baseDraft,
    { sourceText: '' }
  );
  assertEqual(rejectResult.ok, true, 'reject should be ok');
  assertTrue(rejectResult.lines.some((l) => l.includes('已拒绝提案')), 'reject should include Chinese rejected message');
  assertTrue(rejectResult.lines.some((l) => l.includes('审核闭环结束')), 'reject should include Chinese done message');
}

// 11c. proposal.unsave 输出中文闭环结束提示
{
  clearTestStorage();
  const validDraft = {
    id: 'test-unsave-flow',
    name: 'Test Unsave',
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
    { protocolVersion: 1, requestId: 'test-unsave-apply', client: 'web-cli', command: `fill.apply ${JSON.stringify(validDraft)}` },
    baseDraft,
    { sourceText: '' }
  );
  runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-unsave-approve', client: 'web-cli', command: `proposal.approve ${applyResult.proposal!.id}` },
    baseDraft,
    { sourceText: '' }
  );
  const unsaveResult = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-unsave-cmd', client: 'web-cli', command: `proposal.unsave ${applyResult.proposal!.id}` },
    baseDraft,
    { sourceText: '' }
  );
  assertEqual(unsaveResult.ok, true, 'unsave should be ok');
  assertTrue(unsaveResult.lines.some((l) => l.includes('已取消保存')), 'unsave should include Chinese unsaved message');
  assertTrue(unsaveResult.lines.some((l) => l.includes('审核闭环结束')), 'unsave should include Chinese done message');
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

// 13. 无 pending proposal 时 Y 返回中文优先失败
{
  clearTestStorage();
  const yResult = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-y-empty', client: 'web-cli', command: 'Y' },
    baseDraft,
    { sourceText: '' }
  );
  assertEqual(yResult.ok, false, 'Y with no pending should fail');
  assertTrue(yResult.lines.some((l) => l.includes('当前会话没有待处理提案')), 'Y empty should show Chinese-first error');
  assertTrue(yResult.lines.some((l) => l.includes('no pending proposals')), 'Y empty should include English fallback');
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

// 21. proposal.list 显示 #1 alias 和中文表头
{
  clearTestStorage();
  const validDraft = {
    id: 'test-list-alias',
    name: 'Test List Alias',
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
  runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-list-apply', client: 'web-cli', command: `fill.apply ${JSON.stringify(validDraft)}` },
    baseDraft,
    { sourceText: '' }
  );
  const listResult = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-list-cmd', client: 'web-cli', command: 'proposal.list' },
    baseDraft,
    { sourceText: '' }
  );
  assertEqual(listResult.ok, true, 'proposal.list should be ok');
  assertTrue(listResult.lines.some((l) => l.includes('#1')), 'proposal.list should include #1 alias');
  assertTrue(listResult.lines.some((l) => l.includes('编号/alias')), 'proposal.list should include Chinese header');
  assertTrue(listResult.lines.some((l) => l.includes('审批/approval')), 'proposal.list should include approval header');
  assertTrue(listResult.lines.some((l) => l.includes('待审批/Wait')), 'proposal.list should show Chinese approval label');
}

// 22. proposal.show #1 解析 alias 并显示中文标签
{
  clearTestStorage();
  const validDraft = {
    id: 'test-show-alias',
    name: 'Test Show Alias',
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
    { protocolVersion: 1, requestId: 'test-show-apply', client: 'web-cli', command: `fill.apply ${JSON.stringify(validDraft)}` },
    baseDraft,
    { sourceText: '' }
  );
  const fullId = applyResult.proposal!.id;
  // Test short alias #1
  const showResult = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-show-alias-cmd', client: 'web-cli', command: 'proposal.show #1' },
    baseDraft,
    { sourceText: '' }
  );
  assertEqual(showResult.ok, true, 'proposal.show #1 should be ok');
  assertTrue(showResult.lines.some((l) => l.includes('提案 / Proposal')), 'show should include Chinese proposal label');
  assertTrue(showResult.lines.some((l) => l.includes('审批 / Approval')), 'show should include Chinese approval label');
  assertTrue(showResult.lines.some((l) => l.includes('待审批/Wait')), 'show should display Chinese approval label');
  assertTrue(showResult.lines.some((l) => l.includes('待保存/Wait')), 'show should display Chinese save label');
  assertTrue(showResult.lines.some((l) => l.includes('输入 Y 批准并应用到草稿')), 'show should display Chinese next action');
  // Test full id still works
  const showFullResult = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-show-full-cmd', client: 'web-cli', command: `proposal.show ${fullId}` },
    baseDraft,
    { sourceText: '' }
  );
  assertEqual(showFullResult.ok, true, 'proposal.show with full id should be ok');
  // Test invalid alias returns error
  const showInvalidResult = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-show-invalid-cmd', client: 'web-cli', command: 'proposal.show #99' },
    baseDraft,
    { sourceText: '' }
  );
  assertFalse(showInvalidResult.ok, 'proposal.show #99 should fail');
  assertTrue(showInvalidResult.lines.some((l) => l.includes('提案未找到')), 'invalid alias should show Chinese error');
}

// 23. proposal.approve #1 支持短别名
{
  clearTestStorage();
  const validDraft = {
    id: 'test-approve-alias',
    name: 'Test Approve Alias',
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
  runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-approve-alias-apply', client: 'web-cli', command: `fill.apply ${JSON.stringify(validDraft)}` },
    baseDraft,
    { sourceText: '' }
  );
  const approveResult = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-approve-alias-cmd', client: 'web-cli', command: 'proposal.approve #1' },
    baseDraft,
    { sourceText: '' }
  );
  assertEqual(approveResult.ok, true, 'proposal.approve #1 should be ok');
  assertEqual(approveResult.proposal?.approval, 'Yes', 'proposal.approve #1 should approve');
  assertTrue(approveResult.lines.some((l) => l.includes('已批准并应用到当前草稿')), 'approve #1 should show Chinese message');
}

// 24. 多 pending 时 Y 返回中文优先歧义错误
{
  clearTestStorage();
  const validDraft1 = {
    id: 'test-multi-y-1',
    name: 'Test Multi Y 1',
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
  const validDraft2 = {
    id: 'test-multi-y-2',
    name: 'Test Multi Y 2',
    sourceName: 'test',
    source: 'ai',
    description: 'test',
    items: [
      {
        name: 'Item2',
        sourceName: 'test',
        description: 'test',
        effects: [
          {
            displayName: 'SubStat +10%',
            name: 'substat-boost',
            level: '',
            source: 'ai',
            sourceName: 'test',
            description: 'test',
            condition: '',
            effectKind: 'modifier',
            type: 'subStatBoost',
            value: 0.1,
            evidenceText: 'test',
            confidence: 0.9,
          },
        ],
      },
    ],
  };
  runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-multi-y-apply1', client: 'web-cli', command: `fill.apply ${JSON.stringify(validDraft1)}` },
    baseDraft,
    { sourceText: '' }
  );
  runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-multi-y-apply2', client: 'web-cli', command: `fill.apply ${JSON.stringify(validDraft2)}` },
    baseDraft,
    { sourceText: '' }
  );
  const yResult = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-multi-y-cmd', client: 'web-cli', command: 'Y' },
    baseDraft,
    { sourceText: '' }
  );
  assertEqual(yResult.ok, false, 'Y with multiple pending should fail');
  assertTrue(yResult.lines.some((l) => l.includes('当前会话有 2 个待处理提案')), 'Y with multiple pending should show Chinese count');
  assertTrue(yResult.lines.some((l) => l.includes('请使用 proposal.list 查看')), 'Y with multiple pending should suggest proposal.list');
}

// 25. resolveProposalReference 和 getProposalAlias 纯函数测试
{
  clearTestStorage();
  // Create a proposal
  const validDraft = {
    id: 'test-helper-funcs',
    name: 'Test Helper Funcs',
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
    { protocolVersion: 1, requestId: 'test-helper-apply', client: 'web-cli', command: `fill.apply ${JSON.stringify(validDraft)}` },
    baseDraft,
    { sourceText: '' }
  );
  const proposalId = applyResult.proposal!.id;
  // Test getProposalAlias
  const alias = getProposalAlias(proposalId);
  assertEqual(alias, '#1', 'first proposal should be #1');
  // Test resolveProposalReference with alias
  const byAlias = resolveProposalReference('#1');
  assertTrue(byAlias !== null && byAlias.id === proposalId, 'resolveProposalReference #1 should return the proposal');
  // Test resolveProposalReference with full id
  const byId = resolveProposalReference(proposalId);
  assertTrue(byId !== null && byId.id === proposalId, 'resolveProposalReference with full id should return the proposal');
  // Test resolveProposalReference with invalid alias
  const byInvalid = resolveProposalReference('#99');
  assertEqual(byInvalid, null, 'resolveProposalReference #99 should return null');
  // Test label functions
  assertEqual(labelApproval('Wait'), '待审批/Wait', 'labelApproval Wait');
  assertEqual(labelApproval('Yes'), '已审批/Yes', 'labelApproval Yes');
  assertEqual(labelApproval('No'), '已拒绝/No', 'labelApproval No');
  assertEqual(labelSave('Wait'), '待保存/Wait', 'labelSave Wait');
  assertEqual(labelSave('Yes'), '已保存/Yes', 'labelSave Yes');
  assertEqual(labelSave('No'), '未保存/No', 'labelSave No');
}

// 26. N 快捷命令时无 pending 返回中文错误
{
  clearTestStorage();
  const nResult = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-n-empty', client: 'web-cli', command: 'N' },
    baseDraft,
    { sourceText: '' }
  );
  assertEqual(nResult.ok, false, 'N with no pending should fail');
  assertTrue(nResult.lines.some((l) => l.includes('当前会话没有待处理提案')), 'N empty should show Chinese-first error');
}

// 27. importExternalProposals 导入外部 proposal 到 localStorage
{
  clearTestStorage();
  const session = ensureActiveSession('web-cli');
  const extProposal = {
    id: 'ext-proposal-1',
    domain: 'buff' as const,
    operation: 'buff.fill.apply',
    payload: { id: 'ext-draft', name: 'Ext Draft' },
    approvalStatus: 'Wait' as const,
    saveStatus: 'Wait' as const,
    client: 'rest' as const,
    sessionId: 'rest-session-id',
    summary: 'External buff draft',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const handoff = importExternalProposals([extProposal], session.id);
  assertEqual(handoff.imported, 1, 'should import 1 external proposal');
  assertEqual(handoff.pendingCount, 1, 'should have 1 pending after import');
  assertTrue(handoff.lines.some((l) => l.includes('已接收外部待审批提案')), 'handoff should show Chinese message');
  const proposals = readAgentProposals();
  assertEqual(proposals.length, 1, 'localStorage should have 1 proposal');
  assertEqual(proposals[0]!.id, 'ext-proposal-1', 'imported proposal id should match');
  assertEqual(proposals[0]!.sessionId, session.id, 'imported proposal sessionId should be current session');
  assertEqual(proposals[0]!.reviewedBy, 'web-cli', 'imported proposal reviewedBy should be web-cli');
  assertEqual(proposals[0]!.client, 'rest', 'imported proposal client should remain rest');
}

// 28. importExternalProposals 去重：重复导入同 id 不重复
{
  clearTestStorage();
  const session = ensureActiveSession('web-cli');
  const extProposal = {
    id: 'ext-proposal-dup',
    domain: 'buff' as const,
    operation: 'buff.fill.apply',
    payload: { id: 'ext-draft-dup', name: 'Ext Draft Dup' },
    approvalStatus: 'Wait' as const,
    saveStatus: 'Wait' as const,
    client: 'rest' as const,
    sessionId: 'rest-session-id',
    summary: 'External buff draft dup',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  importExternalProposals([extProposal], session.id);
  const handoff2 = importExternalProposals([extProposal], session.id);
  assertEqual(handoff2.imported, 0, 'duplicate import should not add new proposal');
  assertEqual(handoff2.pendingCount, 1, 'pending count should remain 1');
  const proposals = readAgentProposals();
  assertEqual(proposals.length, 1, 'localStorage should still have 1 proposal');
}

// 29. importExternalProposals 浏览器侧状态优先：本地已 saved/rejected 不被 pending 覆盖
{
  clearTestStorage();
  const session = ensureActiveSession('web-cli');
  // First create a local proposal and save it
  const validDraft = {
    id: 'test-browser-wins',
    name: 'Test Browser Wins',
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
    { protocolVersion: 1, requestId: 'test-browser-wins-apply', client: 'web-cli', command: `fill.apply ${JSON.stringify(validDraft)}` },
    baseDraft,
    { sourceText: '' }
  );
  const proposalId = applyResult.proposal!.id;
  runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-browser-wins-approve', client: 'web-cli', command: `proposal.approve ${proposalId}` },
    baseDraft,
    { sourceText: '' }
  );
  runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-browser-wins-save', client: 'web-cli', command: `proposal.save ${proposalId}` },
    baseDraft,
    { sourceText: '' }
  );
  // Now try to import an external proposal with same id but pending status
  const extProposal = {
    id: proposalId,
    domain: 'buff' as const,
    operation: 'buff.fill.apply',
    payload: { id: 'ext-draft', name: 'Ext Draft' },
    approvalStatus: 'Wait' as const,
    saveStatus: 'Wait' as const,
    client: 'rest' as const,
    sessionId: 'rest-session-id',
    summary: 'External same id',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const handoff = importExternalProposals([extProposal], session.id);
  assertEqual(handoff.imported, 0, 'should not overwrite saved local proposal');
  const proposals = readAgentProposals();
  const local = proposals.find((p) => p.id === proposalId);
  assertEqual(local?.approvalStatus, 'Yes', 'local approval should remain Yes');
  assertEqual(local?.saveStatus, 'Yes', 'local save should remain Yes');
}

// 30. importExternalProposals session 接管：导入后 Y 能查到并 approve
{
  clearTestStorage();
  const session = ensureActiveSession('web-cli');
  const extProposal = {
    id: 'ext-proposal-yy',
    domain: 'buff' as const,
    operation: 'buff.fill.apply',
    payload: { id: 'ext-yy-draft', name: 'Ext YY Draft', sourceName: 'test', source: 'ai', description: 'test', items: [] },
    approvalStatus: 'Wait' as const,
    saveStatus: 'Wait' as const,
    client: 'rest' as const,
    sessionId: 'rest-session-id',
    summary: 'External YY draft',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  importExternalProposals([extProposal], session.id);
  // First Y should approve
  const y1 = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-ext-y1', client: 'web-cli', command: 'Y' },
    baseDraft,
    { sourceText: '' }
  );
  assertEqual(y1.ok, true, 'first Y should approve imported proposal');
  assertEqual(y1.proposal?.approval, 'Yes', 'proposal should be approved after first Y');
  // Second Y should save
  const y2 = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-ext-y2', client: 'web-cli', command: 'Y' },
    baseDraft,
    { sourceText: '' }
  );
  assertEqual(y2.ok, true, 'second Y should save imported proposal');
  assertEqual(y2.proposal?.save, 'Yes', 'proposal should be saved after second Y');
}

// 31. importExternalProposals 多 pending 时 Y 返回 ambiguous
{
  clearTestStorage();
  const session = ensureActiveSession('web-cli');
  const ext1 = {
    id: 'ext-multi-1',
    domain: 'buff' as const,
    operation: 'buff.fill.apply',
    payload: { id: 'ext-m1', name: 'Ext M1', sourceName: 'test', source: 'ai', description: 'test', items: [] },
    approvalStatus: 'Wait' as const,
    saveStatus: 'Wait' as const,
    client: 'rest' as const,
    sessionId: 'rest-session-id',
    summary: 'External multi 1',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const ext2 = {
    id: 'ext-multi-2',
    domain: 'buff' as const,
    operation: 'buff.fill.apply',
    payload: { id: 'ext-m2', name: 'Ext M2', sourceName: 'test', source: 'ai', description: 'test', items: [] },
    approvalStatus: 'Wait' as const,
    saveStatus: 'Wait' as const,
    client: 'rest' as const,
    sessionId: 'rest-session-id',
    summary: 'External multi 2',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  importExternalProposals([ext1, ext2], session.id);
  const yResult = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-ext-multi-y', client: 'web-cli', command: 'Y' },
    baseDraft,
    { sourceText: '' }
  );
  assertEqual(yResult.ok, false, 'Y with multiple imported pending should fail');
  assertTrue(yResult.lines.some((l) => l.includes('当前会话有 2 个待处理提案')), 'Y should show Chinese ambiguous error for 2 pending');
}

// 32. importExternalProposals 不写入 buff/weapon library/draft
{
  clearTestStorage();
  const session = ensureActiveSession('web-cli');
  const extProposal = {
    id: 'ext-no-side-effect',
    domain: 'buff' as const,
    operation: 'buff.fill.apply',
    payload: { id: 'ext-no-side', name: 'Ext No Side', sourceName: 'test', source: 'ai', description: 'test', items: [] },
    approvalStatus: 'Wait' as const,
    saveStatus: 'Wait' as const,
    client: 'rest' as const,
    sessionId: 'rest-session-id',
    summary: 'External no side effect',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  importExternalProposals([extProposal], session.id);
  const libraryRaw = storage.get('def.buff-editor.library.v1');
  const draftRaw = storage.get('def.buff-editor.draft.v1');
  assertEqual(libraryRaw, undefined, 'import should not write library');
  assertEqual(draftRaw, undefined, 'import should not write draft');
}

// 33. proposal.show 显示来源/审核者
{
  clearTestStorage();
  const session = ensureActiveSession('web-cli');
  const extProposal = {
    id: 'ext-show-source',
    domain: 'buff' as const,
    operation: 'buff.fill.apply',
    payload: { id: 'ext-show', name: 'Ext Show', sourceName: 'test', source: 'ai', description: 'test', items: [] },
    approvalStatus: 'Wait' as const,
    saveStatus: 'Wait' as const,
    client: 'rest' as const,
    sessionId: 'rest-session-id',
    summary: 'External show source',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  importExternalProposals([extProposal], session.id);
  const showResult = runAiCliCommand(
    { protocolVersion: 1, requestId: 'test-show-source-cmd', client: 'web-cli', command: 'proposal.show #1' },
    baseDraft,
    { sourceText: '' }
  );
  assertEqual(showResult.ok, true, 'proposal.show should be ok');
  assertTrue(showResult.lines.some((l) => l.includes('来源 / Source: rest')), 'show should display source client');
  assertTrue(showResult.lines.some((l) => l.includes('审核 / Reviewer: web-cli')), 'show should display reviewer');
}

console.log('[ai-cli-command-service-test] passed');
