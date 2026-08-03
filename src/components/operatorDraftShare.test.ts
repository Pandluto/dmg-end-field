import assert from 'node:assert/strict';
import {
  buildOrderedDraft,
  createDefaultDraft,
  createDefaultSkill,
  type OperatorDraft,
} from './operatorDraftPageModel';
import {
  OPERATOR_LIBRARY_SHARE_TYPE,
  OPERATOR_SHARE_EMPTY_PAYLOAD_ERROR,
  OPERATOR_SHARE_INVALID_FILE_ERROR,
  buildOperatorDraftLibraryShareFile,
  mergeOperatorDraftLibraryShare,
  normalizeOperatorDraftShareId,
  parseOperatorDraftLibraryShare,
  resolveOperatorDraftShareSelection,
} from './operatorDraftShare';

function makeDraft(id: string, name: string): OperatorDraft {
  const draft = createDefaultDraft();
  return {
    ...draft,
    id,
    name,
  };
}

const staleDraft = makeDraft('ordered', '旧库值');
const currentDraft = makeDraft('ordered', '当前干员');
currentDraft.skills = {
  'skill-A-1': createDefaultSkill('A', 'skill-A-1'),
  'skill-B-1': createDefaultSkill('B', 'skill-B-1'),
};
const orderedCurrentDraft = buildOrderedDraft(currentDraft, ['skill-B-1', 'skill-A-1']);

const currentShare = buildOperatorDraftLibraryShareFile({
  draft: orderedCurrentDraft,
  library: {
    ordered: staleDraft,
    other: makeDraft('other', '其他干员'),
  },
  scope: 'current',
});
assert.equal(currentShare.type, OPERATOR_LIBRARY_SHARE_TYPE);
assert.equal(currentShare.label, '当前干员');
assert.deepEqual(Object.keys(currentShare.payload), ['ordered']);
assert.strictEqual(currentShare.payload.ordered, orderedCurrentDraft);
assert.deepEqual(Object.keys(currentShare.payload.ordered.skills), ['skill-B-1', 'skill-A-1']);

const allShare = buildOperatorDraftLibraryShareFile({
  draft: orderedCurrentDraft,
  library: {
    ordered: staleDraft,
    other: makeDraft('other', '其他干员'),
  },
  scope: 'all',
  libraryLabel: '  自定义干员库  ',
});
assert.equal(allShare.label, '自定义干员库');
assert.deepEqual(Object.keys(allShare.payload), ['ordered', 'other']);
assert.strictEqual(allShare.payload.ordered, orderedCurrentDraft);
assert.equal(allShare.payload.other.name, '其他干员');

const fallbackLabelShare = buildOperatorDraftLibraryShareFile({
  draft: orderedCurrentDraft,
  library: {},
  scope: 'all',
  libraryLabel: '   ',
});
assert.equal(fallbackLabelShare.label, '当前干员');

assert.deepEqual(parseOperatorDraftLibraryShare('{broken'), {
  ok: false,
  error: OPERATOR_SHARE_INVALID_FILE_ERROR,
});
assert.deepEqual(parseOperatorDraftLibraryShare(JSON.stringify({
  type: 'weapon-library-share.v1',
  payload: {},
})), {
  ok: false,
  error: OPERATOR_SHARE_INVALID_FILE_ERROR,
});
assert.deepEqual(parseOperatorDraftLibraryShare(JSON.stringify({
  type: OPERATOR_LIBRARY_SHARE_TYPE,
  payload: [],
})), {
  ok: false,
  error: OPERATOR_SHARE_INVALID_FILE_ERROR,
});
assert.deepEqual(parseOperatorDraftLibraryShare(JSON.stringify({
  type: OPERATOR_LIBRARY_SHARE_TYPE,
  payload: null,
})), {
  ok: false,
  error: OPERATOR_SHARE_INVALID_FILE_ERROR,
});
assert.deepEqual(parseOperatorDraftLibraryShare(JSON.stringify({
  type: OPERATOR_LIBRARY_SHARE_TYPE,
  payload: {},
})), {
  ok: false,
  error: OPERATOR_SHARE_EMPTY_PAYLOAD_ERROR,
});
assert.deepEqual(parseOperatorDraftLibraryShare(JSON.stringify({
  type: OPERATOR_LIBRARY_SHARE_TYPE,
  payload: {
    invalid: { id: 'inner-invalid', name: '', skills: {} },
  },
})), {
  ok: false,
  error: OPERATOR_SHARE_EMPTY_PAYLOAD_ERROR,
});

const outerIdentityResult = parseOperatorDraftLibraryShare(JSON.stringify({
  type: OPERATOR_LIBRARY_SHARE_TYPE,
  payload: {
    'outer-only-id': { ...makeDraft('', '外层身份干员'), id: '' },
  },
}));
assert.equal(outerIdentityResult.ok, true, 'a valid outer key must supply a missing inner id');
if (!outerIdentityResult.ok) {
  throw new Error(outerIdentityResult.error);
}
assert.equal(outerIdentityResult.shareFile.payload['outer-only-id'].id, 'outer-only-id');
assert.equal(outerIdentityResult.shareFile.payload['outer-only-id'].name, '外层身份干员');

const mixedResult = parseOperatorDraftLibraryShare(JSON.stringify({
  type: OPERATOR_LIBRARY_SHARE_TYPE,
  exportedAt: 123,
  label: ' 混合干员分享 ',
  payload: {
    'alpha-operator': { ...makeDraft('inner-id-must-lose', '导入干员') },
    nullEntry: null,
    primitiveEntry: 42,
    arrayEntry: [],
    invalidEntry: { id: 'bad-inner', name: '', skills: {} },
  },
}));
assert.equal(mixedResult.ok, true);
if (!mixedResult.ok) {
  throw new Error(mixedResult.error);
}
assert.equal(mixedResult.shareFile.exportedAt, 123);
assert.equal(mixedResult.shareFile.label, '混合干员分享');
assert.deepEqual(Object.keys(mixedResult.shareFile.payload), ['alpha-operator']);
assert.equal(mixedResult.shareFile.payload['alpha-operator'].id, 'alpha-operator');
assert.equal(mixedResult.shareFile.payload['alpha-operator'].name, '导入干员');

const collisionResult = parseOperatorDraftLibraryShare(JSON.stringify({
  type: OPERATOR_LIBRARY_SHARE_TYPE,
  payload: {
    'same-id': makeDraft('first-inner-id', '第一个'),
    ' same-id ': makeDraft('second-inner-id', '第二个'),
  },
}));
assert.equal(collisionResult.ok, true);
if (!collisionResult.ok) {
  throw new Error(collisionResult.error);
}
assert.deepEqual(Object.keys(collisionResult.shareFile.payload), ['same-id', 'same-id-2']);
assert.equal(collisionResult.shareFile.payload['same-id'].id, 'same-id');
assert.equal(collisionResult.shareFile.payload['same-id-2'].id, 'same-id-2');

assert.equal(normalizeOperatorDraftShareId('  valid-operator-1  ', '备用名称', []), 'valid-operator-1');
assert.equal(normalizeOperatorDraftShareId('非法 key', '备用名称', []), 'feifakey');
assert.equal(normalizeOperatorDraftShareId('', '备用干员', []), 'beiyongganyuan');
assert.equal(normalizeOperatorDraftShareId('', '@@@', []), 'custom-operator-001');
assert.equal(
  normalizeOperatorDraftShareId('same-id', '备用名称', ['same-id', 'same-id-2']),
  'same-id-3',
);

const existingLibrary = {
  existing: makeDraft('existing', '现有干员'),
  'alpha-operator': makeDraft('alpha-operator', '旧导入值'),
};
const mergeResult = mergeOperatorDraftLibraryShare(existingLibrary, mixedResult.shareFile);
assert.deepEqual(mergeResult.importedIds, ['alpha-operator']);
assert.deepEqual(Object.keys(mergeResult.nextLibrary), ['existing', 'alpha-operator']);
assert.equal(mergeResult.nextLibrary.existing.name, '现有干员');
assert.equal(mergeResult.nextLibrary['alpha-operator'].name, '导入干员');
assert.equal(mergeResult.nextLibrary['alpha-operator'].id, 'alpha-operator');
assert.equal(existingLibrary['alpha-operator'].name, '旧导入值');
assert.equal(resolveOperatorDraftShareSelection(mergeResult.importedIds), 'alpha-operator');
assert.equal(resolveOperatorDraftShareSelection([]), '');

console.log('Operator share build, parse, identity, merge contract: PASS');
