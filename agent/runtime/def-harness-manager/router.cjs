const BUSINESS_IDS = Object.freeze(['selection', 'loadout', 'timeline', 'buff', 'calculation']);
const BUSINESS_ID_SET = new Set(BUSINESS_IDS);
const CONTINUABLE_STATUSES = new Set(['awaiting-confirmation', 'active']);
const DIRECT_CURRENT_NODE_QUESTION = /^(?:请)?(?:告诉我|查看|查询|确认)?(?:一下)?(?:当前|现在)(?:的)?(?:工作)?节点(?:是|为|叫)?(?:什么|哪个|哪一个|多少|的名称|的ID|的id)?[？?。！!]*$/;
const DIRECT_SESSION_ID_QUESTION = /^(?:请)?(?:告诉我|给我|查看|查询)?(?:一下)?(?:当前|这个|本次)?(?:的)?会话(?:的)?(?:ID|id|编号)(?:(?:是|为)?(?:什么|多少)|(?:给我|告诉我))?[？?。！!]*$/i;

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

function inferNamedEquipmentSetQuery(userText = '') {
  const compact = normalizedText(userText).replace(/\s+/g, '');
  if (!compact) return '';
  const patterns = [
    /(?:[一二两三四五六七八九十\d]+)(?:个|件)?([\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z0-9·_-]{1,15}?)(?=配件|护手|护甲)/u,
    /(?:三|3)(?:个|件)?([\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z0-9·_-]{1,15}?)(?:\+|加)(?:一|1)/u,
    /(?:配置|换成|想要|选择|选|用|带|穿)([\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z0-9·_-]{1,15}?)(?:套装|套)(?=$|[，,。！？?、;+])/u,
  ];
  for (const pattern of patterns) {
    const candidate = normalizedText(pattern.exec(compact)?.[1]);
    if (candidate) return candidate;
  }
  return '';
}

function comparableEquipmentSetQuery(value = '') {
  return normalizedText(value)
    .replace(/\s+/g, '')
    .replace(/^[「『【《"'“”‘’]+|[」』】》"'“”‘’]+$/g, '')
    .replace(/(?:套装|套|配件|护手|护甲)$/u, '')
    .toLocaleLowerCase();
}

function hasEquipmentSetSelectionIntent(userText = '') {
  const compact = normalizedText(userText).replace(/\s+/g, '');
  if (!compact) return false;
  return /(?:3(?:\+|加)1|三加一|套装|配一套|选一套|哪一套|哪套|什么套|选.*套|推荐.*套)/.test(compact);
}

function isDirectCurrentNodeQuestion(userText = '') {
  return DIRECT_CURRENT_NODE_QUESTION.test(normalizedText(userText));
}

function classifyConversationTurn(userText = '') {
  const text = normalizedText(userText);
  const compact = text.replace(/\s+/g, '');
  if (!compact) return null;
  if (DIRECT_SESSION_ID_QUESTION.test(compact)) {
    return { kind: 'conversation', intent: 'session-id', userText: text };
  }
  if (
    /(?:工具|刚才|上一次|上个|前面).*(?:原始)?(?:JSON|json|返回值|返回结果)/
      .test(compact)
    || /(?:原始)?(?:JSON|json).*(?:工具|刚才|上一次|上个|前面)/.test(compact)
  ) {
    return { kind: 'conversation', intent: 'previous-result', userText: text };
  }
  if (
    /(?:为什么|怎么).*(?:截断|只(?:返回|显示|给出?|找到)(?:了)?(?:\d+|这些|一部分)?(?:人|条|个)?|没有(?:全部|完整))/.test(compact)
    || /^(?:(?:妈的|我操|操)，?)?谁设计的[？?。！!]*$/.test(compact)
    || /(?:刚才|之前|明明).*(?:找到|查到|知道).*(?:上下文|丢|忘|还在|为什么|怎么)/.test(compact)
    || /(?:上下文).*(?:丢|没了|忘了|不存在)/.test(compact)
    || /^(?:意思是|所以).*(?:换不了|不能|没法|失败|做不了)/.test(compact)
  ) {
    return { kind: 'conversation', intent: 'previous-result', userText: text };
  }
  if (/(?:selectedCharacters|operatorConfigs|skillCatalog|checkoutPhase)/i.test(compact)) {
    return { kind: 'conversation', intent: 'previous-result-semantics', userText: text };
  }
  if (
    /(?:说人话|别(?:再)?(?:输出|显示|回复).*(?:HTML|html|代码|标签)|你(?:刚才|这次).*(?:答非所问|答错|跑偏|没回答)|回复.*(?:HTML|html).*(?:代码|标签))/
      .test(compact)
  ) {
    return { kind: 'conversation', intent: 'plain-language-correction', userText: text };
  }
  if (
    /^(?:请)?(?:告诉我|列出|查看)?(?:一下)?你(?:的)?(?:所有|全部)?(?:工具|能力)(?:有哪些|是什么|有多少)?[？?。！!]*$/
      .test(compact)
    || /^(?:就)?这么少[？?。！!]*$/.test(compact)
  ) {
    return { kind: 'conversation', intent: 'capabilities', userText: text };
  }
  if (
    /^(?:(?:嗨|哈喽|你好|您好|hello|hi|hey|在吗|喂)[呀啊哦哟嘛吗]*|早上好|中午好|下午好|晚上好)[，,。.!！?？]*$/i
      .test(compact)
  ) {
    return { kind: 'conversation', intent: 'social-greeting', userText: text };
  }
  if (
    /^(?:(?:你)?(?:还)?(?:挺|真|很)?(?:聪明|厉害|靠谱|专业|牛(?:逼)?|不错)|干得好|做得好|可以(?:可以)?|漂亮|好家伙)[呀啊哦哟嘛]*[，,。.!！?？]*$/
      .test(compact)
  ) {
    return { kind: 'conversation', intent: 'social-praise', userText: text };
  }
  if (
    /^(?:谢谢|多谢|谢了|感谢|好的?|行(?:吧)?|可以|ok|okay|嗯+|明白了?|知道了?|收到|没事|暂时不用(?:了)?|不用了?|先这样(?:吧)?|之后再说|回头再说|再见|拜拜)[呀啊哦哟嘛]*[，,。.!！?？]*$/i
      .test(compact)
  ) {
    return { kind: 'conversation', intent: 'social-acknowledgement', userText: text };
  }
  return null;
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
  const conversation = classifyConversationTurn(text);
  if (conversation) return conversation;
  const namedEquipmentSetQuery = inferNamedEquipmentSetQuery(text);
  const compact = text.replace(/\s+/g, '');
  if (
    namedEquipmentSetQuery
    && /(?:怎么带|如何带|想带|要带|搭配|配装|配置|推荐|挑选|选择)/.test(compact)
  ) {
    return {
      kind: 'new-business',
      deterministic: true,
      businessId: 'loadout',
      operation: 'recommend_named_set',
      target: text,
      requestedEffect: '围绕用户点名的装备套装生成只读配装建议',
      constraints: [
        'read-only',
        'equipment-set-mode:named-set',
        `equipment-set:${namedEquipmentSetQuery}`,
      ],
      equipmentSetMode: 'named-set',
      equipmentSetQuery: namedEquipmentSetQuery,
    };
  }
  const asksGenericEquipmentRecommendation = (
    /^[\p{Script=Han}A-Za-z0-9·_-]{1,24}带什么[？?。！!]*$/u.test(compact)
    || /(?:带什么装备|穿什么|怎么配装|装备怎么配|配什么装备|装备推荐)/.test(compact)
  ) && !/武器/.test(compact)
    && !hasEquipmentSetSelectionIntent(compact);
  if (asksGenericEquipmentRecommendation) {
    return {
      kind: 'new-business',
      deterministic: true,
      businessId: 'loadout',
      operation: 'recommend',
      target: text,
      requestedEffect: '先按精确攻略确定构筑目标，再用当前目录核验泛化装备建议',
      constraints: ['read-only', 'guide-first', 'no-implicit-3plus1'],
    };
  }
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
  const asksCurrentRoster = /(?:当前|现在|这次)?(?:队伍|阵容)(?:里|中)?(?:有谁|是谁|有哪些|成员)|(?:当前|现在)(?:选了|已选)(?:谁|哪些干员|哪些角色)/.test(compact);
  if (asksCurrentRoster) {
    return {
      kind: 'new-business',
      deterministic: true,
      businessId: 'selection',
      operation: 'inspect',
      target: 'current-roster',
      requestedEffect: '读取当前已选队伍及顺序',
      constraints: ['selected-roster-only'],
    };
  }
  const asksLoadoutEvaluation = /(?:配装|装备|武器).*(?:好吗|好不好|怎么样|是否合理|合理吗|合适吗|适合吗|评价|评估|分析|诊断)|(?:评价|评估|分析|诊断).*(?:配装|装备|武器)/.test(compact);
  if (asksLoadoutEvaluation) {
    return {
      kind: 'new-business',
      deterministic: true,
      businessId: 'loadout',
      operation: 'evaluate',
      target: text,
      requestedEffect: '基于当前已保存配装和干员构筑证据评价适配性',
      constraints: ['current-loadout', 'operator-fit', 'read-only'],
    };
  }
  const asksCurrentLoadout = /(?:当前|现在|这个|这套).*(?:配装|武器|装备).*(?:是什么|有哪些|配了什么|穿了什么|带了什么)|(?:配装|武器|装备).*(?:当前|现在).*(?:是什么|有哪些|配了什么|穿了什么|带了什么)/.test(compact);
  if (asksCurrentLoadout) {
    return {
      kind: 'new-business',
      deterministic: true,
      businessId: 'loadout',
      operation: 'inspect',
      target: text,
      requestedEffect: '读取目标干员当前已保存配装',
      constraints: ['current-loadout', 'read-only'],
    };
  }
  const asksOperatorCatalog = /(?:本地|选人)?(?:干员|角色)(?:库|目录)(?:有谁|有哪些|全部|所有)?|(?:查询|查找|看看|查看|列出|我要你查)(?:全部|所有)?(?:干员|角色)|(?:重新选|换一个|换人).*(?:能换谁|有哪些|候选)|(?:其他人).*(?:看|查|换)|^你知道[^？?。！!]+吗[？?。！!]*$/.test(compact);
  if (asksOperatorCatalog) {
    return {
      kind: 'new-business',
      deterministic: true,
      businessId: 'selection',
      operation: 'search',
      target: text,
      requestedEffect: '查询选人界面的本地干员目录',
      constraints: ['catalog-scope', 'preserve-count-and-truncation'],
    };
  }
  const asksLoadoutCatalog = /(?:本地)?(?:武器|装备)(?:库|目录)(?:有哪些|全部|所有|有什么)?|(?:查询|查找|看看|查看|列出).*(?:武器|装备)/.test(compact);
  if (asksLoadoutCatalog) {
    return {
      kind: 'new-business',
      deterministic: true,
      businessId: 'loadout',
      operation: 'resolve',
      target: text,
      requestedEffect: '查询干员配置页的本地武器或装备目录',
      constraints: ['catalog-scope', 'preserve-count-and-truncation'],
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

function normalizeStep(step, index, definitions, { userText = '' } = {}) {
  const businessId = normalizedText(step?.businessId);
  let operation = normalizedText(step?.operation);
  const target = normalizedText(step?.target);
  const requestedEffect = normalizedText(step?.requestedEffect);
  if (!BUSINESS_ID_SET.has(businessId)) throw routeError(`steps[${index}].businessId is invalid`);
  const definition = definitions.get(businessId);
  if (definition?.operations && !definition.operations.includes(operation)) {
    throw routeError(`steps[${index}].operation is not supported by ${businessId}`);
  }
  if (!operation) throw routeError(`steps[${index}].operation is required`);
  if (!requestedEffect) throw routeError(`steps[${index}].requestedEffect is required`);
  const constraints = Array.isArray(step?.constraints)
    ? step.constraints.map(normalizedText).filter(Boolean)
    : [];
  let equipmentSetMode = normalizedText(step?.equipmentSetMode);
  let equipmentSetQuery = normalizedText(step?.equipmentSetQuery);
  if (businessId === 'loadout' && [
    'recommend',
    'recommend_equipment',
    'recommend_named_set',
    'recommend_discovered_set',
  ].includes(operation)) {
    const routeText = normalizedText(userText) || `${target} ${requestedEffect}`;
    const inferredNamedSetQuery = inferNamedEquipmentSetQuery(userText);
    const explicitSetIntent = Boolean(inferredNamedSetQuery)
      || hasEquipmentSetSelectionIntent(routeText)
      || (!normalizedText(userText) && ['named-set', 'discover-set'].includes(equipmentSetMode));
    if (inferredNamedSetQuery) {
      if (
        equipmentSetQuery
        && comparableEquipmentSetQuery(equipmentSetQuery) !== comparableEquipmentSetQuery(inferredNamedSetQuery)
      ) {
        throw routeError(`steps[${index}].equipmentSetQuery conflicts with the named set in the user request`);
      }
      equipmentSetMode = 'named-set';
      equipmentSetQuery = inferredNamedSetQuery;
    }
    if (explicitSetIntent) {
      if (!['named-set', 'discover-set'].includes(equipmentSetMode)) {
        throw routeError(`steps[${index}].equipmentSetMode must be named-set or discover-set for an explicit equipment-set recommendation`);
      }
      if (equipmentSetMode === 'named-set' && !equipmentSetQuery) {
        throw routeError(`steps[${index}].equipmentSetQuery is required when equipmentSetMode=named-set`);
      }
      if (
        normalizedText(userText)
        && equipmentSetMode === 'named-set'
        && equipmentSetQuery
        && !comparableEquipmentSetQuery(userText).includes(comparableEquipmentSetQuery(equipmentSetQuery))
      ) {
        throw routeError(`steps[${index}].equipmentSetQuery was not named in the original user request`);
      }
      if (equipmentSetMode === 'discover-set' && equipmentSetQuery) {
        throw routeError(`steps[${index}].equipmentSetQuery must be omitted when equipmentSetMode=discover-set`);
      }
      operation = equipmentSetMode === 'named-set' ? 'recommend_named_set' : 'recommend_discovered_set';
      constraints.push(`equipment-set-mode:${equipmentSetMode}`);
      if (equipmentSetQuery) constraints.push(`equipment-set:${equipmentSetQuery}`);
    } else {
      operation = 'recommend';
      equipmentSetMode = '';
      equipmentSetQuery = '';
      constraints.push('no-implicit-3plus1');
    }
  }
  return {
    businessId,
    operation,
    target,
    requestedEffect,
    constraints: [...new Set(constraints)],
    ...(equipmentSetMode ? { equipmentSetMode } : {}),
    ...(equipmentSetQuery ? { equipmentSetQuery } : {}),
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

function validateRouteSubmission(submission, { definitions, userText = '' } = {}) {
  if (!submission || typeof submission !== 'object' || Array.isArray(submission)) throw routeError('route submission must be an object');
  const knownDefinitions = definitionMap(definitions);
  const kind = normalizedText(submission.kind);
  if (kind === 'conversation') {
    return {
      kind,
      intent: normalizedText(submission.intent) || 'general',
    };
  }
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
    const step = normalizeStep(submission, 0, knownDefinitions, { userText });
    return { kind, ...step };
  }
  if (kind === 'cross-business') {
    if (!Array.isArray(submission.steps) || submission.steps.length < 2 || submission.steps.length > 5) {
      throw routeError('cross-business route requires two to five ordered steps');
    }
    const steps = submission.steps.map((step, index) => normalizeStep(step, index, knownDefinitions, { userText }));
    const businessIds = new Set(steps.map((step) => step.businessId));
    if (businessIds.size === 1) {
      throw routeError('cross-business route requires at least two different business ids; submit one new-business operation for a single business');
    }
    return {
      kind,
      goal: normalizedText(submission.goal) || steps.map((step) => step.requestedEffect).join(' → '),
      steps,
    };
  }
  throw routeError('route kind must be conversation, new-business, cross-business, or clarify');
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
      'Use kind=conversation for greetings, praise, thanks, acknowledgements, closings, or direct non-business dialogue. Never turn social dialogue into a clarification question.',
      'Use kind=clarify only when the user is asking for a business result but a missing choice prevents selecting an operation.',
      'Entities, operators, equipment, skills, BUFF names, “3+1”, and batch size are targets or constraints, never business ids.',
      'For a generic loadout request such as “狼卫带什么”, use operation=recommend and omit equipmentSetMode: 3+1 is not the default equipment workflow. Set equipmentSetMode only when the user explicitly requests 3+1, names a set, or asks you to choose a set. A phrase such as “两个动火用配件”, “3 潮涌+1”, or “潮涌套” names a set even when the word 套装 is omitted: use named-set plus the exact set name. Use discover-set without equipmentSetQuery only for an explicit set-selection request. The Manager validates the original user text and canonicalizes generic, named-set and discovered-set operations separately.',
      'Use cross-business only when the request spans at least two different business ids. Proposal, validation, application, and verification inside one business belong to one new-business operation and must not be split into route steps.',
    ].join('\n'),
  };
}

function resolveRoute({ userText, transactions, submission, definitions } = {}) {
  const continuation = matchContinuation({ userText, transactions });
  if (continuation) return continuation;
  if (!submission) return beginRoutePhase({ userText, transactions, definitions });
  return validateRouteSubmission(submission, { definitions, userText });
}

module.exports = {
  BUSINESS_IDS,
  DEFAULT_BUSINESS_DEFINITIONS,
  beginRoutePhase,
  classifyConversationTurn,
  classifyDefExecutableTurnPolicy,
  continuationIntent,
  deterministicRoute,
  inferNamedEquipmentSetQuery,
  hasEquipmentSetSelectionIntent,
  isDirectCurrentNodeQuestion,
  matchContinuation,
  resolveRoute,
  validateRouteSubmission,
};
