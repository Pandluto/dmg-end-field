import { useEffect, useState } from 'react';
import { webDatabase } from '../../platform/database/webDatabase';
import {
  readInstalledResourcePackage,
  type InstalledResourcePackage,
} from '../../platform/resources/resourcePackage';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../../utils/appRoute';

type TimelineOverview = {
  documentCount: number;
  snapshotCount: number;
  latestLabel: string;
  latestUpdatedAt: number;
};

type StartActionGlyphName = 'timeline' | 'operator' | 'data';

function StartActionGlyph({ name }: { name: StartActionGlyphName }) {
  if (name === 'timeline') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 6.5h14M5 12h10M5 17.5h7" />
        <circle cx="18" cy="12" r="2" />
      </svg>
    );
  }
  if (name === 'operator') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="8" r="3.25" />
        <path d="M5.5 19c.8-3.5 3-5.25 6.5-5.25S17.7 15.5 18.5 19" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <ellipse cx="12" cy="6.5" rx="6.5" ry="2.75" />
      <path d="M5.5 6.5V12c0 1.5 2.9 2.75 6.5 2.75s6.5-1.25 6.5-2.75V6.5M5.5 12v5.5c0 1.5 2.9 2.75 6.5 2.75s6.5-1.25 6.5-2.75V12" />
    </svg>
  );
}

function formatDate(value: number): string {
  if (!value) return '尚未建立';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
}

export function StartPage() {
  const [resourcePackage, setResourcePackage] = useState<InstalledResourcePackage | null>(null);
  const [overview, setOverview] = useState<TimelineOverview>({
    documentCount: 0,
    snapshotCount: 0,
    latestLabel: '尚无排轴',
    latestUpdatedAt: 0,
  });

  useEffect(() => {
    void readInstalledResourcePackage().then(setResourcePackage);
    void Promise.all([
      webDatabase.query<{ count: number }>('SELECT COUNT(*) AS count FROM timeline_documents'),
      webDatabase.query<{ count: number }>('SELECT COUNT(*) AS count FROM timeline_snapshots WHERE archived = 0'),
      webDatabase.query<{ label: string; updated_at: number }>(
        'SELECT label, updated_at FROM timeline_documents ORDER BY updated_at DESC LIMIT 1',
      ),
    ]).then(([documents, snapshots, latest]) => {
      setOverview({
        documentCount: Number(documents[0]?.count || 0),
        snapshotCount: Number(snapshots[0]?.count || 0),
        latestLabel: String(latest[0]?.label || '尚无排轴'),
        latestUpdatedAt: Number(latest[0]?.updated_at || 0),
      });
    });
  }, []);

  return (
    <div className="web-dashboard-page">
      <section className="dashboard-hero">
        <div>
          <p className="dashboard-kicker">最近工作</p>
          <h2>{overview.latestLabel === '尚无排轴' ? '建立第一份排轴' : overview.latestLabel}</h2>
          <p>
            {overview.latestUpdatedAt
              ? `上次编辑于 ${formatDate(overview.latestUpdatedAt)}。排轴、配置与快照都保存在此浏览器。`
              : '从选择队伍开始建立排轴。配置、时间轴与快照只保存在此浏览器。'}
          </p>
          <div className="dashboard-actions">
            <button
              className="dashboard-primary-button"
              type="button"
              onClick={() => navigateToAppPath(APP_ROUTE_PATHS.timelineWorkspace)}
            >
              打开排轴工作区
            </button>
            <button type="button" onClick={() => navigateToAppPath(APP_ROUTE_PATHS.dataWorkspace)}>
              管理数据
            </button>
          </div>
        </div>
        <div className="dashboard-signal" aria-hidden="true">
          <span className="signal-halo" />
          <span className="signal-core"><img src="./app-icon.png" alt="" /></span>
          <span className="signal-version">Web LTS 1.8</span>
        </div>
      </section>

      <section className="dashboard-stat-grid">
        <article>
          <span>排轴文档</span>
          <strong>{overview.documentCount}</strong>
          <small>浏览器本地工作区</small>
        </article>
        <article>
          <span>有效快照</span>
          <strong>{overview.snapshotCount}</strong>
          <small>可恢复的方案节点</small>
        </article>
        <article>
          <span>基础资料</span>
          <strong>{resourcePackage?.version || '—'}</strong>
          <small>{resourcePackage ? `${resourcePackage.manifest.files.length} 个校验文件` : '尚未安装'}</small>
        </article>
        <article>
          <span>最近工作</span>
          <strong className="stat-label">{overview.latestLabel}</strong>
          <small>{formatDate(overview.latestUpdatedAt)}</small>
        </article>
      </section>

      <section className="dashboard-workflow">
        <div className="section-heading">
          <div>
            <p>快捷入口</p>
            <h3>新建与管理</h3>
          </div>
        </div>
        <div className="workflow-grid">
          <button type="button" onClick={() => navigateToAppPath(APP_ROUTE_PATHS.timelineWorkspace)}>
            <span className="workflow-icon"><StartActionGlyph name="timeline" /></span>
            <span className="workflow-copy">
              <strong>选择队伍并排轴</strong>
              <small>配置四人队伍、技能节点与 Buff</small>
            </span>
            <span className="workflow-chevron" aria-hidden="true">›</span>
          </button>
          <button type="button" onClick={() => navigateToAppPath(APP_ROUTE_PATHS.operatorConfig)}>
            <span className="workflow-icon"><StartActionGlyph name="operator" /></span>
            <span className="workflow-copy">
              <strong>调整干员配置</strong>
              <small>武器、装备、潜能与技能等级</small>
            </span>
            <span className="workflow-chevron" aria-hidden="true">›</span>
          </button>
          <button type="button" onClick={() => navigateToAppPath(APP_ROUTE_PATHS.dataWorkspace)}>
            <span className="workflow-icon"><StartActionGlyph name="data" /></span>
            <span className="workflow-copy">
              <strong>维护资料库</strong>
              <small>数据包、编辑器与图片资源</small>
            </span>
            <span className="workflow-chevron" aria-hidden="true">›</span>
          </button>
        </div>
      </section>
    </div>
  );
}
