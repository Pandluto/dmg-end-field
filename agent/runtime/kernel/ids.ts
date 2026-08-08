/**
 * DEF-owned runtime identifiers.
 *
 * The nominal-id pattern follows the existing DEF Agent contracts. These IDs
 * deliberately remain independent from AgentEngine ids so the kernel can be
 * tested and evolved without importing the Host adapter contract.
 */
declare const runtimeIdBrand: unique symbol;

type RuntimeId<Tag extends string> = string & {
  readonly [runtimeIdBrand]: Tag;
};

export type RuntimeSessionId = RuntimeId<'RuntimeSessionId'>;
export type RuntimeRunId = RuntimeId<'RuntimeRunId'>;
export type RuntimeTurnId = RuntimeId<'RuntimeTurnId'>;
export type RuntimeMessageId = RuntimeId<'RuntimeMessageId'>;
export type RuntimeContentId = RuntimeId<'RuntimeContentId'>;
export type RuntimeEntryId = RuntimeId<'RuntimeEntryId'>;

function asRuntimeId<T extends string>(value: string, label: string): T {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} must be a non-empty string`);
  if (normalized.length > 256) throw new TypeError(`${label} must not exceed 256 characters`);
  return normalized as T;
}

export const asRuntimeSessionId = (value: string): RuntimeSessionId => (
  asRuntimeId<RuntimeSessionId>(value, 'RuntimeSessionId')
);
export const asRuntimeRunId = (value: string): RuntimeRunId => (
  asRuntimeId<RuntimeRunId>(value, 'RuntimeRunId')
);
export const asRuntimeTurnId = (value: string): RuntimeTurnId => (
  asRuntimeId<RuntimeTurnId>(value, 'RuntimeTurnId')
);
export const asRuntimeMessageId = (value: string): RuntimeMessageId => (
  asRuntimeId<RuntimeMessageId>(value, 'RuntimeMessageId')
);
export const asRuntimeContentId = (value: string): RuntimeContentId => (
  asRuntimeId<RuntimeContentId>(value, 'RuntimeContentId')
);
export const asRuntimeEntryId = (value: string): RuntimeEntryId => (
  asRuntimeId<RuntimeEntryId>(value, 'RuntimeEntryId')
);
