/**
 * 禁止画布区域文本选择
 * 在 CanvasBoard 挂载时注册 selectstart 事件监听，
 * 防止用户拖拽按钮时误选中文本（浏览器默认行为）
 */
import { useEffect } from 'react';

export function useSelectStart() {
  useEffect(() => {
    const handleSelectStart = (e: Event) => {
      const target = e.target as HTMLElement;
      if (target && typeof target.closest === 'function' && target.closest('.canvas-board')) {
        e.preventDefault();
      }
    };

    document.addEventListener('selectstart', handleSelectStart);
    return () => document.removeEventListener('selectstart', handleSelectStart);
  }, []);
}
