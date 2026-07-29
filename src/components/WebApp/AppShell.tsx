import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
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

function sectionMeta(path: string): SectionMeta {
  if (path === APP_ROUTE_PATHS.settings) {
    return {
      key: 'settings',
      title: '设置',
      description: '存储、备份与访问',
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

export function AppShell({ currentPath, children, overlay }: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const launcherRef = useRef<HTMLDivElement | null>(null);
  const meta = sectionMeta(currentPath);
  const navItems: Array<{ key: NavKey; label: string; path: string }> = [
    { key: 'start', label: '开始', path: APP_ROUTE_PATHS.welcome },
    { key: 'timeline', label: '工作区', path: APP_ROUTE_PATHS.timelineWorkspace },
    { key: 'data', label: '数据', path: APP_ROUTE_PATHS.dataWorkspace },
    { key: 'settings', label: '设置', path: APP_ROUTE_PATHS.settings },
  ];
  const windowNavItems = navItems.filter((item) => item.key !== 'timeline');

  useEffect(() => {
    setMenuOpen(false);
  }, [currentPath]);

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
    <div className={`web-app-shell ${overlay ? 'has-overlay' : ''}`}>
      <main className="web-shell-content">{children}</main>

      {!overlay && (
        <div className="web-shell-launcher" ref={launcherRef}>
          <button
            className="web-shell-menu-button"
            type="button"
            aria-label="打开工作台菜单"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="web-shell-brand-mark" aria-hidden="true"><i /><i /><i /></span>
          </button>

          {menuOpen && (
            <div className="web-shell-popover">
              <div className="web-shell-popover-heading">
                <span className="web-shell-brand-mark" aria-hidden="true"><i /><i /><i /></span>
                <span>
                  <strong>终末地伤害工作台</strong>
                  <small>Web LTS 1.8</small>
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

              <div className="web-shell-local-state">
                <span className="local-state-dot" />
                <div>
                  <strong>此浏览器</strong>
                  <small>SQLite · OPFS · 离线可用</small>
                </div>
              </div>
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
                <span className="web-shell-brand-mark" aria-hidden="true"><i /><i /><i /></span>
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
