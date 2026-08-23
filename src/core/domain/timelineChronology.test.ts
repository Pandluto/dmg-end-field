import assert from 'node:assert/strict';
import { compareTimelineChronology } from './timelineChronology';

const entries = [
  { id: 'group-2-first', nodeIndex: 15, staffIndex: 0 },
  { id: 'group-1-third', nodeIndex: 2, staffIndex: 0 },
  { id: 'group-1-second-row-2', nodeIndex: 1, staffIndex: 2 },
  { id: 'group-1-second-row-1-b', nodeIndex: 1, staffIndex: 1 },
  { id: 'group-1-second-row-1-a', nodeIndex: 1, staffIndex: 1 },
];

assert.deepEqual(
  [...entries].sort(compareTimelineChronology).map((entry) => entry.id),
  [
    'group-1-second-row-1-a',
    'group-1-second-row-1-b',
    'group-1-second-row-2',
    'group-1-third',
    'group-2-first',
  ],
  'damage chronology follows global node order before row and stable id tie-breakers',
);
