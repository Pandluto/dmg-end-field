import { useEffect, useState } from 'react';
import {
  readDesktopHost,
  type DesktopAppInfo,
  type DesktopCapabilities,
  type DesktopReleaseResult,
  type DesktopSettings,
} from '../../platform/desktop/desktopHost';
import './desktop-settings.css';

type ReleaseKind = 'images' | 'data';

function resultMessage(result: DesktopReleaseResult): string {
  if (!result.ok) return result.error || '发包失败。';
  return `发布产物已生成：${result.result?.outputDir || '输出目录'}`;
}

export function DesktopSettingsPanel() {
  const host = readDesktopHost();
  const [capabilities, setCapabilities] = useState<DesktopCapabilities | null>(null);
  const [appInfo, setAppInfo] = useState<DesktopAppInfo | null>(null);
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [imageSource, setImageSource] = useState('');
  const [dataSource, setDataSource] = useState('');
  const [output, setOutput] = useState('');
  const [version, setVersion] = useState('');
  const [busy, setBusy] = useState<ReleaseKind | null>(null);
  const [message, setMessage] = useState('');
  const [lastOutput, setLastOutput] = useState('');

  useEffect(() => {
    if (!host) return;
    void Promise.all([
      host.getCapabilities().then(setCapabilities),
      host.getAppInfo().then((info) => {
        setAppInfo(info);
        setVersion(info.version);
      }),
      host.getSettings().then(setSettings),
    ]).catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
  }, [host]);

  if (!host) return null;

  const selectSource = async (kind: ReleaseKind) => {
    try {
      const result = kind === 'images'
        ? await host.pickImageReleaseSource()
        : await host.pickDataReleaseSource();
      if (!result.ok || !result.path) return;
      if (kind === 'images') setImageSource(result.path);
      else setDataSource(result.path);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const selectOutput = async () => {
    try {
      const result = await host.pickReleaseOutput();
      if (result.ok && result.path) setOutput(result.path);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const buildRelease = async (kind: ReleaseKind) => {
    const source = kind === 'images' ? imageSource : dataSource;
    if (!source || !output || !version.trim()) {
      setMessage('请先选择源目录、输出目录并填写版本。');
      return;
    }
    setBusy(kind);
    setMessage(kind === 'images' ? '正在生成图片发布包…' : '正在生成数据发布包…');
    try {
      const result = kind === 'images'
        ? await host.buildImageRelease({
            assetVersion: version.trim(),
            releaseTag: version.trim(),
          })
        : await host.buildDataRelease({
            dataVersion: version.trim(),
          });
      setMessage(resultMessage(result));
      setLastOutput(result.result?.outputDir || '');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const changeScale = async (scale: string) => {
    try {
      const result = await host.setScale(scale);
      if (result.ok && settings) setSettings({ ...settings, scale: result.scale });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <>
      <section className="settings-section desktop-host-section">
        <div className="settings-section-heading">
          <div>
            <p>桌面宿主</p>
            <h2>Electron Shell</h2>
          </div>
          <span className="settings-state is-good">{appInfo ? `v${appInfo.version}` : '读取中'}</span>
        </div>
        <div className="settings-card-grid">
          <article className="settings-card">
            <span>页面来源</span>
            <strong>本地安装包</strong>
            <small>{appInfo?.origin || '正在读取本地宿主'}</small>
          </article>
          <article className="settings-card">
            <span>Agent / OpenCode</span>
            <strong>尚未接入</strong>
            <small>{capabilities?.agent.reason || '本轮占位'}</small>
          </article>
          <article className="settings-card">
            <span>MCP</span>
            <strong>尚未接入</strong>
            <small>{capabilities?.mcp.reason || '本轮占位'}</small>
          </article>
          <article className="settings-card">
            <span>运行平台</span>
            <strong>{appInfo ? `${appInfo.platform} · ${appInfo.arch}` : '—'}</strong>
            <small>不启动任何 AI/MCP 子进程</small>
          </article>
        </div>
        {settings && (
          <div className="settings-action-row">
            <div>
              <strong>桌面缩放</strong>
              <span>只改变窗口内容比例，不影响业务数据。</span>
            </div>
            <select
              aria-label="桌面缩放"
              value={settings.scale}
              onChange={(event) => void changeScale(event.target.value)}
            >
              {settings.availableScales.map((scale) => (
                <option key={scale} value={scale}>{Math.round(Number(scale) * 100)}%</option>
              ))}
            </select>
          </div>
        )}
      </section>

      <section className="settings-section desktop-release-section">
        <div className="settings-section-heading">
          <div>
            <p>开发工具</p>
            <h2>GitHub Release 产物</h2>
          </div>
          <span className="settings-state is-good">无数据库权限</span>
        </div>
        <div className="desktop-release-fields">
          <label>
            <span>发布版本</span>
            <input value={version} onChange={(event) => setVersion(event.target.value)} />
          </label>
          <label>
            <span>图片源目录</span>
            <div><input value={imageSource} readOnly /><button type="button" onClick={() => void selectSource('images')}>选择</button></div>
          </label>
          <label>
            <span>Slim data 或 public 目录</span>
            <div><input value={dataSource} readOnly /><button type="button" onClick={() => void selectSource('data')}>选择</button></div>
          </label>
          <label>
            <span>输出目录</span>
            <div><input value={output} readOnly /><button type="button" onClick={() => void selectOutput()}>选择</button></div>
          </label>
        </div>
        <div className="desktop-release-actions">
          <button
            className="dashboard-primary-button"
            type="button"
            disabled={busy !== null || !capabilities?.releaseTools.images}
            onClick={() => void buildRelease('images')}
          >
            {busy === 'images' ? '正在生成…' : '生成图片发布包'}
          </button>
          <button
            type="button"
            disabled={busy !== null || !capabilities?.releaseTools.data}
            onClick={() => void buildRelease('data')}
          >
            {busy === 'data' ? '正在生成…' : '生成数据发布包'}
          </button>
          {lastOutput && <button type="button" onClick={() => void host.revealPath(lastOutput)}>打开结果目录</button>}
        </div>
        {message && <p className="settings-security-note" role="status">{message}</p>}
      </section>
    </>
  );
}
