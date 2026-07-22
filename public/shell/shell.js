(function () {
  const runtime = window.desktopRuntime;
  const nativeSessionCleanupResult = window.defNativeSessionCleanupResult;
  const LOCAL_BRIDGE_ORIGIN = 'http://127.0.0.1:31457';
  const AI_CLI_REST_ORIGIN = 'http://127.0.0.1:17321';
  const WORKBENCH_RENDERER_CAPABILITY_HEADER = 'x-def-workbench-renderer-capability';
  const WORKBENCH_RENDERER_CAPABILITY_QUERY = '__defWorkbenchRendererCapability';
  const SHELL_RENDERER_CAPABILITY_STORAGE_KEY = 'def.shell.workbench-renderer-capability.v1';
  const IMAGE_RELEASE_MANIFEST_URL = 'https://github.com/Pandluto/dmg-end-field/releases/latest/download/assets-release-manifest.json';
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
    defAgentRunning: false,
    agentEventSource: null,
    agentPollTimer: 0,
    nativeAiCliSessions: [],
    nativeAiCliSessionsLoading: false,
    applyingArchive: false,
    imageItems: [],
    archiveFilter: 'all',
    pendingApplyResolve: null,
    desktopSettings: null,
    imageUpdate: null,
    dataReleaseUpdate: null,
    imageReleaseBuilder: null,
    dataReleaseBuilder: null,
  };

  const $ = (id) => document.getElementById(id);

  const readShellRendererCapability = () => {
    try {
      const url = new URL(window.location.href);
      const injectedCapability = url.searchParams.get(WORKBENCH_RENDERER_CAPABILITY_QUERY);
      if (injectedCapability) {
        window.sessionStorage.setItem(SHELL_RENDERER_CAPABILITY_STORAGE_KEY, injectedCapability);
        url.searchParams.delete(WORKBENCH_RENDERER_CAPABILITY_QUERY);
        window.history.replaceState(window.history.state, document.title, `${url.pathname}${url.search}${url.hash}`);
      }
      return window.sessionStorage.getItem(SHELL_RENDERER_CAPABILITY_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  };

  const shellRendererCapability = readShellRendererCapability();

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

  const renderImageUpdateState = (payload) => {
    state.imageUpdate = payload || null;
    const manifestUrl = IMAGE_RELEASE_MANIFEST_URL;
    const status = payload?.status || 'idle';
    const currentVersion = payload?.currentVersion || '-';
    const latestVersion = payload?.latestVersion || '-';
    const latestSummary = payload?.latestSummary || null;
    const currentSummary = payload?.currentManifestSummary || null;
    const statusTextMap = {
      idle: '已配置',
      checking: '检查中',
      downloading: '下载中',
      activating: '切换中',
      failed: '失败',
    };
    const toneMap = {
      idle: 'ok',
      checking: 'warn',
      downloading: 'warn',
      activating: 'warn',
      failed: 'err',
    };
    const formatBytes = (bytes) => {
      const value = Number(bytes || 0);
      if (!value) return '';
      if (value < 1024) return `${value} B`;
      if (value < 1048576) return `${(value / 1024).toFixed(1)} KB`;
      return `${(value / 1048576).toFixed(2)} MB`;
    };
    const currentDelivery = currentSummary?.delivery === 'archive' ? '全量整包' : '逐文件';
    const latestDelivery = latestSummary?.delivery === 'archive' ? '全量整包' : '逐文件';
    const currentPackageText = currentSummary?.packageSizeBytes ? `；包 ${formatBytes(currentSummary.packageSizeBytes)}` : '';
    const latestPackageText = latestSummary?.packageSizeBytes ? `；包 ${formatBytes(latestSummary.packageSizeBytes)}` : '';
    const currentDetail = currentSummary
      ? `${currentSummary.fileCount || 0} 个文件；${currentDelivery}${currentPackageText}；激活于 ${formatTime(payload?.currentActivatedAt)}`
      : '尚未启用图片 release 更新。';
    const latestDetail = latestSummary
      ? `${latestSummary.totalFileCount || 0} 个文件；${latestDelivery}${latestPackageText}；变更 ${latestSummary.changedFileCount || 0}；删除 ${latestSummary.deletedFileCount || 0}${latestSummary.updateMessage ? `；${latestSummary.updateMessage}` : ''}`
      : '尚未检查远端版本。';
    const latestStatusLine = latestSummary
      ? `${latestSummary.compatible === false ? '当前 Shell 版本不兼容；' : ''}${latestSummary.updateMessage ? `${latestSummary.updateMessage}；` : ''}${latestSummary.updateUnavailable ? '更新暂不可用。' : (latestSummary.hasUpdate ? '发现可更新版本。' : '已是最新版本。')}`
      : (payload?.lastError || '等待检查更新。');

    const input = $('image-update-manifest-url');
    if (input) {
      input.value = manifestUrl;
    }

    setBadge('image-update-badge', statusTextMap[status] || status, toneMap[status] || 'info');
    setBadge('image-update-current-version', currentVersion, currentVersion === '-' ? 'info' : 'ok');
    setBadge('image-update-latest-version', latestVersion, latestSummary?.hasUpdate ? 'warn' : 'info');
    setText('image-update-current-detail', currentDetail);
    setText('image-update-latest-detail', latestDetail);
    setText('image-update-storage-detail', payload?.storageRoot || '版本资源保存在 userData 下。');
    setText(
      'image-update-status',
      `${latestStatusLine}${payload?.lastCheckedAt ? ` 最近检查：${formatTime(payload.lastCheckedAt)}` : ''}${payload?.lastUpdatedAt ? `；最近切换：${formatTime(payload.lastUpdatedAt)}` : ''}${payload?.lastError ? `；错误：${payload.lastError}` : ''}`
    );

    const progress = payload?.progress || null;
    const progressBox = $('image-update-progress');
    const progressFill = $('image-update-progress-fill');
    const progressDetail = $('image-update-progress-detail');
    if (progressBox && progressFill && progressDetail) {
      const shouldShowProgress = Boolean(progress)
        && ['downloading', 'verifying', 'extracting', 'activating', 'done', 'failed'].includes(progress.phase);
      progressBox.hidden = !shouldShowProgress;
      if (shouldShowProgress) {
        const percent = Number.isFinite(Number(progress.percent)) ? Number(progress.percent) : null;
        const fallbackPercent = progress.phase === 'failed' ? 100 : progress.phase === 'done' ? 100 : 35;
        progressFill.style.width = `${percent ?? fallbackPercent}%`;
        const byteText = progress.totalBytes
          ? `${formatBytes(progress.receivedBytes)} / ${formatBytes(progress.totalBytes)}`
          : (progress.receivedBytes ? `${formatBytes(progress.receivedBytes)} 已下载` : '');
        const percentText = percent !== null ? `${percent}%` : '下载中';
        progressDetail.textContent = [progress.label || '图片资源', byteText, percentText]
          .filter(Boolean)
          .join(' | ');
      }
    }

    const applyButton = $('apply-image-update');
    if (applyButton) {
      if (!applyButton.dataset.originalText) {
        applyButton.textContent = latestSummary?.action === 'repair-current' ? '修复素材' : '一键更新';
      }
      applyButton.disabled = status === 'checking' || status === 'downloading' || status === 'activating'
        || latestSummary?.compatible === false || latestSummary?.updateUnavailable === true
        || (latestSummary && !latestSummary.hasUpdate && latestSummary.action !== 'repair-current');
    }
  };

  const renderDesktopSettings = (settings) => {
    state.desktopSettings = settings || null;
    const currentScale = settings?.currentScale || '-';
    const defaultScale = settings?.defaultScale || '1x';
    const statusText = settings
      ? `当前 ${currentScale} | 默认 ${defaultScale} | 切换后立即生效并保存`
      : '当前运行时未提供桌面倍率设置。';
    setText('desktop-scale-status', statusText);
    document.querySelectorAll('[data-desktop-scale]').forEach((button) => {
      const scaleKey = button.getAttribute('data-desktop-scale');
      const isActive = Boolean(settings && scaleKey === settings.currentScale);
      button.classList.toggle('primary-button', isActive);
      button.classList.toggle('subtle-button', !isActive);
      button.disabled = !settings;
    });
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
    const { acceptOkFalse = false, ...fetchOptions } = options;
    const response = await fetch(`${origin}${path}`, {
      cache: 'no-store',
      ...fetchOptions,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || (!acceptOkFalse && !payload?.ok)) {
      throw new Error(payload?.error?.message || payload?.error || `请求失败：${path}`);
    }
    return payload;
  };

  const fetchLocalBridgeJson = (path, options = {}) => fetchJson(LOCAL_BRIDGE_ORIGIN, path, options);
  const fetchAiRestJson = (path, options = {}) => fetchJson(AI_CLI_REST_ORIGIN, path, options);

  const getScopeLabel = (storageScope) => (storageScope === 'share' ? 'Share Data' : 'Local Data');

  const getScopeShortLabel = (storageScope) => (storageScope === 'share' ? '共享' : '本机');

  const normalizeArchiveName = (value) => String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);

  const formatArchiveId = (storageScope = 'local', name = '', kind = 'archive') => {
    const date = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    const timestamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
    const prefix = kind === 'backup' ? 'backup' : (storageScope === 'share' ? 'share' : 'local');
    const suffix = normalizeArchiveName(name);
    return [prefix, timestamp, suffix].filter(Boolean).join('-');
  };

  const cloneArchiveForSave = (archive, name, description, storageScope = 'local', kind = 'archive') => {
    const exportedAt = new Date().toISOString();
    const archiveId = formatArchiveId(storageScope, name, kind);
    return {
      ...archive,
      id: archiveId,
      name: name || archiveId,
      description: description || archive.description,
      storageScope,
      createdAt: exportedAt,
      exportedAt,
    };
  };

  const createArchiveFromNowStorage = (archive, name, description, storageScope = 'local', kind = 'archive') => (
    cloneArchiveForSave(archive, name, description, storageScope, kind)
  );

  const getArchiveKey = (item) => item?.archiveKey || `${item?.storageScope || 'local'}:${item?.fileName || ''}`;

  const findSelectedArchive = () => state.archives.find((item) => getArchiveKey(item) === state.selectedArchiveKey) || null;

  const renderSelectedArchiveSummary = () => {
    const selectedArchive = findSelectedArchive();
    const hasSelection = Boolean(selectedArchive);
    setBadge('selected-archive-badge', hasSelection ? '已选择' : '未选择', hasSelection ? 'ok' : 'info');
    ['apply-archive', 'write-shared-archives', 'reveal-archive', 'delete-archive'].forEach((id) => {
      const button = $(id);
      if (button) button.disabled = !hasSelection;
    });
    if (!hasSelection) {
      setText('selected-archive-summary', '从下方列表选择一份数据包后，可以写入共享存档、打开位置、删除或应用数据。');
      return;
    }
    const scopeLabel = getScopeLabel(selectedArchive.storageScope);
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

  const renderDefAgentStatus = (defAgent) => {
    state.defAgentRunning = Boolean(defAgent?.running);
    const label = state.defAgentRunning ? '运行中' : '未运行';
    const tone = state.defAgentRunning ? 'ok' : 'warn';
    const url = defAgent?.url || 'http://127.0.0.1:17322';

    setBadge('def-agent-service-badge', label, tone);
    setText('def-agent-url', url);
    setText('def-agent-status', state.defAgentRunning
      ? `运行中 | pid=${defAgent?.pid || '-'} | ${url}`
      : 'DEF Agent 后台未运行。/ai-cli 对话会按需启动，Shell 也可以在这里手动管理。');

    const button = $('toggle-def-agent');
    if (button) {
      button.textContent = state.defAgentRunning ? '停止后台' : '启动后台';
      button.classList.toggle('danger-button', state.defAgentRunning);
      button.classList.toggle('primary-button', !state.defAgentRunning);
    }
  };

  const renderDeepSeekConfig = (summary) => {
    const configured = Boolean(summary?.apiKeyConfigured);
    setBadge('deepseek-config-badge', configured ? '已配置' : '未配置', configured ? 'ok' : 'warn');
    setText('deepseek-config-status', summary
      ? `${summary.model || 'deepseek-v4-pro'} | ${summary.baseUrl || 'https://api.deepseek.com'} | ${configured ? 'API Key 已保存' : 'API Key 为空'}`
      : '等待配置。');
    if (summary?.baseUrl) {
      const input = $('deepseek-base-url');
      if (input) input.value = summary.baseUrl;
    }
    if (summary?.model) {
      const input = $('deepseek-model');
      if (input) input.value = summary.model;
    }
  };

  const refreshAiRestStatus = async () => {
    const payload = await fetchLocalBridgeJson('/health');
    renderAiRestStatus(payload.aiCliRest);
    renderDefAgentStatus(payload.defAgent);
    return payload.aiCliRest;
  };

  const refreshDefAgentStatus = async () => {
    const payload = await fetchLocalBridgeJson('/health');
    renderDefAgentStatus(payload.defAgent);
    return payload.defAgent;
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

  const toggleDefAgent = async (button) => {
    setButtonBusy(button, true, state.defAgentRunning ? '正在停止' : '正在启动');
    try {
      const payload = await fetchLocalBridgeJson(state.defAgentRunning ? '/close-def-agent' : '/open-def-agent', {
        method: 'POST',
      });
      renderDefAgentStatus(payload.defAgent);
      if (payload.deepseek) {
        renderDeepSeekConfig(payload.deepseek);
      }
      appendLog(`DEF Agent | ${payload.defAgent?.running ? '已启动' : '已停止'} | ${payload.defAgent?.url || 'http://127.0.0.1:17322'}`);
    } finally {
      setButtonBusy(button, false);
    }
  };

  const saveDeepSeekConfig = async (button) => {
    setButtonBusy(button, true, '保存中');
    try {
      const payload = await fetchLocalBridgeJson('/def-agent/deepseek-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: $('deepseek-api-key')?.value || '',
          baseUrl: $('deepseek-base-url')?.value || 'https://api.deepseek.com',
          model: $('deepseek-model')?.value || 'deepseek-v4-pro',
        }),
      });
      renderDefAgentStatus(payload.defAgent);
      renderDeepSeekConfig(payload.deepseek);
      const keyInput = $('deepseek-api-key');
      if (keyInput) keyInput.value = '';
      appendLog(`DeepSeek | 配置已保存 | ${payload.deepseek?.model || '-'}`);
    } finally {
      setButtonBusy(button, false);
    }
  };

  const testDefAgentHi = async (button) => {
    setButtonBusy(button, true, '测试中');
    try {
      const payload = await fetchLocalBridgeJson('/def-agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hi' }),
      });
      renderDefAgentStatus(payload.defAgent);
      setText('deepseek-config-status', payload.result?.content || payload.result?.error || '后台没有返回内容');
      appendLog(`DEF Agent | hi | ${payload.result?.provider || '-'} | ${payload.result?.usedRemoteModel ? 'remote' : 'local'}`);
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

  const nativeAiCliSessionId = (session) => {
    const value = session?.sessionID || session?.id;
    return typeof value === 'string' ? value.trim() : '';
  };

  const updateNativeAiCliCleanupControls = () => {
    const select = $('native-ai-cli-keep-session');
    const cleanupButton = $('cleanup-native-ai-cli-sessions');
    const selectedSessionID = select?.value?.trim() || '';
    const selected = state.nativeAiCliSessions.some((session) => nativeAiCliSessionId(session) === selectedSessionID);
    if (select) select.disabled = state.nativeAiCliSessionsLoading || state.nativeAiCliSessions.length === 0;
    if (cleanupButton) cleanupButton.disabled = state.nativeAiCliSessionsLoading || !selected;
    return selectedSessionID && selected ? selectedSessionID : '';
  };

  const renderNativeAiCliSessions = (sessions) => {
    const select = $('native-ai-cli-keep-session');
    const previousSessionID = select?.value?.trim() || '';
    state.nativeAiCliSessions = (Array.isArray(sessions) ? sessions : [])
      .filter((session) => session?.host === 'ai-cli' && nativeAiCliSessionId(session));

    if (select) {
      select.replaceChildren();
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = state.nativeAiCliSessions.length
        ? '请选择要保留的当前 ai-cli 会话'
        : '没有可验证的 ai-cli 会话';
      select.appendChild(placeholder);
      for (const session of state.nativeAiCliSessions) {
        const option = document.createElement('option');
        const sessionID = nativeAiCliSessionId(session);
        option.value = sessionID;
        const timestamp = formatTime(session.updatedAt || session.createdAt);
        const title = typeof session.title === 'string' && session.title.trim() ? session.title.trim() : '未命名 DEF 会话';
        option.textContent = `${timestamp} | ${title} | ${sessionID}`;
        select.appendChild(option);
      }
      if (state.nativeAiCliSessions.some((session) => nativeAiCliSessionId(session) === previousSessionID)) {
        select.value = previousSessionID;
      }
    }
    updateNativeAiCliCleanupControls();
  };

  const refreshNativeAiCliSessions = async (button, { announce = true } = {}) => {
    if (state.nativeAiCliSessionsLoading) return state.nativeAiCliSessions;
    state.nativeAiCliSessionsLoading = true;
    updateNativeAiCliCleanupControls();
    if (button) setButtonBusy(button, true, '正在读取');
    try {
      const payload = await fetchLocalBridgeJson('/def-agent/chat/persisted-sessions?limit=100');
      renderNativeAiCliSessions(payload.sessions);
      if (announce) {
        setText('native-ai-cli-session-cleanup-status', state.nativeAiCliSessions.length
          ? `已读取 ${state.nativeAiCliSessions.length} 条可验证的 ai-cli 会话。请选择要保留的当前会话。`
          : '没有可验证的 ai-cli 会话，无需清理。');
      }
      return state.nativeAiCliSessions;
    } catch (error) {
      renderNativeAiCliSessions([]);
      setText('native-ai-cli-session-cleanup-status', `读取 ai-cli 会话失败：${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      state.nativeAiCliSessionsLoading = false;
      if (button) setButtonBusy(button, false);
      updateNativeAiCliCleanupControls();
    }
  };

  const cleanupNativeAiCliSessions = async (button) => {
    const keepSessionID = updateNativeAiCliCleanupControls();
    if (!keepSessionID) {
      setText('native-ai-cli-session-cleanup-status', '请先从已验证的 ai-cli 会话中选择要保留的当前会话。');
      return;
    }
    if (!shellRendererCapability) {
      setText('native-ai-cli-session-cleanup-status', '未获得本机授权；请关闭并重新打开 DEF Shell 后重试。');
      return;
    }
    const confirmed = window.confirm('旧的 DEF Shell ai-cli 会话将被永久删除，无法恢复。已选择的当前会话会保留，Workbench 会话不会被处理。是否继续？');
    if (!confirmed) {
      setText('native-ai-cli-session-cleanup-status', '已取消清理；没有删除任何会话。');
      return;
    }

    state.nativeAiCliSessionsLoading = true;
    updateNativeAiCliCleanupControls();
    setButtonBusy(button, true, '正在清理');
    setText('native-ai-cli-session-cleanup-status', '正在清理旧 ai-cli 会话记录…');
    try {
      const payload = await fetchLocalBridgeJson('/def-agent/native-sessions/cleanup', {
        acceptOkFalse: true,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [WORKBENCH_RENDERER_CAPABILITY_HEADER]: shellRendererCapability,
        },
        body: JSON.stringify({ host: 'ai-cli', keepSessionID }),
      });
      const { failedCount, summary } = nativeSessionCleanupResult.summarize(payload, keepSessionID);
      state.nativeAiCliSessionsLoading = false;
      setText('native-ai-cli-session-cleanup-status', summary);
      appendLog(`DEF Shell 会话清理 | keep=${keepSessionID} | deleted=${payload.deletedCount} | alreadyDeleted=${payload.alreadyDeletedCount} | failed=${failedCount}`);
      try {
        await refreshNativeAiCliSessions(undefined, { announce: false });
      } catch (refreshError) {
        setText('native-ai-cli-session-cleanup-status', nativeSessionCleanupResult.appendRefreshWarning(summary, refreshError));
        appendLog(`DEF Shell 会话清理后刷新失败 | ${refreshError instanceof Error ? refreshError.message : String(refreshError)}`);
      }
    } catch (error) {
      setText('native-ai-cli-session-cleanup-status', `清理 ai-cli 会话失败：${error instanceof Error ? error.message : String(error)}`);
      appendLog(`DEF Shell 会话清理失败 | ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      state.nativeAiCliSessionsLoading = false;
      setButtonBusy(button, false);
      updateNativeAiCliCleanupControls();
    }
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
    const localListElement = $('archive-list-local');
    const shareListElement = $('archive-list-share');
    if (!localListElement || !shareListElement) return;

    document.querySelectorAll('[data-archive-filter]').forEach((button) => {
      button.classList.toggle('is-active', button.getAttribute('data-archive-filter') === state.archiveFilter);
    });
    document.querySelectorAll('[data-archive-scope]').forEach((column) => {
      const scope = column.getAttribute('data-archive-scope');
      column.style.display = state.archiveFilter === 'all' || state.archiveFilter === scope ? 'grid' : 'none';
    });

    if (state.archives.length === 0) {
      localListElement.innerHTML = '<div class="empty-state">暂无 Local Data。</div>';
      shareListElement.innerHTML = '<div class="empty-state">暂无共享存档。</div>';
      setText('local-archive-count', '0');
      setText('share-archive-count', '0');
      state.selectedArchiveKey = null;
      renderSelectedArchiveSummary();
      return;
    }

    const renderItems = (items, emptyText) => {
      if (items.length === 0) {
        return `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
      }
      return items.map((item) => {
      const archiveKey = getArchiveKey(item);
      const scopeLabel = getScopeShortLabel(item.storageScope);
      const isActive = archiveKey === state.activeArchiveKey;
      const updatedAt = formatTime(item.updatedAt);
      const sectionCount = Array.isArray(item.sections) ? item.sections.length : 0;
      return `
        <button type="button" class="archive-item${archiveKey === state.selectedArchiveKey ? ' is-active' : ''}" data-archive="${escapeHtml(archiveKey)}" title="${escapeHtml(item.path || item.fileName)}">
          <div class="item-line">
            <span class="item-title">${escapeHtml(item.name || item.id || item.fileName)}</span>
            <span class="pill ${isActive ? 'ok' : 'info'}">${isActive ? '当前应用' : escapeHtml(scopeLabel)}</span>
          </div>
          <div class="item-line">
            <span class="item-meta is-file">${escapeHtml(item.fileName)}</span>
            <span class="item-meta is-strong">${escapeHtml(formatBytes(item.size))}</span>
          </div>
          <div class="item-line">
            <span class="item-meta">${escapeHtml(updatedAt)}</span>
            <span class="item-meta is-strong">${item.releaseDataVersion ? `Release ${escapeHtml(item.releaseDataVersion)} / ` : ''}${item.timelineArchiveCount || 0} 份存档 / ${sectionCount} 组 / ${item.localKeys || 0}+${item.sessionKeys || 0} 项</span>
          </div>
        </button>
      `;
      }).join('');
    };

    const localItems = state.archives.filter((item) => item.storageScope !== 'share');
    const shareItems = state.archives.filter((item) => item.storageScope === 'share');
    localListElement.innerHTML = renderItems(localItems, '暂无 Local Data。');
    shareListElement.innerHTML = renderItems(shareItems, '暂无 Share Data。');
    setText('local-archive-count', String(localItems.length));
    setText('share-archive-count', String(shareItems.length));

    document.querySelectorAll('[data-archive]').forEach((button) => {
      button.addEventListener('click', () => {
        state.selectedArchiveKey = button.getAttribute('data-archive');
        renderArchiveList();
      });
    });
    renderSelectedArchiveSummary();
  };

  const renderDataManagementState = (payload) => {
    const migrations = Array.isArray(payload?.legacyMigrations) ? payload.legacyMigrations : [];
    const completed = migrations.filter((entry) => entry.status === 'completed').length;
    const failed = migrations.filter((entry) => entry.status === 'failed').length;
    setBadge('data-userdb-badge', payload?.userDatabasePath ? '已连接' : '异常', payload?.userDatabasePath ? 'ok' : 'err');
    setText('data-userdb-status', payload?.userDatabasePath || payload?.error || '无法定位 user.sqlite');
    setBadge('data-migration-badge', failed ? `${failed} 需处理` : (completed ? '已导入' : '无需处理'), failed ? 'err' : (completed ? 'ok' : 'info'));
    setText('data-migration-status', migrations.length
      ? (failed ? `已导入 ${completed} 个旧文件；${failed} 个文件未导入。原文件均未删除。` : `已导入 ${completed} 个旧文件为本地存档；原文件均未删除。`)
      : '没有发现需要导入的旧文件。');

    const list = $('legacy-migration-list');
    if (list) {
      list.innerHTML = migrations.length
        ? migrations.map((entry) => {
          const details = entry.details || {};
          const status = entry.status === 'completed' ? '已导入' : '未导入';
          const tone = entry.status === 'completed' ? 'ok' : 'err';
          const originLabel = ({
            'now-storage': '旧工作区文件',
            'local-archive': '旧本地存档',
            'shared-archive': '旧共享存档',
            'timeline-repository.sqlite3': '旧 SQLite 工作区',
          })[entry.legacyOrigin] || '旧文件';
          const archiveCount = Number(details.archiveCount ?? details.snapshotCount ?? details.documentCount ?? 0);
          const importedUnit = entry.legacyOrigin === 'timeline-repository.sqlite3' ? '个 SQLite 工作区' : '份本地存档';
          const detail = entry.status === 'completed'
            ? `${archiveCount > 0 ? `已导入 ${archiveCount} ${importedUnit}` : '已完成兼容导入'}；原文件未删除。`
            : (details.error || '未能读取该旧文件；可重新扫描，原文件未删除。');
          return `<div class="archive-item">
            <div class="item-line"><span class="item-title">${escapeHtml(entry.sourceName || '-')}</span><span class="pill ${tone}">${status}</span></div>
            <div class="item-line"><span class="item-meta">${escapeHtml(originLabel)}</span><span class="item-meta">${escapeHtml(formatTime(entry.migratedAt))}</span></div>
            <div class="item-line"><span class="item-meta">${escapeHtml(detail)}</span></div>
          </div>`;
        }).join('')
        : '<div class="empty-state">没有旧档迁移记录。</div>';
    }

    setText('metric-archives', payload?.userDatabasePath ? 'SQLite' : '异常');
    setText('metric-archives-foot', payload?.userDatabasePath ? '排轴与节点树工作区' : '未连接数据管理服务');
    setText('metric-now-storage', String(migrations.length));
    setText('metric-now-storage-foot', failed ? `${failed} 个旧文件需要处理` : (completed ? `${completed} 个旧文件已导入` : '无需导入'));
  };

  const refreshDataManagement = async () => {
    if (!runtime?.getDataManagementState) {
      renderDataManagementState({ ok: false, error: '当前环境不是 Electron Shell，无法读取 user.sqlite。' });
      return;
    }
    const payload = await runtime.getDataManagementState();
    renderDataManagementState(payload);
    await refreshArchives();
    if (!payload?.ok) appendLog(`统一数据 | 读取失败 | ${payload?.error || '-'}`);
  };

  const runDataManagementMigration = async (button) => {
    if (!runtime?.runDataManagementLegacyMigration) {
      throw new Error('当前运行时不支持旧档迁移。');
    }
    setButtonBusy(button, true, '迁移中');
    try {
      const result = await runtime.runDataManagementLegacyMigration();
      if (!result?.ok) throw new Error(result?.error || '旧档迁移失败');
      renderDataManagementState(result.state || await runtime.getDataManagementState());
      const migrated = Array.isArray(result.results) ? result.results.filter((entry) => entry?.migrated).length : 0;
      appendLog(`统一数据 | 旧档迁移完成 | 新迁入 ${migrated} 条`);
    } finally {
      setButtonBusy(button, false);
    }
  };

  const refreshNowStorage = async () => {
    try {
      const payload = await fetchLocalBridgeJson('/local-data/now-storage');
      const hasArchive = Boolean(payload.archive);
      setBadge('now-storage-badge', hasArchive ? '已同步' : '未同步', hasArchive ? 'ok' : 'warn');
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
    setText('archive-summary', `共 ${state.archives.length} 个；本机 ${localCount}；共享 ${shareCount}`);
    setBadge('archive-count-badge', String(state.archives.length), state.archives.length > 0 ? 'ok' : 'info');
    setText('localdata-status', `当前应用：${state.activeArchiveKey || '未设置'}`);
    setText('metric-archives', String(state.archives.length));
    setText('metric-archives-foot', `local ${localCount} / share ${shareCount}`);
  };

  const exportArchive = async (storageScope) => {
    if (!runtime?.saveLocalDataArchive) {
      setText('localdata-status', '当前运行时不支持保存存档。');
      return;
    }
    const scope = storageScope === 'share' ? 'share' : 'local';
    const scopeLabel = getScopeLabel(scope);
    setText('localdata-status', `正在保存当前数据到${scopeLabel}...`);

    const nowStorage = await refreshNowStorage();
    if (!nowStorage.archive) {
      setText('localdata-status', '当前数据还没有同步。请先打开或刷新浏览器 Web 主界面。');
      appendLog(`数据存档 | 保存失败 | 当前数据未同步`);
      return null;
    }

    const archive = createArchiveFromNowStorage(
      nowStorage.archive,
      $('archive-name')?.value.trim(),
      $('archive-desc')?.value.trim(),
      scope,
    );
    const saved = await runtime.saveLocalDataArchive({ ...archive, storageScope: scope });
    if (!saved.ok) {
      setText('localdata-status', saved.error || '保存存档失败');
      appendLog(`数据存档 | 保存失败 | ${saved.error || '-'}`);
      return null;
    }
    if (runtime?.writeSharedArchivesToDataPackage && saved.meta?.fileName) {
      const written = await runtime.writeSharedArchivesToDataPackage({ fileName: saved.meta.fileName, storageScope: scope });
      if (!written?.ok) throw new Error(written?.error || '写入共享存档部分失败');
    }

    state.selectedArchiveKey = saved.meta ? getArchiveKey(saved.meta) : null;
    state.activeArchiveKey = saved.state?.activeFileName
      ? `${saved.state?.activeStorageScope || scope}:${saved.state.activeFileName}`
      : state.selectedArchiveKey;
    setText('localdata-status', `已保存到${scopeLabel}：${saved.meta?.fileName || saved.path || ''}`);
    appendLog(`数据存档 | 已保存到${scopeLabel} | ${saved.path}`);
    await refreshArchives();
    return saved;
  };

  const saveCurrentNowStorageBeforeApply = async (storageScope, name, description) => {
    if (!runtime?.saveLocalDataArchive) {
      throw new Error('当前运行时不支持保存存档。');
    }
    const scope = storageScope === 'share' ? 'share' : 'local';
    const scopeLabel = getScopeLabel(scope);
    const nowStorage = await refreshNowStorage();
    if (!nowStorage.archive) {
      throw new Error('当前数据还没有同步，无法保存本次数据。');
    }
    const archive = createArchiveFromNowStorage(nowStorage.archive, name, description, scope, 'backup');
    const saved = await runtime.saveLocalDataArchive({ ...archive, storageScope: scope });
    if (!saved.ok) {
      throw new Error(saved.error || '保存存档失败');
    }
    if (runtime?.writeSharedArchivesToDataPackage && saved.meta?.fileName) {
      const written = await runtime.writeSharedArchivesToDataPackage({ fileName: saved.meta.fileName, storageScope: scope });
      if (!written?.ok) throw new Error(written?.error || '写入共享存档部分失败');
    }
    appendLog(`数据存档 | 应用前已保存当前数据到${scopeLabel} | ${saved.path || saved.meta?.fileName || ''}`);
    await refreshArchives();
    return saved;
  };

  const closeApplySaveModal = (result) => {
    const modal = $('apply-save-modal');
    modal?.classList.remove('is-open');
    modal?.setAttribute('aria-hidden', 'true');
    const resolve = state.pendingApplyResolve;
    state.pendingApplyResolve = null;
    if (resolve) {
      resolve(result);
    }
  };

  const askSaveBeforeApply = () => new Promise((resolve) => {
    state.pendingApplyResolve = resolve;
    const modal = $('apply-save-modal');
    const nameInput = $('apply-save-name');
    const descInput = $('apply-save-desc');
    if (nameInput) nameInput.value = `应用前备份-${formatArchiveId('local', '', 'backup').replace(/^backup-/, '')}`;
    if (descInput) descInput.value = '应用存档前自动保存的当前数据';
    modal?.classList.add('is-open');
    modal?.setAttribute('aria-hidden', 'false');
    nameInput?.focus();
  });

  const applyArchive = async () => {
    if (state.applyingArchive) {
      setText('localdata-status', '正在应用存档，请稍候。');
      return;
    }
    const selectedArchive = findSelectedArchive();
    if (!selectedArchive) {
      setText('localdata-status', '请先选择一个存档。');
      return;
    }
    if (!runtime?.readLocalDataArchive || !runtime?.prepareDataPackageApply) {
      setText('localdata-status', '当前运行时不支持应用数据。');
      return;
    }

    const sections = getCheckedSections();
    setText('localdata-status', '正在预检数据包...');
    const preview = await runtime.readLocalDataArchive({
      fileName: selectedArchive.fileName,
      storageScope: selectedArchive.storageScope,
    });
    if (!preview?.ok || !preview.archive) {
      setText('localdata-status', preview?.error || '读取数据包失败');
      appendLog(`数据包 | 应用预检读取失败 | ${preview?.error || '-'}`);
      return;
    }

    const coveragePlan = getImportCoveragePlan(preview.archive, sections);
    if (!coveragePlan.ok) {
      setText('localdata-status', coveragePlan.warning || '存档没有可导入分组。');
      appendLog(`数据存档 | 应用预检失败 | ${getArchiveKey(selectedArchive)} | ${coveragePlan.warning || '-'}`);
      return;
    }

    const saveDecision = await askSaveBeforeApply();
    if (!saveDecision || saveDecision.action === 'cancel') {
      setText('localdata-status', '已取消应用存档。');
      return;
    }
    if (saveDecision.action === 'save') {
      setText('localdata-status', '正在保存当前数据...');
      await saveCurrentNowStorageBeforeApply(saveDecision.storageScope, saveDecision.name, saveDecision.description);
    } else {
      appendLog('数据存档 | 已跳过应用前保存当前数据');
    }

    state.applyingArchive = true;
    // Only Apply Data is allowed to split the package. Keep the archive
    // import after the confirmation so cancelling leaves every store intact.
    const loaded = await runtime.prepareDataPackageApply({
      fileName: selectedArchive.fileName,
      storageScope: selectedArchive.storageScope,
    });
    if (!loaded?.ok || !loaded.archive) {
      setText('localdata-status', loaded?.error || '应用数据准备失败');
      appendLog(`数据包 | 应用数据准备失败 | ${loaded?.error || '-'}`);
      state.applyingArchive = false;
      return;
    }
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
      await fetchLocalBridgeJson('/local-data/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: selectedArchive.fileName,
          storageScope: selectedArchive.storageScope,
        }),
      });
      state.activeArchiveKey = getArchiveKey(selectedArchive);
      const importedCount = Array.isArray(loaded.sharedArchives?.imported) ? loaded.sharedArchives.imported.length : 0;
      const notice = [coveragePlan.warning, importedCount ? `已导入 ${importedCount} 份共享存档` : ''].filter(Boolean).join('；');
      setText('localdata-status', `已应用数据；刷新浏览器 Web 主界面后生效；当前应用：${state.activeArchiveKey}${notice ? `；${notice}` : ''}`);
      appendLog(`数据存档 | 已应用数据 | ${state.activeArchiveKey} | ${coveragePlan.sections.join(' / ')}${notice ? ` | ${notice}` : ''}`);
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

  const writeSharedArchivesToSelectedDataPackage = async () => {
    const selectedArchive = findSelectedArchive();
    if (!selectedArchive) {
      setText('localdata-status', '请先选择一份数据包。');
      return;
    }
    if (!runtime?.writeSharedArchivesToDataPackage) {
      setText('localdata-status', '当前运行时不支持写入共享存档。');
      return;
    }
    setText('localdata-status', '正在把共享存档写入选中数据包…');
    const result = await runtime.writeSharedArchivesToDataPackage({
      fileName: selectedArchive.fileName,
      storageScope: selectedArchive.storageScope,
    });
    if (!result?.ok) throw new Error(result?.error || '写入共享存档失败');
    setText('localdata-status', `已写入 ${result.result?.archiveCount || 0} 份共享存档；数据部分未改动。`);
    appendLog(`数据包 | 已写入共享存档 | ${getArchiveKey(selectedArchive)} | ${result.result?.archiveCount || 0} 份`);
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
    const listElement = $('image-root-list');
    try {
      const [capabilityPayload, listPayload, rootsPayload] = await Promise.all([
        fetchLocalBridgeJson('/image-assets/capabilities'),
        fetchLocalBridgeJson('/image-assets/list'),
        fetchLocalBridgeJson('/image-assets/roots'),
      ]);
      const capabilities = capabilityPayload.capabilities || {};
      state.imageItems = listPayload.items || [];
      const dirs = state.imageItems.filter((item) => item.kind === 'dir' || item.kind === 'directory' || item.type === 'directory');
      const files = state.imageItems.filter((item) => item.kind !== 'dir' && item.kind !== 'directory' && item.type !== 'directory');
      const roots = rootsPayload.roots || [];
      const conflicts = files.filter((item) => Number(item.conflictCount || 0) > 1 && item.mappingWinner).length;

      setBadge('image-bridge-badge', capabilities.writable === false ? '只读' : '可管理', capabilities.writable === false ? 'warn' : 'ok');
      setBadge('image-mode-badge', capabilities.writable === false ? '只读' : '可管理', capabilities.writable === false ? 'warn' : 'ok');
      setText('image-bridge-detail', capabilities.primaryRoot || rootsPayload.primaryRoot || 'Shell 本地图片 bridge 已连接');
      setText('image-mode-detail', capabilities.writable === false ? '当前桥接为只读模式。' : '按文件名映射到 /user-images/<文件名>。');
      setText('image-root-count', String(roots.length));
      setText('image-root-detail', roots.length ? roots.map((root) => root.label || root.directory).slice(0, 2).join(' / ') : '未配置额外根目录');
      setText('image-file-count', String(files.length));
      setText('image-file-detail', conflicts ? `${conflicts} 个文件名存在重名映射。` : '无重名映射冲突。');
      setText('metric-images', String(files.length));
      setText('metric-images-foot', `${roots.length} 个根目录 / ${dirs.length} 个目录`);
      setText('image-root-status', `当前维护 ${roots.length} 个根目录；文件 ${files.length}；目录 ${dirs.length}；冲突 ${conflicts}`);

      if (!listElement) return;
      listElement.innerHTML = roots.length
        ? roots.map((root) => {
            const label = root.label || root.directory || '-';
            const tags = [
              root.id === 'primary' ? '主目录' : '',
              root.configured ? '配置' : '',
              root.legacy ? '兼容' : '',
              root.exists ? '' : '不存在',
            ].filter(Boolean).join(' · ');
            return `
              <div class="asset-item" title="${escapeHtml(root.directory || '')}">
                <div class="item-line">
                  <span class="item-title">${escapeHtml(label)}</span>
                  <span class="pill ${root.exists ? 'ok' : 'warn'}">${escapeHtml(tags || '目录')}</span>
                </div>
                <div class="item-line">
                  <span class="item-meta">${escapeHtml(root.directory || '-')}</span>
                  ${root.configured ? `<button type="button" class="danger-button" data-remove-image-root="${escapeHtml(root.directory)}">移除</button>` : '<span class="item-meta">保留</span>'}
                </div>
              </div>
            `;
          }).join('')
        : '<div class="empty-state">暂无图片根目录。</div>';
      document.querySelectorAll('[data-remove-image-root]').forEach((button) => {
        button.addEventListener('click', async () => {
          const directory = button.getAttribute('data-remove-image-root');
          try {
            await fetchLocalBridgeJson('/image-assets/remove-root', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ directory }),
            });
            appendLog(`图片资产 | 已移除根目录 | ${directory || ''}`);
            await refreshImages();
          } catch (error) {
            appendLog(`图片资产 | 移除根目录失败 | ${error instanceof Error ? error.message : String(error)}`);
          }
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setBadge('image-bridge-badge', '异常', 'err');
      setBadge('image-mode-badge', '异常', 'err');
      setText('image-bridge-detail', message);
      setText('image-mode-detail', message);
      setText('image-root-status', message);
      setText('metric-images', '异常');
      setText('metric-images-foot', message);
      if (listElement) {
        listElement.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
      }
      throw error;
    }
  };

  const refreshImageUpdateState = async () => {
    if (!runtime?.getImageUpdateState) {
      renderImageUpdateState(null);
      return null;
    }
    const payload = await runtime.getImageUpdateState();
    renderImageUpdateState(payload);
    return payload;
  };

  const startImageUpdateProgressPolling = () => {
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        await refreshImageUpdateState();
      } catch {
        // The action call reports the real failure; polling should not add noise.
      }
    };
    tick();
    const timer = window.setInterval(tick, 500);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  };

  const checkImageUpdate = async (button) => {
    if (!runtime?.checkImageUpdate) {
      return;
    }
    setButtonBusy(button, true, '检查中');
    try {
      const result = await runtime.checkImageUpdate();
      renderImageUpdateState(result?.state || null);
      const latestVersion = result?.state?.latestVersion || '-';
      appendLog(`图片更新 | 检查完成 | 远端版本 ${latestVersion}`);
      await refreshImages();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(`图片更新 | 检查失败 | ${message}`);
      await refreshImageUpdateState();
    } finally {
      setButtonBusy(button, false);
    }
  };

  const applyImageUpdate = async (button) => {
    if (!runtime?.applyImageUpdate) {
      return;
    }
    setButtonBusy(button, true, '下载中');
    const stopPolling = startImageUpdateProgressPolling();
    try {
      const result = await runtime.applyImageUpdate();
      renderImageUpdateState(result?.state || null);
      const action = result?.state?.latestSummary?.action;
      const message = action === 'repair-current'
        ? `素材已修复：${result?.state?.currentVersion || '-'}`
        : `已切换到 ${result?.state?.currentVersion || '-'}`;
      appendLog(`图片更新 | ${message}`);
      await Promise.allSettled([refreshImages(), refreshShellState()]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(`图片更新 | 切换失败 | ${message}`);
      await refreshImageUpdateState();
    } finally {
      stopPolling();
      setButtonBusy(button, false);
    }
  };

  const forceClearImageUpdate = async (button) => {
    if (!runtime?.forceClearImageUpdate) {
      return;
    }
    const confirmed = window.confirm('强制清除会删除本地 user-images 和已下载的图片版本缓存。确定继续吗？');
    if (!confirmed) {
      return;
    }
    setButtonBusy(button, true, '清除中');
    try {
      const result = await runtime.forceClearImageUpdate();
      renderImageUpdateState(result?.state || null);
      appendLog('图片更新 | 已强制清除本地图片资源与版本缓存');
      await Promise.allSettled([refreshImages(), refreshShellState()]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(`图片更新 | 强制清除失败 | ${message}`);
      await refreshImageUpdateState();
    } finally {
      setButtonBusy(button, false);
    }
  };

  const renderDataReleaseUpdateState = (payload) => {
    state.dataReleaseUpdate = payload || null;
    const status = payload?.status || 'idle';
    const summary = payload?.latestSummary || null;
    const statusMap = { idle: '已配置', checking: '检查中', downloading: '下载中', activating: '登记中', failed: '失败' };
    const toneMap = { idle: 'ok', checking: 'warn', downloading: 'warn', activating: 'warn', failed: 'err' };
    setBadge('data-update-badge', statusMap[status] || status, toneMap[status] || 'info');
    setText('data-update-manifest-url', payload?.configuredManifestUrl || '未配置数据发布清单地址');

    const dataVersion = payload?.currentDataVersion || '-';
    setBadge('data-update-current-data', dataVersion, dataVersion === '-' ? 'info' : 'ok');
    setText('data-update-current-data-detail', payload?.currentDataFileName
      ? `${payload.currentDataFileName}${payload?.currentDataDownloadedAt ? `；下载 ${formatTime(payload.currentDataDownloadedAt)}` : ''}`
      : '尚未从 Release 下载数据包。');

    const release = summary?.release || null;
    const remoteLine = release?.available
      ? `数据版本 ${release.dataVersion} / 来源 ${release.source?.scope === 'local' ? 'Local Data' : 'Share Data'}${release.hasUpdate ? '（可下载）' : ''}`
      : '';
    const latestLabel = summary?.hasAnyPackage ? (summary.hasUpdate ? '可更新' : '最新') : '无数据包';
    setBadge('data-update-latest', latestLabel, summary?.hasUpdate ? 'warn' : 'info');
    setText('data-update-latest-detail', remoteLine || summary?.updateMessage || '等待检查。');
    const progress = payload?.progress;
    const progressText = progress?.label
      ? `${progress.label}${progress.percent !== null && progress.percent !== undefined ? ` · ${progress.percent}%` : ''}`
      : '';
    setText('data-update-status', [summary?.updateMessage || '等待检查数据 Release。', progressText, payload?.lastError ? `错误：${payload.lastError}` : ''].filter(Boolean).join('；'));

    const applyButton = $('apply-data-release-update');
    if (applyButton) {
      applyButton.disabled = ['checking', 'downloading', 'activating'].includes(status)
        || summary?.hasUpdate !== true;
    }
  };

  const refreshDataReleaseUpdateState = async () => {
    if (!runtime?.getDataReleaseUpdateState) {
      renderDataReleaseUpdateState(null);
      return null;
    }
    const payload = await runtime.getDataReleaseUpdateState();
    renderDataReleaseUpdateState(payload);
    return payload;
  };

  const checkDataReleaseUpdate = async (button) => {
    if (!runtime?.checkDataReleaseUpdate) return;
    setButtonBusy(button, true, '检查中');
    try {
      const result = await runtime.checkDataReleaseUpdate();
      renderDataReleaseUpdateState(result?.state || null);
      appendLog(`数据更新 | 检查完成 | ${result?.state?.latestSummary?.updateMessage || '无数据包或已是最新'}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(`数据更新 | 检查失败 | ${message}`);
      await refreshDataReleaseUpdateState();
    } finally {
      setButtonBusy(button, false);
    }
  };

  const applyDataReleaseUpdate = async (button) => {
    if (!runtime?.applyDataReleaseUpdate) return;
    setButtonBusy(button, true, '更新中');
    try {
      const result = await runtime.applyDataReleaseUpdate();
      renderDataReleaseUpdateState(result?.state || null);
      appendLog(`数据更新 | ${result?.state?.progress?.label || '已完成'}`);
      await refreshDataManagement();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(`数据更新 | 更新失败 | ${message}`);
      await refreshDataReleaseUpdateState();
    } finally {
      setButtonBusy(button, false);
    }
  };

  const setInputValue = (id, value) => {
    const input = $(id);
    if (input) input.value = value || '';
  };

  const getInputValue = (id) => {
    const input = $(id);
    return input?.value.trim() || '';
  };

  const setImageReleaseBuilderStatus = (text, tone = 'info') => {
    setText('image-release-builder-status', text);
    const badgeText = tone === 'ok' ? '已生成' : tone === 'err' ? '失败' : tone === 'warn' ? '处理中' : '待生成';
    setBadge('image-release-builder-badge', badgeText, tone);
  };

  const pickImageReleaseSource = async () => {
    const result = await runtime?.pickImageReleaseSourceDir?.();
    if (result?.ok) {
      setInputValue('image-release-source', result.path);
      setImageReleaseBuilderStatus(`源目录：${result.path}`);
    }
  };

  const pickImageReleaseOutput = async () => {
    const result = await runtime?.pickImageReleaseOutputDir?.();
    if (result?.ok) {
      setInputValue('image-release-output', result.path);
      setImageReleaseBuilderStatus(`输出目录：${result.path}`);
    }
  };

  const buildImageReleasePackage = async (button) => {
    if (!runtime?.buildImageReleasePackage) {
      setImageReleaseBuilderStatus('当前运行时不支持图片发布包助手。', 'err');
      return;
    }
    const payload = {
      source: getInputValue('image-release-source'),
      output: getInputValue('image-release-output'),
      assetVersion: getInputValue('image-release-version'),
      releaseTag: getInputValue('image-release-tag'),
      minShellVersion: getInputValue('image-release-min-shell'),
    };
    setButtonBusy(button, true, '生成中');
    setImageReleaseBuilderStatus('正在生成图片发布包…', 'warn');
    try {
      const response = await runtime.buildImageReleasePackage(payload);
      if (!response?.ok) {
        throw new Error(response?.error || '生成失败');
      }
      state.imageReleaseBuilder = response.result;
      const result = response.result;
      const packageList = (result.packagePaths || []).map((p) => `\n${p}`).join('');
      setImageReleaseBuilderStatus(
        `生成完成：全量包 / ${result.assetVersion}；文件 ${result.totalFiles}\nmanifest: ${result.manifestPath}${packageList}`,
        'ok',
      );
      appendLog(`图片发布包 | 生成完成 | ${result.outputDir}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setImageReleaseBuilderStatus(message, 'err');
      appendLog(`图片发布包 | 生成失败 | ${message}`);
    } finally {
      setButtonBusy(button, false);
    }
  };

  const revealImageReleaseOutput = async () => {
    const output = getInputValue('image-release-output') || state.imageReleaseBuilder?.outputDir;
    if (!output) {
      setImageReleaseBuilderStatus('请先选择输出目录。', 'err');
      return;
    }
    const result = await runtime?.revealPath?.({ path: output });
    if (result?.ok) {
      appendLog(`图片发布包 | 已打开输出目录 | ${result.path || output}`);
    } else {
      setImageReleaseBuilderStatus(result?.error || `无法打开输出目录：${output}`, 'err');
    }
  };

  const setDataReleaseBuilderStatus = (text, tone = 'info') => {
    setText('data-release-builder-status', text);
    const badgeText = tone === 'ok' ? '已生成' : tone === 'err' ? '失败' : tone === 'warn' ? '处理中' : '待生成';
    setBadge('data-release-builder-badge', badgeText, tone);
  };

  const pickDataReleaseOutput = async () => {
    const result = await runtime?.pickDataReleaseOutputDir?.();
    if (result?.ok) {
      setInputValue('data-release-output', result.path);
      setDataReleaseBuilderStatus(`输出目录：${result.path}`);
    }
  };

  const buildDataReleasePackage = async (button) => {
    if (!runtime?.buildDataReleasePackage) {
      setDataReleaseBuilderStatus('当前运行时不支持数据发布包助手。', 'err');
      return;
    }
    const selectedArchive = findSelectedArchive();
    if (!selectedArchive) {
      setDataReleaseBuilderStatus('请先从本地数据或共享数据列表选择一份完整数据。', 'err');
      return;
    }
    const payload = {
      sourceScope: selectedArchive.storageScope,
      sourceFileName: selectedArchive.fileName,
      output: getInputValue('data-release-output'),
      dataVersion: getInputValue('data-release-version'),
      releaseTag: getInputValue('data-release-tag'),
      minShellVersion: getInputValue('data-release-min-shell'),
    };
    setButtonBusy(button, true, '生成中');
    setDataReleaseBuilderStatus('正在生成数据发布包…', 'warn');
    try {
      const response = await runtime.buildDataReleasePackage(payload);
      if (!response?.ok) throw new Error(response?.error || '生成失败');
      state.dataReleaseBuilder = response.result;
      const result = response.result;
      const packageList = (result.packagePaths || []).map((item) => `\n${item}`).join('');
      setDataReleaseBuilderStatus(
        `生成完成：${result.dataVersion} / ${selectedArchive.name || selectedArchive.fileName}\nmanifest: ${result.manifestPath}${packageList}`,
        'ok',
      );
      appendLog(`数据发布包 | 生成完成 | ${result.outputDir}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDataReleaseBuilderStatus(message, 'err');
      appendLog(`数据发布包 | 生成失败 | ${message}`);
    } finally {
      setButtonBusy(button, false);
    }
  };

  const revealDataReleaseOutput = async () => {
    const output = getInputValue('data-release-output') || state.dataReleaseBuilder?.outputDir;
    if (!output) {
      setDataReleaseBuilderStatus('请先选择输出目录。', 'err');
      return;
    }
    const result = await runtime?.revealPath?.({ path: output });
    if (result?.ok) {
      appendLog(`数据发布包 | 已打开输出目录 | ${result.path || output}`);
    } else {
      setDataReleaseBuilderStatus(result?.error || `无法打开输出目录：${output}`, 'err');
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

  const applyDesktopScale = async (scaleKey, button) => {
    if (!runtime?.setDesktopScale) {
      setText('desktop-scale-status', '当前运行时不支持桌面倍率设置。');
      return;
    }
    setButtonBusy(button, true, '切换中');
    try {
      const settings = await runtime.setDesktopScale(scaleKey);
      renderDesktopSettings(settings);
      appendLog(`桌面倍率 | 已切换到 ${settings.currentScale}`);
      await refreshShellState();
    } catch (error) {
      appendLog(`桌面倍率 | 切换失败 | ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setButtonBusy(button, false);
    }
  };

  const refreshShellState = async () => {
    if (!runtime) {
      setBadge('shell-status-badge', '不可用', 'err');
      setBadge('shell-mini-status', '不可用', 'err');
      setBadge('nav-health-badge', '异常', 'err');
      setText('shell-status-detail', 'desktopRuntime 不存在，请用 Electron Shell 启动。');
      setText('host-summary', '非 Electron Shell 环境');
      renderDesktopSettings(null);
      return;
    }
    const shellState = await runtime.getShellState();
    renderDesktopSettings(shellState.desktopSettings || null);
    renderImageUpdateState(shellState.imageUpdate || null);
    renderDataReleaseUpdateState(shellState.dataReleaseUpdate || null);
    setBadge('shell-status-badge', '正常', 'ok');
    setBadge('shell-mini-status', '正常', 'ok');
    setBadge('nav-health-badge', '正常', 'ok');
    const currentScale = shellState.desktopSettings?.currentScale || '1x';
    setText('shell-status-detail', `平台 ${shellState.platform || runtime.platform || '-'}；主机 ${shellState.hostname || '-'}；倍率 ${currentScale}`);
    setText('host-summary', `${shellState.hostname || 'local'} · ${shellState.platform || runtime.platform || '-'}`);
  };

  const refreshOverview = async () => {
    await Promise.allSettled([
      refreshShellState(),
      refreshAiRestStatus(),
      refreshDefAgentStatus(),
      refreshDataManagement(),
      refreshDataReleaseUpdateState(),
      refreshImages(),
      refreshImageUpdateState(),
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
    $('open-browser-web')?.addEventListener('click', async () => {
      try {
        const result = await fetchLocalBridgeJson('/open-browser-web', { method: 'POST' });
        appendLog(`浏览器 Web | 已打开 | ${result.url || ''}`);
      } catch (error) {
        appendLog(`浏览器 Web | 打开失败 | ${error instanceof Error ? error.message : String(error)}`);
      }
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
    $('refresh-native-ai-cli-sessions')?.addEventListener('click', (event) => {
      refreshNativeAiCliSessions(event.currentTarget).catch(() => {});
    });
    $('native-ai-cli-keep-session')?.addEventListener('change', () => {
      const keepSessionID = updateNativeAiCliCleanupControls();
      setText('native-ai-cli-session-cleanup-status', keepSessionID
        ? `已选择保留当前 ai-cli 会话：${keepSessionID}`
        : '请先从已验证的 ai-cli 会话中选择要保留的当前会话。');
    });
    $('cleanup-native-ai-cli-sessions')?.addEventListener('click', (event) => {
      cleanupNativeAiCliSessions(event.currentTarget).catch((error) => {
        setText('native-ai-cli-session-cleanup-status', `清理 ai-cli 会话失败：${error instanceof Error ? error.message : String(error)}`);
      });
    });
    $('refresh-def-agent')?.addEventListener('click', () => {
      refreshDefAgentStatus().catch((error) => appendLog(`DEF Agent 刷新失败 | ${error instanceof Error ? error.message : String(error)}`));
    });
    $('toggle-def-agent')?.addEventListener('click', (event) => {
      toggleDefAgent(event.currentTarget).catch((error) => appendLog(`DEF Agent 切换失败 | ${error instanceof Error ? error.message : String(error)}`));
    });
    $('save-deepseek-config')?.addEventListener('click', (event) => {
      saveDeepSeekConfig(event.currentTarget).catch((error) => appendLog(`DeepSeek 配置失败 | ${error instanceof Error ? error.message : String(error)}`));
    });
    $('test-def-agent-hi')?.addEventListener('click', (event) => {
      testDefAgentHi(event.currentTarget).catch((error) => appendLog(`DEF Agent hi 测试失败 | ${error instanceof Error ? error.message : String(error)}`));
    });
    $('refresh-data-management')?.addEventListener('click', () => {
      Promise.all([refreshDataManagement(), refreshDataReleaseUpdateState(), refreshArchives()])
        .catch((error) => appendLog(`统一数据 | 刷新失败 | ${error instanceof Error ? error.message : String(error)}`));
    });
    $('refresh-data-packages')?.addEventListener('click', () => {
      refreshArchives().catch((error) => appendLog(`数据包 | 刷新失败 | ${error instanceof Error ? error.message : String(error)}`));
    });
    $('save-local-archive')?.addEventListener('click', () => {
      exportArchive('local').catch((error) => appendLog(`数据包 | 保存 Local Data 失败 | ${error instanceof Error ? error.message : String(error)}`));
    });
    $('save-share-archive')?.addEventListener('click', () => {
      exportArchive('share').catch((error) => appendLog(`数据包 | 保存 Share Data 失败 | ${error instanceof Error ? error.message : String(error)}`));
    });
    $('apply-archive')?.addEventListener('click', () => {
      applyArchive().catch((error) => appendLog(`数据包 | 应用失败 | ${error instanceof Error ? error.message : String(error)}`));
    });
    $('delete-archive')?.addEventListener('click', () => {
      deleteArchive().catch((error) => appendLog(`数据包 | 删除失败 | ${error instanceof Error ? error.message : String(error)}`));
    });
    $('reveal-archive')?.addEventListener('click', () => {
      revealSelectedArchive().catch((error) => appendLog(`数据包 | 定位失败 | ${error instanceof Error ? error.message : String(error)}`));
    });
    $('write-shared-archives')?.addEventListener('click', () => {
      writeSharedArchivesToSelectedDataPackage().catch((error) => appendLog(`数据包 | 写入共享存档失败 | ${error instanceof Error ? error.message : String(error)}`));
    });
    document.querySelectorAll('[data-archive-filter]').forEach((button) => {
      button.addEventListener('click', () => {
        state.archiveFilter = button.getAttribute('data-archive-filter') || 'all';
        renderArchiveList();
      });
    });
    $('run-data-management-migration')?.addEventListener('click', (event) => {
      runDataManagementMigration(event.currentTarget).catch((error) => appendLog(`统一数据 | 旧档迁移失败 | ${error instanceof Error ? error.message : String(error)}`));
    });
    $('refresh-images')?.addEventListener('click', () => {
      refreshImages().catch((error) => appendLog(`图片资产 | 刷新失败 | ${error instanceof Error ? error.message : String(error)}`));
    });
    $('check-image-update')?.addEventListener('click', (event) => {
      checkImageUpdate(event.currentTarget).catch((error) => appendLog(`图片更新 | 检查失败 | ${error instanceof Error ? error.message : String(error)}`));
    });
    $('apply-image-update')?.addEventListener('click', (event) => {
      applyImageUpdate(event.currentTarget).catch((error) => appendLog(`图片更新 | 切换失败 | ${error instanceof Error ? error.message : String(error)}`));
    });
    $('force-clear-image-update')?.addEventListener('click', (event) => {
      forceClearImageUpdate(event.currentTarget).catch((error) => appendLog(`图片更新 | 强制清除失败 | ${error instanceof Error ? error.message : String(error)}`));
    });
    $('check-data-release-update')?.addEventListener('click', (event) => {
      checkDataReleaseUpdate(event.currentTarget).catch((error) => appendLog(`数据更新 | 检查失败 | ${error instanceof Error ? error.message : String(error)}`));
    });
    $('apply-data-release-update')?.addEventListener('click', (event) => {
      applyDataReleaseUpdate(event.currentTarget).catch((error) => appendLog(`数据更新 | 更新失败 | ${error instanceof Error ? error.message : String(error)}`));
    });
    $('pick-image-release-source')?.addEventListener('click', () => {
      pickImageReleaseSource().catch((error) => appendLog(`图片发布包 | 选择源目录失败 | ${error instanceof Error ? error.message : String(error)}`));
    });
    $('pick-image-release-output')?.addEventListener('click', () => {
      pickImageReleaseOutput().catch((error) => appendLog(`图片发布包 | 选择输出目录失败 | ${error instanceof Error ? error.message : String(error)}`));
    });
    $('build-image-release-package')?.addEventListener('click', (event) => {
      buildImageReleasePackage(event.currentTarget).catch((error) => appendLog(`图片发布包 | 生成失败 | ${error instanceof Error ? error.message : String(error)}`));
    });
    $('reveal-image-release-output')?.addEventListener('click', () => {
      revealImageReleaseOutput().catch((error) => appendLog(`图片发布包 | 打开输出目录失败 | ${error instanceof Error ? error.message : String(error)}`));
    });
    $('pick-data-release-output')?.addEventListener('click', () => {
      pickDataReleaseOutput().catch((error) => appendLog(`数据发布包 | 选择输出目录失败 | ${error instanceof Error ? error.message : String(error)}`));
    });
    $('build-data-release-package')?.addEventListener('click', (event) => {
      buildDataReleasePackage(event.currentTarget).catch((error) => appendLog(`数据发布包 | 生成失败 | ${error instanceof Error ? error.message : String(error)}`));
    });
    $('reveal-data-release-output')?.addEventListener('click', () => {
      revealDataReleaseOutput().catch((error) => appendLog(`数据发布包 | 打开输出目录失败 | ${error instanceof Error ? error.message : String(error)}`));
    });
    document.querySelectorAll('[data-desktop-scale]').forEach((button) => {
      button.addEventListener('click', (event) => {
        const scaleKey = button.getAttribute('data-desktop-scale');
        if (!scaleKey) return;
        applyDesktopScale(scaleKey, event.currentTarget).catch((error) => {
          appendLog(`桌面倍率 | 切换失败 | ${error instanceof Error ? error.message : String(error)}`);
        });
      });
    });
    $('add-image-root')?.addEventListener('click', async () => {
      try {
        const result = await fetchLocalBridgeJson('/image-assets/add-root', { method: 'POST' });
        appendLog(result?.ok ? `图片资产 | 已添加根目录 | ${result.roots?.at(-1)?.directory || ''}` : `图片资产 | 添加根目录失败 | ${result?.error || '-'}`);
        await refreshImages();
      } catch (error) {
        appendLog(`图片资产 | 添加根目录失败 | ${error instanceof Error ? error.message : String(error)}`);
      }
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
    $('apply-save-cancel')?.addEventListener('click', () => {
      closeApplySaveModal({ action: 'cancel' });
    });
    $('apply-save-skip')?.addEventListener('click', () => {
      closeApplySaveModal({ action: 'skip' });
    });
    $('apply-save-local')?.addEventListener('click', () => {
      closeApplySaveModal({
        action: 'save',
        storageScope: 'local',
        name: $('apply-save-name')?.value.trim(),
        description: $('apply-save-desc')?.value.trim(),
      });
    });
    $('apply-save-share')?.addEventListener('click', () => {
      closeApplySaveModal({
        action: 'save',
        storageScope: 'share',
        name: $('apply-save-name')?.value.trim(),
        description: $('apply-save-desc')?.value.trim(),
      });
    });
    $('apply-save-modal')?.addEventListener('click', (event) => {
      if (event.target === event.currentTarget) {
        closeApplySaveModal({ action: 'cancel' });
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
