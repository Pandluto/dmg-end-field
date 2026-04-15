/**
 * 响应式画布宽度 Hook
 * 根据视口宽度和配置比例计算画布实际宽度，监听 resize 事件实时更新
 *
 * @param canvasWidthPercent - 画布占视口宽度的比例（如 0.6 表示 60%）
 * @returns 画布宽度（px），最大不超过 1200px
 */
import { useState, useEffect } from 'react';

export function useCanvasWidth(canvasWidthPercent: number): number {
  const [canvasWidth, setCanvasWidth] = useState(960);

  useEffect(() => {
    const updateWidth = () => {
      const width = window.innerWidth * canvasWidthPercent;
      setCanvasWidth(Math.min(width, 1200));
    };

    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, [canvasWidthPercent]);

  return canvasWidth;
}
