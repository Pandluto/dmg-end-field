interface NotificationBellProps {
  unreadCount: number;
  open: boolean;
  onClick: () => void;
}

export function NotificationBell({ unreadCount, open, onClick }: NotificationBellProps) {
  const label = open
    ? '关闭通知面板'
    : unreadCount > 0
      ? `打开通知面板，${unreadCount} 条未读`
      : '打开通知面板';
  return (
    <button
      className={`web-shell-notification-button${open ? ' is-open' : ''}`}
      type="button"
      aria-label={label}
      aria-expanded={open}
      title="通知"
      onClick={onClick}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M18 9a6 6 0 1 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 15 18 9Z" />
        <path d="M10 19.5a2.2 2.2 0 0 0 4 0" />
      </svg>
      {unreadCount > 0 && (
        <span className="web-shell-notification-badge" aria-hidden="true">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  );
}
