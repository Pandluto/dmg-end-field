import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadMobileCatalog, versionMobileImageUrl } from './mobileCatalog';
import {
  createDefaultMobileOperatorConfig,
  createEmptyMobileDraft,
  normalizeMobileDraft,
} from './mobileDraft';
import { buildMobileRuntimeState } from './mobileRuntime';
import {
  mobileDraftToTimelinePayload,
  timelinePayloadToMobileDraft,
} from './tacticalShareInterop';
import { validateTimelinePayload } from '../agentKernel/timelineWorktree/validator';

function readFixture(relativePath: string): unknown {
  return JSON.parse(readFileSync(new URL(`../../public/${relativePath}`, import.meta.url), 'utf8')) as unknown;
}

function readFixtureText(relativePath: string): string {
  return readFileSync(new URL(`../../public/${relativePath}`, import.meta.url), 'utf8');
}

const channel = readFixture('resources/stable.json') as {
  releaseManifest: { path: string };
};
const deployment = readFixture(channel.releaseManifest.path) as {
  delivery: { dataManifest: { path: string }; imageManifest: { path: string } };
};
const dataManifest = readFixture('web-data-manifest.json') as { version: string };
const imageManifest = readFixture('web-image-manifest.json') as { version: string };
const dataEntry = (dataManifest as unknown as {
  files: Array<{ path: string; downloadPath?: string }>;
}).files[0];
const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const requests: string[] = [];

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { location: { origin: 'https://mobile.example.test' } },
});

globalThis.fetch = async (input) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  requests.push(url);
  if (url.includes('resources/stable.json')) {
    return new Response(readFixtureText('resources/stable.json'), { status: 200 });
  }
  if (url.includes(channel.releaseManifest.path)) {
    return new Response(readFixtureText(channel.releaseManifest.path), { status: 200 });
  }
  if (url.includes(deployment.delivery.dataManifest.path)) {
    return new Response(readFixtureText(deployment.delivery.dataManifest.path), { status: 200 });
  }
  if (url.includes(deployment.delivery.imageManifest.path)) {
    return new Response(readFixtureText(deployment.delivery.imageManifest.path), { status: 200 });
  }
  if (url.includes(dataEntry.downloadPath || dataEntry.path)) {
    return new Response(readFixtureText(dataEntry.downloadPath || dataEntry.path), { status: 200 });
  }
  return new Response('not found', { status: 404 });
};

try {
  const catalog = await loadMobileCatalog();
  assert.equal(catalog.dataVersion, dataManifest.version);
  assert.equal(catalog.imageVersion, imageManifest.version);
  assert.equal(catalog.characters.length, 31);
  assert.equal(Object.keys(catalog.weapons).length, 76);
  assert.ok(catalog.buffs.length > 0);
  assert.ok(catalog.characters.some((character) => character.sandboxSkills?.length));
  assert.ok(
    catalog.characters.some((character) => character.avatarUrl?.includes(`imageVersion=${encodeURIComponent(imageManifest.version)}`)),
  );
  for (const weaponName of ['曜夜的首演', '黄金时代']) {
    const weapon = Object.values(catalog.weapons).find((candidate) => candidate.name === weaponName);
    assert.ok(weapon?.imgUrl.includes(`/assets/images/img-operator/`));
    assert.ok(weapon?.imgUrl.includes(`imageVersion=${encodeURIComponent(imageManifest.version)}`));
  }
  assert.ok(requests.some((url) => /resources\/stable\.json.*channel=/.test(url)));
  assert.ok(requests.some((url) => url.includes(channel.releaseManifest.path)));
  assert.ok(requests.some((url) => /default-local-data\.json.*sha256=/.test(url)));
  assert.ok(requests.some((url) => url.includes(deployment.delivery.imageManifest.path)));
  assert.equal(
    versionMobileImageUrl('assets/images/example.png?size=small#preview', 'v2'),
    '/assets/images/example.png?size=small&imageVersion=v2#preview',
  );

  const character = catalog.characters.find((candidate) => (
    candidate.sandboxSkills?.some((skill) => skill.customHits?.length)
  ));
  const skill = character?.sandboxSkills?.find((candidate) => candidate.customHits?.length);
  assert.ok(character && skill);
  const draft = createEmptyMobileDraft();
  draft.selectedOperatorIds = [character.id];
  draft.activeOperatorId = character.id;
  draft.operatorConfigs[character.id] = createDefaultMobileOperatorConfig(character);
  draft.slots[0].action = {
    id: 'mobile-test-action',
    operatorId: character.id,
    skillType: skill.buttonType,
    runtimeSkillId: skill.id,
    skillName: skill.displayName,
    skillIconUrl: skill.iconUrl,
    buffs: [],
    buffStackCounts: {},
    buffStackCountsByHitKey: {},
    globallyDisabledBuffIds: [],
    disabledBuffIdsByHitKey: {},
    disabledHitKeys: [],
    targetResistance: {},
    anomalyStatuses: [],
    anomalyDamages: [],
    anomalyStateSnapshots: [],
  };
  const runtime = buildMobileRuntimeState(draft, catalog);
  assert.equal(runtime.report.slotCount, 1);
  assert.ok(Number.isFinite(runtime.report.totalExpected));
  assert.ok(runtime.slotCalculations[draft.slots[0].id]?.result.hits.length > 0);
  assert.ok(runtime.availableBuffs.some((buff) => buff.ownerCharacterId === character.id));

  draft.slots[0].action.customHits = [{
    key: 'frozen-hit',
    displayName: '分享快照伤害段',
    multiplier: 0.01,
    levels: { M3: 0.02 },
    element: character.element,
    skillType: skill.buttonType,
  }];
  const frozenRuntime = buildMobileRuntimeState(normalizeMobileDraft(draft), catalog);
  assert.deepEqual(
    frozenRuntime.slotCalculations[draft.slots[0].id]?.result.hits.map((hit) => hit.hit.key),
    ['frozen-hit'],
  );
  assert.notEqual(frozenRuntime.report.totalExpected, runtime.report.totalExpected);
  delete draft.slots[0].action.customHits;

  draft.slots[0].action.anomalyDamages = [{
    id: 'mobile-test-burn',
    key: 'burn',
    label: '燃烧',
    kind: 'damage',
    category: 'magic',
    level: 1,
    includeDotInTotal: true,
    burnDamageMode: 'dotOnly',
    durationSeconds: 10,
    primaryText: '燃烧 Lv1',
    secondaryText: '160% 初始 Hit',
    tertiaryText: '仅持续总伤 · 10s',
    selectedBuffIds: [],
  }];
  const runtimeWithBurn = buildMobileRuntimeState(draft, catalog);
  const burnCalculation = runtimeWithBurn.slotCalculations[draft.slots[0].id];
  assert.ok(burnCalculation?.specialSegments?.some((segment) => segment.compactTitle.includes('燃烧')));
  assert.ok(runtimeWithBurn.report.totalExpected > runtime.report.totalExpected);

  const sharedBuff = runtime.availableBuffs[0];
  assert.ok(sharedBuff && draft.slots[0].action);
  draft.slots[0].action.buffs = [sharedBuff];
  draft.slots[0].action.buffStackCounts = { [sharedBuff.id]: 2 };
  const desktopPayload = mobileDraftToTimelinePayload(draft, catalog);
  const persistedButton = desktopPayload.skillButtonTable['mobile-test-action'];
  const timelineButton = desktopPayload.timelineData.staffLines[0]?.buttons[0];
  assert.deepEqual(persistedButton.selectedBuff, [sharedBuff.id]);
  assert.deepEqual(persistedButton.panelConfig?.selectedBuff, [sharedBuff.id]);
  assert.deepEqual(timelineButton?.buffIds, [sharedBuff.id]);
  assert.deepEqual(validateTimelinePayload(desktopPayload), { ok: true, issues: [] });

  const restoredMobileDraft = timelinePayloadToMobileDraft(desktopPayload, catalog);
  assert.deepEqual(restoredMobileDraft.slots[0]?.action?.buffs.map((buff) => buff.id), [sharedBuff.id]);
  assert.equal(restoredMobileDraft.slots[0]?.action?.buffStackCounts[sharedBuff.id], 2);
} finally {
  globalThis.fetch = originalFetch;
  if (originalWindow) {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  } else {
    Reflect.deleteProperty(globalThis, 'window');
  }
}
