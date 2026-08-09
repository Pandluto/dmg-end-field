import { FormEvent, useState } from 'react';
import { grantAccessLease } from '../../platform/auth/accessLease';

interface AccessGateProps {
  onUnlocked: () => void;
  variant?: 'desktop' | 'mobile';
}

export function AccessGate({ onUnlocked, variant = 'desktop' }: AccessGateProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const status = await grantAccessLease(password);
      if (!status.granted) {
        setError('访问密码不正确。');
        setPassword('');
        return;
      }
      onUnlocked();
    } catch {
      setError('验证暂时不可用，请刷新页面后重试。');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="web-entry-screen">
      <section className="access-card">
        <div className="brand-mark" aria-hidden="true">
          <img src="./app-icon.png" alt="" />
        </div>
        <p className="eyebrow">{variant === 'mobile' ? 'MOBILE LTS 1.8' : 'WEB LTS 1.8'}</p>
        <h1>终末地伤害工作台</h1>
        <p className="access-intro">
          {variant === 'mobile'
            ? '验证后进入在线竖屏工作台，本浏览器将在 30 天内保持放行。'
            : '这是当前本地预览入口。通过验证后，本浏览器将在 30 天内保持放行。'}
        </p>
        <form onSubmit={handleSubmit} className="access-form">
          <label htmlFor="workspace-password">访问密码</label>
          <div className="access-input-row">
            <input
              id="workspace-password"
              autoFocus
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="输入访问密码"
              aria-invalid={Boolean(error)}
            />
            <button type="submit" disabled={!password || submitting}>
              {submitting ? '验证中' : '进入工作台'}
            </button>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
        </form>
        <p className="access-note">
          {variant === 'mobile'
            ? '通过验证后会直接读取线上最新资料，不会安装离线数据包。'
            : '当前为纯前端本地门禁，用于阻挡无效访问；正式公开部署前可无缝替换为服务端鉴权。'}
        </p>
      </section>
    </main>
  );
}
