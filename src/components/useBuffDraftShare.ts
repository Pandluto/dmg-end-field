import { useCallback, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type * as React from 'react';
import { buildDraftLibraryShareFile, buildDraftLibraryShareFileName, parseDraftLibraryShareFile, type DraftLibraryShareFile } from '../utils/draftShare';
import {
  BUFF_LIBRARY_SHARE_TYPE,
  BUFF_LIBRARY_STORAGE_KEY,
  copyText,
  loadLocalBuffLibrary,
  parseImportedBuffDraft,
  normalizeBuffDraftLibrary,
  type BuffDraft,
} from './buffDraftPageModel';

interface Options {
  applyExplorerDefaultCollapse: (library: Record<string, BuffDraft>) => void;
  draft: BuffDraft;
  selectedLocalDraftId: string;
  setDraft: Dispatch<SetStateAction<BuffDraft>>;
  setLocalLibrary: Dispatch<SetStateAction<Record<string, BuffDraft>>>;
  setPendingFocusRowKey: Dispatch<SetStateAction<string | null>>;
  setSelectedLocalDraftId: Dispatch<SetStateAction<string>>;
}

export function useBuffDraftShare(options: Options) {
  const { applyExplorerDefaultCollapse, draft, selectedLocalDraftId, setDraft, setLocalLibrary, setPendingFocusRowKey, setSelectedLocalDraftId } = options;
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [shareModalMode, setShareModalMode] = useState<'export' | 'import'>('export');
  const [shareImportText, setShareImportText] = useState('');
  const [shareImportError, setShareImportError] = useState('');
  const [pendingImportShare, setPendingImportShare] = useState<DraftLibraryShareFile<BuffDraft> | null>(null);
  const shareImportInputRef = useRef<HTMLInputElement>(null);

  const downloadSheetShareFile = useCallback((shareFile: DraftLibraryShareFile<BuffDraft>) => {
    const blob = new Blob([JSON.stringify(shareFile, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = buildDraftLibraryShareFileName(shareFile.label, shareFile.exportedAt);
    link.click();
    window.URL.revokeObjectURL(url);
  }, []);

  const currentSheetShareFile = useMemo(() => buildDraftLibraryShareFile(
    BUFF_LIBRARY_SHARE_TYPE,
    loadLocalBuffLibrary(),
    draft.name || selectedLocalDraftId || 'buff-library',
  ), [draft.name, selectedLocalDraftId]);
  const currentSheetShareText = useMemo(() => JSON.stringify(currentSheetShareFile, null, 2), [currentSheetShareFile]);

  const openSheetShareModal = useCallback((mode: 'export' | 'import') => {
    setShareModalMode(mode);
    setIsShareModalOpen(true);
    setShareImportError('');
    if (mode === 'import') {
      setPendingImportShare(null);
    }
  }, []);

  const closeSheetShareModal = useCallback(() => {
    setIsShareModalOpen(false);
    setShareImportError('');
    setPendingImportShare(null);
  }, []);

  const handleExportSheetLibraryShare = useCallback(() => {
    const library = loadLocalBuffLibrary();
    const draftCount = Object.keys(library).length;
    if (draftCount === 0) {
      return;
    }
    const shareFile = buildDraftLibraryShareFile(
      BUFF_LIBRARY_SHARE_TYPE,
      library,
      draft.name || selectedLocalDraftId || 'buff-library',
    );
    downloadSheetShareFile(shareFile);
  }, [downloadSheetShareFile, draft.name, selectedLocalDraftId]);

  const handleOpenSheetShareImportPicker = useCallback(() => {
    shareImportInputRef.current?.click();
  }, []);

  const prepareSheetImportShare = useCallback((rawText: string) => {
    const parsedShare = parseDraftLibraryShareFile(rawText, BUFF_LIBRARY_SHARE_TYPE);
    if (!parsedShare) {
      setPendingImportShare(null);
      setShareImportError('JSON 无效，或不是 Buff 分享文件。');
      return;
    }
    const normalizedPayload = Object.fromEntries(
      Object.entries(parsedShare.payload).flatMap(([draftId, value]) => {
        try {
          const normalizedDraft = parseImportedBuffDraft(JSON.stringify(value));
          return [[draftId, normalizedDraft] as const];
        } catch {
          return [];
        }
      }),
    ) as Record<string, BuffDraft>;
    if (Object.keys(normalizedPayload).length === 0) {
      setPendingImportShare(null);
      setShareImportError('JSON 中没有可导入的有效 Buff 分组。');
      return;
    }
    setShareImportError('');
    setPendingImportShare({
      ...parsedShare,
      payload: normalizedPayload,
    });
  }, []);

  const handleSheetShareFileSelected = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const rawText = await file.text();
    setShareImportText(rawText);
    prepareSheetImportShare(rawText);
    event.target.value = '';
  }, [prepareSheetImportShare]);

  const handleParseSheetImportText = useCallback(() => {
    prepareSheetImportShare(shareImportText);
  }, [prepareSheetImportShare, shareImportText]);

  const handleCopySheetShareJson = useCallback(async () => {
    await copyText(currentSheetShareText);
  }, [currentSheetShareText]);

  const handleCancelSheetImportShare = useCallback(() => {
    setPendingImportShare(null);
    setShareImportError('');
  }, []);

  const handleConfirmSheetImportShare = useCallback(() => {
    if (!pendingImportShare) {
      return;
    }
    const nextLibrary = normalizeBuffDraftLibrary({
      ...loadLocalBuffLibrary(),
      ...pendingImportShare.payload,
    });
    window.localStorage.setItem(BUFF_LIBRARY_STORAGE_KEY, JSON.stringify(nextLibrary));
    setLocalLibrary(nextLibrary);
    applyExplorerDefaultCollapse(nextLibrary);
    const nextSelectedId = selectedLocalDraftId && nextLibrary[selectedLocalDraftId]
      ? selectedLocalDraftId
      : (Object.keys(pendingImportShare.payload)[0] ?? Object.keys(nextLibrary)[0] ?? '');
    if (nextSelectedId && nextLibrary[nextSelectedId]) {
      setSelectedLocalDraftId(nextSelectedId);
      setDraft(nextLibrary[nextSelectedId]);
      setPendingFocusRowKey(`group-${nextSelectedId}`);
    }
    setPendingImportShare(null);
    setShareImportText('');
    setShareImportError('');
    setIsShareModalOpen(false);
  }, [applyExplorerDefaultCollapse, pendingImportShare, selectedLocalDraftId]);


  return {
    isShareModalOpen, shareModalMode, setShareModalMode, shareImportText, setShareImportText,
    shareImportError, setShareImportError, pendingImportShare, shareImportInputRef,
    currentSheetShareText, openSheetShareModal, closeSheetShareModal, handleExportSheetLibraryShare,
    handleOpenSheetShareImportPicker, handleSheetShareFileSelected, handleParseSheetImportText,
    handleCopySheetShareJson, handleCancelSheetImportShare, handleConfirmSheetImportShare,
  };
}
