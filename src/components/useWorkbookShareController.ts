import { useCallback, useRef, useState, type ChangeEvent } from 'react';
import type { WorkbookShareMode } from './WorkbookShareDialog';

type WorkbookShareParseResult<T> =
  | { ok: true; shareFile: T }
  | { ok: false; error: string };

export function useWorkbookShareController<T>(
  parseShare: (rawText: string) => WorkbookShareParseResult<T>,
) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<WorkbookShareMode>('export');
  const [importText, setImportTextState] = useState('');
  const [importError, setImportError] = useState('');
  const [pendingImport, setPendingImport] = useState<T | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const prepareImport = useCallback((rawText: string) => {
    const result = parseShare(rawText);
    if (!result.ok) {
      setPendingImport(null);
      setImportError(result.error);
      return;
    }
    setImportError('');
    setPendingImport(result.shareFile);
  }, [parseShare]);

  const open = useCallback((nextMode: WorkbookShareMode) => {
    setMode(nextMode);
    setIsOpen(true);
    setImportError('');
    if (nextMode === 'import') setPendingImport(null);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setImportError('');
    setPendingImport(null);
  }, []);

  const setImportText = useCallback((value: string) => {
    setImportTextState(value);
    setImportError('');
  }, []);

  const pickImportFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const parseImportText = useCallback(() => {
    prepareImport(importText);
  }, [importText, prepareImport]);

  const clearImportPreview = useCallback(() => {
    setPendingImport(null);
    setImportError('');
  }, []);

  const handleImportFileSelected = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const rawText = await file.text();
      setImportTextState(rawText);
      prepareImport(rawText);
    } finally {
      event.target.value = '';
    }
  }, [prepareImport]);

  const completeImport = useCallback(() => {
    setPendingImport(null);
    setImportTextState('');
    setImportError('');
    setIsOpen(false);
  }, []);

  return {
    isOpen,
    mode,
    setMode,
    importText,
    importError,
    pendingImport,
    fileInputRef,
    open,
    close,
    setImportText,
    pickImportFile,
    parseImportText,
    clearImportPreview,
    handleImportFileSelected,
    completeImport,
  };
}
