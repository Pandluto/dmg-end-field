import packageMetadata from '../../../package.json';

export const APP_VERSION = packageMetadata.version;

export function formatVersionLabel(version: string): string {
  const normalized = version.trim();
  return normalized.toLowerCase().startsWith('v') ? normalized : `v${normalized}`;
}

export const APP_VERSION_LABEL = formatVersionLabel(APP_VERSION);
