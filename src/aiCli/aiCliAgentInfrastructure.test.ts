import {
  createAgentProposal,
  readAgentProposals,
  readPendingAgentProposals,
  approveAgentProposal,
  rejectAgentProposal,
  markAgentProposalSaved,
  markAgentProposalUnsaved,
} from './aiCliAgentInfrastructure';

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

function assertNull(value: unknown, message: string): void {
  if (value !== null) {
    throw new Error(`${message}: expected null, got ${value}`);
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
}

// 1. createAgentProposal 创建 proposal 并持久化
{
  clearTestStorage();
  const before = readAgentProposals().length;
  const proposal = createAgentProposal({
    domain: 'buff',
    operation: 'fill.apply',
    payload: { test: 1 },
    approvalStatus: 'Wait',
    saveStatus: 'Wait',
    client: 'rest',
    sessionId: 'session-1',
  });
  assertTrue(proposal.id, 'proposal should have id');
  assertEqual(proposal.domain, 'buff', 'domain should be buff');
  assertEqual(proposal.approvalStatus, 'Wait', 'initial approval should be Wait');
  assertEqual(proposal.saveStatus, 'Wait', 'initial save should be Wait');
  const after = readAgentProposals().length;
  assertEqual(after, before + 1, 'proposal count should increase by 1');
}

// 2. readPendingAgentProposals 包含 approval=Wait 和 approval=Yes/save=Wait
{
  clearTestStorage();
  const p1 = createAgentProposal({
    domain: 'buff',
    operation: 'fill.apply',
    payload: {},
    approvalStatus: 'Wait',
    saveStatus: 'Wait',
    client: 'rest',
    sessionId: '',
  });
  const p2 = createAgentProposal({
    domain: 'operator',
    operation: 'operator.add',
    payload: {},
    approvalStatus: 'Yes',
    saveStatus: 'Wait',
    client: 'rest',
    sessionId: '',
  });
  createAgentProposal({
    domain: 'weapon',
    operation: 'weapon.update',
    payload: {},
    approvalStatus: 'Yes',
    saveStatus: 'Yes',
    client: 'rest',
    sessionId: '',
  });
  const pending = readPendingAgentProposals();
  assertTrue(pending.some((p) => p.id === p1.id), 'pending should include approval=Wait');
  assertTrue(pending.some((p) => p.id === p2.id), 'pending should include approval=Yes/save=Wait');
  assertEqual(
    pending.some((p) => p.domain === 'weapon' && p.saveStatus === 'Yes'),
    false,
    'pending should not include fully closed proposal'
  );
}

// 3. approveAgentProposal 只允许 approval=Wait
{
  clearTestStorage();
  const p = createAgentProposal({
    domain: 'buff',
    operation: 'fill.apply',
    payload: {},
    approvalStatus: 'Wait',
    saveStatus: 'Wait',
    client: 'rest',
    sessionId: '',
  });
  const approved = approveAgentProposal(p.id);
  assertTrue(approved, 'approve should succeed for Wait proposal');
  assertEqual(approved!.approvalStatus, 'Yes', 'after approve approval should be Yes');
  const reapprove = approveAgentProposal(p.id);
  assertNull(reapprove, 're-approve should fail for already approved proposal');
}

// 4. rejectAgentProposal 只允许 approval=Wait
{
  clearTestStorage();
  const p = createAgentProposal({
    domain: 'buff',
    operation: 'fill.apply',
    payload: {},
    approvalStatus: 'Wait',
    saveStatus: 'Wait',
    client: 'rest',
    sessionId: '',
  });
  const rejected = rejectAgentProposal(p.id);
  assertTrue(rejected, 'reject should succeed for Wait proposal');
  assertEqual(rejected!.approvalStatus, 'No', 'after reject approval should be No');
  assertEqual(rejected!.saveStatus, 'No', 'after reject save should be No');
  const rereject = rejectAgentProposal(p.id);
  assertNull(rereject, 're-reject should fail for already rejected proposal');
}

// 5. markSaved 只允许 approval=Yes && save=Wait
{
  clearTestStorage();
  const p = createAgentProposal({
    domain: 'buff',
    operation: 'fill.apply',
    payload: {},
    approvalStatus: 'Yes',
    saveStatus: 'Wait',
    client: 'rest',
    sessionId: '',
  });
  const saved = markAgentProposalSaved(p.id);
  assertTrue(saved, 'markSaved should succeed for Yes/Wait proposal');
  assertEqual(saved!.saveStatus, 'Yes', 'after markSaved save should be Yes');
  const resave = markAgentProposalSaved(p.id);
  assertNull(resave, 're-markSaved should fail for already saved proposal');
}

// 6. markUnsaved 只允许 approval=Yes && save=Wait
{
  clearTestStorage();
  const p = createAgentProposal({
    domain: 'buff',
    operation: 'fill.apply',
    payload: {},
    approvalStatus: 'Yes',
    saveStatus: 'Wait',
    client: 'rest',
    sessionId: '',
  });
  const unsaved = markAgentProposalUnsaved(p.id);
  assertTrue(unsaved, 'markUnsaved should succeed for Yes/Wait proposal');
  assertEqual(unsaved!.saveStatus, 'No', 'after markUnsaved save should be No');
  const reun = markAgentProposalUnsaved(p.id);
  assertNull(reun, 're-markUnsaved should fail for already unsaved proposal');
}

// 7. markSaved 对未审批 proposal 应失败
{
  clearTestStorage();
  const p = createAgentProposal({
    domain: 'buff',
    operation: 'fill.apply',
    payload: {},
    approvalStatus: 'Wait',
    saveStatus: 'Wait',
    client: 'rest',
    sessionId: '',
  });
  const saved = markAgentProposalSaved(p.id);
  assertNull(saved, 'markSaved should fail for approval=Wait proposal');
}

console.log('[ai-cli-agent-infrastructure-test] passed');
