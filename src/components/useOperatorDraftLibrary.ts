import { useEffect, useMemo, useRef, useState, type ChangeEvent, type Dispatch, type SetStateAction } from 'react';
import {
  buildDraftLibraryShareFile,
  buildDraftLibraryShareFileName,
  parseDraftLibraryShareFile,
  type DraftLibraryShareFile,
} from '../utils/draftShare';
import {
  DRAFT_STORAGE_KEY,
  LIBRARY_STORAGE_KEY,
  OPERATOR_LIBRARY_SHARE_TYPE,
  buildOrderedDraft,
  cloneDraft,
  copyText,
  createEmptyDraft,
  getNextDraftId,
  normalizeDraft,
  parseImportedDraft,
  reorderDraftStructure,
  validateDraftBuffEffects,
  type OperatorDraft,
} from './operatorDraftPageModel';

interface UseOperatorDraftLibraryOptions {
  draft: OperatorDraft;
  orderedDraft: OperatorDraft;
  selectedHitKey: string | null;
  selectedSkillKey: string | null;
  setDraft: Dispatch<SetStateAction<OperatorDraft>>;
  setMessages: Dispatch<SetStateAction<string[]>>;
  setSelectedHitKey: Dispatch<SetStateAction<string | null>>;
  setSelectedSkillKey: Dispatch<SetStateAction<string | null>>;
  setSkillOrder: Dispatch<SetStateAction<string[]>>;
}

const readLocalDraftLibrary = () => {
  if (typeof window === 'undefined') {
    return {} as Record<string, OperatorDraft>;
  }

  const raw = window.localStorage.getItem(LIBRARY_STORAGE_KEY);
  if (!raw) {
    return {} as Record<string, OperatorDraft>;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([draftId, value]) => {
        try {
          const normalizedDraft = parseImportedDraft(JSON.stringify(value));
          return [[draftId, normalizedDraft] as const];
        } catch {
          return [];
        }
      }),
    );
  } catch {
    return {} as Record<string, OperatorDraft>;
  }
};

const downloadShareFile = (shareFile: DraftLibraryShareFile<OperatorDraft>) => {
  const blob = new Blob([JSON.stringify(shareFile, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = buildDraftLibraryShareFileName(shareFile.label, shareFile.exportedAt);
  link.click();
  window.URL.revokeObjectURL(url);
};

export function useOperatorDraftLibrary({
  draft,
  orderedDraft,
  selectedHitKey,
  selectedSkillKey,
  setDraft,
  setMessages,
  setSelectedHitKey,
  setSelectedSkillKey,
  setSkillOrder,
}: UseOperatorDraftLibraryOptions) {
  const [localDraftIds, setLocalDraftIds] = useState<string[]>([]);
  const [localDraftNames, setLocalDraftNames] = useState<Record<string, string>>({});
  const [selectedLocalDraftId, setSelectedLocalDraftId] = useState('');
  const [selectedDeleteLocalDraftId, setSelectedDeleteLocalDraftId] = useState('');
  const [isExportJsonModalOpen, setIsExportJsonModalOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isDeleteLocalDraftModalOpen, setIsDeleteLocalDraftModalOpen] = useState(false);
  const [isOverwriteDraftModalOpen, setIsOverwriteDraftModalOpen] = useState(false);
  const [isOverwriteProtectionEnabled, setIsOverwriteProtectionEnabled] = useState(true);
  const [loadedLocalDraftId, setLoadedLocalDraftId] = useState<string | null>(null);
  const [shareDraftName, setShareDraftName] = useState('');
  const [exportScope, setExportScope] = useState<'current' | 'all'>('current');
  const [pendingImportShare, setPendingImportShare] = useState<DraftLibraryShareFile<OperatorDraft> | null>(null);
  const shareImportInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const raw = window.localStorage.getItem(LIBRARY_STORAGE_KEY);
    const localDraftIdsFromStorage: string[] = [];
    const localDraftNamesFromStorage: Record<string, string> = {};
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Record<string, OperatorDraft>;
        localDraftIdsFromStorage.push(...Object.keys(parsed));
        Object.entries(parsed).forEach(([draftId, localDraft]) => {
          localDraftNamesFromStorage[draftId] = typeof localDraft?.name === 'string' ? localDraft.name : '';
        });
      } catch {
        // Ignore malformed local library entries.
      }
    }
    setLocalDraftIds(localDraftIdsFromStorage);
    setLocalDraftNames(localDraftNamesFromStorage);
    setSelectedLocalDraftId((prev) => (prev && localDraftIdsFromStorage.includes(prev) ? prev : ''));
    setSelectedDeleteLocalDraftId((prev) => (prev && localDraftIdsFromStorage.includes(prev) ? prev : ''));
  }, [draft.id]);

  const getLocalDraftLabel = (draftId: string) => {
    const draftName = localDraftNames[draftId]?.trim();
    return draftName && draftName !== draftId ? `${draftId} · ${draftName}` : draftId;
  };

  const loadDraftIntoEditor = (nextDraft: OperatorDraft, message: string) => {
    const normalizedDraft = normalizeDraft(cloneDraft(nextDraft));
    const nextSkillOrder = Object.keys(normalizedDraft.skills);
    const firstSkillKey = nextSkillOrder[0] ?? null;
    const firstHitKey = firstSkillKey ? Object.keys(normalizedDraft.skills[firstSkillKey].hitMeta)[0] ?? null : null;
    setDraft(buildOrderedDraft(normalizedDraft, nextSkillOrder));
    setSkillOrder(nextSkillOrder);
    setSelectedSkillKey(firstSkillKey);
    setSelectedHitKey(firstHitKey);
    setMessages((prev) => [message, ...prev].slice(0, 12));
  };

  const persistDraftToLibrary = (allowOverwrite: boolean) => {
    const raw = window.localStorage.getItem(LIBRARY_STORAGE_KEY);
    const library = raw ? (JSON.parse(raw) as Record<string, OperatorDraft>) : {};
    if (!orderedDraft.id.trim()) {
      setMessages((prev) => ['[ERR] 干员 ID 不能为空', ...prev].slice(0, 12));
      return false;
    }
    const buffErrors = validateDraftBuffEffects(orderedDraft);
    if (buffErrors.length > 0) {
      setMessages((prev) => [`[ERR] Buff 校验失败：${buffErrors[0]}`, ...prev].slice(0, 12));
      return false;
    }
    if (library[orderedDraft.id] && !allowOverwrite) {
      setIsOverwriteDraftModalOpen(true);
      return false;
    }
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(orderedDraft));
    library[orderedDraft.id] = orderedDraft;
    window.localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(library));
    setLocalDraftIds((prev) => (prev.includes(orderedDraft.id) ? prev : [...prev, orderedDraft.id]));
    setLocalDraftNames((prev) => ({ ...prev, [orderedDraft.id]: orderedDraft.name }));
    setSelectedLocalDraftId('');
    setLoadedLocalDraftId(null);
    setMessages((prev) => [`[OK] 已保存到本地：${orderedDraft.id}`, ...prev].slice(0, 12));
    return true;
  };

  const handleSaveDraft = (options?: { allowOverwriteOnConflict?: boolean }) => {
    persistDraftToLibrary(Boolean(options?.allowOverwriteOnConflict));
  };

  const handleConfirmOverwriteDraft = () => {
    const saved = persistDraftToLibrary(true);
    if (saved) {
      setMessages((prev) => [`[OK] 已覆盖本地干员：${orderedDraft.id}`, ...prev].slice(0, 12));
    }
    setIsOverwriteDraftModalOpen(false);
  };

  const handleCreateNewDraft = () => {
    const nextId = getNextDraftId(localDraftIds);
    loadDraftIntoEditor(createEmptyDraft(nextId), `[OK] 已新建空草稿：${nextId}`);
    setSelectedLocalDraftId('');
    setLoadedLocalDraftId(null);
  };

  const handleSaveAsDraft = () => {
    const nextId = getNextDraftId(localDraftIds);
    loadDraftIntoEditor({ ...orderedDraft, id: nextId }, `[OK] 已另存为新草稿：${nextId}`);
    setSelectedLocalDraftId('');
    setLoadedLocalDraftId(null);
  };

  const handleReorderDraft = () => {
    const { draft: nextDraft, skillKeyMap } = reorderDraftStructure(orderedDraft);
    const nextSkillOrder = Object.keys(nextDraft.skills);
    const nextSelectedSkillKey = selectedSkillKey
      ? skillKeyMap[selectedSkillKey] ?? nextSkillOrder[0] ?? null
      : nextSkillOrder[0] ?? null;
    const nextSelectedHitKey = nextSelectedSkillKey
      ? selectedHitKey && nextDraft.skills[nextSelectedSkillKey].hitMeta[selectedHitKey]
        ? selectedHitKey
        : Object.keys(nextDraft.skills[nextSelectedSkillKey].hitMeta)[0] ?? null
      : null;
    setDraft(buildOrderedDraft(nextDraft, nextSkillOrder));
    setSkillOrder(nextSkillOrder);
    setSelectedSkillKey(nextSelectedSkillKey);
    setSelectedHitKey(nextSelectedHitKey);
    setMessages((prev) => ['[OK] 已整理技能命名与 hit 编号', ...prev].slice(0, 12));
  };

  const currentShareText = useMemo(() => {
    const library = readLocalDraftLibrary();
    let payload: Record<string, OperatorDraft>;
    if (exportScope === 'current') {
      payload = draft.id ? { [draft.id]: draft } : {};
    } else {
      payload = { ...library };
      if (draft.id) {
        payload[draft.id] = draft;
      }
    }
    return JSON.stringify(
      buildDraftLibraryShareFile(
        OPERATOR_LIBRARY_SHARE_TYPE,
        payload,
        exportScope === 'current' ? draft.name || 'operator' : shareDraftName || draft.name || 'operator-library',
      ),
      null,
      2,
    );
  }, [draft, exportScope, shareDraftName]);

  const handleCopyExportJson = async () => {
    await copyText(JSON.stringify(orderedDraft, null, 2));
    setMessages((prev) => ['[OK] 已复制导出 JSON', ...prev].slice(0, 12));
  };

  const handleOpenShareModal = () => {
    setShareDraftName('');
    setPendingImportShare(null);
    setIsShareModalOpen(true);
  };

  const handleCloseShareModal = () => {
    setIsShareModalOpen(false);
    setPendingImportShare(null);
    setShareDraftName('');
    if (shareImportInputRef.current) {
      shareImportInputRef.current.value = '';
    }
  };

  const handleExportLocalLibraryShare = () => {
    const library = readLocalDraftLibrary();
    let payload: Record<string, OperatorDraft>;
    let label: string;
    if (exportScope === 'current') {
      payload = draft.id ? { [draft.id]: draft } : {};
      label = draft.name || 'operator';
    } else {
      payload = { ...library };
      if (draft.id) {
        payload[draft.id] = draft;
      }
      label = shareDraftName || draft.name || 'operator-library';
    }

    const draftCount = Object.keys(payload).length;
    if (draftCount === 0) {
      setMessages((prev) => ['[ERR] 当前无可导出内容', ...prev].slice(0, 12));
      return;
    }
    const shareFile = buildDraftLibraryShareFile(OPERATOR_LIBRARY_SHARE_TYPE, payload, label);
    downloadShareFile(shareFile);
    setMessages((prev) => [
      `[OK] 已导出${exportScope === 'current' ? '当前干员' : '干员库'}分享：${shareFile.label}（${draftCount} 个）`,
      ...prev,
    ].slice(0, 12));
  };

  const handleCopyShareJson = async () => {
    try {
      await navigator.clipboard.writeText(currentShareText);
      setMessages((prev) => ['[OK] 已复制导出 JSON', ...prev].slice(0, 12));
    } catch {
      setMessages((prev) => ['[ERR] 复制失败', ...prev].slice(0, 12));
    }
  };

  const handleShareFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const rawText = await file.text();
    const parsedShare = parseDraftLibraryShareFile(rawText, OPERATOR_LIBRARY_SHARE_TYPE);
    if (!parsedShare) {
      setMessages((prev) => ['[ERR] 导入失败：文件不是有效的干员分享 JSON', ...prev].slice(0, 12));
      event.target.value = '';
      return;
    }
    const normalizedPayload = Object.fromEntries(
      Object.entries(parsedShare.payload).flatMap(([draftId, value]) => {
        try {
          return [[draftId, parseImportedDraft(JSON.stringify(value))] as const];
        } catch {
          return [];
        }
      }),
    ) as Record<string, OperatorDraft>;
    if (Object.keys(normalizedPayload).length === 0) {
      setMessages((prev) => ['[ERR] 导入失败：分享文件内没有有效的干员草稿', ...prev].slice(0, 12));
      event.target.value = '';
      return;
    }
    setPendingImportShare({ ...parsedShare, payload: normalizedPayload });
    event.target.value = '';
  };

  const handleConfirmImportShare = () => {
    if (typeof window === 'undefined' || !pendingImportShare) {
      return;
    }
    const nextLibrary = { ...readLocalDraftLibrary(), ...pendingImportShare.payload };
    const nextIds = Object.keys(nextLibrary);
    window.localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(nextLibrary));
    setLocalDraftIds(nextIds);
    setLocalDraftNames(Object.fromEntries(nextIds.map((draftId) => [draftId, nextLibrary[draftId]?.name || ''])));
    setSelectedLocalDraftId('');
    setSelectedDeleteLocalDraftId((prev) => (prev && nextLibrary[prev] ? prev : ''));
    setIsShareModalOpen(false);
    setShareDraftName('');
    setPendingImportShare(null);
    setMessages((prev) => [
      `[OK] 已导入干员分享：${pendingImportShare.label}（${Object.keys(pendingImportShare.payload).length} 个）`,
      ...prev,
    ].slice(0, 12));
  };

  const handleImportLocalDraft = () => {
    if (typeof window === 'undefined') {
      return;
    }
    const raw = window.localStorage.getItem(LIBRARY_STORAGE_KEY);
    if (!raw) {
      setMessages((prev) => ['[ERR] 本地没有可导入数据', ...prev].slice(0, 12));
      return;
    }
    try {
      const parsed = JSON.parse(raw) as Record<string, OperatorDraft>;
      const localDraft = parsed[selectedLocalDraftId];
      if (!selectedLocalDraftId || !localDraft) {
        setMessages((prev) => ['[ERR] 未找到所选本地干员', ...prev].slice(0, 12));
        return;
      }
      loadDraftIntoEditor(localDraft, `[OK] 已从本地导入：${localDraft.id}`);
      setLoadedLocalDraftId(localDraft.id);
      setSelectedLocalDraftId('');
    } catch {
      setMessages((prev) => ['[ERR] 本地数据损坏，无法导入', ...prev].slice(0, 12));
    }
  };

  const handleOpenLocalLibraryManager = () => {
    setSelectedDeleteLocalDraftId((prev) => (prev && localDraftIds.includes(prev) ? prev : localDraftIds[0] ?? ''));
    setIsDeleteLocalDraftModalOpen(true);
  };

  const handleDeleteLocalDraft = () => {
    if (typeof window === 'undefined' || !selectedDeleteLocalDraftId) {
      setMessages((prev) => ['[ERR] 请选择要删除的本地干员', ...prev].slice(0, 12));
      return;
    }
    const raw = window.localStorage.getItem(LIBRARY_STORAGE_KEY);
    if (!raw) {
      setMessages((prev) => ['[ERR] 本地没有可删除数据', ...prev].slice(0, 12));
      setIsDeleteLocalDraftModalOpen(false);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as Record<string, OperatorDraft>;
      const deleteId = selectedDeleteLocalDraftId;
      if (!parsed[deleteId]) {
        setMessages((prev) => ['[ERR] 未找到所选本地干员', ...prev].slice(0, 12));
        setIsDeleteLocalDraftModalOpen(false);
        return;
      }
      delete parsed[deleteId];
      window.localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(parsed));
      const nextIds = Object.keys(parsed);
      setLocalDraftIds(nextIds);
      setLocalDraftNames(Object.fromEntries(nextIds.map((draftId) => [draftId, parsed[draftId]?.name || ''])));
      setSelectedLocalDraftId((prev) => (prev === deleteId ? '' : prev));
      setSelectedDeleteLocalDraftId(nextIds[0] ?? '');
      if (loadedLocalDraftId === deleteId) {
        setLoadedLocalDraftId(null);
      }
      setMessages((prev) => [`[OK] 已删除本地干员：${deleteId}`, ...prev].slice(0, 12));
    } catch {
      setMessages((prev) => ['[ERR] 本地数据损坏，无法删除', ...prev].slice(0, 12));
    } finally {
      setIsDeleteLocalDraftModalOpen(false);
    }
  };

  return {
    library: {
      draftIds: localDraftIds,
      draftNames: localDraftNames,
      getDraftLabel: getLocalDraftLabel,
      selectedDeleteDraftId: selectedDeleteLocalDraftId,
      selectedDraftId: selectedLocalDraftId,
      setSelectedDeleteDraftId: setSelectedDeleteLocalDraftId,
      setSelectedDraftId: setSelectedLocalDraftId,
    },
    dialogs: {
      isDeleteOpen: isDeleteLocalDraftModalOpen,
      isExportOpen: isExportJsonModalOpen,
      isOverwriteOpen: isOverwriteDraftModalOpen,
      isShareOpen: isShareModalOpen,
      setDeleteOpen: setIsDeleteLocalDraftModalOpen,
      setExportOpen: setIsExportJsonModalOpen,
      setOverwriteOpen: setIsOverwriteDraftModalOpen,
    },
    share: {
      currentText: currentShareText,
      exportScope,
      importInputRef: shareImportInputRef,
      name: shareDraftName,
      pendingImport: pendingImportShare,
      setExportScope,
      setName: setShareDraftName,
    },
    preferences: {
      isOverwriteProtectionEnabled,
      setOverwriteProtectionEnabled: setIsOverwriteProtectionEnabled,
    },
    actions: {
      cancelImportShare: () => setPendingImportShare(null),
      closeShare: handleCloseShareModal,
      confirmImportShare: handleConfirmImportShare,
      confirmOverwrite: handleConfirmOverwriteDraft,
      copyExportJson: handleCopyExportJson,
      copyShareJson: handleCopyShareJson,
      createNewDraft: handleCreateNewDraft,
      deleteLocalDraft: handleDeleteLocalDraft,
      exportLocalLibraryShare: handleExportLocalLibraryShare,
      importLocalDraft: handleImportLocalDraft,
      openExportJson: () => setIsExportJsonModalOpen(true),
      openLocalLibraryManager: handleOpenLocalLibraryManager,
      openShare: handleOpenShareModal,
      openShareImportPicker: () => shareImportInputRef.current?.click(),
      reorderDraft: handleReorderDraft,
      saveAsDraft: handleSaveAsDraft,
      saveDraft: handleSaveDraft,
      selectShareFile: handleShareFileSelected,
    },
  };
}
