import type { AppThemeId } from './appTheme';

const LIQUID_TIDE_BACKDROP = '/assets/themes/liquid-tide/anmi-anniversary.jpg';
const loadedThemes = new Set<AppThemeId>(['office-excel']);
const pendingThemes = new Map<AppThemeId, Promise<void>>();

async function loadAlternateThemeFoundation(): Promise<void> {
  await import('../../styles/themes/theme-apple-variants.css');
  await import('../../styles/themes/theme-apple-business-surfaces.css');
}

async function loadThemeFiles(theme: AppThemeId): Promise<void> {
  if (theme === 'office-excel') return;
  if (theme === 'apple-midnight' || theme === 'apple-warm') {
    await loadAlternateThemeFoundation();
    return;
  }
  if (theme === 'lieflat-mono') {
    await loadAlternateThemeFoundation();
    await import('../../styles/themes/theme-lieflat-mono.css');
    return;
  }

  await loadAlternateThemeFoundation();
  const [, runtime, response] = await Promise.all([
    import('../../styles/themes/theme-liquid-tide.css'),
    import('./liquidGlassRuntime'),
    fetch(LIQUID_TIDE_BACKDROP, { cache: 'force-cache' }),
    import('./LiquidTideEffects'),
  ]);
  if (!response.ok) {
    throw new Error(`主题背景下载失败（HTTP ${response.status}）。`);
  }
  await response.blob();
  await runtime.prewarmLiquidGlassRuntime();
}

export function isAppThemeBundled(theme: AppThemeId): boolean {
  return theme === 'office-excel';
}

export function isAppThemeAssetLoaded(theme: AppThemeId): boolean {
  return loadedThemes.has(theme);
}

export async function ensureAppThemeAssets(theme: AppThemeId): Promise<void> {
  if (loadedThemes.has(theme)) return;
  const existing = pendingThemes.get(theme);
  if (existing) return existing;

  const pending = loadThemeFiles(theme)
    .then(() => {
      loadedThemes.add(theme);
    })
    .catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        navigator.onLine
          ? `主题包加载失败：${detail}`
          : '这个主题尚未下载。连接网络后首次选择即可安装。',
      );
    })
    .finally(() => {
      pendingThemes.delete(theme);
    });
  pendingThemes.set(theme, pending);
  return pending;
}
