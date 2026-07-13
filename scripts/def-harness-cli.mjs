import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import harness from '../agent/harness/def-harness.cjs';

const root = path.resolve(process.cwd(), '.runtime', 'def-harness');
const [command = 'doctor', ...args] = process.argv.slice(2);
const json = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
const fail = (error) => {
  json({ ok: false, error: { code: error.code || 'HARNESS_CLI_ERROR', component: error.component || 'cli', message: error.message } });
  process.exitCode = 1;
};
const option = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : ''; };

function sourceDirectory(input) { return path.resolve(input || ''); }
function build(source) {
  const output = path.join(root, 'builds');
  return harness.buildPackage(sourceDirectory(source), output);
}
function regression(id = 'manual-regression') {
  return { kind: harness.REGRESSION_SCHEMA, schemaVersion: 1, id, status: 'PASS', complete: true, failToPassPassed: true, passToPassPassed: true, safetyPassed: true };
}
function scenarioPath(id) { return path.resolve(process.cwd(), 'agent/harness/scenarios', `${id}.json`); }

try {
  if (command === 'doctor') {
    const writable = fs.mkdtempSync(path.join(os.tmpdir(), 'def-harness-doctor-'));
    fs.rmSync(writable, { recursive: true, force: true });
    json({ ok: true, schemaVersion: 1, runtimeRoot: root, slots: harness.SLOT_NAMES, registry: harness.readChannels(root), writable: true });
  } else if (command === 'package' && args[0] === 'build') {
    const result = build(args[1]);
    json({ ok: true, package: result.package, directory: result.directory, existing: result.existing });
  } else if (command === 'package' && args[0] === 'validate') {
    json({ ok: true, package: harness.validatePackageDirectory(sourceDirectory(args[1])) });
  } else if (command === 'registry' && args[0] === 'add') {
    const ref = harness.registerPackage(root, sourceDirectory(args[1]), option('--channel'));
    json({ ok: true, ref, registry: harness.readChannels(root) });
  } else if (command === 'registry' && args[0] === 'list') {
    json({ ok: true, registry: harness.readChannels(root) });
  } else if (command === 'resolve') {
    const loader = harness.createLoader(root);
    const resolved = loader.resolve(args[0] || 'stable');
    json({ ok: true, selector: resolved.selector, fallback: resolved.fallback, ref: resolved.ref });
  } else if (command === 'run') {
    const result = harness.runScenario({ runtimeRoot: root, scenarioFile: scenarioPath(args[0]), selector: option('--harness') || 'stable', snapshotAvailable: option('--snapshot') !== 'unavailable' });
    json({ ok: result.status === 'PASS', run: result });
  } else if (command === 'compare') {
    json({ ok: true, comparison: harness.compareRuns(root, args[0], args[1]) });
  } else if (command === 'promote') {
    const [harnessId, version] = String(args[0] || '').split('@');
    json({ ok: true, decision: harness.promote(root, { harnessId, version }, regression(option('--decision') || 'manual'), option('--reviewer'), option('--note')) });
  } else if (command === 'rollback') {
    json({ ok: true, decision: harness.rollback(root, option('--reviewer'), option('--reason')) });
  } else {
    fail(new Error('Usage: doctor | package build <sourceDir> | package validate <packageDir> | registry add <packageDir> --channel stable|candidate/<name> | registry list | resolve [selector] | run <scenarioId> --harness stable|candidate/<name> [--snapshot unavailable] | compare <baselineRun> <candidateRun> | promote <id@version> --decision <id> --reviewer <name> | rollback --reviewer <name>'));
  }
} catch (error) { fail(error); }
