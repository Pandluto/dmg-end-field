import type { ReactNode } from 'react';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../../utils/appRoute';
import './app-shell.css';

type NavKey = 'start' | 'timeline' | 'data' | 'settings';

interface AppShellProps {
  currentPath: string;
  children: ReactNode;
}

type SectionMeta = {
  key: NavKey;
  eyebrow: string;
  title: string;
  description: string;
};

function sectionMeta(path: string): SectionMeta {
  if (path === APP_ROUTE_PATHS.settings) {
    return {
      key: 'settings',
      eyebrow: 'SYSTEM',
      title: '设置',
      description: '浏览器存储、备份与访问状态',
    };
  }
  if (path === APP_ROUTE_PATHS.welcome || path === APP_ROUTE_PATHS.root) {
    return {
      key: 'start',
      eyebrow: 'WEB LTS 1.8',
      title: '开始',
      description: '本地工作区概览',
    };
  }
  if (path.startsWith('/data')) {
    return {
      key: 'data',
      eyebrow: 'LIBRARY',
      title: '数据工作区',
      description: '管理资料、编辑库与图片资源',
    };
  }
  return {
    key: 'timeline',
    eyebrow: 'WORKSPACE',
    title: '排轴工作区',
    description: '队伍配置、时间轴与伤害推演',
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

export function AppShell({ currentPath, children }: AppShellProps) {
  const meta = sectionMeta(currentPath);
  const navItems: Array<{ key: NavKey; label: string; path: string }> = [
    { key: 'start', label: '开始', path: APP_ROUTE_PATHS.welcome },
    { key: 'timeline', label: '排轴工作区', path: APP_ROUTE_PATHS.timelineWorkspace },
    { key: 'data', label: '数据工作区', path: APP_ROUTE_PATHS.dataWorkspace },
    { key: 'settings', label: '设置', path: APP_ROUTE_PATHS.settings },
  ];

  return (
    <div className="web-app-shell">
      <aside className="web-shell-sidebar">
        <button
          className="web-shell-brand"
          type="button"
          onClick={() => navigateToAppPath(APP_ROUTE_PATHS.welcome)}
          aria-label="返回开始页"
        >
          <span className="web-shell-brand-mark"><i /><i /><i /></span>
          <span>
            <strong>终末地</strong>
            <small>伤害工作台</small>
          </span>
        </button>

        <nav className="web-shell-nav" aria-label="主要导航">
          <p>工作台</p>
          {navItems.map((item) => (
            <button
              key={item.key}
              className={meta.key === item.key ? 'is-active' : ''}
              type="button"
              onClick={() => navigateToAppPath(item.path)}
            >
              <span className="web-shell-nav-icon"><NavGlyph name={item.key} /></span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="web-shell-local-state">
          <span className="local-state-dot" />
          <div>
            <strong>仅保存在此浏览器</strong>
            <small>SQLite · OPFS</small>
          </div>
        </div>
      </aside>

      <section className="web-shell-stage">
        <header className="web-shell-header">
          <div>
            <p>{meta.eyebrow}</p>
            <div className="web-shell-title-line">
              <h1>{meta.title}</h1>
              <span>{meta.description}</span>
            </div>
          </div>
          <div className="web-shell-badges">
            <span><i /> 离线可用</span>
            <span>v1.8 LTS</span>
          </div>
        </header>
        <main className="web-shell-content">{children}</main>
      </section>
    </div>
  );
}

