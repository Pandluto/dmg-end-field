import type {
  AiTimelineApprovalPolicy,
  AiTimelineCheckoutDecision,
  AiTimelineRiskFlag,
  TimelinePayloadDiff,
} from './types';

export function buildAiTimelineCheckoutDecision(input?: {
  approvalPolicy?: AiTimelineApprovalPolicy;
  riskFlags?: AiTimelineRiskFlag[];
  diff?: TimelinePayloadDiff;
}): AiTimelineCheckoutDecision;
