import { useEffect, useState } from 'react';
import { getCapabilities, subscribeCapabilities, refreshCapabilities } from '../../utils/imageBridge';
import type { ImageManagerCapabilities } from '../../utils/imageBridge';

const CAP_LABELS: { key: keyof ImageManagerCapabilities; label: string }[] = [
  { key: 'canList', label: '列举' },
  { key: 'canImport', label: '导入' },
  { key: 'canRename', label: '重命名' },
  { key: 'canDeleteFile', label: '删文件' },
  { key: 'canCreateDir', label: '建目录' },
  { key: 'canDeleteDir', label: '删目录' },
  { key: 'canReveal', label: '定位' },
];

const MODE_LABELS: Record<string, string> = {
  '桌面端 · 可管理': '桌面可写',
  '桌面端 · 受限': '桌面只读',
  '网页端 · 可管理': '网页可写',
  '网页端 · 受限': '网页受限',
  '浏览器端 · 只读预览': '浏览器只读',
};

export function ImageManagerHostStatus() {
  const [expanded, setExpanded] = useState(false);
  const [caps, setCaps] = useState(() => getCapabilities());

  useEffect(() => {
    const unsubscribe = subscribeCapabilities(setCaps);
    void refreshCapabilities();
    return unsubscribe;
  }, []);

  const modeClass = caps.transportKind === 'electron'
    ? (caps.isWritable ? 'electron-writable' : 'electron-readonly')
    : (caps.transportKind === 'web-bridge' ? 'browser-backend' : 'browser-readonly');

  return (
    <div className="image-manager-host-status">
      <button
        className="image-manager-host-status-toggle"
        type="button"
        onClick={() => setExpanded((v) => !v)}
        title={caps.backendLabel}
      >
        <span className={`image-manager-host-status-dot image-manager-mode-${modeClass}`} />
        <span className="image-manager-host-status-label">{MODE_LABELS[caps.backendLabel] || caps.backendLabel}</span>
      </button>

      {expanded && (
        <div className="image-manager-host-status-detail">
          <div className="image-manager-host-status-row">
            <span className="image-manager-host-status-key">模式</span>
            <span className="image-manager-host-status-val">{caps.backendLabel}</span>
          </div>
          <div className="image-manager-host-status-row">
            <span className="image-manager-host-status-key">transport</span>
            <span className="image-manager-host-status-val">{caps.transportKind}</span>
          </div>
          {CAP_LABELS.map(({ key, label }) => (
            <div className="image-manager-host-status-row" key={key}>
              <span className="image-manager-host-status-key">{label}</span>
              <span className={`image-manager-host-status-bool ${caps[key] ? 'is-ok' : 'is-missing'}`}>
                {caps[key] ? 'true' : 'false'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
