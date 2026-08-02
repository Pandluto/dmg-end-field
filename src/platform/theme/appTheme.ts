import { ensureAppThemeAssets } from './themeAssets';

export const APP_THEME_STORAGE_KEY = 'dmg.appearance.theme.v1';
export const APP_THEME_CHANGE_EVENT = 'dmg-theme-change';

export type AppThemeId =
  | 'office-excel'
  | 'apple-midnight'
  | 'apple-warm'
  | 'lieflat-mono'
  | 'liquid-tide';

export type AppThemeOption = {
  id: AppThemeId;
  label: string;
  description: string;
  colorScheme: 'light' | 'dark';
  browserColor: string;
  delivery: 'bundled' | 'on-demand';
};

export const APP_THEME_OPTIONS: readonly AppThemeOption[] = [
  {
    id: 'office-excel',
    label: '明亮白',
    description: '保留当前工作台配色',
    colorScheme: 'light',
    browserColor: '#e9ecea',
    delivery: 'bundled',
  },
  {
    id: 'apple-midnight',
    label: '深色',
    description: '近黑画布、悬浮材质与蓝色交互',
    colorScheme: 'dark',
    browserColor: '#0e0f11',
    delivery: 'on-demand',
  },
  {
    id: 'apple-warm',
    label: '米暖色',
    description: '柔和纸感与暖铜强调色',
    colorScheme: 'light',
    browserColor: '#ebe4d9',
    delivery: 'on-demand',
  },
  {
    id: 'lieflat-mono',
    label: '纸墨',
    description: '纸面、墨线与克制的矿物色',
    colorScheme: 'light',
    browserColor: '#e8e2d6',
    delivery: 'on-demand',
  },
  {
    id: 'liquid-tide',
    label: '潮汐玻璃',
    description: '连续海彩图景与液态玻璃控件',
    colorScheme: 'light',
    browserColor: '#a8b6dc',
    delivery: 'on-demand',
  },
] as const;

export const DEFAULT_APP_THEME: AppThemeId = 'office-excel';
let themeRequestVersion = 0;
let storageSyncInstalled = false;

function isAppThemeId(value: unknown): value is AppThemeId {
  return APP_THEME_OPTIONS.some((option) => option.id === value);
}

function themeOption(theme: AppThemeId): AppThemeOption {
  return APP_THEME_OPTIONS.find((option) => option.id === theme) ?? APP_THEME_OPTIONS[0];
}

export function readAppTheme(): AppThemeId {
  if (typeof window === 'undefined') return DEFAULT_APP_THEME;
  try {
    const stored = window.localStorage.getItem(APP_THEME_STORAGE_KEY);
    return isAppThemeId(stored) ? stored : DEFAULT_APP_THEME;
  } catch {
    return DEFAULT_APP_THEME;
  }
}

export function readAppliedAppTheme(): AppThemeId {
  if (typeof document === 'undefined') return DEFAULT_APP_THEME;
  const applied = document.documentElement.dataset.theme;
  return isAppThemeId(applied) ? applied : DEFAULT_APP_THEME;
}

export function applyAppTheme(theme: AppThemeId): AppThemeId {
  if (typeof document === 'undefined') return theme;
  const option = themeOption(theme);
  document.documentElement.dataset.theme = option.id;
  if (option.id !== 'liquid-tide') {
    delete document.documentElement.dataset.liquidGlassQuality;
  }
  document.documentElement.style.colorScheme = option.colorScheme;
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', option.browserColor);
  document.dispatchEvent(new CustomEvent<AppThemeId>(APP_THEME_CHANGE_EVENT, {
    detail: option.id,
  }));
  return option.id;
}

async function prepareThemeRuntime(theme: AppThemeId): Promise<void> {
  await ensureAppThemeAssets(theme);
  if (theme === 'liquid-tide') {
    const runtime = await import('./liquidGlassRuntime');
    runtime.applyLiquidGlassQuality(true);
  }
}

export async function setAppTheme(theme: AppThemeId): Promise<AppThemeId> {
  const requestVersion = ++themeRequestVersion;
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.themePending = theme;
  }
  try {
    await prepareThemeRuntime(theme);
    if (requestVersion !== themeRequestVersion) return readAppliedAppTheme();
    const applied = applyAppTheme(theme);
    try {
      window.localStorage.setItem(APP_THEME_STORAGE_KEY, applied);
    } catch {
      // The active document can still use the theme when storage is unavailable.
    }
    return applied;
  } finally {
    if (
      requestVersion === themeRequestVersion
      && document.documentElement.dataset.themePending === theme
    ) {
      delete document.documentElement.dataset.themePending;
    }
  }
}

function installThemeStorageSync(): void {
  if (typeof window === 'undefined' || storageSyncInstalled) return;
  storageSyncInstalled = true;
  window.addEventListener('storage', (event) => {
    if (event.key !== APP_THEME_STORAGE_KEY) return;
    const nextTheme = isAppThemeId(event.newValue) ? event.newValue : DEFAULT_APP_THEME;
    const requestVersion = ++themeRequestVersion;
    void prepareThemeRuntime(nextTheme)
      .then(() => {
        if (requestVersion === themeRequestVersion) applyAppTheme(nextTheme);
      })
      .catch(() => {
        if (requestVersion === themeRequestVersion) applyAppTheme(DEFAULT_APP_THEME);
      });
  });
}

export async function initializeAppTheme(): Promise<AppThemeId> {
  installThemeStorageSync();
  const requestedTheme = readAppTheme();
  const requestVersion = themeRequestVersion;
  if (requestedTheme === DEFAULT_APP_THEME) {
    return applyAppTheme(DEFAULT_APP_THEME);
  }
  document.documentElement.dataset.themePending = requestedTheme;
  try {
    await prepareThemeRuntime(requestedTheme);
    if (requestVersion !== themeRequestVersion || readAppTheme() !== requestedTheme) {
      return readAppliedAppTheme();
    }
    return applyAppTheme(requestedTheme);
  } catch {
    if (requestVersion !== themeRequestVersion) return readAppliedAppTheme();
    const activeTheme = applyAppTheme(DEFAULT_APP_THEME);
    try {
      window.localStorage.setItem(APP_THEME_STORAGE_KEY, activeTheme);
    } catch {
      // Continue with the bundled theme when storage is unavailable.
    }
    return activeTheme;
  } finally {
    if (
      requestVersion === themeRequestVersion
      && document.documentElement.dataset.themePending === requestedTheme
    ) {
      delete document.documentElement.dataset.themePending;
    }
  }
}

export function subscribeAppTheme(listener: (theme: AppThemeId) => void): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const handleThemeChange = (event: Event) => {
    listener((event as CustomEvent<AppThemeId>).detail);
  };
  document.addEventListener(APP_THEME_CHANGE_EVENT, handleThemeChange);
  return () => document.removeEventListener(APP_THEME_CHANGE_EVENT, handleThemeChange);
}
