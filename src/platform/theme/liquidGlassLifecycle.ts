import type { LiquidGlass } from '@ybouane/liquidglass';

const destroyedInstances = new WeakSet<LiquidGlass>();

/**
 * The library releases its buffers on destroy, but browsers can keep the
 * underlying WebGL context alive until garbage collection. Explicitly losing
 * that context keeps route changes from exhausting the per-page context cap.
 */
export function destroyLiquidGlass(instance: LiquidGlass | null): void {
  if (!instance || destroyedInstances.has(instance)) return;

  destroyedInstances.add(instance);
  const { gl } = instance.renderer;
  instance.destroy();
  gl.getExtension('WEBGL_lose_context')?.loseContext();
}
