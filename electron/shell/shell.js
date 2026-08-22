'use strict';

(function initializeShell() {
  const host = window.desktopHost;
  const element = (id) => document.getElementById(id);
  const message = element('message');

  function setMessage(value, isError = false) {
    message.textContent = value;
    message.classList.toggle('is-error', isError);
  }

  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }

  function setBusy(value) {
    for (const id of ['open-browser', 'open-mcp-fill']) {
      element(id).disabled = value;
    }
  }

  function renderMcpState(runtime) {
    const available = element('mcp-availability');
    available.textContent = runtime?.ready ? '服务已就绪' : runtime?.running ? '正在启动' : '服务不可用';
    available.classList.toggle('ready', Boolean(runtime?.ready));
    available.classList.toggle('pending', !runtime?.ready);
    element('mcp-status').textContent = runtime?.reason || 'MCP 填表服务状态未知';
  }

  async function start() {
    if (!host) {
      setMessage('desktopHost 不可用，请通过 Electron 启动 Shell。', true);
      return;
    }

    try {
      const [capabilities, appInfo, settings, mcpState] = await Promise.all([
        host.getCapabilities(),
        host.getAppInfo(),
        host.getSettings(),
        host.getMcpState(),
      ]);
      if (capabilities.agent?.entryEnabled || capabilities.releaseTools?.entryEnabled) {
        throw new Error('Shell 冻结入口与主进程能力不一致，请重新构建桌面端。');
      }
      element('app-version').textContent = `v${appInfo.version}`;
      element('web-url').textContent = appInfo.webUrl;
      element('platform').textContent = `${appInfo.platform} · ${appInfo.arch}`;
      renderMcpState(mcpState);

      const scaleSelect = element('shell-scale');
      for (const scale of settings.availableScales) {
        const option = document.createElement('option');
        option.value = scale;
        option.textContent = `${Math.round(Number(scale) * 100)}%`;
        option.selected = scale === settings.scale;
        scaleSelect.append(option);
      }
    } catch (error) {
      setMessage(errorMessage(error), true);
    }
  }

  element('open-browser').addEventListener('click', async () => {
    try {
      const result = await host.openBrowser();
      if (!result?.ok) throw new Error(result?.error || '无法打开浏览器。');
      setMessage(`浏览器工作台已打开：${result.url}`);
    } catch (error) {
      setMessage(errorMessage(error), true);
    }
  });

  element('open-mcp-fill').addEventListener('click', async () => {
    setBusy(true);
    setMessage('正在打开 MCP 填表界面…');
    try {
      const result = await host.openMcpFill();
      if (!result?.ok) throw new Error(result?.error || '无法打开 MCP 填表界面。');
      renderMcpState(result.runtime);
      setMessage(`MCP 填表已打开；客户端配置：${result.clientConfigPath}`);
    } catch (error) {
      setMessage(errorMessage(error), true);
      renderMcpState(await host.getMcpState().catch(() => null));
    } finally {
      setBusy(false);
    }
  });

  element('shell-scale').addEventListener('change', async (event) => {
    try {
      await host.setScale(event.currentTarget.value);
    } catch (error) {
      setMessage(errorMessage(error), true);
    }
  });
  element('quit').addEventListener('click', () => void host.quit());

  void start();
}());
