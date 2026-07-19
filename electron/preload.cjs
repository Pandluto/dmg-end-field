const { contextBridge, ipcRenderer } = require('electron');

const roleArgument = process.argv.find((value) => value.startsWith('--desktop-role='));
const roleFromArgs = roleArgument ? roleArgument.split('=')[1] : 'unknown';
const trustedLegacyFillActions = new Map();
const legacyFillSaveContinuations = new Map();

window.addEventListener('click', (event) => {
  if (!event.isTrusted || !(event.target instanceof Element)) return;
  const button = event.target.closest('[data-legacy-fill-user-action]');
  const action = button?.getAttribute('data-legacy-fill-user-action');
  if (!button || !['confirm', 'approve', 'reject', 'save'].includes(action)) return;
  const token = globalThis.crypto.randomUUID();
  trustedLegacyFillActions.set(token, { action, expiresAt: Date.now() + 2000 });
  button.setAttribute('data-legacy-fill-action-token', token);
  setTimeout(() => {
    button.removeAttribute('data-legacy-fill-action-token');
    trustedLegacyFillActions.delete(token);
  }, 2000);
}, true);

function consumeLegacyFillAction(token, expectedAction) {
  const value = trustedLegacyFillActions.get(token);
  trustedLegacyFillActions.delete(token);
  if (!value || value.action !== expectedAction || value.expiresAt < Date.now()) throw new Error('trusted Legacy Fill product UI action required');
}

contextBridge.exposeInMainWorld('desktopRuntime', {
  isElectron: true,
  platform: process.platform,
  role: roleFromArgs,
  getRole: () => ipcRenderer.invoke('desktop:get-role'),
  getLegacyFillServiceState: () => ipcRenderer.invoke('desktop:get-legacy-fill-service-state'),
  listLegacyFillProposals: () => ipcRenderer.invoke('desktop:list-legacy-fill-proposals'),
  inspectLegacyFillProposal: (payload) => ipcRenderer.invoke('desktop:inspect-legacy-fill-proposal', payload),
  claimLegacyFillProposal: (payload) => ipcRenderer.invoke('desktop:claim-legacy-fill-proposal', payload),
  decideLegacyFillProposal: (payload, trustedActionToken) => {
    consumeLegacyFillAction(trustedActionToken, payload?.decision === 'approved' ? 'approve' : 'reject');
    return ipcRenderer.invoke('desktop:decide-legacy-fill-proposal', payload);
  },
  confirmAndBeginSaveLegacyFillProposal: async (payload, trustedActionToken) => {
    consumeLegacyFillAction(trustedActionToken, 'confirm');
    const decision = payload?.alreadyApproved
      ? { ok: true, proposal: payload.proposal }
      : await ipcRenderer.invoke('desktop:decide-legacy-fill-proposal', { ...payload, decision: 'approved' });
    if (!decision?.ok || !decision?.proposal) return decision;
    const begin = await ipcRenderer.invoke('desktop:begin-save-legacy-fill-proposal', {
      ...payload,
      expectedRevision: decision.proposal.revision,
    });
    if (!begin?.ok || !begin?.proposal || begin.proposal.lifecycleStatus === 'stale') return begin;
    const saveCapability = globalThis.crypto.randomUUID();
    legacyFillSaveContinuations.set(saveCapability, { proposalId: payload?.proposalId, expiresAt: Date.now() + 30000 });
    return { ...begin, approvedProposal: decision.proposal, saveCapability };
  },
  beginSaveLegacyFillProposal: async (payload, trustedActionToken) => {
    consumeLegacyFillAction(trustedActionToken, 'save');
    const response = await ipcRenderer.invoke('desktop:begin-save-legacy-fill-proposal', payload);
    if (!response?.ok || response?.proposal?.lifecycleStatus === 'stale') return response;
    const saveCapability = globalThis.crypto.randomUUID();
    legacyFillSaveContinuations.set(saveCapability, { proposalId: payload?.proposalId, expiresAt: Date.now() + 30000 });
    return { ...response, saveCapability };
  },
  recordSaveLegacyFillProposal: (payload, saveCapability) => {
    const continuation = legacyFillSaveContinuations.get(saveCapability);
    legacyFillSaveContinuations.delete(saveCapability);
    if (!continuation || continuation.proposalId !== payload?.proposalId || continuation.expiresAt < Date.now()) throw new Error('Legacy Fill save continuation is invalid or expired');
    return ipcRenderer.invoke('desktop:record-save-legacy-fill-proposal', payload);
  },
  publishLegacyFillSnapshot: (payload) => ipcRenderer.invoke('desktop:publish-legacy-fill-snapshot', payload),
  getShellState: () => ipcRenderer.invoke('desktop:get-shell-state'),
  getDesktopSettings: () => ipcRenderer.invoke('desktop:get-settings'),
  setDesktopScale: (scaleKey) => ipcRenderer.invoke('desktop:set-scale', scaleKey),
  getImageUpdateState: () => ipcRenderer.invoke('desktop:get-image-update-state'),
  getDataReleaseUpdateState: () => ipcRenderer.invoke('desktop:get-data-release-update-state'),
  getDataManagementState: () => ipcRenderer.invoke('desktop:get-data-management-state'),
  getUserWorkspaceState: () => ipcRenderer.invoke('desktop:get-user-workspace-state'),
  putUserWorkspaceState: (payload) => ipcRenderer.invoke('desktop:put-user-workspace-state', payload),
  restoreUserWorkspaceSnapshot: (payload) => ipcRenderer.invoke('desktop:restore-user-workspace-snapshot', payload),
  migrateBrowserLegacyArchive: (payload) => ipcRenderer.invoke('desktop:migrate-browser-legacy-archive', payload),
  runDataManagementLegacyMigration: () => ipcRenderer.invoke('desktop:run-data-management-legacy-migration'),
  setImageUpdateConfig: (payload) => ipcRenderer.invoke('desktop:set-image-update-config', payload),
  checkImageUpdate: () => ipcRenderer.invoke('desktop:check-image-update'),
  applyImageUpdate: () => ipcRenderer.invoke('desktop:apply-image-update'),
  checkDataReleaseUpdate: () => ipcRenderer.invoke('desktop:check-data-release-update'),
  applyDataReleaseUpdate: () => ipcRenderer.invoke('desktop:apply-data-release-update'),
  forceClearImageUpdate: () => ipcRenderer.invoke('desktop:force-clear-image-update'),
  pickImageReleaseSourceDir: () => ipcRenderer.invoke('desktop:pick-image-release-source-dir'),
  pickImageReleaseOutputDir: () => ipcRenderer.invoke('desktop:pick-image-release-output-dir'),
  buildImageReleasePackage: (payload) => ipcRenderer.invoke('desktop:build-image-release-package', payload),
  pickDataReleaseOutputDir: () => ipcRenderer.invoke('desktop:pick-data-release-output-dir'),
  buildDataReleasePackage: (payload) => ipcRenderer.invoke('desktop:build-data-release-package', payload),
  revealPath: (payload) => ipcRenderer.invoke('desktop:reveal-path', payload),
  quitApp: () => ipcRenderer.invoke('desktop:quit-app'),
  listImageAssets: () => ipcRenderer.invoke('desktop:list-image-assets'),
  importImageAssets: () => ipcRenderer.invoke('desktop:import-image-assets'),
  importImageAssetsToDir: (payload) => ipcRenderer.invoke('desktop:import-image-assets-to-dir', payload),
  renameImageAsset: (payload) => ipcRenderer.invoke('desktop:rename-image-asset', payload),
  renameImageDirectory: (payload) => ipcRenderer.invoke('desktop:rename-image-directory', payload),
  deleteImageAsset: (payload) => ipcRenderer.invoke('desktop:delete-image-asset', payload),
  importImageAssetsFromBrowser: (payload) => ipcRenderer.invoke('desktop:import-image-assets-from-browser', payload),
  createImageDirectory: (payload) => ipcRenderer.invoke('desktop:create-image-directory', payload),
  deleteImageDirectory: (payload) => ipcRenderer.invoke('desktop:delete-image-directory', payload),
  revealInExplorer: (payload) => ipcRenderer.invoke('desktop:reveal-in-explorer', payload),
  readEquipmentLibrary: () => ipcRenderer.invoke('desktop:read-equipment-library'),
  writeEquipmentLibrary: (payload) => ipcRenderer.invoke('desktop:write-equipment-library', payload),
  listLocalDataArchives: () => ipcRenderer.invoke('desktop:list-local-data-archives'),
  saveLocalDataArchive: (payload) => ipcRenderer.invoke('desktop:save-local-data-archive', payload),
  readLocalDataArchive: (payload) => ipcRenderer.invoke('desktop:read-local-data-archive', payload),
  prepareDataPackageApply: (payload) => ipcRenderer.invoke('desktop:prepare-data-package-apply', payload),
  writeSharedArchivesToDataPackage: (payload) => ipcRenderer.invoke('desktop:write-shared-archives-to-data-package', payload),
  deleteLocalDataArchive: (payload) => ipcRenderer.invoke('desktop:delete-local-data-archive', payload),
  revealLocalDataArchive: (payload) => ipcRenderer.invoke('desktop:reveal-local-data-archive', payload),
  listAiTimelineWorkNodes: () => ipcRenderer.invoke('desktop:list-ai-timeline-worknodes'),
  createAiTimelineWorkNode: (payload) => ipcRenderer.invoke('desktop:create-ai-timeline-worknode', payload),
  readAiTimelineWorkNode: (payload) => ipcRenderer.invoke('desktop:read-ai-timeline-worknode', payload),
  diffAiTimelineWorkNode: (payload) => ipcRenderer.invoke('desktop:diff-ai-timeline-worknode', payload),
  updateAiTimelineWorkNode: (payload) => ipcRenderer.invoke('desktop:update-ai-timeline-worknode', payload),
  commitAiTimelineWorkNode: (payload) => ipcRenderer.invoke('desktop:commit-ai-timeline-worknode', payload),
  markAiTimelineWorkNodeCheckoutApplied: (payload) => ipcRenderer.invoke('desktop:mark-ai-timeline-worknode-checkout-applied', payload),
  markAiTimelineWorkNodeRollbackApplied: (payload) => ipcRenderer.invoke('desktop:mark-ai-timeline-worknode-rollback-applied', payload),
  deleteAiTimelineWorkNode: (payload) => ipcRenderer.invoke('desktop:delete-ai-timeline-worknode', payload),
});
