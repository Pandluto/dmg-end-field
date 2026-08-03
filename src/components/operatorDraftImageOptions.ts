import type { ImageAssetEntry } from './ImageManager/types';

/** Build the canonical paths offered by the Operator Draft image selectors. */
export function buildOperatorDraftImagePathOptions(assets: ImageAssetEntry[]): string[] {
  const paths = new Set<string>();

  for (const asset of assets) {
    if (asset.kind === 'dir') continue;
    const relativePath = typeof asset.relativePath === 'string' ? asset.relativePath.trim() : '';
    if (!relativePath) continue;
    paths.add(relativePath);
  }

  return [...paths].sort((left, right) => left.localeCompare(right, 'zh-CN', { numeric: true }));
}
