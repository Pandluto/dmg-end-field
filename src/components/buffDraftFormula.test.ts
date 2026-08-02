import assert from 'node:assert/strict';
import {
  buildBuffDraftIdFromName,
  buildBuffSheetRows,
  createDefaultBuffDraft,
  type BuffDraft,
  type BuffSheetRow,
} from './buffDraftModel';
import {
  createBuffFormulaTextBinding,
  type BuffFormulaTextBindingContext,
} from './buffDraftFormula';

const draft = createDefaultBuffDraft();
const selectedItem = draft.items['item-1'];
const selectedEffect = selectedItem.effects['buff-1'];
const rows = buildBuffSheetRows(draft);

const getRow = <K extends BuffSheetRow['kind']>(kind: K): Extract<BuffSheetRow, { kind: K }> => {
  const row = rows.find((candidate): candidate is Extract<BuffSheetRow, { kind: K }> => candidate.kind === kind);
  if (!row) {
    throw new Error(`Missing ${kind} row`);
  }
  return row;
};

const groupSummary = getRow('group');
const itemSummary = getRow('item');
const effectSummary = getRow('effect');

const createContext = (
  overrides: Partial<BuffFormulaTextBindingContext> = {},
): BuffFormulaTextBindingContext => ({
  selectedWorkbookSummary: groupSummary,
  selectedWorkbookCell: { columnKey: 'name' },
  draft,
  ...overrides,
});

const cloneDraft = (value: BuffDraft): BuffDraft => JSON.parse(JSON.stringify(value)) as BuffDraft;

const assertBindingShape = (
  binding: ReturnType<typeof createBuffFormulaTextBinding>,
  expected: { key: string; focusId: string; value: string; placeholder: string },
) => {
  assert.ok(binding);
  assert.deepEqual({
    key: binding.key,
    focusId: binding.focusId,
    value: binding.value,
    placeholder: binding.placeholder,
  }, expected);
  return binding;
};

const assertApplyKeepsSource = (
  binding: NonNullable<ReturnType<typeof createBuffFormulaTextBinding>>,
  nextValue: string,
) => {
  const sourceSnapshot = cloneDraft(draft);
  const nextDraft = binding.apply(draft, nextValue);
  assert.deepEqual(draft, sourceSnapshot, 'formula apply must not mutate the source draft');
  return nextDraft;
};

const groupCases = [
  { columnKey: 'idText', key: 'group:id', focusId: 'group-id', value: draft.id, placeholder: '组 ID', nextValue: 'group-renamed-id' },
  { columnKey: 'name', key: 'group:name', focusId: 'group-name', value: draft.name, placeholder: '组名称', nextValue: '组名称已改' },
  { columnKey: 'description', key: 'group:description', focusId: 'group-description', value: draft.description, placeholder: '组描述', nextValue: '组描述已改' },
] as const;

for (const testCase of groupCases) {
  const binding = assertBindingShape(createBuffFormulaTextBinding(createContext({
    selectedWorkbookSummary: groupSummary,
    selectedWorkbookCell: { columnKey: testCase.columnKey },
  })), {
    key: testCase.key,
    focusId: testCase.focusId,
    value: testCase.value,
    placeholder: testCase.placeholder,
  });
  const nextDraft = assertApplyKeepsSource(binding, testCase.nextValue);
  if (testCase.columnKey === 'idText') {
    assert.equal(nextDraft.id, testCase.nextValue);
  } else if (testCase.columnKey === 'description') {
    assert.equal(nextDraft.description, testCase.nextValue);
  } else {
    assert.equal(nextDraft.name, testCase.nextValue);
    assert.equal(nextDraft.id, buildBuffDraftIdFromName(testCase.nextValue), 'group rename must keep the generated ID in sync');
  }
}

const itemCases = [
  { columnKey: 'idText', key: `item:${selectedItem.id}:id`, focusId: 'item-id', value: selectedItem.id, placeholder: '项 ID', field: 'id' as const, nextValue: 'item-renamed-id' },
  { columnKey: 'name', key: `item:${selectedItem.id}:name`, focusId: 'item-name', value: selectedItem.name, placeholder: '项名称', field: 'name' as const, nextValue: '项名称已改' },
  { columnKey: 'description', key: `item:${selectedItem.id}:description`, focusId: 'item-description', value: selectedItem.description, placeholder: '项描述', field: 'description' as const, nextValue: '项描述已改' },
] as const;

for (const testCase of itemCases) {
  const binding = assertBindingShape(createBuffFormulaTextBinding(createContext({
    selectedWorkbookSummary: itemSummary,
    selectedWorkbookCell: { columnKey: testCase.columnKey },
  })), {
    key: testCase.key,
    focusId: testCase.focusId,
    value: testCase.value,
    placeholder: testCase.placeholder,
  });
  const nextDraft = assertApplyKeepsSource(binding, testCase.nextValue);
  assert.equal(nextDraft.items[itemSummary.itemKey][testCase.field], testCase.nextValue);
}

const effectCases = [
  { columnKey: 'name', key: `effect:${selectedEffect.id}:displayName`, focusId: 'effect-display-name', value: selectedEffect.displayName, placeholder: '效果名称', field: 'displayName' as const, nextValue: '效果名称已改' },
  { columnKey: 'condition', key: `effect:${selectedEffect.id}:condition`, focusId: 'effect-condition', value: '', placeholder: '条件', field: 'condition' as const, nextValue: '满足条件时' },
  { columnKey: 'description', key: `effect:${selectedEffect.id}:description`, focusId: 'effect-description', value: '', placeholder: '描述', field: 'description' as const, nextValue: '效果描述已改' },
] as const;

for (const testCase of effectCases) {
  const binding = assertBindingShape(createBuffFormulaTextBinding(createContext({
    selectedWorkbookSummary: effectSummary,
    selectedWorkbookCell: { columnKey: testCase.columnKey },
  })), {
    key: testCase.key,
    focusId: testCase.focusId,
    value: testCase.value,
    placeholder: testCase.placeholder,
  });
  const nextDraft = assertApplyKeepsSource(binding, testCase.nextValue);
  assert.equal(nextDraft.items[effectSummary.itemKey].effects[effectSummary.effectKey][testCase.field], testCase.nextValue);
}

const itemBinding = createBuffFormulaTextBinding(createContext({
  selectedWorkbookSummary: itemSummary,
  selectedWorkbookCell: { columnKey: 'name' },
}));
assert.ok(itemBinding);
const missingItemDraft: BuffDraft = { ...draft, items: {} };
assert.strictEqual(itemBinding.apply(missingItemDraft, 'must be ignored'), missingItemDraft, 'missing item must be a safe no-op');
assert.equal(createBuffFormulaTextBinding(createContext({ draft: missingItemDraft, selectedWorkbookSummary: itemSummary })), null);

const effectBinding = createBuffFormulaTextBinding(createContext({
  selectedWorkbookSummary: effectSummary,
  selectedWorkbookCell: { columnKey: 'description' },
}));
assert.ok(effectBinding);
const missingEffectDraft: BuffDraft = {
  ...draft,
  items: {
    ...draft.items,
    [effectSummary.itemKey]: { ...selectedItem, effects: {} },
  },
};
assert.strictEqual(effectBinding.apply(missingEffectDraft, 'must be ignored'), missingEffectDraft, 'missing effect must be a safe no-op');
assert.equal(createBuffFormulaTextBinding(createContext({ draft: missingEffectDraft, selectedWorkbookSummary: effectSummary })), null);

assert.equal(createBuffFormulaTextBinding(createContext({ selectedWorkbookSummary: null })), null);

console.log('Buff formula text binding immutable apply contract: PASS');
