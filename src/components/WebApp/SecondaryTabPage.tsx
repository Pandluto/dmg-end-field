import { useState } from 'react';
import { workspaceLease } from '../../platform/runtime/workspaceLease';

interface SecondaryTabPageProps {
  onControlAcquired: () => void;
}

export function SecondaryTabPage({ onControlAcquired }: SecondaryTabPageProps) {
  const [requesting, setRequesting] = useState(false);
  const [message, setMessage] = useState('');

  const handleTakeControl = async () => {
    setRequesting(true);
    setMessage('');
    const role = await workspaceLease.requestControl();
    if (role === 'writer') {
      onControlAcquired();
      return;
    }
    setMessage('另一个标签页仍在处理写入，请稍后再试。');
    setRequesting(false);
  };

  return (
    <main className="web-entry-screen">
      <section className="secondary-tab-card">
        <span className="status-orb" />
        <p className="eyebrow">工作区已占用</p>
        <h1>另一个标签页正在编辑</h1>
        <p>
          为保证浏览器 SQLite 的事务完整性，本标签页不会同时打开写入连接。
          你可以回到原标签页，或把控制权切换到这里。
        </p>
        <button className="primary-action" type="button" onClick={handleTakeControl} disabled={requesting}>
          {requesting ? '正在请求控制权…' : '在此标签页继续'}
        </button>
        {message && <p className="form-error">{message}</p>}
      </section>
    </main>
  );
}

