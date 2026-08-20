import fs from 'node:fs';
import path from 'node:path';

const clientRoot = path.resolve(process.argv[2] || 'dist/client');
const requiredBeforePrune = ['index.html', 'sw.js', 'version.json'];

for (const fileName of requiredBeforePrune) {
  if (!fs.existsSync(path.join(clientRoot, fileName))) {
    throw new Error(`Refusing to prune an incomplete Sites client build: ${fileName}`);
  }
}

fs.rmSync(clientRoot, { recursive: true, force: true });
fs.mkdirSync(clientRoot, { recursive: true });
fs.writeFileSync(path.join(clientRoot, '.assetsignore'), 'wrangler.json\n.dev.vars\n');

console.log('Sites retirement client: removed the complete overseas application payload.');
