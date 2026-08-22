import { createTimelineRepositoryClient } from '../agentKernel/timelineRepository/localTimelineClient';
import {
  activateTimelineSession,
  getTimelineSessionSnapshot,
} from '../agentKernel/timelineRepository/timelineSession';
import { saveTimelineCheckpoint } from '../core/services/timelineCheckpointService';
import {
  buildTimelineBundleV2,
  getCurrentTimelineSnapshotPayload,
  type TimelineBundleV2,
  type TimelineSnapshotEntry,
  type TimelineSnapshotPayload,
} from '../utils/timelineSnapshotStorage';

function snapshotSummary(payload: TimelineSnapshotPayload) {
  return {
    characterCount: payload.selectedCharacters.length,
    buttonCount: Object.keys(payload.skillButtonTable).length,
    buffCount: payload.allBuffList.length,
  };
}

function payloadButtonCount(payload: TimelineSnapshotPayload): number {
  return Object.keys(payload.skillButtonTable).length;
}

async function checkpointCurrentWorkspaceBeforeImport(): Promise<string | null> {
  const payload = getCurrentTimelineSnapshotPayload();
  if (!payload) return null;

  const session = getTimelineSessionSnapshot();
  const repository = createTimelineRepositoryClient();
  const document = (await repository.listDocuments())
    .find((candidate) => candidate.id === session.activeTimelineId);

  if (document) {
    const exported = await repository.exportDocumentBundle(document.id);
    const checkout = exported.checkoutRef;
    const checkoutPayload = checkout?.targetType === 'work-node'
      ? exported.workNodes.find((node) => node.id === checkout.targetId)?.workingPayload
      : checkout?.targetType === 'snapshot'
        ? exported.snapshots.find((snapshot) => snapshot.id === checkout.targetId)?.payload
        : null;

    if (
      checkoutPayload
      && JSON.stringify(checkoutPayload.selectedCharacters) !== JSON.stringify(payload.selectedCharacters)
    ) {
      throw new Error('当前页面投影与 SQLite checkout 的干员不一致，为防止覆盖已有工作区，本次导入已取消。');
    }
    if (
      checkoutPayload
      && payloadButtonCount(checkoutPayload) > 0
      && payloadButtonCount(payload) === 0
    ) {
      throw new Error('检测到当前页面投影突然变为空排轴，但 SQLite checkout 仍有内容。未写入空白自动存档，请返回工作台确认后再导入。');
    }
  }

  await saveTimelineCheckpoint({
    timelineId: session.activeTimelineId,
    timelineLabel: session.activeTimelineLabel,
    payload,
    reason: '在导入战术分享前，自动保存当前工作区。',
  });
  return session.activeTimelineId;
}

export async function buildDesktopWorktreeShareBundle(input: {
  timelineId: string;
  label: string;
  presentedPayload?: TimelineSnapshotPayload | null;
}): Promise<TimelineBundleV2> {
  const repository = createTimelineRepositoryClient();
  const exported = await repository.exportDocumentBundle(input.timelineId);
  const presentedPayload = input.presentedPayload ?? getCurrentTimelineSnapshotPayload();
  const checkout = exported.checkoutRef;
  let snapshots = exported.snapshots.flatMap((snapshot): TimelineSnapshotEntry[] => {
    if (!snapshot.payload) return [];
    const payload = (
      presentedPayload
      && checkout?.targetType === 'snapshot'
      && checkout.targetId === snapshot.id
    ) ? presentedPayload : snapshot.payload;
    return [{
      id: snapshot.id,
      label: snapshot.label,
      createdAt: snapshot.createdAt,
      summary: snapshotSummary(payload),
      payload,
    }];
  });
  const workNodes = exported.workNodes.map((node) => (
    presentedPayload
    && checkout?.targetType === 'work-node'
    && checkout.targetId === node.id
      ? { ...node, workingPayload: presentedPayload }
      : node
  ));

  if (snapshots.length === 0) {
    if (!presentedPayload) throw new Error('当前 SQLite 工作区没有可分享的恢复节点。');
    snapshots = [{
      id: `${input.timelineId}-share-snapshot`,
      label: input.label,
      createdAt: Date.now(),
      summary: snapshotSummary(presentedPayload),
      payload: presentedPayload,
    }];
  }

  const hasCheckout = Boolean(checkout && (
    checkout.targetType === 'snapshot'
      ? snapshots.some((snapshot) => snapshot.id === checkout.targetId)
      : workNodes.some((node) => node.id === checkout.targetId)
  ));
  const resolvedCheckout = hasCheckout && checkout
    ? {
      targetType: checkout.targetType,
      targetId: checkout.targetId,
      updatedAt: checkout.updatedAt,
    }
    : {
      targetType: 'snapshot' as const,
      targetId: snapshots[0].id,
      updatedAt: snapshots[0].createdAt,
    };

  return buildTimelineBundleV2({
    timelineId: input.timelineId,
    label: input.label,
    snapshot: snapshots[0],
    snapshots,
    ...(workNodes.length ? { workNodes } : {}),
    ...(exported.commits.length ? { commits: exported.commits } : {}),
    checkoutRef: resolvedCheckout,
    scope: 'document',
  });
}

export async function importTacticalShareIntoDesktop(input: {
  shareId: string;
  source: 'mobile' | 'desktop';
  label: string;
  bundle: TimelineBundleV2;
}) {
  const repository = createTimelineRepositoryClient();
  const previousTimelineId = await checkpointCurrentWorkspaceBeforeImport();
  try {
    const imported = await repository.importLegacyTimelineBundle({
      bundle: input.bundle,
      sourceName: `tactical-share-${input.shareId}`,
      dedupeByBundle: input.source === 'desktop',
    });
    const converted = await repository.convertTimelineArchive({
      source: 'local',
      archiveId: imported.archive.archiveId,
      payloadOnly: input.source === 'mobile',
      label: input.label,
      updatedAt: Date.now(),
    });
    activateTimelineSession({
      document: converted.document,
      checkoutRef: converted.checkoutRef,
      workingPayload: converted.payload,
    });
    return { imported, converted };
  } catch (error) {
    if (!previousTimelineId) throw error;
    try {
      const restored = await repository.applySqliteWorkspace(previousTimelineId, Date.now());
      activateTimelineSession({
        document: restored.document,
        checkoutRef: restored.checkoutRef,
        workingPayload: restored.payload,
      });
    } catch (restoreError) {
      const cause = error instanceof Error ? error.message : String(error);
      const restoreCause = restoreError instanceof Error ? restoreError.message : String(restoreError);
      throw new Error(`${cause}；原工作区自动恢复失败：${restoreCause}`);
    }
    throw error;
  }
}
