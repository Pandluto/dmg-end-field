import { useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchResourcePackageManifest,
  installDefaultResourcePackage,
  readInstalledResourcePackage,
  type InstalledResourcePackage,
  type ResourceInstallProgress,
  type ResourcePackageManifest,
} from '../../platform/resources/resourcePackage';
import {
  fetchImagePackageManifest,
  installDefaultImagePackage,
  readInstalledImagePackage,
  type ImageInstallProgress,
  type InstalledImagePackage,
  type ImagePackageManifest,
} from '../../platform/resources/imagePackage';
import {
  applyDefaultLocalDataPackage,
  applyLocalDataPackage,
  deleteLocalDataPackage,
  ensureDefaultLocalDataPackage,
  importLocalDataPackageFile,
  listLocalDataPackages,
  readLocalDataPackage,
  saveCurrentLocalDataPackage,
  type LocalDataPackageSummary,
  type LocalDataScope,
} from '../../platform/data/localDataPackages';
import { useNotificationCenter } from '../../platform/notifications/NotificationCenterProvider';
import { formatNotificationVersionLabel } from '../../platform/notifications/notificationFormat';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../../utils/appRoute';

function formatBytes(value: number): string {
  if (!value) return '0 MB';
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

function formatDate(value: number | string): string {
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function packageKey(item: Pick<LocalDataPackageSummary, 'scope' | 'packageId'>): string {
  return `${item.scope}:${item.packageId}`;
}

type DataToolGlyphName = 'operator' | 'buff' | 'weapon' | 'equipment' | 'image';

function DataToolGlyph({ name }: { name: DataToolGlyphName }) {
  if (name === 'operator') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="8" r="3.25" />
        <path d="M5.5 19c.8-3.5 3-5.25 6.5-5.25s5.7 1.75 6.5 5.25" />
      </svg>
    );
  }
  if (name === 'buff') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m12 3 1.35 4.15L17.5 8.5l-4.15 1.35L12 14l-1.35-4.15L6.5 8.5l4.15-1.35L12 3ZM18.25 14l.7 2.05L21 16.75l-2.05.7-.7 2.05-.7-2.05-2.05-.7 2.05-.7.7-2.05Z" />
      </svg>
    );
  }
  if (name === 'weapon') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m6 18 11.5-11.5M14.5 5.5l4-1-1 4M4.5 15.5l4 4M3.5 20.5l3-3" />
      </svg>
    );
  }
  if (name === 'equipment') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3.5 19 6v5.2c0 4.2-2.35 7.25-7 9.3-4.65-2.05-7-5.1-7-9.3V6l7-2.5Z" />
        <path d="m8.5 12 2.2 2.2 4.8-5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5" width="16" height="14" rx="2.5" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="m6.5 17 4.25-4 2.75 2.5 2-2 2.5 3.5" />
    </svg>
  );
}

export function DataWorkspacePage() {
  const { notify } = useNotificationCenter();
  const [installed, setInstalled] = useState<InstalledResourcePackage | null>(null);
  const [available, setAvailable] = useState<ResourcePackageManifest | null>(null);
  const [progress, setProgress] = useState<ResourceInstallProgress | null>(null);
  const [imageProgress, setImageProgress] = useState<ImageInstallProgress | null>(null);
  const [images, setImages] = useState<InstalledImagePackage | null>(null);
  const [availableImages, setAvailableImages] = useState<ImagePackageManifest | null>(null);
  const [packages, setPackages] = useState<LocalDataPackageSummary[]>([]);
  const [packageScope, setPackageScope] = useState<LocalDataScope>('share');
  const [selectedPackageKey, setSelectedPackageKey] = useState('');
  const [installing, setInstalling] = useState(false);
  const [dataBusy, setDataBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [saveDialogScope, setSaveDialogScope] = useState<LocalDataScope | null>(null);
  const [savePackageName, setSavePackageName] = useState('');
  const [confirmation, setConfirmation] = useState<
    'restore-default' | 'apply-package' | 'delete-package' | null
  >(null);
  const localImportRef = useRef<HTMLInputElement>(null);
  const shareImportRef = useRef<HTMLInputElement>(null);

  const refreshPackages = async () => {
    const next = await listLocalDataPackages();
    setPackages(next);
    setSelectedPackageKey((current) => (
      current && next.some((item) => packageKey(item) === current)
        ? current
        : packageKey(next.find((item) => item.scope === packageScope) || next[0] || {
          scope: packageScope,
          packageId: '',
        })
    ));
  };

  useEffect(() => {
    void Promise.all([
      readInstalledResourcePackage().then(setInstalled),
      readInstalledImagePackage().then(setImages),
      fetchResourcePackageManifest().then(setAvailable).catch(() => undefined),
      fetchImagePackageManifest().then(setAvailableImages).catch(() => undefined),
      refreshPackages(),
    ]);
  }, []);

  const scopedPackages = useMemo(
    () => packages.filter((item) => item.scope === packageScope),
    [packageScope, packages],
  );
  const selectedPackage = useMemo(
    () => packages.find((item) => packageKey(item) === selectedPackageKey) || null,
    [packages, selectedPackageKey],
  );
  const updateAvailable = useMemo(
    () => Boolean(
      (installed && available && installed.version !== available.version)
      || (images && availableImages && images.version !== availableImages.version),
    ),
    [available, availableImages, images, installed],
  );

  useEffect(() => {
    if (selectedPackage?.scope === packageScope) return;
    setSelectedPackageKey(scopedPackages[0] ? packageKey(scopedPackages[0]) : '');
  }, [packageScope, scopedPackages, selectedPackage?.scope]);

  const install = async () => {
    setInstalling(true);
    setMessage('');
    try {
      const next = await installDefaultResourcePackage(setProgress);
      const latestImages = availableImages || await fetchImagePackageManifest();
      const currentImages = await readInstalledImagePackage();
      const nextImages = (
        currentImages?.version === latestImages.version
        && currentImages.manifest.archive.sha256 === latestImages.archive.sha256
      )
        ? currentImages
        : await installDefaultImagePackage(setImageProgress);
      await ensureDefaultLocalDataPackage({ replace: true });
      setInstalled(next);
      setImages(nextImages);
      await refreshPackages();
      setMessage('基础资料已下载到 Share Data；Web 图片包已经校验。');
      window.dispatchEvent(new Event('dmg-resource-status-changed'));
      void notify({
        dedupeKey: `install-result:${next.version}:${Date.now()}`,
        kind: 'install-result',
        severity: 'success',
        title: `资料已下载到 Share Data（${formatNotificationVersionLabel(next.version)}）`,
        body: '图片包已校验。工作台仍在使用已应用的资料，需要时请显式应用。',
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setInstalling(false);
    }
  };

  const restoreDefault = async () => {
    setDataBusy(true);
    setMessage('正在备份并还原完整数据…');
    try {
      const result = await applyDefaultLocalDataPackage({ backup: true });
      setMessage(
        `已还原 ${result.counts.operators} 位干员、${result.counts.weapons} 件武器、`
        + `${result.counts.equipments} 件装备；正在刷新工作台。`,
      );
      window.dispatchEvent(new Event('dmg-resource-status-changed'));
      if (result.backup) {
        void notify({
          dedupeKey: `backup-created:${result.backup.packageId}`,
          kind: 'backup-created',
          severity: 'info',
          title: `已创建应用前备份（${result.backup.name}）`,
          body: '备份保存在 Local Data，可随时导回。',
        });
      }
      void notify({
        dedupeKey: `apply-result:${result.package.packageId}:${Date.now()}`,
        kind: 'apply-result',
        severity: 'success',
        title: `已应用官方资料 ${formatNotificationVersionLabel(result.package.dataVersion)}`,
        body: `干员 ${result.counts.operators} · 武器 ${result.counts.weapons} · 装备 ${result.counts.equipments}；排轴未受影响。`,
      });
      window.setTimeout(() => window.location.reload(), 500);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setDataBusy(false);
    }
  };

  const applySelectedPackage = async () => {
    if (!selectedPackage) return;
    setDataBusy(true);
    setMessage('正在应用数据包…');
    try {
      const result = await applyLocalDataPackage({
        scope: selectedPackage.scope,
        packageId: selectedPackage.packageId,
        backup: true,
      });
      setMessage(
        `已应用 ${result.counts.operators} 位干员、${result.counts.weapons} 件武器；`
        + `导入 ${result.importedTimelineArchives} 份共享存档、`
        + `${result.importedImageAssets} 张自定义图片。正在刷新工作台。`,
      );
      window.dispatchEvent(new Event('dmg-resource-status-changed'));
      if (result.backup) {
        void notify({
          dedupeKey: `backup-created:${result.backup.packageId}`,
          kind: 'backup-created',
          severity: 'info',
          title: `已创建应用前备份（${result.backup.name}）`,
          body: '备份保存在 Local Data，可随时导回。',
        });
      }
      void notify({
        dedupeKey: `apply-result:${result.package.packageId}:${Date.now()}`,
        kind: 'apply-result',
        severity: 'success',
        title: `已应用“${result.package.name}”`,
        body: `干员 ${result.counts.operators} · 武器 ${result.counts.weapons} · 装备 ${result.counts.equipments}；排轴未受影响。`,
      });
      window.setTimeout(() => window.location.reload(), 500);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setDataBusy(false);
    }
  };

  const openSaveDialog = (scope: LocalDataScope) => {
    setSavePackageName(
      `${scope === 'local' ? '本地' : '共享'}数据 ${new Date().toLocaleDateString('zh-CN')}`,
    );
    setSaveDialogScope(scope);
  };

  const saveCurrent = async (scope: LocalDataScope, name: string) => {
    setDataBusy(true);
    setMessage('正在整理当前资料、共享存档与自定义图片…');
    try {
      const summary = await saveCurrentLocalDataPackage(scope, { name });
      setPackageScope(scope);
      await refreshPackages();
      setSelectedPackageKey(packageKey(summary));
      setSaveDialogScope(null);
      setMessage(
        `已保存到 ${scope === 'local' ? 'Local Data' : 'Share Data'}：${summary.name}；`
        + `包含 ${summary.imageAssetCount} 张自定义图片。`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setDataBusy(false);
    }
  };

  const importFile = async (scope: LocalDataScope, file: File | undefined) => {
    if (!file) return;
    setDataBusy(true);
    setMessage(`正在导入 ${file.name}…`);
    try {
      const result = await importLocalDataPackageFile(scope, file);
      setPackageScope(scope);
      await refreshPackages();
      setSelectedPackageKey(packageKey(result.summary));
      setMessage(
        `${result.reused ? '已存在相同数据包' : '导入完成'}：${result.summary.name}；`
        + `包含 ${result.summary.imageAssetCount} 张自定义图片。`,
      );
      if (!result.reused) {
        void notify({
          dedupeKey: `import-result:${scope}:${result.summary.packageId}:${Date.now()}`,
          kind: 'import-result',
          severity: 'success',
          title: `已导入数据包（${result.summary.name}）`,
          body: `已加入 ${scope === 'local' ? 'Local Data' : 'Share Data'}，可在列表中选择应用。`,
        });
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setDataBusy(false);
      if (scope === 'local' && localImportRef.current) localImportRef.current.value = '';
      if (scope === 'share' && shareImportRef.current) shareImportRef.current.value = '';
    }
  };

  const exportSelected = async () => {
    if (!selectedPackage) return;
    const archive = await readLocalDataPackage(
      selectedPackage.scope,
      selectedPackage.packageId,
    );
    const blob = new Blob([`${JSON.stringify(archive, null, 2)}\n`], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${selectedPackage.packageId}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const deleteSelected = async () => {
    if (!selectedPackage) return;
    setDataBusy(true);
    try {
      await deleteLocalDataPackage(selectedPackage.scope, selectedPackage.packageId);
      await refreshPackages();
      setMessage('数据包已删除；当前已应用资料未受影响。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setDataBusy(false);
    }
  };

  const runConfirmedAction = () => {
    const action = confirmation;
    setConfirmation(null);
    if (action === 'restore-default') {
      void restoreDefault();
    } else if (action === 'apply-package') {
      void applySelectedPackage();
    } else if (action === 'delete-package') {
      void deleteSelected();
    }
  };

  const tools = [
    {
      title: '干员资料',
      description: '维护当前已应用的本地干员、技能倍率与 Buff。',
      meta: 'Operator Studio',
      path: APP_ROUTE_PATHS.draft,
      accent: 'green',
      icon: 'operator',
    },
    {
      title: 'Buff 资料',
      description: '编辑当前本地 Buff 组、触发条件与倍率模型。',
      meta: 'Buff Library',
      path: APP_ROUTE_PATHS.buffSheet,
      accent: 'lime',
      icon: 'buff',
    },
    {
      title: '武器资料',
      description: '管理当前本地武器成长、技能词条与潜能参数。',
      meta: 'Weapon Sheet',
      path: APP_ROUTE_PATHS.weaponSheet,
      accent: 'amber',
      icon: 'weapon',
    },
    {
      title: '装备资料',
      description: '检查当前本地装备套装、固定属性和可选词条。',
      meta: 'Equipment Sheet',
      path: APP_ROUTE_PATHS.equipmentSheet,
      accent: 'blue',
      icon: 'equipment',
    },
    {
      title: '图片资源',
      description: '管理 Web 图片包索引与浏览器 SQLite 自定义图片。',
      meta: 'Asset Library',
      path: APP_ROUTE_PATHS.imageManager,
      accent: 'violet',
      icon: 'image',
    },
  ] as const;

  return (
    <div className="data-workspace-page">
      {message && <div className="data-workspace-message">{message}</div>}
      <section className="data-package-panel">
        <div className="data-package-main">
          <div className="data-package-intro">
            <span className="data-package-icon" aria-hidden="true">
              <img src="./app-icon.png" alt="" />
            </span>
            <div>
              <p className="dashboard-kicker">Web LTS 资源</p>
              <h2>完整数据与图片包</h2>
              <p>
                下载内容会进入 Share Data；应用后才会替换浏览器中的干员、武器、
                装备与 Buff。自定义图片随数据包保存，SQLite 排轴始终独立。
              </p>
            </div>
          </div>
          <div className="data-package-actions">
            <button className="dashboard-primary-button" type="button" onClick={install} disabled={installing || dataBusy}>
              {installing ? '正在校验…' : updateAvailable ? '下载可用更新' : '重新校验并下载'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmation('restore-default')}
              disabled={installing || dataBusy}
            >
              一键还原完整数据
            </button>
          </div>
          {progress && (
            <div className="inline-package-progress" title={progress.currentPath}>
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
            <dt>资料清单版本</dt>
            <dd>{installed?.version || '—'}</dd>
          </div>
          <div>
            <dt>数据包</dt>
            <dd>{packages.length}</dd>
          </div>
          <div>
            <dt>校验文件</dt>
            <dd>{(installed?.manifest.files.length || 0) + (images?.manifest.files.length || 0)}</dd>
          </div>
          <div>
            <dt>校验体积</dt>
            <dd>{formatBytes((installed?.byteSize || 0) + (images?.byteSize || 0))}</dd>
          </div>
        </dl>
      </section>

      <section className="data-library-section">
        <div className="section-heading">
          <div>
            <p>完整数据包</p>
            <h3>Local Data / Share Data</h3>
          </div>
          <span>资料、共享存档和自定义图片一起保存；不覆盖 SQLite 排轴</span>
        </div>
        <div className="data-library-toolbar">
          <div className="data-library-tabs">
            {(['local', 'share'] as const).map((scope) => (
              <button
                key={scope}
                type="button"
                className={packageScope === scope ? 'is-active' : ''}
                onClick={() => setPackageScope(scope)}
              >
                {scope === 'local' ? 'Local Data' : 'Share Data'}
                <span>{packages.filter((item) => item.scope === scope).length}</span>
              </button>
            ))}
          </div>
          <div className="data-library-actions">
            <button type="button" disabled={dataBusy} onClick={() => openSaveDialog(packageScope)}>
              保存当前数据
            </button>
            <button
              type="button"
              disabled={dataBusy}
              onClick={() => (
                packageScope === 'local'
                  ? localImportRef.current?.click()
                  : shareImportRef.current?.click()
              )}
            >
              导入 JSON
            </button>
          </div>
          <input
            ref={localImportRef}
            hidden
            type="file"
            accept="application/json,.json"
            onChange={(event) => void importFile('local', event.target.files?.[0])}
          />
          <input
            ref={shareImportRef}
            hidden
            type="file"
            accept="application/json,.json"
            onChange={(event) => void importFile('share', event.target.files?.[0])}
          />
        </div>

        <div className="data-library-layout">
          <div className="data-library-list">
            {scopedPackages.length === 0 ? (
              <div className="data-library-empty">这里还没有数据包。</div>
            ) : scopedPackages.map((item) => (
              <button
                key={packageKey(item)}
                type="button"
                className={`${selectedPackageKey === packageKey(item) ? 'is-selected' : ''}${item.active ? ' is-active' : ''}`}
                onClick={() => setSelectedPackageKey(packageKey(item))}
              >
                <span className="data-library-card-head">
                  <strong>{item.name}</strong>
                  <small>{item.active ? '当前应用' : formatDate(item.updatedAt)}</small>
                </span>
                <span>
                  {item.counts.operators} 干员 · {item.counts.weapons} 武器 · {item.counts.equipments} 装备
                </span>
                <span>
                  {item.timelineArchiveCount} 份排轴存档 · {item.imageAssetCount} 张自定义图片
                  {' · '}{formatBytes(item.byteSize)}
                </span>
              </button>
            ))}
          </div>

          <aside className="data-library-inspector">
            {selectedPackage ? (
              <>
                <p>{selectedPackage.scope === 'local' ? 'Local Data' : 'Share Data'}</p>
                <h4>{selectedPackage.name}</h4>
                <dl>
                  <div><dt>干员</dt><dd>{selectedPackage.counts.operators}</dd></div>
                  <div><dt>武器</dt><dd>{selectedPackage.counts.weapons}</dd></div>
                  <div><dt>装备</dt><dd>{selectedPackage.counts.equipments}</dd></div>
                  <div><dt>Buff 组</dt><dd>{selectedPackage.counts.buffGroups}</dd></div>
                  <div><dt>自定义图片</dt><dd>{selectedPackage.imageAssetCount}</dd></div>
                  <div><dt>图片体积</dt><dd>{formatBytes(selectedPackage.imageAssetBytes)}</dd></div>
                </dl>
                <span>{selectedPackage.description || selectedPackage.sourceName || selectedPackage.packageId}</span>
                <div className="data-library-inspector-actions">
                  <button
                    className="dashboard-primary-button"
                    type="button"
                    disabled={dataBusy}
                    onClick={() => setConfirmation('apply-package')}
                  >
                    应用数据
                  </button>
                  <button type="button" disabled={dataBusy} onClick={() => void exportSelected()}>导出</button>
                  <button
                    type="button"
                    disabled={dataBusy}
                    onClick={() => setConfirmation('delete-package')}
                  >
                    删除
                  </button>
                </div>
              </>
            ) : (
              <div className="data-library-empty">选择一个数据包查看详情。</div>
            )}
          </aside>
        </div>
      </section>

      <section className="data-tool-section">
        <div className="section-heading">
          <div>
            <p>编辑器</p>
            <h3>当前已应用资料</h3>
          </div>
          <span>编辑结果保存在浏览器 SQLite，可再保存为完整数据包</span>
        </div>
        <div className="data-tool-grid">
          {tools.map((tool) => (
            <button
              key={tool.path}
              className={`data-tool-card accent-${tool.accent}`}
              type="button"
              onClick={() => navigateToAppPath(tool.path)}
            >
              <span className="data-tool-index"><DataToolGlyph name={tool.icon} /></span>
              <span className="data-tool-copy">
                <small>{tool.meta}</small>
                <strong>{tool.title}</strong>
                <span>{tool.description}</span>
              </span>
              <span className="data-tool-arrow">›</span>
            </button>
          ))}
        </div>
      </section>
      {saveDialogScope && (
        <div className="data-save-dialog-backdrop" role="presentation">
          <form
            className="data-save-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="data-save-dialog-title"
            onSubmit={(event) => {
              event.preventDefault();
              void saveCurrent(saveDialogScope, savePackageName);
            }}
          >
            <p>{saveDialogScope === 'local' ? 'Local Data' : 'Share Data'}</p>
            <h3 id="data-save-dialog-title">保存当前完整数据</h3>
            <span>干员、武器、装备、Buff、共享排轴存档和自定义图片会一起保存。</span>
            <label>
              数据包名称
              <input
                autoFocus
                value={savePackageName}
                onChange={(event) => setSavePackageName(event.target.value)}
                placeholder="输入数据包名称"
              />
            </label>
            <div>
              <button
                type="button"
                disabled={dataBusy}
                onClick={() => setSaveDialogScope(null)}
              >
                取消
              </button>
              <button
                className="dashboard-primary-button"
                type="submit"
                disabled={dataBusy || !savePackageName.trim()}
              >
                {dataBusy ? '正在保存…' : '保存数据包'}
              </button>
            </div>
          </form>
        </div>
      )}
      {confirmation && (
        <div className="data-save-dialog-backdrop" role="presentation">
          <div
            className="data-save-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="data-confirm-dialog-title"
          >
            <p>确认操作</p>
            <h3 id="data-confirm-dialog-title">
              {confirmation === 'restore-default'
                ? '还原 Web LTS 基础数据'
                : confirmation === 'apply-package'
                  ? `应用“${selectedPackage?.name || ''}”`
                  : `删除“${selectedPackage?.name || ''}”`}
            </h3>
            <span>
              {confirmation === 'restore-default'
                ? '当前资料会先保存为 Local Data 备份，再应用基础数据；SQLite 排轴不会被覆盖。'
                : confirmation === 'apply-package'
                  ? '系统会先保存 Local Data 备份，再恢复资料、共享存档和包内自定义图片；SQLite 排轴保持不变。'
                  : '只删除这个数据包；已经应用的资料、自定义图片和独立排轴不会删除。'}
            </span>
            <div>
              <button type="button" onClick={() => setConfirmation(null)}>取消</button>
              <button
                className={confirmation === 'delete-package' ? 'data-dialog-danger-button' : 'dashboard-primary-button'}
                type="button"
                onClick={runConfirmedAction}
              >
                {confirmation === 'delete-package' ? '删除数据包' : '确认继续'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
