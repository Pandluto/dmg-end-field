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
      'pick-image-source',
      'pick-data-source',
      'pick-output',
      'build-images',
      'build-data',
    ]) {
      element(id).disabled = value;
    }
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
      const [capabilities, appInfo, settings] = await Promise.all([
        host.getCapabilities(),
        host.getAppInfo(),
        host.getSettings(),
      ]);
      state.capabilities = capabilities;
      state.appInfo = appInfo;
      state.settings = settings;
      element('app-version').textContent = `v${appInfo.version}`;
      element('web-url').textContent = appInfo.webUrl;
      element('platform').textContent = `${appInfo.platform} · ${appInfo.arch}`;
      element('agent-status').textContent = capabilities.agent.reason;
      element('mcp-status').textContent = capabilities.mcp.reason;
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
