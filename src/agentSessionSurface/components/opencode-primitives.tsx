import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from 'react';

/**
 * React equivalents of the OpenCode UI slices used by P8. DOM attributes and
 * slot names intentionally mirror the locked Solid source.
 */

export type IconName = 'mcp' | 'chevron-down' | 'copy' | 'check' | 'stop' | 'reset';

const ICON_PATHS: Record<IconName, ReactNode> = {
  mcp: (
    <>
      <path d="M0.972656 9.37176L9.5214 1.60019C10.7018 0.527151 12.6155 0.527151 13.7957 1.60019C14.9761 2.67321 14.9761 4.41295 13.7957 5.48599L7.3397 11.3552" />
      <path d="M7.42871 11.2747L13.7957 5.48643C14.9761 4.41338 16.8898 4.41338 18.0702 5.48643L18.1147 5.52688C19.2951 6.59993 19.2951 8.33966 18.1147 9.4127L10.3831 16.4414C9.98966 16.799 9.98966 17.379 10.3831 17.7366L11.9707 19.1799" />
      <path d="M11.6587 3.54346L5.33619 9.29119C4.15584 10.3642 4.15584 12.1039 5.33619 13.177C6.51649 14.25 8.43019 14.25 9.61054 13.177L15.9331 7.42923" />
    </>
  ),
  'chevron-down': <path d="M6.6665 8.33325L9.99984 11.6666L13.3332 8.33325" />,
  copy: <path d="M6 6.5V3.5H16.5V14H13.5M3.5 6.5H13.5V16.5H3.5V6.5Z" />,
  check: <path d="M4.5 10L8 13.5L15.5 6" />,
  stop: <rect x="5" y="5" width="10" height="10" fill="currentColor" stroke="none" />,
  reset: <path d="M5.83333 4.16406L2.5 7.4974L5.83333 10.8307M3.33333 7.4974H17.9167V15.4141H10" />,
};

export function Icon(props: { name: IconName; size?: 'small' | 'normal'; className?: string }): JSX.Element {
  const size = props.size ?? 'normal';
  return (
    <span data-component="icon" data-size={size} className={props.className} aria-hidden="true">
      <svg
        data-slot="icon-svg"
        viewBox="0 0 20 20"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {ICON_PATHS[props.name]}
      </svg>
    </span>
  );
}

export function TextShimmer(props: { text: string; active?: boolean; offset?: number; className?: string }): JSX.Element {
  const active = props.active ?? true;
  const [run, setRun] = useState(active);
  useEffect(() => {
    if (active) {
      setRun(true);
      return undefined;
    }
    const timer = window.setTimeout(() => setRun(false), 220);
    return () => window.clearTimeout(timer);
  }, [active]);
  return (
    <span
      data-component="text-shimmer"
      data-active={active ? 'true' : 'false'}
      className={props.className}
      aria-label={props.text}
      style={{ '--text-shimmer-index': String(props.offset ?? 0) } as CSSProperties}
    >
      <span data-slot="text-shimmer-char">
        <span data-slot="text-shimmer-char-base" aria-hidden="true">{props.text}</span>
        <span data-slot="text-shimmer-char-shimmer" data-run={run ? 'true' : 'false'} aria-hidden="true">{props.text}</span>
      </span>
    </span>
  );
}

export function TextReveal(props: { text?: string; className?: string }): JSX.Element {
  return (
    <span data-component="text-reveal" className={props.className} aria-label={props.text ?? ''}>
      <span data-slot="text-reveal-track">
        <span data-slot="text-reveal-entering">{props.text ?? '\u00a0'}</span>
      </span>
    </span>
  );
}

interface CollapsibleContextValue {
  readonly open: boolean;
  readonly setOpen: (value: boolean) => void;
  readonly disabled: boolean;
}

const CollapsibleContext = createContext<CollapsibleContextValue | null>(null);

export interface CollapsibleProps {
  readonly children?: ReactNode;
  readonly className?: string;
  readonly variant?: 'normal' | 'ghost';
  readonly open?: boolean;
  readonly defaultOpen?: boolean;
  readonly onOpenChange?: (value: boolean) => void;
  readonly disabled?: boolean;
}

function CollapsibleRoot(props: CollapsibleProps): JSX.Element {
  const [internalOpen, setInternalOpen] = useState(props.defaultOpen ?? false);
  const open = props.open ?? internalOpen;
  const setOpen = (value: boolean) => {
    if (props.disabled) return;
    if (props.open === undefined) setInternalOpen(value);
    props.onOpenChange?.(value);
  };
  const context = useMemo<CollapsibleContextValue>(() => ({ open, setOpen, disabled: !!props.disabled }), [open, props.disabled]);
  return (
    <CollapsibleContext.Provider value={context}>
      <div
        data-component="collapsible"
        data-variant={props.variant ?? 'normal'}
        data-expanded={open ? 'true' : undefined}
        className={props.className}
      >
        {props.children}
      </div>
    </CollapsibleContext.Provider>
  );
}

function CollapsibleTrigger(props: ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  const context = useContext(CollapsibleContext);
  const { children, onClick, ...rest } = props;
  const open = context?.open ?? false;
  return (
    <button
      {...rest}
      type="button"
      data-slot="collapsible-trigger"
      data-disabled={context?.disabled ? 'true' : undefined}
      aria-expanded={open}
      onClick={(event) => {
        context?.setOpen(!open);
        onClick?.(event);
      }}
    >
      {children}
    </button>
  );
}

function CollapsibleContent(props: { children?: ReactNode }): JSX.Element | null {
  const context = useContext(CollapsibleContext);
  if (!context?.open) return null;
  return <div data-slot="collapsible-content" data-expanded="true">{props.children}</div>;
}

function CollapsibleArrow(): JSX.Element {
  return (
    <div data-slot="collapsible-arrow">
      <span data-slot="collapsible-arrow-icon">
        <Icon name="chevron-down" size="small" />
      </span>
    </div>
  );
}

export const Collapsible = Object.assign(CollapsibleRoot, {
  Trigger: CollapsibleTrigger,
  Content: CollapsibleContent,
  Arrow: CollapsibleArrow,
});

export function IconButton(props: {
  readonly icon: IconName;
  readonly label: string;
  readonly onClick?: () => void;
  readonly disabled?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      data-component="icon-button"
      data-icon={props.icon}
      data-size="normal"
      data-variant="ghost"
      aria-label={props.label}
      disabled={props.disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={props.onClick}
    >
      <Icon name={props.icon} size="normal" />
    </button>
  );
}
