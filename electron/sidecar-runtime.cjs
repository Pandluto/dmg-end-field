const path = require('path');

function resolvePackagedEsbuildBinary({ resourcesPath, platform = process.platform, arch = process.arch }) {
  return path.join(
    resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    '@esbuild',
    `${platform}-${arch}`,
    'bin',
    platform === 'win32' ? 'esbuild.exe' : 'esbuild',
  );
}

function buildNodeSidecarEnv({
  baseEnv = process.env,
  userDataPath,
  resourcesPath = '',
  packaged = false,
  platform = process.platform,
  arch = process.arch,
  extra = {},
}) {
  if (!userDataPath) throw new Error('userDataPath is required to build the sidecar environment.');
  const packagedEsbuildBinary = packaged
    ? resolvePackagedEsbuildBinary({ resourcesPath, platform, arch })
    : '';
  return {
    ...baseEnv,
    ELECTRON_RUN_AS_NODE: '1',
    DEF_OPENCODE_HOME: path.join(userDataPath, 'def-opencode'),
    ...(packagedEsbuildBinary ? { ESBUILD_BINARY_PATH: packagedEsbuildBinary } : {}),
    ...extra,
  };
}

module.exports = {
  buildNodeSidecarEnv,
  resolvePackagedEsbuildBinary,
};
