function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function mergePreparedOperatorPayload(targetPayload, preparedPayload, characterId) {
  const next = structuredClone(targetPayload);
  for (const key of ['operatorConfigPageCache', 'characterInputMap']) {
    const preparedValue = preparedPayload?.[key]?.[characterId];
    if (preparedValue === undefined) continue;
    next[key] = { ...(next[key] || {}), [characterId]: structuredClone(preparedValue) };
  }
  return next;
}

export function matchesAtomicTeamCandidateCapability(input, candidate) {
  return Boolean(candidate
    && input?.candidateNodeId === candidate.nodeId
    && Number(input?.candidateRevision) === Number(candidate.nodeRevision)
    && input?.candidateWorkingHash === candidate.workingHash
    && input?.parentNodeId === candidate.parentNodeId
    && Number(input?.parentRevision) === Number(candidate.parentRevision)
    && input?.parentWorkingHash === candidate.parentWorkingHash);
}

/**
 * Build every exact role patch against the same immutable parent, then invoke
 * createCandidate exactly once. A preview failure returns no candidate payload
 * and never calls createCandidate, so callers cannot accidentally persist a
 * partially assembled team branch.
 */
export async function prepareAtomicTeamCandidate({
  parentPayload,
  parentNodeId,
  parentRevision,
  patches,
  previewPatch,
  createCandidate,
}) {
  if (!isRecord(parentPayload) || !Array.isArray(patches) || patches.length === 0
    || typeof previewPatch !== 'function' || typeof createCandidate !== 'function') {
    return { ok: false, code: 'invalid-atomic-team-candidate-input', currentCheckoutTouched: false };
  }
  let candidatePayload = structuredClone(parentPayload);
  const finalConfigs = [];
  const previewEvidence = [];
  const characterIds = new Set();
  for (let index = 0; index < patches.length; index += 1) {
    const patch = patches[index];
    let preview;
    try {
      preview = await previewPatch(patch, index);
    } catch (error) {
      return { ok: false, code: 'team-loadout-preview-failed', failedIndex: index, error: error instanceof Error ? error.message : String(error), currentCheckoutTouched: false };
    }
    const characterId = typeof preview?.finalConfig?.characterId === 'string' ? preview.finalConfig.characterId.trim() : '';
    if (!preview?.ok || !isRecord(preview.preparedPayload) || !isRecord(preview.finalConfig)
      || preview.parentNodeId !== parentNodeId || Number(preview.parentRevision) !== Number(parentRevision)
      || !characterId || characterIds.has(characterId)) {
      return { ok: false, code: preview?.code || 'team-loadout-preview-failed', failedIndex: index, evidence: preview?.evidence, currentCheckoutTouched: false };
    }
    characterIds.add(characterId);
    candidatePayload = mergePreparedOperatorPayload(candidatePayload, preview.preparedPayload, characterId);
    finalConfigs.push(structuredClone(preview.finalConfig));
    previewEvidence.push(preview.evidence || { characterId });
  }
  let candidate;
  try {
    candidate = await createCandidate({ candidatePayload, finalConfigs, previewEvidence });
  } catch (error) {
    return { ok: false, code: 'team-loadout-child-create-failed', error: error instanceof Error ? error.message : String(error), currentCheckoutTouched: false };
  }
  if (!candidate?.ok) {
    return { ok: false, code: candidate?.code || 'team-loadout-child-create-failed', currentCheckoutTouched: false };
  }
  return { ok: true, candidatePayload, finalConfigs, previewEvidence, candidate: candidate.value };
}
