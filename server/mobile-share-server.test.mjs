import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  MOBILE_SHARE_TTL_MS,
  MobileShareServiceError,
  createMobileShareRequestHandler,
  createMobileShareStore,
} from './mobile-share-server.mjs';

const FIXED_NOW = 1_800_000_000_000;

function createPayload(label = '测试') {
  return {
    schemaVersion: 1,
    dataVersion: 'v1.8.4',
    imageVersion: 'v1.8.3',
    draft: {
      schemaVersion: 1,
      selectedOperatorIds: ['operator-1'],
      operatorConfigs: {},
      slots: [{ id: 'slot-1', action: null }],
      reportNotes: { 'slot-1::lane-0': label },
      activePage: 'report',
      activeOperatorId: 'operator-1',
      updatedAt: 1,
    },
  };
}

function createComplexPayload() {
  const selectedOperatorIds = ['operator-alpha', 'operator-beta', 'operator-gamma', 'operator-delta'];
  const equipment = (prefix) => ({
    armor: { equipmentId: `${prefix}-armor`, effectLevels: { effect1: 3, effect2: 2 } },
    glove: { equipmentId: `${prefix}-glove`, effectLevels: { effect1: 2 } },
    accessory1: { equipmentId: `${prefix}-accessory-a`, effectLevels: { effect2: 3 } },
    accessory2: { equipmentId: `${prefix}-accessory-b`, effectLevels: { effect3: 1 } },
  });
  const operatorConfigs = Object.fromEntries(selectedOperatorIds.map((characterId, index) => [
    characterId,
    {
      characterId,
      level: 90 - index,
      potential: `${index}潜`,
      favorValue: 60 - index,
      mainStatFlatBonus: 60 + index,
      subStatFlatBonus: 10 + index,
      skillLevels: { A: 'M3', B: 'M2', E: 'M3', Q: 'M1', Dot: 'M3' },
      weapon: {
        weaponId: `weapon-${index + 1}`,
        level: 90,
        potential: `${index}潜`,
        skillLevels: { skill1: 9, skill2: 8, skill3: 4 },
      },
      equipment: equipment(`operator-${index + 1}`),
    },
  ]));
  const buffs = [
    {
      schemaVersion: 2,
      id: 'buff-countable',
      name: 'stacking_attack',
      displayName: '可叠层攻击提升',
      sourceName: '测试专用三件套',
      type: 'attack',
      value: 0.12,
      category: 'countable',
      maxStacks: 5,
      refCount: 1,
      target: { mode: 'all' },
    },
    {
      schemaVersion: 2,
      id: 'buff-derived',
      name: 'agility_to_attack',
      displayName: '敏捷转换攻击',
      sourceName: '测试专用武器',
      valueMode: 'derived',
      derivedValue: { source: 'agility', perPointValue: 0.35 },
      refCount: 1,
      target: { mode: 'damageKey', key: 'hit-2' },
    },
    {
      schemaVersion: 2,
      id: 'buff-multiplier',
      name: 'independent_multiplier',
      displayName: '独立乘区',
      sourceName: '测试专用干员',
      multiplier: { coefficient: 1.15 },
      condition: 'default',
      refCount: 1,
      target: { mode: 'element', element: 'electric' },
    },
  ];
  const firstAction = {
    id: 'action-alpha-a',
    operatorId: selectedOperatorIds[0],
    skillType: 'A',
    runtimeSkillId: 'runtime-alpha-a',
    skillName: '测试普攻·四段',
    skillIconUrl: '/assets/images/test-alpha-a.webp',
    buffs,
    buffStackCounts: { 'buff-countable': 4, 'buff-derived': 1 },
    buffStackCountsByHitKey: {
      'hit-1': { 'buff-countable': 2 },
      'hit-2': { 'buff-countable': 5, 'buff-multiplier': 1 },
    },
    globallyDisabledBuffIds: ['buff-disabled-global'],
    disabledBuffIdsByHitKey: {
      'hit-3': ['buff-derived'],
      'burn-dot': ['buff-multiplier'],
    },
    disabledHitKeys: ['hit-4'],
    targetResistance: {
      physicalResistance: 0.3,
      fireResistance: -0.15,
      electricResistance: 0.55,
      iceResistance: 0,
      natureResistance: 0.2,
    },
    anomalyStatuses: [{
      id: 'status-conductive',
      key: 'conductive',
      label: '导电',
      kind: 'state',
      category: 'magic',
      level: 3,
      sourceName: '测试技能',
      primaryText: '导电强度 128',
      secondaryText: '持续 12 秒',
      selectedBuffIds: ['buff-derived', 'buff-multiplier'],
    }],
    anomalyDamages: [{
      id: 'damage-burn',
      key: 'burn',
      label: '燃烧',
      kind: 'damage',
      category: 'magic',
      level: 3,
      includeDotInTotal: true,
      burnDamageMode: 'splitDot',
      durationSeconds: 10,
      primaryText: '初始伤害 4096',
      secondaryText: '持续伤害 512/s',
      tertiaryText: '完整燃烧结算',
      selectedBuffIds: ['buff-countable'],
    }, {
      id: 'damage-smash',
      key: 'smash',
      label: '猛击',
      kind: 'damage',
      category: 'physical',
      level: 2,
      primaryText: '猛击伤害 8192',
      secondaryText: '碎甲参与结算',
      selectedBuffIds: [],
    }],
    anomalyStateSnapshots: [{
      id: 101,
      key: 'conductive',
      label: '导电快照',
      level: 3,
      sourceButtonId: 'action-alpha-a',
      sourceCharacterId: selectedOperatorIds[0],
      sourceCharacterName: '测试干员·甲',
      sourceSkillStrengthSnapshot: 256,
      effectValue: 0.42,
      durationSeconds: 12,
      primaryText: '原始记忆强度 256',
      secondaryText: '导电减抗 42%',
      tertiaryText: '先应用快照，再计算异常',
      createdAt: FIXED_NOW - 1_000,
    }, {
      id: 102,
      key: 'armor-break',
      label: '碎甲快照',
      level: 2,
      sourceButtonId: 'action-beta-e',
      sourceCharacterId: selectedOperatorIds[1],
      sourceCharacterName: '测试干员·乙',
      sourceSkillStrengthSnapshot: 180,
      effectValue: 0.28,
      primaryText: '碎甲 28%',
      secondaryText: '作用于猛击',
      createdAt: FIXED_NOW - 500,
    }],
  };

  return {
    schemaVersion: 1,
    dataVersion: 'v1.8.4+matrix.完整',
    imageVersion: 'v1.8.3+国内图片包',
    draft: {
      schemaVersion: 1,
      selectedOperatorIds,
      operatorConfigs,
      slots: [
        { id: 'slot-01', action: firstAction },
        { id: 'slot-02', action: null },
        {
          id: 'slot-03',
          action: {
            ...firstAction,
            id: 'action-beta-e',
            operatorId: selectedOperatorIds[1],
            skillType: 'E',
            runtimeSkillId: 'runtime-beta-e',
            skillName: '测试战技·异常引爆',
            skillIconUrl: '/assets/images/test-beta-e.webp?版本=1',
            buffs: buffs.slice(1),
            anomalyStatuses: [],
            anomalyDamages: [],
          },
        },
        { id: 'slot-04', action: null },
        { id: 'slot-05', action: null },
        { id: 'slot-06', action: null },
        { id: 'slot-07', action: null },
        { id: 'slot-08', action: null },
      ],
      reportNotes: {
        'slot-02::lane-2': '先叠满 5 层，再触发导电；不要提前释放。',
        'slot-04::lane-0': '切换目标：抗性 55%，等待碎甲生效。',
        'slot-08::lane-3': '收尾：燃烧 DoT 计入总伤。',
      },
      activePage: 'report',
      activeOperatorId: selectedOperatorIds[2],
      updatedAt: FIXED_NOW - 2_000,
    },
  };
}

async function startHttpService(options = {}) {
  const handler = createMobileShareRequestHandler(options);
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
      handler.close();
    },
  };
}

async function readJson(response) {
  return response.json();
}

test('keeps only the latest three active shares per IP and expires them after 24 hours', () => {
  let timestamp = FIXED_NOW;
  const store = createMobileShareStore({
    dbPath: ':memory:',
    now: () => timestamp,
  });
  try {
    const shares = [];
    for (let index = 0; index < 4; index += 1) {
      shares.push(store.create(createPayload(`批注 ${index + 1}`), '203.0.113.8'));
      timestamp += 1;
    }
    assert.equal(store.get(shares[0].id), null);
    assert.equal(store.get(shares[1].id)?.payload.draft.reportNotes['slot-1::lane-0'], '批注 2');
    assert.equal(store.stats().active, 3);
    assert.equal(store.stats().createdLastHour, 4);

    timestamp += MOBILE_SHARE_TTL_MS + 1;
    assert.equal(store.get(shares[3].id), null);
    assert.equal(store.stats().active, 0);
  } finally {
    store.close();
  }
});

test('enforces the global hourly creation limit without deleting valid shares', () => {
  const store = createMobileShareStore({
    dbPath: ':memory:',
    now: () => FIXED_NOW,
    hourlyLimit: 2,
  });
  try {
    const first = store.create(createPayload('第一份'), '203.0.113.1');
    const second = store.create(createPayload('第二份'), '203.0.113.2');
    assert.throws(
      () => store.create(createPayload('第三份'), '203.0.113.3'),
      (error) => error instanceof MobileShareServiceError
        && error.status === 429
        && error.code === 'HOURLY_LIMIT',
    );
    assert.ok(store.get(first.id));
    assert.ok(store.get(second.id));
    assert.equal(store.stats().active, 2);
  } finally {
    store.close();
  }
});

test('round-trips a complete mobile workspace through real HTTP without losing nested data', async () => {
  const service = await startHttpService({ now: () => FIXED_NOW });
  try {
    const payload = createComplexPayload();
    const createResponse = await fetch(`${service.baseUrl}/api/mobile-shares`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-forwarded-for': '203.0.113.41, 127.0.0.1',
      },
      body: JSON.stringify(payload),
    });
    assert.equal(createResponse.status, 201);
    assert.equal(createResponse.headers.get('cache-control'), 'no-store');
    const created = await readJson(createResponse);
    assert.match(created.id, /^[A-Za-z0-9_-]{16}$/);
    assert.equal(created.createdAt, FIXED_NOW);
    assert.equal(created.expiresAt, FIXED_NOW + MOBILE_SHARE_TTL_MS);

    const getResponse = await fetch(`${service.baseUrl}/api/mobile-shares/${created.id}`);
    assert.equal(getResponse.status, 200);
    assert.equal(getResponse.headers.get('cache-control'), 'no-store');
    assert.deepEqual((await readJson(getResponse)).payload, payload);
  } finally {
    await service.close();
  }
});

test('keeps a complete share readable after the SQLite service is restarted', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dmg-mobile-share-test-'));
  const dbPath = join(directory, 'mobile-shares.sqlite');
  let service;
  try {
    const payload = createComplexPayload();
    service = await startHttpService({ dbPath, now: () => FIXED_NOW });
    const createResponse = await fetch(`${service.baseUrl}/api/mobile-shares`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const created = await readJson(createResponse);
    assert.equal(createResponse.status, 201);
    await service.close();
    service = undefined;

    service = await startHttpService({ dbPath, now: () => FIXED_NOW + 10_000 });
    const restoredResponse = await fetch(`${service.baseUrl}/api/mobile-shares/${created.id}`);
    assert.equal(restoredResponse.status, 200);
    assert.deepEqual((await readJson(restoredResponse)).payload, payload);
  } finally {
    if (service) await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('keeps per-IP eviction and hourly counters effective across service restarts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dmg-mobile-share-limits-test-'));
  const dbPath = join(directory, 'mobile-shares.sqlite');
  let service;
  try {
    const firstGenerationIds = [];
    service = await startHttpService({ dbPath, now: () => FIXED_NOW, hourlyLimit: 4 });
    for (let index = 0; index < 3; index += 1) {
      const response = await fetch(`${service.baseUrl}/api/mobile-shares`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '198.51.100.44',
        },
        body: JSON.stringify(createPayload(`重启前 ${index + 1}`)),
      });
      assert.equal(response.status, 201);
      firstGenerationIds.push((await readJson(response)).id);
    }
    await service.close();
    service = undefined;

    service = await startHttpService({ dbPath, now: () => FIXED_NOW + 1, hourlyLimit: 4 });
    const fourthResponse = await fetch(`${service.baseUrl}/api/mobile-shares`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '198.51.100.44',
      },
      body: JSON.stringify(createPayload('重启后第 4 份')),
    });
    assert.equal(fourthResponse.status, 201);
    const fourthId = (await readJson(fourthResponse)).id;
    assert.equal((await fetch(`${service.baseUrl}/api/mobile-shares/${firstGenerationIds[0]}`)).status, 404);
    assert.equal((await fetch(`${service.baseUrl}/api/mobile-shares/${fourthId}`)).status, 200);

    const overHourlyLimit = await fetch(`${service.baseUrl}/api/mobile-shares`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.200',
      },
      body: JSON.stringify(createPayload('重启后超出每小时上限')),
    });
    assert.equal(overHourlyLimit.status, 429);
    assert.equal((await readJson(overHourlyLimit)).code, 'HOURLY_LIMIT');
  } finally {
    if (service) await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('accepts new shares after the rolling one-hour creation window has elapsed', async () => {
  let timestamp = FIXED_NOW;
  const service = await startHttpService({ now: () => timestamp, hourlyLimit: 1 });
  try {
    const first = await fetch(`${service.baseUrl}/api/mobile-shares`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createPayload('窗口内第一份')),
    });
    assert.equal(first.status, 201);

    timestamp += 60 * 60 * 1_000 + 1;
    const nextWindow = await fetch(`${service.baseUrl}/api/mobile-shares`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createPayload('下一小时第一份')),
    });
    assert.equal(nextWindow.status, 201);
    const health = await fetch(`${service.baseUrl}/api/mobile-shares/health`);
    assert.deepEqual(await readJson(health), { ok: true, active: 2, createdLastHour: 1 });
  } finally {
    await service.close();
  }
});

test('honors forwarded client IPs and removes the oldest share on the fourth creation', async () => {
  let timestamp = FIXED_NOW;
  const service = await startHttpService({ now: () => timestamp });
  try {
    const ids = [];
    for (let index = 0; index < 4; index += 1) {
      const response = await fetch(`${service.baseUrl}/api/mobile-shares`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '198.51.100.91, 127.0.0.1',
        },
        body: JSON.stringify(createPayload(`HTTP 分享 ${index + 1}`)),
      });
      assert.equal(response.status, 201);
      ids.push((await readJson(response)).id);
      timestamp += 1;
    }

    assert.equal((await fetch(`${service.baseUrl}/api/mobile-shares/${ids[0]}`)).status, 404);
    for (const id of ids.slice(1)) {
      assert.equal((await fetch(`${service.baseUrl}/api/mobile-shares/${id}`)).status, 200);
    }
    const health = await fetch(`${service.baseUrl}/api/mobile-shares/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await readJson(health), { ok: true, active: 3, createdLastHour: 4 });
  } finally {
    await service.close();
  }
});

test('returns an expired share as not found and removes it from health statistics', async () => {
  let timestamp = FIXED_NOW;
  const service = await startHttpService({ now: () => timestamp });
  try {
    const createResponse = await fetch(`${service.baseUrl}/api/mobile-shares`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createPayload('即将过期')),
    });
    const { id } = await readJson(createResponse);
    timestamp += MOBILE_SHARE_TTL_MS;

    const expiredResponse = await fetch(`${service.baseUrl}/api/mobile-shares/${id}`);
    assert.equal(expiredResponse.status, 404);
    assert.deepEqual(await readJson(expiredResponse), {
      code: 'SHARE_NOT_FOUND',
      message: '分享不存在或已经过期。',
    });
    const health = await fetch(`${service.baseUrl}/api/mobile-shares/health`);
    assert.deepEqual(await readJson(health), { ok: true, active: 0, createdLastHour: 0 });
  } finally {
    await service.close();
  }
});

test('enforces the hourly limit over HTTP and keeps earlier shares readable', async () => {
  const service = await startHttpService({ now: () => FIXED_NOW, hourlyLimit: 2 });
  try {
    const ids = [];
    for (let index = 0; index < 2; index += 1) {
      const response = await fetch(`${service.baseUrl}/api/mobile-shares`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': `203.0.113.${index + 1}`,
        },
        body: JSON.stringify(createPayload(`允许 ${index + 1}`)),
      });
      assert.equal(response.status, 201);
      ids.push((await readJson(response)).id);
    }
    const limited = await fetch(`${service.baseUrl}/api/mobile-shares`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.3',
      },
      body: JSON.stringify(createPayload('超出上限')),
    });
    assert.equal(limited.status, 429);
    assert.deepEqual(await readJson(limited), {
      code: 'HOURLY_LIMIT',
      message: '本小时分享名额已用完，请稍后再试。',
    });
    for (const id of ids) {
      assert.equal((await fetch(`${service.baseUrl}/api/mobile-shares/${id}`)).status, 200);
    }
  } finally {
    await service.close();
  }
});

test('rejects invalid content types, malformed JSON, invalid drafts, and oversized payloads', async () => {
  const service = await startHttpService({ now: () => FIXED_NOW, maxPayloadBytes: 1_024 });
  try {
    const wrongType = await fetch(`${service.baseUrl}/api/mobile-shares`, {
      method: 'POST',
      body: JSON.stringify(createPayload()),
    });
    assert.equal(wrongType.status, 415);
    assert.equal((await readJson(wrongType)).code, 'JSON_REQUIRED');

    const malformed = await fetch(`${service.baseUrl}/api/mobile-shares`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"schemaVersion":1,',
    });
    assert.equal(malformed.status, 400);
    assert.equal((await readJson(malformed)).code, 'INVALID_JSON');

    const tooManyOperators = createPayload();
    tooManyOperators.draft.selectedOperatorIds = ['a', 'b', 'c', 'd', 'e'];
    const invalidDraft = await fetch(`${service.baseUrl}/api/mobile-shares`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(tooManyOperators),
    });
    assert.equal(invalidDraft.status, 400);
    assert.equal((await readJson(invalidDraft)).code, 'INVALID_DRAFT');

    const longNote = createPayload('字'.repeat(161));
    const invalidNote = await fetch(`${service.baseUrl}/api/mobile-shares`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(longNote),
    });
    assert.equal(invalidNote.status, 400);
    assert.equal((await readJson(invalidNote)).code, 'INVALID_NOTES');

    const oversized = { ...createPayload(), padding: 'x'.repeat(2_000) };
    const oversizedResponse = await fetch(`${service.baseUrl}/api/mobile-shares`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(oversized),
    });
    assert.equal(oversizedResponse.status, 413);
    assert.equal((await readJson(oversizedResponse)).code, 'PAYLOAD_TOO_LARGE');

    const requestTooLarge = { ...createPayload(), padding: 'x'.repeat(20_000) };
    const requestTooLargeResponse = await fetch(`${service.baseUrl}/api/mobile-shares`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestTooLarge),
    });
    assert.equal(requestTooLargeResponse.status, 413);
    assert.equal((await readJson(requestTooLargeResponse)).code, 'REQUEST_TOO_LARGE');
  } finally {
    await service.close();
  }
});

test('returns no-store JSON for health and stable 404 responses for unknown API routes', async () => {
  const service = await startHttpService({ now: () => FIXED_NOW });
  try {
    const health = await fetch(`${service.baseUrl}/api/mobile-shares/health`);
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal(health.headers.get('cache-control'), 'no-store');
    assert.equal(health.headers.get('x-content-type-options'), 'nosniff');

    const invalidId = await fetch(`${service.baseUrl}/api/mobile-shares/not-a-share-id`);
    assert.equal(invalidId.status, 404);
    assert.equal((await readJson(invalidId)).code, 'NOT_FOUND');

    const wrongMethod = await fetch(`${service.baseUrl}/api/mobile-shares`, { method: 'PUT' });
    assert.equal(wrongMethod.status, 404);
    assert.equal((await readJson(wrongMethod)).code, 'NOT_FOUND');

    const options = await fetch(`${service.baseUrl}/api/mobile-shares`, { method: 'OPTIONS' });
    assert.equal(options.status, 204);
    assert.equal(options.headers.get('cache-control'), 'no-store');
  } finally {
    await service.close();
  }
});
