import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface MobilePortalProps {
  children: ReactNode;
}

/** Render mobile overlays outside the transformed four-page pager. */
export function MobilePortal({ children }: MobilePortalProps) {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}
