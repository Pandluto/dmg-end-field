import { expect, test, type Page } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:3040';

async function openRoute(page: Page, path: string, heading: string): Promise<void> {
  await page.goto(`${BASE_URL}/#${path}`);
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  await expect(page.locator('.app-route-loading')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
}

test('v1.8 LTS slimming browser behavior baseline', async ({ page }) => {
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
  });

  await test.step('access lease and first installation stay functional', async () => {
    await page.goto(BASE_URL);
    await expect(page.getByRole('heading', { name: '终末地伤害工作台', exact: true })).toBeVisible();

    const password = page.getByRole('textbox', { name: '访问密码', exact: true });
    await password.fill('wrong-password');
    await page.getByRole('button', { name: '进入工作台', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('访问密码不正确。');

    await password.fill('zmd');
    await page.getByRole('button', { name: '进入工作台', exact: true }).click();
    await expect(page.getByRole('heading', { name: '先把基础资料装进浏览器', exact: true })).toBeVisible();
    await expect(page.getByText('30 位本地干员', { exact: true })).toBeVisible();
    await expect(page.getByText('75 件本地武器', { exact: true })).toBeVisible();
    await expect(page.getByText('559 个图片资源', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: '下载完整资料并开始', exact: true }).click();
    await expect(page.getByRole('heading', { name: '建立第一份排轴', exact: true })).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.getByText('Web LTS 1.8', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.localStorage.getItem('dmg.web.access-lease.v1'))).toBeTruthy();
  });

  await test.step('all slimming-related lazy routes render without a fallback or alert', async () => {
    const routes = [
      ['/data/operators', '基础数据'],
      ['/data/buffs', 'Sheet-Buff'],
      ['/data/weapons', 'Sheet-Weapon'],
      ['/data/equipments', 'Sheet-Equipment'],
      ['/data/images', '图片资源管理'],
      ['/timeline', '选择干员'],
      ['/timeline/report/damage', '伤害过程表'],
    ] as const;

    for (const [path, heading] of routes) {
      await openRoute(page, path, heading);
    }
  });

  await test.step('Buff draft saves through browser storage and survives reload', async () => {
    await openRoute(page, '/data/buffs', 'Sheet-Buff');
    await page.getByRole('button', { name: '新建', exact: true }).click();
    const name = page.getByRole('textbox', { name: '组名称', exact: true });
    await expect(name).toHaveValue('新建 Buff 组');
    await name.fill('Slim E2E Buff');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    const savedEntry = page.locator('.buff-sheet-explorer-label').filter({ hasText: 'Slim E2E Buff' });
    await expect(savedEntry).toHaveCount(1);
    await expect(savedEntry).toBeVisible();
    await page.reload();
    await expect(savedEntry).toBeVisible();
  });

  await test.step('Weapon draft saves through browser storage and survives reload', async () => {
    await openRoute(page, '/data/weapons', 'Sheet-Weapon');
    await page.getByRole('button', { name: '新建', exact: true }).click();
    const name = page.getByRole('textbox', { name: '武器名称', exact: true });
    await expect(name).toHaveValue('新建武器');
    await name.fill('Slim E2E Weapon');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    const savedEntry = page.locator('.buff-sheet-explorer-label').filter({ hasText: 'Slim E2E Weapon' });
    await expect(savedEntry).toHaveCount(1);
    await expect(savedEntry).toBeVisible();
    await page.reload();
    await expect(savedEntry).toBeVisible();
  });

  await test.step('Equipment draft saves through browser storage and survives reload', async () => {
    await openRoute(page, '/data/equipments', 'Sheet-Equipment');
    await page.getByRole('button', { name: '新建', exact: true }).click();
    const name = page.locator('input[value="新建装备"]');
    await expect(name).toHaveCount(1);
    await name.fill('Slim E2E Equipment');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByRole('heading', { name: '确认保存装备库', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '确认保存', exact: true }).click();
    await expect(page.getByText('已保存到浏览器 SQLite 装备库。', { exact: false })).toBeVisible();
    const savedEntry = page.locator('.buff-sheet-explorer-label').filter({
      hasText: 'Slim E2E Equipment',
    });
    await expect(savedEntry).toHaveCount(1);
    await expect(savedEntry).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: /^\[\+\] 潮涌 \d+$/ }).click();
    await expect(savedEntry).toBeVisible();
  });

  await test.step('Operator draft saves through browser storage and survives reload', async () => {
    await openRoute(page, '/data/operators', '基础数据');
    await page.getByRole('button', { name: '新建', exact: true }).click();
    const basicFields = page.locator('.operator-draft-basic-grid');
    await basicFields.getByLabel('名称', { exact: true }).fill('Slim E2E Operator');
    await basicFields.getByLabel('ID', { exact: true }).fill('slim-e2e-operator');
    await page.getByRole('button', { name: '保存到本地', exact: true }).click();

    const localDrafts = page.getByRole('combobox', { name: '载入本地草稿', exact: true });
    const savedOption = localDrafts.locator('option[value="slim-e2e-operator"]');
    await expect(savedOption).toHaveText('slim-e2e-operator · Slim E2E Operator');
    await page.reload();
    await expect(savedOption).toHaveText('slim-e2e-operator · Slim E2E Operator');
  });

  await test.step('SkillButton keeps timeline persistence, detail routing, and theme DOM', async () => {
    await openRoute(page, '/timeline', '选择干员');
    for (const characterName of ['狼卫', '佩丽卡', '艾尔黛拉', '赛希']) {
      const card = page.locator('.selection-character-card').filter({ hasText: characterName });
      await expect(card).toHaveCount(1);
      await card.click();
    }
    await expect(page.getByText('已选 4/4', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '开始排轴', exact: true }).click();
    await expect(page.locator('.canvas-container')).toBeVisible();

    const wolfHeader = page.locator('.sandbox-character-header').filter({ hasText: '狼卫' });
    await expect(wolfHeader).toHaveCount(1);
    await wolfHeader.click();
    const skillCandidate = page.locator('[title="狼卫 - 多重连射"]');
    await expect(skillCandidate).toHaveCount(1);
    await skillCandidate.dragTo(page.locator('.canvas-container'), {
      targetPosition: { x: 320, y: 180 },
    });

    const skillButton = page.locator('[data-skill-button-id]');
    await expect(skillButton).toHaveCount(1);
    await expect(skillButton).toHaveAttribute('data-liquid-glass-skill', 'true');
    await expect(skillButton).toHaveAttribute('data-skill-type', 'A');
    await expect(skillButton.locator('.skill-button-composite-outline path')).toHaveCount(3);
    const skillButtonId = await skillButton.getAttribute('data-skill-button-id');
    expect(skillButtonId).toBeTruthy();

    await skillButton.dblclick();
    await expect(page).toHaveURL(new RegExp(`#/timeline/skill/${skillButtonId}$`));
    await expect(page.getByRole('dialog', { name: '技能排轴详情', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '伤害汇总', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '计算过程', exact: true })).toBeVisible();

    await page.reload();
    await expect(page.locator(`[data-skill-button-id="${skillButtonId}"]`)).toHaveCount(1);
    await expect(page.getByRole('dialog', { name: '技能排轴详情', exact: true })).toBeVisible();
  });

  expect(browserErrors, 'browser console/page errors').toEqual([]);
});
