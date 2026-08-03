import assert from 'node:assert/strict';
import {
  buildEquipmentImagePreviewPresentation,
  getEquipmentImageOptionSource,
} from './equipmentSheetImagePreview';

const loading = buildEquipmentImagePreviewPresentation({
  storedReference: 'assets/images/user-equipment.png',
  resolvedUrl: '/assets/images/user-equipment.png',
  imageLibraryLoading: true,
  loadFailed: false,
});
assert.equal(loading.hasStoredImage, true);
assert.equal(loading.renderImage, false);
assert.equal(loading.showFailure, false);

const failed = buildEquipmentImagePreviewPresentation({
  storedReference: 'assets/images/user-equipment.png',
  resolvedUrl: '/assets/images/user-equipment.png',
  imageLibraryLoading: false,
  loadFailed: true,
});
assert.equal(failed.renderImage, true, '失败后仍应保留 img，让后续 URL 变化能够重试');
assert.equal(failed.showFailure, true);

const hydrated = buildEquipmentImagePreviewPresentation({
  storedReference: 'assets/images/user-equipment.png',
  resolvedUrl: 'blob:http://127.0.0.1:3040/user-equipment',
  imageLibraryLoading: false,
  loadFailed: true,
});
assert.equal(hydrated.renderImage, true);
assert.equal(hydrated.imageUrl, 'blob:http://127.0.0.1:3040/user-equipment');
assert.equal(hydrated.showFailure, true, '新地址加载成功前保留失败提示，由 img onLoad 清除');

const empty = buildEquipmentImagePreviewPresentation({
  storedReference: '   ',
  resolvedUrl: '',
  imageLibraryLoading: false,
  loadFailed: false,
});
assert.equal(empty.hasStoredImage, false);
assert.equal(empty.renderImage, false);
assert.equal(empty.showEmpty, true);

assert.equal(getEquipmentImageOptionSource('user'), 'user');
assert.equal(getEquipmentImageOptionSource('release'), 'builtin');
assert.equal(getEquipmentImageOptionSource('builtin'), 'builtin');
assert.equal(getEquipmentImageOptionSource(undefined), 'builtin');
