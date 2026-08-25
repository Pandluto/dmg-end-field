import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  readCountEnvironment,
  readTextEnvironment,
} from './regressionEnvironment';

const packageMetadata = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string };

const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3040';
const EXPECTED_OPERATOR_COUNT = readCountEnvironment('E2E_EXPECTED_OPERATOR_COUNT', 30);
const EXPECTED_WEAPON_COUNT = readCountEnvironment('E2E_EXPECTED_WEAPON_COUNT', 75);
const EXPECTED_IMAGE_COUNT = readCountEnvironment('E2E_EXPECTED_IMAGE_COUNT', 559);
const EXPECTED_VERSION_LABEL = readTextEnvironment('E2E_EXPECTED_VERSION_LABEL', 'Web LTS 1.8');
const EXPECTED_APP_VERSION_LABEL = readTextEnvironment(
  'E2E_EXPECTED_APP_VERSION_LABEL',
  `v${packageMetadata.version}`,
);

async function openRoute(page: Page, path: string, heading: string): Promise<void> {
  await page.goto(`${BASE_URL}/#${path}`);
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  await expect(page.locator('.app-route-loading')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
}

async function upsertGeneratedWebImage(
  page: Page,
  relativePath: string,
  color: string,
  size: number,
): Promise<{ beforeUrl: string | null; afterUrl: string | null }> {
  return page.evaluate(async ({ relativePath: path, color: fillColor, size: dimension }) => {
    const canvas = document.createElement('canvas');
    canvas.width = dimension;
    canvas.height = dimension;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas context is unavailable.');
    context.fillStyle = fillColor;
    context.fillRect(0, 0, dimension, dimension);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => {
        if (value) resolve(value);
        else reject(new Error('Canvas PNG generation failed.'));
      }, 'image/png');
    });
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    const sha256 = Array.from(
      new Uint8Array(digest),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('');
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const modulePath = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((name) => /\/src\/platform\/resources\/webImageLibrary\.ts(?:\?|$)/.test(name));
    if (!modulePath) throw new Error('The active web image library module URL is unavailable.');
    const imageLibrary = await import(/* @vite-ignore */ modulePath);
    const beforeUrl = imageLibrary.resolveWebImageUrl(path);
    await imageLibrary.importWebImageAssets([{
      relativePath: path,
      mimeType: 'image/png',
      sizeBytes: bytes.byteLength,
      updatedAt: Date.now(),
      sha256,
      contentBase64: btoa(binary),
    }]);
    return {
      beforeUrl,
      afterUrl: imageLibrary.resolveWebImageUrl(path),
    };
  }, { relativePath, color, size });
}

async function deleteWebImage(page: Page, relativePath: string): Promise<void> {
  const result = await page.evaluate(async (path) => {
    const modulePath = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((name) => /\/src\/platform\/resources\/webImageLibrary\.ts(?:\?|$)/.test(name));
    if (!modulePath) throw new Error('The active web image library module URL is unavailable.');
    const imageLibrary = await import(/* @vite-ignore */ modulePath);
    return imageLibrary.webImageLibrary.deleteFile(path);
  }, relativePath);
  expect(result).toEqual({ ok: true });
}

function readSkillButtonBuffCount(title: string | null): number {
  const match = title?.match(/\bBuff\s+(\d+)\s*$/);
  if (!match) {
    throw new Error(`技能按钮 title 缺少 Buff count: ${title ?? '<null>'}`);
  }
  return Number(match[1]);
}

async function clickBuffCardByLabel(page: Page, label: string): Promise<Locator> {
  const cards = page.locator('.buff-edit-buff-card');
  const cardCount = await cards.count();
  for (let index = 0; index < cardCount; index += 1) {
    const card = cards.nth(index);
    const cardLabel = (await card.locator('.buff-edit-buff-card-title').textContent())?.trim();
    if (cardLabel !== label) continue;
    await card.click();
    return card;
  }
  throw new Error(`没有找到 Buff 卡片：${label}`);
}

async function selectFirstUnownedBuffCard(page: Page, skillButton: Locator): Promise<string> {
  const cards = page.locator('.buff-edit-buff-card');
  const cardCount = await cards.count();
  for (let index = 0; index < cardCount; index += 1) {
    const card = cards.nth(index);
    const label = (await card.locator('.buff-edit-buff-card-title').textContent())?.trim();
    if (!label) continue;

    const cardClassName = await card.getAttribute('class');
    const skillClassName = await skillButton.getAttribute('class');
    const isSelected = cardClassName?.split(/\s+/).includes('is-selected');
    const isOwned = skillClassName?.split(/\s+/).includes('is-add-owned');
    if (isSelected && !isOwned) {
      return label;
    }

    await card.click();
    await expect(card).toHaveClass(/is-selected/);
    const nextClassName = await skillButton.getAttribute('class');
    if (!nextClassName?.split(/\s+/).includes('is-add-owned')) {
      return label;
    }
  }
  throw new Error(`没有找到技能按钮尚未拥有的 Buff 卡片（共检查 ${cardCount} 张）。`);
}

async function selectDynamicAddBuffCard(page: Page, skillButton: Locator, expectedLabel?: string): Promise<string> {
  const cards = page.locator('.buff-edit-buff-card');
  if (await cards.count() === 0) {
    await page.keyboard.press('Tab');
    const candidateSearchInput = page.getByPlaceholder('搜索组 / 项 / Buff / 类型 / 条件');
    await expect(candidateSearchInput).toBeVisible();
    await page.getByRole('button', { name: '干员', exact: true }).click();
    await candidateSearchInput.fill('狼卫');
    const candidateResults = page.locator('.skill-button-inline-buff-search-item');
    await expect(candidateResults.first()).toBeVisible({ timeout: 30_000 });
    let candidateResult = candidateResults.first();
    if (expectedLabel) {
      const resultCount = await candidateResults.count();
      for (let index = 0; index < resultCount; index += 1) {
        const result = candidateResults.nth(index);
        const resultLabel = (await result.locator('.local-buff-search-item-head strong').textContent())?.trim();
        if (resultLabel === expectedLabel) {
          candidateResult = result;
          break;
        }
      }
      const selectedResultLabel = (await candidateResult.locator('.local-buff-search-item-head strong').textContent())?.trim();
      if (selectedResultLabel !== expectedLabel) {
        throw new Error(`候选搜索结果中没有找到同一 Buff：${expectedLabel}`);
      }
    }
    await candidateResult.click();
    await expect(cards.first()).toBeVisible();
  }
  return selectFirstUnownedBuffCard(page, skillButton);
}

async function dragBoxOverLocator(page: Page, canvas: Locator, target: Locator): Promise<void> {
  const canvasBox = await canvas.boundingBox();
  const targetBox = await target.boundingBox();
  if (!canvasBox || !targetBox) {
    throw new Error('批量 Buff 框选所需的画布或技能按钮不可见。');
  }

  const startX = Math.max(canvasBox.x + 4, targetBox.x - 10);
  const startY = Math.max(canvasBox.y + 4, targetBox.y - 10);
  const endX = Math.min(canvasBox.x + canvasBox.width - 4, targetBox.x + targetBox.width + 10);
  const endY = Math.min(canvasBox.y + canvasBox.height - 4, targetBox.y + targetBox.height + 10);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 8 });
  await page.mouse.up();
}

async function seedPersistedBuffOverrides(
  page: Page,
  buttonId: string,
  buffLabel: string,
): Promise<string> {
  return page.evaluate(async ({ buttonId: targetButtonId, buffLabel: targetBuffLabel }) => {
    const moduleUrls = performance.getEntriesByType('resource').map((entry) => entry.name);
    const buffServiceUrl = moduleUrls.find((name) => /\/src\/core\/services\/buffService\.ts(?:\?|$)/.test(name));
    const skillButtonRepositoryUrl = moduleUrls.find((name) => /\/src\/core\/repositories\/skillButtonRepository\.ts(?:\?|$)/.test(name));
    if (!buffServiceUrl || !skillButtonRepositoryUrl) {
      throw new Error('The active Buff or SkillButton repository module URL is unavailable.');
    }

    const [buffService, skillButtonRepository] = await Promise.all([
      import(/* @vite-ignore */ buffServiceUrl),
      import(/* @vite-ignore */ skillButtonRepositoryUrl),
    ]);
    const button = skillButtonRepository.getSkillButtonById(targetButtonId);
    const targetBuff = buffService.getBuffsByButtonId(targetButtonId).find((buff: {
      id: string;
      name?: string;
      displayName?: string;
    }) => (buff.displayName || buff.name || buff.id) === targetBuffLabel);
    if (!button || !targetBuff) {
      throw new Error(`Cannot seed persisted overrides for ${targetBuffLabel}.`);
    }

    const panelConfig = button.panelConfig ?? { selectedBuff: [...(button.selectedBuff ?? [])] };
    skillButtonRepository.upsertSkillButton({
      ...button,
      panelConfig: {
        ...panelConfig,
        selectedBuff: [...(button.selectedBuff ?? [])],
        globallyDisabledBuffIds: [...(panelConfig.globallyDisabledBuffIds ?? []), targetBuff.id],
        manualDisabledBuffIdsBySegmentKey: {
          ...(panelConfig.manualDisabledBuffIdsBySegmentKey ?? {}),
          'slim-e2e-segment': [targetBuff.id],
        },
        manualBuffStackCountsBySegmentKey: {
          ...(panelConfig.manualBuffStackCountsBySegmentKey ?? {}),
          'slim-e2e-segment': { [targetBuff.id]: 2 },
        },
      },
    });
    return targetBuff.id;
  }, { buttonId, buffLabel });
}

async function readPersistedSkillButton(page: Page, buttonId: string): Promise<{
  selectedBuff: string[];
  buffStackCounts: Record<string, number>;
  globallyDisabledBuffIds: string[];
  manualDisabledBuffIdsBySegmentKey: Record<string, string[]>;
  manualBuffStackCountsBySegmentKey: Record<string, Record<string, number>>;
  targetResistance: Record<string, number>;
}> {
  return page.evaluate(async (targetButtonId) => {
    const moduleUrl = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((name) => /\/src\/core\/repositories\/skillButtonRepository\.ts(?:\?|$)/.test(name));
    if (!moduleUrl) throw new Error('The active SkillButton repository module URL is unavailable.');
    const repository = await import(/* @vite-ignore */ moduleUrl);
    const button = repository.getSkillButtonById(targetButtonId);
    if (!button) throw new Error(`SkillButton ${targetButtonId} is unavailable.`);
    return {
      selectedBuff: button.selectedBuff ?? [],
      buffStackCounts: button.buffStackCounts ?? {},
      globallyDisabledBuffIds: button.panelConfig?.globallyDisabledBuffIds ?? [],
      manualDisabledBuffIdsBySegmentKey: button.panelConfig?.manualDisabledBuffIdsBySegmentKey ?? {},
      manualBuffStackCountsBySegmentKey: button.panelConfig?.manualBuffStackCountsBySegmentKey ?? {},
      targetResistance: button.resistanceConfig?.targetResistance ?? {},
    };
  }, buttonId);
}

type BrowserWorkbenchCommandResult = {
  id: string;
  status: 'pending' | 'running' | 'done' | 'error';
  result?: Record<string, unknown>;
  error?: string;
};

async function enqueueBrowserWorkbenchCommand(
  page: Page,
  command: Record<string, unknown>,
  id: string,
): Promise<string> {
  return page.evaluate(async ({ command: nextCommand, id: commandId }) => {
    const moduleUrl = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((name) => /\/src\/utils\/mainWorkbenchControl\.ts(?:\?|$)/.test(name));
    if (!moduleUrl) throw new Error('The active Main Workbench control module URL is unavailable.');
    const control = await import(/* @vite-ignore */ moduleUrl);
    return control.enqueueMainWorkbenchCommand(nextCommand, 'slim-e2e', commandId).id as string;
  }, { command, id });
}

async function readBrowserWorkbenchCommand(
  page: Page,
  id: string,
): Promise<BrowserWorkbenchCommandResult | null> {
  return page.evaluate(async (commandId) => {
    const moduleUrl = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((name) => /\/src\/utils\/mainWorkbenchControl\.ts(?:\?|$)/.test(name));
    if (!moduleUrl) throw new Error('The active Main Workbench control module URL is unavailable.');
    const control = await import(/* @vite-ignore */ moduleUrl);
    const entry = control.readMainWorkbenchCommandQueue().find((item: { id: string }) => item.id === commandId);
    return entry
      ? {
          id: entry.id,
          status: entry.status,
          result: entry.result,
          error: entry.error,
        }
      : null;
  }, id);
}

async function increaseActiveOperatorPanelAtk(page: Page, buttonId: string): Promise<{
  characterId: string;
  beforeAtk: number;
  afterAtk: number;
}> {
  return page.evaluate(async (targetButtonId) => {
    const moduleUrls = performance.getEntriesByType('resource').map((entry) => entry.name);
    const operatorRepositoryUrl = moduleUrls.find((name) => /\/src\/core\/repositories\/operatorConfigRepository\.ts(?:\?|$)/.test(name));
    const skillButtonRepositoryUrl = moduleUrls.find((name) => /\/src\/core\/repositories\/skillButtonRepository\.ts(?:\?|$)/.test(name));
    if (!operatorRepositoryUrl || !skillButtonRepositoryUrl) {
      throw new Error('The active Operator or SkillButton repository module URL is unavailable.');
    }

    const [operatorRepository, skillButtonRepository] = await Promise.all([
      import(/* @vite-ignore */ operatorRepositoryUrl),
      import(/* @vite-ignore */ skillButtonRepositoryUrl),
    ]);
    const button = skillButtonRepository.getSkillButtonById(targetButtonId);
    if (!button) throw new Error(`SkillButton ${targetButtonId} is unavailable.`);
    const characterId = button.characterId || button.characterName;
    const cache = operatorRepository.getOperatorConfigPageCache();
    const snapshot = cache[characterId];
    if (!snapshot) throw new Error(`Operator snapshot ${characterId} is unavailable.`);

    const nextSnapshot = structuredClone(snapshot);
    const beforeAtk = Number(nextSnapshot.panel.display.atk);
    const increment = Math.max(10_000, Math.abs(beforeAtk) * 10);
    nextSnapshot.panel.calc.operatorAtk += increment;
    nextSnapshot.panel.display.atk += increment;
    nextSnapshot.panel.display.baseAtk += increment;
    nextSnapshot.panel.display.attackDetail.rawAtk += increment;
    nextSnapshot.panel.display.attackDetail.baseAtk += increment;
    nextSnapshot.panel.display.attackDetail.panelAtk += increment;
    operatorRepository.setOperatorConfigPageCache({
      ...cache,
      [characterId]: nextSnapshot,
    });
    return {
      characterId,
      beforeAtk,
      afterAtk: nextSnapshot.panel.display.atk,
    };
  }, buttonId);
}

async function readSkillButtonPanelDiagnostics(page: Page, buttonId: string): Promise<{
  cacheAtk: number | null;
  runtimeAtk: number | null;
}> {
  return page.evaluate(async (targetButtonId) => {
    const moduleUrls = performance.getEntriesByType('resource').map((entry) => entry.name);
    const operatorRepositoryUrl = moduleUrls.find((name) => /\/src\/core\/repositories\/operatorConfigRepository\.ts(?:\?|$)/.test(name));
    const skillButtonRepositoryUrl = moduleUrls.find((name) => /\/src\/core\/repositories\/skillButtonRepository\.ts(?:\?|$)/.test(name));
    if (!operatorRepositoryUrl || !skillButtonRepositoryUrl) {
      throw new Error('The active Operator or SkillButton repository module URL is unavailable.');
    }
    const [operatorRepository, skillButtonRepository] = await Promise.all([
      import(/* @vite-ignore */ operatorRepositoryUrl),
      import(/* @vite-ignore */ skillButtonRepositoryUrl),
    ]);
    const button = skillButtonRepository.getSkillButtonById(targetButtonId);
    if (!button) throw new Error(`SkillButton ${targetButtonId} is unavailable.`);
    const characterId = button.characterId || button.characterName;
    return {
      cacheAtk: operatorRepository.getOperatorConfigPageCache()[characterId]?.panel.display.atk ?? null,
      runtimeAtk: button.runtimeSnapshot?.atk ?? null,
    };
  }, buttonId);
}

test('candidate browser behavior regression', async ({ context, page }) => {
  test.setTimeout(240_000);
  const browserErrors: string[] = [];
  let advertisedPageVersion = EXPECTED_APP_VERSION_LABEL.slice(1);
  let versionCheckRequests = 0;
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE_URL });
  await page.route('**/version.json*', async (route) => {
    versionCheckRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: 1,
        releaseVersion: advertisedPageVersion,
        shellVersion: 'development',
      }),
    });
  });
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
  });

  await test.step('public entry and first installation stay functional', async () => {
    await page.goto(BASE_URL);
    await expect(page.getByRole('textbox', { name: '访问密码', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '先把基础资料装进浏览器', exact: true })).toBeVisible();
    await expect(page.getByText(`${EXPECTED_OPERATOR_COUNT} 位本地干员`, { exact: true })).toBeVisible();
    await expect(page.getByText(`${EXPECTED_WEAPON_COUNT} 件本地武器`, { exact: true })).toBeVisible();
    await expect(page.getByText(`${EXPECTED_IMAGE_COUNT} 个图片资源`, { exact: true })).toBeVisible();

    await page.getByRole('button', { name: '下载完整资料并开始', exact: true }).click();
    await expect(page.getByRole('heading', { name: '建立第一份排轴', exact: true })).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.getByText(EXPECTED_VERSION_LABEL, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.localStorage.getItem('dmg.web.access-lease.v1'))).toBeNull();
  });

  await test.step('version check is automatic while update activation stays manual', async () => {
    await openRoute(page, '/timeline', '选择干员');
    await page.getByRole('button', { name: '打开工作台菜单', exact: true }).click();

    const currentVersionStatus = page.getByRole('button', {
      name: `当前版本 ${EXPECTED_APP_VERSION_LABEL}，已自动检查为最新版本`,
      exact: true,
    });
    await expect(currentVersionStatus).toBeVisible();
    await expect(currentVersionStatus).toBeDisabled();
    await expect(currentVersionStatus.getByText(`当前联网 · ${EXPECTED_APP_VERSION_LABEL}`, { exact: true })).toBeVisible();
    await expect(currentVersionStatus.getByText('已自动检查，是最新版本', { exact: true })).toBeVisible();
    expect(versionCheckRequests).toBeGreaterThan(0);

    advertisedPageVersion = '9.9.9';
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    const updateButton = page.getByRole('button', {
      name: '发现新版本 v9.9.9，点击更新',
      exact: true,
    });
    await expect(updateButton).toBeVisible();
    await expect(updateButton).toBeEnabled();
    await expect(updateButton.getByText('发现新版本 · v9.9.9', { exact: true })).toBeVisible();
    await expect(updateButton.getByText('点击更新，完成后自动重新载入', { exact: true })).toBeVisible();

    advertisedPageVersion = EXPECTED_APP_VERSION_LABEL.slice(1);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(currentVersionStatus).toBeVisible();
    await expect(currentVersionStatus).toBeDisabled();

    await page.getByRole('button', { name: '关闭工作台菜单', exact: true }).click();
  });

  await test.step('all slimming-related lazy routes render without a fallback or alert', async () => {
    const routes = [
      ['/data/operators', '基础数据'],
      ['/data/buffs', 'Sheet-Buff'],
      ['/data/weapons', 'Sheet-Weapon'],
      ['/data/equipments', 'Sheet-Equipment'],
      ['/data/images', '图片资源管理'],
      ['/timeline', '选择干员'],
      ['/timeline/report/presentation', '队伍配置'],
    ] as const;

    for (const [path, heading] of routes) {
      await openRoute(page, path, heading);
    }
  });

  await test.step('all five themes switch live without reloading the mounted app', async () => {
    await page.goto(`${BASE_URL}/#/settings`);
    await expect(page.getByRole('heading', { name: '界面主题', exact: true })).toBeVisible();
    await page.evaluate(() => {
      document.body.dataset.slimE2eThemeMarker = 'mounted';
    });

    const themeIds = [
      'apple-midnight',
      'apple-warm',
      'lieflat-mono',
      'liquid-tide',
      'office-excel',
    ] as const;
    const tokenSignatures: string[] = [];

    for (const themeId of themeIds) {
      const option = page.locator(`.theme-option.is-${themeId}`);
      await option.click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', themeId);
      await expect(page.locator('html')).not.toHaveAttribute('data-theme-pending', themeId);
      await expect(option).toHaveAttribute('aria-checked', 'true');
      expect(await page.evaluate(() => document.body.dataset.slimE2eThemeMarker)).toBe('mounted');
      expect(await page.evaluate(() => window.localStorage.getItem('dmg.appearance.theme.v1'))).toBe(themeId);

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
      tokenSignatures.push(tokenSignature);

      if (themeId === 'liquid-tide') {
        await expect(option).toHaveAttribute('data-liquid-glass-surface', 'true');
      }
    }

    expect(new Set(tokenSignatures).size).toBe(themeIds.length);
    await page.evaluate(() => {
      delete document.body.dataset.slimE2eThemeMarker;
    });
  });

  await test.step('Buff draft saves through browser storage and survives reload', async () => {
    const initialBuffName = 'Slim E2E Buff';
    const overwrittenBuffName = 'slim e2e buff';
    await openRoute(page, '/data/buffs', 'Sheet-Buff');
    await page.getByRole('button', { name: '新建', exact: true }).click();
    const name = page.getByRole('textbox', { name: '组名称', exact: true });
    await expect(name).toHaveValue('新建 Buff 组');
    await name.fill(initialBuffName);
    await page.getByRole('button', { name: '保存', exact: true }).click();
    const initialSavedEntry = page.locator('.buff-sheet-explorer-label').filter({ hasText: initialBuffName });
    await expect(initialSavedEntry).toHaveCount(1);
    await expect(initialSavedEntry).toBeVisible();
    await page.reload();
    await expect(initialSavedEntry).toBeVisible();

    const groupWorkbookRow = page.locator('.damage-sheet-excel-row.is-character').filter({ hasText: initialBuffName });
    await expect(groupWorkbookRow).toHaveCount(1);
    await groupWorkbookRow.locator('.damage-sheet-excel-cell').first().click();
    const formulaNameInput = page.getByRole('textbox', { name: '组名称', exact: true });
    await formulaNameInput.fill(overwrittenBuffName);
    await expect(formulaNameInput).toBeFocused();
    await formulaNameInput.press('ControlOrMeta+S');
    await expect(page.getByRole('heading', { name: '确认覆盖本地 Buff 组', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '确认覆盖', exact: true }).click();

    const savedEntry = page.locator('.buff-sheet-explorer-label').filter({ hasText: overwrittenBuffName });
    await expect(savedEntry).toHaveCount(1);
    await expect(savedEntry).toBeVisible();
    await page.reload();
    await expect(savedEntry).toBeVisible();

    const savedGroupRow = page.locator('.buff-sheet-explorer-row').filter({ hasText: overwrittenBuffName });
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
    const sourceDraft = Object.values(parsedShare.payload).find((value) => value.name === overwrittenBuffName);
    expect(sourceDraft).toBeTruthy();

    await shareModal.getByRole('button', { name: '复制 JSON', exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(shareText);
    const downloadPromise = page.waitForEvent('download');
    await shareModal.getByRole('button', { name: '导出文件', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.json$/);

    await page.locator('.buff-sheet-share-modal-mask').click({ position: { x: 4, y: 4 } });
    await expect(shareModal).toHaveCount(0);
    await page.getByRole('button', { name: '导出', exact: true }).click();
    await expect(shareModal).toBeVisible();

    await shareModal.locator('.buff-sheet-share-modal-tab').filter({ hasText: '导入' }).click();
    const importText = shareModal.locator('.buff-sheet-share-textarea:not(.is-preview)');
    await importText.fill(JSON.stringify({ type: 'not-a-buff-share', payload: {} }));
    await shareModal.getByRole('button', { name: '读取粘贴内容', exact: true }).click();
    await expect(shareModal.getByText('JSON 无效，或不是 Buff 分享文件。', { exact: true })).toBeVisible();

    const validBuffShare = JSON.stringify({
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
    });
    const fileChooserPromise = page.waitForEvent('filechooser');
    await shareModal.getByRole('button', { name: '导入文件', exact: true }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: 'slim-e2e-buff-share.json',
      mimeType: 'application/json',
      buffer: Buffer.from(validBuffShare),
    });
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
    expect(reorderedLabels.indexOf('Slim Imported Buff')).toBeLessThan(reorderedLabels.indexOf(overwrittenBuffName));
    await page.reload();
    await expect(importedEntry).toBeVisible();
    await expect(savedEntry).toBeVisible();
    reorderedLabels = await groupLabels.allTextContents();
    expect(reorderedLabels.indexOf('Slim Imported Buff')).toBeLessThan(reorderedLabels.indexOf(overwrittenBuffName));
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

    await page.getByRole('button', { name: '导出', exact: true }).click();
    const shareModal = page.locator('.buff-sheet-share-modal');
    const sharePreview = shareModal.locator('.buff-sheet-share-textarea.is-preview');
    let shareText = await sharePreview.inputValue();
    const parsedShare = JSON.parse(shareText) as {
      type: string;
      exportedAt: number;
      label: string;
      payload: Record<string, Record<string, unknown>>;
    };
    expect(parsedShare.type).toBe('weapon-library-share.v1');
    expect(parsedShare.label).toBe('Slim E2E Weapon');
    const sourceDraft = Object.values(parsedShare.payload).find((value) => value.name === 'Slim E2E Weapon');
    if (!sourceDraft) throw new Error('Exported Weapon draft is missing from share preview.');
    const sourceSkills = sourceDraft.skills as Record<string, Record<string, unknown>>;
    const sourceSkill3 = sourceSkills.skill3;

    await shareModal.getByRole('button', { name: '导出全部', exact: true }).click();
    const allWeaponShare = JSON.parse(await sharePreview.inputValue()) as {
      payload: Record<string, Record<string, unknown>>;
    };
    expect(Object.keys(allWeaponShare.payload).length).toBeGreaterThan(1);
    expect(Object.values(allWeaponShare.payload).some((value) => value.name === 'Slim E2E Weapon')).toBe(true);
    await shareModal.getByRole('button', { name: '导出当前', exact: true }).click();
    shareText = await sharePreview.inputValue();
    const currentWeaponShare = JSON.parse(shareText) as {
      label: string;
      payload: Record<string, Record<string, unknown>>;
    };
    expect(currentWeaponShare.label).toBe('Slim E2E Weapon');
    expect(Object.keys(currentWeaponShare.payload)).toHaveLength(1);

    await shareModal.getByRole('button', { name: '复制 JSON', exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(shareText);
    const downloadPromise = page.waitForEvent('download');
    await shareModal.getByRole('button', { name: '导出文件', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.json$/);

    await shareModal.locator('.buff-sheet-share-modal-tab').filter({ hasText: '导入' }).click();
    const importText = shareModal.locator('.buff-sheet-share-textarea:not(.is-preview)');
    await importText.fill(JSON.stringify({ type: 'not-a-weapon-share', payload: {} }));
    await shareModal.getByRole('button', { name: '读取粘贴内容', exact: true }).click();
    await expect(shareModal.getByText(
      '导入失败：文件不是有效的武器库分享 JSON。',
      { exact: true },
    )).toBeVisible();

    await importText.fill(JSON.stringify({
      type: 'weapon-library-share.v1',
      exportedAt: Date.now(),
      label: 'Slim E2E Weapon Import',
      payload: {
        'slim-imported-weapon': {
          ...sourceDraft,
          id: 'ignored-inner-id',
          name: 'Slim Imported Weapon',
          skills: {
            ...sourceSkills,
            skill3: {
              ...sourceSkill3,
              levels: {
                ...(sourceSkill3.levels as Record<string, unknown>),
                1: { value: 10, description: 'Main value fixture' },
              },
              effects: {
                first: {
                  name: 'First Weapon Effect',
                  type: 'physicalDmgBonus',
                  category: 'passive',
                  levels: { 1: 10, 9: 90 },
                },
                second: {
                  name: 'Second Weapon Effect',
                  type: 'magicDmgBonus',
                  category: 'condition',
                  levels: { 1: 20, 9: 100 },
                },
              },
            },
          },
        },
      },
    }));
    await shareModal.getByRole('button', { name: '读取粘贴内容', exact: true }).click();
    await expect(shareModal.getByText('名称：Slim E2E Weapon Import', { exact: true })).toBeVisible();
    await expect(shareModal.getByText('武器数：1', { exact: true })).toBeVisible();
    await shareModal.getByRole('button', { name: '确认导入', exact: true }).click();

    const importedEntry = page.locator('.buff-sheet-explorer-label').filter({ hasText: 'Slim Imported Weapon' });
    await expect(importedEntry).toBeVisible();
    await page.reload();
    await expect(importedEntry).toBeVisible();

    const importedWeaponRow = page.locator(
      '[data-weapon-drag-kind="draft"][data-weapon-draft-id="slim-imported-weapon"]',
    );
    await importedWeaponRow.locator('.buff-sheet-explorer-toggle').click();
    const importedSkill3Row = page.locator(
      '[data-weapon-drag-kind="skill"][data-weapon-draft-id="slim-imported-weapon"][data-weapon-skill-key="skill3"]',
    );
    await importedSkill3Row.locator('.buff-sheet-explorer-toggle').click();

    const firstEffectRow = page.locator(
      '[data-weapon-drag-kind="effect"][data-weapon-draft-id="slim-imported-weapon"][data-weapon-skill-key="skill3"][data-weapon-bucket="effect"][data-weapon-effect-key="first"]',
    );
    const secondEffectRow = page.locator(
      '[data-weapon-drag-kind="effect"][data-weapon-draft-id="slim-imported-weapon"][data-weapon-skill-key="skill3"][data-weapon-bucket="effect"][data-weapon-effect-key="second"]',
    );
    const mainValueRow = page.locator(
      '[data-weapon-drag-kind="effect"][data-weapon-draft-id="slim-imported-weapon"][data-weapon-skill-key="skill3"][data-weapon-bucket="value"][data-weapon-effect-key="value"]',
    );
    await expect(firstEffectRow).toContainText('First Weapon Effect');
    await expect(secondEffectRow).toContainText('Second Weapon Effect');
    await expect(mainValueRow).toContainText('value');
    await expect(mainValueRow).not.toHaveClass(/is-draggable/);

    await firstEffectRow.dispatchEvent('contextmenu', {
      button: 2,
      clientX: 240,
      clientY: 180,
    });
    const weaponContextMenu = page.locator('.buff-sheet-context-menu');
    await expect(weaponContextMenu).toBeVisible();
    await expect(weaponContextMenu.getByRole('button')).toHaveText([
      '按 Lv1/Lv9 补全等级',
      /^(?:展开|折叠)等级$/,
      '编辑 Buff',
      '复制效果',
      '删除效果',
    ]);
    await page.keyboard.press('Escape');
    await expect(weaponContextMenu).toHaveCount(0);

    await mainValueRow.scrollIntoViewIfNeeded();
    const mainValueBox = await mainValueRow.boundingBox();
    if (!mainValueBox) throw new Error('Weapon main value is not available for drag guard test.');
    await page.mouse.move(
      mainValueBox.x + mainValueBox.width / 2,
      mainValueBox.y + mainValueBox.height / 2,
    );
    await page.mouse.down();
    await page.waitForTimeout(260);
    await expect(page.locator('.buff-sheet-drag-preview')).toHaveCount(0);
    await page.mouse.up();
    await secondEffectRow.scrollIntoViewIfNeeded();

    const cancelBox = await firstEffectRow.boundingBox();
    if (!cancelBox) throw new Error('Weapon effect is not available for drag cancellation test.');
    await page.mouse.move(cancelBox.x + cancelBox.width / 2, cancelBox.y + cancelBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(cancelBox.x + cancelBox.width / 2 + 12, cancelBox.y + cancelBox.height / 2);
    await page.waitForTimeout(260);
    await expect(page.locator('.buff-sheet-drag-preview')).toHaveCount(0);
    await page.mouse.up();

    const sourceBox = await secondEffectRow.boundingBox();
    const targetBox = await firstEffectRow.boundingBox();
    if (!sourceBox || !targetBox) throw new Error('Weapon effects are not available for drag reorder test.');
    const importedEffectLabels = page.locator(
      '[data-weapon-drag-kind="effect"][data-weapon-draft-id="slim-imported-weapon"][data-weapon-skill-key="skill3"][data-weapon-bucket="effect"] .buff-sheet-explorer-label',
    );
    const startTargetedEffectDrag = async () => {
      await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(260);
      await expect(page.locator('.buff-sheet-drag-preview')).toContainText('Second Weapon Effect');
      await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 5 });
      await expect(firstEffectRow).toHaveClass(/is-drag-target/);
    };

    await startTargetedEffectDrag();
    await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel')));
    await expect(page.locator('.buff-sheet-drag-preview')).toHaveCount(0);
    await page.mouse.up();
    expect(await importedEffectLabels.allTextContents()).toEqual([
      'First Weapon Effect',
      'Second Weapon Effect',
    ]);

    await startTargetedEffectDrag();
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(page.locator('.buff-sheet-drag-preview')).toHaveCount(0);
    await page.mouse.up();
    expect(await importedEffectLabels.allTextContents()).toEqual([
      'First Weapon Effect',
      'Second Weapon Effect',
    ]);

    await startTargetedEffectDrag();
    await page.mouse.up();
    await expect(page.locator('.buff-sheet-drag-preview')).toHaveCount(0);
    expect(await importedEffectLabels.allTextContents()).toEqual([
      'Second Weapon Effect',
      'First Weapon Effect',
    ]);

    // SQLite-backed storage batches writes after 60ms; no page-level draft debounce should be required.
    await page.waitForTimeout(120);
    await page.reload();
    await importedWeaponRow.locator('.buff-sheet-explorer-toggle').click();
    await importedSkill3Row.locator('.buff-sheet-explorer-toggle').click();
    expect(await importedEffectLabels.allTextContents()).toEqual([
      'Second Weapon Effect',
      'First Weapon Effect',
    ]);
  });

  await test.step('Equipment draft saves through browser storage and survives reload', async () => {
    const userImageFileName = 'slim-equipment-user-image.png';
    const userImageRelativePath = `assets/images/${userImageFileName}`;
    const addedUserImageFileName = 'slim-equipment-added-image.png';
    const addedUserImageRelativePath = `assets/images/${addedUserImageFileName}`;
    await openRoute(page, '/data/images', '图片资源管理');
    const imageFileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '导入', exact: true }).click();
    const imageFileChooser = await imageFileChooserPromise;
    await imageFileChooser.setFiles({
      name: userImageFileName,
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
    });
    await expect(page.getByRole('status')).toHaveText('导入成功');
    await expect(page.getByText(userImageFileName, { exact: true })).toBeVisible();

    await openRoute(page, '/data/equipments', 'Sheet-Equipment');
    await page.getByRole('button', { name: '新建', exact: true }).click();
    const name = page.locator('input[value="新建装备"]');
    await expect(name).toHaveCount(1);
    await name.fill('Slim E2E Equipment');
    const createdWorkbookRow = page
      .locator('input[value="Slim E2E Equipment"]')
      .locator('xpath=ancestor::*[@data-equipment-row-key]');
    await createdWorkbookRow.locator('.is-col-description').click();
    const equipmentImageSearch = page.getByPlaceholder('搜索图片：文件名 / baseName / 路径 / URL');
    await equipmentImageSearch.click();
    await equipmentImageSearch.fill(userImageFileName);
    const userImageOption = page.locator('.weapon-sheet-image-option').filter({
      hasText: userImageFileName,
    });
    await expect(userImageOption).toHaveCount(1);
    await userImageOption.click();
    const equipmentImagePreview = page.locator('.weapon-sheet-image-preview');
    await expect(equipmentImagePreview).toBeVisible();
    const initialPreviewUrl = await equipmentImagePreview.getAttribute('src');
    expect(initialPreviewUrl).toMatch(/^blob:/);

    const replacementUrls = await upsertGeneratedWebImage(page, userImageRelativePath, '#ff0000', 2);
    expect(replacementUrls.beforeUrl).toBe(initialPreviewUrl);
    expect(replacementUrls.afterUrl).not.toBe(initialPreviewUrl);
    await expect.poll(() => equipmentImagePreview.getAttribute('src')).not.toBe(initialPreviewUrl);
    const replacementPreviewUrl = await equipmentImagePreview.getAttribute('src');
    expect(replacementPreviewUrl).toMatch(/^blob:/);
    expect(await page.evaluate(async (url) => {
      if (!url) return false;
      try {
        return (await fetch(url)).ok;
      } catch {
        return false;
      }
    }, replacementPreviewUrl)).toBe(true);

    await equipmentImageSearch.click();
    await equipmentImageSearch.fill(userImageFileName);
    await expect(userImageOption).toHaveCount(1);
    await expect(userImageOption.locator('img')).toHaveAttribute('src', replacementPreviewUrl!);
    await page.locator('.weapon-sheet-image-option-clear').click();

    await deleteWebImage(page, userImageRelativePath);
    await equipmentImageSearch.click();
    await equipmentImageSearch.fill(userImageFileName);
    await expect(userImageOption).toHaveCount(0);

    await upsertGeneratedWebImage(page, addedUserImageRelativePath, '#0000ff', 3);
    await equipmentImageSearch.fill(addedUserImageFileName);
    const addedUserImageOption = page.locator('.weapon-sheet-image-option').filter({
      hasText: addedUserImageFileName,
    });
    await expect(addedUserImageOption).toHaveCount(1);
    await addedUserImageOption.click();
    await expect(equipmentImagePreview).toBeVisible();
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByRole('heading', { name: '确认保存装备库', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '确认保存', exact: true }).click();
    await expect(page.locator('.equipment-sheet-save-status')).toHaveText('已保存');
    const savedEntry = page.locator('.buff-sheet-explorer-label').filter({
      hasText: 'Slim E2E Equipment',
    });
    await expect(savedEntry).toHaveCount(1);
    await expect(savedEntry).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: /^\[\+\] 潮涌 \d+$/ }).click();
    await expect(savedEntry).toBeVisible();
    await savedEntry.click();
    await expect(page.locator('.weapon-sheet-image-slot')).not.toHaveClass(/is-broken/);
    await expect(page.locator('.weapon-sheet-image-preview')).toHaveAttribute('src', /^blob:/);

    await page.getByRole('button', { name: '导出', exact: true }).click();
    const shareModal = page.locator('.buff-sheet-share-modal');
    const sharePreview = shareModal.locator('.buff-sheet-share-textarea.is-preview');
    let shareText = await sharePreview.inputValue();
    const parsedShare = JSON.parse(shareText) as {
      type: string;
      exportedAt: number;
      label: string;
      payload: Record<string, Record<string, unknown>>;
    };
    expect(parsedShare.type).toBe('equipment-library-share.v1');
    const sourceGearSet = Object.values(parsedShare.payload).find((value) => {
      const equipments = value.equipments as Record<string, Record<string, unknown>> | undefined;
      return Object.values(equipments ?? {}).some((equipment) => equipment.name === 'Slim E2E Equipment');
    });
    if (!sourceGearSet) throw new Error('Exported Equipment gear set is missing from share preview.');
    const sourceEquipment = Object.values(
      sourceGearSet.equipments as Record<string, Record<string, unknown>>,
    ).find((equipment) => equipment.name === 'Slim E2E Equipment');
    if (!sourceEquipment) throw new Error('Exported Equipment item is missing from share preview.');
    expect(sourceEquipment.imgUrl).toBe(addedUserImageRelativePath);

    await shareModal.getByRole('button', { name: '导出全部', exact: true }).click();
    const allEquipmentShare = JSON.parse(await sharePreview.inputValue()) as {
      payload: Record<string, Record<string, unknown>>;
    };
    expect(Object.keys(allEquipmentShare.payload).length).toBeGreaterThan(1);
    expect(Object.values(allEquipmentShare.payload).some((gearSet) => Object.values(
      gearSet.equipments as Record<string, Record<string, unknown>> ?? {},
    ).some((equipment) => equipment.name === 'Slim E2E Equipment'))).toBe(true);
    await shareModal.getByRole('button', { name: '导出当前', exact: true }).click();
    shareText = await sharePreview.inputValue();
    const currentEquipmentShare = JSON.parse(shareText) as {
      payload: Record<string, Record<string, unknown>>;
    };
    expect(Object.keys(currentEquipmentShare.payload)).toHaveLength(1);
    expect(Object.values(currentEquipmentShare.payload).some((gearSet) => Object.values(
      gearSet.equipments as Record<string, Record<string, unknown>> ?? {},
    ).some((equipment) => equipment.name === 'Slim E2E Equipment'))).toBe(true);

    await shareModal.getByRole('button', { name: '复制 JSON', exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(shareText);
    const downloadPromise = page.waitForEvent('download');
    await shareModal.getByRole('button', { name: '导出文件', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.json$/);
    expect(await download.failure()).toBeNull();

    await shareModal.locator('.buff-sheet-share-modal-tab').filter({ hasText: '导入' }).click();
    const importText = shareModal.locator('.buff-sheet-share-textarea:not(.is-preview)');
    await importText.fill(JSON.stringify({ type: 'not-an-equipment-share', payload: {} }));
    await shareModal.getByRole('button', { name: '读取粘贴内容', exact: true }).click();
    await expect(shareModal.getByText(
      '导入失败：文件不是有效的装备库分享 JSON。',
      { exact: true },
    )).toBeVisible();

    await importText.fill(JSON.stringify({
      type: 'equipment-library-share.v1',
      payload: {
        broken: null,
      },
    }));
    await shareModal.getByRole('button', { name: '读取粘贴内容', exact: true }).click();
    await expect(shareModal.getByText(
      'JSON 中没有可导入的有效套装。',
      { exact: true },
    )).toBeVisible();

    await importText.fill(JSON.stringify({
      type: 'equipment-library-share.v1',
      exportedAt: Date.now(),
      label: 'Slim E2E Equipment Import',
      payload: {
        'gear-set-slim-imported': {
          ...sourceGearSet,
          gearSetId: 'gear-set-slim-imported',
          name: 'Slim Imported Equipment Set',
          equipments: {
            'equipment-slim-imported': {
              ...sourceEquipment,
              equipmentId: 'equipment-slim-imported',
              name: 'Slim Imported Equipment',
              effects: {
                effect1: {
                  effectId: 'effect1',
                  label: 'Slim Effect Summary',
                  typeKey: 'physicalDmgBonus',
                  category: 'buff',
                  levels: { '0': 0.1, '1': 0.2, '2': 0.3, '3': 0.4 },
                  unit: 'percent',
                  raw: '物理伤害：+10%/+20%/+30%/+40%',
                },
              },
            },
          },
        },
      },
    }));
    await shareModal.getByRole('button', { name: '读取粘贴内容', exact: true }).click();
    await expect(shareModal.getByText('名称：Slim E2E Equipment Import', { exact: true })).toBeVisible();
    await expect(shareModal.getByText('套装数：1', { exact: true })).toBeVisible();
    await shareModal.getByRole('button', { name: '确认导入', exact: true }).click();

    const importedSetRow = page.locator('.buff-sheet-explorer-row').filter({
      hasText: 'Slim Imported Equipment Set',
    });
    const importedEntry = page.locator('.buff-sheet-explorer-label').filter({
      hasText: /^Slim Imported Equipment$/,
    });
    await expect(importedSetRow).toHaveCount(1);
    await expect(importedSetRow).toHaveClass(/is-active/);
    await importedSetRow.locator('.buff-sheet-explorer-toggle').click();
    await expect(importedEntry).toBeVisible();

    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByRole('heading', { name: '确认保存装备库', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '确认保存', exact: true }).click();
    await expect(page.locator('.equipment-sheet-save-status')).toHaveText('已保存');
    await page.reload();
    await expect(importedSetRow).toHaveCount(1);
    await importedSetRow.locator('.buff-sheet-explorer-toggle').click();
    await expect(importedEntry).toBeVisible();
    await importedEntry.click();

    const effectSummaryCell = page.locator('[data-equipment-row-key^="effect-"] .is-col-description').first();
    await expect(effectSummaryCell).toBeVisible();
    await expect(effectSummaryCell.locator('input, select')).toHaveCount(0);
    await expect(effectSummaryCell).toContainText('/');
    await effectSummaryCell.click();

    await page.getByRole('button', { name: '导出', exact: true }).click();
    const selectedEffectShare = JSON.parse(await page
      .locator('.buff-sheet-share-modal .buff-sheet-share-textarea.is-preview')
      .inputValue()) as {
        label: string;
        payload: Record<string, unknown>;
      };
    expect(selectedEffectShare.label).toBe('Slim Imported Equipment Set');
    expect(Object.keys(selectedEffectShare.payload)).toEqual(['gear-set-slim-imported']);
    await page.getByRole('button', { name: '关闭', exact: true }).click();

    const importedWorkbookRow = page
      .locator('input[value="Slim Imported Equipment"]')
      .locator('xpath=ancestor::*[@data-equipment-row-key]');
    await expect(importedWorkbookRow).toBeVisible();
    await importedWorkbookRow.locator('.is-col-name').click();
    await expect(page.locator('.damage-sheet-formula-address')).not.toHaveText('-');
    await importedWorkbookRow.click({ button: 'right' });
    await page.getByRole('button', { name: '复制装备', exact: true }).click();
    await expect(page.locator('.damage-sheet-formula-address')).toHaveText('-');
    await expect(page
      .locator('input[value="Slim Imported Equipment 副本"]')
      .locator('xpath=ancestor::*[@data-equipment-row-key]'))
      .toHaveClass(/is-active/);
  });

  await test.step('duplicate Buff type editors stay retired while ordinary equipment remains editable', async () => {
    await openRoute(page, '/data/buffs', 'Sheet-Buff');
    const savedBuff = page.locator('.buff-sheet-explorer-label').filter({ hasText: /^slim e2e buff$/i });
    await expect(savedBuff).toHaveCount(1);
    await savedBuff.click();
    const buffItemRow = page.locator('.damage-sheet-excel-row.is-button').filter({ hasText: '自定义项 01' });
    await expect(buffItemRow).toHaveCount(1);
    await buffItemRow.getByRole('button', { name: '[+]', exact: true }).click();
    const buffEffectRow = page.locator('.damage-sheet-excel-row.is-data');
    await expect(buffEffectRow).toHaveCount(1);
    await buffEffectRow.dblclick();
    const buffDialog = page.getByRole('dialog', { name: 'Buff 编辑器' });
    await buffDialog.getByRole('combobox', { name: 'typeKey' }).selectOption('fireFragile');
    await buffDialog.getByRole('button', { name: '关闭', exact: true }).click();
    const buffTypeCell = buffEffectRow.locator('.damage-sheet-excel-cell').nth(4);
    await expect(buffTypeCell).toHaveText('灼热易伤 · fireFragile');
    await buffTypeCell.click();
    await expect(page.locator('.damage-sheet-formula-bar .buff-sheet-formula-type-search')).toHaveCount(0);
    await expect(page.locator('.damage-sheet-formula-bar select')).toHaveCount(0);
    await expect(page.locator('.damage-sheet-formula-bar .damage-sheet-formula-value')).toHaveText(
      '灼热易伤 · fireFragile',
    );

    await openRoute(page, '/data/weapons', 'Sheet-Weapon');
    const importedWeapon = page.locator('.buff-sheet-explorer-label').filter({
      hasText: /^Slim Imported Weapon$/,
    });
    await expect(importedWeapon).toHaveCount(1);
    await importedWeapon.click();
    const weaponEffectRow = page.locator('.weapon-sheet-row-effect').filter({
      hasText: 'First Weapon Effect',
    });
    await expect(weaponEffectRow).toHaveCount(1);
    await weaponEffectRow.dblclick();
    const weaponDialog = page.getByRole('dialog', { name: 'Buff 编辑器' });
    await weaponDialog.getByRole('combobox', { name: 'typeKey' }).selectOption('fireVulnerability');
    await weaponDialog.getByRole('button', { name: '关闭', exact: true }).click();
    const weaponTypeCell = weaponEffectRow.locator('.damage-sheet-excel-cell').nth(4);
    await expect(weaponTypeCell).toHaveText('灼热脆弱 · fireVulnerability');
    await weaponTypeCell.click();
    const weaponFormula = page.locator('.damage-sheet-formula-bar');
    await expect(weaponFormula.locator('.buff-sheet-formula-type-search')).toHaveCount(0);
    await expect(weaponFormula.locator('select')).toHaveCount(0);
    await expect(weaponFormula.locator('input[readonly]')).toHaveValue('灼热脆弱 · fireVulnerability');

    await openRoute(page, '/data/equipments', 'Sheet-Equipment');
    await page.getByRole('button', { name: /^\[\+\] 旧锋 \d+$/ }).click();
    const threePieceRow = page.locator(
      '[data-equipment-row-key="three-piece-buff-gear-set-jiu-feng-effect1"]',
    );
    await expect(threePieceRow).toBeVisible();
    await threePieceRow.dblclick();
    const equipmentDialog = page.getByRole('dialog', { name: 'Buff 编辑器' });
    await equipmentDialog.getByRole('combobox', { name: 'typeKey' }).selectOption('fireVulnerability');
    await equipmentDialog.getByRole('button', { name: '关闭', exact: true }).click();
    const threePieceTypeCell = threePieceRow.locator('.is-col-effectKey');
    await expect(threePieceTypeCell).toHaveText('灼热脆弱 · fireVulnerability');
    await expect(threePieceTypeCell.locator('select')).toHaveCount(0);
    await threePieceTypeCell.click();
    const equipmentFormula = page.locator('.damage-sheet-formula-bar');
    await expect(equipmentFormula.locator('.buff-sheet-formula-type-search')).toHaveCount(0);
    await expect(equipmentFormula.locator('select')).toHaveCount(0);
    await expect(equipmentFormula.locator('input[readonly]')).toHaveValue('灼热脆弱 · fireVulnerability');

    await page.getByRole('button', { name: /^\[\+\] 旧锋装甲 护甲$/ }).click();
    const ordinaryTypeCell = page.locator(
      '[data-equipment-row-key="effect-gear-set-jiu-feng-equipment-jf-5-effect3"] .is-col-effectKey',
    );
    await expect(ordinaryTypeCell.locator('select')).toHaveCount(1);
    await ordinaryTypeCell.click();
    await expect(equipmentFormula.locator('.buff-sheet-formula-type-search')).toHaveCount(1);
    await expect(equipmentFormula.locator('select')).toHaveCount(1);
  });

  await test.step('Operator draft saves through browser storage and survives reload', async () => {
    const operatorImageFileName = 'slim-operator-user-image.png';
    const operatorImageRelativePath = `assets/images/${operatorImageFileName}`;
    await openRoute(page, '/data/images', '图片资源管理');
    const operatorImageFileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '导入', exact: true }).click();
    const operatorImageFileChooser = await operatorImageFileChooserPromise;
    await operatorImageFileChooser.setFiles({
      name: operatorImageFileName,
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
    });
    await expect(page.getByRole('status')).toHaveText('导入成功');

    await openRoute(page, '/data/operators', '基础数据');
    await page.getByRole('button', { name: '新建', exact: true }).click();
    const basicFields = page.locator('.operator-draft-basic-grid');
    await basicFields.getByLabel('名称', { exact: true }).fill('Slim E2E Operator');
    await basicFields.getByLabel('ID', { exact: true }).fill('slim-e2e-operator');

    const avatarPathInput = page.getByPlaceholder('搜索头像 URL');
    await avatarPathInput.fill(operatorImageFileName);
    const avatarPathOption = avatarPathInput
      .locator('xpath=..')
      .locator('.operator-draft-searchable-option')
      .filter({ hasText: operatorImageRelativePath });
    await expect(avatarPathOption).toHaveCount(1);
    await avatarPathOption.click();
    await expect(avatarPathInput).toHaveValue(operatorImageRelativePath);
    await expect(page.locator('.operator-draft-avatar')).toHaveAttribute('src', /^blob:/);

    await page.getByRole('button', { name: '新增技能', exact: true }).click();
    const skillIconPathInput = page.getByPlaceholder('搜索技能图标 URL');
    await skillIconPathInput.fill(operatorImageFileName);
    const skillIconPathOption = skillIconPathInput
      .locator('xpath=..')
      .locator('.operator-draft-searchable-option')
      .filter({ hasText: operatorImageRelativePath });
    await expect(skillIconPathOption).toHaveCount(1);
    await skillIconPathOption.click();
    await expect(skillIconPathInput).toHaveValue(operatorImageRelativePath);
    await expect(page.locator('.operator-draft-skill-hero-icon')).toHaveAttribute('src', /^blob:/);

    const skillForm = page.locator('.operator-draft-skill-form');
    await skillForm.getByLabel('技能名', { exact: true }).fill('Slim E2E Skill');
    const skillButtonType = skillForm.locator('label').filter({ hasText: '按钮类型' }).locator('select');
    await skillButtonType.selectOption('E');
    const initialHitCount = await page.locator('.operator-draft-hit-item').count();
    await page.getByRole('button', { name: '新增 Hit', exact: true }).click();
    await expect(page.locator('.operator-draft-hit-item')).toHaveCount(initialHitCount + 1);
    const hitDetail = page.locator('.operator-draft-hit-detail-card');
    await hitDetail.getByLabel('名称', { exact: true }).fill('Slim E2E Hit');
    const hitM3 = hitDetail.getByLabel('M3', { exact: true });
    await hitM3.fill('2.75');
    await hitM3.press('Enter');
    const hitElement = hitDetail.locator('label').filter({ hasText: '伤害属性' }).locator('select');
    const hitSkillType = hitDetail.locator('label').filter({ hasText: '技能乘区' }).locator('select');
    await hitElement.selectOption('fire');
    await hitSkillType.selectOption('E');

    const buffPanel = page.locator('.operator-draft-buff-panel');
    await buffPanel.getByRole('button', { name: '新增', exact: true }).click();
    await expect(buffPanel.locator('.operator-draft-buff-item')).toHaveCount(1);
    const buffDrawer = page.getByRole('dialog', { name: 'Buff 编辑器', exact: true });
    await expect(buffDrawer).toBeVisible();
    await buffDrawer.getByLabel('名称', { exact: true }).fill('Slim E2E Operator Buff');
    await buffDrawer.locator('label').filter({ hasText: '业务类型' }).locator('select').selectOption('countable');
    await buffDrawer.locator('label').filter({ hasText: /^typeKey/ }).locator('select').selectOption('fireVulnerability');
    const buffValue = buffDrawer.getByLabel('数值', { exact: true });
    await buffValue.fill('0.25');
    await buffValue.press('Enter');
    const maxStacks = buffDrawer.getByLabel('最大层数', { exact: true });
    await maxStacks.fill('3');
    await maxStacks.press('Enter');
    await buffDrawer.getByRole('button', { name: '完成', exact: true }).click();
    await expect(buffPanel.locator('.operator-draft-buff-item').first()).toContainText('Slim E2E Operator Buff');

    await page.getByRole('button', { name: '保存到本地', exact: true }).click();

    const localDrafts = page.getByRole('combobox', { name: '载入本地草稿', exact: true });
    const savedOption = localDrafts.locator('option[value="slim-e2e-operator"]');
    await expect(savedOption).toHaveText('slim-e2e-operator · Slim E2E Operator');
    await page.reload();
    await expect(savedOption).toHaveText('slim-e2e-operator · Slim E2E Operator');
    await expect(avatarPathInput).toHaveValue(operatorImageRelativePath);
    await expect(skillIconPathInput).toHaveValue(operatorImageRelativePath);
    await expect(page.locator('.operator-draft-avatar')).toHaveAttribute('src', /^blob:/);
    await expect(page.locator('.operator-draft-skill-hero-icon')).toHaveAttribute('src', /^blob:/);
    await expect(skillForm.getByLabel('技能名', { exact: true })).toHaveValue('Slim E2E Skill');
    await expect(skillButtonType).toHaveValue('E');
    const savedHit = page.locator('.operator-draft-hit-item').filter({ hasText: 'Slim E2E Hit' });
    await expect(savedHit).toHaveCount(1);
    await savedHit.click();
    await expect(hitDetail.getByLabel('M3', { exact: true })).toHaveValue('2.75');
    await expect(hitElement).toHaveValue('fire');
    await expect(hitSkillType).toHaveValue('E');
    await expect(buffPanel.locator('.operator-draft-buff-item').filter({
      hasText: 'Slim E2E Operator Buff',
    })).toHaveCount(1);

    await page.getByRole('button', { name: '分享库', exact: true }).click();
    const operatorShareModal = page.locator('.operator-draft-share-modal');
    const operatorSharePreview = operatorShareModal.locator('.operator-draft-share-textarea');
    const currentOperatorShare = JSON.parse(await operatorSharePreview.inputValue()) as {
      type: string;
      payload: Record<string, Record<string, unknown>>;
    };
    expect(currentOperatorShare.type).toBe('operator-library-share.v1');
    const sourceOperatorDraft = currentOperatorShare.payload['slim-e2e-operator'];
    expect(sourceOperatorDraft).toBeTruthy();
    expect(sourceOperatorDraft.avatarUrl).toBe(operatorImageRelativePath);
    const sourceOperatorSkills = sourceOperatorDraft.skills as Record<string, Record<string, unknown>>;
    const sourceOperatorSkill = Object.values(sourceOperatorSkills)[0];
    expect(sourceOperatorSkill?.iconUrl).toBe(operatorImageRelativePath);
    expect(sourceOperatorSkill?.displayName).toBe('Slim E2E Skill');
    expect(sourceOperatorSkill?.buttonType).toBe('E');
    const sourceOperatorHits = sourceOperatorSkill?.hitMeta as Record<string, Record<string, unknown>>;
    expect(Object.values(sourceOperatorHits).some((hit) => (
      hit.displayName === 'Slim E2E Hit'
      && (hit.levels as Record<string, number>)?.M3 === 2.75
      && hit.element === 'fire'
      && hit.skillType === 'E'
    ))).toBe(true);
    const sourceOperatorBuffs = sourceOperatorDraft.buffs as Record<string, {
      effects?: Record<string, Record<string, unknown>>;
    }>;
    const sourceOperatorBuff = Object.values(sourceOperatorBuffs)
      .flatMap((group) => Object.values(group.effects ?? {}))
      .find((effect) => effect.name === 'Slim E2E Operator Buff');
    expect(sourceOperatorBuff).toMatchObject({
      type: 'fireVulnerability',
      value: 0.25,
      maxStacks: 3,
    });

    const operatorShareFileChooserPromise = page.waitForEvent('filechooser');
    await operatorShareModal.getByRole('button', { name: '导入分享', exact: true }).click();
    const operatorShareFileChooser = await operatorShareFileChooserPromise;
    await operatorShareFileChooser.setFiles({
      name: 'slim-operator-share.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({
        type: 'operator-library-share.v1',
        exportedAt: Date.now(),
        label: 'Slim Operator Import',
        payload: {
          'slim-imported-operator': {
            ...sourceOperatorDraft,
            id: 'inner-id-must-lose',
            name: 'Slim Imported Operator',
          },
        },
      })),
    });
    await expect(page.getByRole('heading', { name: '确认导入干员分享', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '确认导入', exact: true }).click();

    const importedOperatorOption = localDrafts.locator('option[value="slim-imported-operator"]');
    await expect(importedOperatorOption).toHaveText('slim-imported-operator · Slim Imported Operator');
    await expect(localDrafts).toHaveValue('slim-imported-operator');

    await page.getByRole('button', { name: '分享库', exact: true }).click();
    await operatorShareModal.getByRole('button', { name: '导出全部', exact: true }).click();
    const allOperatorShare = JSON.parse(await operatorSharePreview.inputValue()) as {
      payload: Record<string, Record<string, unknown>>;
    };
    expect(Object.keys(allOperatorShare.payload)).toEqual(expect.arrayContaining([
      'slim-e2e-operator',
      'slim-imported-operator',
    ]));
    expect(allOperatorShare.payload['slim-imported-operator'].id).toBe('slim-imported-operator');
    await operatorShareModal.getByRole('button', { name: '关闭', exact: true }).click();
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

    await test.step('新建存档会创建独立 SQLite 并保留原存档', async () => {
      const previousTimelineId = await page.evaluate(() => (
        window.sessionStorage.getItem('dmg.active-timeline-document-id')
      ));
      expect(previousTimelineId).toBeTruthy();

      await page.getByRole('button', { name: '队伍', exact: true }).click();
      await expect(page.getByRole('heading', { name: '选择干员', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '继续排轴', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '新建存档', exact: true }).click();
      await expect(page.locator('.canvas-container')).toBeVisible();

      const detachedWorkspace = await page.evaluate(async (originalTimelineId) => {
        const activeTimelineId = window.sessionStorage.getItem('dmg.active-timeline-document-id');
        const moduleUrl = performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .find((name) => /\/src\/agentKernel\/timelineRepository\/localTimelineClient\.ts(?:\?|$)/.test(name));
        if (!moduleUrl) throw new Error('Timeline repository module URL is unavailable.');
        const repositoryModule = await import(/* @vite-ignore */ moduleUrl);
        const repository = repositoryModule.createTimelineRepositoryClient();
        const [documents, originalWorkNodes] = await Promise.all([
          repository.listDocuments(),
          repository.listWorkNodes(originalTimelineId),
        ]);
        return {
          activeTimelineId,
          originalPreserved: documents.some((document: { id: string }) => document.id === originalTimelineId),
          detachedExists: documents.some((document: { id: string }) => document.id === activeTimelineId),
          originalCheckpointCount: originalWorkNodes.length,
        };
      }, previousTimelineId);

      expect(detachedWorkspace.activeTimelineId).toBeTruthy();
      expect(detachedWorkspace.activeTimelineId).not.toBe(previousTimelineId);
      expect(detachedWorkspace.originalPreserved).toBe(true);
      expect(detachedWorkspace.detachedExists).toBe(true);
      expect(detachedWorkspace.originalCheckpointCount).toBeGreaterThan(0);
    });

    await expect(page.getByRole('button', { name: '表格', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '伤害表', exact: true })).toHaveCount(0);
    const calculateDamageButton = page.getByRole('button', { name: '计算伤害', exact: true });
    await expect(calculateDamageButton).toBeVisible();
    await calculateDamageButton.click();
    await expect(page).toHaveURL(/#\/timeline\/report\/presentation$/);
    await expect(page.getByRole('heading', { name: '队伍配置', exact: true })).toBeVisible();
    const pptToolbarGeometry = await page.locator('.report-ppt-toolbar').evaluate((toolbar) => {
      const toolbarRect = toolbar.getBoundingClientRect();
      const firstButtonRect = toolbar.querySelector('button')?.getBoundingClientRect();
      const style = getComputedStyle(toolbar);
      return {
        height: toolbarRect.height,
        paddingLeft: style.paddingLeft,
        firstButtonOffset: firstButtonRect ? firstButtonRect.left - toolbarRect.left : -1,
      };
    });
    expect(pptToolbarGeometry).toEqual({
      height: 44,
      paddingLeft: '70px',
      firstButtonOffset: 70,
    });
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await expect(page.locator('.canvas-container')).toBeVisible();

    const workbenchDrawerTrigger = page.locator('.canvas-bottom-zone-left > .workbench-top-trigger');
    await workbenchDrawerTrigger.click();
    await expect(page.locator('.workbench-top-zone')).toHaveClass(/is-open/);
    await expect(page.getByRole('button', { name: '计算侧栏', exact: true })).toHaveCount(0);
    await workbenchDrawerTrigger.click();

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

    await test.step('Canvas command queue settles both successful and failed commands', async () => {
      const successCommandId = `slim-e2e-refresh-${Date.now()}`;
      await enqueueBrowserWorkbenchCommand(page, { op: 'refreshSnapshot' }, successCommandId);
      await expect.poll(() => readBrowserWorkbenchCommand(page, successCommandId)).toMatchObject({
        id: successCommandId,
        status: 'done',
        result: {
          refreshed: true,
          selectedCharacterCount: 4,
          skillButtonCount: 1,
        },
      });

      const errorCommandId = `slim-e2e-error-${Date.now()}`;
      await enqueueBrowserWorkbenchCommand(page, {
        op: 'setTargetResistance',
        buttonId: 'missing-slim-e2e-button',
        targetResistance: { physicalResistance: 20 },
      }, errorCommandId);
      await expect.poll(() => readBrowserWorkbenchCommand(page, errorCommandId)).toMatchObject({
        id: errorCommandId,
        status: 'error',
        error: '技能按钮不存在: missing-slim-e2e-button',
      });
    });

    const timelineTheme = await page.locator('html').getAttribute('data-theme');
    expect(timelineTheme).toBeTruthy();

    await test.step('OperatorConfig selects real equipment, entry levels, and a three-piece set', async () => {
      await page.locator('.workbench-bottom-nav-button').filter({ hasText: '干员配置' }).click();
      await expect(page.locator('.operator-config-page-root')).toBeVisible();

      const selectEquipment = async (
        circleSelector: string,
        pickerHeading: string,
        equipmentName: string,
      ) => {
        const circle = page.locator(circleSelector);
        await circle.click();
        const picker = page.locator('.operator-config-page-picker-modal');
        await expect(picker.getByRole('heading', { name: pickerHeading, exact: true })).toBeVisible();
        const name = picker.getByText(equipmentName, { exact: true });
        await name.locator('xpath=ancestor::button[1]').click();
        await expect(picker).toHaveCount(0);
        await expect(circle.locator('img')).toHaveAttribute('alt', equipmentName);
      };

      await selectEquipment(
        '.operator-config-page-equip-circle--1',
        '选择护甲',
        '旧锋装甲',
      );
      const armorEntryLevel = page.locator('button[aria-label="armor 词条 1 档位 L2"]');
      await expect(armorEntryLevel).toBeEnabled();
      await armorEntryLevel.click();
      await expect(armorEntryLevel).toHaveAttribute('aria-pressed', 'true');

      await selectEquipment(
        '.operator-config-page-equip-circle--2',
        '选择配件',
        '旧锋刺刃',
      );
      await selectEquipment(
        '.operator-config-page-equip-circle--4',
        '选择护手',
        '旧锋手甲',
      );

      await expect(page.locator('.operator-config-page-equip-set-empty')).toHaveCount(0);
      await expect(page.locator('.operator-config-page-equip-set-line').first()).toBeVisible();
      await page.getByRole('button', { name: '面板数据', exact: true }).click();
      const panelDetail = page.locator('.operator-config-page-panel-detail-content');
      await expect(panelDetail).toContainText('旧锋装甲');
      await expect(panelDetail).toContainText('三件套效果');
      await expect(panelDetail).toContainText('旧锋');
      await page.locator('.operator-config-page-panel-detail-close').click();

      await page.evaluate(() => {
        window.location.hash = '#/timeline';
      });
      await expect(page.locator('.canvas-container')).toBeVisible();
      await page.locator('.workbench-bottom-nav-button').filter({ hasText: '干员配置' }).click();
      await expect(page.locator('.operator-config-page-equip-circle--1 img'))
        .toHaveAttribute('alt', '旧锋装甲');
      await expect(page.locator('button[aria-label="armor 词条 1 档位 L2"]'))
        .toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('.operator-config-page-equip-set-line').first()).toBeVisible();
      await page.evaluate(() => {
        window.location.hash = '#/timeline';
      });
      await expect(page.locator('.canvas-container')).toBeVisible();
    });

    await page.locator('.workbench-bottom-nav-button').filter({ hasText: '批量 Buff' }).click();
    await expect(page.locator('.buff-batch-edit-workbench')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', timelineTheme!);

    const batchSkillButton = page.locator('.buff-edit-skill-button');
    const batchCanvas = page.locator('.buff-edit-canvas');
    const selectionCounter = page.locator('.buff-edit-selection-counter');
    await expect(batchSkillButton).toHaveCount(1);
    await expect(selectionCounter).toHaveText('已选 0/1');

    await test.step('批量 Buff 角色快捷选择、编辑模式和键盘取消路径可用', async () => {
      const wolfQuickSelect = page.getByRole('button', { name: '选择干员按钮 狼卫', exact: true });
      await wolfQuickSelect.click();
      await expect(selectionCounter).toHaveText('已选 1/1');
      await wolfQuickSelect.click();
      await expect(selectionCounter).toHaveText('已选 0/1');

      const editModeButton = page.locator('.buff-edit-mode-button');
      await editModeButton.click();
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
      await expect(candidateModal.getByText('异常状态区', { exact: true }).first()).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(candidateModal).toHaveCount(0);
      await expect(page.getByRole('heading', { name: '增加 Buff', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('heading', { name: '增加 Buff', exact: true })).toHaveCount(0);
    });

    await test.step('批量 Buff 普通点击支持选择、取消和清空', async () => {
      await batchSkillButton.click();
      await expect(selectionCounter).toHaveText('已选 1/1');
      await batchSkillButton.click();
      await expect(selectionCounter).toHaveText('已选 0/1');
      await batchSkillButton.click();
      await page.locator('.buff-edit-clear-selection-button').click();
      await expect(selectionCounter).toHaveText('已选 0/1');
    });

    await test.step('批量 Buff 框选使用真实 mouse drag 选择技能按钮', async () => {
      await page.locator('.buff-edit-box-select-button').click();
      await expect(page.locator('.buff-edit-box-select-layer')).toBeVisible();
      await dragBoxOverLocator(page, batchCanvas, batchSkillButton);
      await expect(selectionCounter).toHaveText('已选 1/1');
      await page.locator('.buff-edit-clear-selection-button').click();
      await expect(selectionCounter).toHaveText('已选 0/1');
    });

    const originalBuffCount = readSkillButtonBuffCount(await batchSkillButton.getAttribute('title'));
    let addedBuffLabel = '';

    await test.step('批量增加 Buff 支持 pending、取消和确认', async () => {
      await page.locator('.buff-edit-add-button').click();
      await expect(page.getByRole('heading', { name: '增加 Buff', exact: true })).toBeVisible();
      addedBuffLabel = await selectDynamicAddBuffCard(page, batchSkillButton);
      const batchSkillButtonTitle = page.locator('.buff-edit-skill-button');

      await batchSkillButtonTitle.click();
      await expect(batchSkillButtonTitle.locator('.buff-edit-pending-add-count')).toHaveText('+1');
      expect(readSkillButtonBuffCount(await batchSkillButtonTitle.getAttribute('title'))).toBe(originalBuffCount);

      await page.locator('.buff-edit-clear-selection-button').click();
      await expect(page.getByRole('heading', { name: '增加 Buff', exact: true })).toHaveCount(0);
      expect(readSkillButtonBuffCount(await batchSkillButton.getAttribute('title'))).toBe(originalBuffCount);

      await page.locator('.buff-edit-add-button').click();
      await expect(page.getByRole('heading', { name: '增加 Buff', exact: true })).toBeVisible();
      addedBuffLabel = await selectDynamicAddBuffCard(page, batchSkillButton, addedBuffLabel);
      await batchSkillButtonTitle.click();
      await expect(batchSkillButtonTitle.locator('.buff-edit-pending-add-count')).toHaveText('+1');
      await page.locator('.buff-edit-add-button').click();
      await expect(page.getByRole('heading', { name: '增加 Buff', exact: true })).toHaveCount(0);
      await expect.poll(async () => readSkillButtonBuffCount(await batchSkillButton.getAttribute('title')))
        .toBe(originalBuffCount + 1);
    });

    await test.step('批量筛选 Buff 保留同一技能按钮选中态', async () => {
      await page.locator('.buff-edit-filter-button').click();
      await expect(page.getByRole('heading', { name: '筛选 Buff', exact: true })).toBeVisible();
      const filterCard = await clickBuffCardByLabel(page, addedBuffLabel);
      await expect(selectionCounter).toHaveText('已选 1/1');
      await expect(filterCard).toHaveClass(/is-selected/);
      expect(readSkillButtonBuffCount(await batchSkillButton.getAttribute('title'))).toBe(originalBuffCount + 1);
      await page.locator('.buff-edit-filter-button').click();
    });

    await test.step('批量删减 Buff 支持 pending、取消、确认和持久 override 清理', async () => {
      const overrideBuffId = await seedPersistedBuffOverrides(page, skillButtonId!, addedBuffLabel);
      await page.locator('.buff-edit-remove-button').click();
      await expect(page.getByRole('heading', { name: '删减 Buff', exact: true })).toBeVisible();

      await clickBuffCardByLabel(page, addedBuffLabel);
      const removeSkillButton = page.locator('.buff-edit-skill-button');
      await removeSkillButton.click();
      await expect(removeSkillButton.locator('.buff-edit-pending-remove-count')).toHaveText('-1');
      expect(readSkillButtonBuffCount(await batchSkillButton.getAttribute('title'))).toBe(originalBuffCount + 1);

      await page.locator('.buff-edit-clear-selection-button').click();
      await expect(page.getByRole('heading', { name: '删减 Buff', exact: true })).toHaveCount(0);
      expect(readSkillButtonBuffCount(await batchSkillButton.getAttribute('title'))).toBe(originalBuffCount + 1);

      await page.locator('.buff-edit-remove-button').click();
      await expect(page.getByRole('heading', { name: '删减 Buff', exact: true })).toBeVisible();
      await clickBuffCardByLabel(page, addedBuffLabel);
      await page.locator('.buff-edit-skill-button').click();
      await expect(page.locator('.buff-edit-skill-button .buff-edit-pending-remove-count')).toHaveText('-1');
      await page.locator('.buff-edit-remove-button').click();
      await expect(page.getByRole('heading', { name: '删减 Buff', exact: true })).toHaveCount(0);
      await expect.poll(async () => readSkillButtonBuffCount(await batchSkillButton.getAttribute('title')))
        .toBe(originalBuffCount);

      const persistedButton = await readPersistedSkillButton(page, skillButtonId!);
      expect(persistedButton.selectedBuff).not.toContain(overrideBuffId);
      expect(Object.keys(persistedButton.buffStackCounts)).not.toContain(overrideBuffId);
      expect(persistedButton.globallyDisabledBuffIds).not.toContain(overrideBuffId);
      expect(Object.values(persistedButton.manualDisabledBuffIdsBySegmentKey).flat()).not.toContain(overrideBuffId);
      expect(Object.values(persistedButton.manualBuffStackCountsBySegmentKey)
        .flatMap((stackCounts) => Object.keys(stackCounts))).not.toContain(overrideBuffId);
    });

    await test.step('回到排轴后使用新的 TimelineSkillDetailWorkbench', async () => {
      await page.locator('.workbench-bottom-nav-button').filter({ hasText: '排轴' }).click();
      await expect(page.locator('.canvas-container')).toBeVisible();
      await expect(page.locator(`[data-skill-button-id="${skillButtonId}"]`)).toHaveCount(1);
      await expect(page.locator('html')).toHaveAttribute('data-theme', timelineTheme!);
    });

    await skillButton.dblclick();
    await expect(page).toHaveURL(new RegExp(`#/timeline/skill/${skillButtonId}$`));
    await expect(page.getByRole('dialog', { name: '技能排轴详情', exact: true })).toBeVisible();
    await expect(page.locator('.timeline-detail-layer')).toBeVisible();
    await expect(page.locator('.skill-button-modal-pair')).toHaveCount(0);
    await expect(page.locator('.timeline-summary-card')).toBeVisible();
    await expect(page.getByRole('heading', { name: '计算过程', exact: true })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', timelineTheme!);

    await test.step('详情页逐 Hit 展开、选择和目标抗性会写回按钮配置', async () => {
      const hits = page.locator('.timeline-detail-hit');
      expect(await hits.count()).toBeGreaterThan(0);
      await expect(hits.first()).toHaveClass(/is-selected/);
      await hits.first().click();
      await expect(hits.first()).not.toHaveClass(/is-selected/);
      await hits.nth(1).click();
      await expect(hits.nth(1)).toHaveClass(/is-selected/);

      const expandAll = page.getByRole('button', { name: '展开全部 Hit 微调', exact: true });
      await expandAll.click();
      await expect(page.getByRole('button', { name: '收起全部 Hit 微调', exact: true })).toBeVisible();
      expect(await page.locator('.timeline-tuning-inline-actions').count()).toBeGreaterThan(0);

      await page.getByRole('button', { name: '目标抗性', exact: true }).click();
      const resistanceCard = page.locator('.timeline-resistance-card');
      await expect(resistanceCard).toBeVisible();
      const physicalResistance = resistanceCard
        .getByText('物理', { exact: true })
        .locator('xpath=..')
        .locator('input');
      await physicalResistance.fill('37');
      await physicalResistance.press('Enter');
      await expect(physicalResistance).toHaveValue('37');
      await expect.poll(async () => (
        await readPersistedSkillButton(page, skillButtonId!)
      ).targetResistance.physicalResistance).toBe(37);
    });

    await page.getByRole('dialog', { name: '技能排轴详情', exact: true })
      .getByRole('button', { name: '关闭', exact: true })
      .click();
    await expect(page).toHaveURL(/#\/timeline$/);
    await expect(page.getByRole('dialog', { name: '技能排轴详情', exact: true })).toHaveCount(0);
    await expect(page.locator('.canvas-container')).toBeVisible();
    await expect(page.locator('.skill-sandbox')).toBeVisible();

    await skillButton.dblclick();
    await expect(page).toHaveURL(new RegExp(`#/timeline/skill/${skillButtonId}$`));
    await expect(page.getByRole('dialog', { name: '技能排轴详情', exact: true })).toBeVisible();

    await test.step('详情保持打开时会响应外部面板缓存 revision', async () => {
      const expectedSummary = page.locator('.timeline-summary-card strong');
      const beforeSummary = (await expectedSummary.textContent())?.trim();
      expect(beforeSummary).toBeTruthy();
      const beforeDiagnostics = await readSkillButtonPanelDiagnostics(page, skillButtonId!);
      const mutation = await increaseActiveOperatorPanelAtk(page, skillButtonId!);
      expect(mutation.afterAtk).toBeGreaterThan(mutation.beforeAtk);
      await expect(expectedSummary).toHaveText(beforeSummary!);

      await page.getByRole('button', { name: '批量设置敌方抗性', exact: true }).evaluate((button) => {
        (button as HTMLButtonElement).click();
      });
      const resistanceModal = page.locator('.batch-resistance-modal');
      await expect(resistanceModal).toBeVisible();
      await resistanceModal.getByRole('button', { name: '应用到全部按钮', exact: true }).evaluate((button) => {
        (button as HTMLButtonElement).click();
      });
      await expect(resistanceModal).toHaveCount(0);
      const afterDiagnostics = await readSkillButtonPanelDiagnostics(page, skillButtonId!);
      expect(afterDiagnostics.cacheAtk).toBe(mutation.afterAtk);
      expect(afterDiagnostics.runtimeAtk).not.toBe(beforeDiagnostics.runtimeAtk);
      await expect.poll(async () => (await expectedSummary.textContent())?.trim()).not.toBe(beforeSummary);
      await expect(page.getByRole('dialog', { name: '技能排轴详情', exact: true })).toBeVisible();
    });

    await page.reload();
    await expect(page.locator(`[data-skill-button-id="${skillButtonId}"]`)).toHaveCount(1);
    await expect(page.getByRole('dialog', { name: '技能排轴详情', exact: true })).toBeVisible();
    await expect(page.locator('.timeline-detail-layer')).toBeVisible();
    await expect(page.locator('.skill-button-modal-pair')).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('data-theme', timelineTheme!);
  });

  expect(browserErrors, 'browser console/page errors').toEqual([]);
});
