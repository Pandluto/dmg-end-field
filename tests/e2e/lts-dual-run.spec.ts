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
  legacyDamageSheet: boolean;
  legacyThreePieceTypeEditor: boolean;
}

interface CommonObservation {
  install: {
    operators: number;
    weapons: number;
    images: number;
    leaseStored: boolean;
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
    buffBatchSelected: string;
    persistedAfterReload: boolean;
  };
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

async function bootstrap(page: Page, baseUrl: string): Promise<CommonObservation['install']> {
  await page.goto(baseUrl);
  await expect(page.getByRole('heading', { name: '终末地伤害工作台', exact: true })).toBeVisible();

  const password = page.getByRole('textbox', { name: '访问密码', exact: true });
  await password.fill(`${ACCESS_PASSWORD}-wrong`);
  await page.getByRole('button', { name: '进入工作台', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('访问密码不正确。');

  await password.fill(ACCESS_PASSWORD);
  await page.getByRole('button', { name: '进入工作台', exact: true }).click();
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
    leaseStored: await page.evaluate(() => Boolean(window.localStorage.getItem('dmg.web.access-lease.v1'))),
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

  await page.getByRole('button', { name: '保存到本地', exact: true }).click();
  await expect(page.getByRole('heading', { name: '覆盖本地干员', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('heading', { name: '覆盖本地干员', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '保存到本地', exact: true }).click();
  await page.getByRole('button', { name: '确认覆盖', exact: true }).click();
  await expect(page.getByRole('heading', { name: '覆盖本地干员', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: '分享库', exact: true }).click();
  const preview = page.locator('.operator-draft-share-textarea');
  const share = JSON.parse(await preview.inputValue()) as { type?: string };
  return {
    persisted: true,
    shareType: share.type ?? '',
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

  await skillButton.dblclick();
  await expect(page.getByRole('dialog', { name: '技能排轴详情', exact: true })).toBeVisible();
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
  await page.evaluate(() => {
    window.location.hash = '#/timeline';
  });
  await expect(page.locator('.canvas-container')).toBeVisible();

  await page.locator('.workbench-bottom-nav-button').filter({ hasText: '批量 Buff' }).click();
  await expect(page.locator('.buff-batch-edit-workbench')).toBeVisible();
  const batchButton = page.locator('.buff-edit-skill-button');
  await expect(batchButton).toHaveCount(1);
  await batchButton.click();
  const buffBatchSelected = normalizeText(await page.locator('.buff-edit-selection-counter').innerText());

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
      buffBatchSelected,
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
      bootstrap(page, target.baseUrl));
    const routeHeadings: string[] = [];
    await test.step(`${target.name}: common lazy routes`, async () => {
      for (const [path, heading] of COMMON_ROUTES) {
        await openRoute(page, target.baseUrl, path, heading);
        routeHeadings.push(heading);
      }
    });
    const themes = await test.step(`${target.name}: five-theme editor structure`, () =>
      observeEditorThemes(page, target.baseUrl));
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

    return {
      common: {
        install,
        routeHeadings,
        buff,
        weapon,
        equipment,
        operator,
        themes,
        timeline: timelineResult.timeline,
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
      legacyDamageSheet: readBooleanEnvironment('LTS_DUAL_BASELINE_LEGACY_DAMAGE_SHEET', true),
      legacyThreePieceTypeEditor: readBooleanEnvironment('LTS_DUAL_BASELINE_LEGACY_THREE_PIECE_TYPE_EDITOR', true),
    },
    {
      name: CANDIDATE_LABEL,
      baseUrl: SLIM_BASE_URL,
      legacyDamageSheet: readBooleanEnvironment('LTS_DUAL_CANDIDATE_LEGACY_DAMAGE_SHEET', false),
      legacyThreePieceTypeEditor: readBooleanEnvironment('LTS_DUAL_CANDIDATE_LEGACY_THREE_PIECE_TYPE_EDITOR', false),
    },
  ];

  const baseline = await runTarget(browser, targets[0]);
  const slim = await runTarget(browser, targets[1]);

  expect(baseline.browserErrors, `${targets[0].name} browser console/page errors`).toEqual([]);
  expect(slim.browserErrors, `${targets[1].name} browser console/page errors`).toEqual([]);
  expect(slim.common, 'shared public behavior must remain equal').toEqual(baseline.common);

  expect(baseline.capabilities).toEqual(expectedCapabilities(targets[0]));
  expect(slim.capabilities).toEqual(expectedCapabilities(targets[1]));

  await testInfo.attach('lts-dual-run-observations.json', {
    body: Buffer.from(JSON.stringify({ baseline, slim }, null, 2)),
    contentType: 'application/json',
  });
});
