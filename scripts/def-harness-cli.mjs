import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import harness from '../agent/harness/def-harness.cjs';
import { runNativeScenario } from './def-harness-native-runner.mjs';
import { runNativeRegression } from './def-harness-regression.mjs';

const root = path.resolve(process.cwd(), '.runtime', 'def-harness');
const [command = 'doctor', ...args] = process.argv.slice(2);
const json = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
const fail = (error) => {
  json({ ok: false, error: { code: error.code || 'HARNESS_CLI_ERROR', component: error.component || 'cli', message: error.message } });
  process.exitCode = 1;
};
const option = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : ''; };
const sourceDirectory = (input) => path.resolve(input || '');
const scenarioPath = (id) => path.resolve(process.cwd(), 'agent/harness/scenarios', `${id}.json`);

async function main() {
  if (command === 'doctor') {
    const writable = fs.mkdtempSync(path.join(os.tmpdir(), 'def-harness-doctor-'));
    fs.rmSync(writable, { recursive: true, force: true });
    json({ ok: true, schemaVersion: 1, runtimeRoot: root, slots: harness.SLOT_NAMES, registry: harness.readChannels(root), writable: true });
  } else if (command === 'package' && args[0] === 'build') {
    const result = harness.buildPackage(sourceDirectory(args[1]), path.join(root, 'builds'));
    json({ ok: true, package: result.package, directory: result.directory, existing: result.existing });
  } else if (command === 'package' && args[0] === 'validate') {
    json({ ok: true, package: harness.validatePackageDirectory(sourceDirectory(args[1])) });
  } else if (command === 'registry' && args[0] === 'add') {
    const ref = harness.registerPackage(root, sourceDirectory(args[1]), option('--channel'));
    json({ ok: true, ref, registry: harness.readChannels(root) });
  } else if (command === 'registry' && args[0] === 'list') {
    json({ ok: true, registry: harness.readChannels(root) });
  } else if (command === 'resolve') {
    const resolved = harness.createLoader(root).resolve(args[0] || 'stable');
    json({ ok: true, selector: resolved.selector, fallback: resolved.fallback, ref: resolved.ref });
  } else if (command === 'package-check') {
    const result = harness.runPackageSelfCheck({ runtimeRoot: root, scenarioFile: scenarioPath(args[0]), selector: option('--harness') || 'stable' });
    json({ ok: result.status === 'PACKAGE_CHECK_PASS', packageCheck: result });
  } else if (command === 'run') {
    const scenario = harness.loadScenario(scenarioPath(args[0]));
    const run = await runNativeScenario({ scenario, harnessSelector: option('--harness') || 'stable' });
    json({ ok: run.status === 'EXECUTED', run });
  } else if (command === 'regress') {
    const regression = await runNativeRegression({ baselineSelector: option('--baseline') || 'stable', candidateSelector: option('--candidate') });
    json({ ok: regression.status === 'PASS', regression });
  } else if (command === 'promote') {
    const [harnessId, version] = String(args[0] || '').split('@');
    const regressionPath = option('--regression');
    if (!regressionPath) throw new Error('promote requires --regression <real-regression.json>.');
    const regression = JSON.parse(fs.readFileSync(path.resolve(regressionPath), 'utf8'));
    json({ ok: true, decision: harness.promote(root, { harnessId, version, contentHash: option('--content-hash') }, regression, option('--reviewer'), option('--note')) });
  } else if (command === 'rollback') {
    json({ ok: true, decision: harness.rollback(root, option('--reviewer'), option('--reason')) });
  } else {
    throw new Error('Usage: doctor | package build <sourceDir> | package validate <packageDir> | registry add <packageDir> --channel stable|candidate/<name> | registry list | resolve [selector] | package-check <scenarioId> --harness stable|candidate/<name> | run <scenarioId> --harness stable|candidate/<name> | regress --baseline stable --candidate candidate/<name> | promote <id@version> --content-hash <hash> --regression <real-regression.json> --reviewer <name> | rollback --reviewer <reason>');
  }
}

main().catch(fail);
