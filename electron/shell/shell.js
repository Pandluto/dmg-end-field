'use strict';

(function initializeShell() {
  const host = window.desktopHost;
  const state = {
    capabilities: null,
    appInfo: null,
    settings: null,
    imageSource: '',
    dataSource: '',
    output: '',
    lastOutput: '',
    busy: false,
  };

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
    state.busy = value;
    for (const id of [
      'open-browser',
      'open-mcp-fill',
      'open-agent-mode',
      'pick-image-source',
      'pick-data-source',
      'pick-output',
      'build-images',
      'build-data',
    ]) {
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

  function renderAgentState(runtime) {
    const available = element('agent-availability');
    const lifecycle = runtime?.state || 'not-started';
    const label = runtime?.ready
      ? 'Framework 就绪'
      : lifecycle === 'starting'
        ? '正在启动'
        : lifecycle === 'error'
          ? '启动失败'
          : lifecycle === 'stopping'
            ? '正在停止'
            : '尚未启动';
    available.textContent = label;
    available.classList.toggle('ready', Boolean(runtime?.ready));
    available.classList.toggle('pending', !runtime?.ready && lifecycle !== 'error');
    available.classList.toggle('failed', lifecycle === 'error');
    const engine = runtime?.health?.engine;
    const engineLabel = engine?.state === 'ready' ? `引擎 ${engine.kind} 已就绪` : '引擎待接入';
    element('agent-status').textContent = `${runtime?.reason || 'DEF Agent Host 状态未知'} · ${engineLabel}`;
  }

  async function selectPath(kind) {
    const result = kind === 'images'
      ? await host.pickImageReleaseSource()
      : kind === 'data'
        ? await host.pickDataReleaseSource()
        : await host.pickReleaseOutput();
    if (!result?.ok || !result.path) return;
    if (kind === 'images') {
      state.imageSource = result.path;
      element('image-source').value = result.path;
    } else if (kind === 'data') {
      state.dataSource = result.path;
      element('data-source').value = result.path;
    } else {
      state.output = result.path;
      element('release-output').value = result.path;
    }
  }

  async function buildRelease(kind) {
    const version = element('release-version').value.trim();
    const source = kind === 'images' ? state.imageSource : state.dataSource;
    if (!version || !source || !state.output) {
      setMessage('请先填写版本，并选择对应源目录和输出目录。', true);
      return;
    }

    setBusy(true);
    setMessage(kind === 'images' ? '正在生成图片发布包…' : '正在生成数据发布包…');
    try {
      const result = kind === 'images'
        ? await host.buildImageRelease({ assetVersion: version, releaseTag: version })
        : await host.buildDataRelease({ dataVersion: version });
      if (!result?.ok) throw new Error(result?.error || '发包失败。');
      state.lastOutput = result.result?.outputDir || '';
      element('reveal-output').hidden = !state.lastOutput;
      setMessage(`发布产物已生成：${state.lastOutput || '输出目录'}`);
    } catch (error) {
      setMessage(errorMessage(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    if (!host) {
      setMessage('desktopHost 不可用，请通过 Electron 启动 Shell。', true);
      return;
    }

    try {
      const [capabilities, appInfo, settings, mcpState, agentState] = await Promise.all([
        host.getCapabilities(),
        host.getAppInfo(),
        host.getSettings(),
        host.getMcpState(),
        host.getAgentState(),
      ]);
      state.capabilities = capabilities;
      state.appInfo = appInfo;
      state.settings = settings;
      element('app-version').textContent = `v${appInfo.version}`;
      element('web-url').textContent = appInfo.webUrl;
      element('platform').textContent = `${appInfo.platform} · ${appInfo.arch}`;
      element('agent-status').textContent = capabilities.agent.reason;
      renderAgentState(agentState);
      renderMcpState(mcpState);
      element('release-version').value = appInfo.version;

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
  element('open-agent-mode').addEventListener('click', async () => {
    setBusy(true);
    setMessage('正在启动 DEF Agent Host 并打开 AI 模式…');
    try {
      const result = await host.openAgentMode();
      if (!result?.ok) throw new Error(result?.error || '无法打开 AI 模式。');
      renderAgentState(result.runtime);
      setMessage('AI 模式已在系统浏览器中打开；当前引擎仍待接入。');
    } catch (error) {
      setMessage(errorMessage(error), true);
      renderAgentState(await host.getAgentState().catch(() => null));
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
  element('pick-image-source').addEventListener('click', () => {
    void selectPath('images').catch((error) => setMessage(errorMessage(error), true));
  });
  element('pick-data-source').addEventListener('click', () => {
    void selectPath('data').catch((error) => setMessage(errorMessage(error), true));
  });
  element('pick-output').addEventListener('click', () => {
    void selectPath('output').catch((error) => setMessage(errorMessage(error), true));
  });
  element('build-images').addEventListener('click', () => void buildRelease('images'));
  element('build-data').addEventListener('click', () => void buildRelease('data'));
  element('reveal-output').addEventListener('click', () => {
    if (state.lastOutput) void host.revealPath(state.lastOutput);
  });
  element('quit').addEventListener('click', () => void host.quit());

  void start();
}());
