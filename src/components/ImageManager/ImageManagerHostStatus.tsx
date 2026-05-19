import { useState } from 'react';
import { getHostStatus } from '../../utils/assetHostApi';
import type { HostStatus } from '../../utils/assetHostApi';

const METHOD_LABELS: { key: keyof HostStatus['methods']; label: string }[] = [
  { key: 'list', label: '列举' },
  { key: 'importFiles', label: '导入' },
  { key: 'rename', label: '重命名' },
  { key: 'deleteFile', label: '删文件' },
  { key: 'createDir', label: '建目录' },
  { key: 'deleteDir', label: '删目录' },
];

const MODE_LABELS: Record<HostStatus['mode'], string> = {
  'electron-writable': '桌面可写',
  'electron-readonly': '桌面只读',
  'browser-readonly': '浏览器只读',
};

export function ImageManagerHostStatus() {
  const [expanded, setExpanded] = useState(false);
  const status = getHostStatus();

  return (
    <div className="image-manager-host-status">
      <button
        className="image-manager-host-status-toggle"
        type="button"
        onClick={() => setExpanded((v) => !v)}
        title={status.backendLabel}
      >
        <span className={`image-manager-host-status-dot image-manager-mode-${status.mode}`} />
        <span className="image-manager-host-status-label">{MODE_LABELS[status.mode]}</span>
        {status.missingHint && (
          <span className="image-manager-host-status-warn">{status.missingHint}</span>
        )}
      </button>

      {expanded && (
        <div className="image-manager-host-status-detail">
          <div className="image-manager-host-status-row">
            <span className="image-manager-host-status-key">模式</span>
            <span className="image-manager-host-status-val">{status.mode}</span>
          </div>
          <div className="image-manager-host-status-row">
            <span className="image-manager-host-status-key">hasDesktopRuntime</span>
            <span className="image-manager-host-status-val">{status.hasDesktopRuntime ? 'true' : 'false'}</span>
          </div>
          {METHOD_LABELS.map(({ key, label }) => (
            <div className="image-manager-host-status-row" key={key}>
              <span className="image-manager-host-status-key">{label}</span>
              <span className={`image-manager-host-status-bool ${status.methods[key] ? 'is-ok' : 'is-missing'}`}>
                {status.methods[key] ? 'true' : 'false'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
