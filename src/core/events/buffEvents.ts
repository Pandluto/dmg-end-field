/**
 * Buff Events
 * 统一封装 Buff 相关事件的派发和监听
 * 组件不得手写事件名字符串
 */

export const BUFF_EVENT_NAMES = {
  BUFF_ADDED: 'skillbutton-buff-added',
  BUFF_REMOVED: 'skillbutton-buff-removed',
} as const;

export interface BuffEventPayload {
  buttonId: string;
  buffId: string;
}

/**
 * 派发 Buff 添加事件
 */
export function emitSkillButtonBuffAdded(buttonId: string, buffId: string): void {
  window.dispatchEvent(
    new CustomEvent(BUFF_EVENT_NAMES.BUFF_ADDED, {
      detail: { buttonId, buffId },
    })
  );
}

/**
 * 监听 Buff 添加事件
 * @returns unsubscribe 函数
 */
export function onSkillButtonBuffAdded(
  handler: (payload: BuffEventPayload) => void
): () => void {
  const wrappedHandler = (event: CustomEvent) => {
    handler(event.detail as BuffEventPayload);
  };

  window.addEventListener(
    BUFF_EVENT_NAMES.BUFF_ADDED,
    wrappedHandler as EventListener
  );

  return () => {
    window.removeEventListener(
      BUFF_EVENT_NAMES.BUFF_ADDED,
      wrappedHandler as EventListener
    );
  };
}

/**
 * 派发 Buff 删除事件
 */
export function emitSkillButtonBuffRemoved(buttonId: string, buffId: string): void {
  window.dispatchEvent(
    new CustomEvent(BUFF_EVENT_NAMES.BUFF_REMOVED, {
      detail: { buttonId, buffId },
    })
  );
}

/**
 * 监听 Buff 删除事件
 * @returns unsubscribe 函数
 */
export function onSkillButtonBuffRemoved(
  handler: (payload: BuffEventPayload) => void
): () => void {
  const wrappedHandler = (event: CustomEvent) => {
    handler(event.detail as BuffEventPayload);
  };

  window.addEventListener(
    BUFF_EVENT_NAMES.BUFF_REMOVED,
    wrappedHandler as EventListener
  );

  return () => {
    window.removeEventListener(
      BUFF_EVENT_NAMES.BUFF_REMOVED,
      wrappedHandler as EventListener
    );
  };
}
