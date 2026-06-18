import type { ReactNode, RefObject } from 'react';

interface WorkbenchSplitSurfaceProps {
  rootClassName: string;
  layoutClassName?: string;
  layoutRef?: RefObject<HTMLDivElement>;
  children: ReactNode;
  overlay?: ReactNode;
}

/**
 * 主工作台共用的左右区壳层。
 *
 * 网格中的 240px 列是假右区，实际右区由调用方使用 canvas-right-zone
 * 绝对定位覆盖在最右侧；这与批量 Buff 工作台的尺寸关系保持一致。
 */
export function WorkbenchSplitSurface({
  rootClassName,
  layoutClassName = '',
  layoutRef,
  children,
  overlay,
}: WorkbenchSplitSurfaceProps) {
  return (
    <div className={`canvas-board ${rootClassName}`}>
      <div ref={layoutRef} className={`canvas-layout ${layoutClassName}`.trim()}>
        {children}
      </div>
      {overlay}
    </div>
  );
}
