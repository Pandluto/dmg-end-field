import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const outputDirectory = path.resolve(process.argv[2] || 'dist');
const serviceWorkerPath = path.join(outputDirectory, 'sw.js');

if (!fs.existsSync(serviceWorkerPath)) {
  throw new Error(`Service worker output does not exist: ${serviceWorkerPath}`);
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolutePath) : [absolutePath];
  });
}

function isCoreAppShellFile(relativePath) {
  if (['index.html', 'app-icon.png', 'manifest.webmanifest'].includes(relativePath)) {
    return true;
  }
  if (!relativePath.startsWith('assets/')) return false;
  if (relativePath.startsWith('assets/themes/')) return false;
  return !path.posix.basename(relativePath).startsWith('theme-');
}

const shellEntries = walk(outputDirectory)
  .map((absolutePath) => ({
    absolutePath,
    relativePath: path.relative(outputDirectory, absolutePath).split(path.sep).join('/'),
  }))
  .filter(({ relativePath }) => isCoreAppShellFile(relativePath))
  .sort((left, right) => left.relativePath.localeCompare(right.relativePath));

if (!shellEntries.some(({ relativePath }) => relativePath === 'index.html')) {
  throw new Error(`Built index.html is missing from ${outputDirectory}`);
}

const digest = crypto.createHash('sha256');
for (const entry of shellEntries) {
  digest.update(entry.relativePath);
  digest.update('\0');
  digest.update(fs.readFileSync(entry.absolutePath));
  digest.update('\0');
}

const version = digest.digest('hex').slice(0, 16);
const urls = shellEntries.map(({ relativePath }) => `/${relativePath}`);
const source = fs.readFileSync(serviceWorkerPath, 'utf8');
const versionMarker = "'__DMG_APP_SHELL_VERSION__'";
const filesMarker = '/*__DMG_APP_SHELL_FILES__*/[]';

if (!source.includes(versionMarker) || !source.includes(filesMarker)) {
  throw new Error('Service worker build markers are missing.');
}

const generated = source
  .replace(versionMarker, JSON.stringify(version))
  .replace(filesMarker, JSON.stringify(urls, null, 2));
fs.writeFileSync(serviceWorkerPath, generated);

console.log(`Atomic app shell ${version}: ${urls.length} files.`);
