import assert from 'node:assert/strict';
import {
  buildReportDonutSegmentPath,
  buildReportDonutSegments,
} from './reportDonutGeometry';

const segments = buildReportDonutSegments([93.5, 3.9, 1.3, 1.3], (value) => value);
assert.equal(segments.length, 4);
assert.equal(segments[0].startAngle, -90);
assert.equal(segments.at(-1)?.endAngle, 270, 'the final segment must close on the exact start axis');
segments.slice(1).forEach((segment, index) => {
  assert.equal(segment.startAngle, segments[index].endAngle, 'adjacent segments must share one boundary');
});
assert.equal(segments.reduce((sum, segment) => sum + segment.share, 0), 1);

const fullCirclePath = buildReportDonutSegmentPath(100, 100, 83, 49, -90, 270);
assert.equal((fullCirclePath.match(/ A /g) ?? []).length, 4, 'a full ring needs two outer and two inner arcs');
assert.ok(fullCirclePath.endsWith(' Z'));
assert.doesNotMatch(fullCirclePath, /NaN|Infinity/);

const partialPath = buildReportDonutSegmentPath(100, 100, 83, 49, -90, 246.6);
assert.equal((partialPath.match(/ A /g) ?? []).length, 2);
assert.ok(partialPath.endsWith(' Z'));
assert.equal(buildReportDonutSegmentPath(100, 100, 83, 49, 0, 0), '');
