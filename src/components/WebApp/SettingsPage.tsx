import { useEffect, useState } from 'react';
import { clearAccessLease, readAccessLeaseStatus } from '../../platform/auth/accessLease';
import {
  readBrowserStorageEstimate,
  requestPersistentBrowserStorage,
  webDatabase,
  type WebDatabaseInfo,
} from '../../platform/database/webDatabase';
import {
  readInstalledResourcePackage,
  removeDefaultResourcePackage,
  type InstalledResourcePackage,
} from '../../platform/resources/resourcePackage';
import {
  readInstalledImagePackage,
  removeDefaultImagePackage,
  type InstalledImagePackage,
} from '../../platform/resources/imagePackage';
import { reloadLatestPageVersion } from '../../platform/runtime/serviceWorkerRuntime';
import { workspaceLease } from '../../platform/runtime/workspaceLease';
import { flushPersistentStorage } from '../../platform/storage/persistentStorage';
import {
  APP_THEME_OPTIONS,
  readAppTheme,
  setAppTheme,
  subscribeAppTheme,
  type AppThemeId,
} from '../../platform/theme/appTheme';

type StorageOverview = {
  usage: number;
  quota: number;
  persisted: boolean;
};

function formatBytes(value: number): string {
  if (!value) return '0 B';
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDate(value: number | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
}

export function SettingsPage() {
  const [databaseInfo] = useState<WebDatabaseInfo | null>(() => webDatabase.getInfo());
  const [storage, setStorage] = useState<StorageOverview>({ usage: 0, quota: 0, persisted: false });
  const [resourcePackage, setResourcePackage] = useState<InstalledResourcePackage | null>(null);
  const [imagePackage, setImagePackage] = useState<InstalledImagePackage | null>(null);
  const [leaseExpiresAt, setLeaseExpiresAt] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [theme, setTheme] = useState<AppThemeId>(() => readAppTheme());
  const [loadingTheme, setLoadingTheme] = useState<AppThemeId | null>(null);
  const [updatingPage, setUpdatingPage] = useState(false);

  const refresh = async () => {
    const [nextStorage, installed, images, lease] = await Promise.all([
      readBrowserStorageEstimate(),
      readInstalledResourcePackage(),
      readInstalledImagePackage(),
      readAccessLeaseStatus(),
    ]);
    setStorage(nextStorage);
    setResourcePackage(installed);
    setImagePackage(images);
    setLeaseExpiresAt(lease.expiresAt);
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => subscribeAppTheme(setTheme), []);

  const handleThemeChange = async (nextTheme: AppThemeId) => {
    if (nextTheme === theme || loadingTheme) return;
    setLoadingTheme(nextTheme);
    setMessage(
      APP_THEME_OPTIONS.find((option) => option.id === nextTheme)?.delivery === 'on-demand'
        ? '正在下载并安装主题包…'
        : '正在切换主题…',
    );
    try {
      const applied = await setAppTheme(nextTheme);
      setTheme(applied);
      setMessage('主题已经切换；下载过的主题可在离线时继续使用。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingTheme(null);
    }
  };

  const handlePersist = async () => {
    const persisted = await requestPersistentBrowserStorage();
    setMessage(persisted ? '浏览器已经授予持久存储。' : '浏览器暂未授予持久存储，请保留定期备份。');
    await refresh();
  };

  const handlePageUpdate = async () => {
    setUpdatingPage(true);
    setMessage('正在下载并校验完整的新版本…');
    try {
      await reloadLatestPageVersion();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setUpdatingPage(false);
    }
  };

  const handleExport = async () => {
    setMessage('正在整理数据库备份…');
    await flushPersistentStorage();
    const bytes = await webDatabase.exportFile();
    const exportedBytes = new Uint8Array(bytes.byteLength);
    exportedBytes.set(bytes);
    const blob = new Blob([exportedBytes.buffer], { type: 'application/vnd.sqlite3' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `dmg-web-lts-backup-${new Date().toISOString().slice(0, 10)}.sqlite3`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage('数据库备份已导出。');
  };

  const handleRemovePackage = async () => {
    if (!window.confirm('移除基础资料包？私人排轴不会删除，重新进入时需要再次下载资料。')) return;
    await Promise.all([
      removeDefaultResourcePackage(),
      removeDefaultImagePackage(),
    ]);
    window.location.reload();
  };

  const handleLock = async () => {
    await flushPersistentStorage();
    clearAccessLease();
    await webDatabase.close();
    workspaceLease.release();
    window.location.reload();
  };

  return (
    <div className="settings-page">
      {message && (
        <div className="settings-message" role="status" aria-live="polite">
          {message}
        </div>
      )}
      <section className="settings-section settings-appearance-section">
        <div className="settings-section-heading">
          <div>
            <p>外观</p>
            <h2>界面主题</h2>
          </div>
          <span className="settings-state is-good">即时生效</span>
        </div>
        <div className="theme-picker" role="radiogroup" aria-label="界面主题">
          {APP_THEME_OPTIONS.map((option) => (
            <button
              key={option.id}
              className={`theme-option is-${option.id}${theme === option.id ? ' is-selected' : ''}`}
              type="button"
              role="radio"
              aria-checked={theme === option.id}
              disabled={loadingTheme !== null}
              onClick={() => void handleThemeChange(option.id)}
            >
              <span className="theme-option-preview" aria-hidden="true">
                <span className="theme-option-sidebar" />
                <span className="theme-option-canvas">
                  <span />
                  <span />
                  <span />
                </span>
              </span>
              <span className="theme-option-copy">
                <strong>{option.label}</strong>
                <small>{option.description}</small>
                <em>
                  {loadingTheme === option.id
                    ? '正在安装…'
                    : option.delivery === 'bundled'
                      ? '随工作台内置'
                      : theme === option.id
                        ? '已安装 · 离线可用'
                        : '选择时按需载入'}
                </em>
              </span>
              <span className="theme-option-check" aria-hidden="true">✓</span>
            </button>
          ))}
        </div>
      </section>
      <section className="settings-section">
        <div className="settings-section-heading">
          <div>
            <p>更新</p>
            <h2>页面缓存与版本</h2>
          </div>
          <span className="settings-state is-good">不影响本地数据</span>
        </div>
        <div className="settings-action-row">
          <div>
            <strong>载入服务器上的最新页面</strong>
            <span>完整下载并校验后才切换版本；不会删除 SQLite、排轴、资源包、图片或设置。</span>
          </div>
          <button
            className="dashboard-primary-button"
            type="button"
            disabled={updatingPage}
            onClick={handlePageUpdate}
          >
            {updatingPage ? '正在更新…' : '更新并重新载入'}
          </button>
        </div>
      </section>
      <section className="settings-section">
        <div className="settings-section-heading">
          <div>
            <p>存储</p>
            <h2>浏览器存储</h2>
          </div>
          <span className={storage.persisted ? 'settings-state is-good' : 'settings-state'}>
            {storage.persisted ? '已持久化' : '尽力保存'}
          </span>
        </div>
        <div className="settings-card-grid">
          <article className="settings-card">
            <span>SQLite 运行时</span>
            <strong>{databaseInfo?.sqliteVersion || '—'}</strong>
            <small>{databaseInfo?.vfs || 'OPFS 初始化中'}</small>
          </article>
          <article className="settings-card">
            <span>当前用量</span>
            <strong>{formatBytes(storage.usage)}</strong>
            <small>可用配额 {formatBytes(storage.quota)}</small>
          </article>
          <article className="settings-card">
            <span>基础资料包</span>
            <strong>{resourcePackage?.version || '—'}</strong>
            <small>{resourcePackage?.manifest.files.length || 0} 个文件</small>
          </article>
          <article className="settings-card">
            <span>图片资源包</span>
            <strong>{imagePackage?.version || '—'}</strong>
            <small>{imagePackage?.manifest.files.length || 0} 个文件</small>
          </article>
        </div>
        <div className="settings-action-row">
          <div>
            <strong>防止浏览器自动回收数据</strong>
            <span>向浏览器申请把本工作台标记为持久存储。</span>
          </div>
          <button type="button" onClick={handlePersist}>申请持久存储</button>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-heading">
          <div>
            <p>备份</p>
            <h2>备份与资料</h2>
          </div>
        </div>
        <div className="settings-action-row">
          <div>
            <strong>导出完整 Web LTS 数据库</strong>
            <span>包含私人排轴、快照、工作节点、配置和自定义图片；官方资料包可重新下载。</span>
          </div>
          <button className="dashboard-primary-button" type="button" onClick={handleExport}>导出 SQLite 备份</button>
        </div>
        <div className="settings-action-row">
          <div>
            <strong>移除官方基础资料</strong>
            <span>不会删除私人数据；下次启动会重新询问是否下载。</span>
          </div>
          <button type="button" onClick={handleRemovePackage}>移除资料包</button>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-heading">
          <div>
            <p>访问</p>
            <h2>访问门禁</h2>
          </div>
        </div>
        <div className="settings-action-row">
          <div>
            <strong>本浏览器放行至 {formatDate(leaseExpiresAt)}</strong>
            <span>门禁有效期为首次正确输入密码后的 30 天。</span>
          </div>
          <button className="danger-button" type="button" onClick={handleLock}>立即锁定</button>
        </div>
        <p className="settings-security-note">
          当前是本地部署的纯前端门禁，用来过滤无效访问，不等同于服务器身份认证。
        </p>
      </section>
    </div>
  );
}
