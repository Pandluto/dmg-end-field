'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const electronPath = require('electron');

const root = path.resolve(__dirname, '..');
const child = spawn(electronPath, ['electron/main.cjs', '--dev'], {
  cwd: root,
  env: {
    ...process.env,
    DEF_AGENT_INTEROP_ENABLED: '1',
  },
  stdio: 'inherit',
});

child.once('error', (error) => {
  console.error(`[electron-dev-launch] ${error.message}`);
  process.exitCode = 1;
});

child.once('exit', (code) => {
  process.exit(code ?? 1);
});
