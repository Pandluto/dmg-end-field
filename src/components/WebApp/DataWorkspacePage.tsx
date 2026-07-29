import { useEffect, useMemo, useState } from 'react';
import {
  fetchResourcePackageManifest,
  installDefaultResourcePackage,
  readInstalledResourcePackage,
  type InstalledResourcePackage,
  type ResourceInstallProgress,
  type ResourcePackageManifest,
} from '../../platform/resources/resourcePackage';
import {
  installDefaultImagePackage,
  readInstalledImagePackage,
  type ImageInstallProgress,
  type InstalledImagePackage,
} from '../../platform/resources/imagePackage';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../../utils/appRoute';

function formatBytes(value: number): string {
  if (!value) return '0 MB';
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

export function DataWorkspacePage() {
  const [installed, setInstalled] = useState<InstalledResourcePackage | null>(null);
  const [available, setAvailable] = useState<ResourcePackageManifest | null>(null);
  const [progress, setProgress] = useState<ResourceInstallProgress | null>(null);
  const [imageProgress, setImageProgress] = useState<ImageInstallProgress | null>(null);
  const [images, setImages] = useState<InstalledImagePackage | null>(null);
  const [installing, setInstalling] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    void readInstalledResourcePackage().then(setInstalled);
    void readInstalledImagePackage().then(setImages);
    void fetchResourcePackageManifest().then(setAvailable).catch(() => undefined);
  }, []);

  const updateAvailable = useMemo(
    () => Boolean(installed && available && installed.version !== available.version),
    [available, installed],
  );

  const install = async () => {
    setInstalling(true);
    setMessage('');
    try {
      const next = await installDefaultResourcePackage(setProgress);
      const nextImages = await installDefaultImagePackage(setImageProgress);
      setInstalled(next);
      setImages(nextImages);
      setMessage('基础数据与图片包已经下载并通过校验。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setInstalling(false);
    }
  };

  const tools = [
    {
      title: '干员资料',
      description: '维护干员基础属性、技能倍率和自定义角色。',
      meta: 'Operator Studio',
      path: APP_ROUTE_PATHS.draft,
      accent: 'green',
    },
    {
      title: 'Buff 资料',
      description: '编辑 Buff 条目、触发条件与倍率模型。',
      meta: 'Buff Library',
      path: APP_ROUTE_PATHS.buffSheet,
      accent: 'lime',
    },
    {
      title: '武器资料',
      description: '管理武器成长、技能词条与潜能参数。',
      meta: 'Weapon Sheet',
      path: APP_ROUTE_PATHS.weaponSheet,
      accent: 'amber',
    },
    {
      title: '装备资料',
      description: '检查装备套装、固定属性和可选词条。',
      meta: 'Equipment Sheet',
      path: APP_ROUTE_PATHS.equipmentSheet,
      accent: 'blue',
    },
    {
      title: '图片资源',
      description: '导入并建立浏览器内的一对一图片映射。',
      meta: 'Asset Library',
      path: APP_ROUTE_PATHS.imageManager,
      accent: 'violet',
    },
  ] as const;

  return (
    <div className="data-workspace-page">
      <section className="data-package-panel">
        <div className="data-package-main">
          <p className="dashboard-kicker">RESOURCE PACKAGE</p>
          <h2>基础资料包</h2>
          <p>
            下载内容经过 SHA-256 校验后进入浏览器缓存。重新安装只更新官方资料，
            不会覆盖私人排轴与本地编辑库。
          </p>
          <div className="data-package-actions">
            <button className="dashboard-primary-button" type="button" onClick={install} disabled={installing}>
              {installing ? '正在校验…' : updateAvailable ? '安装可用更新' : '重新校验并安装'}
            </button>
            <span>{message || (updateAvailable ? `发现 ${available?.version} 版本` : '当前已是可用版本')}</span>
          </div>
          {progress && (
            <div className="inline-package-progress">
              <span style={{ width: `${Math.round(progress.completed / progress.total * 100)}%` }} />
            </div>
          )}
          {imageProgress && (
            <div className="inline-package-progress" title={imageProgress.currentPath}>
              <span style={{
                width: `${imageProgress.stage === 'downloading'
                  ? Math.round(imageProgress.downloadedBytes / imageProgress.totalBytes * 100)
                  : Math.round(imageProgress.completed / imageProgress.total * 100)}%`,
              }} />
            </div>
          )}
        </div>
        <dl className="data-package-facts">
          <div>
            <dt>已安装版本</dt>
            <dd>{installed?.version || '—'}</dd>
          </div>
          <div>
            <dt>文件数量</dt>
            <dd>{(installed?.manifest.files.length || 0) + (images?.manifest.files.length || 0)}</dd>
          </div>
          <div>
            <dt>校验体积</dt>
            <dd>{formatBytes((installed?.byteSize || 0) + (images?.byteSize || 0))}</dd>
          </div>
          <div>
            <dt>存储位置</dt>
            <dd>Cache + OPFS</dd>
          </div>
        </dl>
      </section>

      <section className="data-tool-section">
        <div className="section-heading">
          <div>
            <p>EDITORS</p>
            <h3>资料与资源</h3>
          </div>
          <span>所有编辑结果只保存在当前浏览器</span>
        </div>
        <div className="data-tool-grid">
          {tools.map((tool, index) => (
            <button
              key={tool.path}
              className={`data-tool-card accent-${tool.accent}`}
              type="button"
              onClick={() => navigateToAppPath(tool.path)}
            >
              <span className="data-tool-index">{String(index + 1).padStart(2, '0')}</span>
              <span className="data-tool-copy">
                <small>{tool.meta}</small>
                <strong>{tool.title}</strong>
                <span>{tool.description}</span>
              </span>
              <span className="data-tool-arrow">↗</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
