import { lazy, Suspense, useEffect, useState, type RefObject } from 'react';
import { readAppTheme, subscribeAppTheme } from './appTheme';

const LazySurfaceEffects = lazy(async () => {
  const module = await import('./LiquidTideEffects');
  return { default: module.LiquidTideSurfaceEffects };
});

const LazyCanvasEffects = lazy(async () => {
  const module = await import('./LiquidTideEffects');
  return { default: module.LiquidTideCanvasEffects };
});

function useLiquidTideSelected(): boolean {
  const [theme, setTheme] = useState(readAppTheme);
  useEffect(() => subscribeAppTheme(setTheme), []);
  return theme === 'liquid-tide';
}

export function OptionalLiquidTideSurfaceEffects({
  rootRef,
  activationKey = '',
}: {
  rootRef: RefObject<HTMLDivElement>;
  activationKey?: string;
}) {
  if (!useLiquidTideSelected()) return null;
  return (
    <Suspense fallback={null}>
      <LazySurfaceEffects rootRef={rootRef} activationKey={activationKey} />
    </Suspense>
  );
}

export function OptionalLiquidTideCanvasEffects({
  rootRef,
  elementSignature,
  renderSignature,
}: {
  rootRef: RefObject<HTMLDivElement>;
  elementSignature: string;
  renderSignature: string;
}) {
  if (!useLiquidTideSelected()) return null;
  return (
    <Suspense fallback={null}>
      <LazyCanvasEffects
        rootRef={rootRef}
        elementSignature={elementSignature}
        renderSignature={renderSignature}
      />
    </Suspense>
  );
}
