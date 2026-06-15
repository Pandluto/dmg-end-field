import { useCallback, useEffect, useMemo, useState, type InputHTMLAttributes, type KeyboardEvent } from 'react';

type DeferredNumberInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue' | 'onChange'> & {
  value: number | null | undefined;
  onCommit: (value: number | undefined) => void;
  allowEmpty?: boolean;
  parse?: (raw: string) => number | undefined;
  format?: (value: number | null | undefined) => string;
};

function defaultParse(raw: string): number | undefined {
  const normalized = raw.trim();
  if (!normalized) {
    return undefined;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function defaultFormat(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

function trimTrailingZeros(value: number, digits = 2): string {
  return Number(value.toFixed(digits)).toString();
}

export function parseIntegerInput(raw: string): number | undefined {
  const parsed = defaultParse(raw);
  return parsed == null ? undefined : Math.trunc(parsed);
}

export function formatPercentDisplayValue(value: number | null | undefined, digits = 2): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '';
  }
  return trimTrailingZeros(value * 100, digits);
}

export function parsePercentDisplayValue(raw: string): number | undefined {
  const normalized = raw.replace(/%/g, '').trim();
  if (!normalized) {
    return undefined;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed / 100 : undefined;
}

export default function DeferredNumberInput({
  value,
  onCommit,
  allowEmpty = true,
  parse = defaultParse,
  format = defaultFormat,
  inputMode,
  onBlur,
  onFocus,
  onKeyDown,
  ...rest
}: DeferredNumberInputProps) {
  const formatter = useMemo(() => format, [format]);
  const parser = useMemo(() => parse, [parse]);
  const [draftValue, setDraftValue] = useState(() => formatter(value));
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (!isEditing) {
      setDraftValue(formatter(value));
    }
  }, [formatter, isEditing, value]);

  const resetToCommittedValue = useCallback(() => {
    setDraftValue(formatter(value));
  }, [formatter, value]);

  const commitDraftValue = useCallback((rawValue: string) => {
    const normalized = rawValue.trim();
    if (!normalized) {
      if (allowEmpty) {
        onCommit(undefined);
        setDraftValue('');
      } else {
        resetToCommittedValue();
      }
      return;
    }

    const parsed = parser(normalized);
    if (parsed == null) {
      resetToCommittedValue();
      return;
    }

    onCommit(parsed);
    setDraftValue(formatter(parsed));
  }, [allowEmpty, formatter, onCommit, parser, resetToCommittedValue]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) {
      return;
    }

    if (event.key === 'Enter') {
      commitDraftValue(event.currentTarget.value);
      event.currentTarget.blur();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      resetToCommittedValue();
      event.currentTarget.blur();
    }
  }, [commitDraftValue, onKeyDown, resetToCommittedValue]);

  return (
    <input
      {...rest}
      type="text"
      inputMode={inputMode ?? 'decimal'}
      value={draftValue}
      onChange={(event) => setDraftValue(event.target.value)}
      onFocus={(event) => {
        setIsEditing(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setIsEditing(false);
        commitDraftValue(event.target.value);
        onBlur?.(event);
      }}
      onKeyDown={handleKeyDown}
    />
  );
}
