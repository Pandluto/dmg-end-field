import assert from 'node:assert/strict';
import { persistTimelineIdToStorages, readTimelineIdFromStorages } from './timelineSession';

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

const sharedLocal = storage();
const tabA = storage();
const tabB = storage();

persistTimelineIdToStorages('formal-a', tabA, sharedLocal);
persistTimelineIdToStorages('formal-b', tabB, sharedLocal);

assert.equal(readTimelineIdFromStorages(tabA, sharedLocal), 'formal-a');
assert.equal(readTimelineIdFromStorages(tabB, sharedLocal), 'formal-b');
assert.equal(readTimelineIdFromStorages(storage(), sharedLocal), 'formal-b');

console.log('Timeline session tab-local SQLite identity contract: PASS');
