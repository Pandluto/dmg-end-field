import assert from 'node:assert/strict';
import {
  buildBuffSheetRows,
  createDefaultBuffDraft,
  type BuffDraft,
  type BuffEffectDraft,
  type BuffItemDraft,
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
const groupSummary = rows.find((row): row is Extract<BuffSheetRow, { kind: 'group' }> => row.kind === 'group');
const itemSummary = rows.find((row): row is Extract<BuffSheetRow, { kind: 'item' }> => row.kind === 'item');
const effectSummary = rows.find((row): row is Extract<BuffSheetRow, { kind: 'effect' }> => row.kind === 'effect');

assert.ok(groupSummary);
assert.ok(itemSummary);
assert.ok(effectSummary);

const createContext = (
  overrides: Partial<BuffFormulaTextBindingContext> = {},
): BuffFormulaTextBindingContext => ({
  selectedWorkbookSummary: groupSummary,
  selectedWorkbookCell: { columnKey: 'name' },
  draft,
  selectedItem,
  selectedEffect,
  updateDraftField: () => undefined,
  updateSelectedItem: () => undefined,
  updateSelectedEffect: () => undefined,
  ...overrides,
});

const groupUpdates: Array<[keyof BuffDraft, unknown]> = [];
const updateDraftField: BuffFormulaTextBindingContext['updateDraftField'] = (field, value) => {
  groupUpdates.push([field, value]);
};

const groupCases = [
  { columnKey: 'idText', key: 'group:id', focusId: 'group-id', value: draft.id, placeholder: '组 ID', field: 'id' as const, nextValue: 'group-renamed-id' },
  { columnKey: 'name', key: 'group:name', focusId: 'group-name', value: draft.name, placeholder: '组名称', field: 'name' as const, nextValue: '组名称已改' },
  { columnKey: 'description', key: 'group:description', focusId: 'group-description', value: draft.description, placeholder: '组描述', field: 'description' as const, nextValue: '组描述已改' },
];

for (const testCase of groupCases) {
  const binding = createBuffFormulaTextBinding(createContext({
    selectedWorkbookSummary: groupSummary,
    selectedWorkbookCell: { columnKey: testCase.columnKey },
    updateDraftField,
  }));
  assert.ok(binding);
  assert.deepEqual({
    key: binding.key,
    focusId: binding.focusId,
    value: binding.value,
    placeholder: binding.placeholder,
  }, {
    key: testCase.key,
    focusId: testCase.focusId,
    value: testCase.value,
    placeholder: testCase.placeholder,
  });
  binding.commit(testCase.nextValue);
  assert.deepEqual(groupUpdates.pop(), [testCase.field, testCase.nextValue]);
}

const assertItemCommit = (
  columnKey: string,
  expectedKey: string,
  expectedFocusId: string,
  expectedValue: string,
  expectedPlaceholder: string,
  expectedField: keyof BuffItemDraft,
  nextValue: string,
) => {
  let updatedItem: BuffItemDraft | null = null;
  const updateSelectedItem: BuffFormulaTextBindingContext['updateSelectedItem'] = (updater) => {
    updatedItem = updater(selectedItem);
  };
  const binding = createBuffFormulaTextBinding(createContext({
    selectedWorkbookSummary: itemSummary,
    selectedWorkbookCell: { columnKey },
    updateSelectedItem,
  }));
  assert.ok(binding);
  assert.deepEqual({ bindingKey: binding.key, focusId: binding.focusId, value: binding.value, placeholder: binding.placeholder }, {
    bindingKey: expectedKey,
    focusId: expectedFocusId,
    value: expectedValue,
    placeholder: expectedPlaceholder,
  });
  binding.commit(nextValue);
  assert.ok(updatedItem);
  assert.equal(updatedItem[expectedField], nextValue);
};

assertItemCommit('idText', `item:${selectedItem.id}:id`, 'item-id', selectedItem.id, '项 ID', 'id', 'item-renamed-id');
assertItemCommit('name', `item:${selectedItem.id}:name`, 'item-name', selectedItem.name, '项名称', 'name', '项名称已改');
assertItemCommit('description', `item:${selectedItem.id}:description`, 'item-description', selectedItem.description, '项描述', 'description', '项描述已改');

const assertEffectCommit = (
  columnKey: string,
  expectedKey: string,
  expectedFocusId: string,
  expectedValue: string,
  expectedPlaceholder: string,
  expectedField: keyof BuffEffectDraft,
  nextValue: string,
) => {
  let updatedEffect: BuffEffectDraft | null = null;
  const updateSelectedEffect: BuffFormulaTextBindingContext['updateSelectedEffect'] = (updater) => {
    updatedEffect = updater(selectedEffect);
  };
  const binding = createBuffFormulaTextBinding(createContext({
    selectedWorkbookSummary: effectSummary,
    selectedWorkbookCell: { columnKey },
    updateSelectedEffect,
  }));
  assert.ok(binding);
  assert.deepEqual({ bindingKey: binding.key, focusId: binding.focusId, value: binding.value, placeholder: binding.placeholder }, {
    bindingKey: expectedKey,
    focusId: expectedFocusId,
    value: expectedValue,
    placeholder: expectedPlaceholder,
  });
  binding.commit(nextValue);
  assert.ok(updatedEffect);
  assert.equal(updatedEffect[expectedField], nextValue);
};

assertEffectCommit('name', `effect:${selectedEffect.id}:displayName`, 'effect-display-name', selectedEffect.displayName, '效果名称', 'displayName', '效果名称已改');
assertEffectCommit('condition', `effect:${selectedEffect.id}:condition`, 'effect-condition', '', '条件', 'condition', '满足条件时');
assertEffectCommit('description', `effect:${selectedEffect.id}:description`, 'effect-description', '', '描述', 'description', '效果描述已改');

assert.equal(createBuffFormulaTextBinding(createContext({ selectedWorkbookSummary: null })), null);
assert.equal(createBuffFormulaTextBinding(createContext({ selectedWorkbookSummary: itemSummary, selectedItem: null })), null);
assert.equal(createBuffFormulaTextBinding(createContext({ selectedWorkbookSummary: effectSummary, selectedEffect: null })), null);

console.log('Buff formula text binding characterization contract: PASS');
