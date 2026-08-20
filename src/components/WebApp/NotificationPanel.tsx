import { formatRelativeNotificationTime } from '../../platform/notifications/notificationFormat';
import type { AppNotification } from '../../platform/notifications/notificationTypes';

interface NotificationPanelProps {
  notifications: AppNotification[];
  unreadCount: number;
  readCount: number;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onDeleteRead: () => void;
  onAction: (notification: AppNotification) => void;
}

export function NotificationPanel({
  notifications,
  unreadCount,
  readCount,
  onMarkRead,
  onMarkAllRead,
  onDeleteRead,
  onAction,
}: NotificationPanelProps) {
  return (
    <section className="web-shell-notification-panel" role="dialog" aria-label="通知中心">
      <header className="web-shell-notification-panel-header">
        <div className="web-shell-notification-panel-summary">
          <strong>通知</strong>
          <small>{unreadCount > 0 ? `${unreadCount} 条未读` : '已全部读完了'}</small>
        </div>
        <div className="web-shell-notification-panel-header-actions">
          <button
            type="button"
            disabled={unreadCount === 0}
            onClick={onMarkAllRead}
          >
            全部已读
          </button>
          <button
            type="button"
            className="is-delete-read"
            disabled={readCount === 0}
            onClick={onDeleteRead}
          >
            删除已读
          </button>
        </div>
      </header>
      <div className="web-shell-notification-list">
        {notifications.length === 0 ? (
          <p className="web-shell-notification-empty">这里还没有通知。</p>
        ) : notifications.map((notification) => {
          const unread = notification.readAt === null;
          return (
            <article
              key={notification.id}
              className={[
                'web-shell-notification-item',
                `is-${notification.severity}`,
                unread ? 'is-unread' : 'is-read',
              ].join(' ')}
              tabIndex={0}
              role="button"
              aria-label={`${notification.title}${unread ? '，未读，点击标记已读' : ''}`}
              onClick={() => {
                if (unread) onMarkRead(notification.id);
              }}
              onKeyDown={(event) => {
                if (!unread) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onMarkRead(notification.id);
                }
              }}
            >
              <span className="web-shell-notification-dot" aria-hidden="true" />
              <div className="web-shell-notification-copy">
                <div className="web-shell-notification-title-row">
                  <strong>{notification.title}</strong>
                  <time dateTime={new Date(notification.createdAt).toISOString()}>
                    {formatRelativeNotificationTime(notification.createdAt)}
                  </time>
                </div>
                <p>{notification.body}</p>
                <div className="web-shell-notification-actions">
                  {notification.action && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onAction(notification);
                      }}
                    >
                      {notification.action.label}
                    </button>
                  )}
                  {unread && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onMarkRead(notification.id);
                      }}
                    >
                      标记已读
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
