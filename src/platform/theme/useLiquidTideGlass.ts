import { useEffect, useRef, useState, type RefObject } from 'react';
import type { GlassConfig, LiquidGlass as LiquidGlassInstance } from '@ybouane/liquidglass';
import { readAppTheme, subscribeAppTheme } from './appTheme';

const LIQUID_TIDE_THEME_ID = 'liquid-tide';
const LIQUID_TIDE_GLASS_SELECTOR = '[data-liquid-glass-skill="true"]';
const LIQUID_TIDE_GLASS_CLIP_PROPERTY = '--liquid-glass-composite-clip';

const LIQUID_TIDE_SKILL_GLASS_DEFAULTS: Partial<GlassConfig> = {
  blurAmount: 0.28,
  refraction: 0.82,
  chromAberration: 0.035,
  edgeHighlight: 0.035,
  specular: 0.08,
  fresnel: 0.24,
  distortion: 0.012,
  cornerRadius: 18,
  zRadius: 14,
  opacity: 0.9,
  saturation: 0.08,
  tintStrength: 0.035,
  brightness: -0.04,
  shadowOpacity: 0.1,
  shadowSpread: 4,
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

function formatPathNumber(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function buildCompositeGlassClip(element: HTMLElement): string | null {
  const canvas = element.querySelector(':scope > canvas');
  const orb = element.querySelector<HTMLElement>('.skill-button-orb');
  const base = element.querySelector<HTMLElement>('.skill-button-base');
  if (!(canvas instanceof HTMLCanvasElement) || !orb || !base) return null;

  const canvasRect = canvas.getBoundingClientRect();
  const orbRect = orb.getBoundingClientRect();
  const baseRect = base.getBoundingClientRect();
  if (
    canvasRect.width <= 0
    || canvasRect.height <= 0
    || orbRect.width <= 0
    || orbRect.height <= 0
    || baseRect.width <= 0
    || baseRect.height <= 0
  ) return null;

  const radius = Math.min(orbRect.width, orbRect.height) / 2;
  const centerX = orbRect.left - canvasRect.left + orbRect.width / 2;
  const centerY = orbRect.top - canvasRect.top + orbRect.height / 2;
  const bodyRight = baseRect.right - canvasRect.left;
  const bodyBottom = baseRect.bottom - canvasRect.top;
  const computedRadius = Number.parseFloat(window.getComputedStyle(base).borderTopRightRadius) || 0;
  const bodyRadius = Math.min(computedRadius, baseRect.width / 2, baseRect.height / 2);
  const n = formatPathNumber;

  return `path("${[
    `M ${n(centerX)} ${n(centerY - radius)}`,
    `A ${n(radius)} ${n(radius)} 0 0 1 ${n(centerX + radius)} ${n(centerY)}`,
    `L ${n(bodyRight - bodyRadius)} ${n(centerY)}`,
    `Q ${n(bodyRight)} ${n(centerY)} ${n(bodyRight)} ${n(centerY + bodyRadius)}`,
    `L ${n(bodyRight)} ${n(bodyBottom - bodyRadius)}`,
    `Q ${n(bodyRight)} ${n(bodyBottom)} ${n(bodyRight - bodyRadius)} ${n(bodyBottom)}`,
    `L ${n(centerX)} ${n(bodyBottom)}`,
    `L ${n(centerX)} ${n(centerY + radius)}`,
    `A ${n(radius)} ${n(radius)} 0 1 1 ${n(centerX)} ${n(centerY - radius)}`,
    'Z',
  ].join(' ')}")`;
}

function syncCompositeGlassClips(elements: readonly HTMLElement[]): void {
  elements.forEach((element) => {
    const clip = buildCompositeGlassClip(element);
    if (clip) element.style.setProperty(LIQUID_TIDE_GLASS_CLIP_PROPERTY, clip);
  });
}

function clearCompositeGlassClips(elements: readonly HTMLElement[]): void {
  elements.forEach((element) => element.style.removeProperty(LIQUID_TIDE_GLASS_CLIP_PROPERTY));
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
    let glassElements: HTMLElement[] = [];
    let resizeFrameId = 0;

    instanceRef.current?.destroy();
    instanceRef.current = null;

    if (!root || theme !== LIQUID_TIDE_THEME_ID) {
      root?.removeAttribute('data-liquid-glass-engine');
      root?.removeAttribute('data-liquid-glass-state');
      return undefined;
    }

    const markAfterScroll = () => instanceRef.current?.markChanged();
    const syncAfterResize = () => {
      cancelAnimationFrame(resizeFrameId);
      resizeFrameId = requestAnimationFrame(() => syncCompositeGlassClips(glassElements));
    };
    root.addEventListener('scroll', markAfterScroll, { passive: true });
    window.addEventListener('resize', syncAfterResize);
    root.dataset.liquidGlassEngine = '@ybouane/liquidglass';
    root.dataset.liquidGlassState = 'loading';

    const initialize = async () => {
      try {
        if (!supportsWebGl()) throw new Error('WebGL is unavailable');

        await waitForCaptureAssets(root);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        if (cancelled) return;

        glassElements = getGlassElements(root);
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
        syncCompositeGlassClips(glassElements);
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
      cancelAnimationFrame(resizeFrameId);
      root.removeEventListener('scroll', markAfterScroll);
      window.removeEventListener('resize', syncAfterResize);
      clearCompositeGlassClips(glassElements);
      if (createdInstance) createdInstance.destroy();
      if (instanceRef.current === createdInstance) instanceRef.current = null;
      root.removeAttribute('data-liquid-glass-engine');
      root.removeAttribute('data-liquid-glass-state');
    };
  }, [elementSignature, rootRef, theme]);

  useEffect(() => {
    if (theme !== LIQUID_TIDE_THEME_ID) return;
    const frameId = requestAnimationFrame(() => {
      const root = rootRef.current;
      if (root) syncCompositeGlassClips(getGlassElements(root));
      instanceRef.current?.markChanged();
    });
    return () => cancelAnimationFrame(frameId);
  }, [renderSignature, theme]);
}
