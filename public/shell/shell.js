(function () {
  const runtime = window.desktopRuntime;
  const LOCAL_BRIDGE_ORIGIN = 'http://127.0.0.1:31457';
  const AI_CLI_REST_ORIGIN = 'http://127.0.0.1:17321';
  const IMPORT_SECTIONS = ['operators', 'weapons', 'equipments', 'buffs', 'timeline', 'runtime'];
  const REQUIRED_IMPORT_SESSION_KEYS = {
    timeline: [
      'def.selected-characters.v1',
      'def.timeline.data.v1',
      'def.skill-button.v1',
      'def.all-buff-list.v1',
    ],
  };
  const TIMELINE_SNAPSHOT_ARCHIVE_KEY = 'def.timeline.snapshot-archive.v1';
  const state = {
    archives: [],
    selectedArchiveKey: null,
    activeArchiveKey: null,
    aiRestRunning: false,
    agentEventSource: null,
    agentPollTimer: 0,
    applyingArchive: false,
    imageItems: [],
  };

  const $ = (id) => document.getElementById(id);

  const logElement = $('log');
  const appendLog = (line) => {
    const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const text = `[${timestamp}] ${line}`;
    console.info(`[shell] ${line}`);
    if (!logElement) return;
    logElement.textContent = logElement.textContent ? `${logElement.textContent}\n${text}` : text;
    logElement.scrollTop = logElement.scrollHeight;
  };

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));

  const setText = (id, value) => {
    const element = $(id);
    if (element) element.textContent = value;
  };

  const setBadge = (id, text, tone = 'info') => {
    const element = $(id);
    if (!element) return;
    element.textContent = text;
    element.classList.remove('ok', 'warn', 'err', 'info');
    element.classList.add(tone);
  };

  const setButtonBusy = (button, busy, busyText) => {
    if (!button) return;
    if (busy) {
      button.dataset.originalText = button.textContent || '';
      button.textContent = busyText || '处理中';
      button.disabled = true;
    } else {
      button.textContent = button.dataset.originalText || button.textContent || '';
      button.disabled = false;
      delete button.dataset.originalText;
    }
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return '-';
    return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
  };

  const formatBytes = (value) => {
    if (!Number.isFinite(value)) return '-';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  };

  const fetchJson = async (origin, path, options = {}) => {
    const response = await fetch(`${origin}${path}`, {
      cache: 'no-store',
      ...options,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error?.message || payload?.error || `请求失败：${path}`);
    }
    return payload;
  };

  const fetchLocalBridgeJson = (path, options = {}) => fetchJson(LOCAL_BRIDGE_ORIGIN, path, options);
  const fetchAiRestJson = (path, options = {}) => fetchJson(AI_CLI_REST_ORIGIN, path, options);

  const formatArchiveId = () => {
    const date = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return `localdata-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  };

  const cloneArchiveForSave = (archive, name, description) => {
    const exportedAt = new Date().toISOString();
    const archiveId = formatArchiveId();
    return {
      ...archive,
      id: archiveId,
      name: name || archiveId,
      description: description || archive.description,
      createdAt: exportedAt,
      exportedAt,
    };
  };

  const getArchiveKey = (item) => item?.archiveKey || `${item?.storageScope || 'local'}:${item?.fileName || ''}`;

  const findSelectedArchive = () => state.archives.find((item) => getArchiveKey(item) === state.selectedArchiveKey) || null;

  const renderSelectedArchiveSummary = () => {
    const selectedArchive = findSelectedArchive();
    const hasSelection = Boolean(selectedArchive);
    setBadge('selected-archive-badge', hasSelection ? '已选择' : '未选择', hasSelection ? 'ok' : 'info');
    ['apply-archive', 'reveal-archive', 'delete-archive'].forEach((id) => {
      const button = $(id);
      if (button) button.disabled = !hasSelection;
    });
    if (!hasSelection) {
      setText('selected-archive-summary', '从下方列表选择一个存档后，可以定位、删除或写回 Web 快照。');
      return;
    }
    const scopeLabel = selectedArchive.storageScope === 'share' ? 'sharedata' : 'localdata';
    setText(
      'selected-archive-summary',
      `${selectedArchive.name || selectedArchive.id || selectedArchive.fileName} | ${scopeLabel} | ${formatBytes(selectedArchive.size)} | ${formatTime(selectedArchive.updatedAt)}`,
    );
  };

  const getCheckedSections = () => {
    const values = Array.from(document.querySelectorAll('#import-sections input[type="checkbox"]:checked'))
      .map((input) => input.value);
    return values.length > 0 ? values : ['all'];
  };

  const getImportCoveragePlan = (archive, sections) => {
    const requestedSections = sections.includes('all') ? IMPORT_SECTIONS : sections;
    const sessionValues = archive?.storage?.session || {};
    const localValues = archive?.storage?.local || {};
    const missingSections = requestedSections.filter((section) => {
      const requiredKeys = REQUIRED_IMPORT_SESSION_KEYS[section];
      return Array.isArray(requiredKeys) && requiredKeys.length > 0 && !requiredKeys.some((key) => key in sessionValues);
    });
    const snapshotOnlySections = missingSections.filter((section) => (
      section === 'timeline' && TIMELINE_SNAPSHOT_ARCHIVE_KEY in localValues
    ));
    const blockedSections = missingSections.filter((section) => !snapshotOnlySections.includes(section));
    const effectiveSections = requestedSections.filter((section) => !blockedSections.includes(section));
    if (missingSections.length === 0) {
      return { ok: true, sections, warning: '' };
    }
    const notices = [];
    if (snapshotOnlySections.length > 0) {
      notices.push(`${snapshotOnlySections.join(' / ')} 仅恢复快照库`);
    }
    if (blockedSections.length > 0) {
      notices.push(`已跳过 ${blockedSections.join(' / ')}`);
    }
    return {
      ok: effectiveSections.length > 0,
      sections: effectiveSections,
      warning: notices.join('；'),
    };
  };

  const setActivePage = (pageKey) => {
    document.querySelectorAll('.nav-button').forEach((button) => {
      button.classList.toggle('is-active', button.getAttribute('data-page') === pageKey);
    });
    document.querySelectorAll('.page').forEach((page) => {
      page.classList.toggle('is-active', page.id === `page-${pageKey}`);
    });
  };

  const renderAiRestStatus = (aiCliRest) => {
    state.aiRestRunning = Boolean(aiCliRest?.running);
    const label = state.aiRestRunning ? '运行中' : '未运行';
    const tone = state.aiRestRunning ? 'ok' : 'warn';
    const url = aiCliRest?.url || AI_CLI_REST_ORIGIN;

    setBadge('ai-rest-badge', label, tone);
    setBadge('ai-rest-service-badge', label, tone);
    setBadge('ai-mini-status', label, tone);
    setText('ai-rest-status', state.aiRestRunning ? `运行中 | ${url}` : 'AI REST 未运行，Agent 记录不可用。');
    setText('ai-rest-url', url);

    ['toggle-ai-rest', 'toggle-ai-rest-overview'].forEach((id) => {
      const button = $(id);
      if (!button) return;
      button.textContent = state.aiRestRunning ? '停止 AI REST' : '启动 AI REST';
      button.classList.toggle('danger-button', state.aiRestRunning);
      button.classList.toggle('primary-button', !state.aiRestRunning);
    });

    if (state.aiRestRunning) {
      connectAgentEventStream();
    } else {
      disconnectAgentEventStream();
      renderAgentRecords({ operationLogs: [], sessions: [] }, 'AI REST 未运行');
    }
  };

  const refreshAiRestStatus = async () => {
    const payload = await fetchLocalBridgeJson('/health');
    renderAiRestStatus(payload.aiCliRest);
    return payload.aiCliRest;
  };

  const toggleAiRest = async (button) => {
    setButtonBusy(button, true, state.aiRestRunning ? '正在停止' : '正在启动');
    try {
      const payload = await fetchLocalBridgeJson(state.aiRestRunning ? '/close-ai-cli-rest' : '/open-ai-cli-rest', {
        method: 'POST',
      });
      renderAiRestStatus(payload.aiCliRest);
      appendLog(`AI REST | ${payload.aiCliRest?.running ? '已启动' : '已停止'} | ${payload.aiCliRest?.url || AI_CLI_REST_ORIGIN}`);
    } finally {
      setButtonBusy(button, false);
    }
  };

  const renderAgentRecords = (records, fallbackText = '暂无记录') => {
    const logs = records.operationLogs || [];
    const sessions = records.sessions || [];
    const logsElement = $('agent-operation-logs');
    const sessionsElement = $('agent-sessions');

    if (logsElement) {
      logsElement.textContent = logs.length
        ? logs.slice(0, 40).map((log) => [
            formatTime(log.createdAt),
            log.client || '-',
            log.ok ? 'ok' : 'err',
            log.writes ? 'write' : 'read',
            log.command || '-',
            log.errorCode ? `error=${log.errorCode}` : '',
            log.storage?.length ? `storage=${log.storage.join(',')}` : '',
          ].filter(Boolean).join(' | ')).join('\n')
        : fallbackText;
    }

    if (sessionsElement) {
      sessionsElement.textContent = sessions.length
        ? sessions.slice(0, 30).map((session) => [
            formatTime(session.updatedAt),
            session.client || '-',
            session.status || '-',
            `messages=${session.messages?.length || 0}`,
            `last=${session.context?.lastCommand || '-'}`,
            session.id || '-',
          ].join(' | ')).join('\n')
        : fallbackText;
    }

    setText('agent-records-status', `operation logs=${logs.length}；sessions=${sessions.length}`);
    setText('metric-agent', String(logs.length + sessions.length));
    setText('metric-agent-foot', `logs ${logs.length} / sessions ${sessions.length}`);
  };

  const refreshAgentRecords = async () => {
    if (!state.aiRestRunning) {
      renderAgentRecords({ operationLogs: [], sessions: [] }, 'AI REST 未运行');
      return;
    }
    const records = await fetchAiRestJson('/api/agent/records');
    renderAgentRecords(records);
  };

  const disconnectAgentEventStream = () => {
    if (!state.agentEventSource) return;
    state.agentEventSource.close();
    state.agentEventSource = null;
  };

  const connectAgentEventStream = () => {
    if (state.agentEventSource || typeof EventSource === 'undefined') return;
    state.agentEventSource = new EventSource(`${AI_CLI_REST_ORIGIN}/api/agent/events`);
    state.agentEventSource.addEventListener('agent.records', (event) => {
      try {
        renderAgentRecords(JSON.parse(event.data));
      } catch (error) {
        appendLog(`Agent SSE 解析失败 | ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    state.agentEventSource.onerror = () => {
      setText('agent-records-status', 'SSE 重连中，保留最近一次记录。');
    };
  };

  const startAgentPolling = () => {
    if (state.agentPollTimer) return;
    state.agentPollTimer = window.setInterval(() => {
      if (!state.aiRestRunning || state.agentEventSource) return;
      refreshAgentRecords().catch(() => {});
    }, 5000);
  };

  const renderArchiveList = () => {
    const listElement = $('archive-list');
    if (!listElement) return;
    if (state.archives.length === 0) {
      listElement.innerHTML = '<div class="empty-state">还没有本地存档。先打开浏览器 Web 主界面生成 now-storage，再从这里保存。</div>';
      state.selectedArchiveKey = null;
      renderSelectedArchiveSummary();
      return;
    }

    listElement.innerHTML = state.archives.map((item) => {
      const archiveKey = getArchiveKey(item);
      const scopeLabel = item.storageScope === 'share' ? 'sharedata' : 'localdata';
      const isActive = archiveKey === state.activeArchiveKey;
      const updatedAt = formatTime(item.updatedAt);
      return `
        <button type="button" class="archive-item${archiveKey === state.selectedArchiveKey ? ' is-active' : ''}" data-archive="${escapeHtml(archiveKey)}" title="${escapeHtml(item.path || item.fileName)}">
          <div class="item-line">
            <span class="item-title">${escapeHtml(item.name || item.id || item.fileName)}</span>
            <span class="pill ${isActive ? 'ok' : 'info'}">${isActive ? '当前引用' : escapeHtml(scopeLabel)}</span>
          </div>
          <div class="item-line">
            <span class="item-meta">${escapeHtml(item.fileName)}</span>
            <span class="item-meta">${escapeHtml(formatBytes(item.size))}</span>
          </div>
          <div class="item-meta">${escapeHtml(updatedAt)}</div>
        </button>
      `;
    }).join('');

    listElement.querySelectorAll('[data-archive]').forEach((button) => {
      button.addEventListener('click', () => {
        state.selectedArchiveKey = button.getAttribute('data-archive');
        renderArchiveList();
      });
    });
    renderSelectedArchiveSummary();
  };

  const refreshNowStorage = async () => {
    try {
      const payload = await fetchLocalBridgeJson('/local-data/now-storage');
      const hasArchive = Boolean(payload.archive);
      setBadge('now-storage-badge', hasArchive ? '已同步' : '无快照', hasArchive ? 'ok' : 'warn');
      setText('metric-now-storage', hasArchive ? '可用' : '无');
      setText('metric-now-storage-foot', hasArchive ? `更新：${formatTime(payload.meta?.updatedAt || payload.state?.updatedAt)}` : '打开或刷新 Web 主界面后生成');
      return payload;
    } catch (error) {
      setBadge('now-storage-badge', '异常', 'err');
      setText('metric-now-storage', '异常');
      setText('metric-now-storage-foot', error instanceof Error ? error.message : String(error));
      throw error;
    }
  };

  const refreshArchives = async () => {
    if (!runtime?.listLocalDataArchives) {
      setText('localdata-status', '当前环境不是 Electron Shell，无法读取本地存档。');
      setText('archive-summary', '运行时不可用');
      return;
    }
    const result = await runtime.listLocalDataArchives();
    if (!result.ok) {
      setText('localdata-status', result.error || '读取存档失败');
      appendLog(`数据存档 | 读取失败 | ${result.error || '-'}`);
      return;
    }

    state.archives = result.archives || [];
    state.activeArchiveKey = result.state?.activeFileName
      ? `${result.state?.activeStorageScope || 'local'}:${result.state.activeFileName}`
      : null;
    if (!state.selectedArchiveKey && state.archives[0]) {
      state.selectedArchiveKey = getArchiveKey(state.archives[0]);
    }
    if (state.selectedArchiveKey && !state.archives.some((item) => getArchiveKey(item) === state.selectedArchiveKey)) {
      state.selectedArchiveKey = state.archives[0] ? getArchiveKey(state.archives[0]) : null;
    }

    renderArchiveList();
    const localCount = state.archives.filter((item) => item.storageScope !== 'share').length;
    const shareCount = state.archives.filter((item) => item.storageScope === 'share').length;
    setText('archive-summary', `共 ${state.archives.length} 个存档；localdata ${localCount}；sharedata ${shareCount}`);
    setBadge('archive-count-badge', String(state.archives.length), state.archives.length > 0 ? 'ok' : 'info');
    setText('localdata-status', `当前引用：${state.activeArchiveKey || '未设置'}`);
    setText('metric-archives', String(state.archives.length));
    setText('metric-archives-foot', `local ${localCount} / share ${shareCount}`);
  };

  const exportArchive = async (storageScope) => {
    if (!runtime?.saveLocalDataArchive) {
      setText('localdata-status', '当前运行时不支持保存存档。');
      return;
    }
    const scope = storageScope === 'share' ? 'share' : 'local';
    const scopeLabel = scope === 'share' ? 'sharedata' : 'localdata';
    setText('localdata-status', `正在读取 now-storage 并保存到 ${scopeLabel}...`);

    const nowStorage = await refreshNowStorage();
    if (!nowStorage.archive) {
      setText('localdata-status', 'now-storage 还没有 Web 快照。请先打开或刷新浏览器 Web 主界面。');
      appendLog(`数据存档 | 导出失败 | now-storage 无快照`);
      return;
    }

    const archive = cloneArchiveForSave(
      nowStorage.archive,
      $('archive-name')?.value.trim(),
      $('archive-desc')?.value.trim(),
    );
    const saved = await runtime.saveLocalDataArchive({ ...archive, storageScope: scope });
    if (!saved.ok) {
      setText('localdata-status', saved.error || '保存存档失败');
      appendLog(`数据存档 | 保存失败 | ${saved.error || '-'}`);
      return;
    }

    state.selectedArchiveKey = saved.meta ? getArchiveKey(saved.meta) : null;
    state.activeArchiveKey = saved.state?.activeFileName
      ? `${saved.state?.activeStorageScope || scope}:${saved.state.activeFileName}`
      : state.selectedArchiveKey;
    setText('localdata-status', `已保存到 ${scopeLabel}：${saved.meta?.fileName || saved.path || ''}`);
    appendLog(`数据存档 | 已保存到 ${scopeLabel} | ${saved.path}`);
    await refreshArchives();
  };

  const applyArchive = async () => {
    if (state.applyingArchive) {
      setText('localdata-status', '正在写入 now-storage，请稍候。');
      return;
    }
    const selectedArchive = findSelectedArchive();
    if (!selectedArchive) {
      setText('localdata-status', '请先选择一个存档。');
      return;
    }
    if (!runtime?.readLocalDataArchive) {
      setText('localdata-status', '当前运行时不支持读取存档。');
      return;
    }

    const sections = getCheckedSections();
    setText('localdata-status', '正在读取存档并写入 now-storage...');
    const loaded = await runtime.readLocalDataArchive({
      fileName: selectedArchive.fileName,
      storageScope: selectedArchive.storageScope,
    });
    if (!loaded.ok || !loaded.archive) {
      setText('localdata-status', loaded.error || '读取存档失败');
      appendLog(`数据存档 | 读取失败 | ${loaded.error || '-'}`);
      return;
    }

    const coveragePlan = getImportCoveragePlan(loaded.archive, sections);
    if (!coveragePlan.ok) {
      setText('localdata-status', coveragePlan.warning || '存档没有可导入分组。');
      appendLog(`数据存档 | 导入预检失败 | ${getArchiveKey(selectedArchive)} | ${coveragePlan.warning || '-'}`);
      return;
    }

    state.applyingArchive = true;
    const importArchive = {
      ...loaded.archive,
      sections: coveragePlan.sections,
    };
    try {
      await fetchLocalBridgeJson('/local-data/now-storage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(importArchive),
      });
      await fetchLocalBridgeJson('/local-data/now-storage-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceApply: true }),
      });
      state.activeArchiveKey = getArchiveKey(selectedArchive);
      const notice = coveragePlan.warning ? `；${coveragePlan.warning}` : '';
      setText('localdata-status', `已写入 now-storage；刷新浏览器 Web 主界面后生效；当前引用：${state.activeArchiveKey}${notice}`);
      appendLog(`数据存档 | 已写入 now-storage | ${state.activeArchiveKey} | ${coveragePlan.sections.join(' / ')}${notice}`);
      await refreshNowStorage();
      renderArchiveList();
    } finally {
      window.setTimeout(() => {
        state.applyingArchive = false;
      }, 500);
    }
  };

  const deleteArchive = async () => {
    const selectedArchive = findSelectedArchive();
    if (!selectedArchive) {
      setText('localdata-status', '请先选择一个存档。');
      return;
    }
    if (!runtime?.deleteLocalDataArchive) {
      setText('localdata-status', '当前运行时不支持删除存档。');
      return;
    }
    const result = await runtime.deleteLocalDataArchive({
      fileName: selectedArchive.fileName,
      storageScope: selectedArchive.storageScope,
    });
    if (!result.ok) {
      setText('localdata-status', result.error || '删除失败');
      appendLog(`数据存档 | 删除失败 | ${result.error || '-'}`);
      return;
    }
    appendLog(`数据存档 | 已删除 | ${getArchiveKey(selectedArchive)}`);
    state.selectedArchiveKey = null;
    await refreshArchives();
  };

  const revealSelectedArchive = async () => {
    const selectedArchive = findSelectedArchive();
    if (!selectedArchive) {
      setText('localdata-status', '请先选择一个存档。');
      return;
    }
    const result = await runtime?.revealLocalDataArchive?.({
      fileName: selectedArchive.fileName,
      storageScope: selectedArchive.storageScope,
    });
    appendLog(result?.ok ? `数据存档 | 已定位 | ${result.path || ''}` : `数据存档 | 定位失败 | ${result?.error || '-'}`);
  };

  const refreshImages = async () => {
    const listElement = $('image-list');
    try {
      const [capabilityPayload, listPayload] = await Promise.all([
        fetchLocalBridgeJson('/image-assets/capabilities'),
        fetchLocalBridgeJson('/image-assets/list'),
      ]);
      const capabilities = capabilityPayload.capabilities || {};
      state.imageItems = listPayload.items || [];
      const dirs = state.imageItems.filter((item) => item.kind === 'directory' || item.type === 'directory');
      const files = state.imageItems.filter((item) => item.kind !== 'directory' && item.type !== 'directory');

      setBadge('image-bridge-badge', capabilities.writable === false ? '只读' : '可管理', capabilities.writable === false ? 'warn' : 'ok');
      setBadge('image-mode-badge', capabilities.writable === false ? '只读' : '可管理', capabilities.writable === false ? 'warn' : 'ok');
      setText('image-bridge-detail', capabilities.rootDir || capabilities.path || 'Shell 本地图片 bridge 已连接');
      setText('image-mode-detail', capabilities.writable === false ? '当前桥接为只读模式。' : '当前桥接支持目录和文件管理。');
      setText('image-dir-count', String(dirs.length));
      setText('image-file-count', String(files.length));
      setText('metric-images', String(files.length));
      setText('metric-images-foot', `${dirs.length} 个目录`);
      setText('image-status', `共 ${state.imageItems.length} 个条目；文件 ${files.length}；目录 ${dirs.length}`);

      if (!listElement) return;
      const visibleItems = state.imageItems.slice(0, 60);
      listElement.innerHTML = visibleItems.length
        ? visibleItems.map((item) => {
            const isDir = item.kind === 'directory' || item.type === 'directory';
            const name = item.name || item.fileName || item.relativePath || item.dirPath || '-';
            const rel = item.relativePath || item.dirPath || item.path || '';
            return `
              <div class="asset-item" title="${escapeHtml(rel)}">
                <div class="item-line">
                  <span class="item-title">${escapeHtml(name)}</span>
                  <span class="pill ${isDir ? 'info' : 'ok'}">${isDir ? '目录' : '文件'}</span>
                </div>
                <div class="item-line">
                  <span class="item-meta">${escapeHtml(rel || '-')}</span>
                  <span class="item-meta">${escapeHtml(formatBytes(item.size))}</span>
                </div>
              </div>
            `;
          }).join('')
        : '<div class="empty-state">图片目录暂无可展示条目。</div>';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setBadge('image-bridge-badge', '异常', 'err');
      setBadge('image-mode-badge', '异常', 'err');
      setText('image-bridge-detail', message);
      setText('image-mode-detail', message);
      setText('image-status', message);
      setText('metric-images', '异常');
      setText('metric-images-foot', message);
      if (listElement) {
        listElement.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
      }
      throw error;
    }
  };

  const revealImageDirectory = async () => {
    try {
      const result = await fetchLocalBridgeJson('/image-assets/reveal-directory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dirPath: 'images' }),
      });
      appendLog(result.ok ? `图片资产 | 已打开目录 | ${result.path || ''}` : `图片资产 | 打开失败 | ${result.error || '-'}`);
    } catch (error) {
      appendLog(`图片资产 | 打开目录失败 | ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const refreshShellState = async () => {
    if (!runtime) {
      setBadge('shell-status-badge', '不可用', 'err');
      setBadge('shell-mini-status', '不可用', 'err');
      setBadge('nav-health-badge', '异常', 'err');
      setText('shell-status-detail', 'desktopRuntime 不存在，请用 Electron Shell 启动。');
      setText('host-summary', '非 Electron Shell 环境');
      return;
    }
    const shellState = await runtime.getShellState();
    setBadge('shell-status-badge', '正常', 'ok');
    setBadge('shell-mini-status', '正常', 'ok');
    setBadge('nav-health-badge', '正常', 'ok');
    setText('shell-status-detail', `平台 ${shellState.platform || runtime.platform || '-'}；主机 ${shellState.hostname || '-'}`);
    setText('host-summary', `${shellState.hostname || 'local'} · ${shellState.platform || runtime.platform || '-'}`);
  };

  const refreshOverview = async () => {
    await Promise.allSettled([
      refreshShellState(),
      refreshAiRestStatus(),
      refreshArchives(),
      refreshNowStorage(),
      refreshImages(),
      refreshAgentRecords(),
    ]);
  };

  const bindEvents = () => {
    document.querySelectorAll('.nav-button').forEach((button) => {
      button.addEventListener('click', () => {
        const pageKey = button.getAttribute('data-page');
        if (pageKey) setActivePage(pageKey);
      });
    });

    $('refresh-overview')?.addEventListener('click', () => {
      refreshOverview().catch((error) => appendLog(`刷新总览失败 | ${error instanceof Error ? error.message : String(error)}`));
    });
    $('refresh-ai-rest')?.addEventListener('click', () => {
      refreshAiRestStatus().catch((error) => appendLog(`AI REST 刷新失败 | ${error instanceof Error ? error.message : String(error)}`));
    });
    $('toggle-ai-rest')?.addEventListener('click', (event) => {
      toggleAiRest(event.currentTarget).catch((error) => appendLog(`AI REST 切换失败 | ${error instanceof Error ? error.message : String(error)}`));
    });
    $('toggle-ai-rest-overview')?.addEventListener('click', (event) => {
      toggleAiRest(event.currentTarget).catch((error) => appendLog(`AI REST 切换失败 | ${error instanceof Error ? error.message : String(error)}`));
    });
    $('refresh-agent-records')?.addEventListener('click', () => {
      refreshAgentRecords().catch((error) => appendLog(`Agent 记录刷新失败 | ${error instanceof Error ? error.message : String(error)}`));
    });
    $('refresh-archives')?.addEventListener('click', () => {
      Promise.allSettled([refreshArchives(), refreshNowStorage()]).catch(() => {});
    });
    $('export-archive-local')?.addEventListener('click', () => {
      exportArchive('local').catch((error) => {
        setText('localdata-status', error instanceof Error ? error.message : String(error));
        appendLog(`数据存档 | 导出 localdata 失败 | ${error instanceof Error ? error.message : String(error)}`);
      });
    });
    $('export-archive-share')?.addEventListener('click', () => {
      exportArchive('share').catch((error) => {
        setText('localdata-status', error instanceof Error ? error.message : String(error));
        appendLog(`数据存档 | 导出 sharedata 失败 | ${error instanceof Error ? error.message : String(error)}`);
      });
    });
    $('apply-archive')?.addEventListener('click', () => {
      applyArchive().catch((error) => {
        setText('localdata-status', error instanceof Error ? error.message : String(error));
        appendLog(`数据存档 | 写入 now-storage 失败 | ${error instanceof Error ? error.message : String(error)}`);
      });
    });
    $('delete-archive')?.addEventListener('click', () => {
      deleteArchive().catch((error) => {
        setText('localdata-status', error instanceof Error ? error.message : String(error));
        appendLog(`数据存档 | 删除失败 | ${error instanceof Error ? error.message : String(error)}`);
      });
    });
    $('reveal-archive')?.addEventListener('click', () => {
      revealSelectedArchive().catch((error) => appendLog(`数据存档 | 定位失败 | ${error instanceof Error ? error.message : String(error)}`));
    });
    $('open-localdata')?.addEventListener('click', async () => {
      const result = await runtime?.revealLocalDataArchive?.({ storageScope: 'local' });
      appendLog(result?.ok ? `数据存档 | 已打开 localdata | ${result.path || ''}` : `数据存档 | 打开 localdata 失败 | ${result?.error || '-'}`);
    });
    $('open-sharedata')?.addEventListener('click', async () => {
      const result = await runtime?.revealLocalDataArchive?.({ storageScope: 'share' });
      appendLog(result?.ok ? `数据存档 | 已打开 sharedata | ${result.path || ''}` : `数据存档 | 打开 sharedata 失败 | ${result?.error || '-'}`);
    });
    $('refresh-images')?.addEventListener('click', () => {
      refreshImages().catch((error) => appendLog(`图片资产 | 刷新失败 | ${error instanceof Error ? error.message : String(error)}`));
    });
    $('open-image-dir')?.addEventListener('click', () => {
      revealImageDirectory().catch((error) => appendLog(`图片资产 | 打开目录异常 | ${error instanceof Error ? error.message : String(error)}`));
    });
    $('clear-log')?.addEventListener('click', () => {
      logElement.textContent = '';
    });
    $('quit-app')?.addEventListener('click', async () => {
      try {
        appendLog('正在完全关闭 Shell 进程...');
        await runtime?.quitApp?.();
      } catch (error) {
        appendLog(`完全关闭失败 | ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    $('hide-shell')?.addEventListener('click', async () => {
      try {
        await fetchLocalBridgeJson('/close-shell', { method: 'POST' });
        appendLog('Shell 窗口已隐藏，可从托盘重新打开。');
      } catch (error) {
        appendLog(`隐藏 Shell 失败 | ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  };

  const boot = async () => {
    appendLog('Shell 控制台初始化开始');
    bindEvents();
    if (!runtime) {
      await refreshShellState();
      appendLog('desktopRuntime 不可用；请通过 npm run electron:dev 启动 Electron Shell。');
      return;
    }
    await refreshOverview();
    startAgentPolling();
    appendLog('Shell 控制台初始化完成');
  };

  window.addEventListener('error', (event) => {
    appendLog(`Shell 脚本错误 | ${event.message || 'unknown'} | ${event.filename || '-'}:${event.lineno || 0}`);
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason instanceof Error ? event.reason.message : String(event.reason || 'unknown');
    appendLog(`Shell 异步错误 | ${reason}`);
  });

  boot().catch((error) => {
    appendLog(`Shell 初始化失败 | ${error instanceof Error ? error.message : String(error)}`);
  });
})();
