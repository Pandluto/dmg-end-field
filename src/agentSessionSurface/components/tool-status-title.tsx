import { useMemo } from 'react';
import { TextShimmer } from './opencode-primitives.tsx';

/** Mechanical React port of OpenCode tool-status-title.tsx. */
export function ToolStatusTitle(props: {
  readonly active: boolean;
  readonly activeText: string;
  readonly doneText: string;
  readonly className?: string;
  readonly split?: boolean;
}): JSX.Element {
  const split = useMemo(() => common(props.activeText, props.doneText), [props.activeText, props.doneText]);
  const suffix = (props.split ?? true) && split.prefix.length >= 2 && split.active.length > 0 && split.done.length > 0;
  const activeText = suffix ? split.active : props.activeText;
  const doneText = suffix ? split.done : props.doneText;

  return (
    <span
      data-component="tool-status-title"
      data-active={props.active ? 'true' : 'false'}
      data-ready="true"
      data-mode={suffix ? 'suffix' : 'swap'}
      className={props.className}
      aria-label={props.active ? props.activeText : props.doneText}
    >
      {suffix ? (
        <span data-slot="tool-status-suffix">
          <span data-slot="tool-status-prefix">
            <TextShimmer text={split.prefix} active={props.active} offset={0} />
          </span>
          <span data-slot="tool-status-tail">
            <span data-slot="tool-status-active">
              <TextShimmer text={activeText} active={props.active} offset={split.prefix.length} />
            </span>
            <span data-slot="tool-status-done">
              <TextShimmer text={doneText} active={false} offset={split.prefix.length} />
            </span>
          </span>
        </span>
      ) : (
        <span data-slot="tool-status-swap">
          <span data-slot="tool-status-active">
            <TextShimmer text={activeText} active={props.active} offset={0} />
          </span>
          <span data-slot="tool-status-done">
            <TextShimmer text={doneText} active={false} offset={0} />
          </span>
        </span>
      )}
    </span>
  );
}

function common(active: string, done: string): { prefix: string; active: string; done: string } {
  const left = Array.from(active);
  const right = Array.from(done);
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) index += 1;
  return {
    prefix: left.slice(0, index).join(''),
    active: left.slice(index).join(''),
    done: right.slice(index).join(''),
  };
}
