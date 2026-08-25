import {
  expect,
  test,
  type Browser,
  type Page,
} from '@playwright/test';
import {
  readBooleanEnvironment,
  readCountEnvironment,
  readTextEnvironment,
} from './regressionEnvironment';
import {
  SYNTHETIC_ALL_BUFF_LIST,
  SYNTHETIC_ANOMALY_REPORT_GOLDEN,
  SYNTHETIC_ANOMALY_BUFFS,
  SYNTHETIC_ANOMALY_BUTTON_IDS,
  SYNTHETIC_ANOMALY_DAMAGE_CARDS,
  SYNTHETIC_ANOMALY_EXTRA_HIT_BUFF,
  SYNTHETIC_ANOMALY_MODIFIER_BUFFS,
  SYNTHETIC_ANOMALY_STATE_SNAPSHOTS,
  SYNTHETIC_ANOMALY_STATUS_CARDS,
  SYNTHETIC_ANOMALY_TARGET_RESISTANCE,
  SYNTHETIC_ANOMALY_TEMPLATE,
  SYNTHETIC_BURN_DOT_CARD,
  SYNTHETIC_BURN_SPLIT_CARD,
  SYNTHETIC_BUFF_TYPE_MATRIX_BUFFS,
  SYNTHETIC_BUFF_TYPE_MATRIX_BUTTON_ID,
  SYNTHETIC_BUFF_TYPE_MATRIX_REPORT_GOLDEN,
  SYNTHETIC_BUFF_TYPE_MATRIX_TEMPLATE,
  SYNTHETIC_BUFF_TYPE_MATRIX_TYPES,
  SYNTHETIC_CONFIG_SNAPSHOT,
  SYNTHETIC_DAMAGE_GOLDEN,
  SYNTHETIC_FULL_MULTIPLIER_TEMPLATE,
  SYNTHETIC_LOCAL_DATA_ARCHIVE,
  SYNTHETIC_TARGET_SKILL_EXPECTATIONS,
  SYNTHETIC_TIMELINE_PAYLOAD,
} from '../../src/core/calculators/skillDamageFullMultiplierData.fixture';
import {
  observeSyntheticArchiveAfterSqliteReload,
  type SyntheticDamageReportObservation,
} from './syntheticRegressionArchiveHarness';

const LTS_BASE_URL = process.env.LTS_DUAL_BASE_URL || 'http://127.0.0.1:3030';
const SLIM_BASE_URL = process.env.SLIM_DUAL_BASE_URL || 'http://127.0.0.1:3040';
const BASELINE_LABEL = process.env.LTS_DUAL_BASELINE_LABEL || 'v1.8-LTS';
const CANDIDATE_LABEL = process.env.LTS_DUAL_CANDIDATE_LABEL || 'v1.8-slim';
const ACCESS_PASSWORD = readTextEnvironment('E2E_ACCESS_PASSWORD', 'zmd');
const EXPECTED_OPERATOR_COUNT = readCountEnvironment('E2E_EXPECTED_OPERATOR_COUNT', 30);
const EXPECTED_WEAPON_COUNT = readCountEnvironment('E2E_EXPECTED_WEAPON_COUNT', 75);
const EXPECTED_IMAGE_COUNT = readCountEnvironment('E2E_EXPECTED_IMAGE_COUNT', 559);
const EXPECTED_VERSION_LABEL = readTextEnvironment('E2E_EXPECTED_VERSION_LABEL', 'Web LTS 1.8');
const THEME_STORAGE_KEY = 'dmg.appearance.theme.v1';

const EDITOR_THEMES = [
  'office-excel',
  'apple-midnight',
  'apple-warm',
  'lieflat-mono',
  'liquid-tide',
] as const;

const EDITOR_THEME_ROUTES = [
  {
    path: '/data/buffs',
    heading: 'Sheet-Buff',
    rootSelector: '.buff-sheet-page',
    surfaceSelector: '.damage-sheet-topbar',
    structure: {
      '.damage-sheet-topbar': 1,
      '.damage-sheet-ribbon': 1,
      '.damage-sheet-formula-bar': 1,
      '.damage-sheet-workspace': 1,
      '.buff-sheet-explorer': 1,
      '.damage-sheet-excel-shell': 1,
      '.buff-sheet-tool-button': 6,
    },
  },
  {
    path: '/data/weapons',
    heading: 'Sheet-Weapon',
    rootSelector: '.weapon-sheet-page',
    surfaceSelector: '.damage-sheet-topbar',
    structure: {
      '.damage-sheet-topbar': 1,
      '.damage-sheet-ribbon': 1,
      '.damage-sheet-formula-bar': 1,
      '.damage-sheet-workspace': 1,
      '.buff-sheet-explorer': 1,
      '.damage-sheet-excel-shell': 1,
      '.buff-sheet-tool-button': 6,
    },
  },
  {
    path: '/data/equipments',
    heading: 'Sheet-Equipment',
    rootSelector: '.equipment-sheet-page',
    surfaceSelector: '.damage-sheet-topbar',
    structure: {
      '.damage-sheet-topbar': 1,
      '.damage-sheet-ribbon': 1,
      '.damage-sheet-formula-bar': 1,
      '.damage-sheet-workspace': 1,
      '.buff-sheet-explorer': 1,
      '.damage-sheet-excel-shell': 1,
      '.buff-sheet-tool-button': 6,
    },
  },
  {
    path: '/data/operators',
    heading: '基础数据',
    rootSelector: '.operator-draft-page',
    surfaceSelector: '.operator-draft-column-left > section',
    structure: {
      '.operator-draft-workbench': 1,
      '.operator-draft-column': 4,
      '.operator-draft-basic-grid': 1,
      '.operator-draft-skill-list': 1,
      '.operator-draft-buff-panel': 1,
    },
  },
] as const;

const COMMON_ROUTES = [
  ['/data/operators', '基础数据'],
  ['/data/buffs', 'Sheet-Buff'],
  ['/data/weapons', 'Sheet-Weapon'],
  ['/data/equipments', 'Sheet-Equipment'],
  ['/data/images', '图片资源管理'],
  ['/timeline', '选择干员'],
  ['/timeline/report/presentation', '队伍配置'],
] as const;

interface DualRunTarget {
  name: string;
  baseUrl: string;
  publicEntry: boolean;
  legacyDamageSheet: boolean;
  legacyThreePieceTypeEditor: boolean;
}

interface CommonObservation {
  install: {
    operators: number;
    weapons: number;
    images: number;
    version: string;
  };
  routeHeadings: string[];
  buff: {
    persisted: boolean;
    shareType: string;
  };
  weapon: {
    persisted: boolean;
    shareType: string;
  };
  equipment: {
    persisted: boolean;
    shareType: string;
    selectSignatures: string[];
  };
  operator: {
    persisted: boolean;
    shareType: string;
    skillName: string;
    skillType: string;
    hitName: string;
    hitM3: number | null;
    hitElement: string;
    hitSkillType: string;
    buffType: string;
    buffValue: number | null;
    buffMaxStacks: number | null;
  };
  themes: Array<{
    theme: string;
    tokens: string[];
    routes: Array<{
      heading: string;
      rootClasses: string;
      structure: Record<string, number>;
      rootStyle: string[];
      surfaceStyle: string[];
      liquidSurface: string;
    }>;
  }>;
  liveThemes: Array<{
    theme: string;
    tokenSignature: string;
    stored: string | null;
  }>;
  timeline: {
    selectedCharacters: number;
    skillButtons: number;
    skillType: string | null;
    outlinePaths: number;
    detailVisible: boolean;
    summary: string;
    calculation: string;
    reportMeta: string;
    operatorConfigVisible: boolean;
    operatorEquipmentNames: string[];
    operatorEquipmentLevel: string | null;
    operatorSetBuffLines: string[];
    buffBatchSelected: string;
    buffBatchSecondaryPaths: boolean;
    commandSuccess: {
      status: string;
      selectedCharacterCount: number | null;
      skillButtonCount: number | null;
    };
    commandError: {
      status: string;
      error: string;
    };
    physicalResistance: string;
    persistedAfterReload: boolean;
  };
  syntheticArchive: SyntheticDamageReportObservation;
}

function expectClose(actual: number, expected: number, label: string): void {
  expect(actual, label).toBeCloseTo(expected, 7);
}

function expectSyntheticArchiveObservation(
  observation: SyntheticDamageReportObservation,
  label: string,
): void {
  expect(observation.package, `${label}: package contents`).toEqual({
    packageId: SYNTHETIC_LOCAL_DATA_ARCHIVE.id,
    operators: 1,
    weapons: 1,
    equipmentSets: 1,
    equipments: 4,
    buffGroups: 1,
    buffItems: 4,
    importedTimelineArchives: 1,
  });
  expect(observation.sqlite.characterCount, `${label}: SQLite character count`).toBe(1);
  expect(observation.sqlite.buttonCount, `${label}: SQLite button count`).toBe(10);
  expect(observation.sqlite.buffCount, `${label}: SQLite Buff count`).toBe(SYNTHETIC_ALL_BUFF_LIST.length);

  expect(observation.fixture.operatorName, `${label}: synthetic operator`).toBe('测试满乘区干员');
  expect(observation.fixture.weaponName, `${label}: synthetic weapon`).toBe('测试满乘区武器');
  expect(observation.fixture.equipmentNames, `${label}: synthetic equipment`).toEqual([
    '测试配件一',
    '测试配件二',
    '测试护甲',
    '测试护手',
  ]);
  expect(observation.fixture.threePieceBuffNames, `${label}: synthetic three-piece set`).toEqual([
    '测试套装攻击',
    '测试套装全伤',
    '测试套装技艺',
    '测试套装自然条件',
  ]);

  const definitions = observation.fixture.buffDefinitions;
  expect(definitions.some((buff) => buff.category === 'passive'), `${label}: passive/default-active Buff`).toBe(true);
  expect(definitions.some((buff) => buff.category === 'condition'), `${label}: conditional Buff`).toBe(true);
  expect(
    definitions.some((buff) => buff.category === 'countable' && buff.maxStacks === 3),
    `${label}: countable Buff`,
  ).toBe(true);
  expect(
    definitions.some((buff) => buff.valueMode === 'derived' && buff.derivedSource === 'atk'),
    `${label}: value-derived Buff`,
  ).toBe(true);
  expect(
    definitions.some((buff) => (buff.multiplierCoefficient ?? 0) > 1),
    `${label}: direct multiplier Buff`,
  ).toBe(true);
  const typeMatrixDefinitions = definitions.filter((buff) => buff.id.startsWith('type-matrix-'));
  expect(typeMatrixDefinitions, `${label}: all public Buff definitions after SQLite conversion`).toHaveLength(
    SYNTHETIC_BUFF_TYPE_MATRIX_TYPES.length,
  );
  expect(typeMatrixDefinitions.map((buff) => buff.id), `${label}: Buff type matrix ids`).toEqual(
    SYNTHETIC_BUFF_TYPE_MATRIX_BUFFS.map((buff) => buff.id),
  );
  SYNTHETIC_BUFF_TYPE_MATRIX_BUFFS.forEach((sourceBuff) => {
    const restored = typeMatrixDefinitions.find((buff) => buff.id === sourceBuff.id);
    expect(restored, `${label}: restored type definition ${sourceBuff.type}`).toBeDefined();
    if (!restored) return;
    if (sourceBuff.type === 'multiplierMultiplier') {
      expect(restored, `${label}: legacy multiplier migration`).toMatchObject({
        type: 'multiplierBonus',
        value: null,
        multiplierCoefficient: 1.03,
      });
    } else {
      expect(restored.type, `${label}: restored type ${sourceBuff.type}`).toBe(sourceBuff.type);
      expectClose(restored.value ?? 0, sourceBuff.value ?? 0, `${label}: restored value ${sourceBuff.type}`);
    }
  });

  expect(observation.report.buttonCount, `${label}: damage report button count`).toBe(10);
  const reportButtons = new Map(observation.report.buttons.map((button) => [button.id, button]));
  for (const skillType of ['A', 'B', 'E', 'Q', 'Dot'] as const) {
    const expectedTarget = SYNTHETIC_TARGET_SKILL_EXPECTATIONS[skillType];
    const button = reportButtons.get(expectedTarget.buttonId);
    expect(button, `${label}: ${skillType} target button`).toBeDefined();
    if (!button) continue;

    expect(button.skillType, `${label}: ${skillType} button type`).toBe(skillType);
    const golden = SYNTHETIC_DAMAGE_GOLDEN.targetCaseFinals[skillType];
    const goldenHits = golden.expected;
    expect(button.hits, `${label}: ${skillType} hit count`).toHaveLength(goldenHits.length);
    button.hits.forEach((hit, index) => {
      expectClose(hit.expected, goldenHits[index], `${label}: ${skillType}[${index}] golden damage`);
      expectClose(hit.nonCrit, golden.nonCrit[index], `${label}: ${skillType}[${index}] golden non-crit`);
    });
    const appliedBuffIds = new Set(button.hits.flatMap((hit) => hit.buffs.map((buff) => buff.id)));
    expectedTarget.matchedBuffIds.forEach((buffId) => {
      expect(appliedBuffIds.has(buffId), `${label}: ${skillType} should apply ${buffId}`).toBe(true);
    });
    expectedTarget.unmatchedBuffIds.forEach((buffId) => {
      expect(appliedBuffIds.has(buffId), `${label}: ${skillType} should reject ${buffId}`).toBe(false);
    });
  }

  const fullButtonId = `synthetic-button-${SYNTHETIC_FULL_MULTIPLIER_TEMPLATE.runtimeSkillId}`;
  const fullButton = reportButtons.get(fullButtonId);
  expect(fullButton, `${label}: comprehensive multiplier button`).toBeDefined();
  if (!fullButton) return;
  expect(fullButton.skillName, `${label}: comprehensive skill identity`).toBe(
    SYNTHETIC_FULL_MULTIPLIER_TEMPLATE.displayName,
  );
  fullButton.hits.forEach((hit, index) => {
    expectClose(hit.expected, SYNTHETIC_DAMAGE_GOLDEN.full.expected[index], `${label}: full[${index}] expected`);
    expectClose(hit.nonCrit, SYNTHETIC_DAMAGE_GOLDEN.full.nonCrit[index], `${label}: full[${index}] non-crit`);
    expect(hit.resistance.corrosion, `${label}: full[${index}] corrosion`).toBeGreaterThan(0);
    expect(hit.resistance.resistanceIgnore, `${label}: full[${index}] resistance ignore`).toBeGreaterThan(0);
    expect(hit.resistance.resistanceZone, `${label}: full[${index}] resistance zone`).not.toBe(1);
    expect(hit.zones.map((zone) => zone.key), `${label}: full[${index}] exposed zones`).toEqual([
      'skillMultiplier',
      'damageBonus',
      'amplify',
      'fragile',
      'vulnerability',
    ]);
    hit.zones.forEach((zone) => {
      expect(zone.additiveTotal, `${label}: full[${index}] ${zone.key} additive`).toBeGreaterThan(0);
      expect(zone.multiplierProduct, `${label}: full[${index}] ${zone.key} multiplier`).toBeGreaterThan(1);
      expect(zone.finalValue, `${label}: full[${index}] ${zone.key} final`).not.toBe(1);
    });

    const buffById = new Map(hit.buffs.map((buff) => [buff.id, buff]));
    expect(
      buffById.get('skill-multiplier-multiplier'),
      `${label}: full[${index}] direct multiplier contribution`,
    ).toMatchObject({
      effectiveValue: 1.18,
      multiplierCoefficient: 1.18,
      multiplier: true,
    });
  });

  expect(observation.restored.snapshotCount, `${label}: restored anomaly snapshot count`).toBe(3);
  expect(observation.restored.snapshots.map((snapshot) => snapshot.key), `${label}: restored anomaly snapshot keys`).toEqual([
    'conductive',
    'corrosion',
    'armor-break',
  ]);
  SYNTHETIC_ANOMALY_STATE_SNAPSHOTS.forEach((expectedSnapshot) => {
    const actualSnapshot = observation.restored.snapshots.find((snapshot) => snapshot.id === expectedSnapshot.id);
    expect(actualSnapshot, `${label}: restored ${expectedSnapshot.key} snapshot`).toBeDefined();
    if (!actualSnapshot) return;
    expect(actualSnapshot.level, `${label}: ${expectedSnapshot.key} snapshot level`).toBe(expectedSnapshot.level);
    expect(actualSnapshot.sourceSkillStrengthSnapshot, `${label}: ${expectedSnapshot.key} source skill snapshot`).toBe(60);
    expectClose(actualSnapshot.effectValue, expectedSnapshot.effectValue, `${label}: ${expectedSnapshot.key} effect value`);
    if (expectedSnapshot.currentCorrosion !== undefined) {
      expectClose(actualSnapshot.initialCorrosion ?? 0, expectedSnapshot.initialCorrosion ?? 0, `${label}: corrosion initial`);
      expectClose(actualSnapshot.tickCorrosionPerSecond ?? 0, expectedSnapshot.tickCorrosionPerSecond ?? 0, `${label}: corrosion tick`);
      expectClose(actualSnapshot.maxCorrosion ?? 0, expectedSnapshot.maxCorrosion ?? 0, `${label}: corrosion cap`);
      expectClose(actualSnapshot.currentCorrosion ?? 0, expectedSnapshot.currentCorrosion, `${label}: corrosion current`);
    }
  });

  expect(observation.restored.anomalyButtons, `${label}: restored anomaly button count`).toHaveLength(3);
  const restoredButtonById = new Map(observation.restored.anomalyButtons.map((button) => [button.id, button]));
  const restoredMatrix = restoredButtonById.get(SYNTHETIC_ANOMALY_BUTTON_IDS.matrix);
  expect(restoredMatrix, `${label}: restored anomaly matrix button`).toBeDefined();
  if (restoredMatrix) {
    expect(restoredMatrix.runtimeSkillId, `${label}: anomaly trusted skill`).toBe(SYNTHETIC_ANOMALY_TEMPLATE.runtimeSkillId);
    expect(restoredMatrix.selectedBuffIds, `${label}: anomaly selected Buffs`).toEqual(SYNTHETIC_ANOMALY_BUFFS.map((buff) => buff.id));
    expect(restoredMatrix.buffStackCounts[SYNTHETIC_ANOMALY_EXTRA_HIT_BUFF.id], `${label}: anomaly extra-hit stacks`).toBe(2);
    expect(restoredMatrix.disabledHitKeys, `${label}: disabled carrier hit`).toEqual(['anomaly-carrier-hit']);
    expect(restoredMatrix.statusCards, `${label}: restored status cards`).toEqual(
      SYNTHETIC_ANOMALY_STATUS_CARDS.map((card) => ({ id: card.id, key: card.key, level: card.level })),
    );
    expect(restoredMatrix.damageCards.map(({ id, key, level }) => ({ id, key, level })), `${label}: restored damage cards`).toEqual(
      SYNTHETIC_ANOMALY_DAMAGE_CARDS.map((card) => ({ id: card.id, key: card.key, level: card.level })),
    );
    expect(restoredMatrix.stateSnapshotIds, `${label}: restored state snapshot references`).toEqual(
      SYNTHETIC_ANOMALY_STATE_SNAPSHOTS.map((snapshot) => snapshot.id),
    );
    expect(restoredMatrix.targetResistance, `${label}: restored five-element resistance`).toEqual(SYNTHETIC_ANOMALY_TARGET_RESISTANCE);
  }

  const restoredBurnDot = restoredButtonById.get(SYNTHETIC_ANOMALY_BUTTON_IDS.burnDot);
  expect(restoredBurnDot?.damageCards, `${label}: restored burn dot card`).toEqual([{
    id: SYNTHETIC_BURN_DOT_CARD.id,
    key: 'burn',
    level: 2,
    burnDamageMode: 'dotOnly',
    durationSeconds: 4,
  }]);
  const restoredBurnSplit = restoredButtonById.get(SYNTHETIC_ANOMALY_BUTTON_IDS.burnSplit);
  expect(restoredBurnSplit?.damageCards, `${label}: restored split burn card`).toEqual([{
    id: SYNTHETIC_BURN_SPLIT_CARD.id,
    key: 'burn',
    level: 2,
    burnDamageMode: 'splitDot',
    durationSeconds: 3,
  }]);

  Object.entries(SYNTHETIC_ANOMALY_REPORT_GOLDEN).forEach(([buttonId, goldenButton]) => {
    const actualButton = reportButtons.get(buttonId);
    expect(actualButton, `${label}: anomaly report button ${buttonId}`).toBeDefined();
    if (!actualButton) return;
    expectClose(actualButton.expected, goldenButton.expected, `${label}: ${buttonId} expected`);
    expectClose(actualButton.nonCrit, goldenButton.nonCrit, `${label}: ${buttonId} non-crit`);
    expect(actualButton.hits, `${label}: ${buttonId} hit count`).toHaveLength(goldenButton.hits.length);
    goldenButton.hits.forEach((goldenHit, index) => {
      const actualHit = actualButton.hits[index];
      expect(actualHit.id, `${label}: ${buttonId}[${index}] id`).toBe(goldenHit.id);
      expect(actualHit.sourceKind, `${label}: ${buttonId}[${index}] source kind`).toBe(goldenHit.sourceKind);
      expect(actualHit.elementLabel, `${label}: ${buttonId}[${index}] element`).toBe(goldenHit.elementLabel);
      expectClose(actualHit.expected, goldenHit.expected, `${label}: ${buttonId}[${index}] expected`);
      expectClose(actualHit.nonCrit, goldenHit.nonCrit, `${label}: ${buttonId}[${index}] non-crit`);
      expectClose(actualHit.resistance.baseResistance, goldenHit.baseResistance, `${label}: ${buttonId}[${index}] base resistance`);
      expectClose(actualHit.resistance.corrosion, goldenHit.corrosion, `${label}: ${buttonId}[${index}] corrosion`);
      expectClose(actualHit.resistance.resistanceIgnore, goldenHit.resistanceIgnore, `${label}: ${buttonId}[${index}] resistance ignore`);
      expectClose(actualHit.resistance.resistanceZone, goldenHit.resistanceZone, `${label}: ${buttonId}[${index}] resistance zone`);
    });
  });

  const anomalyMatrixReport = reportButtons.get(SYNTHETIC_ANOMALY_BUTTON_IDS.matrix);
  const matrixRuntimeHits = anomalyMatrixReport?.hits.filter((hit) => hit.sourceKind !== 'normal') ?? [];
  expect(matrixRuntimeHits.filter((hit) => hit.sourceKind === 'anomaly'), `${label}: ten anomaly damage rows`).toHaveLength(10);
  expect(matrixRuntimeHits.filter((hit) => hit.sourceKind === 'extraHit'), `${label}: countable extra-hit rows`).toHaveLength(2);
  matrixRuntimeHits.forEach((hit) => {
    const appliedIds = new Set(hit.buffs.map((buff) => buff.id));
    expect(appliedIds.has('anomaly-source-skill'), `${label}: ${hit.id} source-skill Buff`).toBe(true);
    expect(appliedIds.has('anomaly-state-snapshot-2'), `${label}: ${hit.id} corrosion snapshot Buff`).toBe(true);
  });

  const typeMatrixObservation = reportButtons.get(SYNTHETIC_BUFF_TYPE_MATRIX_BUTTON_ID);
  expect(typeMatrixObservation, `${label}: Buff type matrix report button`).toBeDefined();
  if (typeMatrixObservation) {
    expect(typeMatrixObservation.skillName, `${label}: Buff type matrix skill`).toBe(SYNTHETIC_BUFF_TYPE_MATRIX_TEMPLATE.displayName);
    expectClose(typeMatrixObservation.expected, SYNTHETIC_BUFF_TYPE_MATRIX_REPORT_GOLDEN.expected, `${label}: Buff type matrix expected`);
    expectClose(typeMatrixObservation.nonCrit, SYNTHETIC_BUFF_TYPE_MATRIX_REPORT_GOLDEN.nonCrit, `${label}: Buff type matrix non-crit`);
    expect(typeMatrixObservation.hits, `${label}: Buff type matrix hit count`).toHaveLength(5);
    typeMatrixObservation.hits.forEach((hit, index) => {
      const golden = SYNTHETIC_BUFF_TYPE_MATRIX_REPORT_GOLDEN.hits[index];
      expect(hit.id, `${label}: type matrix[${index}] id`).toBe(golden.id);
      expect(hit.elementLabel, `${label}: type matrix[${index}] element`).toBe(golden.elementLabel);
      expect(hit.skillTypeLabel, `${label}: type matrix[${index}] skill type`).toBe(golden.skillTypeLabel);
      expectClose(hit.expected, golden.expected, `${label}: type matrix[${index}] expected`);
      expectClose(hit.nonCrit, golden.nonCrit, `${label}: type matrix[${index}] non-crit`);
      expectClose(hit.resistance.baseResistance, golden.resistance.baseResistance, `${label}: type matrix[${index}] base resistance`);
      expectClose(hit.resistance.corrosion, golden.resistance.corrosion, `${label}: type matrix[${index}] corrosion`);
      expectClose(hit.resistance.resistanceIgnore, golden.resistance.resistanceIgnore, `${label}: type matrix[${index}] resistance ignore`);
      expectClose(hit.resistance.resistanceZone, golden.resistance.resistanceZone, `${label}: type matrix[${index}] resistance zone`);
      const zoneByKey = new Map(hit.zones.map((zone) => [zone.key, zone]));
      Object.entries(golden.zones).forEach(([zoneKey, goldenZone]) => {
        const actualZone = zoneByKey.get(zoneKey);
        expect(actualZone, `${label}: type matrix[${index}] ${zoneKey} zone`).toBeDefined();
        if (!actualZone) return;
        expectClose(actualZone.additiveTotal, goldenZone.additiveTotal, `${label}: type matrix[${index}] ${zoneKey} additive`);
        expectClose(actualZone.multiplierProduct, goldenZone.multiplierProduct, `${label}: type matrix[${index}] ${zoneKey} product`);
        expectClose(actualZone.finalValue, goldenZone.finalValue, `${label}: type matrix[${index}] ${zoneKey} final`);
      });
      expect(hit.buffs.map((buff) => buff.id), `${label}: type matrix[${index}] all 75 Buff ids`).toEqual(
        SYNTHETIC_BUFF_TYPE_MATRIX_BUFFS.map((buff) => buff.id),
      );
      expect(
        hit.buffs.find((buff) => buff.id === 'type-matrix-multiplierMultiplier'),
        `${label}: type matrix[${index}] migrated legacy multiplier contribution`,
      ).toMatchObject({
        type: 'multiplierBonus',
        multiplierCoefficient: 1.03,
        multiplier: true,
      });
    });
  }

  const expectedTotal = Object.values(SYNTHETIC_DAMAGE_GOLDEN.targetCaseFinals)
    .flatMap((golden) => [...golden.expected])
    .concat([...SYNTHETIC_DAMAGE_GOLDEN.full.expected])
    .concat(Object.values(SYNTHETIC_ANOMALY_REPORT_GOLDEN).map((golden) => golden.expected))
    .concat(SYNTHETIC_BUFF_TYPE_MATRIX_REPORT_GOLDEN.expected)
    .reduce((sum, value) => sum + value, 0);
  expectClose(observation.report.totalExpected, expectedTotal, `${label}: report total expected`);
}

async function observeEditorThemes(
  page: Page,
  baseUrl: string,
): Promise<CommonObservation['themes']> {
  const observations: CommonObservation['themes'] = [];

  for (const theme of EDITOR_THEMES) {
    await page.goto(`${baseUrl}/#/data/buffs`);
    await page.evaluate(({ key, value }) => {
      window.localStorage.setItem(key, value);
    }, { key: THEME_STORAGE_KEY, value: theme });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.locator('html')).not.toHaveAttribute('data-theme-pending', theme);

    const tokens = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return [
        style.getPropertyValue('--theme-bg-window').trim(),
        style.getPropertyValue('--theme-text-title').trim(),
        style.getPropertyValue('--theme-accent-main').trim(),
        style.getPropertyValue('--theme-radius-control').trim(),
      ];
    });
    expect(tokens.every(Boolean), `${theme}: required theme tokens`).toBe(true);

    const routes: CommonObservation['themes'][number]['routes'] = [];
    for (const route of EDITOR_THEME_ROUTES) {
      await openRoute(page, baseUrl, route.path, route.heading);
      const root = page.locator(route.rootSelector);
      const surface = page.locator(route.surfaceSelector).first();
      await expect(root).toBeVisible();
      await expect(surface).toBeVisible();

      const structure: Record<string, number> = {};
      for (const [selector, expectedCount] of Object.entries(route.structure)) {
        const count = await page.locator(selector).count();
        expect(count, `${theme} ${route.heading}: ${selector}`).toBe(expectedCount);
        structure[selector] = count;
      }

      const rootClasses = normalizeText(await root.getAttribute('class'));
      const [rootStyle, surfaceStyle] = await Promise.all([
        root.evaluate((element) => {
          const style = getComputedStyle(element);
          return [style.display, style.color, style.backgroundColor, style.borderRadius];
        }),
        surface.evaluate((element) => {
          const style = getComputedStyle(element);
          return [style.display, style.color, style.backgroundColor, style.borderColor, style.borderRadius];
        }),
      ]);
      let liquidSurface = '';
      if (theme === 'liquid-tide') {
        const liquidTarget = route.heading === '基础数据'
          ? page.locator('.operator-draft-command-actions > button').first()
          : page.locator('.buff-sheet-ribbon-actions > button').first();
        await expect(liquidTarget).toHaveAttribute('data-liquid-glass-surface', 'true');
        await expect(liquidTarget).toHaveAttribute('data-liquid-glass-preset', /^(control|card|dock|popover)$/);
        liquidSurface = [
          await liquidTarget.getAttribute('data-liquid-glass-surface'),
          await liquidTarget.getAttribute('data-liquid-glass-preset'),
        ].join(':');
      }

      if (theme === 'apple-midnight' || theme === 'lieflat-mono' || theme === 'liquid-tide') {
        if (route.heading === '基础数据') {
          const name = page.locator('.operator-draft-basic-grid').getByLabel('名称', { exact: true });
          await name.focus();
          await expect(name).toBeFocused();
        } else if (route.heading === 'Sheet-Equipment') {
          const firstRow = page.locator('[data-equipment-row-key]').first();
          await firstRow.click();
          await expect(firstRow).toHaveClass(/is-active/);
        } else {
          const firstCell = page.locator('.damage-sheet-excel-row:not(.is-header) .damage-sheet-excel-cell').first();
          await firstCell.click();
          await expect(page.locator('.damage-sheet-formula-address')).not.toHaveText('-');
        }
      }
      routes.push({
        heading: route.heading,
        rootClasses,
        structure,
        rootStyle,
        surfaceStyle,
        liquidSurface,
      });
    }
    observations.push({ theme, tokens, routes });
  }

  await page.evaluate(({ key }) => {
    window.localStorage.setItem(key, 'office-excel');
  }, { key: THEME_STORAGE_KEY });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'office-excel');
  return observations;
}

async function observeLiveThemeSwitch(
  page: Page,
  baseUrl: string,
): Promise<CommonObservation['liveThemes']> {
  await page.goto(`${baseUrl}/#/settings`);
  await expect(page.getByRole('heading', { name: '界面主题', exact: true })).toBeVisible();
  await page.evaluate(() => {
    document.body.dataset.dualThemeMarker = 'mounted';
  });

  const observations: CommonObservation['liveThemes'] = [];
  for (const theme of [
    'apple-midnight',
    'apple-warm',
    'lieflat-mono',
    'liquid-tide',
    'office-excel',
  ] as const) {
    const option = page.locator(`.theme-option.is-${theme}`);
    await option.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(option).toHaveAttribute('aria-checked', 'true');
    expect(await page.evaluate(() => document.body.dataset.dualThemeMarker)).toBe('mounted');
    const tokenSignature = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return [
        style.getPropertyValue('--theme-bg-window').trim(),
        style.getPropertyValue('--theme-text-title').trim(),
        style.getPropertyValue('--theme-accent-main').trim(),
        style.getPropertyValue('--theme-radius-control').trim(),
      ].join('|');
    });
    expect(tokenSignature.split('|').every(Boolean)).toBe(true);
    observations.push({
      theme,
      tokenSignature,
      stored: await page.evaluate((key) => window.localStorage.getItem(key), THEME_STORAGE_KEY),
    });
  }
  expect(new Set(observations.map((entry) => entry.tokenSignature)).size).toBe(EDITOR_THEMES.length);
  return observations;
}

type DualWorkbenchCommandResult = {
  status: string;
  result?: Record<string, unknown>;
  error?: string;
};

async function enqueueWorkbenchCommand(
  page: Page,
  command: Record<string, unknown>,
  id: string,
): Promise<void> {
  await page.evaluate(async ({ command: nextCommand, id: commandId }) => {
    const moduleUrl = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((name) => /\/src\/utils\/mainWorkbenchControl\.ts(?:\?|$)/.test(name));
    if (!moduleUrl) throw new Error('The active Main Workbench control module URL is unavailable.');
    const control = await import(/* @vite-ignore */ moduleUrl);
    control.enqueueMainWorkbenchCommand(nextCommand, 'dual-e2e', commandId);
  }, { command, id });
}

async function readWorkbenchCommand(page: Page, id: string): Promise<DualWorkbenchCommandResult | null> {
  return page.evaluate(async (commandId) => {
    const moduleUrl = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((name) => /\/src\/utils\/mainWorkbenchControl\.ts(?:\?|$)/.test(name));
    if (!moduleUrl) throw new Error('The active Main Workbench control module URL is unavailable.');
    const control = await import(/* @vite-ignore */ moduleUrl);
    const entry = control.readMainWorkbenchCommandQueue().find((item: { id: string }) => item.id === commandId);
    return entry
      ? { status: entry.status, result: entry.result, error: entry.error }
      : null;
  }, id);
}

interface CapabilityObservation {
  damageSheetRoute: boolean;
  xlsxExport: boolean;
  equipmentThreePieceTypeEditor: boolean;
  tableButton: boolean;
  damageSheetNavigation: boolean;
  fakeCalculationSidebar: boolean;
}

interface TargetObservation {
  common: CommonObservation;
  capabilities: CapabilityObservation;
  browserErrors: string[];
}

function expectedCapabilities(target: DualRunTarget): CapabilityObservation {
  return {
    damageSheetRoute: target.legacyDamageSheet,
    xlsxExport: target.legacyDamageSheet,
    equipmentThreePieceTypeEditor: target.legacyThreePieceTypeEditor,
    tableButton: target.legacyDamageSheet,
    damageSheetNavigation: target.legacyDamageSheet,
    fakeCalculationSidebar: target.legacyDamageSheet,
  };
}

function normalizeText(value: string | null): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

async function openRoute(page: Page, baseUrl: string, path: string, heading: string) {
  await page.goto(`${baseUrl}/#${path}`);
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  await expect(page.locator('.app-route-loading')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
}

async function bootstrap(page: Page, target: DualRunTarget): Promise<CommonObservation['install']> {
  await page.goto(target.baseUrl);
  const password = page.getByRole('textbox', { name: '访问密码', exact: true });
  if (target.publicEntry) {
    await expect(password).toHaveCount(0);
  } else {
    await expect(page.getByRole('heading', { name: '终末地伤害工作台', exact: true })).toBeVisible();
    await password.fill(`${ACCESS_PASSWORD}-wrong`);
    await page.getByRole('button', { name: '进入工作台', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('访问密码不正确。');
    await password.fill(ACCESS_PASSWORD);
    await page.getByRole('button', { name: '进入工作台', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: '先把基础资料装进浏览器', exact: true })).toBeVisible();
  await expect(page.getByText(`${EXPECTED_OPERATOR_COUNT} 位本地干员`, { exact: true })).toBeVisible();
  await expect(page.getByText(`${EXPECTED_WEAPON_COUNT} 件本地武器`, { exact: true })).toBeVisible();
  await expect(page.getByText(`${EXPECTED_IMAGE_COUNT} 个图片资源`, { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '下载完整资料并开始', exact: true }).click();
  await expect(page.getByRole('heading', { name: '建立第一份排轴', exact: true })).toBeVisible({
    timeout: 120_000,
  });
  const version = normalizeText(await page.getByText(EXPECTED_VERSION_LABEL, { exact: true }).textContent());

  return {
    operators: EXPECTED_OPERATOR_COUNT,
    weapons: EXPECTED_WEAPON_COUNT,
    images: EXPECTED_IMAGE_COUNT,
    version,
  };
}

async function observeBuff(page: Page, baseUrl: string): Promise<CommonObservation['buff']> {
  const nameValue = 'Dual Run Buff';
  await openRoute(page, baseUrl, '/data/buffs', 'Sheet-Buff');
  await page.getByRole('button', { name: '新建', exact: true }).click();
  const name = page.getByRole('textbox', { name: '组名称', exact: true });
  await name.fill(nameValue);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const saved = page.locator('.buff-sheet-explorer-label').filter({ hasText: nameValue });
  await expect(saved).toBeVisible();
  await page.reload();
  await expect(saved).toBeVisible();

  await page.getByRole('button', { name: '导出', exact: true }).click();
  const preview = page.locator('.buff-sheet-share-textarea.is-preview');
  const share = JSON.parse(await preview.inputValue()) as { type?: string };
  return {
    persisted: true,
    shareType: share.type ?? '',
  };
}

async function observeWeapon(page: Page, baseUrl: string): Promise<CommonObservation['weapon']> {
  const nameValue = 'Dual Run Weapon';
  await openRoute(page, baseUrl, '/data/weapons', 'Sheet-Weapon');
  await page.getByRole('button', { name: '新建', exact: true }).click();
  const name = page.getByRole('textbox', { name: '武器名称', exact: true });
  await name.fill(nameValue);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const saved = page.locator('.buff-sheet-explorer-label').filter({ hasText: nameValue });
  await expect(saved).toBeVisible();
  await page.reload();
  await expect(saved).toBeVisible();

  await saved.click();
  const weaponRow = page.locator('.weapon-sheet-row-weapon');
  await weaponRow.locator('.damage-sheet-excel-cell').nth(2).click();
  const imageSearch = page.getByPlaceholder('搜索图片：文件名 / baseName / 路径 / URL');
  await imageSearch.click();
  const firstImageOption = page.locator('.weapon-sheet-image-picker-list .weapon-sheet-image-option').first();
  await expect(firstImageOption).toBeVisible();
  await firstImageOption.click();
  await expect(imageSearch).not.toHaveValue('');
  await expect(page.locator('.weapon-sheet-image-slot')).toHaveClass(/has-image/);
  await imageSearch.click();
  await page.locator('.weapon-sheet-image-option-clear').click();
  await expect(imageSearch).toHaveValue('');
  await expect(page.locator('.weapon-sheet-image-slot')).not.toHaveClass(/has-image/);

  await page.getByRole('button', { name: '导出', exact: true }).click();
  const preview = page.locator('.buff-sheet-share-textarea.is-preview');
  const share = JSON.parse(await preview.inputValue()) as { type?: string };
  return {
    persisted: true,
    shareType: share.type ?? '',
  };
}

async function observeEquipment(page: Page, baseUrl: string): Promise<CommonObservation['equipment']> {
  const nameValue = 'Dual Run Equipment';
  await openRoute(page, baseUrl, '/data/equipments', 'Sheet-Equipment');
  await page.getByRole('button', { name: '新建', exact: true }).click();
  const name = page.locator('input[value="新建装备"]');
  await expect(name).toHaveCount(1);
  await name.fill(nameValue);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('heading', { name: '确认保存装备库', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '确认保存', exact: true }).click();
  await expect(page.locator('.equipment-sheet-save-status')).toHaveText('已保存');
  await page.reload();
  await page.getByRole('button', { name: /^\[\+\] 潮涌 \d+$/ }).click();
  const saved = page.locator('.buff-sheet-explorer-label').filter({ hasText: nameValue });
  await expect(saved).toBeVisible();
  await saved.click();
  await expect(page.locator(`input[value="${nameValue}"]`)).toHaveCount(1);
  const selectSignatures = await page.locator('select.weapon-sheet-inline-input').evaluateAll((selects) => selects
    .filter((node) => !node.closest('[data-equipment-row-key^="three-piece-buff-"] .is-col-effectKey'))
    .map((node) => {
      const select = node as HTMLSelectElement;
      return `${select.value}::${Array.from(select.options, (option) => `${option.value}=${option.text}`).join('|')}`;
    }));
  expect(selectSignatures.length).toBeGreaterThan(0);

  await page.getByRole('button', { name: '导出', exact: true }).click();
  const preview = page.locator('.buff-sheet-share-textarea.is-preview');
  const share = JSON.parse(await preview.inputValue()) as { type?: string };
  return {
    persisted: true,
    shareType: share.type ?? '',
    selectSignatures,
  };
}

async function observeEquipmentThreePieceTypeEditor(
  page: Page,
  target: DualRunTarget,
): Promise<boolean> {
  await openRoute(page, target.baseUrl, '/data/equipments', 'Sheet-Equipment');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sheet-Equipment', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^\[\+\] 旧锋 \d+$/ }).click();
  const typeEditor = page.locator(
    '[data-equipment-row-key="three-piece-buff-gear-set-jiu-feng-effect1"] .is-col-effectKey select',
  );
  await expect(typeEditor).toHaveCount(target.legacyThreePieceTypeEditor ? 1 : 0);
  return (await typeEditor.count()) === 1;
}

async function observeOperator(page: Page, baseUrl: string): Promise<CommonObservation['operator']> {
  const nameValue = 'Dual Run Operator';
  const idValue = 'dual-run-operator';
  await openRoute(page, baseUrl, '/data/operators', '基础数据');
  await page.getByRole('button', { name: '新建', exact: true }).click();
  const basicFields = page.locator('.operator-draft-basic-grid');
  await basicFields.getByLabel('名称', { exact: true }).fill(nameValue);
  await basicFields.getByLabel('ID', { exact: true }).fill(idValue);
  const profession = basicFields.getByRole('combobox', { name: '职业', exact: true });
  const weapon = basicFields.getByRole('combobox', { name: '武器', exact: true });
  const element = basicFields.getByRole('combobox', { name: '元素', exact: true });
  const mainStat = basicFields.getByRole('combobox', { name: '主属性', exact: true });
  const subStat = basicFields.getByRole('combobox', { name: '副属性', exact: true });
  await profession.selectOption('突击');
  await weapon.selectOption('手铳');
  await element.selectOption('fire');
  await mainStat.selectOption('力量');
  await subStat.selectOption('敏捷');

  await page.getByRole('button', { name: '新增技能', exact: true }).click();
  const skillForm = page.locator('.operator-draft-skill-form');
  await skillForm.getByLabel('技能名', { exact: true }).fill('Dual Run Skill');
  const skillButtonType = skillForm.locator('label').filter({ hasText: '按钮类型' }).locator('select');
  await skillButtonType.selectOption('E');
  await page.getByRole('button', { name: '新增 Hit', exact: true }).click();
  const hitDetail = page.locator('.operator-draft-hit-detail-card');
  await hitDetail.getByLabel('名称', { exact: true }).fill('Dual Run Hit');
  const hitM3Input = hitDetail.getByLabel('M3', { exact: true });
  await hitM3Input.fill('2.75');
  await hitM3Input.press('Enter');
  await hitDetail.locator('label').filter({ hasText: '伤害属性' }).locator('select').selectOption('fire');
  await hitDetail.locator('label').filter({ hasText: '技能乘区' }).locator('select').selectOption('E');

  const buffPanel = page.locator('.operator-draft-buff-panel');
  await buffPanel.getByRole('button', { name: '新增', exact: true }).click();
  const buffDrawer = page.getByRole('dialog', { name: 'Buff 编辑器', exact: true });
  await expect(buffDrawer).toBeVisible();
  await buffDrawer.getByLabel('名称', { exact: true }).fill('Dual Run Operator Buff');
  await buffDrawer.locator('label').filter({ hasText: '业务类型' }).locator('select').selectOption('countable');
  await buffDrawer.locator('label').filter({ hasText: /^typeKey/ }).locator('select').selectOption('fireVulnerability');
  const buffValueInput = buffDrawer.getByLabel('数值', { exact: true });
  await buffValueInput.fill('0.25');
  await buffValueInput.press('Enter');
  const maxStacksInput = buffDrawer.getByLabel('最大层数', { exact: true });
  await maxStacksInput.fill('3');
  await maxStacksInput.press('Enter');
  await buffDrawer.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('button', { name: '保存到本地', exact: true }).click();

  const drafts = page.getByRole('combobox', { name: '载入本地草稿', exact: true });
  const saved = drafts.locator(`option[value="${idValue}"]`);
  await expect(saved).toHaveText(`${idValue} · ${nameValue}`);
  await page.reload();
  await expect(saved).toHaveText(`${idValue} · ${nameValue}`);
  await expect(profession).toHaveValue('突击');
  await expect(weapon).toHaveValue('手铳');
  await expect(element).toHaveValue('fire');
  await expect(mainStat).toHaveValue('力量');
  await expect(subStat).toHaveValue('敏捷');
  await expect(skillForm.getByLabel('技能名', { exact: true })).toHaveValue('Dual Run Skill');
  const savedHit = page.locator('.operator-draft-hit-item').filter({ hasText: 'Dual Run Hit' });
  await expect(savedHit).toHaveCount(1);
  await savedHit.click();
  await expect(hitDetail.getByLabel('M3', { exact: true })).toHaveValue('2.75');
  await expect(buffPanel.locator('.operator-draft-buff-item').filter({
    hasText: 'Dual Run Operator Buff',
  })).toHaveCount(1);

  await page.getByRole('button', { name: '保存到本地', exact: true }).click();
  await expect(page.getByRole('heading', { name: '覆盖本地干员', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('heading', { name: '覆盖本地干员', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '保存到本地', exact: true }).click();
  await page.getByRole('button', { name: '确认覆盖', exact: true }).click();
  await expect(page.getByRole('heading', { name: '覆盖本地干员', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: '分享库', exact: true }).click();
  const preview = page.locator('.operator-draft-share-textarea');
  const share = JSON.parse(await preview.inputValue()) as {
    type?: string;
    payload?: Record<string, Record<string, unknown>>;
  };
  const sharedDraft = share.payload?.[idValue];
  if (!sharedDraft) throw new Error('Dual Run Operator is missing from the current share payload.');
  const sharedSkill = Object.values(sharedDraft.skills as Record<string, Record<string, unknown>>)[0];
  const sharedHit = Object.values(sharedSkill.hitMeta as Record<string, Record<string, unknown>>)
    .find((hit) => hit.displayName === 'Dual Run Hit');
  if (!sharedHit) throw new Error('Dual Run Hit is missing from the Operator share payload.');
  const sharedBuff = Object.values(sharedDraft.buffs as Record<string, {
    effects?: Record<string, Record<string, unknown>>;
  }>).flatMap((group) => Object.values(group.effects ?? {}))
    .find((effect) => effect.name === 'Dual Run Operator Buff');
  if (!sharedBuff) throw new Error('Dual Run Operator Buff is missing from the share payload.');
  return {
    persisted: true,
    shareType: share.type ?? '',
    skillName: String(sharedSkill.displayName ?? ''),
    skillType: String(sharedSkill.buttonType ?? ''),
    hitName: String(sharedHit.displayName ?? ''),
    hitM3: typeof (sharedHit.levels as Record<string, unknown>)?.M3 === 'number'
      ? (sharedHit.levels as Record<string, number>).M3
      : null,
    hitElement: String(sharedHit.element ?? ''),
    hitSkillType: String(sharedHit.skillType ?? ''),
    buffType: String(sharedBuff.type ?? ''),
    buffValue: typeof sharedBuff.value === 'number' ? sharedBuff.value : null,
    buffMaxStacks: typeof sharedBuff.maxStacks === 'number' ? sharedBuff.maxStacks : null,
  };
}

async function observeLegacyDamageSheet(
  page: Page,
  target: DualRunTarget,
): Promise<Pick<CapabilityObservation, 'damageSheetRoute' | 'xlsxExport'>> {
  await page.goto(`${target.baseUrl}/#/timeline/report/damage`);
  await expect(page.locator('.app-route-loading')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  const damageSheet = page.getByRole('heading', { name: '伤害过程表', exact: true });
  const exportButton = page.getByRole('button', { name: '导出 XLSX', exact: true });
  await expect(damageSheet).toHaveCount(target.legacyDamageSheet ? 1 : 0);
  await expect(exportButton).toHaveCount(target.legacyDamageSheet ? 1 : 0);
  return {
    damageSheetRoute: (await damageSheet.count()) === 1,
    xlsxExport: (await exportButton.count()) === 1,
  };
}

async function observeTimeline(
  page: Page,
  target: DualRunTarget,
): Promise<{
  timeline: CommonObservation['timeline'];
  capabilities: Omit<CapabilityObservation, 'damageSheetRoute' | 'xlsxExport'>;
}> {
  await openRoute(page, target.baseUrl, '/timeline', '选择干员');
  for (const characterName of ['狼卫', '佩丽卡', '艾尔黛拉', '赛希']) {
    const card = page.locator('.selection-character-card').filter({ hasText: characterName });
    await expect(card).toHaveCount(1);
    await card.click();
  }
  await expect(page.getByText('已选 4/4', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '开始排轴', exact: true }).click();
  await expect(page.locator('.canvas-container')).toBeVisible();

  const tableButton = page.getByRole('button', { name: '表格', exact: true });
  const damageNavigation = page.getByRole('button', { name: '伤害表', exact: true });
  await expect(tableButton).toHaveCount(target.legacyDamageSheet ? 1 : 0);
  await expect(damageNavigation).toHaveCount(target.legacyDamageSheet ? 1 : 0);

  const drawerTrigger = page.locator('.canvas-bottom-zone-left > .workbench-top-trigger');
  await drawerTrigger.click();
  await expect(page.locator('.workbench-top-zone')).toHaveClass(/is-open/);
  const fakeSidebar = page.getByRole('button', { name: '计算侧栏', exact: true });
  await expect(fakeSidebar).toHaveCount(target.legacyDamageSheet ? 1 : 0);
  await drawerTrigger.click();

  const wolfHeader = page.locator('.sandbox-character-header').filter({ hasText: '狼卫' });
  await wolfHeader.click();
  const skillCandidate = page.locator('[title="狼卫 - 多重连射"]');
  await expect(skillCandidate).toHaveCount(1);
  await skillCandidate.dragTo(page.locator('.canvas-container'), {
    targetPosition: { x: 320, y: 180 },
  });

  const skillButton = page.locator('[data-skill-button-id]');
  await expect(skillButton).toHaveCount(1);
  const skillButtonId = await skillButton.getAttribute('data-skill-button-id');
  expect(skillButtonId).toBeTruthy();
  const skillType = await skillButton.getAttribute('data-skill-type');
  const outlinePaths = await skillButton.locator('.skill-button-composite-outline path').count();

  const successCommandId = `dual-refresh-${Date.now()}`;
  await enqueueWorkbenchCommand(page, { op: 'refreshSnapshot' }, successCommandId);
  await expect.poll(() => readWorkbenchCommand(page, successCommandId)).toMatchObject({
    status: 'done',
    result: {
      refreshed: true,
      selectedCharacterCount: 4,
      skillButtonCount: 1,
    },
  });
  const successCommand = await readWorkbenchCommand(page, successCommandId);
  const commandSuccess = {
    status: successCommand?.status ?? '',
    selectedCharacterCount: typeof successCommand?.result?.selectedCharacterCount === 'number'
      ? successCommand.result.selectedCharacterCount
      : null,
    skillButtonCount: typeof successCommand?.result?.skillButtonCount === 'number'
      ? successCommand.result.skillButtonCount
      : null,
  };

  const errorCommandId = `dual-error-${Date.now()}`;
  await enqueueWorkbenchCommand(page, {
    op: 'setTargetResistance',
    buttonId: 'missing-dual-e2e-button',
    targetResistance: { physicalResistance: 20 },
  }, errorCommandId);
  await expect.poll(() => readWorkbenchCommand(page, errorCommandId)).toMatchObject({
    status: 'error',
    error: '技能按钮不存在: missing-dual-e2e-button',
  });
  const failedCommand = await readWorkbenchCommand(page, errorCommandId);
  const commandError = {
    status: failedCommand?.status ?? '',
    error: failedCommand?.error ?? '',
  };

  await skillButton.dblclick();
  await expect(page.getByRole('dialog', { name: '技能排轴详情', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '目标抗性', exact: true }).click();
  const physicalResistanceInput = page.locator('.timeline-resistance-card')
    .getByText('物理', { exact: true })
    .locator('xpath=..')
    .locator('input');
  await physicalResistanceInput.fill('37');
  await physicalResistanceInput.press('Enter');
  await expect(physicalResistanceInput).toHaveValue('37');
  const physicalResistance = await physicalResistanceInput.inputValue();
  const summary = normalizeText(await page.locator('.timeline-summary-card').innerText());
  const calculation = normalizeText(await page.locator('.timeline-calculation-card').innerText());
  await page.getByRole('dialog', { name: '技能排轴详情', exact: true })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await expect(page.locator('.canvas-container')).toBeVisible();

  await page.getByRole('button', { name: '计算伤害', exact: true }).click();
  await expect(page).toHaveURL(/#\/timeline\/report\/presentation$/);
  await expect(page.getByRole('heading', { name: '队伍配置', exact: true })).toBeVisible();
  const reportMeta = normalizeText(await page.locator('.report-ppt-toolbar span').innerText());

  await page.evaluate(() => {
    window.location.hash = '#/timeline';
  });
  await expect(page.locator('.canvas-container')).toBeVisible();

  await page.locator('.workbench-bottom-nav-button').filter({ hasText: '干员配置' }).click();
  await expect(page.locator('.operator-config-page-root')).toBeVisible();
  const operatorConfigVisible = await page.locator('.operator-config-page-root').isVisible();

  const selectOperatorEquipment = async (
    circleSelector: string,
    heading: string,
    equipmentName: string,
  ) => {
    const circle = page.locator(circleSelector);
    await circle.click();
    const picker = page.locator('.operator-config-page-picker-modal');
    await expect(picker.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await picker.getByText(equipmentName, { exact: true }).locator('xpath=ancestor::button[1]').click();
    await expect(picker).toHaveCount(0);
    await expect(circle.locator('img')).toHaveAttribute('alt', equipmentName);
  };
  await selectOperatorEquipment('.operator-config-page-equip-circle--1', '选择护甲', '旧锋装甲');
  const operatorEquipmentLevelButton = page.locator('button[aria-label="armor 词条 1 档位 L2"]');
  await operatorEquipmentLevelButton.click();
  await expect(operatorEquipmentLevelButton).toHaveAttribute('aria-pressed', 'true');
  await selectOperatorEquipment('.operator-config-page-equip-circle--2', '选择配件', '旧锋刺刃');
  await selectOperatorEquipment('.operator-config-page-equip-circle--4', '选择护手', '旧锋手甲');
  await expect(page.locator('.operator-config-page-equip-set-empty')).toHaveCount(0);
  const operatorEquipmentNames = await page.locator([
    '.operator-config-page-equip-circle--1 img',
    '.operator-config-page-equip-circle--2 img',
    '.operator-config-page-equip-circle--4 img',
  ].join(', ')).evaluateAll((images) => images.map((image) => image.getAttribute('alt') ?? ''));
  const operatorEquipmentLevel = await operatorEquipmentLevelButton.getAttribute('aria-pressed');
  const operatorSetBuffLines = (await page.locator('.operator-config-page-equip-set-line').allTextContents())
    .map(normalizeText);
  expect(operatorSetBuffLines.length).toBeGreaterThan(0);
  await page.evaluate(() => {
    window.location.hash = '#/timeline';
  });
  await expect(page.locator('.canvas-container')).toBeVisible();

  await page.locator('.workbench-bottom-nav-button').filter({ hasText: '批量 Buff' }).click();
  await expect(page.locator('.buff-batch-edit-workbench')).toBeVisible();
  const batchButton = page.locator('.buff-edit-skill-button');
  await expect(batchButton).toHaveCount(1);
  const selectionCounter = page.locator('.buff-edit-selection-counter');
  await expect(selectionCounter).toHaveText('已选 0/1');
  const wolfQuickSelect = page.getByRole('button', { name: '选择干员按钮 狼卫', exact: true });
  await wolfQuickSelect.click();
  await expect(selectionCounter).toHaveText('已选 1/1');
  await wolfQuickSelect.click();
  await expect(selectionCounter).toHaveText('已选 0/1');

  await page.locator('.buff-edit-mode-button').click();
  await expect(page.getByRole('heading', { name: '编辑目录', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: '编辑目录', exact: true })).toHaveCount(0);

  await page.locator('.buff-edit-add-button').click();
  await expect(page.getByRole('heading', { name: '增加 Buff', exact: true })).toBeVisible();
  await page.keyboard.press('Tab');
  const candidateModal = page.locator('.buff-edit-candidate-modal');
  await expect(candidateModal).toBeVisible();
  await candidateModal.getByRole('button', { name: '异常状态区', exact: true }).click();
  await expect(candidateModal.locator('.skill-anomaly-layout')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(candidateModal).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: '增加 Buff', exact: true })).toHaveCount(0);
  const buffBatchSecondaryPaths = true;

  await batchButton.click();
  const buffBatchSelected = normalizeText(await selectionCounter.innerText());

  await page.locator('.workbench-bottom-nav-button').filter({ hasText: '排轴' }).click();
  await expect(page.locator('.canvas-container')).toBeVisible();
  await page.reload();
  const persistedSkill = page.locator(`[data-skill-button-id="${skillButtonId}"]`);
  await expect(persistedSkill).toHaveCount(1);

  return {
    timeline: {
      selectedCharacters: 4,
      skillButtons: 1,
      skillType,
      outlinePaths,
      detailVisible: true,
      summary,
      calculation,
      reportMeta,
      operatorConfigVisible,
      operatorEquipmentNames,
      operatorEquipmentLevel,
      operatorSetBuffLines,
      buffBatchSelected,
      buffBatchSecondaryPaths,
      commandSuccess,
      commandError,
      physicalResistance,
      persistedAfterReload: true,
    },
    capabilities: {
      tableButton: (await tableButton.count()) === 1,
      damageSheetNavigation: (await damageNavigation.count()) === 1,
      fakeCalculationSidebar: (await fakeSidebar.count()) === 1,
    },
  };
}

async function runTarget(browser: Browser, target: DualRunTarget): Promise<TargetObservation> {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    serviceWorkers: 'allow',
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: target.baseUrl });
  const page = await context.newPage();
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
  });

  try {
    const install = await test.step(`${target.name}: access and install`, () =>
      bootstrap(page, target));
    const routeHeadings: string[] = [];
    await test.step(`${target.name}: common lazy routes`, async () => {
      for (const [path, heading] of COMMON_ROUTES) {
        await openRoute(page, target.baseUrl, path, heading);
        routeHeadings.push(heading);
      }
    });
    const themes = await test.step(`${target.name}: five-theme editor structure`, () =>
      observeEditorThemes(page, target.baseUrl));
    const liveThemes = await test.step(`${target.name}: five-theme live switch`, () =>
      observeLiveThemeSwitch(page, target.baseUrl));
    const legacy = await test.step(`${target.name}: declared legacy capability`, () =>
      observeLegacyDamageSheet(page, target));
    const buff = await test.step(`${target.name}: Buff save/reload/share`, () =>
      observeBuff(page, target.baseUrl));
    const weapon = await test.step(`${target.name}: Weapon save/reload/share`, () =>
      observeWeapon(page, target.baseUrl));
    const equipment = await test.step(`${target.name}: Equipment save/reload/share`, () =>
      observeEquipment(page, target.baseUrl));
    const equipmentThreePieceTypeEditor = await test.step(
      `${target.name}: Equipment three-piece duplicate type editor`,
      () => observeEquipmentThreePieceTypeEditor(page, target),
    );
    const operator = await test.step(`${target.name}: Operator save/reload/share`, () =>
      observeOperator(page, target.baseUrl));
    const timelineResult = await test.step(`${target.name}: Timeline/detail/report/config/batch`, () =>
      observeTimeline(page, target));
    const syntheticArchive = await test.step(
      `${target.name}: synthetic data package -> SQLite -> damage report`,
      () => observeSyntheticArchiveAfterSqliteReload(page, target.baseUrl, {
        archive: SYNTHETIC_LOCAL_DATA_ARCHIVE as unknown as Record<string, unknown>,
        archiveId: SYNTHETIC_LOCAL_DATA_ARCHIVE.timelineArchives?.[0]?.archiveId ?? '',
        operatorId: SYNTHETIC_CONFIG_SNAPSHOT.operator.id,
        packageId: SYNTHETIC_LOCAL_DATA_ARCHIVE.id,
        workspaceLabel: '测试满乘区 SQLite',
        expectedButtonCount: Object.keys(SYNTHETIC_TIMELINE_PAYLOAD.skillButtonTable).length,
      }),
    );

    return {
      common: {
        install,
        routeHeadings,
        buff,
        weapon,
        equipment,
        operator,
        themes,
        liveThemes,
        timeline: timelineResult.timeline,
        syntheticArchive,
      },
      capabilities: {
        ...legacy,
        equipmentThreePieceTypeEditor,
        ...timelineResult.capabilities,
      },
      browserErrors,
    };
  } finally {
    await context.close();
  }
}

test('baseline and candidate share one black-box contract', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const targets: DualRunTarget[] = [
    {
      name: BASELINE_LABEL,
      baseUrl: LTS_BASE_URL,
      publicEntry: readBooleanEnvironment('LTS_DUAL_BASELINE_PUBLIC_ENTRY', false),
      legacyDamageSheet: readBooleanEnvironment('LTS_DUAL_BASELINE_LEGACY_DAMAGE_SHEET', true),
      legacyThreePieceTypeEditor: readBooleanEnvironment('LTS_DUAL_BASELINE_LEGACY_THREE_PIECE_TYPE_EDITOR', true),
    },
    {
      name: CANDIDATE_LABEL,
      baseUrl: SLIM_BASE_URL,
      publicEntry: readBooleanEnvironment('LTS_DUAL_CANDIDATE_PUBLIC_ENTRY', true),
      legacyDamageSheet: readBooleanEnvironment('LTS_DUAL_CANDIDATE_LEGACY_DAMAGE_SHEET', false),
      legacyThreePieceTypeEditor: readBooleanEnvironment('LTS_DUAL_CANDIDATE_LEGACY_THREE_PIECE_TYPE_EDITOR', false),
    },
  ];

  const baseline = await runTarget(browser, targets[0]);
  const slim = await runTarget(browser, targets[1]);

  expect(baseline.browserErrors, `${targets[0].name} browser console/page errors`).toEqual([]);
  expect(slim.browserErrors, `${targets[1].name} browser console/page errors`).toEqual([]);
  expectSyntheticArchiveObservation(baseline.common.syntheticArchive, targets[0].name);
  expectSyntheticArchiveObservation(slim.common.syntheticArchive, targets[1].name);
  expect(slim.common, 'shared public behavior must remain equal').toEqual(baseline.common);

  expect(baseline.capabilities).toEqual(expectedCapabilities(targets[0]));
  expect(slim.capabilities).toEqual(expectedCapabilities(targets[1]));

  await testInfo.attach('lts-dual-run-observations.json', {
    body: Buffer.from(JSON.stringify({ baseline, slim }, null, 2)),
    contentType: 'application/json',
  });
});
