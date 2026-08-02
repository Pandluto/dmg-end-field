import { expect, test, type Page } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:3040';

async function openRoute(page: Page, path: string, heading: string): Promise<void> {
  await page.goto(`${BASE_URL}/#${path}`);
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  await expect(page.locator('.app-route-loading')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
}

test('v1.8 LTS slimming browser behavior baseline', async ({ context, page }) => {
  const browserErrors: string[] = [];
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE_URL });
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

    const savedGroupRow = page.locator('.buff-sheet-explorer-row').filter({ hasText: 'Slim E2E Buff' });
    await savedGroupRow.locator('.buff-sheet-explorer-toggle').click();
    await savedGroupRow.click({ button: 'right' });
    await page.getByRole('button', { name: '新建项', exact: true }).click();

    const createdItem = page.locator('.buff-sheet-explorer-child').filter({ hasText: '自定义项 01' });
    await expect(createdItem).toBeVisible();
    await createdItem.click({ button: 'right' });
    await page.getByRole('button', { name: '删除项', exact: true }).click();
    await expect(createdItem).toHaveCount(0);

    await page.getByRole('button', { name: '撤回', exact: true }).click();
    await page.locator('.damage-sheet-undo-item').filter({ hasText: '删除自定义项 · item-1' }).click();
    await savedGroupRow.locator('.buff-sheet-explorer-toggle').click();
    await expect(createdItem).toBeVisible();

    await page.reload();
    await savedGroupRow.locator('.buff-sheet-explorer-toggle').click();
    await expect(createdItem).toBeVisible();

    await page.getByRole('button', { name: '导出', exact: true }).click();
    const shareModal = page.locator('.buff-sheet-share-modal');
    const sharePreview = shareModal.locator('.buff-sheet-share-textarea.is-preview');
    const shareText = await sharePreview.inputValue();
    const parsedShare = JSON.parse(shareText) as {
      type: string;
      exportedAt: number;
      label: string;
      payload: Record<string, Record<string, unknown>>;
    };
    expect(parsedShare.type).toBe('buff-library-share.v1');
    const sourceDraft = Object.values(parsedShare.payload).find((value) => value.name === 'Slim E2E Buff');
    expect(sourceDraft).toBeTruthy();

    await shareModal.getByRole('button', { name: '复制 JSON', exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(shareText);
    const downloadPromise = page.waitForEvent('download');
    await shareModal.getByRole('button', { name: '导出文件', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.json$/);

    await shareModal.locator('.buff-sheet-share-modal-tab').filter({ hasText: '导入' }).click();
    const importText = shareModal.locator('.buff-sheet-share-textarea:not(.is-preview)');
    await importText.fill(JSON.stringify({ type: 'not-a-buff-share', payload: {} }));
    await shareModal.getByRole('button', { name: '读取粘贴内容', exact: true }).click();
    await expect(shareModal.getByText('JSON 无效，或不是 Buff 分享文件。', { exact: true })).toBeVisible();

    await importText.fill(JSON.stringify({
      type: 'buff-library-share.v1',
      exportedAt: Date.now(),
      label: 'Slim E2E Import',
      payload: {
        'slim-imported': {
          ...sourceDraft,
          id: 'slim-imported',
          name: 'Slim Imported Buff',
        },
        invalid: {},
      },
    }));
    await shareModal.getByRole('button', { name: '读取粘贴内容', exact: true }).click();
    await expect(shareModal.getByText('名称：Slim E2E Import', { exact: true })).toBeVisible();
    await expect(shareModal.getByText('分组数：1', { exact: true })).toBeVisible();
    await shareModal.getByRole('button', { name: '确认导入', exact: true }).click();

    const importedEntry = page.locator('.buff-sheet-explorer-label').filter({ hasText: 'Slim Imported Buff' });
    await expect(importedEntry).toBeVisible();
    await page.reload();
    await expect(importedEntry).toBeVisible();

    const importedGroupRow = page.locator('.buff-sheet-explorer-row').filter({ hasText: 'Slim Imported Buff' });
    const cancelBox = await savedGroupRow.boundingBox();
    if (!cancelBox) throw new Error('Saved Buff group is not available for drag cancellation test.');
    await page.mouse.move(cancelBox.x + cancelBox.width / 2, cancelBox.y + cancelBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(cancelBox.x + cancelBox.width / 2 + 12, cancelBox.y + cancelBox.height / 2);
    await page.waitForTimeout(260);
    await expect(page.locator('.buff-sheet-drag-preview')).toHaveCount(0);
    await page.mouse.up();

    const sourceBox = await importedGroupRow.boundingBox();
    const targetBox = await savedGroupRow.boundingBox();
    if (!sourceBox || !targetBox) throw new Error('Buff groups are not available for drag reorder test.');
    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(260);
    await expect(page.locator('.buff-sheet-drag-preview')).toBeVisible();
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 5 });
    await expect(savedGroupRow).toHaveClass(/is-drag-target/);
    await page.mouse.up();
    await expect(page.locator('.buff-sheet-drag-preview')).toHaveCount(0);

    const groupLabels = page.locator('.buff-sheet-explorer-row .buff-sheet-explorer-label');
    let reorderedLabels = await groupLabels.allTextContents();
    expect(reorderedLabels.indexOf('Slim Imported Buff')).toBeLessThan(reorderedLabels.indexOf('Slim E2E Buff'));
    await page.reload();
    await expect(importedEntry).toBeVisible();
    await expect(savedEntry).toBeVisible();
    reorderedLabels = await groupLabels.allTextContents();
    expect(reorderedLabels.indexOf('Slim Imported Buff')).toBeLessThan(reorderedLabels.indexOf('Slim E2E Buff'));
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
