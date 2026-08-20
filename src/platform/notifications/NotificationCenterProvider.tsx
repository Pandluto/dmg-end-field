import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  countReadNotifications,
  countUnreadNotifications,
  deleteReadNotifications,
  listNotifications,
  markAllNotificationsRead,
  markKindRead,
  markNotificationRead,
  notifyNotification,
} from './notificationStore';
import type {
  AppNotification,
  NotificationInput,
  NotificationKind,
} from './notificationTypes';

type NotificationCenterContextValue = {
  ready: boolean;
  notifications: AppNotification[];
  unreadCount: number;
  readCount: number;
  notify: (input: NotificationInput) => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  deleteRead: () => Promise<number>;
  markKindRead: (kind: NotificationKind) => Promise<void>;
};

const NotificationCenterContext = createContext<NotificationCenterContextValue | null>(null);

export function useNotificationCenter(): NotificationCenterContextValue {
  const value = useContext(NotificationCenterContext);
  if (!value) {
    throw new Error('useNotificationCenter must be used inside NotificationCenterProvider.');
  }
  return value;
}

export function NotificationCenterProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [readCount, setReadCount] = useState(0);
  const hydratedRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!hydratedRef.current) return;
    const [nextNotifications, nextUnreadCount, nextReadCount] = await Promise.all([
      listNotifications(),
      countUnreadNotifications(),
      countReadNotifications(),
    ]);
    setNotifications(nextNotifications);
    setUnreadCount(nextUnreadCount);
    setReadCount(nextReadCount);
    setReady(true);
  }, []);
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    hydratedRef.current = true;
    void refresh();
  }, [refresh]);

  const notify = useCallback(async (input: NotificationInput) => {
    await notifyNotification(input);
    await refreshRef.current();
  }, []);

  const markRead = useCallback(async (id: string) => {
    await markNotificationRead(id);
    await refreshRef.current();
  }, []);

  const markAllRead = useCallback(async () => {
    await markAllNotificationsRead();
    await refreshRef.current();
  }, []);

  const deleteRead = useCallback(async () => {
    const deletedCount = await deleteReadNotifications();
    await refreshRef.current();
    return deletedCount;
  }, []);

  const markKindReadStable = useCallback(async (kind: NotificationKind) => {
    await markKindRead(kind);
    await refreshRef.current();
  }, []);

  const value = useMemo<NotificationCenterContextValue>(() => ({
    ready,
    notifications,
    unreadCount,
    readCount,
    notify,
    markRead,
    markAllRead,
    deleteRead,
    markKindRead: markKindReadStable,
  }), [deleteRead, markAllRead, markKindReadStable, markRead, notifications, notify, readCount, ready, unreadCount]);

  return (
    <NotificationCenterContext.Provider value={value}>
      {children}
    </NotificationCenterContext.Provider>
  );
}
