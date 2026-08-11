import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const sourcePath = fileURLToPath(new URL('./index.tsx', import.meta.url));
const source = fs.readFileSync(sourcePath, 'utf8');
const saveStart = source.indexOf('const handleSaveWorkNodeCheckpoint');
const saveEnd = source.indexOf('\n  const handleOpenSaveSnapshotModal', saveStart);

assert.ok(saveStart >= 0, 'the Work Node save handler must remain present');
assert.ok(saveEnd > saveStart, 'the Work Node save handler boundary must remain detectable');

const saveHandler = source.slice(saveStart, saveEnd);
const canonicalizeAt = saveHandler.indexOf('buildVisibleTimelineMirrors(');
const validateAt = saveHandler.indexOf('validateTimelinePayload(payload)');
const flushAt = saveHandler.indexOf('await flushUserWorkspaceState()');
const createAt = saveHandler.indexOf('createAiTimelineWorkNodeClient().create(');

assert.ok(canonicalizeAt >= 0, 'every save must rebuild the visible timeline and table mirrors');
assert.ok(validateAt > canonicalizeAt, 'save must validate the rebuilt payload');
assert.ok(flushAt > validateAt, 'save must durably flush the validated live payload');
assert.ok(createAt > flushAt, 'user.sqlite must be durable before a Work Node mutation starts');
assert.doesNotMatch(
  saveHandler,
  /if \(!activeCheckoutRef\)[\s\S]*?buildVisibleTimelineMirrors/,
  'an existing checkout must not bypass visible mirror canonicalization',
);
assert.doesNotMatch(saveHandler, /location\.reload/, 'a failed manual save must never reload the page');

console.log('Timeline Work Node save data-safety contract: PASS');
