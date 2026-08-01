import { useEffect, useRef, useState, type RefObject } from 'react';
import type { GlassConfig, LiquidGlass as LiquidGlassInstance } from '@ybouane/liquidglass';
import { readAppTheme, subscribeAppTheme } from './appTheme';
import { destroyLiquidGlass } from './liquidGlassLifecycle';

const LIQUID_TIDE_THEME_ID = 'liquid-tide';
const LIQUID_TIDE_BACKDROP_SRC = '/assets/themes/liquid-tide/anmi-anniversary.jpg';
const MAX_MANAGED_ROOTS = 12;
const CAPTURE_OVERSCAN = 28;
const BACKDROP_ASPECT_RATIO = 16 / 9;

type SurfacePreset = 'control' | 'dock' | 'card' | 'popover';

type SurfaceRule = {
  selector: string;
  preset: SurfacePreset;
  priority: number;
};

type SurfaceTarget = {
  element: HTMLElement;
  preset: SurfacePreset;
  priority: number;
};

type StoredAttributes = {
  config: string | null;
  preset: string | null;
  surface: string | null;
};

type ManagedRoot = {
  backdropImage: HTMLImageElement | null;
  captures: HTMLCanvasElement[];
  disposed: boolean;
  instance: LiquidGlassInstance | null;
  presets: SurfacePreset[];
  resizeObserver: ResizeObserver | null;
  root: HTMLElement;
  targets: HTMLElement[];
};

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
  { selector: '.web-shell-window-bar > .web-shell-window-tabs', preset: 'dock', priority: 0 },
  { selector: '.web-shell-window-bar > .web-shell-window-close', preset: 'control', priority: 0 },

  { selector: '.workbench-top-zone > .workbench-drawer-tabs', preset: 'dock', priority: 0 },
  { selector: '.canvas-bottom-zone > .canvas-bottom-zone-left', preset: 'dock', priority: 0 },
  { selector: '.canvas-bottom-zone > .canvas-bottom-zone-right', preset: 'dock', priority: 0 },
  { selector: '.workbench-selection-bottom-bar > .workbench-top-trigger', preset: 'control', priority: 0 },
  { selector: '.workbench-selection-bottom-bar > .workbench-bottom-actions', preset: 'dock', priority: 0 },
  { selector: '.buff-edit-tool-layer > button', preset: 'control', priority: 0 },
  { selector: '.buff-edit-secondary-button-layer > button', preset: 'control', priority: 1 },
  { selector: '.sandbox-characters-extra-spacer', preset: 'dock', priority: 1 },
  { selector: '.sandbox-skill-pager', preset: 'dock', priority: 2 },
  { selector: '.tool-panel-tabs', preset: 'dock', priority: 1 },
  { selector: '.timeline-detail-heading > nav', preset: 'dock', priority: 0 },
  { selector: '.timeline-detail-expand-all-button', preset: 'control', priority: 0 },
  { selector: '.timeline-detail-utility-panel', preset: 'popover', priority: 0 },
  { selector: '.timeline-buff-bulk-actions', preset: 'dock', priority: 1 },
  { selector: '.timeline-calculation-zone-glass', preset: 'control', priority: 0 },
  { selector: '.skill-button-inline-buff-search-modes', preset: 'dock', priority: 1 },

  { selector: '.selection-header > .selection-header-actions', preset: 'dock', priority: 1 },
  { selector: '.selection-roster > .selection-confirm-button', preset: 'control', priority: 1 },
  { selector: '.selection-slots > .selection-slot.is-filled', preset: 'card', priority: 2 },
  { selector: '.selection-library > .selection-toolbar', preset: 'dock', priority: 2 },

  { selector: '.dashboard-actions', preset: 'dock', priority: 1 },
  { selector: '.data-package-actions', preset: 'dock', priority: 1 },
  { selector: '.data-library-toolbar', preset: 'dock', priority: 1 },
  { selector: '.data-library-inspector-actions', preset: 'dock', priority: 2 },
  { selector: '.settings-action-row > button', preset: 'control', priority: 2 },
  { selector: '.theme-option', preset: 'card', priority: 2 },

  { selector: '.config-panel-back-btn', preset: 'control', priority: 0 },
  { selector: '.config-avatar-strip', preset: 'dock', priority: 1 },
  { selector: '.config-cti-strip', preset: 'dock', priority: 2 },

  { selector: '.operator-draft-command-actions', preset: 'dock', priority: 1 },
  { selector: '.operator-draft-section-actions', preset: 'dock', priority: 2 },
  { selector: '.operator-draft-buff-tabs', preset: 'dock', priority: 2 },
  { selector: '.operator-draft-buff-actions', preset: 'dock', priority: 2 },
  { selector: '.buff-sheet-ribbon-actions', preset: 'dock', priority: 1 },
  { selector: '.operator-draft-modal-actions', preset: 'dock', priority: 1 },
  { selector: '.buff-sheet-share-modal-actions', preset: 'dock', priority: 1 },

  { selector: '.damage-sheet-topbar-left', preset: 'dock', priority: 0 },
  { selector: '.damage-sheet-topbar-right', preset: 'dock', priority: 0 },
  { selector: '.damage-sheet-workspace-footer', preset: 'dock', priority: 1 },
  { selector: '.report-ppt-toolbar', preset: 'dock', priority: 0 },
  { selector: '.image-manager-preview-nav', preset: 'dock', priority: 1 },
  { selector: '.image-manager-preview-actions', preset: 'dock', priority: 1 },

  { selector: '.timeline-snapshot-modal-head', preset: 'dock', priority: 0 },
  { selector: '.damage-report-modal-head', preset: 'dock', priority: 0 },
  { selector: '.work-node-modal-head', preset: 'dock', priority: 0 },
  { selector: '.skill-button-modal .modal-header', preset: 'dock', priority: 0 },
  { selector: '.operator-config-page-picker-header', preset: 'dock', priority: 0 },
  { selector: '.operator-config-page-panel-detail-header', preset: 'dock', priority: 0 },
  { selector: '.operator-config-page-skill-modal-header', preset: 'dock', priority: 0 },
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

function supportsWebGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
  } catch {
    return false;
  }
}

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

function getSurfaceConfig(element: HTMLElement, preset: SurfacePreset): Partial<GlassConfig> {
  const base = PRESET_CONFIGS[preset];
  const cssRadius = Number.parseFloat(window.getComputedStyle(element).borderTopLeftRadius);
  const cornerRadius = Number.isFinite(cssRadius) && cssRadius > 0
    ? cssRadius
    : base.cornerRadius;

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
    ));
}

async function waitForTargetAssets(targets: readonly HTMLElement[]): Promise<void> {
  if (document.fonts) await document.fonts.ready;

  const images = targets.flatMap((target) => Array.from(target.querySelectorAll('img')));
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
      // Optional artwork failures should not disable all interactive glass.
    }
  }));
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
  const dpr = window.devicePixelRatio || 1;
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

export function useLiquidTideSurfaceGlass(rootRef: RefObject<HTMLDivElement>): void {
  const [theme, setTheme] = useState(readAppTheme);
  const managedRootsRef = useRef(new Map<HTMLElement, ManagedRoot>());
  const storedAttributesRef = useRef(new Map<HTMLElement, StoredAttributes>());

  useEffect(() => subscribeAppTheme(setTheme), []);

  useEffect(() => {
    const appRoot = rootRef.current;
    const managedRoots = managedRootsRef.current;
    const storedAttributes = storedAttributesRef.current;
    let cancelled = false;
    let scanFrameId = 0;
    let geometryFrameId = 0;

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
      group.resizeObserver?.disconnect();
      destroyLiquidGlass(group.instance);
      group.captures.forEach((capture) => capture.remove());
      group.root.removeAttribute('data-liquid-glass-surface-root');
      group.root.removeAttribute('data-liquid-glass-surface-state');
      group.root.removeAttribute('data-liquid-glass-surface-positioned');
    };

    const disposeAll = () => {
      managedRoots.forEach(disposeGroup);
      managedRoots.clear();
      Array.from(storedAttributes.keys()).forEach(restoreTarget);
    };

    if (!appRoot || theme !== LIQUID_TIDE_THEME_ID) {
      disposeAll();
      return undefined;
    }

    const scheduleGeometrySync = () => {
      cancelAnimationFrame(geometryFrameId);
      geometryFrameId = requestAnimationFrame(() => {
        managedRoots.forEach((group) => {
          syncCapture(group);
          group.captures.forEach((capture) => group.instance?.markChanged(capture));
        });
      });
    };

    const initializeGroup = async (group: ManagedRoot) => {
      try {
        if (!supportsWebGl()) throw new Error('WebGL is unavailable');
        const [, backdropImage] = await Promise.all([
          waitForTargetAssets(group.targets),
          loadBackdropImage(),
        ]);
        group.backdropImage = backdropImage;
        syncCapture(group);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        if (cancelled || group.disposed || !group.root.isConnected) return;

        const { LiquidGlass } = await import('@ybouane/liquidglass');
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
        group.root.dataset.liquidGlassSurfaceState = 'active';
        syncCapture(group);
        instance.markChanged();
      } catch (error) {
        if (cancelled || group.disposed) return;
        group.root.dataset.liquidGlassSurfaceState = 'fallback';
        console.warn('[LiquidTide] Surface glass initialization failed; using solid fallback.', error);
      }
    };

    const createGroup = (root: HTMLElement, targets: readonly SurfaceTarget[]) => {
      if (window.getComputedStyle(root).position === 'static') {
        root.dataset.liquidGlassSurfacePositioned = 'true';
      }
      const captures = targets.map((_, index) => createCapture(root, index));
      const group: ManagedRoot = {
        backdropImage: null,
        captures,
        disposed: false,
        instance: null,
        presets: targets.map((target) => target.preset),
        resizeObserver: null,
        root,
        targets: targets.map((target) => target.element),
      };

      root.dataset.liquidGlassSurfaceRoot = '@ybouane/liquidglass';
      root.dataset.liquidGlassSurfaceState = 'loading';
      targets.forEach(({ element, preset }) => {
        element.dataset.config = JSON.stringify(getSurfaceConfig(element, preset));
      });
      syncCapture(group);

      if (typeof ResizeObserver !== 'undefined') {
        group.resizeObserver = new ResizeObserver(scheduleGeometrySync);
        group.resizeObserver.observe(root);
        group.targets.forEach((target) => group.resizeObserver?.observe(target));
      }

      managedRoots.set(root, group);
      void initializeGroup(group);
    };

    const scan = () => {
      if (cancelled) return;

      const byElement = new Map<HTMLElement, SurfaceTarget>();
      SURFACE_RULES.forEach((rule) => {
        appRoot.querySelectorAll<HTMLElement>(rule.selector).forEach((element) => {
          if (!byElement.has(element) && element.parentElement && isRendered(element)) {
            byElement.set(element, { element, preset: rule.preset, priority: rule.priority });
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
          syncCapture(existing);
          existing.instance?.markChanged();
          return;
        }
        if (existing) {
          disposeGroup(existing);
          managedRoots.delete(root);
        }
        createGroup(root, targets);
      });
    };

    const scheduleScan = () => {
      cancelAnimationFrame(scanFrameId);
      scanFrameId = requestAnimationFrame(scan);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (event.buttons !== 0) scheduleGeometrySync();
    };
    const handleScroll = () => {
      scheduleGeometrySync();
      scheduleScan();
    };

    const mutationObserver = new MutationObserver(scheduleScan);
    mutationObserver.observe(appRoot, {
      attributes: true,
      attributeFilter: ['class'],
      childList: true,
      subtree: true,
    });
    window.addEventListener('resize', scheduleGeometrySync);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', scheduleGeometrySync);
    scan();

    return () => {
      cancelled = true;
      cancelAnimationFrame(scanFrameId);
      cancelAnimationFrame(geometryFrameId);
      mutationObserver.disconnect();
      window.removeEventListener('resize', scheduleGeometrySync);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', scheduleGeometrySync);
      disposeAll();
    };
  }, [rootRef, theme]);
}
