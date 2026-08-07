import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  resolveOpenCodeUiLayout,
  verifyOpenCodeUiTree,
} from './opencode-ui-contract.mjs';

function usage() {
  console.log('Usage: node scripts/prepare-opencode-ui.mjs [--source <directory>]');
  console.log('       Without --source, the locked local cache must already be complete.');
}

function prepare(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    usage();
    return;
  }
  if (argv.length !== 0 && (argv.length !== 2 || argv[0] !== '--source')) {
    usage();
    throw new Error('OpenCode native UI arguments are invalid');
  }
  const layout = resolveOpenCodeUiLayout();
  const source = argv.length === 2 ? path.resolve(process.cwd(), argv[1]) : null;
  if (!source) {
    verifyOpenCodeUiTree(layout.cachePath, layout.lock.artifact);
    console.log(`OPENCODE_UI_PREPARE_OK upstream=${layout.lock.upstreamVersion} state=existing`);
    return;
  }
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    throw new Error('OpenCode native UI source directory is missing');
  }
  verifyOpenCodeUiTree(source, layout.lock.artifact);
  if (path.resolve(source) === path.resolve(layout.cachePath)) {
    console.log(`OPENCODE_UI_PREPARE_OK upstream=${layout.lock.upstreamVersion} state=existing`);
    return;
  }

  const parent = path.dirname(layout.cachePath);
  const temporary = path.join(parent, `.opencode-ui.${process.pid}.${crypto.randomUUID()}.tmp`);
  const backup = path.join(parent, `.opencode-ui.${process.pid}.${crypto.randomUUID()}.backup`);
  fs.mkdirSync(parent, { recursive: true });
  fs.cpSync(source, temporary, { recursive: true, errorOnExist: true });
  let backedUp = false;
  try {
    if (fs.existsSync(layout.cachePath)) {
      fs.renameSync(layout.cachePath, backup);
      backedUp = true;
    }
    fs.renameSync(temporary, layout.cachePath);
    verifyOpenCodeUiTree(layout.cachePath, layout.lock.artifact);
    if (backedUp) fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    if (fs.existsSync(layout.cachePath)) fs.rmSync(layout.cachePath, { recursive: true, force: true });
    if (backedUp && fs.existsSync(backup)) fs.renameSync(backup, layout.cachePath);
    throw error;
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { recursive: true, force: true });
  }
  console.log(`OPENCODE_UI_PREPARE_OK upstream=${layout.lock.upstreamVersion} state=installed`);
}

try {
  prepare();
} catch (error) {
  console.error(`OPENCODE_UI_PREPARE_ERROR ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 4;
}

export { prepare };
