(function () {
  const runtime = window.desktopRuntime;
  const logElement = document.getElementById('log');
  const logCardElement = document.getElementById('log-card');
  const arkApiKeyInput = document.getElementById('ark-api-key');
  const arkModelInput = document.getElementById('ark-model');
  const arkPromptInput = document.getElementById('ark-prompt');
  const arkOutputElement = document.getElementById('ark-output');
  const captureSourceSelect = document.getElementById('capture-source-select');
  const captureMetaElement = document.getElementById('capture-meta');
  const capturePreviewElement = document.getElementById('capture-preview');
  let captureSources = [];
  let capturePresets = [];
  let capturePollTimer = 0;
  let latestCaptureFrameStamp = 0;
  let lastCaptureMetaMarkup = '';
  let archiveList = [];
  let selectedArchiveKey = null;
  let activeArchiveKey = null;
  let isApplyingArchive = false;
  let aiRestRunning = false;
  let agentRecordsPollTimer = 0;
  let agentEventSource = null;
  const statusCache = new Map();
  const SHELL_STORAGE_KEYS = {
    arkPrompt: 'def.shell.ark.prompt.v1',
  };
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
  const LOCAL_BRIDGE_ORIGIN = 'http://127.0.0.1:31457';
  const AI_CLI_REST_ORIGIN = 'http://127.0.0.1:17321';

  const appendLog = (line) => {
    console.info(`[shell] ${line}`);
    if (!logElement) {
      return;
    }
    const current = logElement.textContent ? `${logElement.textContent}\n` : '';
    logElement.textContent = `${current}${line}`;
    logElement.scrollTop = logElement.scrollHeight;
  };

  window.addEventListener('error', (event) => {
    appendLog(`Shell 脚本错误 | ${event.message || 'unknown'} | ${event.filename || '-'}:${event.lineno || 0}`);
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason instanceof Error ? event.reason.message : String(event.reason || 'unknown');
    appendLog(`Shell 异步错误 | ${reason}`);
  });

  const setStatus = (id, value) => {
    const target = document.getElementById(id);
    if (target && statusCache.get(id) !== value) {
      target.textContent = value;
      statusCache.set(id, value);
    }
  };

  const fetchLocalBridgeJson = async (path, options = {}) => {
    const response = await fetch(`${LOCAL_BRIDGE_ORIGIN}${path}`, {
      cache: 'no-store',
      ...options,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || `本地 bridge 请求失败：${path}`);
    }
    return payload;
  };

  const fetchAiRestJson = async (path, options = {}) => {
    const response = await fetch(`${AI_CLI_REST_ORIGIN}${path}`, {
      cache: 'no-store',
      ...options,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error?.message || payload?.error || `AI REST 请求失败：${path}`);
    }
    return payload;
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return '-';
    return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
  };

  const formatArchiveId = () => {
    const date = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return `localdata-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  };

  const cloneNowStorageArchiveForSave = (archive, name, description) => {
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

  const getImportCoveragePlan = (archive, sections) => {
    const requestedSections = sections.includes('all')
      ? IMPORT_SECTIONS
      : sections;
    const sessionValues = archive?.storage?.session || {};
    const localValues = archive?.storage?.local || {};
    const missingCurrentSections = requestedSections.filter((section) => {
      const requiredKeys = REQUIRED_IMPORT_SESSION_KEYS[section];
      return Array.isArray(requiredKeys) && requiredKeys.length > 0 && !requiredKeys.some((key) => key in sessionValues);
    });
    const snapshotOnlySections = missingCurrentSections.filter((section) => (
      section === 'timeline' && TIMELINE_SNAPSHOT_ARCHIVE_KEY in localValues
    ));
    const blockedSections = missingCurrentSections.filter((section) => !snapshotOnlySections.includes(section));
    const effectiveSections = requestedSections.filter((section) => !blockedSections.includes(section));
    if (missingCurrentSections.length === 0) {
      return { ok: true, sections, missingSections: [], snapshotOnlySections: [], warning: '' };
    }
    const archiveSessionKeys = Object.keys(sessionValues);
    const notices = [];
    if (snapshotOnlySections.length > 0) {
      notices.push(`存档缺少当前态 sessionStorage，${snapshotOnlySections.join(' / ')} 仅恢复快照库`);
    }
    if (blockedSections.length > 0) {
      notices.push(`已跳过：${blockedSections.join(' / ')}`);
    }
    const warning = `${notices.join('；')}。当前存档 session key：${archiveSessionKeys.join(', ') || '无'}`;
    return {
      ok: effectiveSections.length > 0,
      sections: effectiveSections,
      missingSections: missingCurrentSections,
      snapshotOnlySections,
      warning,
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
    aiRestRunning = Boolean(aiCliRest?.running);
    const toggleButton = document.getElementById('toggle-ai-rest');
    if (toggleButton) {
      toggleButton.textContent = aiRestRunning ? '停止' : '启动';
      toggleButton.classList.toggle('danger-button', aiRestRunning);
      toggleButton.classList.toggle('primary-button', !aiRestRunning);
    }
    const statusText = aiRestRunning
      ? `运行中 | ${aiCliRest.url || 'http://127.0.0.1:17321'}`
      : '未运行';
    setStatus('ai-rest-status', statusText);
    if (aiRestRunning) {
      connectAgentEventStream();
    } else {
      disconnectAgentEventStream();
    }
  };

  const refreshAiRestStatus = async () => {
    const payload = await fetchLocalBridgeJson('/health');
    renderAiRestStatus(payload.aiCliRest);
    return payload.aiCliRest;
  };

  const toggleAiRest = async () => {
    setStatus('ai-rest-status', aiRestRunning ? '正在停止...' : '正在启动...');
    const payload = await fetchLocalBridgeJson(aiRestRunning ? '/close-ai-cli-rest' : '/open-ai-cli-rest', {
      method: 'POST',
    });
    renderAiRestStatus(payload.aiCliRest);
    appendLog(`AI REST | ${payload.aiCliRest?.running ? '已启动' : '已停止'} | ${payload.aiCliRest?.url || 'http://127.0.0.1:17321'}`);
  };

  const renderAgentRecords = (records) => {
    const logsElement = document.getElementById('agent-operation-logs');
    const sessionsElement = document.getElementById('agent-sessions');
    const logs = records.operationLogs || [];
    const sessions = records.sessions || [];

    logsElement.textContent = logs.length
      ? logs.slice(0, 30).map((log) => [
          formatTime(log.createdAt),
          log.client || '-',
          log.ok ? 'ok' : 'err',
          log.writes ? 'write' : 'read',
          log.command || '-',
          log.errorCode ? `error=${log.errorCode}` : '',
          log.storage?.length ? `storage=${log.storage.join(',')}` : '',
        ].filter(Boolean).join(' | ')).join('\n')
      : '暂无记录';

    sessionsElement.textContent = sessions.length
      ? sessions.slice(0, 20).map((session) => [
          formatTime(session.updatedAt),
          session.client || '-',
          session.status || '-',
          `messages=${session.messages?.length || 0}`,
          `last=${session.context?.lastCommand || '-'}`,
          session.id || '-',
        ].join(' | ')).join('\n')
      : '暂无会话';

    setStatus('agent-records-status', `logs=${logs.length} sessions=${sessions.length}`);
  };

  const refreshAgentRecords = async () => {
    const records = await fetchAiRestJson('/api/agent/records');
    renderAgentRecords(records);
  };

  const disconnectAgentEventStream = () => {
    if (!agentEventSource) {
      return;
    }
    agentEventSource.close();
    agentEventSource = null;
  };

  const connectAgentEventStream = () => {
    if (agentEventSource || typeof EventSource === 'undefined') {
      return;
    }
    agentEventSource = new EventSource(`${AI_CLI_REST_ORIGIN}/api/agent/events`);
    agentEventSource.addEventListener('agent.records', (event) => {
      try {
        renderAgentRecords(JSON.parse(event.data));
      } catch (error) {
        appendLog(`Agent SSE 解析失败 | ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    agentEventSource.onerror = () => {
      setStatus('agent-records-status', 'SSE 重连中...');
    };
  };

  const startAgentRecordsPolling = () => {
    if (agentRecordsPollTimer) {
      return;
    }
    agentRecordsPollTimer = window.setInterval(() => {
      if (!aiRestRunning) {
        return;
      }
      if (agentEventSource) {
        return;
      }
      refreshAgentRecords().catch(() => {});
    }, 5000);
  };

  const safeReadLocal = (key, fallback = '') => {
    try {
      return window.localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  };

  const safeWriteLocal = (key, value) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {}
  };

  const getCheckedSections = (containerId) => {
    const values = Array.from(document.querySelectorAll(`#${containerId} input[type="checkbox"]:checked`))
      .map((input) => input.value);
    return values.length > 0 ? values : ['all'];
  };

  const formatBytes = (value) => {
    if (!Number.isFinite(value)) return '-';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  };

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));

  const getArchiveKey = (item) => item?.archiveKey || `${item?.storageScope || 'local'}:${item?.fileName || ''}`;

  const findSelectedArchive = () => archiveList.find((item) => getArchiveKey(item) === selectedArchiveKey) || null;

  const formatArchiveRelativePath = (item) => {
    const folder = item?.storageScope === 'share' ? 'sharedata' : 'localdata';
    return `data/${folder}/${item?.fileName || ''}`;
  };

  const renderArchiveList = () => {
    const listElement = document.getElementById('archive-list');
    if (!listElement) return;
    if (archiveList.length === 0) {
      listElement.innerHTML = '<div class="status">data/sharedata 暂无共享存档</div>';
      selectedArchiveKey = null;
      return;
    }
    listElement.innerHTML = archiveList.map((item) => {
      const archiveKey = getArchiveKey(item);
      const scopeLabel = item.storageScope === 'share' ? 'sharedata' : 'localdata';
      const relativePath = formatArchiveRelativePath(item);
      const updatedAt = item.updatedAt ? new Date(item.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '';
      return `
      <button type="button" class="archive-item${archiveKey === selectedArchiveKey ? ' is-active' : ''}" data-archive="${escapeHtml(archiveKey)}" title="${escapeHtml(item.path || relativePath)}">
        <div class="archive-title">
          <span class="archive-name">
            <span class="archive-scope">${escapeHtml(scopeLabel)}</span>
            ${escapeHtml(item.name || item.id)}
            ${archiveKey === activeArchiveKey ? '<span class="archive-current">当前</span>' : ''}
          </span>
          <span class="archive-size">${escapeHtml(formatBytes(item.size))}</span>
        </div>
        <div class="archive-meta">
          <span class="archive-file">${escapeHtml(item.fileName)}</span>
          <span class="archive-time">${escapeHtml(updatedAt)}</span>
        </div>
      </button>
    `;
    }).join('');
    listElement.querySelectorAll('[data-archive]').forEach((button) => {
      button.addEventListener('click', () => {
        selectedArchiveKey = button.getAttribute('data-archive');
        renderArchiveList();
      });
    });
  };

  const refreshArchives = async () => {
    if (!runtime.listLocalDataArchives) {
      setStatus('localdata-status', '当前运行时不支持本地存档');
      return;
    }
    const result = await runtime.listLocalDataArchives();
    if (!result.ok) {
      setStatus('localdata-status', result.error || '读取存档失败');
      appendLog(`本地存档 | 读取失败 | ${result.error || '-'}`);
      return;
    }
    archiveList = result.archives || [];
    activeArchiveKey = result.state?.activeFileName
      ? `${result.state?.activeStorageScope || 'local'}:${result.state.activeFileName}`
      : null;
    if (!selectedArchiveKey && archiveList[0]) {
      selectedArchiveKey = getArchiveKey(archiveList[0]);
    }
    if (selectedArchiveKey && !archiveList.some((item) => getArchiveKey(item) === selectedArchiveKey)) {
      selectedArchiveKey = archiveList[0] ? getArchiveKey(archiveList[0]) : null;
    }
    renderArchiveList();
    setStatus('localdata-status', `当前：${activeArchiveKey || '未设置'}；${archiveList.length} 个存档`);
  };

  const exportArchive = async (storageScope = 'local') => {
    if (!runtime.saveLocalDataArchive) {
      setStatus('localdata-status', '当前运行时不支持保存存档');
      return;
    }
    const normalizedScope = storageScope === 'local' ? 'local' : 'share';
    const scopeLabel = normalizedScope === 'share' ? 'sharedata' : 'localdata';
    const name = document.getElementById('archive-name').value.trim();
    const description = document.getElementById('archive-desc').value.trim();
    setStatus('localdata-status', `正在读取浏览器 now-storage 快照并导出到 ${scopeLabel}...`);
    let nowStorage;
    try {
      nowStorage = await fetchLocalBridgeJson('/local-data/now-storage');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus('localdata-status', message);
      appendLog(`本地存档 | 读取 now-storage 失败 | ${message}`);
      return;
    }
    if (!nowStorage.archive) {
      setStatus('localdata-status', 'now-storage 暂无浏览器快照，请先打开或 F5 web 主界面');
      appendLog('本地存档 | 保存失败 | now-storage 暂无浏览器快照');
      return;
    }
    const archive = cloneNowStorageArchiveForSave(nowStorage.archive, name, description);
    const saved = await runtime.saveLocalDataArchive({ ...archive, storageScope: normalizedScope });
    if (!saved.ok) {
      setStatus('localdata-status', saved.error || '保存存档失败');
      appendLog(`本地存档 | 保存到 ${scopeLabel} 失败 | ${saved.error || '-'}`);
      return;
    }
    selectedArchiveKey = saved.meta ? getArchiveKey(saved.meta) : null;
    activeArchiveKey = saved.state?.activeFileName
      ? `${saved.state?.activeStorageScope || 'local'}:${saved.state.activeFileName}`
      : selectedArchiveKey;
    appendLog(`本地存档 | 已保存到 ${scopeLabel} | ${saved.path}`);
    await refreshArchives();
  };

  const applyArchive = async () => {
    if (isApplyingArchive) {
      setStatus('localdata-status', '同步正在进行，请稍候');
      return;
    }
    const selectedArchive = findSelectedArchive();
    if (!selectedArchive) {
      setStatus('localdata-status', '请先选择一个存档');
      return;
    }
    if (!runtime.readLocalDataArchive || !runtime.requestLocalDataImport) {
      setStatus('localdata-status', '当前运行时不支持 web 数据导入');
      return;
    }
    const sections = getCheckedSections('import-sections');
    setStatus('localdata-status', '正在读取存档并写入 now-storage...');
    const loaded = await runtime.readLocalDataArchive({
      fileName: selectedArchive.fileName,
      storageScope: selectedArchive.storageScope,
    });
    if (!loaded.ok || !loaded.archive) {
      setStatus('localdata-status', loaded.error || '读取存档失败');
      appendLog(`本地存档 | 读取失败 | ${loaded.error || '-'}`);
      return;
    }
    const coveragePlan = getImportCoveragePlan(loaded.archive, sections);
    if (!coveragePlan.ok) {
      setStatus('localdata-status', coveragePlan.warning || '存档没有可导入的分组');
      appendLog(`本地存档 | 导入预检失败 | ${getArchiveKey(selectedArchive)} | ${sections.join(' / ')} | ${coveragePlan.warning || '-'}`);
      return;
    }
    const importArchive = {
      ...loaded.archive,
      sections: coveragePlan.sections,
    };
    if (coveragePlan.warning) {
      appendLog(`本地存档 | 导入预检提示 | ${getArchiveKey(selectedArchive)} | ${coveragePlan.warning} | 实际导入 ${coveragePlan.sections.join(' / ')}`);
    }
    isApplyingArchive = true;
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus('localdata-status', message);
      appendLog(`本地存档 | 写入 now-storage 失败 | ${message}`);
      isApplyingArchive = false;
      return;
    }

    let desktopImport = null;
    if (runtime.requestLocalDataImport) {
      try {
        desktopImport = await runtime.requestLocalDataImport({
          archive: importArchive,
          fileName: selectedArchive.fileName,
          storageScope: selectedArchive.storageScope,
          options: { sections: coveragePlan.sections, reload: true },
        });
      } catch (error) {
        desktopImport = {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    activeArchiveKey = desktopImport?.state?.activeFileName
      ? `${desktopImport.state?.activeStorageScope || selectedArchive.storageScope || 'local'}:${desktopImport.state.activeFileName}`
      : getArchiveKey(selectedArchive);
    const writtenKeys = (desktopImport?.localKeys || 0) + (desktopImport?.sessionKeys || 0);
    const removedKeys = (desktopImport?.removedLocalKeys || 0) + (desktopImport?.removedSessionKeys || 0);
    const desktopImportError = desktopImport?.ok === false ? (desktopImport.error || '桌面导入失败') : '';
    const importNotice = coveragePlan.warning ? `；${coveragePlan.warning}` : '';
    setStatus(
      'localdata-status',
      desktopImportError
        ? `now-storage 已替换，但桌面即时同步失败：${desktopImportError}；当前引用：${activeArchiveKey}`
        : `now-storage 已替换并等待浏览器下次打开/F5应用；桌面写入 ${writtenKeys}，清理 ${removedKeys}；当前引用：${activeArchiveKey}${importNotice}`,
    );
    appendLog(
      `本地存档 | 已写入 now-storage | ${getArchiveKey(selectedArchive)} | ${coveragePlan.sections.join(' / ')} | 桌面写入 ${writtenKeys} 清理 ${removedKeys}${coveragePlan.warning ? ` | ${coveragePlan.warning}` : ''}${desktopImportError ? ` | 桌面导入失败：${desktopImportError}` : ''}`,
    );
    window.setTimeout(() => {
      isApplyingArchive = false;
    }, 800);
  };

  const deleteArchive = async () => {
    const selectedArchive = findSelectedArchive();
    if (!selectedArchive) {
      setStatus('localdata-status', '请先选择一个存档');
      return;
    }
    if (!runtime.deleteLocalDataArchive) {
      setStatus('localdata-status', '当前运行时不支持删除存档');
      return;
    }
    const result = await runtime.deleteLocalDataArchive({
      fileName: selectedArchive.fileName,
      storageScope: selectedArchive.storageScope,
    });
    if (!result.ok) {
      setStatus('localdata-status', result.error || '删除失败');
      appendLog(`本地存档 | 删除失败 | ${result.error || '-'}`);
      return;
    }
    appendLog(`本地存档 | 已删除 | ${getArchiveKey(selectedArchive)}`);
    selectedArchiveKey = null;
    await refreshArchives();
  };

  const extractArkText = (value) => {
    if (value && typeof value === 'object' && Array.isArray(value.choices)) {
      for (const choice of value.choices) {
        const message = choice && typeof choice === 'object' ? choice.message : null;
        if (message && typeof message === 'object' && typeof message.content === 'string' && message.content.trim()) {
          return message.content.trim();
        }
      }
    }

    const texts = [];
    const walk = (node) => {
      if (!node) return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (typeof node === 'object') {
        if (node.type === 'output_text' && typeof node.text === 'string' && node.text.trim()) {
          texts.push(node.text.trim());
        }
        if (typeof node.text === 'string' && node.text.trim()) {
          texts.push(node.text.trim());
        }
        Object.values(node).forEach(walk);
      }
    };
    walk(value);
    return texts.join('\n\n');
  };

  const formatCaptureSourceLabel = (source) => {
    return `窗口 | ${source.name || '未命名'} | ${source.id}`;
  };

  const renderCaptureSourceOptions = (sources) => {
    captureSourceSelect.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '请选择窗口或屏幕源';
    captureSourceSelect.appendChild(placeholder);

    sources.forEach((source) => {
      const option = document.createElement('option');
      option.value = source.id;
      option.textContent = formatCaptureSourceLabel(source);
      captureSourceSelect.appendChild(option);
    });
  };

  const renderCaptureSourceMeta = (_source, _frame, session) => {
    if (!session) {
      const markup = '<div>会话状态：未绑定窗口</div>';
      if (markup !== lastCaptureMetaMarkup) {
        captureMetaElement.innerHTML = markup;
        lastCaptureMetaMarkup = markup;
      }
      return;
    }
    const statusText = session.running
      ? '运行中'
      : session.boundSourceId
        ? '已停止'
        : '未绑定窗口';
    const markup = `<div>会话状态：${statusText}</div>`;
    if (markup !== lastCaptureMetaMarkup) {
      captureMetaElement.innerHTML = markup;
      lastCaptureMetaMarkup = markup;
    }
  };

  const syncSelectedCaptureSource = () => {
    const selectedSource = captureSources.find((source) => source.id === captureSourceSelect.value) || null;
    renderCaptureSourceMeta(selectedSource);
    if (selectedSource && selectedSource.thumbnailDataUrl && !capturePreviewElement.getAttribute('src')) {
      capturePreviewElement.src = selectedSource.thumbnailDataUrl;
    }
    return selectedSource;
  };

  const stopCaptureFramePolling = () => {
    if (capturePollTimer) {
      window.clearInterval(capturePollTimer);
      capturePollTimer = 0;
    }
  };

  const pollCaptureFrame = async () => {
    const sessionPayload = await runtime.getCaptureSession();
    const session = sessionPayload.session;
    const selectedSource =
      captureSources.find((source) => source.id === (session.source?.id || session.boundSourceId)) || session.source || null;
    setStatus(
      'capture-status',
      session.running
        ? `后台捕获中 | ${session.intervalMs} ms`
        : session.boundSourceId
          ? '已绑定窗口，未运行'
          : '未绑定窗口'
    );
    renderCaptureSourceMeta(selectedSource, null, session);

    const framePayload = await runtime.getLatestCaptureFrame();
    const frame = framePayload.frame;
    if (!frame) {
      return;
    }

    if (frame.capturedAt !== latestCaptureFrameStamp) {
      latestCaptureFrameStamp = frame.capturedAt;
      capturePreviewElement.src = frame.imageDataUrl;
      renderCaptureSourceMeta(frame.source, frame, session);
    }
  };

  const startCaptureFramePolling = () => {
    stopCaptureFramePolling();
    pollCaptureFrame().catch(() => {});
    capturePollTimer = window.setInterval(() => {
      pollCaptureFrame().catch(() => {});
    }, 250);
  };

  const refreshCaptureSources = async () => {
    setStatus('capture-status', '正在刷新窗口源...');
    const payload = await runtime.listCaptureSources();
    captureSources = payload.sources || [];
    renderCaptureSourceOptions(captureSources);

    const firstSource = captureSources[0];
    if (firstSource) {
      captureSourceSelect.value = firstSource.id;
      renderCaptureSourceMeta(firstSource);
      capturePreviewElement.src = firstSource.thumbnailDataUrl || '';
      setStatus('capture-status', `已加载 ${captureSources.length} 个捕获源`);
      appendLog(`捕获源已刷新 | 共 ${captureSources.length} 个源`);
    } else {
      renderCaptureSourceMeta(null);
      capturePreviewElement.removeAttribute('src');
      setStatus('capture-status', '未发现可用捕获源');
      appendLog('捕获源刷新完成 | 未发现可用 EndField 窗口');
    }
  };

  const bindSelectedSource = async () => {
    const selectedSource = syncSelectedCaptureSource();
    if (!selectedSource) {
      throw new Error('请先选择一个捕获源');
    }

    const selectedPreset = capturePresets[0]?.name || 'Win32-Window';
    const payload = await runtime.bindCaptureSource(selectedSource.id, selectedPreset);
    renderCaptureSourceMeta(selectedSource, null, payload.session);
    appendLog(`捕获源已绑定 | ${selectedPreset} | ${selectedSource.name || selectedSource.id}`);
    return selectedSource;
  };

  const syncScaleButtons = (activeScale, savedScale) => {
    document.querySelectorAll('[data-scale]').forEach((button) => {
      const selected = button.getAttribute('data-scale') === savedScale;
      button.classList.toggle('is-active', selected);
    });
  };

  const boot = async () => {
    appendLog('Shell 初始化开始');
    if (!runtime) {
      appendLog('desktopRuntime 不可用；当前不是 Electron shell 环境。');
      return;
    }

    const state = await runtime.getShellState();
    syncScaleButtons(
      state.desktopSettings?.currentScale || '1x',
      state.desktopSettings?.savedScale || state.desktopSettings?.currentScale || '1x'
    );
    appendLog(`外壳就绪 | 角色=${runtime.role} | 平台=${state.platform} | 主机=${state.hostname}`);
    appendLog('主界面与 shell 现在都由 Electron 托管。');
    await refreshAiRestStatus().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      setStatus('ai-rest-status', message);
      appendLog(`AI REST 状态读取失败 | ${message}`);
    });
    await refreshAgentRecords().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      setStatus('agent-records-status', message);
      appendLog(`Agent 记录读取失败 | ${message}`);
    });
    startAgentRecordsPolling();
    const presetPayload = await runtime.listCapturePresets();
    capturePresets = presetPayload.presets || [];
    const llmSettings = await runtime.getLlmSettings();
    arkApiKeyInput.value = llmSettings.apiKey || '';
    arkModelInput.value = llmSettings.model || arkModelInput.value;
    arkPromptInput.value = safeReadLocal(SHELL_STORAGE_KEYS.arkPrompt, arkPromptInput.value);
    await refreshArchives();
    await refreshCaptureSources();
    startCaptureFramePolling();
    appendLog('Shell 初始化完成');
  };

  appendLog('Shell 事件绑定开始');

  document.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const action = button.getAttribute('data-action');
      const statusId = `${action.split('-')[0]}-status`;
      setStatus(statusId, '运行中...');

      try {
        const result = await runtime.runAction(action);
        const line = `${result.title} | ${result.ok ? '成功' : '错误'} | ${result.detail}`;
        setStatus(statusId, result.detail);
        appendLog(line);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus(statusId, message);
        appendLog(`错误 | ${action} | ${message}`);
      }
    });
  });

  document.querySelectorAll('.nav-button').forEach((button) => {
    button.addEventListener('click', () => {
      const pageKey = button.getAttribute('data-page');
      if (pageKey) {
        setActivePage(pageKey);
      }
    });
  });

  document.getElementById('clear-log').addEventListener('click', () => {
    logElement.textContent = '';
  });

  document.getElementById('toggle-log').addEventListener('click', () => {
    const collapsed = logCardElement.classList.toggle('is-collapsed');
    document.getElementById('toggle-log').textContent = collapsed ? '展开日志' : '收起日志';
  });

  document.getElementById('export-archive-share').addEventListener('click', () => {
    exportArchive('share').catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      setStatus('localdata-status', message);
      appendLog(`本地存档 | 导出到 sharedata 异常 | ${message}`);
    });
  });

  document.getElementById('export-archive-local').addEventListener('click', () => {
    exportArchive('local').catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      setStatus('localdata-status', message);
      appendLog(`本地存档 | 导出到 localdata 异常 | ${message}`);
    });
  });

  document.getElementById('refresh-archives').addEventListener('click', () => {
    refreshArchives().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      setStatus('localdata-status', message);
    });
  });

  document.getElementById('apply-archive').addEventListener('click', () => {
    applyArchive().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      setStatus('localdata-status', message);
      appendLog(`本地存档 | 导入异常 | ${message}`);
    });
  });

  document.getElementById('delete-archive').addEventListener('click', () => {
    deleteArchive().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      setStatus('localdata-status', message);
    });
  });

  document.getElementById('open-localdata').addEventListener('click', async () => {
    try {
      const result = await runtime.revealLocalDataArchive?.();
      appendLog(result?.ok ? `本地存档 | 已打开目录 | ${result.path || ''}` : `本地存档 | 打开目录失败 | ${result?.error || '-'}`);
    } catch (error) {
      appendLog(`本地存档 | 打开目录异常 | ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  document.getElementById('open-web').addEventListener('click', async () => {
    try {
      const result = await runtime.openWeb();
      syncScaleButtons(
        result.currentScale || '1x',
        result.savedScale || result.currentScale || '1x'
      );
      appendLog(`主界面已打开 | ${result.mode} | ${result.width}x${result.height}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(`打开主界面失败 | ${message}`);
    }
  });

  document.getElementById('refresh-ai-rest').addEventListener('click', () => {
    refreshAiRestStatus().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      setStatus('ai-rest-status', message);
      appendLog(`AI REST 刷新失败 | ${message}`);
    });
  });

  document.getElementById('toggle-ai-rest').addEventListener('click', () => {
    toggleAiRest().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      setStatus('ai-rest-status', message);
      appendLog(`AI REST 切换失败 | ${message}`);
    });
  });

  document.getElementById('refresh-agent-records').addEventListener('click', () => {
    refreshAgentRecords().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      setStatus('agent-records-status', message);
      appendLog(`Agent 记录刷新失败 | ${message}`);
    });
  });

  document.querySelectorAll('[data-scale]').forEach((button) => {
    button.addEventListener('click', async () => {
      const scaleKey = button.getAttribute('data-scale');
      if (!scaleKey) {
        return;
      }

      try {
        appendLog(`正在保存桌面倍率 ${scaleKey}...`);
        const settings = await runtime.setDesktopScale(scaleKey);
        syncScaleButtons(settings.currentScale, settings.savedScale || settings.currentScale);
        appendLog(
          settings.restartRequired
            ? `桌面倍率已保存 | 当前 ${settings.currentScale} | 关闭后下次启动应用 ${settings.savedScale}`
            : `桌面倍率未变化 | 当前 ${settings.currentScale}`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        appendLog(`切换桌面倍率失败 | ${message}`);
      }
    });
  });

  document.getElementById('quit-app').addEventListener('click', async () => {
    try {
      appendLog('正在完全关闭桌面进程...');
      await runtime.quitApp();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(`完全关闭失败 | ${message}`);
    }
  });

  arkApiKeyInput.addEventListener('input', () => {
    runtime.setLlmSettings({
      apiKey: arkApiKeyInput.value,
      model: arkModelInput.value,
    }).catch(() => {});
  });

  arkModelInput.addEventListener('input', () => {
    runtime.setLlmSettings({
      apiKey: arkApiKeyInput.value,
      model: arkModelInput.value,
    }).catch(() => {});
  });

  arkPromptInput.addEventListener('input', () => {
    safeWriteLocal(SHELL_STORAGE_KEYS.arkPrompt, arkPromptInput.value);
  });

  document.getElementById('ark-clear-output').addEventListener('click', () => {
    arkOutputElement.textContent = '';
    setStatus('ark-status', '空闲');
  });

  document.getElementById('ark-submit').addEventListener('click', async () => {
    const payload = {
      apiKey: arkApiKeyInput.value.trim(),
      model: arkModelInput.value.trim(),
      prompt: arkPromptInput.value.trim(),
    };

    setStatus('ark-status', '请求中...');
    arkOutputElement.textContent = '';

    try {
      const result = await runtime.invokeArkResponses(payload);
      const extractedText = extractArkText(result.data);
      arkOutputElement.textContent = extractedText || JSON.stringify(result.data, null, 2);
      setStatus('ark-status', `完成 | HTTP ${result.status}`);
      appendLog(`模型接口完成 | ${payload.model} | HTTP ${result.status}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      arkOutputElement.textContent = message;
      setStatus('ark-status', '请求失败');
      appendLog(`模型接口失败 | ${message}`);
    }
  });

  captureSourceSelect.addEventListener('change', () => {
    const selectedSource = syncSelectedCaptureSource();
    if (selectedSource?.thumbnailDataUrl) {
      capturePreviewElement.src = selectedSource.thumbnailDataUrl;
    }
  });

  document.getElementById('refresh-capture-sources').addEventListener('click', async () => {
    try {
      await refreshCaptureSources();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus('capture-status', message);
      appendLog(`刷新捕获源失败 | ${message}`);
    }
  });

  document.getElementById('start-capture-session').addEventListener('click', async () => {
    try {
      const selectedSource = await bindSelectedSource();
      const payload = await runtime.startCaptureSession(200);
      setStatus('capture-status', `后台捕获已启动 | ${payload.session.intervalMs} ms`);
      renderCaptureSourceMeta(selectedSource, null, payload.session);
      appendLog(`后台捕获已启动 | ${selectedSource.name || selectedSource.id} | ${payload.session.intervalMs} ms`);
      startCaptureFramePolling();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus('capture-status', message);
      appendLog(`启动捕获失败 | ${message}`);
    }
  });

  document.getElementById('stop-capture-session').addEventListener('click', async () => {
    try {
      const payload = await runtime.stopCaptureSession();
      setStatus('capture-status', '后台捕获已停止');
      renderCaptureSourceMeta(syncSelectedCaptureSource(), null, payload.session);
      appendLog('后台捕获已停止');
      stopCaptureFramePolling();
      startCaptureFramePolling();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus('capture-status', message);
      appendLog(`停止捕获失败 | ${message}`);
    }
  });

  appendLog('Shell 事件绑定完成');

  boot().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    setStatus('runtime-status', message);
    appendLog(`Shell 初始化失败 | ${message}`);
  });
})();
