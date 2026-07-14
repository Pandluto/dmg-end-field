import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const HOST = '127.0.0.1';
const PORT = Number(process.env.DEF_GAME_KNOWLEDGE_CHECK_PORT || 17329);
const BASE_URL = `http://${HOST}:${PORT}`;
const targetReferenceId = '【萌新推荐】弭弗x陈千语x埃特拉x阿列什 低配高伤&无脑循环打法教学.md';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok) return;
    } catch {
      // The isolated server has not finished binding its loopback port.
    }
    await delay(150);
  }
  throw new Error('game-knowledge contract server did not become healthy');
}

async function call(tool, input) {
  const response = await fetch(`${BASE_URL}/api/def-tools/call`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tool, input }),
  });
  const payload = await response.json();
  return { status: response.status, payload };
}

function errorCode(payload) {
  return payload?.code || payload?.error?.code || payload?.result?.code;
}

const server = spawn(process.execPath, ['scripts/ai-cli-rest-server.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    AI_CLI_REST_PORT: String(PORT),
    AI_CLI_REST_STORAGE_MODE: 'runtime',
  },
  stdio: ['ignore', 'ignore', 'pipe'],
  windowsHide: true,
});

let stderr = '';
server.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

try {
  await waitForHealth();
  const search = await call('def.knowledge.game.search', {
    query: '你知道 YZ 的新手碎冰队吗？四个人分别是谁，攻略里怎么配装备？',
    limit: 3,
  });
  assert.equal(search.status, 200, `reference search status=${search.status}`);
  const candidate = search.payload?.result?.candidates?.find((item) => item.referenceId === targetReferenceId);
  assert.ok(candidate, `reference search should recall the exact beginner ice-team guide: ${JSON.stringify(search.payload)}`);
  assert.equal(candidate.recommendedSection?.heading, '三、装备养成推荐', 'search should identify the guide equipment section');
  assert.ok(candidate.headings?.some((item) => item.heading === '3.4 阿列什'), 'heading index should include 阿列什');

  const section = await call('def.knowledge.game.section.read', {
    referenceId: candidate.referenceId,
    sectionId: candidate.recommendedSection.sectionId,
  });
  assert.equal(section.status, 200, `section read status=${section.status}`);
  const result = section.payload?.result;
  assert.equal(result.contract, 'DefGameKnowledgeSectionReadV1');
  assert.equal(result.section?.heading, '三、装备养成推荐');
  for (const heading of ['3.1 弭弗（主 C）', '3.2 陈千语', '3.3 埃特拉', '3.4 阿列什']) {
    assert.ok(result.content?.includes(heading), `continuous section should include ${heading}`);
  }
  assert.ok(result.content?.length > 600, 'section content must not be cut by the generic 600-character resource limit');
  assert.equal(typeof result.truncated, 'boolean', 'section should report truncation fact');
  assert.ok(Object.hasOwn(result, 'nextSection'), 'section should report nextSection continuation fact');
  assert.ok(Array.isArray(result.availableSections), 'section should report available section index');

  const traversal = await call('def.knowledge.game.section.read', {
    referenceId: '../package.json',
    sectionId: candidate.recommendedSection.sectionId,
  });
  assert.equal(traversal.status, 400, 'path traversal referenceId must fail');
  assert.equal(errorCode(traversal.payload), 'invalid-game-knowledge-reference');

  const unknownReference = await call('def.knowledge.game.section.read', {
    referenceId: 'not-allowlisted.md',
    sectionId: candidate.recommendedSection.sectionId,
  });
  assert.equal(unknownReference.status, 404, 'unknown reference must fail closed');
  assert.equal(errorCode(unknownReference.payload), 'game-knowledge-reference-not-allowed');

  const unknownSection = await call('def.knowledge.game.section.read', {
    referenceId: candidate.referenceId,
    sectionId: 'h2-not-real',
  });
  assert.equal(unknownSection.status, 404, 'unknown heading/section must fail closed');
  assert.equal(errorCode(unknownSection.payload), 'game-knowledge-section-not-found');

  console.log(JSON.stringify({
    ok: true,
    checks: ['reference-recall', 'continuous-3.1-3.4', '600-char-bypass', 'truncation-metadata', 'path-traversal', 'unknown-reference', 'unknown-section'],
  }));
} finally {
  if (server.exitCode === null && server.signalCode === null) {
    const exited = new Promise((resolve) => server.once('exit', resolve));
    server.kill('SIGTERM');
    await exited;
  }
  if (stderr.trim()) process.stderr.write(stderr);
}
