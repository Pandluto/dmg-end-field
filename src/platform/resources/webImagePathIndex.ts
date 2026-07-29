export type WebImagePathSource = 'release' | 'user';

export type WebImageIndexedPath = {
  relativePath: string;
  source: WebImagePathSource;
};

export type WebImageMatchMode =
  | 'exact-path'
  | 'file-name'
  | 'file-stem'
  | 'normalized-name'
  | 'equipment-variant';

export type WebImagePathResolution = {
  canonicalPath: string;
  matchedBy: WebImageMatchMode;
};

type IndexedEntry = WebImageIndexedPath & {
  normalizedPath: string;
  fileName: string;
  stem: string;
};

const LEGACY_IMAGE_HOSTS = new Set([
  '127.0.0.1:31457',
  'localhost:31457',
]);

const IMAGE_EXTENSION_PATTERN = /\.(?:png|jpe?g|webp|gif|svg|ico)$/i;
const EQUIPMENT_VARIANT_PATTERN = /·[壹贰叁肆伍陆柒捌玖拾]型$/;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value
      .split('/')
      .map((segment) => {
        try {
          return decodeURIComponent(segment);
        } catch {
          return segment;
        }
      })
      .join('/');
  }
}

function normalizePath(value: string): string {
  return safeDecode(value)
    .normalize('NFKC')
    .replace(/\\/g, '/')
    .replace(/[?#].*$/, '')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/\/+$/, '');
}

function lookupKey(value: string): string {
  return normalizePath(value).toLocaleLowerCase();
}

function fileNameOf(value: string): string {
  return normalizePath(value).split('/').pop() || '';
}

function stemOf(value: string): string {
  const fileName = fileNameOf(value);
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

function normalizedNameKey(value: string): string {
  return stemOf(value)
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s._·•—–-]+/g, '');
}

function appendToIndex(
  index: Map<string, IndexedEntry[]>,
  key: string,
  entry: IndexedEntry,
): void {
  if (!key) return;
  const entries = index.get(key) || [];
  if (!entries.some((candidate) => candidate.relativePath === entry.relativePath)) {
    entries.push(entry);
    index.set(key, entries);
  }
}

function compareEntries(left: IndexedEntry, right: IndexedEntry): number {
  const sourceDifference = (left.source === 'release' ? 0 : 1)
    - (right.source === 'release' ? 0 : 1);
  if (sourceDifference !== 0) return sourceDifference;
  const depthDifference = left.relativePath.split('/').length
    - right.relativePath.split('/').length;
  if (depthDifference !== 0) return depthDifference;
  return left.relativePath.localeCompare(right.relativePath, 'zh-CN');
}

function unwrapReference(reference: string, sameOrigin?: string): string | null {
  const value = reference.trim();
  if (!value || /^(?:data|blob):/i.test(value)) return null;
  if (/^(?:https?|file):/i.test(value) || value.startsWith('//')) {
    try {
      const base = sameOrigin || 'https://web.invalid/';
      const url = new URL(value, base);
      if (
        (url.protocol === 'http:' || url.protocol === 'https:')
        && !LEGACY_IMAGE_HOSTS.has(url.host)
        && (!sameOrigin || url.origin !== new URL(sameOrigin).origin)
      ) {
        return null;
      }
      return normalizePath(url.pathname);
    } catch {
      return normalizePath(value);
    }
  }
  return normalizePath(value);
}

function looksLikeImageReference(value: string): boolean {
  return IMAGE_EXTENSION_PATTERN.test(value.replace(/[?#].*$/, ''))
    || /^(?:https?:\/\/(?:127\.0\.0\.1|localhost):31457\/|file:)/i.test(value)
    || /^(?:\/?)(?:assets\/avatars|assets\/images|user-images|data\/images|public\/images|images\/(?:character|weapon|img-))/i.test(value);
}

function canonicalDirectoryAliases(value: string): string {
  return value
    .replace(/\/img-weapon\//i, '/img-wepaon/')
    .replace(/\/(?:skill-icons?|skills|skiil-icons?)\//i, '/skiil-icon/');
}

function buildExactCandidates(path: string): string[] {
  const candidates = new Set<string>();
  const add = (value: string) => {
    const normalized = canonicalDirectoryAliases(normalizePath(value));
    if (normalized) candidates.add(normalized);
  };
  const addUnderImages = (value: string) => {
    const relative = normalizePath(value)
      .replace(/^images\//i, '')
      .replace(/^assets\/images\//i, '');
    if (!relative) return;
    add(`assets/images/${relative}`);
    if (/^img-equipment\/(?!icon_cn\/)/i.test(relative)) {
      add(`assets/images/img-equipment/icon_cn/${relative.replace(/^img-equipment\//i, '')}`);
    }
  };

  add(path);
  if (/^assets\/images\//i.test(path)) addUnderImages(path);

  const avatarMatch = path.match(/^assets\/avatars\/([^/]+)\/(.+)$/i);
  if (avatarMatch) {
    const [, operatorName, remainder] = avatarMatch;
    const fileName = fileNameOf(remainder);
    const isAvatar = stemOf(fileName) === operatorName;
    if (isAvatar) add(`assets/images/img-operator/${fileName}`);
    add(`assets/images/img-operator/skiil-icon/${operatorName}/${remainder}`);
    add(`assets/images/img-operator/${operatorName}/${remainder}`);
    if (!isAvatar) add(`assets/images/img-operator/${fileName}`);
  }

  if (/^(?:user-images|data\/images)\//i.test(path)) {
    const relative = path
      .replace(/^(?:user-images|data\/images)\//i, '')
      .replace(/^images\//i, '');
    addUnderImages(relative);
  }

  const withoutPublic = path.replace(/^public\//i, '');
  if (/^images\/weapon\/icon\//i.test(withoutPublic)) {
    add(`assets/images/img-wepaon/${fileNameOf(withoutPublic)}`);
  }
  if (/^images\/character\/charremoteicon\//i.test(withoutPublic)) {
    add(`assets/images/img-operator/${fileNameOf(withoutPublic)}`);
  }
  if (/^images\//i.test(withoutPublic)) addUnderImages(withoutPublic);

  if (/^assets\/(?!images\/)/i.test(path)) {
    addUnderImages(path.replace(/^assets\//i, ''));
  }
  if (!/^assets\//i.test(path) && path.includes('/')) addUnderImages(path);
  return [...candidates];
}

export function createWebImagePathIndex(paths: WebImageIndexedPath[]) {
  const byPath = new Map<string, IndexedEntry[]>();
  const byFileName = new Map<string, IndexedEntry[]>();
  const byStem = new Map<string, IndexedEntry[]>();
  const byNormalizedName = new Map<string, IndexedEntry[]>();

  for (const item of paths) {
    const relativePath = normalizePath(item.relativePath);
    if (!relativePath || !IMAGE_EXTENSION_PATTERN.test(relativePath)) continue;
    const entry: IndexedEntry = {
      relativePath,
      source: item.source,
      normalizedPath: lookupKey(relativePath),
      fileName: fileNameOf(relativePath),
      stem: stemOf(relativePath),
    };
    appendToIndex(byPath, entry.normalizedPath, entry);
    appendToIndex(byFileName, lookupKey(entry.fileName), entry);
    appendToIndex(byStem, lookupKey(entry.stem), entry);
    appendToIndex(byNormalizedName, normalizedNameKey(entry.stem), entry);
  }

  for (const index of [byPath, byFileName, byStem, byNormalizedName]) {
    index.forEach((entries) => entries.sort(compareEntries));
  }

  const first = (
    index: Map<string, IndexedEntry[]>,
    key: string,
  ): IndexedEntry | undefined => index.get(key)?.[0];

  return {
    has(relativePath: string): boolean {
      return byPath.has(lookupKey(relativePath));
    },

    resolve(reference: string, sameOrigin?: string): WebImagePathResolution | null {
      if (!looksLikeImageReference(reference)) return null;
      const path = unwrapReference(reference, sameOrigin);
      if (!path || /(^|\/)\.\.(\/|$)/.test(path)) return null;

      for (const candidate of buildExactCandidates(path)) {
        const matched = first(byPath, lookupKey(candidate));
        if (matched) {
          return { canonicalPath: matched.relativePath, matchedBy: 'exact-path' };
        }
      }

      const fileName = fileNameOf(path);
      const fileMatch = first(byFileName, lookupKey(fileName));
      if (fileMatch) {
        return { canonicalPath: fileMatch.relativePath, matchedBy: 'file-name' };
      }

      const stem = stemOf(fileName);
      const stemMatch = first(byStem, lookupKey(stem));
      if (stemMatch) {
        return { canonicalPath: stemMatch.relativePath, matchedBy: 'file-stem' };
      }

      const normalizedMatch = first(byNormalizedName, normalizedNameKey(stem));
      if (normalizedMatch) {
        return { canonicalPath: normalizedMatch.relativePath, matchedBy: 'normalized-name' };
      }

      const baseEquipmentStem = stem.replace(EQUIPMENT_VARIANT_PATTERN, '');
      if (baseEquipmentStem !== stem) {
        const variantMatch = first(byStem, lookupKey(baseEquipmentStem));
        if (variantMatch) {
          return {
            canonicalPath: variantMatch.relativePath,
            matchedBy: 'equipment-variant',
          };
        }
      }
      return null;
    },
  };
}

export type WebImagePathIndex = ReturnType<typeof createWebImagePathIndex>;
