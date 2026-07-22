export function recheckDefTeamProductsBeforePreparedCandidate({ patches, preparedCandidate }, checkProducts) {
  const checkedPatches = checkProducts({ patches });
  if (!checkedPatches?.ok) {
    return { ok: false, checkedPatches };
  }
  return { ok: true, checkedPatches, preparedCandidate: preparedCandidate || null };
}
