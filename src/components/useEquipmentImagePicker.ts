import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { imageBridge } from '../utils/imageBridge';
import {
  buildEquipmentImageOption,
  type EquipmentFormulaBinding,
  type EquipmentImageOption,
  type EquipmentLibrary,
  type EquipmentRow,
} from './equipmentSheetPageModel';

interface UseEquipmentImagePickerOptions {
  formulaBinding: EquipmentFormulaBinding | null;
  library: EquipmentLibrary;
  selectedRow: EquipmentRow | null;
  setFormulaInput: (value: string) => void;
}

export function useEquipmentImagePicker({
  formulaBinding,
  library,
  selectedRow,
  setFormulaInput,
}: UseEquipmentImagePickerOptions) {
  const [imageAssets, setImageAssets] = useState<Awaited<ReturnType<typeof imageBridge.listAssets>>>([]);
  const [imageAssetsLoading, setImageAssetsLoading] = useState(false);
  const [imageAssetsError, setImageAssetsError] = useState('');
  const [equipmentImageQuery, setEquipmentImageQuery] = useState('');
  const [isEquipmentImageDrawerOpen, setIsEquipmentImageDrawerOpen] = useState(false);
  const [equipmentImageLoadFailed, setEquipmentImageLoadFailed] = useState(false);
  const equipmentImageFormulaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setImageAssetsLoading(true);
    setImageAssetsError('');
    imageBridge.listAssets()
      .then((assets) => {
        if (cancelled) return;
        setImageAssets(assets);
      })
      .catch((error) => {
        if (cancelled) return;
        setImageAssets([]);
        setImageAssetsError(error instanceof Error ? error.message : '图片资源加载失败');
      })
      .finally(() => {
        if (!cancelled) setImageAssetsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const previewImageMeta = useMemo(() => {
    if (!selectedRow) {
      return { imgUrl: '', title: '装备配图预览', alt: '装备配图' };
    }
    if (selectedRow.kind === 'set' || selectedRow.kind === 'threePieceBuffHeader' || selectedRow.kind === 'threePieceBuff') {
      const gearSet = library.gearSets[selectedRow.gearSetId];
      return {
        imgUrl: gearSet?.imgUrl?.trim() || '',
        title: gearSet?.imgUrl?.trim() || '套装配图预览',
        alt: gearSet?.name || '套装配图',
      };
    }
    const gearSet = library.gearSets[selectedRow.gearSetId];
    const equipment = gearSet?.equipments[selectedRow.equipmentId];
    return {
      imgUrl: equipment?.imgUrl?.trim() || '',
      title: equipment?.imgUrl?.trim() || '装备配图预览',
      alt: equipment?.name || '装备配图',
    };
  }, [library.gearSets, selectedRow]);

  const equipmentImageOptions = useMemo(
    () => imageAssets.map(buildEquipmentImageOption).filter((option): option is EquipmentImageOption => option !== null),
    [imageAssets],
  );
  const filteredEquipmentImageOptions = useMemo(() => {
    const keyword = equipmentImageQuery.trim().toLowerCase();
    if (!keyword) return equipmentImageOptions;
    return equipmentImageOptions.filter((option) => option.searchText.includes(keyword));
  }, [equipmentImageOptions, equipmentImageQuery]);

  const handleSelectEquipmentImage = useCallback((displayUrl: string) => {
    if (!formulaBinding || formulaBinding.control !== 'image-search-select') return;
    formulaBinding.commit(displayUrl);
    setFormulaInput(displayUrl);
    setEquipmentImageQuery(displayUrl);
    setIsEquipmentImageDrawerOpen(false);
  }, [formulaBinding, setFormulaInput]);

  const handleClearEquipmentImage = useCallback(() => {
    if (!formulaBinding || formulaBinding.control !== 'image-search-select') return;
    formulaBinding.commit('');
    setFormulaInput('');
    setEquipmentImageQuery('');
    setIsEquipmentImageDrawerOpen(false);
  }, [formulaBinding, setFormulaInput]);

  useEffect(() => {
    setEquipmentImageQuery(formulaBinding?.control === 'image-search-select' ? (formulaBinding.value ?? '') : '');
    setIsEquipmentImageDrawerOpen(false);
  }, [formulaBinding?.control, formulaBinding?.key, formulaBinding?.value]);

  useEffect(() => {
    if (!isEquipmentImageDrawerOpen) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      if (!equipmentImageFormulaRef.current?.contains(event.target as Node)) {
        setIsEquipmentImageDrawerOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsEquipmentImageDrawerOpen(false);
    };
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleEscape, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleEscape, true);
    };
  }, [isEquipmentImageDrawerOpen]);

  useEffect(() => {
    setEquipmentImageLoadFailed(false);
  }, [previewImageMeta.imgUrl]);

  return {
    equipmentImageFormulaRef,
    equipmentImageLoadFailed,
    setEquipmentImageLoadFailed,
    equipmentImageQuery,
    setEquipmentImageQuery,
    filteredEquipmentImageOptions,
    handleClearEquipmentImage,
    handleSelectEquipmentImage,
    imageAssetsError,
    imageAssetsLoading,
    isEquipmentImageDrawerOpen,
    setIsEquipmentImageDrawerOpen,
    previewImageMeta,
  };
}
