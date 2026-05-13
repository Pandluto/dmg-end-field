(function () {
  const runtime = window.desktopRuntime;
  const logElement = document.getElementById('log');
  const scaleValueElement = document.getElementById('scale-value');
  const capturePresetSelect = document.getElementById('capture-preset-select');
  const captureSourceSelect = document.getElementById('capture-source-select');
  const captureMetaElement = document.getElementById('capture-meta');
  const capturePreviewElement = document.getElementById('capture-preview');
  let captureSources = [];
  let capturePresets = [];
  let capturePollTimer = 0;
  let latestCaptureFrameStamp = 0;
  let lastCaptureMetaMarkup = '';
  const statusCache = new Map();

  const appendLog = (line) => {
    const current = logElement.textContent ? `${logElement.textContent}\n` : '';
    logElement.textContent = `${current}${line}`;
    logElement.scrollTop = logElement.scrollHeight;
  };

  const setStatus = (id, value) => {
    const target = document.getElementById(id);
    if (target && statusCache.get(id) !== value) {
      target.textContent = value;
      statusCache.set(id, value);
    }
  };

  const formatCaptureSourceLabel = (source) => {
    return `窗口 | ${source.name || '未命名'} | ${source.id}`;
  };

  const renderCapturePresetOptions = (presets) => {
    capturePresetSelect.innerHTML = '';
    presets.forEach((preset) => {
      const option = document.createElement('option');
      option.value = preset.name;
      option.textContent = `${preset.name} | ${preset.label}`;
      capturePresetSelect.appendChild(option);
    });
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

  const renderCaptureSourceMeta = (source, frame, session) => {
    if (!source && !session) {
      const markup = '<div>源信息：尚未加载</div>';
      if (markup !== lastCaptureMetaMarkup) {
        captureMetaElement.innerHTML = markup;
        lastCaptureMetaMarkup = markup;
      }
      return;
    }

    const lines = [
      `名称：${source?.name || '未命名'}`,
      `类型：${source?.kind || 'window'}`,
      `ID：${source?.id || session?.boundSourceId || '-'}`,
    ];
    if (source?.backend) {
      lines.push(`后端：${source.backend}`);
    }
    if (session?.presetName) {
      lines.push(`预设：${session.presetName}${session.presetLabel ? ` | ${session.presetLabel}` : ''}`);
    }
    if (source?.displayId) {
      lines.push(`显示器：${source.displayId}`);
    }
    if (source?.width && source?.height) {
      lines.push(`窗口尺寸：${source.width}x${source.height}`);
    }
    if (frame) {
      lines.push(`尺寸：${frame.width}x${frame.height}`);
    }else{
      lines.push(`尺寸：未抓取`);
    }
    if (session) {
      lines.push(`会话状态：${session.running ? '运行中' : '已停止'}`);
      lines.push(`刷新间隔：${session.intervalMs} ms`);
      if (session.lastError) {
        lines.push(`最近错误：${session.lastError}`);
      }
    }

    const markup = lines.map((line) => `<div>${line}</div>`).join('');
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

  const refreshCapturePresets = async () => {
    const payload = await runtime.listCapturePresets();
    capturePresets = payload.presets || [];
    renderCapturePresetOptions(capturePresets);
    if (capturePresets[0]) {
      capturePresetSelect.value = capturePresets[0].name;
    }
  };

  const bindSelectedSource = async () => {
    const selectedSource = syncSelectedCaptureSource();
    if (!selectedSource) {
      throw new Error('请先选择一个捕获源');
    }

    const selectedPreset = capturePresetSelect.value || 'Win32-Window';
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
    if (scaleValueElement) {
      scaleValueElement.textContent =
        activeScale === savedScale ? activeScale : `${activeScale} -> ${savedScale}`;
    }
  };

  const boot = async () => {
    if (!runtime) {
      appendLog('desktopRuntime 不可用；当前不是 Electron shell 环境。');
      return;
    }

    const state = await runtime.getShellState();
    document.getElementById('role-value').textContent = runtime.role || '未知';
    document.getElementById('platform-value').textContent = `${state.platform}/${state.arch}`;
    document.getElementById('app-value').textContent = `${state.appName} ${state.appVersion}`;
    document.getElementById('host-value').textContent = state.hostname;
    syncScaleButtons(
      state.desktopSettings?.currentScale || '1x',
      state.desktopSettings?.savedScale || state.desktopSettings?.currentScale || '1x'
    );
    appendLog(`外壳就绪 | 角色=${runtime.role} | 平台=${state.platform} | 主机=${state.hostname}`);
    appendLog('主界面与 shell 现在都由 Electron 托管。');
    await refreshCapturePresets();
    await refreshCaptureSources();
    startCaptureFramePolling();
  };

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

  document.getElementById('clear-log').addEventListener('click', () => {
    logElement.textContent = '';
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

  boot();
})();
