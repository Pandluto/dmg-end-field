import { spawn } from 'node:child_process';
import { once } from 'node:events';
import waitOn from 'wait-on';

const server = process.platform === 'win32'
  ? spawn('cmd.exe', ['/d', '/s', '/c', 'npm run dev'], { stdio: ['ignore', 'pipe', 'pipe'] })
  : spawn('npm', ['run', 'dev'], { stdio: ['ignore', 'pipe', 'pipe'] });

let serverOutput = '';
server.stdout.on('data', (chunk) => {
  serverOutput += chunk.toString();
});
server.stderr.on('data', (chunk) => {
  serverOutput += chunk.toString();
});

try {
  await waitOn({ resources: ['tcp:127.0.0.1:3030'], timeout: 30000 });
  const electronBin = process.platform === 'win32'
    ? './node_modules/.bin/electron.cmd'
    : './node_modules/.bin/electron';
  const smoke = spawn(
    electronBin,
    ['scripts/electron-smoke-operator-config.cjs', 'http://127.0.0.1:3030/#/operator-config'],
    { stdio: 'inherit' }
  );
  const [code] = await once(smoke, 'exit');
  if (code !== 0) {
    throw new Error(`electron smoke failed with code ${code}`);
  }
} catch (error) {
  console.error(serverOutput);
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  server.kill();
}
