const BUSINESS_IDS = Object.freeze(['selection', 'loadout', 'timeline', 'buff', 'calculation']);
const BUSINESS_ID_SET = new Set(BUSINESS_IDS);
const CONTINUABLE_STATUSES = new Set(['awaiting-confirmation', 'active']);
const DIRECT_CURRENT_NODE_QUESTION = /^(?:请)?(?:告诉我|查看|查询|确认)?(?:一下)?(?:当前|现在)(?:的)?(?:工作)?节点(?:是|为|叫)?(?:什么|哪个|哪一个|多少|的名称|的ID|的id)?[？?。！!]*$/;

const DEFAULT_BUSINESS_DEFINITIONS = Object.freeze([
  { businessId: 'selection', summary: '查看或改变当前队伍成员与顺序。' },
  { businessId: 'loadout', summary: '查看、推荐、预览、应用或恢复武器、装备、技能等级和配置输入。' },
  { businessId: 'timeline', summary: '查看或改变技能按钮身份、位置、顺序与排轴结构。' },
  { businessId: 'buff', summary: '查看或改变按钮 BUFF、层数、异常与相关战斗状态。' },
  { businessId: 'calculation', summary: '读取完整方案并计算、比较、归因、诊断、解释或导出统计结果。' },
]);

function normalizedText(value) {
  return String(value || '').normalize('NFKC').trim();
}

function isDirectCurrentNodeQuestion(userText = '') {
  return DIRECT_CURRENT_NODE_QUESTION.test(normalizedText(userText));
}

function classifyDefExecutableTurnPolicy(userText = '') {
  const normalized = normalizedText(userText).replace(/\s+/g, '');
  const asksSkillFacts = /(?:具体数值|倍率|伤害类型|算什么伤害|属于什么伤害|吃(?:什么|哪种|哪类)?(?:战技|终结技|大招|连携技|普攻|重击)?加成)/.test(normalized);
  const namesSkillOrHit = /(?:技能|战技|连携|终结技|大招|普攻|重击|攻击|水龙卷|图腾|层|(?:^|[^a-z])[abeq](?:[^a-z]|$))/i.test(normalized);
  const asksCurrentDamageReport = /(?:当前|这个按钮|伤害报告|总伤害|伤害面板)/.test(normalized);
  const asksEquipmentFact = /(?:武器|装备|配件|护手|护甲)/.test(normalized);
  if (asksSkillFacts && namesSkillOrHit && !asksCurrentDamageReport && !asksEquipmentFact) {
    return { kind: 'exact-skill-facts', sourceText: normalized };
  }
  return null;
}

function deterministicRoute(userText) {
  const text = normalizedText(userText);
  const executablePolicy = classifyDefExecutableTurnPolicy(text);
  if (executablePolicy?.kind === 'exact-skill-facts') {
    return {
      kind: 'new-business',
      deterministic: true,
      businessId: 'calculation',
      operation: 'skill_fact',
      target: text,
      requestedEffect: '读取并解释用户点名的精确技能或命中事实',
      constraints: ['exact-skill-facts', 'single-typed-skill-read'],
    };
  }
  if (isDirectCurrentNodeQuestion(text)) {
    return {
      kind: 'new-business',
      deterministic: true,
      businessId: 'timeline',
      operation: 'current',
      target: 'current-checkout',
      requestedEffect: '读取当前 Work Node',
      constraints: ['current-node-only'],
    };
  }
  return null;
}

function continuationIntent(userText) {
  const text = normalizedText(userText).replace(/\s+/g, '');
  if (!text) return null;
  if (/^(?:确认|同意|应用|换上|就按这套|按这套|执行)(?:应用|换上|执行|刚才|那套|该方案|此方案|它|吧|。|！|!)*$/.test(text)) return 'confirm';
  if (/^(?:拒绝|取消|不要|先不|暂不)(?:[。！!吧])?$/.test(text)) return 'reject';
  if (/^(?:继续|接着|继续处理|接着处理)(?:[。！!吧])?$/.test(text)) return 'resume';
  if (/(?:为什么不用|不对|修正|重新规划|重新推荐|(?:刚才|那套|该方案|这个方案).*(?:改成|换成)|把(?:刚才|那套|该方案|这个方案).*(?:改成|换成))/.test(text)) return 'correct';
  return null;
}

function transactionLabel(transaction) {
  return {
    transactionId: transaction.transactionId,
    businessId: transaction.businessId,
    operation: transaction.operation,
    target: transaction.target || '',
    proposalId: transaction.proposal?.id || transaction.proposalId || '',
  };
}

function matchContinuation({ userText, transactions = [] }) {
  const intent = continuationIntent(userText);
  if (!intent) return null;
  const eligibleStatuses = intent === 'confirm' || intent === 'reject'
    ? new Set(['awaiting-confirmation'])
    : intent === 'resume'
      ? new Set(['active'])
      : CONTINUABLE_STATUSES;
  const candidates = transactions.filter((transaction) => (
    transaction
    && eligibleStatuses.has(transaction.status)
    && transaction.revoked !== true
  ));
  if (candidates.length === 1) {
    return {
      kind: 'continue',
      intent,
      transactionId: candidates[0].transactionId,
      transaction: transactionLabel(candidates[0]),
    };
  }
  if (candidates.length > 1) {
    return {
      kind: 'clarify',
      reason: 'ambiguous-continuation',
      question: '你要继续哪一个待处理方案？',
      choices: candidates.map(transactionLabel),
    };
  }
  if (intent === 'correct') return null;
  return {
    kind: 'clarify',
    reason: 'continuation-not-found',
    question: '当前没有唯一可继续的候选，请说明要处理的业务和目标。',
    choices: [],
  };
}

function normalizeStep(step, index, definitions) {
  const businessId = normalizedText(step?.businessId);
  const operation = normalizedText(step?.operation);
  const target = normalizedText(step?.target);
  const requestedEffect = normalizedText(step?.requestedEffect);
  if (!BUSINESS_ID_SET.has(businessId)) throw routeError(`steps[${index}].businessId is invalid`);
  const definition = definitions.get(businessId);
  if (definition?.operations && !definition.operations.includes(operation)) {
    throw routeError(`steps[${index}].operation is not supported by ${businessId}`);
  }
  if (!operation) throw routeError(`steps[${index}].operation is required`);
  if (!requestedEffect) throw routeError(`steps[${index}].requestedEffect is required`);
  return {
    businessId,
    operation,
    target,
    requestedEffect,
    constraints: Array.isArray(step?.constraints)
      ? step.constraints.map(normalizedText).filter(Boolean)
      : [],
  };
}

function routeError(message) {
  const error = new Error(message);
  error.code = 'HARNESS_ROUTE_INVALID';
  return error;
}

function definitionMap(definitions) {
  const source = Array.isArray(definitions) ? definitions : DEFAULT_BUSINESS_DEFINITIONS;
  return new Map(source.map((definition) => [definition.businessId, definition]));
}

function validateRouteSubmission(submission, { definitions } = {}) {
  if (!submission || typeof submission !== 'object' || Array.isArray(submission)) throw routeError('route submission must be an object');
  const knownDefinitions = definitionMap(definitions);
  const kind = normalizedText(submission.kind);
  if (kind === 'clarify') {
    const question = normalizedText(submission.question);
    const ambiguity = normalizedText(submission.ambiguity);
    if (!question || !ambiguity) throw routeError('clarify route requires question and ambiguity');
    return {
      kind,
      question,
      ambiguity,
      choices: Array.isArray(submission.choices)
        ? submission.choices.map(normalizedText).filter(Boolean).slice(0, 8)
        : [],
    };
  }
  if (kind === 'new-business') {
    const step = normalizeStep(submission, 0, knownDefinitions);
    return { kind, ...step };
  }
  if (kind === 'cross-business') {
    if (!Array.isArray(submission.steps) || submission.steps.length < 2 || submission.steps.length > 5) {
      throw routeError('cross-business route requires two to five ordered steps');
    }
    const steps = submission.steps.map((step, index) => normalizeStep(step, index, knownDefinitions));
    return {
      kind,
      goal: normalizedText(submission.goal) || steps.map((step) => step.requestedEffect).join(' → '),
      steps,
    };
  }
  throw routeError('route kind must be new-business, cross-business, or clarify');
}

function beginRoutePhase({ userText, transactions = [], definitions } = {}) {
  const continuation = matchContinuation({ userText, transactions });
  if (continuation) return continuation;
  const deterministic = deterministicRoute(userText);
  if (deterministic) return deterministic;
  return {
    kind: 'route-phase',
    userText: normalizedText(userText),
    definitions: (Array.isArray(definitions) ? definitions : DEFAULT_BUSINESS_DEFINITIONS)
      .map(({ businessId, summary, operations }) => ({
        businessId,
        summary,
        ...(Array.isArray(operations) ? { operations: [...operations] } : {}),
      })),
    allowedTools: ['def.harness.route'],
    instructions: [
      'Classify only the business result requested by the user.',
      'Submit one structured route through def_harness_route.',
      'Do not answer the business question, read game knowledge, or modify product state in this phase.',
      'Entities, operators, equipment, skills, BUFF names, “3+1”, and batch size are targets or constraints, never business ids.',
    ].join('\n'),
  };
}

function resolveRoute({ userText, transactions, submission, definitions } = {}) {
  const continuation = matchContinuation({ userText, transactions });
  if (continuation) return continuation;
  if (!submission) return beginRoutePhase({ userText, transactions, definitions });
  return validateRouteSubmission(submission, { definitions });
}

module.exports = {
  BUSINESS_IDS,
  DEFAULT_BUSINESS_DEFINITIONS,
  beginRoutePhase,
  classifyDefExecutableTurnPolicy,
  continuationIntent,
  deterministicRoute,
  isDirectCurrentNodeQuestion,
  matchContinuation,
  resolveRoute,
  validateRouteSubmission,
};
