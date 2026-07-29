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
          <p className="dashboard-kicker">LOCAL FIRST · NO ACCOUNT</p>
          <h2>把一次计算，留成可以继续推演的方案。</h2>
          <p>
            角色配置、时间轴、Buff 和结果都保存在浏览器 SQLite 中。
            进入排轴工作区继续当前方案，或前往数据工作区维护资料。
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
          <span className="signal-ring ring-one" />
          <span className="signal-ring ring-two" />
          <span className="signal-ring ring-three" />
          <span className="signal-core">1.8</span>
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
            <p>QUICK START</p>
            <h3>从这里继续</h3>
          </div>
        </div>
        <div className="workflow-grid">
          <button type="button" onClick={() => navigateToAppPath(APP_ROUTE_PATHS.timelineWorkspace)}>
            <span>01</span>
            <strong>选择队伍并排轴</strong>
            <small>配置四人队伍、技能节点与 Buff</small>
          </button>
          <button type="button" onClick={() => navigateToAppPath(APP_ROUTE_PATHS.operatorConfig)}>
            <span>02</span>
            <strong>调整干员配置</strong>
            <small>武器、装备、潜能与技能等级</small>
          </button>
          <button type="button" onClick={() => navigateToAppPath(APP_ROUTE_PATHS.dataWorkspace)}>
            <span>03</span>
            <strong>维护资料库</strong>
            <small>数据包、编辑器与图片资源</small>
          </button>
        </div>
      </section>
    </div>
  );
}

