import type { CandidateBuff } from '../../core/domain/buff';
import type { TimelineWorkNodePatchOperation } from '../../agentKernel/timelineWorktree/patchDsl';
import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';
import type { SkillButtonBuff } from '../../types/storage';

export interface TrustedTimelineSkillFact {
  characterId: string;
  characterName: string;
  skillId: string;
  skillType: 'A' | 'B' | 'E' | 'Q' | 'Dot';
  skillDisplayName: string;
}

export interface TrustedTimelineMutationInput {
  payload: TimelineSnapshotPayload;
  patch: readonly TimelineWorkNodePatchOperation[];
  skillCatalog: readonly TrustedTimelineSkillFact[];
  candidateBuffs: readonly CandidateBuff[];
}

export class TrustedTimelineMutationError extends Error {
  readonly code: string;
  readonly path: string;

  constructor(code: string, message: string, path: string) {
    super(`${path}: ${message}`);
    this.name = 'TrustedTimelineMutationError';
    this.code = code;
    this.path = path;
  }
}

type TimelinePatchBuff = NonNullable<Extract<TimelineWorkNodePatchOperation, {
  op: 'attachBuff';
}>['buff']>;

const BUFF_DEFINITION_FIELDS = [
  'name',
  'displayName',
  'sourceName',
  'level',
  'type',
  'value',
  'description',
  'source',
  'condition',
  'category',
  'ownerBuffDomain',
  'ownerCharacterId',
  'ownerBuffGroup',
  'maxStacks',
  'multiplier',
  'effectKind',
  'extraHitConfig',
  'valueMode',
  'derivedValue',
] as const;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`)
    .join(',')}}`;
}

function normalizedBuffDefinition(value: Partial<CandidateBuff & SkillButtonBuff>): Record<string, unknown> {
  const source = value as Record<string, unknown>;
  const definition: Record<string, unknown> = {};
  for (const field of BUFF_DEFINITION_FIELDS) {
    if (source[field] !== undefined) definition[field] = clone(source[field]);
  }
  definition.category = value.category === 'countable' || value.category === 'passive'
    ? value.category
    : 'condition';
  return definition;
}

function toPatchBuff(candidate: CandidateBuff, requested: TimelinePatchBuff): TimelinePatchBuff {
  const definition = normalizedBuffDefinition(candidate) as TimelinePatchBuff;
  return {
    ...definition,
    ...(requested.target === undefined ? {} : { target: clone(requested.target) }),
  };
}

function resolveTrustedCandidateBuff(
  requested: TimelinePatchBuff,
  candidateBuffs: readonly CandidateBuff[],
  path: string,
): TimelinePatchBuff {
  const requestedDigest = stable(normalizedBuffDefinition(requested));
  const matches = candidateBuffs.filter((candidate) => (
    stable(normalizedBuffDefinition(candidate)) === requestedDigest
  ));
  if (matches.length === 0) {
    throw new TrustedTimelineMutationError(
      'BUFF_FACT_UNTRUSTED',
      'Buff 定义无法在当前浏览器候选目录中精确解析，拒绝写入模型提供的任意数值。',
      path,
    );
  }
  return toPatchBuff(matches[0]!, requested);
}

function resolveTargetButton(
  payload: TimelineSnapshotPayload,
  target: Extract<TimelineWorkNodePatchOperation, { op: 'replaceButton' }>['target'],
  path: string,
) {
  const candidates = Object.values(payload.skillButtonTable).filter((button) => {
    if (target.buttonId && button.id !== target.buttonId) return false;
    if (target.characterId && button.characterId !== target.characterId) return false;
    if (target.characterName && button.characterName !== target.characterName) return false;
    if (target.skillType && button.skillType !== target.skillType) return false;
    if (typeof target.nodeIndex === 'number' && button.nodeIndex !== target.nodeIndex) return false;
    return true;
  });
  if (candidates.length === 0) {
    throw new TrustedTimelineMutationError('BUTTON_NOT_FOUND', '目标技能按钮不存在。', path);
  }
  if (candidates.length > 1 && target.latest !== true) {
    throw new TrustedTimelineMutationError('BUTTON_AMBIGUOUS', '目标技能按钮不唯一。', path);
  }
  return [...candidates].sort((left, right) => (
    right.staffIndex - left.staffIndex
    || right.nodeIndex - left.nodeIndex
    || Number(right.updatedAt ?? 0) - Number(left.updatedAt ?? 0)
    || right.id.localeCompare(left.id)
  ))[0]!;
}

function resolveTrustedSkill(
  requested: {
    characterId: string;
    characterName: string;
    runtimeSkillId?: string;
    skillDisplayName?: string;
    skillType?: string;
  },
  skillCatalog: readonly TrustedTimelineSkillFact[],
  path: string,
): TrustedTimelineSkillFact {
  if (!requested.runtimeSkillId?.trim() && !requested.skillDisplayName?.trim()) {
    throw new TrustedTimelineMutationError(
      'SKILL_IDENTITY_REQUIRED',
      '技能写入必须携带可信目录返回的 runtimeSkillId 或完整技能名，不能只靠 A/B/E/Q 类型猜测。',
      path,
    );
  }
  const matches = skillCatalog.filter((skill) => {
    if (skill.characterId !== requested.characterId || skill.characterName !== requested.characterName) return false;
    if (requested.runtimeSkillId && skill.skillId !== requested.runtimeSkillId) return false;
    if (requested.skillDisplayName && skill.skillDisplayName !== requested.skillDisplayName) return false;
    if (requested.skillType && skill.skillType !== requested.skillType) return false;
    return true;
  });
  if (matches.length !== 1) {
    throw new TrustedTimelineMutationError(
      matches.length === 0 ? 'SKILL_FACT_UNTRUSTED' : 'SKILL_FACT_AMBIGUOUS',
      matches.length === 0
        ? '技能身份无法在当前已选干员的可信技能目录中精确解析。'
        : '技能身份匹配到多个可信目录项。',
      path,
    );
  }
  return matches[0]!;
}

function bindExistingOrCandidateBuff(
  payload: TimelineSnapshotPayload,
  operation: Extract<TimelineWorkNodePatchOperation, { op: 'attachBuff' | 'replaceBuff' }>,
  candidateBuffs: readonly CandidateBuff[],
  path: string,
): TimelineWorkNodePatchOperation {
  const requestedId = operation.op === 'attachBuff'
    ? operation.buffId
    : operation.replacementBuffId;
  if (requestedId) {
    const existing = payload.allBuffList.find((buff) => buff.id === requestedId);
    if (!existing) {
      throw new TrustedTimelineMutationError(
        'BUFF_ID_UNTRUSTED',
        `Buff id ${requestedId} 不在当前正式 payload 中。`,
        path,
      );
    }
    if (operation.buff) {
      const requestedDigest = stable(normalizedBuffDefinition(operation.buff));
      const existingDigest = stable(normalizedBuffDefinition(existing));
      if (requestedDigest !== existingDigest) {
        throw new TrustedTimelineMutationError(
          'BUFF_ID_CONTENT_MISMATCH',
          `Buff id ${requestedId} 与模型提供的定义不一致。`,
          path,
        );
      }
    }
    if (operation.op === 'attachBuff') {
      return { ...clone(operation), buffId: existing.id, buff: undefined };
    }
    return { ...clone(operation), replacementBuffId: existing.id, buff: undefined };
  }
  if (!operation.buff) {
    throw new TrustedTimelineMutationError('BUFF_IDENTITY_REQUIRED', '缺少可解析的 Buff 身份。', path);
  }
  const buff = resolveTrustedCandidateBuff(operation.buff, candidateBuffs, `${path}.buff`);
  if (operation.op === 'attachBuff') return { ...clone(operation), buffId: undefined, buff };
  return { ...clone(operation), replacementBuffId: undefined, buff };
}

/**
 * Rebinds every fact-bearing mutation to browser-owned facts before a Work
 * Node candidate is created. Structural moves/removals remain unchanged;
 * model-authored skill/Buff definitions are never allowed to become data.
 */
export function bindTrustedTimelineMutation(
  input: TrustedTimelineMutationInput,
): TimelineWorkNodePatchOperation[] {
  return input.patch.map((operation, index) => {
    const path = `patch[${index}]`;
    if (operation.op === 'addButton') {
      const staffIndex = typeof operation.staffIndex === 'number'
        ? operation.staffIndex
        : typeof operation.lineIndex === 'number'
          ? operation.lineIndex
          : input.payload.timelineData.staffLines.find((line) => line.characterName === operation.characterName)?.staffIndex;
      const characterId = staffIndex === undefined ? undefined : input.payload.selectedCharacters[staffIndex];
      const staffLine = staffIndex === undefined
        ? undefined
        : input.payload.timelineData.staffLines.find((line) => line.staffIndex === staffIndex);
      if (!characterId || !staffLine || staffLine.characterName !== operation.characterName) {
        throw new TrustedTimelineMutationError(
          'SKILL_OPERATOR_UNTRUSTED',
          '技能按钮目标不是当前正式 payload 中精确绑定的已选干员。',
          path,
        );
      }
      const skill = resolveTrustedSkill({
        characterId,
        characterName: staffLine.characterName,
        runtimeSkillId: operation.runtimeSkillId,
        skillDisplayName: operation.skillDisplayName,
        skillType: operation.skillType,
      }, input.skillCatalog, path);
      return {
        ...clone(operation),
        characterId,
        characterName: staffLine.characterName,
        skillType: skill.skillType,
        runtimeSkillId: skill.skillId,
        skillDisplayName: skill.skillDisplayName,
        staffIndex,
        lineIndex: undefined,
      };
    }
    if (operation.op === 'replaceButton') {
      const target = resolveTargetButton(input.payload, operation.target, `${path}.target`);
      if (!target.characterId?.trim() || !target.characterName?.trim()) {
        throw new TrustedTimelineMutationError(
          'SKILL_OPERATOR_UNTRUSTED',
          '目标按钮缺少可验证的干员身份。',
          `${path}.target`,
        );
      }
      const skill = resolveTrustedSkill({
        characterId: target.characterId,
        characterName: target.characterName,
        runtimeSkillId: operation.runtimeSkillId,
        skillDisplayName: operation.skillDisplayName,
        skillType: operation.skillType,
      }, input.skillCatalog, path);
      return {
        ...clone(operation),
        skillType: skill.skillType,
        runtimeSkillId: skill.skillId,
        skillDisplayName: skill.skillDisplayName,
        skillIconUrl: undefined,
      };
    }
    if (operation.op === 'attachBuff' || operation.op === 'replaceBuff') {
      return bindExistingOrCandidateBuff(input.payload, operation, input.candidateBuffs, path);
    }
    return clone(operation);
  });
}
