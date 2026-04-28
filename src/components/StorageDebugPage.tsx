import { useEffect, useMemo, useState } from 'react';
import './StorageDebugPage.css';

const STORAGE_PAGE_PATH = '/storage';

function safeJsonParse(raw: string) {
  try {
    return {
      kind: 'json' as const,
      value: JSON.parse(raw),
    };
  } catch {
    return {
      kind: 'text' as const,
      value: raw,
    };
  }
}

function formatValueAsMarkdown(raw: string) {
  const parsed = safeJsonParse(raw);
  if (parsed.kind === 'json') {
    return `\`\`\`json\n${JSON.stringify(parsed.value, null, 2)}\n\`\`\``;
  }

  return `\`\`\`text\n${parsed.value}\n\`\`\``;
}

function buildStorageMarkdown() {
  if (typeof window === 'undefined') {
    return '# Session Storage\n\n当前环境不可读取 sessionStorage。';
  }

  const storage = window.sessionStorage;
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
    .filter((key): key is string => typeof key === 'string')
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));

  const lines: string[] = [
    '# Session Storage',
    '',
    `- Path: \`${window.location.pathname}\``,
    `- Total Keys: \`${keys.length}\``,
    '',
  ];

  if (keys.length === 0) {
    lines.push('当前 sessionStorage 为空。');
    return lines.join('\n');
  }

  for (const key of keys) {
    const raw = storage.getItem(key);
    const size = raw ? new Blob([raw]).size : 0;
    lines.push(`## ${key}`);
    lines.push('');
    lines.push(`- Size: \`${size}\` bytes`);
    lines.push(`- Type: \`${raw === null ? 'null' : safeJsonParse(raw).kind}\``);
    lines.push('');
    if (raw === null) {
      lines.push('`null`');
    } else {
      lines.push(formatValueAsMarkdown(raw));
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function isStorageDebugPath(pathname: string) {
  return pathname === STORAGE_PAGE_PATH;
}

export function StorageDebugPage() {
  const [markdown, setMarkdown] = useState('');
  const [lastUpdatedAt, setLastUpdatedAt] = useState('');

  const refresh = () => {
    setMarkdown(buildStorageMarkdown());
    setLastUpdatedAt(new Date().toLocaleString('zh-CN', { hour12: false }));
  };

  useEffect(() => {
    refresh();
  }, []);

  const lineCount = useMemo(() => markdown.split('\n').length, [markdown]);

  return (
    <main className="storage-debug-page">
      <section className="storage-debug-hero">
        <div>
          <p className="storage-debug-eyebrow">Debug</p>
          <h1>Session Storage</h1>
          <p className="storage-debug-subtitle">
            仅用于测试。当前页面把所有 sessionStorage 内容整理成 Markdown 文本。
          </p>
        </div>
        <div className="storage-debug-actions">
          <button type="button" className="storage-debug-refresh" onClick={refresh}>
            刷新
          </button>
          <p>更新时间：{lastUpdatedAt || '-'}</p>
          <p>行数：{lineCount}</p>
        </div>
      </section>

      <section className="storage-debug-content">
        <pre className="storage-debug-markdown">{markdown}</pre>
      </section>
    </main>
  );
}
