import { createBuffFillAiDraftSchema } from '../legacyFillCore/domains/buff/schema';
import { convertBuffFillAiDraftToBuffDraft, sanitizeBuffFillAiDraft, validateBuffFillAiDraft } from '../legacyFillCore/domains/buff/validator';
import {
  WEAPON_FILL_AI_DRAFT_SCHEMA,
  parseWeaponFillResult,
  validateWeaponProposalPayload,
  weaponFillDomainCore,
} from '../legacyFillCore/domains/weapon';
import { operatorFillAdapter, operatorFillDomainCore } from '../aiCli/operatorFillAdapter';
import { equipmentFillAdapter, equipmentFillDomainCore } from '../aiCli/equipmentFillAdapter';

const domainCores = {
  weapon: weaponFillDomainCore,
  operator: operatorFillDomainCore,
  equipment: equipmentFillDomainCore,
};

export function validateLegacyFillDraft(domain: string, input: unknown) {
  if (domain === 'buff') {
    const validation = validateBuffFillAiDraft(input);
    if (!validation.ok) return { valid: false, errors: validation.errors, warnings: [] };
    const sanitized = sanitizeBuffFillAiDraft(input as Record<string, unknown>);
    const normalized = convertBuffFillAiDraftToBuffDraft(sanitized as never);
    return { valid: true, errors: [], warnings: [], normalized };
  }
  if (domain === 'weapon') {
    if (typeof input === 'string') {
      const parsed = parseWeaponFillResult(input);
      return parsed.draft ? { valid: true, errors: [], warnings: [], normalized: parsed.draft } : { valid: false, errors: parsed.errors, warnings: [] };
    }
    const parsed = parseWeaponFillResult(JSON.stringify(input));
    if (parsed.draft) return { valid: true, errors: [], warnings: [], normalized: parsed.draft };
    const canonical = validateWeaponProposalPayload(input);
    return canonical.ok ? { valid: true, errors: [], warnings: [], normalized: canonical.normalized } : { valid: false, errors: [...parsed.errors, ...canonical.errors], warnings: [] };
  }
  if (domain === 'operator') {
    const result = operatorFillAdapter.validateAiDraft(typeof input === 'string' ? input : JSON.stringify(input));
    return result.ok ? { valid: true, errors: [], warnings: [], normalized: result.normalized } : { valid: false, errors: result.errors, warnings: [] };
  }
  if (domain === 'equipment') {
    const result = equipmentFillAdapter.validateAiDraft(typeof input === 'string' ? input : JSON.stringify(input));
    return result.ok ? { valid: true, errors: [], warnings: [], normalized: result.normalized } : { valid: false, errors: result.errors, warnings: [] };
  }
  return { valid: false, errors: [`Unsupported fill domain: ${domain}`], warnings: [] };
}

export function getLegacyFillTemplate(domain: string) {
  if (domain === 'buff') return { format: 'BuffFillAiDraft', schema: createBuffFillAiDraftSchema() };
  if (domain === 'weapon') return { format: 'weapon.fill', schema: WEAPON_FILL_AI_DRAFT_SCHEMA };
  if (domain === 'operator') return { format: 'operator.fill', schema: domainCores.operator.schema(), data: operatorFillAdapter.buildTaskPackage().data };
  if (domain === 'equipment') return { format: 'equipment.fill', schema: domainCores.equipment.schema(), data: equipmentFillAdapter.buildTaskPackage().data };
  throw new TypeError(`Unsupported fill domain: ${domain}`);
}

export function summarizeLegacyFillProposal(domain: string, payload: unknown) {
  if (domain === 'buff') {
    const draft = payload as { items?: Record<string, { effects?: Record<string, unknown> }> };
    const items = Object.values(draft.items || {});
    return `buff fill: items=${items.length} effects=${items.reduce((sum, item) => sum + Object.keys(item.effects || {}).length, 0)}`;
  }
  const core = domainCores[domain as keyof typeof domainCores];
  if (!core) throw new TypeError(`Unsupported fill domain: ${domain}`);
  return core.summarize(payload as never);
}

export function targetLegacyFillProposal(domain: string, payload: unknown) {
  if (domain === 'buff') return typeof (payload as { id?: unknown })?.id === 'string' ? (payload as { id: string }).id : '';
  const core = domainCores[domain as keyof typeof domainCores];
  if (!core) throw new TypeError(`Unsupported fill domain: ${domain}`);
  return core.targetId(payload as never);
}
