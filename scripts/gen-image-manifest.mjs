import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_ROOT = path.join(__dirname, '..', 'public', 'assets');
const MANAGED_PREFIX = 'assets/images';
const IMG_RE = /\.(png|jpg|jpeg|webp|gif|svg)$/i;

function walk(dirPath, relDir) {
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const relPath = relDir ? relDir + '/' + entry.name : entry.name;
    if (entry.isDirectory()) {
      results.push(...walk(fullPath, relPath));
    } else if (entry.name === '_manifest.json') {
      continue;
    } else if (IMG_RE.test(entry.name)) {
      let stats;
      try {
        stats = fs.statSync(fullPath);
      } catch {
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      const baseName = path.basename(entry.name, ext);
      const normalizedRel = 'assets/' + relPath.replace(/\\/g, '/');
      results.push({
        fileName: entry.name,
        baseName,
        ext,
        relativePath: normalizedRel,
        writable: normalizedRel.startsWith(MANAGED_PREFIX + '/'),
        sizeBytes: stats.size,
        updatedAt: stats.mtimeMs,
      });
    }
  }
  return results;
}

const list = walk(ASSETS_ROOT, '');
list.sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true }));

const manifestPath = path.join(ASSETS_ROOT, 'images', '_manifest.json');
fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
fs.writeFileSync(manifestPath, JSON.stringify(list, null, 2), 'utf-8');

const writable = list.filter((e) => e.writable);
const readonly = list.filter((e) => !e.writable);
console.log(`Manifest: ${manifestPath}`);
console.log(`Total: ${list.length} (writable: ${writable.length}, read-only: ${readonly.length})`);
