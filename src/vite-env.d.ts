/// <reference types="vite/client" />

declare const __DEF_MOBILE_SHARE_ENABLED__: boolean;

declare module '*.mjs' {
  export const buildAiTimelineCheckoutDecision: (input?: {
    approvalPolicy?: string;
    riskFlags?: unknown[];
    diff?: unknown;
  }) => unknown;
}
