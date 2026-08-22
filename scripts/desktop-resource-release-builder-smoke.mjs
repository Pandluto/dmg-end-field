import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildResourceReleaseFromPaths } from './resource-release-file-builder.mjs';
import { verifyResourceReleaseBundle } from '../src/platform/resources/resourceReleaseVerifier.ts';

function records(prefix, count) {
  return Object.fromEntries(Array.from({ length: count }, (_, index) => [
    `${prefix}-${index + 1}`,
    { id: `${prefix}-${index + 1}`, name: `${prefix} ${index + 1}` },
  ]));
}

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dmg-desktop-resource-release-'));

try {
  const shareDataPath = path.join(temporaryRoot, 'share-data.json');
  const imageRoot = path.join(temporaryRoot, 'source', 'assets', 'images');
  const outputRoot = path.join(temporaryRoot, 'output');
  fs.mkdirSync(path.join(imageRoot, 'operators'), { recursive: true });
  fs.mkdirSync(path.join(imageRoot, 'weapons'), { recursive: true });
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.writeFileSync(path.join(imageRoot, 'operators', 'alpha.png'), Buffer.from([137, 80, 78, 71]));
  fs.writeFileSync(path.join(imageRoot, 'weapons', 'beta.webp'), Buffer.from('resource-smoke'));
  fs.writeFileSync(shareDataPath, `${JSON.stringify({
    type: 'def.localdata.archive.v1',
    schemaVersion: 1,
    id: 'desktop-resource-smoke',
    createdAt: '2026-08-20T09:53:24.000Z',
    exportedAt: '2026-08-20T09:53:24.000Z',
    storage: {
      local: {
        'def.operator-editor.library.v1': records('operator', 30),
        'def.weapon-sheet.library.v1': records('weapon', 75),
        'def.equipment-sheet.library.v1': { equipment: { id: 'equipment' } },
        'def.buff-editor.library.v1': { buff: { id: 'buff' } },
        'def.operator-editor.draft.v1': { ignored: true },
      },
      session: {},
    },
    timelineArchives: [],
  })}\n`, 'utf8');

  const result = await buildResourceReleaseFromPaths({
    shareData: shareDataPath,
    images: path.join(temporaryRoot, 'source'),
    output: outputRoot,
    generatedAt: '2026-08-22T04:05:06.000Z',
  });
  assert.match(result.releaseVersion, /^20260822\.120506\.[a-f0-9]{12}$/);
  assert.equal(result.operators, 30);
  assert.equal(result.weapons, 75);
  assert.equal(result.images, 2);
  assert.equal(fs.existsSync(result.bundlePath), true);
  assert.equal(fs.existsSync(result.manifestPath), true);

  const verified = await verifyResourceReleaseBundle(
    new Uint8Array(fs.readFileSync(result.bundlePath)),
  );
  assert.equal(verified.manifest.releaseVersion, result.releaseVersion);
  assert.equal(verified.manifest.source.exportedAt, '2026-08-20T09:53:24.000Z');
  assert.deepEqual(
    verified.manifest.images.files.map((entry) => entry.path),
    [
      'assets/images/operators/alpha.png',
      'assets/images/weapons/beta.webp',
    ],
  );

  await assert.rejects(
    () => buildResourceReleaseFromPaths({
      shareData: shareDataPath,
      images: path.join(temporaryRoot, 'source'),
      output: path.join(temporaryRoot, 'source'),
    }),
    /不能与图片目录重叠/,
  );

  console.log('Desktop unified resource release builder smoke passed.');
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
