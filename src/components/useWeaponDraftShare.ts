import { useCallback, useMemo, useRef, useState } from 'react';
import type * as React from 'react';
import {
  buildDraftLibraryShareFile,
  buildDraftLibraryShareFileName,
  parseDraftLibraryShareFile,
  type DraftLibraryShareFile,
} from '../utils/draftShare';
import {
  WEAPON_LIBRARY_SHARE_TYPE,
  normalizeWeaponDraft,
  type RawWeaponDraft,
  type WeaponDraft,
} from './weaponDraftPageModel';

interface UseWeaponDraftShareOptions {
  draft: WeaponDraft;
  localLibrary: Record<string, WeaponDraft>;
  persistLibraryState: (nextLibrary: Record<string, WeaponDraft>, nextDraft: WeaponDraft, nextSelectedId: string) => void;
  selectedLocalDraftId: string;
}

export function useWeaponDraftShare({
  draft,
  localLibrary,
  persistLibraryState,
  selectedLocalDraftId,
}: UseWeaponDraftShareOptions) {
  const [shareImportError, setShareImportError] = useState('');
  const [shareDraftName] = useState('');
  const [pendingImportShare, setPendingImportShare] = useState<DraftLibraryShareFile<WeaponDraft> | null>(null);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [shareModalMode, setShareModalMode] = useState<'export' | 'import'>('export');
  const [shareImportText, setShareImportText] = useState('');
  const [exportScope, setExportScope] = useState<'current' | 'all'>('current');
  const shareImportInputRef = useRef<HTMLInputElement>(null);

  const currentShareFile = useMemo(() => {
    // 根据导出范围生成 payload
    let payload: Record<string, WeaponDraft>;
    let label: string;
    if (exportScope === 'current') {
      // 导出当前：payload 只包含当前 draft
      payload = draft.id ? { [draft.id]: draft } : {};
      label = draft.name || 'weapon';
    } else {
      // 导出全部：payload 为整个 localLibrary，当前 draft 覆盖同 id 条目
      payload = { ...localLibrary };
      if (draft.id) {
        payload[draft.id] = draft;
      }
      label = shareDraftName || draft.name || 'weapon-library';
    }
    return buildDraftLibraryShareFile(
      WEAPON_LIBRARY_SHARE_TYPE,
      payload,
      label,
    );
  }, [draft, exportScope, localLibrary, shareDraftName]);

  const currentShareText = useMemo(() => JSON.stringify(currentShareFile, null, 2), [currentShareFile]);

  const openShareModal = useCallback((mode: 'export' | 'import') => {
    setShareModalMode(mode);
    setIsShareModalOpen(true);
    setShareImportError('');
    if (mode === 'import') {
      setPendingImportShare(null);
    }
  }, []);

  const closeShareModal = useCallback(() => {
    setIsShareModalOpen(false);
    setShareImportError('');
    setPendingImportShare(null);
  }, []);

  const handleCopyShareJson = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(currentShareText);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = currentShareText;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
  }, [currentShareText]);

  const prepareImportShare = useCallback((rawText: string) => {
    const parsed = parseDraftLibraryShareFile(rawText, WEAPON_LIBRARY_SHARE_TYPE);
    if (!parsed) {
      setPendingImportShare(null);
      setShareImportError('导入失败：文件不是有效的武器库分享 JSON。');
      return;
    }
    const normalizedPayload = Object.fromEntries(
      Object.entries(parsed.payload).map(([draftId, draftValue]) => [draftId, normalizeWeaponDraft({ ...(draftValue as RawWeaponDraft), id: draftId })]),
    ) as Record<string, WeaponDraft>;
    if (Object.keys(normalizedPayload).length === 0) {
      setPendingImportShare(null);
      setShareImportError('JSON 中没有可导入的有效武器。');
      return;
    }
    setShareImportError('');
    setPendingImportShare({
      ...parsed,
      payload: normalizedPayload,
    } as DraftLibraryShareFile<WeaponDraft>);
  }, []);

  const handleExportLocalLibrary = useCallback(() => {
    const blob = new Blob([JSON.stringify(currentShareFile, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = buildDraftLibraryShareFileName(currentShareFile.label, currentShareFile.exportedAt);
    link.click();
    window.URL.revokeObjectURL(url);
  }, [currentShareFile]);

  const handleOpenShareImportPicker = useCallback(() => {
    shareImportInputRef.current?.click();
  }, []);

  const handleParseImportText = useCallback(() => {
    prepareImportShare(shareImportText);
  }, [prepareImportShare, shareImportText]);

  const handleCancelImportShare = useCallback(() => {
    setPendingImportShare(null);
    setShareImportError('');
  }, []);

  const handleShareFileSelected = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const rawText = await file.text();
    setShareImportText(rawText);
    prepareImportShare(rawText);
    event.target.value = '';
  }, [prepareImportShare]);

  const handleConfirmImportShare = useCallback(() => {
    if (!pendingImportShare) {
      return;
    }
    const nextLibrary = {
      ...localLibrary,
      ...pendingImportShare.payload,
    };
    const nextDraftId = Object.keys(pendingImportShare.payload)[0] ?? '';
    const nextDraft = nextDraftId && nextLibrary[nextDraftId]
      ? nextLibrary[nextDraftId]
      : draft;
    persistLibraryState(nextLibrary, nextDraft, nextDraftId || selectedLocalDraftId || draft.id);
    setPendingImportShare(null);
    setShareImportText('');
    setShareImportError('');
    setIsShareModalOpen(false);
  }, [draft, localLibrary, pendingImportShare, persistLibraryState, selectedLocalDraftId]);


  return {
    shareImportError,
    setShareImportError,
    pendingImportShare,
    isShareModalOpen,
    shareModalMode,
    setShareModalMode,
    shareImportText,
    setShareImportText,
    exportScope,
    setExportScope,
    shareImportInputRef,
    currentShareText,
    openShareModal,
    closeShareModal,
    handleCopyShareJson,
    handleExportLocalLibrary,
    handleOpenShareImportPicker,
    handleParseImportText,
    handleCancelImportShare,
    handleShareFileSelected,
    handleConfirmImportShare,
  };
}
