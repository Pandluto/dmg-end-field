import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import {
  MOBILE_SHARE_DEVICE_COOKIE,
  MOBILE_SHARE_RATE_WINDOW_MS,
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

function readDeviceCookie(response) {
  const setCookie = response.headers.get('set-cookie') || '';
  assert.match(setCookie, new RegExp(`^${MOBILE_SHARE_DEVICE_COOKIE}=[A-Za-z0-9_.%-]+;`));
  assert.match(setCookie, /; Max-Age=\d+; HttpOnly; SameSite=Lax/);
  return setCookie.split(';')[0];
}

test('keeps every created share permanently while rate events age out', () => {
  let timestamp = FIXED_NOW;
  const store = createMobileShareStore({
    dbPath: ':memory:',
    now: () => timestamp,
  });
  try {
    const shares = [];
    for (let index = 0; index < 4; index += 1) {
      shares.push(store.create(
        createPayload(`批注 ${index + 1}`),
        '203.0.113.8',
        `device-${index + 1}`,
      ));
      timestamp += 1;
    }
    assert.equal(store.get(shares[0].id)?.payload.draft.reportNotes['slot-1::lane-0'], '批注 1');
    assert.equal(store.get(shares[1].id)?.payload.draft.reportNotes['slot-1::lane-0'], '批注 2');
    assert.deepEqual(store.stats(), { active: 4, permanent: 4, createdLast24Hours: 4 });

    timestamp += MOBILE_SHARE_RATE_WINDOW_MS * 365;
    assert.ok(store.get(shares[0].id));
    assert.ok(store.get(shares[3].id));
    assert.deepEqual(store.stats(), { active: 4, permanent: 4, createdLast24Hours: 0 });
  } finally {
    store.close();
  }
});

test('reuses an identical permanent payload without spending another creation slot', () => {
  const store = createMobileShareStore({
    dbPath: ':memory:',
    now: () => FIXED_NOW,
    dailyLimit: 1,
  });
  try {
    const payload = createPayload('完全相同');
    const first = store.create(payload, '203.0.113.1', 'device-a');
    const reused = store.create(payload, '203.0.113.2', 'device-b');
    assert.equal(first.reused, false);
    assert.equal(reused.reused, true);
    assert.equal(reused.id, first.id);
    assert.equal(reused.createdAt, first.createdAt);
    assert.deepEqual(store.stats(), { active: 1, permanent: 1, createdLast24Hours: 1 });
  } finally {
    store.close();
  }
});

test('accepts only server-signed device tokens and replaces tampered identities', () => {
  const store = createMobileShareStore({ dbPath: ':memory:' });
  try {
    const issued = store.resolveDevice('');
    const verified = store.resolveDevice(issued.token);
    const replacement = issued.token.endsWith('A') ? 'B' : 'A';
    const tampered = store.resolveDevice(`${issued.token.slice(0, -1)}${replacement}`);
    assert.equal(verified.id, issued.id);
    assert.equal(verified.token, issued.token);
    assert.notEqual(tampered.id, issued.id);
    assert.notEqual(tampered.token, issued.token);
  } finally {
    store.close();
  }
});

test('enforces the global 24-hour creation limit without deleting permanent shares', () => {
  const store = createMobileShareStore({
    dbPath: ':memory:',
    now: () => FIXED_NOW,
    dailyLimit: 2,
  });
  try {
    const first = store.create(createPayload('第一份'), '203.0.113.1', 'device-a');
    const second = store.create(createPayload('第二份'), '203.0.113.2', 'device-b');
    assert.throws(
      () => store.create(createPayload('第三份'), '203.0.113.3', 'device-c'),
      (error) => error instanceof MobileShareServiceError
        && error.status === 429
        && error.code === 'DAILY_LIMIT',
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
        'x-forwarded-proto': 'https',
      },
      body: JSON.stringify(payload),
    });
    assert.equal(createResponse.status, 201);
    assert.equal(createResponse.headers.get('cache-control'), 'no-store');
    const setCookie = createResponse.headers.get('set-cookie') || '';
    readDeviceCookie(createResponse);
    assert.match(setCookie, /; Secure$/);
    const created = await readJson(createResponse);
    assert.match(created.id, /^[A-Za-z0-9_-]{16}$/);
    assert.equal(created.createdAt, FIXED_NOW);
    assert.equal(created.expiresAt, null);
    assert.equal(created.permanent, true);
    assert.equal(created.reused, false);

    const getResponse = await fetch(`${service.baseUrl}/api/mobile-shares/${created.id}`);
    assert.equal(getResponse.status, 200);
    assert.equal(getResponse.headers.get('cache-control'), 'no-store');
    const restored = await readJson(getResponse);
    assert.equal(restored.expiresAt, null);
    assert.equal(restored.permanent, true);
    assert.deepEqual(restored.payload, payload);
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

    service = await startHttpService({
      dbPath,
      now: () => FIXED_NOW + (MOBILE_SHARE_RATE_WINDOW_MS * 365),
    });
    const restoredResponse = await fetch(`${service.baseUrl}/api/mobile-shares/${created.id}`);
    assert.equal(restoredResponse.status, 200);
    assert.deepEqual((await readJson(restoredResponse)).payload, payload);
  } finally {
    if (service) await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('keeps the signed browser-device limit effective across service restarts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dmg-mobile-share-limits-test-'));
  const dbPath = join(directory, 'mobile-shares.sqlite');
  let service;
  try {
    const firstGenerationIds = [];
    let deviceCookie = '';
    service = await startHttpService({
      dbPath,
      now: () => FIXED_NOW,
      perDeviceDailyLimit: 3,
      perIpDailyLimit: 100,
      dailyLimit: 100,
    });
    for (let index = 0; index < 3; index += 1) {
      const response = await fetch(`${service.baseUrl}/api/mobile-shares`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': `198.51.100.${index + 40}`,
          ...(deviceCookie ? { cookie: deviceCookie } : {}),
        },
        body: JSON.stringify(createPayload(`重启前 ${index + 1}`)),
      });
      assert.equal(response.status, 201);
      if (!deviceCookie) {
        deviceCookie = readDeviceCookie(response);
        assert.doesNotMatch(response.headers.get('set-cookie') || '', /; Secure/);
      }
      firstGenerationIds.push((await readJson(response)).id);
    }
    await service.close();
    service = undefined;

    service = await startHttpService({
      dbPath,
      now: () => FIXED_NOW + 1,
      perDeviceDailyLimit: 3,
      perIpDailyLimit: 100,
      dailyLimit: 100,
    });
    const fourthResponse = await fetch(`${service.baseUrl}/api/mobile-shares`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.200',
        cookie: deviceCookie,
      },
      body: JSON.stringify(createPayload('重启后第 4 份')),
    });
    assert.equal(fourthResponse.status, 429);
    assert.equal((await readJson(fourthResponse)).code, 'DEVICE_DAILY_LIMIT');
    for (const id of firstGenerationIds) {
      assert.equal((await fetch(`${service.baseUrl}/api/mobile-shares/${id}`)).status, 200);
    }

    const duplicateResponse = await fetch(`${service.baseUrl}/api/mobile-shares`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.200',
        cookie: deviceCookie,
      },
      body: JSON.stringify(createPayload('重启前 1')),
    });
    assert.equal(duplicateResponse.status, 200);
    const duplicate = await readJson(duplicateResponse);
    assert.equal(duplicate.reused, true);
    assert.equal(duplicate.id, firstGenerationIds[0]);
  } finally {
    if (service) await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('accepts new shares after the rolling 24-hour creation window has elapsed', async () => {
  let timestamp = FIXED_NOW;
  const service = await startHttpService({
    now: () => timestamp,
    perDeviceDailyLimit: 100,
    perIpDailyLimit: 100,
    dailyLimit: 1,
  });
  try {
    const first = await fetch(`${service.baseUrl}/api/mobile-shares`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createPayload('窗口内第一份')),
    });
    assert.equal(first.status, 201);

    timestamp += MOBILE_SHARE_RATE_WINDOW_MS + 1;
    const nextWindow = await fetch(`${service.baseUrl}/api/mobile-shares`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createPayload('下一小时第一份')),
    });
    assert.equal(nextWindow.status, 201);
    const health = await fetch(`${service.baseUrl}/api/mobile-shares/health`);
    assert.deepEqual(await readJson(health), {
      ok: true,
      active: 2,
      permanent: 2,
      createdLast24Hours: 1,
    });
  } finally {
    await service.close();
  }
});

test('honors forwarded client IPs and rejects excess creation without deleting shares', async () => {
  let timestamp = FIXED_NOW;
  const service = await startHttpService({
    now: () => timestamp,
    perDeviceDailyLimit: 100,
    perIpDailyLimit: 3,
    dailyLimit: 100,
  });
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
      if (index < 3) {
        assert.equal(response.status, 201);
        ids.push((await readJson(response)).id);
      } else {
        assert.equal(response.status, 429);
        assert.equal((await readJson(response)).code, 'IP_DAILY_LIMIT');
      }
      timestamp += 1;
    }

    for (const id of ids) {
      assert.equal((await fetch(`${service.baseUrl}/api/mobile-shares/${id}`)).status, 200);
    }
    const health = await fetch(`${service.baseUrl}/api/mobile-shares/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await readJson(health), {
      ok: true,
      active: 3,
      permanent: 3,
      createdLast24Hours: 3,
    });
  } finally {
    await service.close();
  }
});

test('migrates an old expiring SQLite database in place and preserves its share IDs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dmg-mobile-share-migration-test-'));
  const dbPath = join(directory, 'mobile-shares.sqlite');
  const legacyId = 'LegacyShare00001';
  const legacyPayload = createPayload('旧版二维码仍然可用');
  let database = new DatabaseSync(dbPath);
  try {
    database.exec(`
      CREATE TABLE mobile_share_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
      CREATE TABLE mobile_shares (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        payload_bytes INTEGER NOT NULL,
        ip_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE mobile_share_creation_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      ) STRICT;
    `);
    const serialized = JSON.stringify(legacyPayload);
    database.prepare(`
      INSERT INTO mobile_shares (
        id, payload, payload_bytes, ip_hash, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      legacyId,
      serialized,
      Buffer.byteLength(serialized),
      'legacy-ip-hash',
      FIXED_NOW - MOBILE_SHARE_RATE_WINDOW_MS,
      FIXED_NOW - 1,
    );
    database.prepare("INSERT INTO mobile_share_meta (key, value) VALUES ('ip_salt', ?)")
      .run('a'.repeat(64));
    database.close();

    const store = createMobileShareStore({ dbPath, now: () => FIXED_NOW });
    const migrated = store.get(legacyId);
    assert.equal(migrated?.permanent, true);
    assert.equal(migrated?.expiresAt, null);
    assert.deepEqual(migrated?.payload, legacyPayload);
    store.close();

    database = new DatabaseSync(dbPath);
    const shareColumns = database.prepare('PRAGMA table_info(mobile_shares)').all();
    const eventColumns = database.prepare('PRAGMA table_info(mobile_share_creation_events)').all();
    assert.ok(shareColumns.some((column) => column.name === 'payload_hash'));
    assert.ok(eventColumns.some((column) => column.name === 'device_hash'));
    assert.equal(database.prepare('SELECT expires_at FROM mobile_shares WHERE id = ?')
      .get(legacyId)?.expires_at, 0);
    assert.equal(database.prepare("SELECT value FROM mobile_share_meta WHERE key = 'identity_salt'")
      .get()?.value, 'a'.repeat(64));
  } finally {
    try { database.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  }
});

test('enforces the global 24-hour limit over HTTP and keeps earlier shares readable', async () => {
  const service = await startHttpService({
    now: () => FIXED_NOW,
    perDeviceDailyLimit: 100,
    perIpDailyLimit: 100,
    dailyLimit: 2,
  });
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
      code: 'DAILY_LIMIT',
      message: '服务器 24 小时内最多创建 2 份永久分享，请稍后再试。',
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
    assert.deepEqual(await readJson(health), {
      ok: true,
      active: 0,
      permanent: 0,
      createdLast24Hours: 0,
    });

    const missingShare = await fetch(`${service.baseUrl}/api/mobile-shares/AAAAAAAAAAAAAAAA`);
    assert.equal(missingShare.status, 404);
    assert.deepEqual(await readJson(missingShare), {
      code: 'SHARE_NOT_FOUND',
      message: '分享不存在。',
    });

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
