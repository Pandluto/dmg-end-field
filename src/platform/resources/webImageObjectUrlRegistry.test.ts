import assert from 'node:assert/strict';
import { createWebImageObjectUrlRegistry } from './webImageObjectUrlRegistry';

const revoked: string[] = [];
const registry = createWebImageObjectUrlRegistry({
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => {
    revoked.push(url);
    URL.revokeObjectURL(url);
  },
});

const relativePath = 'assets/images/repeated-hydration.png';
const originalContent = new Uint8Array([1, 2, 3, 4]);
assert.equal(registry.synchronize([{
  relativePath,
  mimeType: 'image/png',
  content: originalContent,
}]), true);
const firstUrl = registry.get(relativePath);
assert.ok(firstUrl?.startsWith('blob:'), '首次 hydration 应创建 object URL');

assert.equal(registry.synchronize([{
  relativePath,
  mimeType: 'image/png',
  content: new Uint8Array(originalContent),
}]), false);
const secondUrl = registry.get(relativePath);
assert.equal(secondUrl, firstUrl, '同一路径和内容的后续 hydration 必须复用 object URL');
assert.deepEqual(revoked, [], '重复 hydration 不得撤销仍被其他页面使用的 URL');
assert.deepEqual(
  [...new Uint8Array(await (await fetch(firstUrl)).arrayBuffer())],
  [...originalContent],
  '重复 hydration 后旧消费者持有的 URL 仍应可读取',
);

assert.equal(registry.synchronize([{
  relativePath,
  mimeType: 'image/png',
  content: new Uint8Array([1, 2, 3, 5]),
}]), true);
const changedUrl = registry.get(relativePath);
assert.notEqual(changedUrl, firstUrl, '同路径内容变化时必须生成新 URL');
assert.deepEqual(revoked, [firstUrl]);
assert.deepEqual(
  [...new Uint8Array(await (await fetch(changedUrl)).arrayBuffer())],
  [1, 2, 3, 5],
);

assert.equal(registry.synchronize([]), true);
assert.equal(registry.get(relativePath), null);
assert.deepEqual(revoked, [firstUrl, changedUrl], '资源删除时必须撤销最后一个 URL');

assert.equal(registry.synchronize([]), false);
assert.deepEqual(revoked, [firstUrl, changedUrl], '重复空 hydration 不得重复 revoke');

console.log('Web image object URL stability contract: PASS');
