/// <reference types="vite/client" />

declare module '*.mjs' {
  export const buildAiTimelineCheckoutDecision: (input?: {
    approvalPolicy?: string;
    riskFlags?: unknown[];
    diff?: unknown;
  }) => unknown;
}
