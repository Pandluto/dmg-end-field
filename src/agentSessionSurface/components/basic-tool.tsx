import { useEffect, useState, type ReactNode } from 'react';
import type { ConversationToolPart } from '../../../agent/core/contracts/conversation.ts';
import {
  Collapsible,
  Icon,
  TextShimmer,
} from './opencode-primitives.tsx';
import {
  isActiveToolState,
  jsonInline,
  toolArgumentLabels,
  toolCanExpand,
  toolDisplaySubtitle,
  toolDisplayTitle,
  toolInputLabel,
} from './session-model.ts';
import { ToolStatusTitle } from './tool-status-title.tsx';

/** OpenCode basic-tool.tsx mechanical slice; generic DEF tools only. */
export function BasicTool(props: {
  readonly part: ConversationToolPart;
  readonly defaultOpen?: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  const expandable = toolCanExpand(props.part.state);
  const active = isActiveToolState(props.part.state);
  const title = toolDisplayTitle(props.part);
  const subtitle = toolDisplaySubtitle(props.part) ?? toolInputLabel(props.part);
  const args = toolArgumentLabels(props.part);

  useEffect(() => {
    if (!expandable && open) setOpen(false);
  }, [expandable, open]);

  return (
    <Collapsible
      open={expandable ? open : false}
      onOpenChange={setOpen}
      disabled={!expandable}
      className="tool-collapsible"
    >
      <Collapsible.Trigger data-hide-details={!expandable ? 'true' : undefined}>
        <div
          data-component="tool-trigger"
          data-clickable={expandable ? 'true' : undefined}
          data-hide-details={!expandable ? 'true' : undefined}
        >
          <div data-slot="basic-tool-tool-trigger-content">
            <span data-slot="basic-tool-tool-indicator">
              {active ? <span data-slot="basic-tool-tool-spinner" aria-hidden="true"><Spinner /></span> : <Icon name="mcp" size="small" />}
            </span>
            <div data-slot="basic-tool-tool-info">
              <div data-slot="basic-tool-tool-info-structured">
                <div data-slot="basic-tool-tool-info-main">
                  <span data-slot="basic-tool-tool-title">
                    <ToolStatusTitle
                      active={active}
                      activeText={title}
                      doneText={title}
                      split={false}
                    />
                  </span>
                  {!active && subtitle ? <span data-slot="basic-tool-tool-subtitle">{subtitle}</span> : null}
                  {!active && args.map((arg) => <span key={arg} data-slot="basic-tool-tool-arg">{arg}</span>)}
                </div>
              </div>
            </div>
          </div>
          {expandable ? <Collapsible.Arrow /> : null}
        </div>
      </Collapsible.Trigger>
      {expandable ? (
        <Collapsible.Content>
          <div data-component="tool-output" data-scrollable>
            <ToolDetails part={props.part} />
          </div>
        </Collapsible.Content>
      ) : null}
    </Collapsible>
  );
}

function ToolDetails(props: { readonly part: ConversationToolPart }): JSX.Element {
  if (props.part.state.status === 'completed') {
    return <pre data-slot="tool-output-pre">{jsonInline(props.part.state.output)}</pre>;
  }
  if (props.part.state.status === 'error') {
    return (
      <div data-component="tool-error">
        <strong>{props.part.name}</strong>
        <span data-slot="tool-error-message"> · {props.part.state.message}</span>
        <span data-slot="tool-error-code"> ({props.part.state.code})</span>
      </div>
    );
  }
  return <span data-slot="tool-output-pending">waiting for DEF Host</span>;
}

function Spinner(): JSX.Element {
  return <span data-component="spinner" aria-label="running" />;
}

export function ToolPartView(props: { readonly part: ConversationToolPart; readonly defaultOpen?: boolean }): JSX.Element {
  return (
    <div
      data-component="tool-part-wrapper"
      data-timeline-part-id={props.part.id}
      data-tool-status={props.part.state.status}
    >
      <BasicTool part={props.part} defaultOpen={props.defaultOpen} />
    </div>
  );
}

export function ToolTriggerPreview(props: { readonly children: ReactNode }): JSX.Element {
  return <div data-component="tool-trigger-preview">{props.children}</div>;
}
