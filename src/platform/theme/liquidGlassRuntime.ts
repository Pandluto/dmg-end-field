export type LiquidGlassQuality = 'full' | 'balanced' | 'compatibility';

const LIQUID_GLASS_QUALITY_DATASET_KEY = 'liquidGlassQuality';

let webGlSupportPromise: Promise<boolean> | null = null;
let liquidGlassModulePromise: Promise<typeof import('@ybouane/liquidglass')> | null = null;
const pendingRenderTasks: Array<() => Promise<void>> = [];
let activeRenderTasks = 0;

function prefersReducedTransparency(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-transparency: reduce)').matches;
}

function isWindowsPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const userAgentData = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const platform = userAgentData.userAgentData?.platform
    ?? navigator.platform
    ?? navigator.userAgent;
  return /windows|win32|win64/i.test(platform);
}

export function readLiquidGlassQuality(): LiquidGlassQuality {
  if (prefersReducedTransparency()) return 'compatibility';
  if (typeof navigator === 'undefined') return 'balanced';

  const device = navigator as Navigator & { deviceMemory?: number };
  const lowMemory = typeof device.deviceMemory === 'number' && device.deviceMemory <= 4;
  const lowConcurrency = typeof navigator.hardwareConcurrency === 'number'
    && navigator.hardwareConcurrency <= 4;
  return isWindowsPlatform() || lowMemory || lowConcurrency ? 'balanced' : 'full';
}

export function applyLiquidGlassQuality(themeActive: boolean): LiquidGlassQuality | null {
  if (typeof document === 'undefined') return null;
  if (!themeActive) {
    delete document.documentElement.dataset[LIQUID_GLASS_QUALITY_DATASET_KEY];
    return null;
  }

  const quality = readLiquidGlassQuality();
  document.documentElement.dataset[LIQUID_GLASS_QUALITY_DATASET_KEY] = quality;
  return quality;
}

function forceCompatibilityQuality(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset[LIQUID_GLASS_QUALITY_DATASET_KEY] = 'compatibility';
}

/**
 * Probe WebGL once for the whole application. The probe rejects software or
 * otherwise major-caveat renderers and explicitly releases its temporary
 * context so it never competes with the real glass renderer budget.
 */
export function supportsEfficientWebGl(): Promise<boolean> {
  if (!webGlSupportPromise) {
    webGlSupportPromise = Promise.resolve().then(() => {
      if (typeof document === 'undefined' || readLiquidGlassQuality() === 'compatibility') {
        return false;
      }

      const canvas = document.createElement('canvas');
      try {
        const options: WebGLContextAttributes = {
          alpha: true,
          antialias: false,
          failIfMajorPerformanceCaveat: true,
          preserveDrawingBuffer: false,
        };
        const context = canvas.getContext('webgl', options)
          ?? canvas.getContext('experimental-webgl', options) as WebGLRenderingContext | null;
        if (!context) return false;
        context.getExtension('WEBGL_lose_context')?.loseContext();
        canvas.width = 0;
        canvas.height = 0;
        return true;
      } catch {
        return false;
      }
    });
  }

  return webGlSupportPromise.then((supported) => {
    if (!supported) forceCompatibilityQuality();
    return supported;
  });
}

/**
 * Load the shader package before a route transition needs it. Theme startup
 * calls this eagerly, while individual hooks reuse the same promise.
 */
export function loadLiquidGlassRenderer(): Promise<typeof import('@ybouane/liquidglass')> {
  if (!liquidGlassModulePromise) {
    liquidGlassModulePromise = import('@ybouane/liquidglass').catch((error) => {
      liquidGlassModulePromise = null;
      throw error;
    });
  }
  return liquidGlassModulePromise;
}

export async function prewarmLiquidGlassRuntime(): Promise<boolean> {
  if (!await supportsEfficientWebGl()) return false;
  await loadLiquidGlassRenderer();
  return true;
}

function getRenderConcurrency(): number {
  const appliedQuality = typeof document === 'undefined'
    ? null
    : document.documentElement.dataset[LIQUID_GLASS_QUALITY_DATASET_KEY];
  const quality = appliedQuality === 'full'
    || appliedQuality === 'balanced'
    || appliedQuality === 'compatibility'
    ? appliedQuality
    : readLiquidGlassQuality();
  return quality === 'full' ? 4 : quality === 'balanced' ? 2 : 1;
}

function drainRenderQueue(): void {
  const concurrency = getRenderConcurrency();
  while (activeRenderTasks < concurrency && pendingRenderTasks.length > 0) {
    const run = pendingRenderTasks.shift();
    if (!run) return;
    activeRenderTasks += 1;
    void run().finally(() => {
      activeRenderTasks -= 1;
      drainRenderQueue();
    });
  }
}

/**
 * The third-party renderer owns one WebGL context per instance. A small
 * quality-aware pool lets one route warm several independent controls in the
 * same visual wave without approaching the browser's global context limit.
 */
export function enqueueLiquidGlassRender<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    pendingRenderTasks.push(async () => {
      try {
        resolve(await task());
      } catch (error) {
        reject(error);
      }
    });
    drainRenderQueue();
  });
}

export function getLiquidGlassRenderDpr(): number {
  if (typeof window === 'undefined') return 1;
  const appliedQuality = document.documentElement.dataset[LIQUID_GLASS_QUALITY_DATASET_KEY];
  const quality = appliedQuality === 'full'
    || appliedQuality === 'balanced'
    || appliedQuality === 'compatibility'
    ? appliedQuality
    : readLiquidGlassQuality();
  const maximum = quality === 'full' ? 2 : quality === 'balanced' ? 1.25 : 1;
  return Math.max(1, Math.min(window.devicePixelRatio || 1, maximum));
}

export function getCanvasMemoryBytes(canvas: HTMLCanvasElement): number {
  return canvas.width * canvas.height * 4;
}

export async function waitForStableLiquidGlass(delayMs?: number): Promise<void> {
  const quality = typeof document === 'undefined'
    ? 'balanced'
    : document.documentElement.dataset[LIQUID_GLASS_QUALITY_DATASET_KEY];
  const settleDelay = delayMs ?? (quality === 'full' ? 48 : 36);
  await new Promise<void>((resolve) => window.setTimeout(resolve, settleDelay));
  await new Promise<void>((resolve) => requestAnimationFrame(() => {
    requestAnimationFrame(() => resolve());
  }));
}
