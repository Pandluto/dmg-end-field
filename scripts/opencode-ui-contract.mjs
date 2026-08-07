import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const OPENCODE_UI_REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const OPENCODE_UI_LOCK_PATH = path.join(
  OPENCODE_UI_REPOSITORY_ROOT,
  'agent',
  'engines',
  'opencode',
  'native-ui-lock.json',
);

export function readOpenCodeUiLock() {
  const lock = JSON.parse(fs.readFileSync(OPENCODE_UI_LOCK_PATH, 'utf8'));
  if (
    lock?.schemaVersion !== 1
    || lock?.upstreamVersion !== '1.17.11'
    || typeof lock?.sourceRef !== 'string'
    || !lock.sourceRef
    || typeof lock?.artifact?.cachePath !== 'string'
    || typeof lock?.artifact?.runtimePath !== 'string'
    || !Number.isSafeInteger(lock?.artifact?.files)
    || !Number.isSafeInteger(lock?.artifact?.bytes)
    || !/^[0-9a-f]{64}$/u.test(lock?.artifact?.sha256 ?? '')
  ) {
    throw new Error('OpenCode native UI lock is invalid');
  }
  return lock;
}

export function resolveOpenCodeUiLayout(root = OPENCODE_UI_REPOSITORY_ROOT) {
  const lock = readOpenCodeUiLock();
  return {
    lock,
    cachePath: resolveInside(root, lock.artifact.cachePath, 'cachePath'),
    runtimePath: lock.artifact.runtimePath,
  };
}

export function inspectOpenCodeUiTree(root) {
  const canonicalRoot = path.resolve(root);
  const hash = crypto.createHash('sha256');
  let files = 0;
  let bytes = 0;
  visit(canonicalRoot);
  return { files, bytes, sha256: hash.digest('hex') };

  function visit(directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => (
        left.name < right.name ? -1 : left.name > right.name ? 1 : 0
      ));
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      const relative = path.relative(canonicalRoot, target).split(path.sep).join('/');
      if (entry.isSymbolicLink()) throw new Error(`OpenCode native UI contains a symbolic link: ${relative}`);
      if (entry.isDirectory()) {
        visit(target);
        continue;
      }
      if (!entry.isFile()) throw new Error(`OpenCode native UI contains a non-file entry: ${relative}`);
      const body = fs.readFileSync(target);
      files += 1;
      bytes += body.length;
      hash.update(relative, 'utf8');
      hash.update('\0');
      hash.update(body);
      hash.update('\0');
    }
  }
}

export function verifyOpenCodeUiTree(root, expected = readOpenCodeUiLock().artifact) {
  const indexPath = path.join(root, 'index.html');
  const markerPath = path.join(root, 'def-opencode-ui.json');
  if (!fs.existsSync(indexPath) || !fs.statSync(indexPath).isFile()) {
    throw new Error('OpenCode native UI index is missing');
  }
  if (!fs.existsSync(markerPath) || !fs.statSync(markerPath).isFile()) {
    throw new Error('OpenCode native UI provenance marker is missing');
  }
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  if (
    marker?.source !== '@opencode-ai/app'
    || marker?.upstreamVersion !== '1.17.11'
    || marker?.embeddedProfile !== 'def'
    || marker?.embeddedProfileVersion !== 1
  ) {
    throw new Error('OpenCode native UI provenance marker does not match the locked DEF profile');
  }
  const actual = inspectOpenCodeUiTree(root);
  if (
    actual.files !== expected.files
    || actual.bytes !== expected.bytes
    || actual.sha256 !== expected.sha256
  ) {
    throw new Error('OpenCode native UI cache does not match its lock');
  }
  return actual;
}

function resolveInside(root, relativePath, label) {
  const canonicalRoot = path.resolve(root);
  const target = path.resolve(canonicalRoot, relativePath);
  if (target === canonicalRoot || !target.startsWith(`${canonicalRoot}${path.sep}`)) {
    throw new Error(`OpenCode native UI ${label} escapes the repository root`);
  }
  return target;
}
