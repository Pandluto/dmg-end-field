import { createRoot, type Root } from 'react-dom/client';
import {
  AgentSessionSurface,
  type ConversationSurfaceMountProps,
} from './SessionSurface.tsx';

/**
 * Narrow P11/P9 seam: callers provide the existing P4 Store and Host action
 * callbacks; the surface owns neither transport nor session state.
 */
export interface AgentSessionSurfaceMountOptions extends ConversationSurfaceMountProps {
  readonly root: HTMLElement | string;
}

const roots = new WeakMap<HTMLElement, Root>();

function resolveRoot(target: HTMLElement | string): HTMLElement {
  if (typeof target !== 'string') return target;
  const element = document.querySelector<HTMLElement>(target);
  if (!element) throw new Error(`Agent Session Surface root not found: ${target}`);
  return element;
}

export function mountAgentSessionSurface(options: AgentSessionSurfaceMountOptions): () => void {
  const container = resolveRoot(options.root);
  const root = roots.get(container) ?? createRoot(container);
  roots.set(container, root);
  const { root: _root, ...props } = options;
  void _root;
  root.render(<AgentSessionSurface {...props} />);

  return () => {
    if (roots.get(container) !== root) return;
    root.unmount();
    roots.delete(container);
  };
}

export const bootstrapAgentSessionSurface = mountAgentSessionSurface;
