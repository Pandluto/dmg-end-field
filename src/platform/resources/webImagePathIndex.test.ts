import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWebImagePathIndex } from './webImagePathIndex';

const index = createWebImagePathIndex([
  {
    relativePath: 'assets/images/img-equipment/icon_cn/落潮轻甲.png',
    source: 'release',
  },
  {
    relativePath: 'assets/images/img-operator/佩丽卡.png',
    source: 'release',
  },
  {
    relativePath: 'assets/images/img-operator/skiil-icon/佩丽卡/佩丽卡战技.png',
    source: 'release',
  },
  {
    relativePath: 'assets/images/img-operator/诀/李知烟.png',
    source: 'release',
  },
  {
    relativePath: 'assets/images/img-operator/李知烟.png',
    source: 'release',
  },
  {
    relativePath: 'assets/images/img-wepaon/wpn_sword_0001.png',
    source: 'release',
  },
  {
    relativePath: 'assets/images/custom/测试 图标.webp',
    source: 'user',
  },
]);

assert.equal(
  index.resolve('/assets/avatars/佩丽卡/佩丽卡.png')?.canonicalPath,
  'assets/images/img-operator/佩丽卡.png',
);
assert.equal(
  index.resolve('/assets/avatars/佩丽卡/佩丽卡.jpg')?.canonicalPath,
  'assets/images/img-operator/佩丽卡.png',
);
assert.equal(
  index.resolve('assets\\avatars\\佩丽卡\\错误目录\\佩丽卡战技.PNG')?.canonicalPath,
  'assets/images/img-operator/skiil-icon/佩丽卡/佩丽卡战技.png',
);
assert.equal(
  index.resolve('http://127.0.0.1:31457/user-images/img-equipment/%E8%90%BD%E6%BD%AE%E8%BD%BB%E7%94%B2%C2%B7%E5%A3%B9%E5%9E%8B.png')?.canonicalPath,
  'assets/images/img-equipment/icon_cn/落潮轻甲.png',
);
assert.equal(
  index.resolve('/public/images/weapon/icon/wpn_sword_0001.png')?.canonicalPath,
  'assets/images/img-wepaon/wpn_sword_0001.png',
);
assert.equal(
  index.resolve('/assets/images/img-weapon/wpn_sword_0001.png')?.canonicalPath,
  'assets/images/img-wepaon/wpn_sword_0001.png',
);
assert.equal(
  index.resolve('user-images/img-operator/诀/李知烟.png')?.canonicalPath,
  'assets/images/img-operator/诀/李知烟.png',
);
assert.equal(
  index.resolve('/assets/avatars/李知烟/李知烟.png')?.canonicalPath,
  'assets/images/img-operator/李知烟.png',
);
assert.equal(
  index.resolve('data/images/custom/%E6%B5%8B%E8%AF%95%20%E5%9B%BE%E6%A0%87.webp')?.canonicalPath,
  'assets/images/custom/测试 图标.webp',
);
assert.equal(index.resolve('https://example.com/external.png'), null);
assert.equal(index.resolve('佩丽卡'), null);

const manifest = JSON.parse(
  readFileSync(
    new URL('../../../public/web-image-manifest.json', import.meta.url),
    'utf8',
  ),
) as { files: Array<{ path: string }> };
const releasePaths = manifest.files.map((entry) => entry.path);
const completeIndex = createWebImagePathIndex(
  releasePaths.map((relativePath) => ({ relativePath, source: 'release' })),
);

const historicalOperatorPaths = readFileSync(
  new URL('../../data/operatorAssetPaths.txt', import.meta.url),
  'utf8',
)
  .split(/\r?\n/)
  .map((value) => value.trim())
  .filter(Boolean);

for (const historicalPath of historicalOperatorPaths) {
  assert.ok(
    completeIndex.resolve(historicalPath),
    `historical operator image path should resolve: ${historicalPath}`,
  );
}

const releasePathsByStem = new Map<string, string[]>();
for (const relativePath of releasePaths) {
  const fileName = relativePath.split('/').pop() || '';
  const dot = fileName.lastIndexOf('.');
  const stem = (dot > 0 ? fileName.slice(0, dot) : fileName)
    .normalize('NFKC')
    .toLocaleLowerCase();
  releasePathsByStem.set(stem, [...(releasePathsByStem.get(stem) || []), relativePath]);
}

for (const [stem, paths] of releasePathsByStem) {
  if (paths.length !== 1) continue;
  assert.equal(
    completeIndex.resolve(`wrong/directory/${stem}.JPG`)?.canonicalPath,
    paths[0],
    `unique image stem should tolerate a wrong directory and extension: ${stem}`,
  );
}

console.log('Web image path index compatibility contract: PASS');
