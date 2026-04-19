/**
 * Buff 交互管理 Hook
 * 负责单击、双击、长按拖拽、释放判定
 * 不直接操作 storage，通过回调通知外部
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { CandidateBuff } from '../core/domain/buff';

export interface UseBuffInteractionOptions {
  /** 添加 Buff 回调 */
  onAddBuff: (buff: CandidateBuff) => void;
  /** 打开 Buff 详情回调 */
  onOpenBuffDetail: (buff: CandidateBuff) => void;
  /** 检查点是否在投放区域内 */
  isPointInDropZone: (x: number, y: number) => boolean;
}

export interface UseBuffInteractionReturn {
  /** 当前是否处于长按准备阶段 */
  isLongPressPreparing: boolean;
  /** 当前是否进入拖拽状态 */
  isDragging: boolean;
  /** 当前被拖拽的 Buff 数据 */
  draggedBuff: CandidateBuff | null;
  /** 当前拖拽位置 */
  dragPosition: { x: number; y: number };
  /** 选中的 Buff（用于弹窗显示详情） */
  selectedBuff: CandidateBuff | null;
  /** 弹窗是否打开 */
  isModalOpen: boolean;
  /** 处理 Buff 项点击事件（单击/双击判定） */
  handleBuffClick: (buff: CandidateBuff) => void;
  /** 处理 Buff 项鼠标按下（开始长按检测） */
  handleBuffMouseDown: (buff: CandidateBuff, e: React.MouseEvent) => void;
  /** 关闭弹窗 */
  handleCloseModal: () => void;
}

/** 长按阈值 200ms（与双击一致） */
const LONG_PRESS_THRESHOLD = 200;
/** 拖拽阈值 5px */
const DRAG_THRESHOLD = 5;

/**
 * Buff 交互管理 Hook
 * @param options 交互回调配置
 * @returns 交互状态和处理器
 */
export function useBuffInteraction(options: UseBuffInteractionOptions): UseBuffInteractionReturn {
  const { onAddBuff, onOpenBuffDetail, isPointInDropZone } = options;

  // 用于区分单击/双击的引用
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clickCountRef = useRef(0);
  // 抑制下一次点击（长按触发后需要抑制随后的 click 事件）
  const suppressNextClickRef = useRef(false);

  // 长按拖拽状态
  const [isLongPressPreparing, setIsLongPressPreparing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [draggedBuff, setDraggedBuff] = useState<CandidateBuff | null>(null);
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });

  // 长按定时器引用
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 拖拽起始位置
  const dragStartPosRef = useRef({ x: 0, y: 0 });
  // 是否已触发长按
  const hasLongPressedRef = useRef(false);

  // 弹窗状态
  const [selectedBuff, setSelectedBuff] = useState<CandidateBuff | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  /**
   * 清理拖拽状态
   */
  const clearDragState = useCallback(() => {
    setIsLongPressPreparing(false);
    setIsDragging(false);
    setDraggedBuff(null);
    hasLongPressedRef.current = false;
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  /**
   * 处理 Buff 项点击事件
   * 用 0.2s 区分单击和双击
   * 单击：添加 Buff
   * 双击：打开 Buff 详细信息
   */
  const handleBuffClick = useCallback((buff: CandidateBuff) => {
    // 如果长按触发了拖拽，抑制随后的 click 事件
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      clickCountRef.current = 0;
      return;
    }

    clickCountRef.current += 1;

    if (clickCountRef.current === 1) {
      // 第一次点击，启动定时器
      clickTimerRef.current = setTimeout(() => {
        // 0.2s 后如果没有第二次点击，视为单击
        if (clickCountRef.current === 1) {
          onAddBuff(buff);
        }
        clickCountRef.current = 0;
      }, 200);
    } else if (clickCountRef.current === 2) {
      // 第二次点击，视为双击
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      clickCountRef.current = 0;
      setSelectedBuff(buff);
      setIsModalOpen(true);
      onOpenBuffDetail(buff);
    }
  }, [onAddBuff, onOpenBuffDetail]);

  /**
   * 处理 Buff 项鼠标按下（开始长按检测）
   */
  const handleBuffMouseDown = useCallback((buff: CandidateBuff, e: React.MouseEvent) => {
    // 只有左键才触发
    if (e.button !== 0) return;

    // 记录起始位置
    dragStartPosRef.current = { x: e.clientX, y: e.clientY };
    hasLongPressedRef.current = false;

    // 启动长按定时器
    longPressTimerRef.current = setTimeout(() => {
      hasLongPressedRef.current = true;
      suppressNextClickRef.current = true; // 长按触发，标记抑制下一次 click
      setIsLongPressPreparing(false);
      setIsDragging(true);
      setDraggedBuff(buff);
      setDragPosition({ x: e.clientX, y: e.clientY });
    }, LONG_PRESS_THRESHOLD);

    setIsLongPressPreparing(true);
  }, []);

  /**
   * 处理鼠标移动（拖拽中）
   */
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) {
      // 如果还没进入拖拽态，检查是否移动超过阈值
      if (isLongPressPreparing && longPressTimerRef.current) {
        const dx = Math.abs(e.clientX - dragStartPosRef.current.x);
        const dy = Math.abs(e.clientY - dragStartPosRef.current.y);
        if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
          // 移动超过阈值，取消长按
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
          setIsLongPressPreparing(false);
        }
      }
      return;
    }

    // 更新拖拽位置
    setDragPosition({ x: e.clientX, y: e.clientY });
  }, [isDragging, isLongPressPreparing]);

  /**
   * 处理鼠标释放（拖拽结束）
   */
  const handleMouseUp = useCallback((e: MouseEvent) => {
    // 如果还在长按准备阶段，说明是点击而非拖拽
    if (isLongPressPreparing) {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      setIsLongPressPreparing(false);

      // 如果没有触发长按，让点击事件处理
      if (!hasLongPressedRef.current) {
        return;
      }
    }

    // 如果不在拖拽态，不处理
    if (!isDragging || !draggedBuff) {
      return;
    }

    // 检查是否在投放区域内释放
    const isOverDropZone = isPointInDropZone(e.clientX, e.clientY);
    if (isOverDropZone) {
      // 执行添加
      onAddBuff(draggedBuff);
    }

    // 清理状态
    clearDragState();
  }, [isDragging, isLongPressPreparing, draggedBuff, isPointInDropZone, onAddBuff, clearDragState]);

  /**
   * 关闭弹窗
   */
  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
    setSelectedBuff(null);
  }, []);

  /**
   * 全局鼠标事件监听
   */
  useEffect(() => {
    if (isDragging || isLongPressPreparing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, isLongPressPreparing, handleMouseMove, handleMouseUp]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
      }
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

  return {
    isLongPressPreparing,
    isDragging,
    draggedBuff,
    dragPosition,
    selectedBuff,
    isModalOpen,
    handleBuffClick,
    handleBuffMouseDown,
    handleCloseModal,
  };
}
