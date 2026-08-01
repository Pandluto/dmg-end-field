import { useEffect, useRef, useState, type RefObject } from 'react';
import type { GlassConfig, LiquidGlass as LiquidGlassInstance } from '@ybouane/liquidglass';
import { readAppTheme, subscribeAppTheme } from './appTheme';
import { destroyLiquidGlass } from './liquidGlassLifecycle';

const LIQUID_TIDE_THEME_ID = 'liquid-tide';
const LIQUID_TIDE_GLASS_SELECTOR = '[data-liquid-glass-skill="true"]';
const LIQUID_TIDE_GLASS_CLIP_PROPERTY = '--liquid-glass-composite-clip';
const LIQUID_TIDE_GLASS_BACKDROP = '/assets/themes/liquid-tide/anmi-anniversary.jpg';
const SKILL_SNAPSHOT_CACHE_LIMIT = 6;
const SKILL_SNAPSHOT_VERSION = 1;

const LIQUID_TIDE_SKILL_GLASS_DEFAULTS: Partial<GlassConfig> = {
  blurAmount: 0.28,
  refraction: 0.82,
  chromAberration: 0.035,
  edgeHighlight: 0.035,
  specular: 0.08,
  fresnel: 0.24,
  distortion: 0.012,
  // Keep the shader's optical corner aligned with the 11px body outline.
  cornerRadius: 11,
  zRadius: 11,
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

type SkillGlassSnapshot = {
  canvases: Array<{
    canvas: HTMLCanvasElement;
    cssText: string;
  }>;
};

const skillGlassSnapshotCache = new Map<string, SkillGlassSnapshot>();

function copySkillGlassCanvas(
  source: HTMLCanvasElement,
  cacheState: 'record' | 'hit',
): HTMLCanvasElement | null {
  if (source.width <= 0 || source.height <= 0) return null;

  const copy = document.createElement('canvas');
  copy.width = source.width;
  copy.height = source.height;
  copy.style.cssText = source.style.cssText;
  copy.dataset.liquidGlassSnapshot = cacheState;
  copy.setAttribute('aria-hidden', 'true');
  const context = copy.getContext('2d');
  if (!context) return null;

  try {
    context.drawImage(source, 0, 0);
  } catch {
    return null;
  }
  return copy;
}

function rememberSkillGlassSnapshot(key: string, snapshot: SkillGlassSnapshot): void {
  const previous = skillGlassSnapshotCache.get(key);
  previous?.canvases.forEach(({ canvas }) => {
    canvas.width = 0;
    canvas.height = 0;
  });
  skillGlassSnapshotCache.delete(key);
  skillGlassSnapshotCache.set(key, snapshot);
  while (skillGlassSnapshotCache.size > SKILL_SNAPSHOT_CACHE_LIMIT) {
    const oldestKey = skillGlassSnapshotCache.keys().next().value;
    if (typeof oldestKey !== 'string') break;
    skillGlassSnapshotCache.get(oldestKey)?.canvases.forEach(({ canvas }) => {
      canvas.width = 0;
      canvas.height = 0;
    });
    skillGlassSnapshotCache.delete(oldestKey);
  }
}

function getSkillGlassSnapshotKey(
  root: HTMLElement,
  elements: readonly HTMLElement[],
  elementSignature: string,
): string | null {
  if (elements.length === 0 || elements.some((element) => element.classList.contains('dragging'))) {
    return null;
  }

  const roundHalfPixel = (value: number) => Math.round(value * 2) / 2;
  const rootRect = root.getBoundingClientRect();
  if (rootRect.width <= 1 || rootRect.height <= 1) return null;
  const targets = elements.map((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) return null;
    return {
      id: element.dataset.skillButtonId ?? '',
      skillType: element.dataset.skillType ?? '',
      rect: [
        roundHalfPixel(rect.left),
        roundHalfPixel(rect.top),
        roundHalfPixel(rect.width),
        roundHalfPixel(rect.height),
      ],
    };
  });
  if (targets.some((target) => target === null)) return null;

  return JSON.stringify({
    version: SKILL_SNAPSHOT_VERSION,
    backdrop: LIQUID_TIDE_GLASS_BACKDROP,
    viewport: [window.innerWidth, window.innerHeight, window.devicePixelRatio || 1],
    root: [
      roundHalfPixel(rootRect.left),
      roundHalfPixel(rootRect.top),
      roundHalfPixel(rootRect.width),
      roundHalfPixel(rootRect.height),
    ],
    elementSignature,
    targets,
  });
}

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
  const queueSnapshotRef = useRef<(() => void) | null>(null);
  const restoredSnapshotKeyRef = useRef<string | null>(null);
  const cacheRefreshPendingRef = useRef(false);
  const [rendererRevision, setRendererRevision] = useState(0);
  const [theme, setTheme] = useState(readAppTheme);

  useEffect(() => subscribeAppTheme(setTheme), []);

  useEffect(() => {
    const root = rootRef.current;
    let cancelled = false;
    let createdInstance: LiquidGlassInstance | null = null;
    let glassElements: HTMLElement[] = [];
    let restoredCanvases: HTMLCanvasElement[] = [];
    let resizeFrameId = 0;
    let snapshotTimerId = 0;
    let snapshotRevision = 0;

    destroyLiquidGlass(instanceRef.current);
    instanceRef.current = null;
    queueSnapshotRef.current = null;
    restoredSnapshotKeyRef.current = null;
    cacheRefreshPendingRef.current = false;

    if (!root || theme !== LIQUID_TIDE_THEME_ID) {
      root?.removeAttribute('data-liquid-glass-engine');
      root?.removeAttribute('data-liquid-glass-state');
      root?.removeAttribute('data-liquid-glass-cache');
      return undefined;
    }

    const requestLiveRenderer = () => {
      if (restoredSnapshotKeyRef.current === null || cacheRefreshPendingRef.current) return;
      cacheRefreshPendingRef.current = true;
      restoredSnapshotKeyRef.current = null;
      setRendererRevision((revision) => revision + 1);
    };

    const queueSnapshot = () => {
      const instance = createdInstance;
      const initialKey = instance
        ? getSkillGlassSnapshotKey(root, glassElements, elementSignature)
        : null;
      if (!instance || !initialKey) return;

      const revision = ++snapshotRevision;
      window.clearTimeout(snapshotTimerId);
      snapshotTimerId = window.setTimeout(() => {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (
            cancelled
            || revision !== snapshotRevision
            || createdInstance !== instance
          ) return;

          const sources = glassElements.map((element) => instance.glassCanvases.get(element) ?? null);
          const copies = sources.map((source) => (
            source ? copySkillGlassCanvas(source, 'record') : null
          ));
          const finalKey = getSkillGlassSnapshotKey(
            root,
            glassElements,
            elementSignature,
          );
          if (
            sources.some((source) => source === null)
            || copies.some((copy) => copy === null)
            || finalKey !== initialKey
          ) return;

          rememberSkillGlassSnapshot(finalKey, {
            canvases: copies.map((canvas, index) => ({
              canvas: canvas as HTMLCanvasElement,
              cssText: (sources[index] as HTMLCanvasElement).style.cssText,
            })),
          });
          root.dataset.liquidGlassCache = 'recorded';
        }));
      }, 120);
    };

    const markAfterScroll = () => {
      if (restoredSnapshotKeyRef.current !== null) {
        requestLiveRenderer();
        return;
      }
      instanceRef.current?.markChanged();
      queueSnapshot();
    };
    const syncAfterResize = () => {
      if (restoredSnapshotKeyRef.current !== null) {
        requestLiveRenderer();
        return;
      }
      cancelAnimationFrame(resizeFrameId);
      resizeFrameId = requestAnimationFrame(() => {
        syncCompositeGlassClips(glassElements);
        instanceRef.current?.markChanged();
        queueSnapshot();
      });
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

        const snapshotKey = getSkillGlassSnapshotKey(
          root,
          glassElements,
          elementSignature,
        );
        const snapshot = snapshotKey ? skillGlassSnapshotCache.get(snapshotKey) : null;
        if (snapshot && snapshot.canvases.length === glassElements.length) {
          const outputs = snapshot.canvases.map(({ canvas, cssText }) => {
            const output = copySkillGlassCanvas(canvas, 'hit');
            if (output) output.style.cssText = cssText;
            return output;
          });
          if (outputs.every((output) => output !== null)) {
            restoredCanvases = outputs as HTMLCanvasElement[];
            restoredCanvases.forEach((output, index) => {
              glassElements[index]?.insertBefore(output, glassElements[index]?.firstChild ?? null);
            });
            restoredSnapshotKeyRef.current = snapshotKey;
            root.dataset.liquidGlassState = 'active';
            root.dataset.liquidGlassCache = 'hit';
            syncCompositeGlassClips(glassElements);
            return;
          }
          outputs.forEach((output) => output?.remove());
        }

        const { LiquidGlass } = await import('@ybouane/liquidglass');
        const instance = await LiquidGlass.init({
          root,
          glassElements,
          defaults: LIQUID_TIDE_SKILL_GLASS_DEFAULTS,
        });

        if (cancelled) {
          destroyLiquidGlass(instance);
          return;
        }

        createdInstance = instance;
        instanceRef.current = instance;
        root.dataset.liquidGlassState = 'active';
        syncCompositeGlassClips(glassElements);
        instance.markChanged();
        queueSnapshotRef.current = queueSnapshot;
        queueSnapshot();
      } catch (error) {
        if (cancelled) return;
        root.dataset.liquidGlassState = 'fallback';
        console.warn('[LiquidTide] LiquidGlass initialization failed; using CSS fallback.', error);
      }
    };

    void initialize();

    return () => {
      cancelled = true;
      snapshotRevision += 1;
      cancelAnimationFrame(resizeFrameId);
      window.clearTimeout(snapshotTimerId);
      root.removeEventListener('scroll', markAfterScroll);
      window.removeEventListener('resize', syncAfterResize);
      clearCompositeGlassClips(glassElements);
      restoredCanvases.forEach((canvas) => canvas.remove());
      destroyLiquidGlass(createdInstance);
      if (instanceRef.current === createdInstance) instanceRef.current = null;
      if (queueSnapshotRef.current === queueSnapshot) queueSnapshotRef.current = null;
      restoredSnapshotKeyRef.current = null;
      root.removeAttribute('data-liquid-glass-engine');
      root.removeAttribute('data-liquid-glass-state');
      root.removeAttribute('data-liquid-glass-cache');
    };
  }, [elementSignature, rendererRevision, rootRef, theme]);

  useEffect(() => {
    if (theme !== LIQUID_TIDE_THEME_ID) return;
    const frameId = requestAnimationFrame(() => {
      const root = rootRef.current;
      if (!root) return;
      const elements = getGlassElements(root);
      syncCompositeGlassClips(elements);
      const restoredKey = restoredSnapshotKeyRef.current;
      if (restoredKey !== null) {
        const currentKey = getSkillGlassSnapshotKey(root, elements, elementSignature);
        if (currentKey !== restoredKey && !cacheRefreshPendingRef.current) {
          cacheRefreshPendingRef.current = true;
          restoredSnapshotKeyRef.current = null;
          setRendererRevision((revision) => revision + 1);
        }
        return;
      }
      instanceRef.current?.markChanged();
      queueSnapshotRef.current?.();
    });
    return () => cancelAnimationFrame(frameId);
  }, [elementSignature, renderSignature, theme]);
}
