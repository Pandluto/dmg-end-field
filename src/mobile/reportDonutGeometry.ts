const FULL_CIRCLE_DEGREES = 360;
const FULL_CIRCLE_TOLERANCE = 1e-6;
const SEAM_OVERLAP_DEGREES = 0.16;

export interface ReportDonutSegment<T> {
  data: T;
  index: number;
  share: number;
  startAngle: number;
  endAngle: number;
}

interface Point {
  x: number;
  y: number;
}

function polarPoint(cx: number, cy: number, radius: number, angle: number): Point {
  const radians = angle * (Math.PI / 180);
  return {
    x: cx + Math.cos(radians) * radius,
    y: cy + Math.sin(radians) * radius,
  };
}

function formatPoint(point: Point): string {
  return `${Number(point.x.toFixed(6))} ${Number(point.y.toFixed(6))}`;
}

export function buildReportDonutSegments<T>(
  entries: T[],
  readWeight: (entry: T) => number,
  startAngle = -90,
): ReportDonutSegment<T>[] {
  const weighted = entries.flatMap((data, index) => {
    const weight = readWeight(data);
    return typeof weight === 'number' && Number.isFinite(weight) && weight > 0
      ? [{ data, index, weight }]
      : [];
  });
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return [];

  let cursor = startAngle;
  return weighted.map((entry, visibleIndex) => {
    const share = entry.weight / total;
    const endAngle = visibleIndex === weighted.length - 1
      ? startAngle + FULL_CIRCLE_DEGREES
      : cursor + share * FULL_CIRCLE_DEGREES;
    const segment = {
      data: entry.data,
      index: entry.index,
      share,
      startAngle: cursor,
      endAngle,
    };
    cursor = endAngle;
    return segment;
  });
}

export function buildReportDonutSegmentPath(
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  startAngle: number,
  endAngle: number,
): string {
  const rawSpan = endAngle - startAngle;
  const span = Math.min(FULL_CIRCLE_DEGREES, Math.max(0, rawSpan));
  if (span <= FULL_CIRCLE_TOLERANCE || outerRadius <= 0 || innerRadius < 0 || innerRadius >= outerRadius) {
    return '';
  }

  if (span >= FULL_CIRCLE_DEGREES - FULL_CIRCLE_TOLERANCE) {
    const outerStart = polarPoint(cx, cy, outerRadius, startAngle);
    const outerOpposite = polarPoint(cx, cy, outerRadius, startAngle + 180);
    const innerStart = polarPoint(cx, cy, innerRadius, startAngle);
    const innerOpposite = polarPoint(cx, cy, innerRadius, startAngle + 180);
    return [
      `M ${formatPoint(outerStart)}`,
      `A ${outerRadius} ${outerRadius} 0 0 1 ${formatPoint(outerOpposite)}`,
      `A ${outerRadius} ${outerRadius} 0 0 1 ${formatPoint(outerStart)}`,
      `L ${formatPoint(innerStart)}`,
      `A ${innerRadius} ${innerRadius} 0 0 0 ${formatPoint(innerOpposite)}`,
      `A ${innerRadius} ${innerRadius} 0 0 0 ${formatPoint(innerStart)}`,
      'Z',
    ].join(' ');
  }

  const overlap = Math.min(SEAM_OVERLAP_DEGREES, span / 2);
  const drawEndAngle = endAngle + overlap;
  const outerStart = polarPoint(cx, cy, outerRadius, startAngle);
  const outerEnd = polarPoint(cx, cy, outerRadius, drawEndAngle);
  const innerEnd = polarPoint(cx, cy, innerRadius, drawEndAngle);
  const innerStart = polarPoint(cx, cy, innerRadius, startAngle);
  const largeArc = span + overlap > 180 ? 1 : 0;
  return [
    `M ${formatPoint(outerStart)}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${formatPoint(outerEnd)}`,
    `L ${formatPoint(innerEnd)}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${formatPoint(innerStart)}`,
    'Z',
  ].join(' ');
}
