import { createTimelineRepositoryClient } from '../agentKernel/timelineRepository/localTimelineClient';
import { activateTimelineSession } from '../agentKernel/timelineRepository/timelineSession';
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
}
