import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { GlassConfig, LiquidGlass as LiquidGlassInstance } from '@ybouane/liquidglass';
import { readAppTheme, subscribeAppTheme } from './appTheme';
import { destroyLiquidGlass } from './liquidGlassLifecycle';
import {
  enqueueLiquidGlassRender,
  getCanvasMemoryBytes,
  getLiquidGlassRenderDpr,
  loadLiquidGlassRenderer,
  supportsEfficientWebGl,
  waitForStableLiquidGlass,
} from './liquidGlassRuntime';
import {
  persistGlassSnapshot,
  readPersistentGlassSnapshot,
} from './liquidGlassSnapshotStore';

const LIQUID_TIDE_THEME_ID = 'liquid-tide';
const LIQUID_TIDE_BACKDROP_SRC = '/assets/themes/liquid-tide/anmi-anniversary.jpg';
const MAX_MANAGED_ROOTS = 16;
const CAPTURE_OVERSCAN = 28;
const BACKDROP_ASPECT_RATIO = 16 / 9;
const STATIC_SNAPSHOT_CACHE_LIMIT = 48;
const STATIC_SNAPSHOT_MEMORY_LIMIT = 128 * 1024 * 1024;
const STATIC_SNAPSHOT_VERSION = 7;
const COHORT_COMMIT_DELAY = 72;

type SurfacePreset = 'control' | 'dock' | 'card' | 'popover';

type SurfaceRule = {
  selector: string;
  preset: SurfacePreset;
  priority: number;
  visibilityAnchor?: string;
};

type SurfaceTarget = {
  element: HTMLElement;
  preset: SurfacePreset;
  priority: number;
  visibilityAnchor: HTMLElement | null;
};

type StoredAttributes = {
  config: string | null;
  preset: string | null;
  surface: string | null;
};

type ManagedRoot = {
  backdropImage: HTMLImageElement | null;
  captures: HTMLCanvasElement[];
  cachedOutputCanvases: HTMLCanvasElement[];
  disposed: boolean;
  instance: LiquidGlassInstance | null;
  presets: SurfacePreset[];
  resizeObserver: ResizeObserver | null;
  root: HTMLElement;
  staticSnapshotKey: string | null;
  staticSnapshotRevision: number;
  targets: HTMLElement[];
  visibilityAnchors: Array<HTMLElement | null>;
};

type StaticSurfaceSnapshot = {
  byteSize: number;
  canvases: Array<{
    canvas: HTMLCanvasElement;
    cssText: string;
  }>;
};

const staticSurfaceSnapshotCache = new Map<string, StaticSurfaceSnapshot>();
let staticSurfaceSnapshotBytes = 0;

function getStaticSnapshotKey(group: ManagedRoot): string | null {
  if (group.targets.length === 0) return null;

  const roundHalfPixel = (value: number) => Math.round(value * 2) / 2;
  const rootRect = group.root.getBoundingClientRect();
  if (rootRect.width <= 1 || rootRect.height <= 1) return null;

  const targets = group.targets.map((target, index) => {
    const rect = target.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) return null;
    const style = window.getComputedStyle(target);
    return {
      rect: [
        roundHalfPixel(rect.left),
        roundHalfPixel(rect.top),
        roundHalfPixel(rect.width),
        roundHalfPixel(rect.height),
      ],
      preset: group.presets[index],
      config: target.dataset.config ?? '',
      clipPath: style.clipPath,
    };
  });
  if (targets.some((target) => target === null)) return null;

  return JSON.stringify({
    version: STATIC_SNAPSHOT_VERSION,
    backdrop: LIQUID_TIDE_BACKDROP_SRC,
    viewport: [window.innerWidth, window.innerHeight, getLiquidGlassRenderDpr()],
    root: [
      roundHalfPixel(rootRect.left),
      roundHalfPixel(rootRect.top),
      roundHalfPixel(rootRect.width),
      roundHalfPixel(rootRect.height),
    ],
    targets,
  });
}

function copySurfaceCanvas(source: HTMLCanvasElement, cacheState: 'record' | 'hit'): HTMLCanvasElement | null {
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

function rememberStaticSnapshot(key: string, snapshot: StaticSurfaceSnapshot): void {
  const previous = staticSurfaceSnapshotCache.get(key);
  previous?.canvases.forEach(({ canvas }) => {
    canvas.width = 0;
    canvas.height = 0;
  });
  staticSurfaceSnapshotBytes -= previous?.byteSize ?? 0;
  staticSurfaceSnapshotCache.delete(key);
  staticSurfaceSnapshotCache.set(key, snapshot);
  staticSurfaceSnapshotBytes += snapshot.byteSize;
  while (
    staticSurfaceSnapshotCache.size > STATIC_SNAPSHOT_CACHE_LIMIT
    || staticSurfaceSnapshotBytes > STATIC_SNAPSHOT_MEMORY_LIMIT
  ) {
    const oldestKey = staticSurfaceSnapshotCache.keys().next().value;
    if (typeof oldestKey !== 'string') break;
    const oldest = staticSurfaceSnapshotCache.get(oldestKey);
    oldest?.canvases.forEach(({ canvas }) => {
      canvas.width = 0;
      canvas.height = 0;
    });
    staticSurfaceSnapshotBytes -= oldest?.byteSize ?? 0;
    staticSurfaceSnapshotCache.delete(oldestKey);
  }
}

let backdropImagePromise: Promise<HTMLImageElement> | null = null;

function loadBackdropImage(): Promise<HTMLImageElement> {
  if (backdropImagePromise) return backdropImagePromise;

  backdropImagePromise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load ${LIQUID_TIDE_BACKDROP_SRC}`));
    image.src = LIQUID_TIDE_BACKDROP_SRC;
  }).catch((error) => {
    backdropImagePromise = null;
    throw error;
  });

  return backdropImagePromise;
}

/**
 * High-value interactive chrome gets the real shader. Dense content surfaces
 * deliberately stay out of this registry and use the single-carrier CSS tier.
 */
const SURFACE_RULES: readonly SurfaceRule[] = [
  { selector: '.web-shell-menu-button', preset: 'control', priority: 0 },
  { selector: '.web-shell-popover', preset: 'popover', priority: 0 },
  { selector: '.web-shell-window-tabs > button', preset: 'control', priority: 0 },
  { selector: '.web-shell-window-bar > .web-shell-window-close', preset: 'control', priority: 0 },

  { selector: '.workbench-drawer-tabs > button', preset: 'control', priority: 0 },
  { selector: '.canvas-bottom-zone-left > .workbench-top-trigger', preset: 'control', priority: 0 },
  { selector: '.canvas-bottom-zone-left > .toolbar > .btn-back', preset: 'control', priority: 0 },
  { selector: '.canvas-bottom-zone-left .staff-group-controls > button', preset: 'control', priority: 0 },
  { selector: '.canvas-bottom-zone-left .toolbar-right > button', preset: 'control', priority: 0 },
  { selector: '.canvas-bottom-zone-right > .workbench-bottom-actions > button', preset: 'control', priority: 0 },
  { selector: '.workbench-selection-bottom-bar > .workbench-top-trigger', preset: 'control', priority: 0 },
  { selector: '.workbench-selection-bottom-bar > .workbench-bottom-actions > button', preset: 'control', priority: 0 },
  { selector: '.buff-edit-tool-layer > button', preset: 'control', priority: 0 },
  { selector: '.buff-edit-secondary-button-layer > button', preset: 'control', priority: 1 },
  { selector: '.sandbox-characters-extra-spacer > button', preset: 'control', priority: 1 },
  { selector: '.sandbox-skill-pager > button', preset: 'control', priority: 2 },
  { selector: '.tool-panel-tabs > button', preset: 'control', priority: 1 },
  { selector: '.timeline-detail-heading > nav > button', preset: 'control', priority: 0 },
  { selector: '.timeline-detail-expand-all-button', preset: 'control', priority: 0 },
  { selector: '.timeline-detail-utility-panel', preset: 'popover', priority: 0 },
  { selector: '.timeline-buff-bulk-actions > button', preset: 'control', priority: 1 },
  { selector: '.timeline-tuning-inline-actions > button', preset: 'control', priority: 1 },
  { selector: '.timeline-calculation-inline-toggle', preset: 'control', priority: 1 },
  { selector: '.timeline-restore-tabs > button', preset: 'control', priority: 0 },
  { selector: '.timeline-snapshot-form-actions > button', preset: 'control', priority: 0 },
  { selector: '.timeline-snapshot-item-actions > button', preset: 'control', priority: 1 },
  {
    selector: '.timeline-calculation-zone-glass',
    preset: 'control',
    priority: 0,
    visibilityAnchor: '.timeline-calculation-zone-scroll',
  },
  { selector: '.skill-button-inline-buff-search-modes > button', preset: 'control', priority: 1 },

  { selector: '.selection-header-actions > button', preset: 'control', priority: 1 },
  { selector: '.selection-section-header > button', preset: 'control', priority: 1 },
  { selector: '.selection-roster > .selection-confirm-button', preset: 'control', priority: 1 },
  { selector: '.selection-slot > .selection-slot-remove', preset: 'control', priority: 2 },

  { selector: '.dashboard-actions > button', preset: 'control', priority: 1 },
  { selector: '.data-package-actions > button', preset: 'control', priority: 1 },
  { selector: '.data-library-tabs > button', preset: 'control', priority: 1 },
  { selector: '.data-library-actions > button', preset: 'control', priority: 1 },
  { selector: '.data-library-inspector-actions > button', preset: 'control', priority: 2 },
  { selector: '.settings-action-row > button', preset: 'control', priority: 2 },
  { selector: '.theme-option', preset: 'card', priority: 2 },

  { selector: '.config-panel-back-btn', preset: 'control', priority: 0 },
  { selector: '.config-avatar-indicator-glass', preset: 'card', priority: 1 },
  { selector: '.operator-config-page-equip-circle', preset: 'card', priority: 1 },
  { selector: '.operator-config-page-equip-button-row', preset: 'dock', priority: 2 },
  { selector: '.config-weapon-choose-img-square', preset: 'card', priority: 1 },
  { selector: '.operator-config-page-weapon-star-square-box', preset: 'card', priority: 1 },
  { selector: '.operator-config-page-level-badge-box', preset: 'card', priority: 1 },
  { selector: '.operator-config-page-level-track', preset: 'dock', priority: 1 },
  { selector: '.config-weapon-config-button-row', preset: 'dock', priority: 2 },

  { selector: '.operator-draft-command-actions > button', preset: 'control', priority: 1 },
  { selector: '.operator-draft-section-actions > button', preset: 'control', priority: 2 },
  { selector: '.operator-draft-buff-tabs > button', preset: 'control', priority: 2 },
  { selector: '.operator-draft-buff-actions > button', preset: 'control', priority: 2 },
  { selector: '.buff-sheet-ribbon-actions > button', preset: 'control', priority: 1 },
  { selector: '.operator-draft-modal-actions > button', preset: 'control', priority: 1 },
  { selector: '.buff-sheet-share-modal-actions > button', preset: 'control', priority: 1 },

  { selector: '.damage-sheet-topbar-left > .damage-sheet-back-button', preset: 'control', priority: 0 },
  { selector: '.damage-sheet-undo-wrap > button', preset: 'control', priority: 0 },
  { selector: '.damage-sheet-topbar-right > .damage-sheet-action-button', preset: 'control', priority: 0 },
  { selector: '.damage-sheet-sidebar > .damage-sheet-sheet-tab', preset: 'control', priority: 1 },
  { selector: '.damage-sheet-view-group > button', preset: 'control', priority: 1 },
  { selector: '.report-ppt-toolbar > button', preset: 'control', priority: 0 },
  { selector: '.image-manager-preview-nav > button', preset: 'control', priority: 1 },
  { selector: '.image-manager-preview-actions > button', preset: 'control', priority: 1 },

  { selector: '.timeline-snapshot-modal-head > .modal-close-btn', preset: 'control', priority: 0 },
  { selector: '.damage-report-modal-head > .modal-close-btn', preset: 'control', priority: 0 },
  { selector: '.work-node-modal-head button', preset: 'control', priority: 0 },
  { selector: '.skill-button-modal .modal-header > button', preset: 'control', priority: 0 },
  { selector: '.operator-config-page-picker-header > button', preset: 'control', priority: 0 },
  { selector: '.operator-config-page-panel-detail-header > button', preset: 'control', priority: 0 },
  { selector: '.operator-config-page-skill-modal-header > button', preset: 'control', priority: 0 },
] as const;

const PRESET_CONFIGS: Record<SurfacePreset, Partial<GlassConfig>> = {
  control: {
    blurAmount: 0.2,
    refraction: 0.78,
    chromAberration: 0.028,
    edgeHighlight: 0.06,
    specular: 0.1,
    fresnel: 0.32,
    distortion: 0.009,
    cornerRadius: 14,
    zRadius: 14,
    opacity: 0.9,
    saturation: 0.08,
    tintStrength: 0.025,
    brightness: -0.035,
    shadowOpacity: 0.12,
    shadowSpread: 5,
    shadowOffsetY: 2,
    floating: false,
    button: true,
    bevelMode: 0,
  },
  dock: {
    blurAmount: 0.22,
    refraction: 0.68,
    chromAberration: 0.026,
    edgeHighlight: 0.055,
    specular: 0.09,
    fresnel: 0.28,
    distortion: 0.008,
    cornerRadius: 16,
    zRadius: 14,
    opacity: 0.88,
    saturation: 0.08,
    tintStrength: 0.03,
    brightness: -0.035,
    shadowOpacity: 0.11,
    shadowSpread: 6,
    shadowOffsetY: 2,
    floating: false,
    button: false,
    bevelMode: 0,
  },
  card: {
    blurAmount: 0.25,
    refraction: 0.62,
    chromAberration: 0.022,
    edgeHighlight: 0.05,
    specular: 0.07,
    fresnel: 0.24,
    distortion: 0.006,
    cornerRadius: 16,
    zRadius: 12,
    opacity: 0.9,
    saturation: 0.06,
    tintStrength: 0.025,
    brightness: -0.025,
    shadowOpacity: 0.1,
    shadowSpread: 5,
    shadowOffsetY: 2,
    floating: false,
    button: false,
    bevelMode: 0,
  },
  popover: {
    blurAmount: 0.34,
    refraction: 0.52,
    chromAberration: 0.024,
    edgeHighlight: 0.052,
    specular: 0.08,
    fresnel: 0.25,
    distortion: 0.006,
    cornerRadius: 22,
    zRadius: 18,
    opacity: 0.92,
    saturation: 0.06,
    tintStrength: 0.035,
    brightness: -0.025,
    shadowOpacity: 0.15,
    shadowSpread: 9,
    shadowOffsetY: 3,
    floating: false,
    button: false,
    bevelMode: 0,
  },
};

function isRendered(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 1
    && rect.height > 1
    && rect.right > 0
    && rect.bottom > 0
    && rect.left < window.innerWidth
    && rect.top < window.innerHeight
    && style.display !== 'none'
    && style.visibility !== 'hidden';
}

function isTargetInRenderArea(
  element: HTMLElement,
  visibilityAnchor: HTMLElement | null,
): boolean {
  const rect = element.getBoundingClientRect();
  const anchorRect = visibilityAnchor?.getBoundingClientRect();
  const overscan = CAPTURE_OVERSCAN * 2;
  const left = Math.max(0, anchorRect?.left ?? 0) - overscan;
  const top = Math.max(0, anchorRect?.top ?? 0) - overscan;
  const right = Math.min(window.innerWidth, anchorRect?.right ?? window.innerWidth) + overscan;
  const bottom = Math.min(window.innerHeight, anchorRect?.bottom ?? window.innerHeight) + overscan;
  return rect.width > 1
    && rect.height > 1
    && rect.right > left
    && rect.bottom > top
    && rect.left < right
    && rect.top < bottom;
}

function isPersistentVisibilityAnchor(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && SURFACE_RULES.some(({ visibilityAnchor }) => (
      visibilityAnchor ? target.matches(visibilityAnchor) : false
    ));
}

function getSurfaceConfig(element: HTMLElement, preset: SurfacePreset): Partial<GlassConfig> {
  const base = PRESET_CONFIGS[preset];
  const cornerRadius = base.cornerRadius;

  return {
    ...base,
    cornerRadius,
    zRadius: Math.min(base.zRadius ?? cornerRadius ?? 12, cornerRadius ?? 12),
    button: preset === 'control'
      || (preset === 'card' && element.matches('button, [role="button"]')),
  };
}

function sameTargets(
  group: ManagedRoot,
  targets: readonly SurfaceTarget[],
): boolean {
  return group.targets.length === targets.length
    && group.targets.every((target, index) => (
      target === targets[index]?.element
      && group.presets[index] === targets[index]?.preset
      && group.visibilityAnchors[index] === targets[index]?.visibilityAnchor
    ));
}

function syncCapture(group: ManagedRoot): void {
  const rootRect = group.root.getBoundingClientRect();
  if (rootRect.width <= 0 || rootRect.height <= 0) return;

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const coverWidth = Math.max(viewportWidth, viewportHeight * BACKDROP_ASPECT_RATIO);
  const coverHeight = coverWidth / BACKDROP_ASPECT_RATIO;
  const imageLeft = (viewportWidth - coverWidth) / 2;
  const imageTop = (viewportHeight - coverHeight) / 2;
  const dpr = getLiquidGlassRenderDpr();
  group.targets.forEach((target, index) => {
    const capture = group.captures[index];
    if (!capture) return;
    const targetRect = target.getBoundingClientRect();
    const captureLeft = targetRect.left - CAPTURE_OVERSCAN;
    const captureTop = targetRect.top - CAPTURE_OVERSCAN;

    capture.style.left = `${captureLeft - rootRect.left}px`;
    capture.style.top = `${captureTop - rootRect.top}px`;
    capture.style.width = `${targetRect.width + CAPTURE_OVERSCAN * 2}px`;
    capture.style.height = `${targetRect.height + CAPTURE_OVERSCAN * 2}px`;
    const captureWidth = targetRect.width + CAPTURE_OVERSCAN * 2;
    const captureHeight = targetRect.height + CAPTURE_OVERSCAN * 2;
    const pixelWidth = Math.max(1, Math.round(captureWidth * dpr));
    const pixelHeight = Math.max(1, Math.round(captureHeight * dpr));
    if (capture.width !== pixelWidth || capture.height !== pixelHeight) {
      capture.width = pixelWidth;
      capture.height = pixelHeight;
    }

    const context = capture.getContext('2d');
    if (!context) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, capture.width, capture.height);
    if (!group.backdropImage) return;

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.drawImage(
      group.backdropImage,
      imageLeft - captureLeft,
      imageTop - captureTop,
      coverWidth,
      coverHeight,
    );
    const wash = context.createLinearGradient(0, 0, 0, captureHeight);
    wash.addColorStop(0, 'rgba(30, 47, 98, 0.02)');
    wash.addColorStop(1, 'rgba(31, 46, 92, 0.08)');
    context.fillStyle = wash;
    context.fillRect(0, 0, captureWidth, captureHeight);
  });
}

function createCapture(root: HTMLElement, index: number): HTMLCanvasElement {
  const capture = document.createElement('canvas');
  capture.className = 'liquid-tide-surface-capture';
  capture.dataset.liquidGlassCaptureIndex = String(index);
  capture.setAttribute('aria-hidden', 'true');
  root.append(capture);
  return capture;
}

export function useLiquidTideSurfaceGlass(
  rootRef: RefObject<HTMLDivElement>,
  activationKey = '',
): void {
  const [theme, setTheme] = useState(readAppTheme);
  const managedRootsRef = useRef(new Map<HTMLElement, ManagedRoot>());
  const storedAttributesRef = useRef(new Map<HTMLElement, StoredAttributes>());

  useEffect(() => subscribeAppTheme(setTheme), []);

  useLayoutEffect(() => {
    const appRoot = rootRef.current;
    const managedRoots = managedRootsRef.current;
    const storedAttributes = storedAttributesRef.current;
    let cancelled = false;
    let scanFrameId = 0;
    let geometryFrameId = 0;
    let settledScanTimerId = 0;
    let settledGeometryTimerId = 0;
    let settledGeometryRequiresScan = false;
    let cohortCommitTimerId = 0;

    const beginCohort = () => {
      window.clearTimeout(cohortCommitTimerId);
      appRoot?.setAttribute('data-liquid-glass-cohort-state', 'warming');
    };

    const isGroupSettled = (group: ManagedRoot): boolean => {
      const state = group.root.dataset.liquidGlassSurfaceState;
      if (state === 'fallback') return true;
      return state === 'active'
        && group.instance === null
        && group.cachedOutputCanvases.length === group.targets.length;
    };

    const scheduleCohortCommit = (delayMs = COHORT_COMMIT_DELAY) => {
      window.clearTimeout(cohortCommitTimerId);
      cohortCommitTimerId = window.setTimeout(() => {
        if (cancelled || !appRoot) return;
        const groups = Array.from(managedRoots.values()).filter((group) => !group.disposed);
        if (groups.every(isGroupSettled)) {
          appRoot.dataset.liquidGlassCohortState = 'ready';
        }
      }, delayMs);
    };

    const restoreTarget = (element: HTMLElement) => {
      const stored = storedAttributes.get(element);
      if (!stored) return;
      if (stored.surface === null) element.removeAttribute('data-liquid-glass-surface');
      else element.setAttribute('data-liquid-glass-surface', stored.surface);
      if (stored.preset === null) element.removeAttribute('data-liquid-glass-preset');
      else element.setAttribute('data-liquid-glass-preset', stored.preset);
      if (stored.config === null) element.removeAttribute('data-config');
      else element.setAttribute('data-config', stored.config);
      storedAttributes.delete(element);
    };

    const disposeGroup = (group: ManagedRoot) => {
      group.disposed = true;
      group.staticSnapshotRevision += 1;
      group.resizeObserver?.disconnect();
      destroyLiquidGlass(group.instance);
      group.instance = null;
      group.captures.forEach((capture) => capture.remove());
      group.cachedOutputCanvases.forEach((canvas) => canvas.remove());
      group.targets.forEach((target) => {
        target.removeAttribute('data-liquid-glass-frozen');
        target.removeAttribute('data-liquid-glass-frozen-positioned');
        target.removeAttribute('data-liquid-glass-frozen-overflow');
      });
      group.root.removeAttribute('data-liquid-glass-surface-root');
      group.root.removeAttribute('data-liquid-glass-surface-state');
      group.root.removeAttribute('data-liquid-glass-surface-positioned');
      group.root.removeAttribute('data-liquid-glass-surface-cache');
      group.root.removeAttribute('data-liquid-glass-capture-mode');
    };

    const disposeAll = () => {
      managedRoots.forEach(disposeGroup);
      managedRoots.clear();
      Array.from(storedAttributes.keys()).forEach(restoreTarget);
    };

    if (!appRoot || theme !== LIQUID_TIDE_THEME_ID) {
      disposeAll();
      appRoot?.removeAttribute('data-liquid-glass-cohort-state');
      return undefined;
    }

    beginCohort();

    const markGroupFrozen = (group: ManagedRoot) => {
      group.targets.forEach((target) => {
        target.dataset.liquidGlassFrozen = 'true';
        target.dataset.liquidGlassFrozenOverflow = 'true';
        if (window.getComputedStyle(target).position === 'static') {
          target.dataset.liquidGlassFrozenPositioned = 'true';
        }
      });
    };

    const freezeStaticSnapshot = async (
      group: ManagedRoot,
      instance: LiquidGlassInstance,
    ): Promise<boolean> => {
      const initialKey = getStaticSnapshotKey(group);
      if (!initialKey || group.instance !== instance) return false;

      const revision = ++group.staticSnapshotRevision;
      await waitForStableLiquidGlass();
      if (
        cancelled
        || group.disposed
        || group.staticSnapshotRevision !== revision
        || group.instance !== instance
      ) return false;

      const sources = group.targets.map((target) => instance.glassCanvases.get(target) ?? null);
      const snapshotCanvases = sources.map((source) => (
        source ? copySurfaceCanvas(source, 'record') : null
      ));
      const finalKey = getStaticSnapshotKey(group);
      if (
        sources.some((source) => source === null)
        || snapshotCanvases.some((canvas) => canvas === null)
        || finalKey !== initialKey
      ) {
        snapshotCanvases.forEach((canvas) => {
          if (!canvas) return;
          canvas.width = 0;
          canvas.height = 0;
        });
        return false;
      }

      const storedCanvases = snapshotCanvases as HTMLCanvasElement[];
      const outputs = storedCanvases.map((canvas) => copySurfaceCanvas(canvas, 'record'));
      if (outputs.some((canvas) => canvas === null)) {
        storedCanvases.forEach((canvas) => {
          canvas.width = 0;
          canvas.height = 0;
        });
        outputs.forEach((canvas) => canvas?.remove());
        return false;
      }

      rememberStaticSnapshot(finalKey, {
        byteSize: storedCanvases.reduce((total, canvas) => total + getCanvasMemoryBytes(canvas), 0),
        canvases: storedCanvases.map((canvas, index) => ({
          canvas,
          cssText: (sources[index] as HTMLCanvasElement).style.cssText,
        })),
      });
      persistGlassSnapshot(
        'surface',
        finalKey,
        storedCanvases.map((canvas, index) => ({
          canvas,
          cssText: (sources[index] as HTMLCanvasElement).style.cssText,
        })),
      );

      destroyLiquidGlass(instance);
      if (group.instance === instance) group.instance = null;
      group.cachedOutputCanvases.push(...outputs as HTMLCanvasElement[]);
      group.cachedOutputCanvases.forEach((output, index) => {
        const target = group.targets[index];
        if (target) target.insertBefore(output, target.firstChild);
      });
      group.captures.forEach((capture) => {
        capture.width = 1;
        capture.height = 1;
      });
      markGroupFrozen(group);
      group.staticSnapshotKey = finalKey;
      group.root.dataset.liquidGlassSurfaceState = 'active';
      group.root.dataset.liquidGlassSurfaceCache = 'recorded';
      scheduleCohortCommit();
      return true;
    };

    const restoreStaticSnapshot = (
      group: ManagedRoot,
      cacheState: 'memory-hit' | 'persistent-hit' = 'memory-hit',
    ): boolean => {
      const key = getStaticSnapshotKey(group);
      if (!key) return false;
      const snapshot = staticSurfaceSnapshotCache.get(key);
      if (!snapshot || snapshot.canvases.length !== group.targets.length) return false;
      staticSurfaceSnapshotCache.delete(key);
      staticSurfaceSnapshotCache.set(key, snapshot);

      const outputs = snapshot.canvases.map(({ canvas, cssText }) => {
        const output = copySurfaceCanvas(canvas, 'hit');
        if (output) output.style.cssText = cssText;
        return output;
      });
      if (outputs.some((output) => output === null)) {
        outputs.forEach((output) => output?.remove());
        return false;
      }
      const restoredOutputs = outputs as HTMLCanvasElement[];
      restoredOutputs.forEach((output, index) => {
        const target = group.targets[index];
        if (target) target.insertBefore(output, target.firstChild);
      });
      group.cachedOutputCanvases.push(...restoredOutputs);
      group.captures.forEach((capture) => {
        capture.width = 1;
        capture.height = 1;
      });
      markGroupFrozen(group);
      group.staticSnapshotKey = key;
      group.root.dataset.liquidGlassSurfaceState = 'active';
      group.root.dataset.liquidGlassSurfaceCache = cacheState;
      scheduleCohortCommit(0);
      return true;
    };

    const restorePersistentStaticSnapshot = async (group: ManagedRoot): Promise<boolean> => {
      const key = getStaticSnapshotKey(group);
      if (!key) return false;
      const snapshot = await readPersistentGlassSnapshot(
        'surface',
        key,
        group.targets.length,
      );
      if (
        !snapshot
        || cancelled
        || group.disposed
        || !group.root.isConnected
        || getStaticSnapshotKey(group) !== key
      ) {
        snapshot?.canvases.forEach(({ canvas }) => {
          canvas.width = 0;
          canvas.height = 0;
        });
        return false;
      }

      rememberStaticSnapshot(key, snapshot);
      return restoreStaticSnapshot(group, 'persistent-hit');
    };

    const restoreCachedStaticSnapshot = async (group: ManagedRoot): Promise<boolean> => {
      if (restoreStaticSnapshot(group)) return true;
      if (await restorePersistentStaticSnapshot(group)) return true;

      // Detail/config routes often commit their final text metrics one frame
      // after the shell. Probe the finished geometry once more before paying
      // for WebGL; fixed controls then hit the snapshot made on the last visit.
      await new Promise<void>((resolve) => window.setTimeout(resolve, 32));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (cancelled || group.disposed || !group.root.isConnected) return false;
      if (restoreStaticSnapshot(group)) return true;
      return restorePersistentStaticSnapshot(group);
    };

    const scheduleGeometrySync = () => {
      cancelAnimationFrame(geometryFrameId);
      geometryFrameId = requestAnimationFrame(() => {
        let requiresScan = false;
        managedRoots.forEach((group, root) => {
          const currentSnapshotKey = getStaticSnapshotKey(group);
          if (currentSnapshotKey && currentSnapshotKey === group.staticSnapshotKey) return;
          if (group.cachedOutputCanvases.length > 0) {
            disposeGroup(group);
            managedRoots.delete(root);
            requiresScan = true;
            return;
          }

          syncCapture(group);
          group.captures.forEach((capture, index) => {
            const target = group.targets[index];
            if (target && isTargetInRenderArea(target, group.visibilityAnchors[index] ?? null)) {
              group.instance?.markChanged(capture);
            }
          });
        });
        if (requiresScan) scheduleScan();
      });
    };

    const initializeGroup = async (group: ManagedRoot) => {
      try {
        const backdropImage = await loadBackdropImage();
        if (!await supportsEfficientWebGl()) throw new Error('Efficient WebGL is unavailable');
        if (cancelled || group.disposed || !group.root.isConnected) return;
        group.backdropImage = backdropImage;
        await enqueueLiquidGlassRender(async () => {
          if (cancelled || group.disposed || !group.root.isConnected) return;
          syncCapture(group);
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          if (cancelled || group.disposed || !group.root.isConnected) return;

          const { LiquidGlass } = await loadLiquidGlassRenderer();
          const instance = await LiquidGlass.init({
            root: group.root,
            glassElements: group.targets,
            defaults: PRESET_CONFIGS.dock,
          });

          if (cancelled || group.disposed || !group.root.isConnected) {
            destroyLiquidGlass(instance);
            return;
          }

          group.instance = instance;
          syncCapture(group);
          instance.markChanged();

          for (let attempt = 0; attempt < 3; attempt += 1) {
            if (await freezeStaticSnapshot(group, instance)) return;
            if (cancelled || group.disposed || group.instance !== instance) return;
            syncCapture(group);
            instance.markChanged();
          }

          destroyLiquidGlass(instance);
          if (group.instance === instance) group.instance = null;
          if (!cancelled && !group.disposed) {
            group.root.dataset.liquidGlassSurfaceState = 'fallback';
            group.root.dataset.liquidGlassSurfaceCache = 'unstable';
            scheduleCohortCommit();
          }
        });
      } catch (error) {
        if (cancelled || group.disposed) return;
        destroyLiquidGlass(group.instance);
        group.instance = null;
        group.root.dataset.liquidGlassSurfaceState = 'fallback';
        group.root.dataset.liquidGlassSurfaceCache = 'unstable';
        scheduleCohortCommit();
        console.warn('[LiquidTide] Surface glass initialization failed; using solid fallback.', error);
      }
    };

    const createGroup = (root: HTMLElement, targets: readonly SurfaceTarget[]) => {
      beginCohort();
      if (window.getComputedStyle(root).position === 'static') {
        root.dataset.liquidGlassSurfacePositioned = 'true';
      }
      const captures = targets.map((_, index) => createCapture(root, index));
      const group: ManagedRoot = {
        backdropImage: null,
        captures,
        cachedOutputCanvases: [],
        disposed: false,
        instance: null,
        presets: targets.map((target) => target.preset),
        resizeObserver: null,
        root,
        staticSnapshotKey: null,
        staticSnapshotRevision: 0,
        targets: targets.map((target) => target.element),
        visibilityAnchors: targets.map((target) => target.visibilityAnchor),
      };

      root.dataset.liquidGlassSurfaceRoot = '@ybouane/liquidglass';
      root.dataset.liquidGlassSurfaceState = 'loading';
      root.dataset.liquidGlassCaptureMode = 'backdrop-only';
      targets.forEach(({ element, preset }) => {
        element.dataset.config = JSON.stringify(getSurfaceConfig(element, preset));
      });

      if (typeof ResizeObserver !== 'undefined') {
        group.resizeObserver = new ResizeObserver(scheduleGeometrySync);
        group.resizeObserver.observe(root);
        group.targets.forEach((target) => group.resizeObserver?.observe(target));
      }

      managedRoots.set(root, group);
      void restoreCachedStaticSnapshot(group).then((restored) => {
        if (!restored && !cancelled && !group.disposed) {
          return initializeGroup(group);
        }
        return undefined;
      });
    };

    const scan = () => {
      if (cancelled) return;

      const byElement = new Map<HTMLElement, SurfaceTarget>();
      SURFACE_RULES.forEach((rule) => {
        appRoot.querySelectorAll<HTMLElement>(rule.selector).forEach((element) => {
          const visibilityAnchor = rule.visibilityAnchor
            ? element.closest<HTMLElement>(rule.visibilityAnchor)
            : null;
          if (
            !byElement.has(element)
            && element.parentElement
            && isRendered(visibilityAnchor ?? element)
          ) {
            byElement.set(element, {
              element,
              preset: rule.preset,
              priority: rule.priority,
              visibilityAnchor,
            });
          }
        });
      });

      const candidateElements = new Set(byElement.keys());
      const candidates = Array.from(byElement.values()).filter(({ element }) => {
        let ancestor = element.parentElement;
        while (ancestor && ancestor !== appRoot) {
          if (candidateElements.has(ancestor)) return false;
          ancestor = ancestor.parentElement;
        }
        return true;
      });

      const currentElements = new Set(candidates.map(({ element }) => element));
      Array.from(storedAttributes.keys()).forEach((element) => {
        if (!currentElements.has(element)) restoreTarget(element);
      });

      candidates.forEach(({ element, preset }) => {
        if (!storedAttributes.has(element)) {
          storedAttributes.set(element, {
            config: element.getAttribute('data-config'),
            preset: element.getAttribute('data-liquid-glass-preset'),
            surface: element.getAttribute('data-liquid-glass-surface'),
          });
        }
        element.dataset.liquidGlassSurface = 'true';
        element.dataset.liquidGlassPreset = preset;
      });

      const groupedTargets = new Map<HTMLElement, SurfaceTarget[]>();
      candidates.forEach((target) => {
        const parent = target.element.parentElement;
        if (!parent) return;
        const list = groupedTargets.get(parent) ?? [];
        list.push(target);
        groupedTargets.set(parent, list);
      });

      const selectedGroups = Array.from(groupedTargets.entries())
        .sort(([, left], [, right]) => (
          Math.min(...left.map(({ priority }) => priority))
          - Math.min(...right.map(({ priority }) => priority))
        ))
        .slice(0, MAX_MANAGED_ROOTS);
      const selectedRoots = new Set(selectedGroups.map(([root]) => root));

      managedRoots.forEach((group, root) => {
        if (!selectedRoots.has(root)) {
          beginCohort();
          disposeGroup(group);
          managedRoots.delete(root);
        }
      });

      selectedGroups.forEach(([root, targets]) => {
        const existing = managedRoots.get(root);
        if (
          existing
          && sameTargets(existing, targets)
          && existing.captures.every((capture) => capture.isConnected)
        ) {
          const currentSnapshotKey = getStaticSnapshotKey(existing);
          if (currentSnapshotKey && currentSnapshotKey === existing.staticSnapshotKey) {
            return;
          }
          if (existing.cachedOutputCanvases.length > 0) {
            disposeGroup(existing);
            managedRoots.delete(root);
            createGroup(root, targets);
            return;
          }
          syncCapture(existing);
          existing.instance?.markChanged();
          if (currentSnapshotKey) existing.staticSnapshotKey = null;
          return;
        }
        if (existing) {
          disposeGroup(existing);
          managedRoots.delete(root);
        }
        createGroup(root, targets);
      });

      const hasPendingGroup = Array.from(managedRoots.values()).some((group) => !isGroupSettled(group));
      scheduleCohortCommit(hasPendingGroup ? COHORT_COMMIT_DELAY : 0);
    };

    const scheduleScan = () => {
      cancelAnimationFrame(scanFrameId);
      scanFrameId = requestAnimationFrame(scan);
    };

    const scheduleSettledScan = () => {
      window.clearTimeout(settledScanTimerId);
      settledScanTimerId = window.setTimeout(scheduleScan, 80);
    };

    const scheduleSettledGeometrySync = (requiresScan = false) => {
      settledGeometryRequiresScan ||= requiresScan;
      window.clearTimeout(settledGeometryTimerId);
      settledGeometryTimerId = window.setTimeout(() => {
        const shouldScan = settledGeometryRequiresScan;
        settledGeometryRequiresScan = false;
        scheduleGeometrySync();
        if (shouldScan) scheduleScan();
      }, 140);
    };

    const handleScroll = (event: Event) => {
      scheduleSettledGeometrySync(!isPersistentVisibilityAnchor(event.target));
    };
    const handleResize = () => scheduleSettledGeometrySync(true);
    const handleLayoutSettled = (event: Event) => {
      if (!(event.target instanceof HTMLElement)) return;
      if (!event.target.matches([
        '.workbench-top-zone',
        '.buff-edit-tool-layer',
        '.buff-edit-secondary-button-layer',
        '.selection-workbench-layout',
        '.timeline-detail-layer',
        '.web-shell-window',
        '.operator-config-page-root',
      ].join(', '))) return;
      scheduleSettledScan();
    };

    const mutationObserver = new MutationObserver(scheduleSettledScan);
    mutationObserver.observe(appRoot, {
      attributes: true,
      attributeFilter: ['class'],
      childList: true,
      subtree: true,
    });
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('pointerup', scheduleGeometrySync);
    appRoot.addEventListener('transitionend', handleLayoutSettled);
    appRoot.addEventListener('animationend', handleLayoutSettled);
    scan();

    return () => {
      cancelled = true;
      cancelAnimationFrame(scanFrameId);
      cancelAnimationFrame(geometryFrameId);
      window.clearTimeout(settledScanTimerId);
      window.clearTimeout(settledGeometryTimerId);
      window.clearTimeout(cohortCommitTimerId);
      mutationObserver.disconnect();
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('pointerup', scheduleGeometrySync);
      appRoot.removeEventListener('transitionend', handleLayoutSettled);
      appRoot.removeEventListener('animationend', handleLayoutSettled);
      disposeAll();
      appRoot.removeAttribute('data-liquid-glass-cohort-state');
    };
  }, [activationKey, rootRef, theme]);
}
