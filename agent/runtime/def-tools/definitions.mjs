const executeCommand = 'Wraps current main workbench command queue; enqueue success still requires verification.';
const workNode = 'Uses appdata/localdata AI work node; current checkout changes only on checkout/restore.';

export const DEF_EQUIPMENT_3PLUS1_QUERY_MAX_LENGTH = 160;
export const DEF_EQUIPMENT_3PLUS1_MAX_DISTINCT_CONSTRAINT_QUERIES = 16;

/**
 * Normalize the five user-supplied 3+1 query shapes exactly as Service V1
 * does.  The public JSON Schema describes the value after this preprocessing;
 * JSON Schema itself cannot express NFKC or whitespace collapsing.
 */
export function normalizeDefEquipment3Plus1Query(value) {
  return typeof value === 'string'
    ? value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
    : value;
}

/** Count normalized constraint identities across all three query groups. */
export function countDefEquipment3Plus1DistinctConstraintQueries(constraints = {}) {
  const queries = [
    ...(Array.isArray(constraints.requiredEquipmentQueries) ? constraints.requiredEquipmentQueries : []),
    ...(Array.isArray(constraints.excludedEquipmentQueries) ? constraints.excludedEquipmentQueries : []),
    ...(Array.isArray(constraints.compareEquipmentQueries) ? constraints.compareEquipmentQueries.map((entry) => entry?.query) : []),
  ];
  return new Set(queries.map(normalizeDefEquipment3Plus1Query)).size;
}

const DEF_EQUIPMENT_3PLUS1_SLOT_SCHEMA = Object.freeze({
  type: 'string',
  enum: ['armor', 'glove', 'accessory1', 'accessory2'],
});

const DEF_EQUIPMENT_3PLUS1_DIGEST_SCHEMA = Object.freeze({
  type: 'string',
  pattern: '^sha256:[0-9a-f]{64}$',
});

const DEF_EQUIPMENT_3PLUS1_QUERY_SCHEMA = Object.freeze({
  type: 'string',
  minLength: 1,
  maxLength: DEF_EQUIPMENT_3PLUS1_QUERY_MAX_LENGTH,
  pattern: '\\S',
  description: 'After NFKC normalization, trimming, and collapsing consecutive whitespace to one space: 1-160 characters. The tool surface performs this preprocessing before dispatch.',
});

const DEF_EQUIPMENT_3PLUS1_MISSING_FACT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['code', 'field', 'message'],
  properties: {
    code: { type: 'string' },
    field: { type: 'string' },
    message: { type: 'string' },
  },
});

const DEF_EQUIPMENT_3PLUS1_AMBIGUITY_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['field', 'candidateCount', 'truncated', 'candidates'],
  properties: {
    field: { type: 'string' },
    candidateCount: { type: 'integer', minimum: 0 },
    truncated: { type: 'boolean' },
    candidates: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'kind'],
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          kind: { type: 'string' },
        },
      },
    },
  },
});

const DEF_EQUIPMENT_3PLUS1_RANKING_BASIS_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['preferenceKey', 'preferenceLabel', 'preferenceKind', 'priorityIndex', 'weight', 'facts'],
  properties: {
    preferenceKey: { type: 'string' },
    preferenceLabel: { type: 'string' },
    preferenceKind: { type: 'string' },
    priorityIndex: { type: 'integer', minimum: 0 },
    weight: { type: 'number' },
    facts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'effectId', 'label', 'typeKey'],
        properties: {
          path: { type: 'string' },
          effectId: { type: 'string' },
          label: { type: 'string' },
          typeKey: { type: 'string' },
        },
      },
    },
  },
});

export const DEF_EQUIPMENT_3PLUS1_RECOMMEND_INPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['operatorQuery'],
  properties: {
    operatorQuery: DEF_EQUIPMENT_3PLUS1_QUERY_SCHEMA,
    setQuery: DEF_EQUIPMENT_3PLUS1_QUERY_SCHEMA,
    constraints: {
      type: 'object',
      additionalProperties: false,
      description: 'After normalized query identities are deduplicated across required, excluded, and compare groups, at most 16 distinct normalized queries remain. The tool surface enforces this cross-field limit before dispatch.',
      properties: {
        requiredEquipmentQueries: {
          type: 'array',
          maxItems: 4,
          default: [],
          items: DEF_EQUIPMENT_3PLUS1_QUERY_SCHEMA,
        },
        excludedEquipmentQueries: {
          type: 'array',
          maxItems: 8,
          default: [],
          items: DEF_EQUIPMENT_3PLUS1_QUERY_SCHEMA,
        },
        compareEquipmentQueries: {
          type: 'array',
          maxItems: 8,
          default: [],
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['query'],
            properties: {
              query: DEF_EQUIPMENT_3PLUS1_QUERY_SCHEMA,
              slot: DEF_EQUIPMENT_3PLUS1_SLOT_SCHEMA,
            },
          },
        },
        duplicateAccessoryPolicy: {
          type: 'string',
          enum: ['catalog-default', 'allow', 'forbid'],
          default: 'catalog-default',
        },
        minimumSetPieces: {
          type: 'integer',
          enum: [3, 4],
          default: 3,
        },
      },
    },
    requirements: {
      type: 'array',
      maxItems: 1,
      description: 'Optional controlled evidence requirement. It requests verification but carries no proof or free text; the Service derives the operator damage type and validates trusted set-effect trigger facts.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'setEffect'],
        properties: {
          kind: { const: 'operator-element-damage-triggers-set-effect' },
          setEffect: { const: 'secondary' },
        },
      },
    },
    shortlistLimit: {
      type: 'integer',
      enum: [1, 2, 3],
      default: 3,
    },
    priorPlanDigest: DEF_EQUIPMENT_3PLUS1_DIGEST_SCHEMA,
  },
});

export const DEF_EQUIPMENT_3PLUS1_RECOMMEND_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['protocolVersion', 'contract', 'state', 'requestDigest', 'sourceRefs', 'completeness', 'missing', 'ambiguities', 'result'],
  properties: {
    protocolVersion: { const: 1 },
    contract: { const: 'DefEquipmentThreePlusOneRecommendationV1' },
    state: { type: 'string', enum: ['READY', 'NEEDS_INPUT', 'UNRESOLVED'] },
    requestDigest: DEF_EQUIPMENT_3PLUS1_DIGEST_SCHEMA,
    sourceRefs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'id'],
        properties: {
          kind: { type: 'string', enum: ['guide', 'catalog', 'convention', 'user-constraint'] },
          id: { type: 'string' },
          revision: { type: 'string' },
          sectionId: { type: 'string' },
        },
      },
    },
    completeness: { type: 'string', enum: ['complete', 'partial'] },
    missing: { type: 'array', items: DEF_EQUIPMENT_3PLUS1_MISSING_FACT_SCHEMA },
    ambiguities: { type: 'array', items: DEF_EQUIPMENT_3PLUS1_AMBIGUITY_SCHEMA },
    result: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['operator', 'profileEvidence', 'catalogEvidence', 'selectedSet', 'plans', 'comparisons', 'planDigest'],
          properties: {
            operator: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'name'],
              properties: { id: { type: 'string' }, name: { type: 'string' } },
            },
            profileEvidence: {
              type: 'object',
              additionalProperties: false,
              required: ['state', 'profileHash', 'preferenceGroups', 'evidenceRefs'],
              properties: {
                state: { type: 'string', enum: ['GUIDE_FOUND', 'PARTIAL_GUIDE_FOUND', 'GUIDE_NOT_FOUND'] },
                profileHash: DEF_EQUIPMENT_3PLUS1_DIGEST_SCHEMA,
                preferenceGroups: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['key', 'label', 'kind', 'acceptedTypeKeys'],
                    properties: {
                      key: { type: 'string' },
                      label: { type: 'string' },
                      kind: { type: 'string', enum: ['primary-attribute', 'secondary-attribute', 'elemental-damage', 'skill-damage', 'general-damage', 'other'] },
                      acceptedTypeKeys: { type: 'array', items: { type: 'string' } },
                    },
                  },
                },
                evidenceRefs: { type: 'array', items: { type: 'string' } },
              },
            },
            catalogEvidence: {
              type: 'object',
              additionalProperties: false,
              required: ['revision', 'exhaustive'],
              properties: { revision: { type: 'string' }, exhaustive: { const: true } },
            },
            requirementEvidence: {
              type: 'array',
              maxItems: 1,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['kind', 'setEffect', 'state', 'operatorElement', 'damageType', 'setEffectId', 'factPath', 'trigger'],
                properties: {
                  kind: { const: 'operator-element-damage-triggers-set-effect' },
                  setEffect: { const: 'secondary' },
                  state: { const: 'PROVEN' },
                  operatorElement: { type: 'string' },
                  damageType: { type: 'string', enum: ['ice', 'fire', 'electric', 'nature', 'physical'] },
                  setEffectId: { type: 'string' },
                  factPath: { type: 'string' },
                  trigger: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['kind', 'producer', 'damageType', 'count'],
                    properties: {
                      kind: { const: 'damage-count' },
                      producer: { const: 'equipper' },
                      damageType: { type: 'string', enum: ['ice', 'fire', 'electric', 'nature', 'physical', 'magic'] },
                      count: { type: 'integer', minimum: 1 },
                    },
                  },
                },
              },
            },
            selectedSet: {
              anyOf: [
                { type: 'null' },
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['id', 'name', 'matchKeys', 'rankingBasis'],
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    matchKeys: { type: 'array', items: { type: 'string' } },
                    rankingBasis: { type: 'array', items: DEF_EQUIPMENT_3PLUS1_RANKING_BASIS_SCHEMA },
                  },
                },
              ],
            },
            plans: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['planId', 'items', 'setMembershipCount', 'missing', 'ambiguities'],
                properties: {
                  planId: DEF_EQUIPMENT_3PLUS1_DIGEST_SCHEMA,
                  items: {
                    type: 'array',
                    minItems: 4,
                    maxItems: 4,
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['stableId', 'name', 'slot', 'setId', 'matchKeys', 'rankingBasis'],
                      properties: {
                        stableId: { type: 'string' },
                        name: { type: 'string' },
                        slot: DEF_EQUIPMENT_3PLUS1_SLOT_SCHEMA,
                        setId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                        matchKeys: { type: 'array', items: { type: 'string' } },
                        rankingBasis: { type: 'array', items: DEF_EQUIPMENT_3PLUS1_RANKING_BASIS_SCHEMA },
                      },
                    },
                  },
                  setMembershipCount: { type: 'integer', minimum: 0, maximum: 4 },
                  missing: { type: 'array', items: DEF_EQUIPMENT_3PLUS1_MISSING_FACT_SCHEMA },
                  ambiguities: { type: 'array', items: DEF_EQUIPMENT_3PLUS1_AMBIGUITY_SCHEMA },
                },
              },
            },
            comparisons: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['query', 'candidate', 'slot', 'decision', 'reasons', 'missing'],
                properties: {
                  query: { type: 'string' },
                  candidate: {
                    anyOf: [
                      { type: 'null' },
                      {
                        type: 'object',
                        additionalProperties: false,
                        required: ['stableId', 'name'],
                        properties: { stableId: { type: 'string' }, name: { type: 'string' } },
                      },
                    ],
                  },
                  slot: { anyOf: [DEF_EQUIPMENT_3PLUS1_SLOT_SCHEMA, { type: 'null' }] },
                  selectedStableId: { type: 'string' },
                  decision: { type: 'string', enum: ['selected', 'not-selected', 'unresolved'] },
                  reasons: { type: 'array', items: { type: 'string' } },
                  missing: { type: 'array', items: DEF_EQUIPMENT_3PLUS1_MISSING_FACT_SCHEMA },
                },
              },
            },
            planDigest: { anyOf: [DEF_EQUIPMENT_3PLUS1_DIGEST_SCHEMA, { type: 'null' }] },
          },
        },
      ],
    },
    nextQuestion: {
      type: 'object',
      additionalProperties: false,
      required: ['field', 'prompt'],
      properties: {
        field: { type: 'string' },
        prompt: { type: 'string' },
        options: {
          type: 'array',
          maxItems: 8,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'label'],
            properties: { id: { type: 'string' }, label: { type: 'string' } },
          },
        },
      },
    },
    supersedesPlanDigest: DEF_EQUIPMENT_3PLUS1_DIGEST_SCHEMA,
  },
  allOf: [
    {
      if: { properties: { state: { const: 'READY' } }, required: ['state'] },
      then: {
        required: ['result'],
        properties: {
          result: {
            type: 'object',
            required: ['selectedSet', 'plans', 'planDigest'],
            properties: {
              selectedSet: { type: 'object' },
              plans: { type: 'array', minItems: 1, maxItems: 3 },
              planDigest: DEF_EQUIPMENT_3PLUS1_DIGEST_SCHEMA,
            },
          },
        },
      },
    },
    {
      if: { properties: { state: { const: 'NEEDS_INPUT' } }, required: ['state'] },
      then: { required: ['nextQuestion'], properties: { result: { type: 'null' } } },
    },
    {
      if: { properties: { state: { const: 'UNRESOLVED' } }, required: ['state'] },
      then: {
        properties: { result: { type: 'null' } },
        anyOf: [
          { properties: { missing: { minItems: 1 } } },
          { properties: { ambiguities: { minItems: 1 } } },
        ],
      },
    },
  ],
});

export const DEF_EQUIPMENT_3PLUS1_RECOMMEND_ERROR_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['contract', 'code', 'failureStage', 'retryable', 'nextAction', 'message'],
  properties: {
    contract: { const: 'DefEquipmentThreePlusOneRecommendationErrorV1' },
    code: { type: 'string' },
    failureStage: {
      type: 'string',
      enum: ['validate-input', 'authorize-session', 'resolve-operator', 'resolve-profile', 'capture-catalog', 'resolve-constraints', 'resolve-set', 'validate-facts', 'solve-plan', 'build-evidence'],
    },
    retryable: { type: 'boolean' },
    nextAction: { type: 'string', enum: ['FIX_INPUT', 'RETRY_FRESH_TURN', 'REPORT_AND_STOP'] },
    message: { type: 'string' },
    sourceRevision: { type: 'string' },
    details: { type: 'object', additionalProperties: true },
  },
});

export const DEF_TOOL_DEFINITION_BASE = Object.freeze([
  { name: 'def.tool.list', scope: 'read', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'List DEF typed tools.' },
  { name: 'def.tool.describe', scope: 'read', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Describe one DEF typed tool.' },
  { name: 'def.workbench.snapshot', scope: 'read', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Read the current checkout snapshot mirror.' },
  { name: 'def.workbench.bind_session_axis', scope: 'governance', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Persist a Workbench session binding to a timeline document and Work Node tree.' },
  { name: 'def.workbench.assert_timeline_admission', scope: 'governance', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Validate that an existing non-temporary SQLite workspace may open a Workbench DEF session.' },
  { name: 'def.workbench.assert_session_axis', scope: 'governance', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Validate an existing immutable Workbench session-to-SQLite binding.' },
  { name: 'def.workbench.unbind_session_axis', scope: 'governance', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Remove a persisted Workbench session-to-axis binding without deleting the timeline tree.' },
  { name: 'def.native_catalog.register_session', scope: 'governance', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Register one authenticated native session for the short-lived native catalog artifact bridge. Internal native host only.' },
  { name: 'def.workbench.evidence', scope: 'read', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Read bounded current-checkout evidence for the model.' },
  { name: 'def.workbench.list_buttons', scope: 'read', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'List skill buttons with stable ids and labels.' },
  { name: 'def.workbench.list_characters', scope: 'read', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'List selected characters and compact config summary.' },
  { name: 'def.team.loadouts.read', scope: 'read', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Read all selected operators and their exact current loadouts from one Workbench snapshot.' },
  { name: 'def.loadout.candidates.read', scope: 'read', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Aggregate bounded compatible weapon and equipment-set candidates for the selected team without applying changes.' },
  { name: 'def.team.loadout.plan.prepare', scope: 'read', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Resolve the session-bound exact guide section into one immutable DefTeamLoadoutPlanV1 without applying changes.' },
  { name: 'def.team.loadout.plan.revise', scope: 'read', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Confirm only an offered plan decision/option pair and create a new immutable plan hash; it does not mutate configuration.' },
  { name: 'def.team.loadout.plan.apply', scope: 'current-checkout', riskLevel: 'medium', approval: 'ai-review', status: 'implemented', description: 'Apply one previously prepared READY team loadout plan serially after native approval.' },
  { name: 'def.workbench.damage_report', scope: 'read', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Read compact damage report.' },
  { name: 'def.workbench.find_buttons', scope: 'read', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Resolve button candidates from query, character, skill, type, and position.' },
  { name: 'def.workbench.rank_buttons_by_buff', scope: 'read', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Rank current-checkout buttons by selected Buff count, with stable button ids and coordinates.' },
  { name: 'def.buff.resolve', scope: 'read', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Resolve buff candidates from current button buffs, equipped effects, and gear-set three-piece buffs.' },
  { name: 'def.buff.search_candidates', scope: 'read', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Wide buff candidate search; alias of def.buff.resolve for now.' },
  { name: 'def.skill.resolve', scope: 'read', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Resolve trusted selected-operator skill identities plus exact operator-catalog hit facts, elements, per-hit damage types and level multipliers.' },
  { name: 'def.character.resolve', scope: 'read', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Resolve only characters selected in the current Workbench checkout; an empty result never proves that a character is absent from the selection catalog.' },
  { name: 'def.operator.catalog.search', scope: 'read', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Search the bounded local operator catalog used by the selection screen. This is read-only and never changes the current selected roster.' },
  { name: 'def.team.selection.apply', commandOp: 'selectCharacters', scope: 'current-checkout', riskLevel: 'high', approval: 'user-confirm', status: 'implemented', description: 'Apply one exact selected roster after native user approval. Partial roster changes create a horizontal Work Node; only a four-for-four disjoint roster creates a new temporary SQLite workspace.' },
  { name: 'def.operator.build.guide', scope: 'session-private', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Resolve one exact operator and discover allowlisted operator-specific build evidence before any skill-derived fallback.' },
  { name: 'def.operator.build.profile', scope: 'session-private', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Derive one compact operator attribute/effect-priority profile only with the same-turn fallback token issued by guide discovery.' },
  { name: 'def.knowledge.combat_conventions.resolve', scope: 'session-private', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Resolve one bounded connected rule bundle from reviewed combat-convention Markdown without searching source-faithful guides.' },
  { name: 'def.knowledge.game.search', scope: 'read', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Search allowlisted game-knowledge Markdown references and return stable referenceId plus heading indexes. This does not grant arbitrary filesystem access.' },
  { name: 'def.knowledge.game.section.read', scope: 'read', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Read one bounded continuous section from an exact allowlisted game-knowledge referenceId plus sectionId.' },
  { name: 'def.equipment.resolve', scope: 'read', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Resolve stable equipment ids and gear sets from the immutable active game catalog; supports bounded batch and ASR-tolerant ranked candidates with an exact catalog version.' },
  { name: 'def.weapon.resolve', scope: 'read', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Search the immutable active game catalog for weapons; results carry an exact catalog version and are never limited to currently equipped weapons.' },
  { name: 'def.weapon.fit.plan', scope: 'session-private', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Exhaustively compare all compatible current-catalog weapons using one authorized operator profile and reviewed combat-convention bundle.' },
  { name: 'def.native_catalog.materialize', scope: 'session-private', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Capture one deterministic, read-only equipment or weapon catalog projection for a native session-local retrieval artifact.' },
  { name: 'def.equipment.set_fit.shortlist', scope: 'session-private', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Legacy compatibility: read-only equipment set-fit shortlist retained for supported legacy sessions and Harness packages.' },
  { name: 'def.equipment.3plus1.facts', scope: 'session-private', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Legacy compatibility: read-only 3+1 equipment facts retained for supported legacy sessions and Harness packages.' },
  { name: 'def.equipment.3plus1.plan', scope: 'session-private', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Legacy compatibility: read-only 3+1 equipment plan retained for supported legacy sessions and Harness packages.' },
  {
    name: 'def.equipment.3plus1.recommend',
    scope: 'session-private',
    riskLevel: 'read',
    approval: 'none',
    status: 'implemented',
    description: 'Return one read-only, evidence-backed 3+1 equipment recommendation for an operator with optional set, equipment, comparison, controlled trigger-reachability, and prior-plan constraints. Returns READY, NEEDS_INPUT, or UNRESOLVED; typed failures use DefEquipmentThreePlusOneRecommendationErrorV1.',
    inputSchema: DEF_EQUIPMENT_3PLUS1_RECOMMEND_INPUT_SCHEMA,
    outputSchema: DEF_EQUIPMENT_3PLUS1_RECOMMEND_OUTPUT_SCHEMA,
    errorSchema: DEF_EQUIPMENT_3PLUS1_RECOMMEND_ERROR_SCHEMA,
  },
  { name: 'def.gear.resolve', scope: 'read', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Resolve gear/equipment candidates and gear-set three-piece buff summaries; preferred for equipment-set explanation.' },
  { name: 'def.workbench.add_skill_button', commandOp: 'addSkillButton', scope: 'current-checkout', riskLevel: 'low', approval: 'auto', status: 'implemented', description: executeCommand },
  { name: 'def.workbench.add_skill_button_and_verify', scope: 'current-checkout', riskLevel: 'low', approval: 'auto', status: 'implemented', description: 'Add one skill button, wait for browser command execution, then return command result and snapshot verification.' },
  { name: 'def.workbench.remove_skill_button', commandOp: 'removeSkillButton', scope: 'current-checkout', riskLevel: 'medium', approval: 'ai-review', status: 'implemented', description: executeCommand },
  { name: 'def.buff.add_to_button', commandOp: 'addBuff', scope: 'current-checkout', riskLevel: 'medium', approval: 'auto', status: 'implemented', description: executeCommand },
  { name: 'def.buff.add_to_button_and_verify', scope: 'current-checkout', riskLevel: 'medium', approval: 'auto', status: 'implemented', description: 'Add one buff to one button, wait for browser command execution, then verify the target button contains that buff.' },
  { name: 'def.buff.add_to_buttons', scope: 'appdata-work-node', riskLevel: 'high', approval: 'ai-review', status: 'implemented', description: 'Batch mutation: stage one attachBuff patch per button in a Work Node and expose validate/diff/risk evidence before checkout.' },
  { name: 'def.buff.remove_from_button', commandOp: 'removeBuff', scope: 'current-checkout', riskLevel: 'medium', approval: 'ai-review', status: 'implemented', description: executeCommand },
  { name: 'def.target.set_resistance', commandOp: 'setTargetResistance', scope: 'current-checkout', riskLevel: 'low', approval: 'auto', status: 'implemented', description: executeCommand },
  { name: 'def.damage.calculate', commandOp: 'calculateDamage', scope: 'current-checkout', riskLevel: 'low', approval: 'auto', status: 'implemented', description: executeCommand },
  { name: 'def.damage.calculate_and_verify', scope: 'current-checkout', riskLevel: 'low', approval: 'auto', status: 'implemented', description: 'Trigger damage calculation, wait briefly for command execution, then return command and damage report verification.' },
  { name: 'def.worknode.create_from_current', scope: 'appdata-work-node', riskLevel: 'medium', approval: 'auto', status: 'implemented', description: 'Synchronously fork the current payload mirror into an isolated SQLite Work Node without touching checkout.' },
  { name: 'def.worknode.list', scope: 'appdata-work-node', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'List bounded SQLite Work Node metadata without payloads.' },
  { name: 'def.worknode.delete', scope: 'appdata-work-node', riskLevel: 'high', approval: 'user-confirm', status: 'implemented', description: 'Delete one non-checked-out Work Node subtree after repository protection checks.' },
  { name: 'def.worknode.patch', commandOp: 'patchAiTimelineWorkNode', scope: 'appdata-work-node', riskLevel: 'high', approval: 'ai-review', status: 'implemented', description: 'Class-code Patch DSL / CRUD tool for node.workingPayload.' },
  { name: 'def.worknode.sync_workspace', scope: 'appdata-work-node', riskLevel: 'high', approval: 'ai-review', status: 'implemented', description: 'Replace node.workingPayload from an isolated OpenCode child-node workspace, then validate and compute diff without touching current checkout.' },
  { name: 'def.worknode.patch_and_validate', scope: 'appdata-work-node', riskLevel: 'high', approval: 'ai-review', status: 'implemented', description: 'Apply a constrained work node patch, validate, then immediately checkout and verify explicit low-risk user mutations without reloading. Use checkout:false only to stage a draft.' },
  { name: 'def.worknode.copy_staff_line_and_verify', scope: 'appdata-work-node', riskLevel: 'high', approval: 'ai-review', status: 'implemented', description: 'Directly copy one complete timeline staff line into another work-node line, validate it, then checkout and verify.' },
  { name: 'def.worknode.diff', commandOp: 'diffAiTimelineWorkNode', scope: 'appdata-work-node', riskLevel: 'read', approval: 'none', status: 'implemented', description: workNode },
  { name: 'def.worknode.checkout', commandOp: 'checkoutAiTimelineWorkNode', scope: 'appdata-work-node', riskLevel: 'high', approval: 'ai-review', status: 'implemented', description: workNode },
  { name: 'def.worknode.checkout_and_verify', scope: 'appdata-work-node', riskLevel: 'high', approval: 'ai-review', status: 'implemented', description: 'Checkout a work node with reload:false by default, wait briefly for renderer execution, and verify current checkout snapshot.' },
  { name: 'def.worknode.restore_base', commandOp: 'restoreAiTimelineWorkNodeBase', scope: 'appdata-work-node', riskLevel: 'high', approval: 'ai-review', status: 'implemented', description: workNode },
  { name: 'def.worknode.restore_base_and_verify', scope: 'appdata-work-node', riskLevel: 'high', approval: 'ai-review', status: 'implemented', description: 'Restore a work node basePayload with reload:false by default, wait briefly for renderer execution, and verify current checkout snapshot.' },
  { name: 'def.worknode.read', scope: 'appdata-work-node', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Read appdata work node state without touching current checkout.' },
  { name: 'def.worknode.validate', scope: 'appdata-work-node', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Validate work node basePayload and workingPayload without checkout.' },
  { name: 'def.user.ask', scope: 'governance', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Record a formal low-blocking question for user follow-up.' },
  { name: 'def.user.record_answer', scope: 'governance', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Persist the decision from an OpenCode native question interaction.' },
  { name: 'def.approval.request', scope: 'governance', riskLevel: 'medium', approval: 'user-confirm', status: 'implemented', description: 'Record an approval request without forcing every warning into a blocker.' },
  { name: 'def.approval.record_decision', scope: 'governance', riskLevel: 'medium', approval: 'ai-review', status: 'implemented', description: 'Record approval rationale into local audit.' },
  { name: 'def.verify.command_result', scope: 'verification', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Verify command or batch status from result log/queue.' },
  { name: 'def.verify.snapshot_delta', scope: 'verification', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Return compact snapshot facts for caller-side delta checks.' },
  { name: 'def.verify.buttons_have_buff', scope: 'verification', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Verify target buttons contain a buff by id/name/displayName.' },
  { name: 'def.verify.damage_recalculated', scope: 'verification', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Verify damage report exists and expose generatedAt/total.' },
  { name: 'def.verify.worknode_diff_clean', scope: 'verification', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Verify work node diff/risk before checkout.' },
  { name: 'def.operator.config.read', scope: 'read', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Read compact operator config summary from snapshot.' },
  { name: 'def.operator.config.preview', scope: 'current-checkout', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Compute and verify one exact operator configuration proposal without creating a branch, requesting approval, or applying it.' },
  { name: 'def.operator.config.patch', scope: 'current-checkout', riskLevel: 'medium', approval: 'ai-review', status: 'implemented', description: 'Structured operator config patch for weapon/equipment fields.' },
  { name: 'def.gear.set_entry_level', scope: 'current-checkout', riskLevel: 'medium', approval: 'ai-review', status: 'implemented', description: 'Set equipped gear entry level through structured config commands.' },
]);
