const fs = require('fs');
const os = require('os');
const path = require('path');

const MANAGED_SESSION_DIRECTORY_IDENTITY_KIND = 'DefManagedSessionDirectoryIdentityV1';
const MANAGED_SESSION_DIRECTORY_IDENTITY_SCHEMA_VERSION = 1;
const DEFAULT_AGENT_WORKSPACE_DIRECTORY = path.join(os.tmpdir(), 'dmg-end-field', 'def-agent-workspace');
const MANAGED_SESSION_HOSTS = new Set(['ai-cli', 'workbench']);

function pathIdentity(value) {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === 'win32'
    ? normalized.replace(/\//g, '\\').toLowerCase()
    : normalized;
}

function sameManagedPath(left, right) {
  return typeof left === 'string'
    && typeof right === 'string'
    && pathIdentity(left) === pathIdentity(right);
}

function isManagedPathWithin(root, candidate, allowRoot = false) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (!relative) return allowRoot;
  return relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function readBigIntDirectoryEntry(target) {
  const stat = fs.lstatSync(target, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
  const realPath = fs.realpathSync.native
    ? fs.realpathSync.native(target)
    : fs.realpathSync(target);
  if (!sameManagedPath(realPath, target)) return null;
  return Object.freeze({
    path: path.resolve(target),
    realPath: path.resolve(realPath),
    dev: String(stat.dev),
    ino: String(stat.ino),
    birthtimeNs: String(stat.birthtimeNs),
  });
}

function sameDirectoryEntry(left, right) {
  return Boolean(left && right
    && sameManagedPath(left.path, right.path)
    && sameManagedPath(left.realPath, right.realPath)
    && left.dev === right.dev
    && left.ino === right.ino
    && left.birthtimeNs === right.birthtimeNs);
}

function readManagedSessionDirectoryIdentity(directory, options = {}) {
  if (typeof directory !== 'string' || !directory.trim()) return null;
  const configuredWorkspace = typeof options.workspaceDirectory === 'string' && options.workspaceDirectory.trim()
    ? options.workspaceDirectory
    : DEFAULT_AGENT_WORKSPACE_DIRECTORY;
  try {
    const workspaceRoot = path.resolve(configuredWorkspace);
    const workspace = readBigIntDirectoryEntry(workspaceRoot);
    if (!workspace) return null;

    const sessionsRoot = path.join(workspace.realPath, 'sessions');
    const sessions = readBigIntDirectoryEntry(sessionsRoot);
    if (!sessions || !isManagedPathWithin(workspace.realPath, sessions.realPath)) return null;

    const resolvedDirectory = path.resolve(directory);
    const relative = path.relative(sessions.realPath, resolvedDirectory);
    if (!relative
      || relative === '..'
      || relative.startsWith(`..${path.sep}`)
      || path.isAbsolute(relative)) return null;
    const components = relative.split(path.sep);
    if (components.length !== 2 || components.some((component) => !component)) return null;
    const [hostName, sessionName] = components;
    if (!MANAGED_SESSION_HOSTS.has(hostName.toLowerCase())) return null;

    const hostRoot = path.join(sessions.realPath, hostName);
    const expectedDirectory = path.join(hostRoot, sessionName);
    if (!sameManagedPath(expectedDirectory, resolvedDirectory)) return null;
    const host = readBigIntDirectoryEntry(hostRoot);
    const session = readBigIntDirectoryEntry(expectedDirectory);
    if (!host || !session
      || !isManagedPathWithin(sessions.realPath, host.realPath)
      || !isManagedPathWithin(host.realPath, session.realPath)) return null;

    return Object.freeze({
      workspaceRoot: workspace.realPath,
      sessionsRoot: sessions.realPath,
      hostRoot: host.realPath,
      directory: session.realPath,
      hostName: hostName.toLowerCase(),
      sessionName,
      entries: Object.freeze({ workspace, sessions, host, session }),
    });
  } catch {
    return null;
  }
}

function sameManagedSessionDirectoryIdentity(left, right) {
  return Boolean(left && right
    && sameManagedPath(left.workspaceRoot, right.workspaceRoot)
    && sameManagedPath(left.sessionsRoot, right.sessionsRoot)
    && sameManagedPath(left.hostRoot, right.hostRoot)
    && sameManagedPath(left.directory, right.directory)
    && left.hostName === right.hostName
    && left.sessionName === right.sessionName
    && sameDirectoryEntry(left.entries?.workspace, right.entries?.workspace)
    && sameDirectoryEntry(left.entries?.sessions, right.entries?.sessions)
    && sameDirectoryEntry(left.entries?.host, right.entries?.host)
    && sameDirectoryEntry(left.entries?.session, right.entries?.session));
}

function createManagedSessionDirectoryBinding(identity) {
  const session = identity?.entries?.session;
  if (!identity || !session) return null;
  return Object.freeze({
    kind: MANAGED_SESSION_DIRECTORY_IDENTITY_KIND,
    schemaVersion: MANAGED_SESSION_DIRECTORY_IDENTITY_SCHEMA_VERSION,
    dev: session.dev,
    ino: session.ino,
    birthtimeNs: session.birthtimeNs,
  });
}

function matchesManagedSessionDirectoryBinding(bindingIdentity, identity) {
  const expected = createManagedSessionDirectoryBinding(identity);
  return Boolean(expected
    && bindingIdentity?.kind === MANAGED_SESSION_DIRECTORY_IDENTITY_KIND
    && Number(bindingIdentity.schemaVersion) === MANAGED_SESSION_DIRECTORY_IDENTITY_SCHEMA_VERSION
    && bindingIdentity.dev === expected.dev
    && bindingIdentity.ino === expected.ino
    && bindingIdentity.birthtimeNs === expected.birthtimeNs);
}

function normalStatIdentity(stat) {
  if (!stat) return null;
  return Object.freeze({
    dev: String(stat.dev),
    ino: String(stat.ino),
    birthtimeMs: String(stat.birthtimeMs),
    size: String(stat.size),
    mtimeMs: String(stat.mtimeMs),
    ctimeMs: String(stat.ctimeMs),
  });
}

function readManagedSessionBindingTargetIdentity(directoryIdentity, options = {}) {
  if (!directoryIdentity?.directory) return null;
  const target = path.join(directoryIdentity.directory, '.def-session.json');
  try {
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    const realPath = fs.realpathSync.native
      ? fs.realpathSync.native(target)
      : fs.realpathSync(target);
    if (!sameManagedPath(realPath, target)
      || !isManagedPathWithin(directoryIdentity.directory, realPath)) return null;
    return Object.freeze({
      exists: true,
      target: path.resolve(target),
      realPath: path.resolve(realPath),
      stat: normalStatIdentity(stat),
    });
  } catch (error) {
    if (options.allowMissing === true && error?.code === 'ENOENT') {
      return Object.freeze({ exists: false, target: path.resolve(target), realPath: null, stat: null });
    }
    return null;
  }
}

function sameManagedFileObjectIdentity(left, right) {
  return Boolean(left && right
    && (process.platform === 'win32' || left.dev === right.dev)
    && left.ino === right.ino
    && left.birthtimeMs === right.birthtimeMs);
}

function sameManagedSessionBindingFileStat(targetIdentity, stat, options = {}) {
  const actual = normalStatIdentity(stat);
  if (!targetIdentity?.exists || !sameManagedFileObjectIdentity(targetIdentity.stat, actual)) return false;
  if (options.objectOnly === true) return true;
  return targetIdentity.stat.size === actual.size
    && targetIdentity.stat.mtimeMs === actual.mtimeMs
    && targetIdentity.stat.ctimeMs === actual.ctimeMs;
}

function sameManagedSessionBindingTargetIdentity(left, right, options = {}) {
  if (!left || !right || left.exists !== right.exists) return false;
  if (!left.exists) return sameManagedPath(left.target, right.target);
  if (!sameManagedPath(left.target, right.target)
    || !sameManagedPath(left.realPath, right.realPath)
    || !sameManagedFileObjectIdentity(left.stat, right.stat)) return false;
  if (options.objectOnly === true) return true;
  return left.stat.size === right.stat.size
    && left.stat.mtimeMs === right.stat.mtimeMs
    && left.stat.ctimeMs === right.stat.ctimeMs;
}

module.exports = {
  DEFAULT_AGENT_WORKSPACE_DIRECTORY,
  MANAGED_SESSION_DIRECTORY_IDENTITY_KIND,
  MANAGED_SESSION_DIRECTORY_IDENTITY_SCHEMA_VERSION,
  createManagedSessionDirectoryBinding,
  matchesManagedSessionDirectoryBinding,
  readManagedSessionBindingTargetIdentity,
  readManagedSessionDirectoryIdentity,
  sameManagedPath,
  sameManagedSessionBindingFileStat,
  sameManagedSessionBindingTargetIdentity,
  sameManagedSessionDirectoryIdentity,
};
