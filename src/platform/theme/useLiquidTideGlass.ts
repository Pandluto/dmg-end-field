import { useEffect, useRef, useState, type RefObject } from 'react';
import type { GlassConfig, LiquidGlass as LiquidGlassInstance } from '@ybouane/liquidglass';
import { readAppTheme, subscribeAppTheme } from './appTheme';

const LIQUID_TIDE_THEME_ID = 'liquid-tide';
const LIQUID_TIDE_GLASS_SELECTOR = '[data-liquid-glass-skill="true"]';

const LIQUID_TIDE_SKILL_GLASS_DEFAULTS: Partial<GlassConfig> = {
  blurAmount: 0.28,
  refraction: 0.82,
  chromAberration: 0.035,
  edgeHighlight: 0.12,
  specular: 0.16,
  fresnel: 0.78,
  distortion: 0.012,
  cornerRadius: 18,
  zRadius: 14,
  opacity: 0.9,
  saturation: 0.08,
  tintStrength: 0.035,
  brightness: -0.04,
  shadowOpacity: 0.22,
  shadowSpread: 8,
  shadowOffsetY: 2,
  floating: false,
  button: true,
  bevelMode: 0,
};

type LiquidTideGlassOptions = {
  elementSignature: string;
  renderSignature: string;
};

function supportsWebGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
  } catch {
    return false;
  }
}

async function waitForCaptureAssets(root: HTMLElement): Promise<void> {
  if (document.fonts) await document.fonts.ready;

  const images = Array.from(root.querySelectorAll('img'));
  await Promise.all(images.map(async (image) => {
    if (!image.complete) {
      await new Promise<void>((resolve) => {
        const finish = () => resolve();
        image.addEventListener('load', finish, { once: true });
        image.addEventListener('error', finish, { once: true });
      });
    }
    try {
      await image.decode();
    } catch {
      // Broken optional artwork should not disable the whole glass engine.
    }
  }));
}

function getGlassElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.children).filter((child): child is HTMLElement => (
    child instanceof HTMLElement
    && child.matches(LIQUID_TIDE_GLASS_SELECTOR)
    && !child.classList.contains('is-browse-dot')
    && !child.classList.contains('is-inspect-mode')
  ));
}

export function useLiquidTideGlass(
  rootRef: RefObject<HTMLDivElement>,
  { elementSignature, renderSignature }: LiquidTideGlassOptions,
): void {
  const instanceRef = useRef<LiquidGlassInstance | null>(null);
  const [theme, setTheme] = useState(readAppTheme);

  useEffect(() => subscribeAppTheme(setTheme), []);

  useEffect(() => {
    const root = rootRef.current;
    let cancelled = false;
    let createdInstance: LiquidGlassInstance | null = null;

    instanceRef.current?.destroy();
    instanceRef.current = null;

    if (!root || theme !== LIQUID_TIDE_THEME_ID) {
      root?.removeAttribute('data-liquid-glass-engine');
      root?.removeAttribute('data-liquid-glass-state');
      return undefined;
    }

    const markAfterScroll = () => instanceRef.current?.markChanged();
    root.addEventListener('scroll', markAfterScroll, { passive: true });
    root.dataset.liquidGlassEngine = '@ybouane/liquidglass';
    root.dataset.liquidGlassState = 'loading';

    const initialize = async () => {
      try {
        if (!supportsWebGl()) throw new Error('WebGL is unavailable');

        await waitForCaptureAssets(root);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        if (cancelled) return;

        const glassElements = getGlassElements(root);
        if (!glassElements.length) {
          root.dataset.liquidGlassState = 'idle';
          return;
        }

        const { LiquidGlass } = await import('@ybouane/liquidglass');
        const instance = await LiquidGlass.init({
          root,
          glassElements,
          defaults: LIQUID_TIDE_SKILL_GLASS_DEFAULTS,
        });

        if (cancelled) {
          instance.destroy();
          return;
        }

        createdInstance = instance;
        instanceRef.current = instance;
        root.dataset.liquidGlassState = 'active';
        instance.markChanged();
      } catch (error) {
        if (cancelled) return;
        root.dataset.liquidGlassState = 'fallback';
        console.warn('[LiquidTide] LiquidGlass initialization failed; using CSS fallback.', error);
      }
    };

    void initialize();

    return () => {
      cancelled = true;
      root.removeEventListener('scroll', markAfterScroll);
      if (createdInstance) createdInstance.destroy();
      if (instanceRef.current === createdInstance) instanceRef.current = null;
      root.removeAttribute('data-liquid-glass-engine');
      root.removeAttribute('data-liquid-glass-state');
    };
  }, [elementSignature, rootRef, theme]);

  useEffect(() => {
    if (theme !== LIQUID_TIDE_THEME_ID) return;
    const frameId = requestAnimationFrame(() => instanceRef.current?.markChanged());
    return () => cancelAnimationFrame(frameId);
  }, [renderSignature, theme]);
}
