import assert from 'node:assert/strict';
import { runTimelineArchiveConversionForReload } from './timelineArchiveConversionFlow';

const convertedWorkspace = {
  document: { id: 'timeline-converted', label: '五色队-热启动循环' },
  checkoutRef: {
    timelineId: 'timeline-converted',
    targetType: 'snapshot' as const,
    targetId: 'snapshot-converted',
    updatedAt: 1,
  },
  payload: {
    selectedCharacters: ['洛茜'],
    skillButtonTable: {
      bzb6ptf17: {
        id: 'bzb6ptf17',
        characterId: '洛茜',
        characterName: '洛茜',
        skillType: 'A',
      },
    },
  },
};

const successCalls: string[] = [];
const success = await runTimelineArchiveConversionForReload({
  convert: async () => {
    successCalls.push('convert');
    return convertedWorkspace;
  },
  activate: (converted) => {
    successCalls.push(`activate:${converted.document.id}`);
  },
  reload: () => {
    successCalls.push('reload');
  },
});
assert.equal(success.status, 'reloading');
assert.deepEqual(successCalls, [
  'convert',
  'activate:timeline-converted',
  'reload',
]);

const conversionFailure = new Error('SQLite write failed');
let activatedAfterConversionFailure = false;
let reloadedAfterConversionFailure = false;
const failedConversion = await runTimelineArchiveConversionForReload({
  convert: async () => {
    throw conversionFailure;
  },
  activate: () => {
    activatedAfterConversionFailure = true;
  },
  reload: () => {
    reloadedAfterConversionFailure = true;
  },
});
assert.deepEqual(failedConversion, {
  status: 'conversion-failed',
  error: conversionFailure,
});
assert.equal(activatedAfterConversionFailure, false);
assert.equal(reloadedAfterConversionFailure, false);

const activationFailure = new Error('active timeline identity rejected');
let reloadedAfterActivationFailure = false;
const failedActivation = await runTimelineArchiveConversionForReload({
  convert: async () => convertedWorkspace,
  activate: () => {
    throw activationFailure;
  },
  reload: () => {
    reloadedAfterActivationFailure = true;
  },
});
assert.deepEqual(failedActivation, {
  status: 'activation-failed',
  converted: convertedWorkspace,
  error: activationFailure,
});
assert.equal(reloadedAfterActivationFailure, false);

console.log('Timeline archive SQLite conversion reload contract: PASS');
