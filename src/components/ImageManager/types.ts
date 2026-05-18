export interface ImageAssetEntry {
  fileName: string;
  baseName: string;
  ext: string;
  relativePath: string;
  writable: boolean;
  sizeBytes: number;
  updatedAt: number;
}

export interface DirGroup {
  topDir: string;
  subDirs: { name: string; count: number }[];
  totalCount: number;
}
