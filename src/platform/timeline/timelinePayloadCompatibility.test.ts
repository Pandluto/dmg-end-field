import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  normalizeCompatibleTimelinePayload,
  TimelinePayloadCompatibilityError,
} from './timelinePayloadCompatibility';
import { validateTimelinePayload } from '../../agentKernel/timelineWorktree/validator';
import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';

type LegacySnapshot = {
  label: string;
  payload: TimelineSnapshotPayload;
};

const legacySourceUrl = new URL(
  '../../../data/sharedata/share-20260718-003031-7-18.json',
  import.meta.url,
);
const generatedPackage = JSON.parse(fs.readFileSync(
  new URL('../../../public/data/default-local-data.json', import.meta.url),
  'utf8',
)) as {
  timelineArchives?: Array<{
    archiveId?: string;
    label: string;
    payload: TimelineSnapshotPayload;
  }>;
};
const source = fs.existsSync(legacySourceUrl)
  ? JSON.parse(fs.readFileSync(legacySourceUrl, 'utf8')) as {
  storage: {
    local: {
      'def.timeline.snapshot-archive.v1': {
        snapshots: LegacySnapshot[];
      };
    };
  };
}
  : null;
const snapshots = source
  ? source.storage.local['def.timeline.snapshot-archive.v1'].snapshots
  : (generatedPackage.timelineArchives || [])
    .filter(({ archiveId }) => archiveId !== 'web-lts-1.8-shared-current');
assert.equal(snapshots.length, 12);

for (const snapshot of snapshots) {
  const result = normalizeCompatibleTimelinePayload(snapshot.payload);
  assert.deepEqual(
    validateTimelinePayload(result.payload),
    { ok: true, issues: [] },
    snapshot.label,
  );
  const expectedButtonCount = Object.keys(snapshot.payload.skillButtonTable).length;
  const actualButtonCount = result.payload.timelineData.staffLines.reduce(
    (count, line) => count + line.buttons.length,
    0,
  );
  assert.equal(actualButtonCount, expectedButtonCount, snapshot.label);
}

const firstPayload = snapshots[0].payload;
const originalFirstButton = firstPayload.timelineData.staffLines[0].buttons[0];
assert.equal(originalFirstButton.characterId, undefined);
assert.equal(originalFirstButton.buffIds, undefined);
const normalizedFirst = normalizeCompatibleTimelinePayload(firstPayload);
const repairedFirstButton = normalizedFirst.payload.timelineData.staffLines[0].buttons[0];
const repairedFirstTableButton = normalizedFirst.payload.skillButtonTable[repairedFirstButton.id];
assert.equal(repairedFirstButton.characterId, 'laevatain');
assert.equal(repairedFirstButton.lineIndex, 0);
assert.deepEqual(repairedFirstButton.buffIds, repairedFirstTableButton.selectedBuff);
assert.equal(originalFirstButton.characterId, undefined, 'normalization must not mutate imported JSON');
assert(normalizedFirst.repairs.some((repair) => repair.code === 'legacy-button-identities-repaired'));

assert.throws(
  () => normalizeCompatibleTimelinePayload({
    ...firstPayload,
    selectedCharacters: [],
  }),
  TimelinePayloadCompatibilityError,
);

assert.ok(
  (generatedPackage.timelineArchives?.length || 0) > 0,
  'the generated package must retain at least one compatible timeline archive',
);
for (const archive of generatedPackage.timelineArchives || []) {
  assert.deepEqual(
    validateTimelinePayload(normalizeCompatibleTimelinePayload(archive.payload).payload),
    { ok: true, issues: [] },
    archive.label,
  );
}

console.log('Legacy Share Data timeline payload compatibility: PASS');
