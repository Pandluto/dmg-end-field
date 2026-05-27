import { test, expect } from '@playwright/test';

const DRAFT_KEY = 'def.buff-editor.draft.v1';
const LIBRARY_KEY = 'def.buff-editor.library.v1';
const SELECTED_CHARACTERS_KEY = 'def.selected-characters.v1';
const CHARACTER_INPUT_MAP_KEY = 'def.operator-config.character-input-map.v3';

const initialDraft = {
  id: 'ai-cli-smoke-draft',
  name: 'AI CLI Smoke Draft',
  sourceName: '',
  source: 'custom',
  description: '',
  items: {},
};

async function runCommand(page, command, expectedText) {
  const input = page.getByTestId('ai-cli-input');
  await input.fill(command);
  await input.press('Enter');
  if (expectedText) {
    await expect(page.getByTestId('ai-cli-output')).toContainText(expectedText);
  }
}

test('AI CLI can perform CRUD and buff.fill through the terminal UI', async ({ page }) => {
  await page.addInitScript(({ draftKey, libraryKey, draft }) => {
    window.localStorage.setItem(draftKey, JSON.stringify(draft));
    window.localStorage.setItem(libraryKey, JSON.stringify({ [draft.id]: draft }));
  }, { draftKey: DRAFT_KEY, libraryKey: LIBRARY_KEY, draft: initialDraft });

  await page.goto('http://127.0.0.1:3030/#/ai-cli');
  await expect(page.getByTestId('ai-cli-output')).toContainText('DEF AI CLI');
  await expect(page.getByTestId('ai-cli-output')).toContainText('mode=buff.fill');

  await runCommand(page, 'help', 'DEF AI CLI command surface');
  await runCommand(page, 'agent.guide', 'LLM agent guide:');
  await runCommand(page, 'buff.list', 'ai-cli-smoke-draft');
  await runCommand(page, '/purpose', 'purpose / 用途:');
  await runCommand(page, '/purpose', 'CN: 提供一个由软件本体控制的终端式桥接界面');
  await runCommand(page, 'spec', 'fill.check never writes');
  await runCommand(
    page,
    'operator.add codex-test-operator 测试干员 weapon=测试武器 potential=满潜 skillLevel=M3 sourceSkillBoost=0.18 critRate=0.12 atkPercent=0.2 critDmg=0.3',
    '[ok] operator added: codex-test-operator 测试干员',
  );
  await runCommand(page, 'operator.show codex-test-operator', '测试武器');
  await runCommand(page, 'draft.show', 'id=ai-cli-smoke-draft');
  await runCommand(page, 'draft.rename 测试干员测试Buff', '[ok] draft renamed: 测试干员测试Buff');
  await runCommand(page, 'item.add item-test 测试天赋 sourceName=测试干员 desc=测试天赋满字段', '[ok] item added: item-test');
  await runCommand(page, 'item.list', 'item-test');
  await runCommand(
    page,
    'effect.add item-test effect-test type=atkPercentBoost value=0.2 name=测试攻击 display=测试攻击提升 level=M3 source=codex-test-operator sourceName=测试干员 desc=攻击力提升20% condition=测试条件',
    '[ok] effect added: item-test/effect-test',
  );
  await runCommand(page, 'effect.list item-test', 'atkPercentBoost');
  await runCommand(page, 'effect.set item-test effect-test value=0.3 display=测试攻击提升30 condition=测试条件-已修改', '[ok] effect updated: item-test/effect-test');
  await runCommand(page, 'effect.delete item-test effect-test', '[ok] effect deleted: item-test/effect-test');
  await runCommand(page, 'item.delete item-test', '[ok] item deleted: item-test');

  const fillDraft = {
    id: 'agent-fill',
    name: '测试干员完整 Buff',
    sourceName: '测试干员',
    source: 'codex-test-operator',
    description: '由 AI CLI 演示填满的测试 Buff',
    items: [
      {
        name: '测试天赋',
        sourceName: '测试干员',
        description: '测试天赋分组说明',
        effects: [
          {
            displayName: '测试攻击提升',
            name: '测试攻击提升',
            level: 'M3',
            source: 'codex-test-operator',
            sourceName: '测试干员',
            description: '攻击力提高20%，持续整场测试。',
            condition: '测试干员在场',
            effectKind: 'modifier',
            type: 'atkPercentBoost',
            value: 0.2,
            evidenceText: '测试干员在场时，攻击力提高20%。',
            confidence: 0.95,
          },
          {
            displayName: '测试暴击率',
            name: '测试暴击率',
            level: 'M3',
            source: 'codex-test-operator',
            sourceName: '测试干员',
            description: '暴击率提高12%。',
            condition: '测试 Buff 生效',
            effectKind: 'modifier',
            type: 'critRateBoost',
            value: 0.12,
            evidenceText: '测试 Buff 生效时，暴击率提高12%。',
            confidence: 0.94,
          },
        ],
      },
      {
        name: '测试技能',
        sourceName: '测试干员',
        description: '测试技能分组说明',
        effects: [
          {
            displayName: '测试战技增伤',
            name: '测试战技增伤',
            level: 'M3',
            source: 'codex-test-operator',
            sourceName: '测试干员',
            description: '战技伤害提高30%。',
            condition: '释放测试战技后',
            effectKind: 'modifier',
            type: 'skillDmgBonus',
            value: 0.3,
            evidenceText: '释放测试战技后，战技伤害提高30%。',
            confidence: 0.93,
          },
        ],
      },
    ],
  };
  await runCommand(page, `fill.check ${JSON.stringify(fillDraft)}`, '[ok] fill result valid: items=2 effects=3');
  await runCommand(page, `fill.apply ${JSON.stringify(fillDraft)}`, '[ok] fill applied: items=2 effects=3');
  await runCommand(page, 'buff.show agent-fill', 'name=测试干员完整 Buff');
  await runCommand(page, 'buff.search 完整', 'agent-fill');
  await runCommand(page, 'agent.logs 5', 'fill.apply');
  await runCommand(page, 'agent.sessions 5', 'session-');

  const storedDraft = await page.evaluate((draftKey) => JSON.parse(window.localStorage.getItem(draftKey) || '{}'), DRAFT_KEY);
  expect(storedDraft.id).toBe('agent-fill');
  expect(storedDraft.name).toBe('测试干员完整 Buff');
  expect(Object.keys(storedDraft.items)).toEqual(['item-1', 'item-2']);
  expect(storedDraft.items['item-1'].effects['buff-1'].type).toBe('atkPercentBoost');
  expect(storedDraft.items['item-1'].effects['buff-1'].value).toBe(0.2);
  expect(storedDraft.items['item-1'].effects['buff-2'].type).toBe('critRateBoost');
  expect(storedDraft.items['item-2'].effects['buff-1'].type).toBe('skillDmgBonus');

  const storedLibrary = await page.evaluate((libraryKey) => JSON.parse(window.localStorage.getItem(libraryKey) || '{}'), LIBRARY_KEY);
  expect(storedLibrary['agent-fill'].name).toBe('测试干员完整 Buff');

  const selectedCharacters = await page.evaluate((key) => JSON.parse(window.sessionStorage.getItem(key) || '[]'), SELECTED_CHARACTERS_KEY);
  expect(selectedCharacters).toContain('codex-test-operator');
  const operatorMap = await page.evaluate((key) => JSON.parse(window.sessionStorage.getItem(key) || '{}'), CHARACTER_INPUT_MAP_KEY);
  expect(operatorMap.data['codex-test-operator'].displayName).toBe('测试干员');
  expect(operatorMap.data['codex-test-operator'].weapon.name).toBe('测试武器');

  await page.screenshot({ path: '.runtime-assets/ai-cli-smoke.png', fullPage: true });
});
