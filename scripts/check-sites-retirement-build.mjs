import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const distRoot = path.resolve(process.argv[2] || 'dist');
const clientRoot = path.join(distRoot, 'client');
const serverRoot = path.join(distRoot, 'server');

assert.deepEqual(
  fs.readdirSync(clientRoot).sort(),
  ['.assetsignore'],
  'Retired Sites output must not contain a directly served application or resource file.',
);

const workerSource = fs.readFileSync(path.join(serverRoot, 'index.js'), 'utf8');
assert.match(workerSource, /https:\/\/dmgendfield\.cloud/);
assert.match(workerSource, /1\.8\.5-retired/);
assert.match(workerSource, /3bbac54d4a3c4308/);
assert.match(workerSource, /X-DMG-Site-Status/);
assert.match(workerSource, /api\/mobile-shares/);

const workerConfig = JSON.parse(
  fs.readFileSync(path.join(serverRoot, 'wrangler.json'), 'utf8'),
);
assert.equal(workerConfig.assets?.run_worker_first, true);
assert.equal(workerConfig.assets?.directory, '../client');

console.log('SITES_RETIREMENT_BUILD_OK client_files=1');
