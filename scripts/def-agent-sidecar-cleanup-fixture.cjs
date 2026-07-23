const adapterPath = require.resolve('../agent/runtime/def-opencode-adapter/index.cjs');
const adapter = require(adapterPath);

const fakeOpenCodeUrl = process.env.DEF_CLEANUP_FAKE_OPENCODE_URL;
if (!fakeOpenCodeUrl) throw new Error('DEF_CLEANUP_FAKE_OPENCODE_URL is required.');

require.cache[adapterPath].exports = {
  ...adapter,
  ensureRuntime: async (config = {}) => {
    await fetch(`${fakeOpenCodeUrl}/__runtime-ensure`, { method: 'POST' });
    return {
      ...adapter.runtimeSummary(config),
      running: true,
      serverUrl: fakeOpenCodeUrl,
    };
  },
  runtimeSummary: (config = {}) => ({
    ...adapter.runtimeSummary(config),
    running: true,
    serverUrl: fakeOpenCodeUrl,
  }),
};

require('../agent/server/def-agent-server.cjs');
