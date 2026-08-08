import fs from 'node:fs';

export function writeGeneratedFile(targetPath, contents) {
  const current = readCurrentContents(targetPath, contents);
  if (current) return false;

  const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  fs.writeFileSync(temporaryPath, contents);
  const maxAttempts = process.platform === 'win32' ? 5 : 1;
  try {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        fs.renameSync(temporaryPath, targetPath);
        return true;
      } catch (error) {
        const retryable = process.platform === 'win32'
          && ['EBUSY', 'EPERM', 'UNKNOWN'].includes(error?.code || '')
          && attempt < maxAttempts - 1;
        if (!retryable) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 75 * (attempt + 1));
      }
    }
  } finally {
    try { fs.rmSync(temporaryPath, { force: true }); } catch { /* best effort */ }
  }
  return false;
}

function readCurrentContents(targetPath, contents) {
  try {
    const current = fs.readFileSync(targetPath);
    return Buffer.isBuffer(contents)
      ? current.equals(contents)
      : current.toString('utf8') === contents;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}
