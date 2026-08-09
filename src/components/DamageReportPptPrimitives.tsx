import type { SyntheticEvent } from 'react';

const REPORT_POTENTIAL_STAR_SEGMENTS = [
  { id: 4, transform: undefined },
  { id: 3, transform: 'rotate(72 40 30)' },
  { id: 2, transform: 'rotate(144 40 30)' },
  { id: 1, transform: 'rotate(216 40 30)' },
  { id: 5, transform: 'rotate(288 40 30)' },
] as const;

function parsePotentialToCount(potential: string): number {
  if (potential.trim() === '满潜') return 6;
  const numeric = Number.parseInt(potential, 10);
  if (Number.isNaN(numeric)) return 1;
  return Math.min(6, Math.max(1, numeric + 1));
}

function getPotentialStarSegmentFill(segmentId: number, count: number): string {
  if (count === 6) return '#FFFFFF';
  if (segmentId === count) return '#FFF000';
  if (segmentId < count) return '#FFFFFF';
  return '#C7C7C7';
}

export function ReportPotentialStar({ count, potential }: { count?: number; potential?: string }) {
  const resolvedCount = typeof count === 'number'
    ? Math.min(6, Math.max(1, count))
    : parsePotentialToCount(potential ?? '0潜');
  return (
    <span className={`report-ppt-potential-star-wrap${resolvedCount === 6 ? ' is-max' : ''}`} aria-hidden="true">
      <svg
        className="report-ppt-potential-star"
        viewBox="-24 -26 126 122"
        focusable="false"
      >
        {REPORT_POTENTIAL_STAR_SEGMENTS.map((segment) => (
          <polygon
            key={segment.id}
            points="5,42 82,42 102,53 25,53"
            fill={getPotentialStarSegmentFill(segment.id, resolvedCount)}
            transform={segment.transform}
          />
        ))}
      </svg>
    </span>
  );
}

export function ReportLevelRows({ levels, className }: { levels: number[]; className: string }) {
  return (
    <div className={className}>
      {levels.slice(0, 3).map((level, index) => (
        <div key={index} className="report-ppt-level-row">
          <div className="report-ppt-level-capsule">
            <i className={level > 0 ? 'is-active' : ''} />
          </div>
          <strong>{level || '-'}</strong>
        </div>
      ))}
    </div>
  );
}

export function handleReportImageError(fallbackText: string) {
  return (event: SyntheticEvent<HTMLImageElement>) => {
    const target = event.currentTarget;
    let fallback = target.dataset.fallbackSrc;
    if (!fallback && target.dataset.fallbackSrcs) {
      try {
        const fallbackSources = JSON.parse(target.dataset.fallbackSrcs) as string[];
        fallback = fallbackSources.shift();
        target.dataset.fallbackSrcs = JSON.stringify(fallbackSources);
      } catch {
        target.dataset.fallbackSrcs = '';
      }
    }
    if (fallback && target.src !== fallback) {
      target.src = fallback;
      target.dataset.fallbackSrc = '';
      return;
    }
    target.style.display = 'none';
    target.parentElement?.setAttribute('data-fallback', fallbackText);
  };
}
