import { useCallback, useMemo, useRef, useState } from 'react';
import type * as React from 'react';
import {
  buildDraftLibraryShareFile,
  buildDraftLibraryShareFileName,
  parseDraftLibraryShareFile,
  type DraftLibraryShareFile,
} from '../utils/draftShare';
import {
  EQUIPMENT_LIBRARY_SHARE_TYPE,
  downloadJson,
  normalizeEquipmentLibrary,
  type EquipmentGearSet,
  type EquipmentLibrary,
  type EquipmentRow,
} from './equipmentSheetPageModel';

interface UseEquipmentSheetShareOptions {
  library: EquipmentLibrary;
  mutateLibrary: (updater: (previous: EquipmentLibrary) => EquipmentLibrary) => void;
  selectedRow: EquipmentRow | null;
  setMessage: (message: string) => void;
}

export function useEquipmentSheetShare({
  library,
  mutateLibrary,
  selectedRow,
  setMessage,
}: UseEquipmentSheetShareOptions) {
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [shareModalMode, setShareModalMode] = useState<'export' | 'import'>('export');
  const [shareImportText, setShareImportText] = useState('');
  const [shareImportError, setShareImportError] = useState('');
  const [pendingImportShare, setPendingImportShare] = useState<DraftLibraryShareFile<EquipmentGearSet> | null>(null);
  const [exportScope, setExportScope] = useState<'current' | 'all'>('current');
  const shareImportInputRef = useRef<HTMLInputElement>(null);

  const currentShareFile = useMemo(() => {
    const payload = exportScope === 'current' && selectedRow?.gearSetId && library.gearSets[selectedRow.gearSetId]
      ? { [selectedRow.gearSetId]: library.gearSets[selectedRow.gearSetId] }
      : library.gearSets;
    return buildDraftLibraryShareFile(EQUIPMENT_LIBRARY_SHARE_TYPE, payload, exportScope === 'current' ? selectedRow?.title : 'equipment-library');
  }, [exportScope, library.gearSets, selectedRow]);
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
    const parsed = parseDraftLibraryShareFile(rawText, EQUIPMENT_LIBRARY_SHARE_TYPE);
    if (!parsed) {
      setPendingImportShare(null);
      setShareImportError('导入失败：文件不是有效的装备库分享 JSON。');
      return;
    }
    const normalizedPayload = normalizeEquipmentLibrary({
      gearSets: parsed.payload,
    }).gearSets;
    if (Object.keys(normalizedPayload).length === 0) {
      setPendingImportShare(null);
      setShareImportError('JSON 中没有可导入的有效套装。');
      return;
    }
    setShareImportError('');
    setPendingImportShare({
      ...parsed,
      payload: normalizedPayload,
    } as DraftLibraryShareFile<EquipmentGearSet>);
  }, []);

  const handleExportLocalLibrary = useCallback(() => {
    downloadJson(buildDraftLibraryShareFileName(currentShareFile.label, currentShareFile.exportedAt), currentShareText);
  }, [currentShareFile.exportedAt, currentShareFile.label, currentShareText]);

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
    event.target.value = '';
    if (!file) return;
    const text = await file.text();
    setShareImportText(text);
    prepareImportShare(text);
  }, [prepareImportShare]);

  const handleConfirmImportShare = useCallback(() => {
    if (!pendingImportShare) return;
    mutateLibrary((previous) => normalizeEquipmentLibrary({
      ...previous,
      gearSets: {
        ...previous.gearSets,
        ...pendingImportShare.payload,
      },
    }));
    setMessage(`已导入 ${Object.keys(pendingImportShare.payload).length} 个套装。`);
    closeShareModal();
  }, [closeShareModal, mutateLibrary, pendingImportShare, setMessage]);

  return {
    isShareModalOpen,
    shareModalMode,
    setShareModalMode,
    shareImportText,
    setShareImportText,
    shareImportError,
    setShareImportError,
    pendingImportShare,
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
