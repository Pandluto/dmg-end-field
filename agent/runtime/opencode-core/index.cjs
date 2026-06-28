// Legacy compatibility shim.
// This path used to contain a self-written OpenCode-style mock. The real
// implementation now lives in ../def-opencode-adapter and runs the vendored
// upstream OpenCode source under agent/vendor/opencode.
module.exports = require('../def-opencode-adapter/index.cjs');
