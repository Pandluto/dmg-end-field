(function () {
  const runtime = window.desktopRuntime;
  const logElement = document.getElementById('log');
  const scaleValueElement = document.getElementById('scale-value');

  const appendLog = (line) => {
    const current = logElement.textContent ? `${logElement.textContent}\n` : '';
    logElement.textContent = `${current}${line}`;
    logElement.scrollTop = logElement.scrollHeight;
  };

  const setStatus = (id, value) => {
    const target = document.getElementById(id);
    if (target) {
      target.textContent = value;
    }
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

  boot();
})();
