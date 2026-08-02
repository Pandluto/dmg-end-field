import type { RefObject } from 'react';
import { useLiquidTideGlass } from './useLiquidTideGlass';
import { useLiquidTideSurfaceGlass } from './useLiquidTideSurfaceGlass';

export type LiquidTideSurfaceEffectsProps = {
  rootRef: RefObject<HTMLDivElement>;
  activationKey?: string;
};

export type LiquidTideCanvasEffectsProps = {
  rootRef: RefObject<HTMLDivElement>;
  elementSignature: string;
  renderSignature: string;
};

export function LiquidTideSurfaceEffects({
  rootRef,
  activationKey = '',
}: LiquidTideSurfaceEffectsProps) {
  useLiquidTideSurfaceGlass(rootRef, activationKey);
  return null;
}

export function LiquidTideCanvasEffects({
  rootRef,
  elementSignature,
  renderSignature,
}: LiquidTideCanvasEffectsProps) {
  useLiquidTideGlass(rootRef, { elementSignature, renderSignature });
  return null;
}
