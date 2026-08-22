import { useCallback, useEffect, useRef } from 'react';
import { listLocalDataPackages } from '../data/localDataPackages';
import { fetchImagePackageManifest, readInstalledImagePackage } from '../resources/imagePackage';
import {
  fetchResourcePackageManifest,
  readInstalledResourcePackage,
} from '../resources/resourcePackage';
import { formatNotificationVersionLabel } from './notificationFormat';
import { useNotificationCenter } from './NotificationCenterProvider';

const RESOURCE_CHECK_INTERVAL_MS = 30 * 60 * 1_000;
const RESOURCE_STATUS_EVENT = 'dmg-resource-status-changed';
const OFFICIAL_PACKAGE_PREFIX = 'web-lts-official-';

function officialPackageLabel(version: string): string {
  return formatNotificationVersionLabel(version);
}

export function useResourceStatusNotifications(): void {
  const { ready, notify, markKindRead } = useNotificationCenter();
  const checkingRef = useRef(false);
  const announcedRef = useRef<Set<string>>(new Set());
  const dataDownloadPendingRef = useRef(false);
  const imageDownloadPendingRef = useRef(false);
  const dataApplyPendingRef = useRef(false);

  const announce = useCallback(async (
    key: string,
    input: Parameters<typeof notify>[0],
  ) => {
    if (announcedRef.current.has(key)) return;
    announcedRef.current.add(key);
    await notify(input);
  }, [notify]);

  const resolveKind = useCallback(async (kind: 'data-download' | 'image-download' | 'data-apply') => {
    const prefix = `${kind}:`;
    for (const key of announcedRef.current) {
      if (key.startsWith(prefix)) announcedRef.current.delete(key);
    }
    await markKindRead(kind);
  }, [markKindRead]);

  const check = useCallback(async () => {
    if (checkingRef.current || !ready) return;
    checkingRef.current = true;
    try {
      const [
        installedData,
        installedImages,
        latestDataManifest,
        latestImageManifest,
        sharePackages,
      ] = await Promise.all([
        readInstalledResourcePackage(),
        readInstalledImagePackage(),
        fetchResourcePackageManifest({ fresh: true }).catch(() => null),
        fetchImagePackageManifest({ fresh: true }).catch(() => null),
        listLocalDataPackages('share').catch(() => []),
      ]);

      const dataUpdateAvailable = Boolean(
        installedData
        && latestDataManifest
        && installedData.version !== latestDataManifest.version,
      );
      const imageUpdateAvailable = Boolean(
        installedImages
        && latestImageManifest
        && installedImages.version !== latestImageManifest.version,
      );
      const officialPackages = sharePackages
        .filter((item) => item.packageId.startsWith(OFFICIAL_PACKAGE_PREFIX))
        .sort((left, right) => right.dataVersion.localeCompare(left.dataVersion));
      const latestOfficialPackage = officialPackages[0] || null;
      const applyPending = Boolean(
        installedData
        && latestOfficialPackage
        && !latestOfficialPackage.active
        && latestOfficialPackage.dataVersion === installedData.version,
      );

      if (dataUpdateAvailable && latestDataManifest) {
        await announce(
          `data-download:${latestDataManifest.version}`,
          {
            dedupeKey: `data-download:${latestDataManifest.version}`,
            kind: 'data-download',
            severity: 'info',
            title: `资料有新版本 ${officialPackageLabel(latestDataManifest.version)}`,
            body: `已下载 ${officialPackageLabel(installedData?.version || '')}，服务器最新为 `
              + `${officialPackageLabel(latestDataManifest.version)}。`,
            action: { label: '去数据页', handlerKey: 'data-workspace' },
          },
        );
        dataDownloadPendingRef.current = true;
      } else {
        if (dataDownloadPendingRef.current) {
          dataDownloadPendingRef.current = false;
          await resolveKind('data-download');
        }
      }

      if (imageUpdateAvailable && latestImageManifest) {
        await announce(
          `image-download:${latestImageManifest.version}`,
          {
            dedupeKey: `image-download:${latestImageManifest.version}`,
            kind: 'image-download',
            severity: 'info',
            title: `图片资源有新版本 ${officialPackageLabel(latestImageManifest.version)}`,
            body: '图片包可在数据页与资料一起更新。',
            action: { label: '去数据页', handlerKey: 'data-workspace' },
          },
        );
        imageDownloadPendingRef.current = true;
      } else {
        if (imageDownloadPendingRef.current) {
          imageDownloadPendingRef.current = false;
          await resolveKind('image-download');
        }
      }

      if (applyPending && latestOfficialPackage) {
        await announce(
          `data-apply:${latestOfficialPackage.packageId}`,
          {
            dedupeKey: `data-apply:${latestOfficialPackage.packageId}`,
            kind: 'data-apply',
            severity: 'warning',
            title: `已下载资料 ${officialPackageLabel(latestOfficialPackage.dataVersion)} 尚未应用`,
            body: '下载只更新了缓存与 Share Data；工作台仍在用旧的已应用资料。',
            action: { label: '去数据页应用', handlerKey: 'data-workspace' },
          },
        );
        dataApplyPendingRef.current = true;
      } else {
        if (dataApplyPendingRef.current) {
          dataApplyPendingRef.current = false;
          await resolveKind('data-apply');
        }
      }
    } finally {
      checkingRef.current = false;
    }
  }, [announce, ready, resolveKind]);

  useEffect(() => {
    if (!ready) return undefined;
    void check();
    const interval = window.setInterval(() => void check(), RESOURCE_CHECK_INTERVAL_MS);
    const handleOnline = () => void check();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void check();
    };
    const handleResourceStatusChanged = () => void check();
    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener(RESOURCE_STATUS_EVENT, handleResourceStatusChanged);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener(RESOURCE_STATUS_EVENT, handleResourceStatusChanged);
    };
  }, [check, ready]);
}
