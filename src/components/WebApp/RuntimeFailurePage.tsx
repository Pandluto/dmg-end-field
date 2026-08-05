import { useState } from 'react';

interface RuntimeFailurePageProps {
  error: string;
}

export function RuntimeFailurePage({ error }: RuntimeFailurePageProps) {
  const canRepairPageCache = error.includes('图片缓存服务');
  const [repairing, setRepairing] = useState(false);

  return (
    <main className="web-entry-screen">
      <section className="secondary-tab-card runtime-failure-card">
        <p className="eyebrow">启动失败</p>
        <h1>工作区没有准备好</h1>
        <p>{error}</p>
        <p className="access-note">
          Web LTS 1.8 需要当前桌面版 Chrome 或 Edge，并需要在 localhost 或 HTTPS 安全上下文运行。
        </p>
        <button
          className="primary-action"
          type="button"
          disabled={repairing}
          onClick={() => {
            if (canRepairPageCache && window.__DMG_RECOVER_STARTUP__) {
              setRepairing(true);
              void window.__DMG_RECOVER_STARTUP__().finally(() => {
                setRepairing(false);
              });
              return;
            }
            window.location.reload();
          }}
        >
          {repairing
            ? '正在修复，请稍候…'
            : canRepairPageCache ? '修复并重新加载' : '重新尝试'}
        </button>
      </section>
    </main>
  );
}
