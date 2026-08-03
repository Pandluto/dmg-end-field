export interface EquipmentImagePreviewPresentationInput {
  storedReference: string;
  resolvedUrl: string;
  imageLibraryLoading: boolean;
  loadFailed: boolean;
}

export interface EquipmentImagePreviewPresentation {
  hasStoredImage: boolean;
  imageUrl: string;
  renderImage: boolean;
  showFailure: boolean;
  showEmpty: boolean;
}

export function buildEquipmentImagePreviewPresentation({
  storedReference,
  resolvedUrl,
  imageLibraryLoading,
  loadFailed,
}: EquipmentImagePreviewPresentationInput): EquipmentImagePreviewPresentation {
  const hasStoredImage = storedReference.trim().length > 0;
  const imageUrl = hasStoredImage ? resolvedUrl.trim() : '';
  const renderImage = hasStoredImage && !imageLibraryLoading && imageUrl.length > 0;

  return {
    hasStoredImage,
    imageUrl,
    renderImage,
    showFailure: renderImage && loadFailed,
    showEmpty: !hasStoredImage,
  };
}

export function getEquipmentImageOptionSource(
  source: 'builtin' | 'release' | 'user' | undefined,
): 'builtin' | 'user' {
  return source === 'user' ? 'user' : 'builtin';
}
