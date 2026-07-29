import { useMemo, useState } from 'react';
import {
  installDefaultResourcePackage,
  readInstalledResourcePackage,
  type InstalledResourcePackage,
  type ResourceInstallProgress,
} from '../../platform/resources/resourcePackage';
import {
  installDefaultImagePackage,
  readInstalledImagePackage,
  type ImageInstallProgress,
  type InstalledImagePackage,
} from '../../platform/resources/imagePackage';
import { applyDefaultLocalDataPackage } from '../../platform/data/localDataPackages';

interface WelcomePageProps {
  onInstalled: (
    resourcePackage: InstalledResourcePackage,
    imagePackage: InstalledImagePackage,
  ) => void;
}

type CombinedProgress =
  | ({ packageLabel: '基础数据' } & ResourceInstallProgress)
  | ({ packageLabel: '图片资源' } & ImageInstallProgress);

function formatBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function WelcomePage({ onInstalled }: WelcomePageProps) {
  const [progress, setProgress] = useState<CombinedProgress | null>(null);
  const [isInstalling, setIsInstalling] = useState(false);
  const [error, setError] = useState('');
  const percentage = useMemo(() => {
    if (!progress?.totalBytes) return 0;
    return Math.min(100, Math.round(progress.downloadedBytes / progress.totalBytes * 100));
  }, [progress]);

  const handleInstall = async () => {
    setIsInstalling(true);
    setError('');
    try {
      const installed = await readInstalledResourcePackage()
        || await installDefaultResourcePackage((next) => {
          setProgress({ ...next, packageLabel: '基础数据' });
        });
      const images = await readInstalledImagePackage()
        || await installDefaultImagePackage((next) => {
          setProgress({ ...next, packageLabel: '图片资源' });
        });
      await applyDefaultLocalDataPackage({
        backup: false,
        replacePackage: true,
      });
      onInstalled(installed, images);
    } catch (installError) {
      setError(installError instanceof Error ? installError.message : String(installError));
    } finally {
      setIsInstalling(false);
    }
  };

  return (
    <main className="web-entry-screen onboarding-screen">
      <section className="onboarding-card">
        <div className="onboarding-copy">
          <div className="brand-mark onboarding-brand-mark" aria-hidden="true">
            <img src="./app-icon.png" alt="" />
          </div>
          <p className="eyebrow">第一次使用</p>
          <h1>先把基础资料装进浏览器</h1>
          <p>
            程序本体已经准备好。完整 Local Data、图片资料会在你确认后下载，
            资料应用到浏览器 SQLite 后即可离线使用。
          </p>
          <div className="onboarding-points">
            <div>
              <strong>浏览器本地</strong>
              <span>私人排轴不会上传</span>
            </div>
            <div>
              <strong>版本隔离</strong>
              <span>资料更新不覆盖用户方案</span>
            </div>
            <div>
              <strong>可完整备份</strong>
              <span>设置中可导出 SQLite</span>
            </div>
          </div>
        </div>
        <div className="install-panel">
          <div className="install-panel-header">
            <span>Web LTS 基础资料包</span>
            <span className="status-chip">{isInstalling ? '正在安装' : '尚未安装'}</span>
          </div>
          <div className="package-contents">
            <span>30 位本地干员</span>
            <span>75 件本地武器</span>
            <span>装备与 Buff 本地库</span>
            <span>559 个图片资源</span>
          </div>
          {progress && (
            <div className="install-progress">
              <div className="progress-meta">
                <span>{progress.packageLabel} · {percentage}%</span>
                <span>{formatBytes(progress.downloadedBytes)} / {formatBytes(progress.totalBytes)}</span>
              </div>
              <div className="progress-track"><span style={{ width: `${percentage}%` }} /></div>
              <p>{progress.currentPath}</p>
            </div>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-action" type="button" onClick={handleInstall} disabled={isInstalling}>
            {isInstalling ? '下载并校验中…' : '下载完整资料并开始'}
          </button>
          <p className="install-footnote">本轮不会读取或迁移任何旧桌面 SQLite。</p>
        </div>
      </section>
    </main>
  );
}
