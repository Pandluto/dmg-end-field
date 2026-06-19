import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const HOST = '127.0.0.1';
const PORT = Number(process.env.AI_CLI_REST_PORT || 17322);
const BASE_URL = `http://${HOST}:${PORT}`;

// Clean runtime storage before each smoke run to avoid duplicate-proposal errors
const runtimeStoragePath = path.join(process.cwd(), '.runtime', 'ai-cli-rest', 'localStorage.json');
if (fs.existsSync(runtimeStoragePath)) {
  fs.unlinkSync(runtimeStoragePath);
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForHealth() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 20000) {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok) {
        return await response.json();
      }
    } catch {
      await delay(250);
    }
  }
  throw new Error('AI CLI REST server did not become healthy');
}

async function request(method, path, body) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  return { status: response.status, payload };
}

async function readFirstSseEvent(path) {
  const response = await fetch(`${BASE_URL}${path}`);
  if (!response.ok || !response.body) {
    throw new Error(`SSE request failed: ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const startedAt = Date.now();
  try {
    while (Date.now() - startedAt < 5000) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      text += decoder.decode(value, { stream: true });
      if (text.includes('\n\n')) {
        return text;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  throw new Error('SSE event was not received');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const server = spawn(process.execPath, ['scripts/ai-cli-rest-server.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    AI_CLI_REST_PORT: String(PORT),
    AI_CLI_REST_STORAGE_MODE: 'runtime',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

let stderr = '';
server.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
});

try {
  const health = await waitForHealth();
  assert(health.ok === true, 'health should be ok');
  assert(health.pid === server.pid, 'health should report the spawned REST pid');
  assert(health.diagnostics?.weaponFill?.contractVersion?.includes('condition-passive'), 'health should expose current weapon fill contract');
  assert(health.diagnostics?.weaponFill?.validEffectCategories?.includes('condition'), 'health should expose condition category');
  assert(health.diagnostics?.weaponFill?.validEffectCategories?.includes('passive'), 'health should expose passive category');
  assert(health.diagnostics?.weaponFill?.supportedEffectTypeCount > 50, 'health should expose expanded weapon effect types');

  const guide = await request('GET', '/api/agent/guide');
  assert(guide.status === 200, `guide status=${guide.status}`);
  assert(guide.payload.ok === true, 'guide should be ok');
  assert(Array.isArray(guide.payload.recommendedFlow), 'guide should include recommended flow');
  assert(guide.payload.mainTruth?.storage === 'localStorage.def.buff-editor.library.v1', 'guide should describe library as main truth');
  assert(guide.payload.formats?.readFormat?.name === 'BuffDraft', 'guide should describe read format');
  assert(guide.payload.formats?.writeProposalFormat?.name === 'BuffFillAiDraft', 'guide should describe write proposal format');
  assert(guide.payload.clientHints?.handoff?.includes('Do not re-run fill.apply'), 'guide clientHints.handoff should mention not re-running fill.apply');
  assert(guide.payload.weaponTruth?.sourceData?.includes('/api/weapon/data'), 'guide should describe weapon source data endpoints');
  const safetyRules = guide.payload.safetyRules || [];
  assert(safetyRules.some((r) => r.includes('proposal creation only')), 'guide safetyRules should mention proposal creation only');
  assert(safetyRules.some((r) => r.includes('re-run fill.apply')), 'guide safetyRules should mention not re-running fill.apply');
  assert(safetyRules.some((r) => r.includes('/api/weapon/data/<name>')), 'guide safetyRules should mention reading weapon source data');

  const skills = await request('GET', '/api/agent/skills');
  assert(skills.status === 200, `skills status=${skills.status}`);
  assert(skills.payload.ok === true, 'skills should be ok');
  assert(skills.payload.skills?.[0]?.id === 'buff.fill', 'skills should include buff.fill');
  assert(skills.payload.skills?.some((skill) => skill.id === 'weapon.fill'), 'skills should include weapon.fill');
  const buffSkillProcedure = skills.payload.skills[0].procedure || [];
  assert(buffSkillProcedure.some((s) => s.includes('proposal')), 'buff.fill skill procedure should mention proposal');
  assert(buffSkillProcedure.some((s) => s.includes('re-run fill.apply')), 'buff.fill skill procedure should mention not re-running fill.apply');
  const weaponSkill = skills.payload.skills.find((skill) => skill.id === 'weapon.fill');
  assert(weaponSkill.readBeforeUse?.some((s) => s.includes('/api/weapon/data/<name>')), 'weapon.fill skill should tell agents to read weapon source data');

  const spec = await request('GET', '/api/ai-cli/spec');
  assert(spec.status === 200, `spec status=${spec.status}`);
  assert(spec.payload.ok === true, 'spec should be ok');
  assert(Array.isArray(spec.payload.endpoints), 'spec should expose endpoints');
  assert(spec.payload.endpoints.includes('GET /api/buff/fill/template'), 'spec should expose fill template endpoint');
  assert(spec.payload.formats?.writeProposalFormat?.shape?.includes('items is an array'), 'spec should warn about fill array format');
  assert(Array.isArray(spec.payload.commands), 'spec should expose commands array');
  assert(spec.payload.diagnostics?.weaponFill?.validEffectCategories?.join('/') === 'condition/passive', 'spec diagnostics should expose current weapon fill categories');
  const expectedCommands = [
    'agent.logs', 'agent.sessions', 'agent.guide',
    'buff.open', 'draft.rename',
    'item.add', 'item.set', 'item.delete',
    'effect.add', 'effect.set', 'effect.delete',
    'operator.add', 'operator.show', 'operator.delete',
  ];
  for (const cmd of expectedCommands) {
    assert(spec.payload.commands.includes(cmd), `spec should include ${cmd}`);
  }
  assert(spec.payload.commandUsage?.['effect.add']?.includes('type='), 'spec should include effect.add usage with key=value format');
  assert(spec.payload.commandUsage?.['item.set']?.includes('name='), 'spec should include item.set usage with key=value format');

  const firstEvent = await readFirstSseEvent('/api/agent/events');
  assert(firstEvent.includes('event: agent.records'), 'SSE should emit agent.records');

  const current = await request('GET', '/api/buff/current');
  assert(current.status === 200, `current status=${current.status}`);
  assert(current.payload.ok === true, 'current should be ok');
  assert(current.payload.warning?.includes('Do not submit'), 'current should warn read shape is not fill shape');

  const weaponCurrent = await request('GET', '/api/weapon/current');
  assert(weaponCurrent.status === 200, `weapon current status=${weaponCurrent.status}`);
  assert(weaponCurrent.payload.ok === true, 'weapon current should be ok');
  assert(weaponCurrent.payload.format === 'WeaponDraft', 'weapon current should return WeaponDraft format');

  const weaponData = await request('GET', '/api/weapon/data');
  assert(weaponData.status === 200, `weapon data status=${weaponData.status}`);
  assert(weaponData.payload.ok === true, 'weapon data should be ok');
  assert(weaponData.payload.weapons?.some((weapon) => weapon.name === '赫拉芬格'), 'weapon data should include 赫拉芬格');

  const weaponSource = await request('GET', '/api/weapon/data/%E8%B5%AB%E6%8B%89%E8%8A%AC%E6%A0%BC');
  assert(weaponSource.status === 200, `weapon source status=${weaponSource.status}`);
  assert(weaponSource.payload.ok === true, 'weapon source should be ok');
  assert(weaponSource.payload.name === '赫拉芬格', 'weapon source should return 赫拉芬格');
  assert(weaponSource.payload.files?.base?.name === '赫拉芬格', 'weapon source should include base data');

  const libraryBefore = await request('GET', '/api/buff/library');
  assert(libraryBefore.status === 200, `library status=${libraryBefore.status}`);
  assert(libraryBefore.payload.ok === true, 'library should be ok');
  assert(Array.isArray(libraryBefore.payload.summary), 'library should include summary');
  assert(libraryBefore.payload.warning?.includes('fill.check'), 'library should warn about write proposal format');

  const fillTemplate = await request('GET', '/api/buff/fill/template');
  assert(fillTemplate.status === 200, `fill template status=${fillTemplate.status}`);
  assert(fillTemplate.payload.ok === true, 'fill template should be ok');
  assert(Array.isArray(fillTemplate.payload.template.items), 'fill template items should be an array');
  assert(Array.isArray(fillTemplate.payload.template.items[0].effects), 'fill template effects should be an array');
  assert(fillTemplate.payload.template.items[0].effects[0].evidenceText, 'fill template should include evidenceText');

  const show = await request('POST', '/api/ai-cli/run', {
    protocolVersion: 1,
    requestId: 'rest-smoke-draft-show',
    command: 'draft.show',
  });
  assert(show.status === 200, `draft.show status=${show.status}`);
  assert(show.payload.ok === true, 'draft.show should be ok');
  assert(show.payload.data?.draft?.id, 'draft.show should return structured data.draft with id');

  const fillTask = await request('POST', '/api/ai-cli/run', {
    protocolVersion: 1,
    requestId: 'rest-smoke-fill-task',
    command: 'fill.task',
  });
  assert(fillTask.status === 200, `fill.task status=${fillTask.status}`);
  assert(fillTask.payload.ok === true, 'fill.task should be ok');
  assert(fillTask.payload.lines?.[0]?.includes('fill.task ready'), 'fill.task should return a short summary line');
  assert(!fillTask.payload.lines?.[0]?.trim().startsWith('{'), 'fill.task should not put JSON in lines[0]');
  assert(fillTask.payload.data?.tool === 'buff.fill', 'fill.task should return structured data.tool');
  assert(fillTask.payload.data?.outputSchema, 'fill.task should return structured outputSchema');
  assert(fillTask.payload.data?.modifierCatalog, 'fill.task should return structured modifierCatalog');
  assert(fillTask.payload.data?.instruction?.includes('proposal only'), 'fill.task instruction should mention proposal only');
  assert(fillTask.payload.data?.approvalSaveWarning?.includes('handed off'), 'fill.task should include approvalSaveWarning about handoff');
  assert(fillTask.payload.copyText === undefined, 'fill.task should not return copyText for REST client');

  const fillTaskWebCli = await request('POST', '/api/ai-cli/run?client=web-cli', {
    protocolVersion: 1,
    requestId: 'rest-smoke-fill-task-webcli',
    command: 'fill.task',
  });
  assert(fillTaskWebCli.status === 200, `fill.task web-cli status=${fillTaskWebCli.status}`);
  assert(fillTaskWebCli.payload.ok === true, 'fill.task web-cli should be ok');
  assert(typeof fillTaskWebCli.payload.copyText === 'string', 'fill.task web-cli should return copyText');
  assert(JSON.parse(fillTaskWebCli.payload.copyText).tool === 'buff.fill', 'fill.task web-cli copyText should be parseable task package');

  const fillTaskCopy = await request('POST', '/api/ai-cli/run', {
    protocolVersion: 1,
    requestId: 'rest-smoke-fill-task-copy',
    command: 'fill.task.copy',
  });
  assert(fillTaskCopy.status === 200, `fill.task.copy status=${fillTaskCopy.status}`);
  assert(fillTaskCopy.payload.ok === true, 'fill.task.copy should be ok');
  assert(typeof fillTaskCopy.payload.copyText === 'string', 'fill.task.copy should return copyText');
  assert(JSON.parse(fillTaskCopy.payload.copyText).tool === 'buff.fill', 'fill.task.copy copyText should be parseable task package');

  const list = await request('POST', '/api/ai-cli/run', {
    protocolVersion: 1,
    requestId: 'rest-smoke-buff-list',
    command: 'buff.list',
  });
  assert(list.status === 200, `buff.list status=${list.status}`);
  assert(list.payload.ok === true, 'buff.list should be ok');

  const invalidCheck = await request('POST', '/api/buff/fill/check', {
    protocolVersion: 1,
    requestId: 'rest-smoke-invalid',
    draft: {
      id: 'invalid',
      items: [],
    },
  });
  assert(invalidCheck.status === 400, `invalid check status=${invalidCheck.status}`);
  assert(invalidCheck.payload.ok === false, 'invalid check should fail');

  const validDraft = {
    id: 'ai-result',
    name: 'REST smoke result',
    sourceName: 'REST smoke',
    source: 'ai',
    description: 'REST smoke description',
    items: [
      {
        name: '测试 Buff',
        sourceName: '测试来源',
        description: '提高攻击力',
        effects: [
          {
            displayName: '攻击力提升',
            name: '攻击力提升',
            level: '',
            source: 'ai',
            sourceName: '测试来源',
            description: '攻击力+20%',
            condition: '',
            effectKind: 'modifier',
            type: 'atkPercentBoost',
            value: 0.2,
            evidenceText: '攻击力+20%',
            confidence: 0.9,
          },
        ],
      },
    ],
  };

  const validCheck = await request('POST', '/api/buff/fill/check', {
    protocolVersion: 1,
    requestId: 'rest-smoke-valid-check',
    draft: validDraft,
  });
  assert(validCheck.status === 200, `valid check status=${validCheck.status}`);
  assert(validCheck.payload.ok === true, 'valid check should pass');
  assert(validCheck.payload.effects?.writes === false, 'fill.check should have effects.writes === false');

  const apply = await request('POST', '/api/buff/fill/apply?client=web-cli', {
    protocolVersion: 1,
    requestId: 'rest-smoke-valid-apply',
    draft: validDraft,
  });
  assert(apply.status === 200, `apply status=${apply.status}`);
  assert(apply.payload.ok === true, 'apply should pass for web-cli');
  assert(apply.payload.effects?.writes === false, 'apply should create proposal, not write library');
  assert(apply.payload.proposal?.id, 'apply should return proposal.id');
  assert(apply.payload.proposal?.approval === 'Wait', 'apply proposal should be Wait');
  assert(apply.payload.proposal?.save === 'Wait', 'apply proposal should be save=Wait');
  assert(apply.payload.proposal?.nextAction?.includes('Web CLI') || apply.payload.proposal?.nextAction?.includes('Y to approve'), 'apply proposal.nextAction should guide user to Web CLI Y/Y');
  const applyLines = apply.payload.lines || [];
  assert(applyLines.some((l) => l.includes('handoff') || l.includes('Web CLI')), 'apply lines should mention handoff or Web CLI');

  const libraryAfterApply = await request('GET', '/api/buff/library/ai-result');
  assert(libraryAfterApply.status === 404, `library entry should not exist after apply-only: status=${libraryAfterApply.status}`);

  const unknownCmd = await request('POST', '/api/ai-cli/run', {
    protocolVersion: 1,
    requestId: 'rest-smoke-unknown-cmd',
    command: 'nonexistent.command',
  });
  assert(unknownCmd.status === 400, `unknown command status=${unknownCmd.status}`);
  assert(unknownCmd.payload.ok === false, 'unknown command should fail');
  assert(unknownCmd.payload.error?.code === 'unknown-command', 'unknown command should return error.code "unknown-command"');

  const search = await request('POST', '/api/ai-cli/run', {
    protocolVersion: 1,
    requestId: 'rest-smoke-buff-search',
    command: 'buff.search REST',
  });
  assert(search.status === 200, `buff.search status=${search.status}`);
  assert(search.payload.ok === true, 'buff.search should be ok');

  const logs = await request('GET', '/api/agent/logs');
  assert(logs.status === 200, `agent logs status=${logs.status}`);
  assert(logs.payload.ok === true, 'agent logs should be ok');
  assert(Array.isArray(logs.payload.operationLogs), 'agent logs should be an array');
  assert(logs.payload.operationLogs.length >= 1, 'agent logs should include REST calls');

  const sessions = await request('GET', '/api/agent/sessions');
  assert(sessions.status === 200, `agent sessions status=${sessions.status}`);
  assert(sessions.payload.ok === true, 'agent sessions should be ok');
  assert(Array.isArray(sessions.payload.sessions), 'agent sessions should be an array');

  const records = await request('GET', '/api/agent/records');
  assert(records.status === 200, `agent records status=${records.status}`);
  assert(records.payload.ok === true, 'agent records should be ok');
  assert(Array.isArray(records.payload.operationLogs), 'agent records should include logs');
  assert(Array.isArray(records.payload.sessions), 'agent records should include sessions');

  const proposalList = await request('POST', '/api/ai-cli/run', {
    protocolVersion: 1,
    requestId: 'rest-smoke-proposal-list',
    command: 'proposal.list',
  });
  assert(proposalList.status === 200, `proposal.list status=${proposalList.status}`);
  assert(proposalList.payload.ok === true, 'proposal.list should be ok');
  assert(Array.isArray(proposalList.payload.lines), 'proposal.list should return lines');
  assert(proposalList.payload.lines.length >= 1, 'proposal.list lines should not be empty');
  assert(Array.isArray(proposalList.payload.data?.proposals), 'proposal.list data.proposals should be an array');

  console.log('[ai-cli-rest-smoke] passed');
} finally {
  server.kill();
  if (stderr.trim()) {
    console.error(stderr.trim());
  }
}
