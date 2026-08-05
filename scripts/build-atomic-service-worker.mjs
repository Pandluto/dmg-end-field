import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.resolve(process.argv[2] || 'dist');
const serviceWorkerPath = path.join(outputDirectory, 'sw.js');
const indexPath = path.join(outputDirectory, 'index.html');
const versionManifestPath = path.join(outputDirectory, 'version.json');
const packageMetadata = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
);

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
const indexSource = fs.readFileSync(indexPath, 'utf8');
const versionMarker = "'__DMG_APP_SHELL_VERSION__'";
const releaseVersionMarker = "'__DMG_APP_RELEASE_VERSION__'";
const filesMarker = '/*__DMG_APP_SHELL_FILES__*/[]';
const indexVersionMarker = 'content="__DMG_APP_SHELL_VERSION__"';

if (
  !source.includes(versionMarker)
  || !source.includes(releaseVersionMarker)
  || !source.includes(filesMarker)
) {
  throw new Error('Service worker build markers are missing.');
}
if (!indexSource.includes(indexVersionMarker)) {
  throw new Error('App shell version meta marker is missing from index.html.');
}

const generated = source
  .replace(versionMarker, JSON.stringify(version))
  .replace(releaseVersionMarker, JSON.stringify(packageMetadata.version))
  .replace(filesMarker, JSON.stringify(urls, null, 2));
const generatedIndex = indexSource.replace(
  indexVersionMarker,
  `content="${version}"`,
);
fs.writeFileSync(serviceWorkerPath, generated);
fs.writeFileSync(indexPath, generatedIndex);
fs.writeFileSync(versionManifestPath, `${JSON.stringify({
  schemaVersion: 1,
  releaseVersion: packageMetadata.version,
  shellVersion: version,
}, null, 2)}\n`);

console.log(`Atomic app shell ${version}: ${urls.length} files.`);
