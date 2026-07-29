interface RuntimeFailurePageProps {
  error: string;
}

export function RuntimeFailurePage({ error }: RuntimeFailurePageProps) {
  return (
    <main className="web-entry-screen">
      <section className="secondary-tab-card runtime-failure-card">
        <p className="eyebrow">启动失败</p>
        <h1>浏览器存储没有准备好</h1>
        <p>{error}</p>
        <p className="access-note">
          Web LTS 1.8 需要当前桌面版 Chrome 或 Edge，并需要在 localhost 或 HTTPS 安全上下文运行。
        </p>
        <button className="primary-action" type="button" onClick={() => window.location.reload()}>
          重新尝试
        </button>
      </section>
    </main>
  );
}

