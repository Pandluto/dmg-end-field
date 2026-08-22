'use strict';

(function initializeShell() {
  const host = window.desktopHost;
  const state = {
    capabilities: null,
    appInfo: null,
    settings: null,
    imageSource: '',
    shareDataSource: '',
    output: '',
    lastOutput: '',
    busy: false,
  };

  const element = (id) => document.getElementById(id);
  const message = element('message');
  const agentProfileMessage = element('agent-profile-message');

  function setMessage(value, isError = false) {
    message.textContent = value;
    message.classList.toggle('is-error', isError);
  }

  function setAgentProfileMessage(value, status = 'neutral') {
    agentProfileMessage.textContent = value;
    agentProfileMessage.classList.toggle('is-error', status === 'error');
    agentProfileMessage.classList.toggle('is-success', status === 'success');
  }

  function agentProfilePayload() {
    return {
      apiKey: element('agent-api-key').value,
      baseUrl: element('agent-base-url').value,
      modelId: element('agent-model-id').value,
    };
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
      'test-agent-profile',
      'save-agent-profile',
      'pick-image-source',
      'pick-share-data-source',
      'pick-output',
      'build-resource',
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
    const engineLabel = engine?.state === 'ready'
      ? `引擎 ${engine.kind} 已就绪`
      : engine?.state === 'unavailable'
        ? `引擎 ${engine.kind || 'opencode'} 不可用${engine.reason ? `：${engine.reason}` : ''}`
        : `引擎 ${engine?.kind || 'opencode'} 正在检查`;
    element('agent-status').textContent = `${runtime?.reason || 'DEF Agent Host 状态未知'} · ${engineLabel}`;
  }

  function renderAgentProfile(profile) {
    const configured = Boolean(profile?.configured && profile?.apiKeyConfigured);
    const status = element('agent-profile-status');
    status.textContent = configured ? `已配置 · ${profile.modelId}` : '尚未配置';
    status.classList.toggle('ready', configured);
    if (profile?.baseUrl) element('agent-base-url').value = profile.baseUrl;
    if (profile?.modelId) element('agent-model-id').value = profile.modelId;
    element('agent-api-key').placeholder = configured ? '留空则保留已有密钥' : '请输入 API Key';
  }

  async function selectPath(kind) {
    const result = kind === 'images'
      ? await host.pickImageReleaseSource()
      : kind === 'share-data'
        ? await host.pickShareDataSource()
        : await host.pickReleaseOutput();
    if (!result?.ok || !result.path) return;
    if (kind === 'images') {
      state.imageSource = result.path;
      element('image-source').value = result.path;
    } else if (kind === 'share-data') {
      state.shareDataSource = result.path;
      element('share-data-source').value = result.path;
    } else {
      state.output = result.path;
      element('release-output').value = result.path;
    }
  }

  async function buildRelease() {
    if (!state.imageSource || !state.shareDataSource || !state.output) {
      setMessage('请先选择完整 Share Data、图片目录和输出目录。', true);
      return;
    }

    setBusy(true);
    setMessage('正在校验 Share Data、图片引用并生成统一资源包…');
    try {
      const result = await host.buildResourceRelease();
      if (!result?.ok) throw new Error(result?.error || '发包失败。');
      state.lastOutput = result.result?.outputDir || '';
      element('reveal-output').hidden = !state.lastOutput;
      const releaseVersion = result.result?.releaseVersion || '未知版本';
      setMessage(`统一资源包 ${releaseVersion} 已生成：${state.lastOutput || '输出目录'}`);
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
      const [capabilities, appInfo, settings, mcpState, agentState, agentProfile] = await Promise.all([
        host.getCapabilities(),
        host.getAppInfo(),
        host.getSettings(),
        host.getMcpState(),
        host.getAgentState(),
        host.getAgentProfile(),
      ]);
      state.capabilities = capabilities;
      state.appInfo = appInfo;
      state.settings = settings;
      element('app-version').textContent = `v${appInfo.version}`;
      element('web-url').textContent = appInfo.webUrl;
      element('platform').textContent = `${appInfo.platform} · ${appInfo.arch}`;
      element('agent-status').textContent = capabilities.agent.reason;
      renderAgentState(agentState);
      renderAgentProfile(agentProfile);
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
  element('open-agent-mode').addEventListener('click', async () => {
    setBusy(true);
    setMessage('正在启动 DEF Agent Host 并打开 AI 模式…');
    try {
      const result = await host.openAgentMode();
      if (!result?.ok) throw new Error(result?.error || '无法打开 AI 模式。');
      renderAgentState(result.runtime);
      setMessage('AI 模式已在系统浏览器中打开。');
    } catch (error) {
      setMessage(errorMessage(error), true);
      renderAgentState(await host.getAgentState().catch(() => null));
    } finally {
      setBusy(false);
    }
  });
  element('save-agent-profile').addEventListener('click', async () => {
    setBusy(true);
    setAgentProfileMessage('正在测试 API Key、Base URL 与模型，并安全切换 Agent…');
    try {
      const result = await host.saveAgentProfile(agentProfilePayload());
      if (!result?.ok) {
        const error = new Error(result?.error || 'Provider 配置保存失败。');
        error.code = result?.code || 'AGENT_PROVIDER_UPDATE_FAILED';
        throw error;
      }
      element('agent-api-key').value = '';
      renderAgentProfile(result.profile);
      renderAgentState(result.runtime || await host.getAgentState());
      setAgentProfileMessage(result.changed === false
        ? `连接验证通过，当前配置无需切换：${result.profile.modelId}`
        : `连接验证通过，Agent Provider 已切换：${result.profile.modelId}`, 'success');
    } catch (error) {
      setAgentProfileMessage(errorMessage(error), 'error');
      renderAgentState(await host.getAgentState().catch(() => null));
    } finally {
      setBusy(false);
    }
  });
  element('test-agent-profile').addEventListener('click', async () => {
    setBusy(true);
    setAgentProfileMessage('正在测试 API Key、Base URL 与模型可用性…');
    try {
      const result = await host.testAgentProfile(agentProfilePayload());
      if (!result?.ok) {
        const error = new Error(result?.error || 'Provider 连接测试失败。');
        error.code = result?.code || 'AGENT_PROVIDER_PROBE_FAILED';
        throw error;
      }
      setAgentProfileMessage(`连接测试通过：${result.profile.modelId}`, 'success');
    } catch (error) {
      setAgentProfileMessage(errorMessage(error), 'error');
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
  element('pick-share-data-source').addEventListener('click', () => {
    void selectPath('share-data').catch((error) => setMessage(errorMessage(error), true));
  });
  element('pick-output').addEventListener('click', () => {
    void selectPath('output').catch((error) => setMessage(errorMessage(error), true));
  });
  element('build-resource').addEventListener('click', () => void buildRelease());
  element('reveal-output').addEventListener('click', () => {
    if (state.lastOutput) void host.revealPath(state.lastOutput);
  });
  element('quit').addEventListener('click', () => void host.quit());

  void start();
}());
