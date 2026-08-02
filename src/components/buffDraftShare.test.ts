import assert from 'node:assert/strict';
import { createDefaultBuffDraft } from './buffDraftModel';
import {
  BUFF_LIBRARY_SHARE_TYPE,
  BUFF_SHARE_EMPTY_PAYLOAD_ERROR,
  BUFF_SHARE_INVALID_FILE_ERROR,
  buildBuffDraftLibraryShareFile,
  mergeBuffDraftLibraryShare,
  parseBuffDraftLibraryShare,
  resolveBuffDraftShareSelection,
} from './buffDraftShare';

const existingDraft = {
  ...createDefaultBuffDraft(),
  id: 'existing',
  name: '现有分组',
};
const exported = buildBuffDraftLibraryShareFile({ existing: existingDraft }, '  测试分享  ');
assert.equal(exported.type, BUFF_LIBRARY_SHARE_TYPE);
assert.equal(exported.label, '测试分享');
assert.deepEqual(exported.payload, { existing: existingDraft });
assert.equal(typeof exported.exportedAt, 'number');

assert.deepEqual(parseBuffDraftLibraryShare('{broken'), {
  ok: false,
  error: BUFF_SHARE_INVALID_FILE_ERROR,
});
assert.deepEqual(parseBuffDraftLibraryShare(JSON.stringify({
  type: 'weapon-library-share.v1',
  payload: {},
})), {
  ok: false,
  error: BUFF_SHARE_INVALID_FILE_ERROR,
});
assert.deepEqual(parseBuffDraftLibraryShare(JSON.stringify({
  type: BUFF_LIBRARY_SHARE_TYPE,
  payload: [],
})), {
  ok: false,
  error: BUFF_SHARE_INVALID_FILE_ERROR,
});
assert.deepEqual(parseBuffDraftLibraryShare(JSON.stringify({
  type: BUFF_LIBRARY_SHARE_TYPE,
  payload: { invalid: {} },
})), {
  ok: false,
  error: BUFF_SHARE_EMPTY_PAYLOAD_ERROR,
});

const importedDraft = {
  ...createDefaultBuffDraft(),
  id: ' imported-id ',
  name: ' 导入分组 ',
  sourceName: ' 导入来源 ',
};
const mixedResult = parseBuffDraftLibraryShare(JSON.stringify({
  type: BUFF_LIBRARY_SHARE_TYPE,
  exportedAt: 123,
  label: ' 混合载荷 ',
  payload: {
    imported: importedDraft,
    invalid: { id: '', name: '' },
  },
}));
assert.equal(mixedResult.ok, true);
if (!mixedResult.ok) {
  throw new Error(mixedResult.error);
}
assert.equal(mixedResult.shareFile.exportedAt, 123);
assert.equal(mixedResult.shareFile.label, '混合载荷');
assert.deepEqual(Object.keys(mixedResult.shareFile.payload), ['imported']);
assert.equal(mixedResult.shareFile.payload.imported.id, 'imported-id');
assert.equal(mixedResult.shareFile.payload.imported.name, '导入分组');
assert.equal(mixedResult.shareFile.payload.imported.sourceName, '导入来源');

const overwrittenDraft = {
  ...createDefaultBuffDraft(),
  id: ' imported-id ',
  name: ' 覆盖后的分组 ',
};
const nextLibrary = mergeBuffDraftLibraryShare(
  {
    existing: existingDraft,
    imported: { ...existingDraft, id: 'old-imported', name: '待覆盖' },
  },
  {
    ...mixedResult.shareFile,
    payload: { imported: overwrittenDraft },
  },
);
assert.deepEqual(Object.keys(nextLibrary), ['existing', 'imported']);
assert.equal(nextLibrary.existing.name, '现有分组');
assert.equal(nextLibrary.imported.id, 'imported-id');
assert.equal(nextLibrary.imported.name, '覆盖后的分组');

assert.equal(resolveBuffDraftShareSelection('existing', nextLibrary, mixedResult.shareFile.payload), 'existing');
assert.equal(resolveBuffDraftShareSelection('missing', nextLibrary, mixedResult.shareFile.payload), 'imported');
assert.equal(resolveBuffDraftShareSelection('missing', { existing: existingDraft }, {}), 'existing');
assert.equal(resolveBuffDraftShareSelection('missing', {}, {}), '');

console.log('Buff share parse and merge contract: PASS');
