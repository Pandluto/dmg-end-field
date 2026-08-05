import { useState } from 'react';

interface RuntimeFailurePageProps {
  error: string;
  onRetry?: () => void | Promise<void>;
}

export function RuntimeFailurePage({ error, onRetry }: RuntimeFailurePageProps) {
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
            if (!onRetry) {
              window.location.reload();
              return;
            }
            setRepairing(true);
            void Promise.resolve(onRetry()).finally(() => {
              setRepairing(false);
            });
          }}
        >
          {repairing ? '正在重新检查…' : '重新检查'}
        </button>
      </section>
    </main>
  );
}
