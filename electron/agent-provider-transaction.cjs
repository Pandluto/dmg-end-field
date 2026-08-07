'use strict';

const fsModule = require('node:fs');
const path = require('node:path');
const {
  finalizeAgentProviderProfileSwap,
  readAgentProviderProfile,
  rollbackAgentProviderProfileSwap,
  swapAgentProviderProfile,
  writeAgentProviderProfile,
} = require('./agent-provider-profile.cjs');

class AgentProviderUpdateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AgentProviderUpdateError';
    this.code = code;
    this.statusCode = code === 'AGENT_PROVIDER_UPDATE_BLOCKED' ? 409 : 502;
  }
}

/**
 * Update the desktop Provider profile as a small transaction:
 *
 *   validate/stage -> provider probe -> isolated Host boot -> stop old Host
 *   -> atomic profile swap -> boot real Host -> finalize
 *
 * The old file is never replaced until the candidate Host has started. If the
 * real Host cannot boot with the candidate, the profile and Host are restored
 * before the caller receives an error.
 */
async function updateAgentProviderProfile(options = {}) {
  const fs = options.fs || fsModule;
  const profilePath = path.resolve(String(options.profilePath || ''));
  if (!profilePath || profilePath === path.parse(profilePath).root) {
    throw new AgentProviderUpdateError('AGENT_PROVIDER_UPDATE_INVALID', 'Provider 配置路径无效。');
  }
  const runtime = options.runtime || null;
  const readProfile = options.readProfile || readAgentProviderProfile;
  const writeProfile = options.writeProfile || writeAgentProviderProfile;
  const swapProfile = options.swapProfile || swapAgentProviderProfile;
  const rollbackProfile = options.rollbackProfile || rollbackAgentProviderProfileSwap;
  const finalizeProfile = options.finalizeProfile || finalizeAgentProviderProfileSwap;
  const probeProfile = options.probeProfile;
  const createCandidateRuntime = options.createCandidateRuntime;
  if (typeof probeProfile !== 'function' || typeof createCandidateRuntime !== 'function') {
    throw new TypeError('Provider 更新事务缺少候选验证器。');
  }

  const current = readProfile(profilePath, { fs, includeSecret: true });
  const payload = options.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AgentProviderUpdateError('AGENT_PROVIDER_UPDATE_INVALID', 'Provider 配置内容无效。');
  }

  const apiKey = typeof payload.apiKey === 'string' && payload.apiKey.trim()
    ? payload.apiKey.trim()
    : current?.apiKey || '';
  const candidateRoot = fs.mkdtempSync(path.join(path.dirname(profilePath), '.def-agent-provider-'));
  const candidatePath = path.join(candidateRoot, 'provider-profiles.json');
  let candidateRuntime = null;
  let swap = null;
  let runtimeStopped = false;
  let commitAttempted = false;
  let realRuntimeLoadedCandidate = false;
  let providerUpdateLease = null;
  const wasRunning = Boolean(runtime?.state?.().running);
  try {
    if (runtime && typeof runtime.beginProviderUpdate === 'function') {
      const gate = runtime.beginProviderUpdate();
      if (!gate || gate.allowed !== true || !gate.lease) {
        throw new AgentProviderUpdateError(
          gate?.code || 'AGENT_PROVIDER_UPDATE_BLOCKED',
          gate?.reason || '当前 Agent Turn 尚未结束，请先处理或停止当前 Turn。',
        );
      }
      providerUpdateLease = gate.lease;
    } else {
      const safety = runtime && typeof runtime.getProviderUpdateSafety === 'function'
        ? runtime.getProviderUpdateSafety()
        : { allowed: true };
      if (!safety || safety.allowed !== true) {
        throw new AgentProviderUpdateError(
          safety?.code || 'AGENT_PROVIDER_UPDATE_BLOCKED',
          safety?.reason || '当前 Agent Turn 尚未结束，请先处理或停止当前 Turn。',
        );
      }
    }

    const candidate = writeProfile(candidatePath, {
      ref: payload.ref || current?.ref,
      providerId: payload.providerId || current?.providerId,
      displayName: payload.displayName || current?.displayName,
      baseUrl: payload.baseUrl || current?.baseUrl,
      modelId: payload.modelId || current?.modelId,
      apiKey,
    }, { fs });
    const stagedSecretProfile = readProfile(candidatePath, { fs, includeSecret: true });
    if (sameProfile(current, stagedSecretProfile)) {
      const runtimeState = runtime ? await ensureRuntimeReady(runtime) : null;
      return {
        profile: readProfile(profilePath, { fs }),
        runtime: runtimeState,
        changed: false,
      };
    }

    await probeProfile(candidatePath);
    candidateRuntime = await createCandidateRuntime({
      candidateProfilePath: candidatePath,
      candidateRoot,
    });
    if (!candidateRuntime || typeof candidateRuntime.start !== 'function') {
      throw new AgentProviderUpdateError('AGENT_PROVIDER_CANDIDATE_INVALID', '候选 Agent Host 无效。');
    }
    const candidateState = await ensureRuntimeReady(candidateRuntime);
    if (!candidateState.ready) {
      throw new AgentProviderUpdateError('AGENT_PROVIDER_CANDIDATE_FAILED', '候选 Provider 无法启动 Agent Host，配置未提交。');
    }
    await stopRuntime(candidateRuntime);
    candidateRuntime = null;

    if (!providerUpdateLease) {
      const secondSafety = runtime && typeof runtime.getProviderUpdateSafety === 'function'
        ? runtime.getProviderUpdateSafety()
        : { allowed: true };
      if (!secondSafety || secondSafety.allowed !== true) {
        throw new AgentProviderUpdateError(
          secondSafety?.code || 'AGENT_PROVIDER_UPDATE_BLOCKED',
          secondSafety?.reason || 'Provider 更新期间出现了新的活动 Turn，配置未提交。',
        );
      }
    }

    if (runtime && wasRunning) {
      runtimeStopped = true;
      await stopRuntime(runtime);
    }
    commitAttempted = true;
    swap = swapProfile(candidatePath, profilePath, { fs });
    if (runtime) realRuntimeLoadedCandidate = true;
    const runtimeState = runtime ? await ensureRuntimeReady(runtime) : null;
    if (runtime && (!runtimeState || !runtimeState.ready)) {
      throw new AgentProviderUpdateError('AGENT_PROVIDER_RESTART_FAILED', '新 Provider 无法启动 Agent Host。');
    }
    finalizeProfile(swap, { fs });
    swap = null;
    return {
      profile: readProfile(profilePath, { fs }),
      runtime: runtimeState,
      changed: true,
    };
  } catch (error) {
    const original = toUpdateError(error);
    let rollbackError = null;
    if (runtime && realRuntimeLoadedCandidate) {
      try {
        await stopRuntime(runtime);
      } catch {
        rollbackError = new AgentProviderUpdateError(
          'AGENT_PROVIDER_ROLLBACK_FAILED',
          'Provider 更新失败，旧 Agent Host 未能停止，无法安全恢复。',
        );
      }
    }
    if (swap) {
      try {
        rollbackProfile(swap, { fs });
        swap = null;
      } catch {
        rollbackError = new AgentProviderUpdateError(
          'AGENT_PROVIDER_ROLLBACK_FAILED',
          'Provider 更新失败，旧配置无法自动恢复，请勿继续启动 Agent。',
        );
      }
    }
    if (runtime && (runtimeStopped || realRuntimeLoadedCandidate)) {
      try {
        const restored = await ensureRuntimeReady(runtime);
        if (!restored.ready && !rollbackError) {
          rollbackError = new AgentProviderUpdateError(
            'AGENT_PROVIDER_ROLLBACK_FAILED',
            'Provider 更新失败，旧 Agent Host 未能恢复。',
          );
        }
      } catch {
        if (!rollbackError) {
          rollbackError = new AgentProviderUpdateError(
            'AGENT_PROVIDER_ROLLBACK_FAILED',
            'Provider 更新失败，旧 Agent Host 未能恢复。',
          );
        }
      }
    }
    throw rollbackError || original;
  } finally {
    if (candidateRuntime) await stopRuntime(candidateRuntime).catch(() => undefined);
    if (providerUpdateLease && runtime && typeof runtime.endProviderUpdate === 'function') {
      runtime.endProviderUpdate(providerUpdateLease);
    }
    fs.rmSync(candidateRoot, { recursive: true, force: true });
  }
}

async function ensureRuntimeReady(runtime) {
  const state = await runtime.start();
  return state || (typeof runtime.state === 'function' ? runtime.state() : null);
}

async function stopRuntime(runtime) {
  if (runtime && typeof runtime.stop === 'function') await runtime.stop();
}

function sameProfile(left, right) {
  if (!left || !right) return false;
  return left.ref === right.ref
    && left.providerId === right.providerId
    && left.displayName === right.displayName
    && left.baseUrl === right.baseUrl
    && left.modelId === right.modelId
    && left.apiKey === right.apiKey;
}

function toUpdateError(error) {
  if (error instanceof AgentProviderUpdateError) return error;
  const code = typeof error?.code === 'string' && /^AGENT_PROVIDER_[A-Z0-9_]+$/u.test(error.code)
    ? error.code
    : 'AGENT_PROVIDER_UPDATE_FAILED';
  // Do not forward arbitrary provider/runtime messages: a third-party error
  // body may contain an Authorization header, request URL, or API key.
  return new AgentProviderUpdateError(code, 'Provider 更新失败，旧配置仍在使用。');
}

module.exports = {
  AgentProviderUpdateError,
  updateAgentProviderProfile,
};
