export type LiquidGlassQuality = 'full' | 'balanced' | 'compatibility';

const LIQUID_GLASS_QUALITY_DATASET_KEY = 'liquidGlassQuality';

let webGlSupportPromise: Promise<boolean> | null = null;
let renderQueue: Promise<void> = Promise.resolve();

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
 * The third-party renderer owns one WebGL context per instance. Serialising
 * initialisation keeps route transitions below the browser's global context
 * limit while each fixed lens is rendered and frozen.
 */
export function enqueueLiquidGlassRender<T>(task: () => Promise<T>): Promise<T> {
  const result = renderQueue.then(task, task);
  renderQueue = result.then(() => undefined, () => undefined);
  return result;
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

export async function waitForStableLiquidGlass(delayMs = 96): Promise<void> {
  await new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));
  await new Promise<void>((resolve) => requestAnimationFrame(() => {
    requestAnimationFrame(() => resolve());
  }));
}
