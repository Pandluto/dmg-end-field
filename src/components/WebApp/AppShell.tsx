import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { OptionalLiquidTideSurfaceEffects } from '../../platform/theme/OptionalLiquidTideEffects';
import { APP_VERSION_LABEL } from '../../platform/runtime/appVersion';
import {
  readOfflineAvailability,
  type OfflineAvailability,
} from '../../platform/runtime/serviceWorkerRuntime';
import { usePageVersionUpdate } from '../../platform/runtime/usePageVersionUpdate';
import { isDesktopRuntime } from '../../platform/desktop/desktopHost';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../../utils/appRoute';
import './app-shell.css';

type NavKey = 'start' | 'timeline' | 'data' | 'settings';

interface AppShellProps {
  currentPath: string;
  children: ReactNode;
  overlay?: ReactNode;
}

type SectionMeta = {
  key: NavKey;
  title: string;
  description: string;
};

type LauncherPosition = {
  x: number;
  y: number;
};

type LauncherDragState = {
  pointerId: number;
  target: HTMLButtonElement;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  moved: boolean;
};

const LAUNCHER_SIZE = 44;
const LAUNCHER_MARGIN = 8;
const LAUNCHER_DRAG_THRESHOLD = 4;
const LAUNCHER_DEFAULT_POSITION: LauncherPosition = { x: 10, y: 10 };

function clampLauncherPosition(
  position: LauncherPosition,
  viewportWidth: number,
  viewportHeight: number,
): LauncherPosition {
  return {
    x: Math.min(
      Math.max(position.x, LAUNCHER_MARGIN),
      Math.max(LAUNCHER_MARGIN, viewportWidth - LAUNCHER_SIZE - LAUNCHER_MARGIN),
    ),
    y: Math.min(
      Math.max(position.y, LAUNCHER_MARGIN),
      Math.max(LAUNCHER_MARGIN, viewportHeight - LAUNCHER_SIZE - LAUNCHER_MARGIN),
    ),
  };
}

function sectionMeta(path: string, desktopMode = false): SectionMeta {
  if (path === APP_ROUTE_PATHS.settings) {
    return {
      key: 'settings',
      title: '设置',
      description: desktopMode ? '桌面宿主、存储与备份' : '存储、备份与访问',
    };
  }
  if (path === APP_ROUTE_PATHS.welcome || path === APP_ROUTE_PATHS.root) {
    return {
      key: 'start',
      title: '开始',
      description: '本地工作区',
    };
  }
  if (path.startsWith('/data')) {
    return {
      key: 'data',
      title: '数据',
      description: '资料与资源',
    };
  }
  return {
    key: 'timeline',
    title: '工作区',
    description: '排轴与计算',
  };
}

function NavGlyph({ name }: { name: NavKey }) {
  if (name === 'start') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 11.4 12 4l8 7.4v8.1a.5.5 0 0 1-.5.5h-5v-5.5h-5V20h-5a.5.5 0 0 1-.5-.5v-8.1Z" />
      </svg>
    );
  }
  if (name === 'timeline') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 5v14M19 5v14M5 8h6l2 3h6M5 16h5l2-3h7" />
      </svg>
    );
  }
  if (name === 'data') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <ellipse cx="12" cy="6" rx="7.5" ry="3" />
        <path d="M4.5 6v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6M4.5 12v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7.3 7.3 0 0 0-.1-1l2-1.5-2-3.4-2.5 1a8 8 0 0 0-1.8-1L14.2 3h-4.4l-.4 3.1a8 8 0 0 0-1.8 1l-2.5-1-2 3.4 2 1.5a7.3 7.3 0 0 0 0 2l-2 1.5 2 3.4 2.5-1a8 8 0 0 0 1.8 1l.4 3.1h4.4l.4-3.1a8 8 0 0 0 1.8-1l2.5 1 2-3.4-2-1.5c.1-.3.1-.7.1-1Z" />
    </svg>
  );
}

function BrandLogo() {
  return (
    <span className="web-shell-brand-mark" aria-hidden="true">
      <img src="./app-icon.png" alt="" draggable={false} />
    </span>
  );
}

export function AppShell({ currentPath, children, overlay }: AppShellProps) {
  const desktopMode = isDesktopRuntime();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(
    () => typeof navigator === 'undefined' || navigator.onLine,
  );
  const [offlineAvailability, setOfflineAvailability] = useState<OfflineAvailability>({
    supported: true,
    ready: false,
  });
  const { state: pageVersionUpdate, update: updatePageVersion } = usePageVersionUpdate();
  const [launcherPosition, setLauncherPosition] = useState<LauncherPosition>(
    () => ({ ...LAUNCHER_DEFAULT_POSITION }),
  );
  const [isLauncherDragging, setIsLauncherDragging] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const launcherRef = useRef<HTMLDivElement | null>(null);
  const launcherDragRef = useRef<LauncherDragState | null>(null);
  const suppressLauncherClickRef = useRef(false);
  const meta = sectionMeta(currentPath, desktopMode);
  const navItems: Array<{ key: NavKey; label: string; path: string }> = [
    { key: 'start', label: '开始', path: APP_ROUTE_PATHS.welcome },
    { key: 'timeline', label: '工作区', path: APP_ROUTE_PATHS.timelineWorkspace },
    { key: 'data', label: '数据', path: APP_ROUTE_PATHS.dataWorkspace },
    { key: 'settings', label: '设置', path: APP_ROUTE_PATHS.settings },
  ];
  const windowNavItems = navItems.filter((item) => item.key !== 'timeline');
  const showLauncher = !overlay;
  const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? 720 : window.innerHeight;
  const launcherOpensLeft = launcherPosition.x + 320 > viewportWidth - LAUNCHER_MARGIN;
  const launcherVerticalAlignment = launcherPosition.y < 156
    ? 'top'
    : launcherPosition.y + 200 > viewportHeight
      ? 'bottom'
      : 'center';
  const pageVersionTargetLabel = pageVersionUpdate.latestVersionLabel
    || pageVersionUpdate.currentVersionLabel;
  const pageVersionHasNewRelease = pageVersionUpdate.latestVersionLabel !== null
    && pageVersionUpdate.latestVersionLabel !== pageVersionUpdate.currentVersionLabel;
  const pageVersionDiscoveryLabel = pageVersionHasNewRelease
    ? '发现新版本'
    : '发现页面更新';
  const pageVersionCanUpdate = isOnline
    && ['update-available', 'update-failed'].includes(pageVersionUpdate.phase);
  const pageVersionBusy = ['checking', 'updating'].includes(pageVersionUpdate.phase);

  const handleLauncherPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    suppressLauncherClickRef.current = false;
    launcherDragRef.current = {
      pointerId: event.pointerId,
      target: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
      originX: launcherPosition.x,
      originY: launcherPosition.y,
      moved: false,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Window-level listeners keep dragging available without pointer capture.
    }
  };

  const handleLauncherClick = () => {
    if (suppressLauncherClickRef.current) {
      suppressLauncherClickRef.current = false;
      return;
    }
    setMenuOpen((open) => !open);
  };

  useEffect(() => {
    setMenuOpen(false);
  }, [currentPath]);

  useEffect(() => {
    if (desktopMode) return undefined;
    const refreshOfflineAvailability = () => {
      void readOfflineAvailability().then(setOfflineAvailability);
    };
    const handleOnline = () => {
      setIsOnline(true);
      refreshOfflineAvailability();
    };
    const handleOffline = () => {
      setIsOnline(false);
      refreshOfflineAvailability();
    };

    setIsOnline(navigator.onLine);
    refreshOfflineAvailability();
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    navigator.serviceWorker?.addEventListener('controllerchange', refreshOfflineAvailability);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      navigator.serviceWorker?.removeEventListener('controllerchange', refreshOfflineAvailability);
    };
  }, [desktopMode]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const dragState = launcherDragRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) return;

      const deltaX = event.clientX - dragState.startX;
      const deltaY = event.clientY - dragState.startY;
      if (!dragState.moved && Math.hypot(deltaX, deltaY) < LAUNCHER_DRAG_THRESHOLD) {
        return;
      }

      if (!dragState.moved) {
        dragState.moved = true;
        setIsLauncherDragging(true);
        setMenuOpen(false);
      }

      event.preventDefault();
      setLauncherPosition(clampLauncherPosition(
        {
          x: dragState.originX + deltaX,
          y: dragState.originY + deltaY,
        },
        window.innerWidth,
        window.innerHeight,
      ));
    };

    const finishLauncherDrag = (event: PointerEvent, cancelled = false) => {
      const dragState = launcherDragRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) return;

      if (!cancelled && dragState.moved) {
        suppressLauncherClickRef.current = true;
      }
      launcherDragRef.current = null;
      setIsLauncherDragging(false);

      try {
        if (dragState.target.hasPointerCapture(event.pointerId)) {
          dragState.target.releasePointerCapture(event.pointerId);
        }
      } catch {
        // The pointer may already have been released by the browser.
      }
    };

    const handlePointerUp = (event: PointerEvent) => finishLauncherDrag(event);
    const handlePointerCancel = (event: PointerEvent) => finishLauncherDrag(event, true);

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setLauncherPosition((current) => clampLauncherPosition(
        current,
        window.innerWidth,
        window.innerHeight,
      ));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!launcherRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (menuOpen) {
        setMenuOpen(false);
        return;
      }
      if (overlay) {
        navigateToAppPath(APP_ROUTE_PATHS.timelineWorkspace);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen, overlay]);

  return (
    <div ref={shellRef} className={`web-app-shell ${overlay ? 'has-overlay' : ''}`}>
      <OptionalLiquidTideSurfaceEffects rootRef={shellRef} activationKey={currentPath} />
      <main className="web-shell-content">{children}</main>

      {showLauncher && (
        <div
          className={[
            'web-shell-launcher',
            menuOpen ? 'is-open' : '',
            isLauncherDragging ? 'is-dragging' : '',
            launcherOpensLeft ? 'opens-left' : 'opens-right',
            `align-${launcherVerticalAlignment}`,
          ].filter(Boolean).join(' ')}
          ref={launcherRef}
          style={{
            transform: `translate3d(${launcherPosition.x}px, ${launcherPosition.y}px, 0)`,
          }}
        >
          <button
            className="web-shell-menu-button"
            type="button"
            aria-label={menuOpen ? '关闭工作台菜单' : '打开工作台菜单'}
            aria-expanded={menuOpen}
            title="拖动移动，点击打开菜单"
            onPointerDown={handleLauncherPointerDown}
            onClick={handleLauncherClick}
            onDragStart={(event) => event.preventDefault()}
          >
            <BrandLogo />
          </button>

          {menuOpen && (
            <div className="web-shell-popover">
              <div className="web-shell-popover-heading">
                <BrandLogo />
                <span>
                  <strong>终末地伤害工作台</strong>
                  <small>{desktopMode ? 'Desktop LTS' : 'Web LTS'} {APP_VERSION_LABEL}</small>
                </span>
              </div>

              <nav className="web-shell-nav" aria-label="工作台导航">
                {navItems.map((item) => (
                  <button
                    key={item.key}
                    className={meta.key === item.key ? 'is-active' : ''}
                    type="button"
                    onClick={() => navigateToAppPath(item.path)}
                  >
                    <span className="web-shell-nav-icon"><NavGlyph name={item.key} /></span>
                    <span>{item.label}</span>
                    {meta.key === item.key && <span className="web-shell-nav-check">✓</span>}
                  </button>
                ))}
              </nav>

              {!desktopMode && <button
                className={`web-shell-local-state is-${pageVersionUpdate.phase}`}
                type="button"
                disabled={!pageVersionCanUpdate}
                aria-label={pageVersionCanUpdate
                  ? `${pageVersionDiscoveryLabel} ${pageVersionTargetLabel}，点击更新`
                  : pageVersionUpdate.phase === 'checking'
                    ? `正在自动检查页面版本，当前 ${pageVersionUpdate.currentVersionLabel}`
                    : pageVersionUpdate.phase === 'updating'
                      ? `正在更新到 ${pageVersionTargetLabel}`
                      : pageVersionUpdate.phase === 'up-to-date'
                        ? `当前版本 ${pageVersionUpdate.currentVersionLabel}，已自动检查为最新版本`
                        : pageVersionUpdate.phase === 'check-failed'
                          ? `当前版本 ${pageVersionUpdate.currentVersionLabel}，自动检查暂不可用`
                          : `当前离线，版本 ${pageVersionUpdate.currentVersionLabel}`}
                title={pageVersionUpdate.error || (pageVersionCanUpdate
                  ? '点击下载、激活并重新载入新版本'
                  : '页面会自动检查服务器版本')}
                onClick={() => void updatePageVersion()}
              >
                <span
                  className={`local-state-dot ${isOnline ? 'is-online' : 'is-offline'}${pageVersionBusy ? ' is-checking' : ''}`}
                  aria-hidden="true"
                />
                <div aria-live="polite">
                  <strong>
                    {pageVersionUpdate.phase === 'checking'
                      ? `正在自动检查 · ${pageVersionUpdate.currentVersionLabel}`
                      : pageVersionUpdate.phase === 'updating'
                        ? `正在更新 · ${pageVersionTargetLabel}`
                        : pageVersionUpdate.phase === 'update-failed'
                          ? `更新失败 · ${pageVersionTargetLabel}`
                          : pageVersionUpdate.phase === 'update-available'
                            ? `${pageVersionDiscoveryLabel} · ${pageVersionTargetLabel}`
                            : `${isOnline ? '当前联网' : '当前离线'} · ${pageVersionUpdate.currentVersionLabel}`}
                  </strong>
                  <small>
                    {pageVersionUpdate.phase === 'checking'
                      ? '正在自动检查服务器版本'
                      : pageVersionUpdate.phase === 'updating'
                        ? '正在下载并校验完整版本'
                        : pageVersionUpdate.phase === 'update-available'
                          ? '点击更新，完成后自动重新载入'
                          : pageVersionUpdate.phase === 'update-failed'
                            ? '点击重试更新'
                            : pageVersionUpdate.phase === 'check-failed'
                              ? '自动检查暂不可用，将稍后重试'
                              : pageVersionUpdate.phase === 'up-to-date'
                                ? '已自动检查，是最新版本'
                                : offlineAvailability.ready
                                  ? '离线工作区已就绪'
                                  : offlineAvailability.supported
                                    ? '正在准备离线工作区'
                                    : '此环境仅支持在线使用'}
                  </small>
                </div>
                <span className="local-state-action" aria-hidden="true">
                  {pageVersionBusy
                    ? '↻'
                    : pageVersionCanUpdate
                      ? '↓'
                      : pageVersionUpdate.phase === 'up-to-date'
                        ? '✓'
                        : pageVersionUpdate.phase === 'check-failed'
                          ? '!'
                          : '—'}
                </span>
              </button>}
            </div>
          )}
        </div>
      )}

      {overlay && (
        <div
          className="web-shell-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              navigateToAppPath(APP_ROUTE_PATHS.timelineWorkspace);
            }
          }}
        >
          <section
            className={`web-shell-window is-${meta.key}`}
            role="dialog"
            aria-modal="true"
            aria-label={meta.title}
          >
            <header className="web-shell-window-bar">
              <div className="web-shell-window-identity">
                <BrandLogo />
                <span>
                  <strong>{meta.title}</strong>
                  <small>{meta.description}</small>
                </span>
              </div>

              <nav className="web-shell-window-tabs" aria-label="面板导航">
                {windowNavItems.map((item) => (
                  <button
                    key={item.key}
                    className={meta.key === item.key ? 'is-active' : ''}
                    type="button"
                    onClick={() => navigateToAppPath(item.path)}
                  >
                    {item.label}
                  </button>
                ))}
              </nav>

              <button
                className="web-shell-window-close"
                type="button"
                aria-label="关闭面板并返回工作区"
                onClick={() => navigateToAppPath(APP_ROUTE_PATHS.timelineWorkspace)}
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="m6 6 8 8M14 6l-8 8" />
                </svg>
              </button>
            </header>
            <div className="web-shell-window-content">{overlay}</div>
          </section>
        </div>
      )}
    </div>
  );
}
