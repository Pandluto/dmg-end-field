import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildImageReleasePackage } from './build-image-release-manifest.mjs';

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dmg-desktop-image-release-'));

try {
  const sourceRoot = path.join(temporaryRoot, 'source', 'assets', 'images');
  const outputRoot = path.join(temporaryRoot, 'output');
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, 'operators'), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, 'weapons'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'operators', 'alpha.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(sourceRoot, 'weapons', 'beta.webp'), Buffer.from('desktop-image-smoke'));
  fs.writeFileSync(path.join(sourceRoot, 'ignored.txt'), 'not an image');

  const result = buildImageReleasePackage({
    source: path.join(temporaryRoot, 'source'),
    output: outputRoot,
    assetVersion: 'desktop/1.8.2. ',
    releaseTag: 'desktop-images-v1.8.2',
  });
  assert.equal(result.assetVersion, 'desktop-1.8.2');
  assert.equal(result.totalFiles, 2);
  assert.equal(result.packagePaths.length, 1);

  const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
  assert.equal(manifest.manifestVersion, 1);
  assert.equal(manifest.delivery, 'archive');
  assert.equal(manifest.releaseTag, 'desktop-images-v1.8.2');
  assert.deepEqual(
    manifest.files.map((entry) => entry.relativePath),
    [
      'assets/images/operators/alpha.png',
      'assets/images/weapons/beta.webp',
    ],
  );
  assert.ok(manifest.files.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256)));
  assert.equal(manifest.package.fileName, 'assets-desktop-1.8.2-full.zip');
  assert.ok(fs.existsSync(result.packagePaths[0]));

  assert.throws(
    () => buildImageReleasePackage({
      source: path.join(temporaryRoot, 'source'),
      output: outputRoot,
      assetVersion: '..',
    }),
    /assetVersion 无效/,
  );
  assert.throws(
    () => buildImageReleasePackage({
      source: path.join(temporaryRoot, 'source'),
      output: temporaryRoot,
      assetVersion: 'source',
    }),
    /不能与图片源目录重叠/,
  );
  const nestedOutputRoot = path.join(temporaryRoot, 'source', 'release-output');
  fs.mkdirSync(nestedOutputRoot, { recursive: true });
  assert.throws(
    () => buildImageReleasePackage({
      source: path.join(temporaryRoot, 'source'),
      output: nestedOutputRoot,
      assetVersion: 'nested-output',
    }),
    /不能与图片源目录重叠/,
  );
  assert.equal(fs.existsSync(path.join(nestedOutputRoot, 'nested-output')), false);
  assert.ok(fs.existsSync(path.join(sourceRoot, 'operators', 'alpha.png')));

  if (process.platform !== 'win32') {
    const listing = spawnSync('unzip', ['-Z1', result.packagePaths[0]], { encoding: 'utf8' });
    assert.equal(listing.status, 0, listing.stderr || listing.stdout);
    assert.match(listing.stdout, /images\/operators\/alpha\.png/);
    assert.match(listing.stdout, /images\/weapons\/beta\.webp/);
    assert.doesNotMatch(listing.stdout, /ignored\.txt/);
  }

  const builderSource = fs.readFileSync(new URL('./build-image-release-manifest.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(builderSource, /node:sqlite|data-management-service|timeline-repository/);
  console.log('Desktop image release builder smoke passed.');
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
