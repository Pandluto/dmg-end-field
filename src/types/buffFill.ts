import type { BuffEffectKind, BuffExtraHitConfig, CandidateBuff } from '../core/domain/buff';

export interface BuffEffectDraft extends CandidateBuff {
  id: string;
  effectKind: BuffEffectKind;
  extraHitConfig?: BuffExtraHitConfig;
}

export interface BuffItemDraft {
  id: string;
  name: string;
  sourceName: string;
  description: string;
  effects: Record<string, BuffEffectDraft>;
}

export interface BuffDraft {
  id: string;
  name: string;
  sourceName: string;
  source: string;
  description: string;
  items: Record<string, BuffItemDraft>;
}
