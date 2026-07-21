const TIMELINE_INTENT = /(排轴|调轴|改轴|(?:技能)?按钮|技能.*(?:顺序|位置|节点)|(?:新增|添加|移动|删除|替换).{0,8}(?:普攻|重击|战技|连携|大招|终结技|技能|buff)|先.*(?:战技|连携|大招|终结技).*(?:再|然后|最后))/i;
const DIRECT_CURRENT_NODE_QUESTION = /^(?:请)?(?:告诉我|查看|查询|确认)?(?:一下)?(?:当前|现在)(?:的)?(?:工作)?节点(?:是|为|叫)?(?:什么|哪个|哪一个|多少|的名称|的ID|的id)?[？?。！!]*$/;

function isDirectCurrentNodeQuestion(userText = '') {
  return DIRECT_CURRENT_NODE_QUESTION.test(typeof userText === 'string' ? userText.trim() : '');
}

function classifyDefExecutableTurnPolicy(userText = '') {
  const normalized = String(userText || '').normalize('NFKC').replace(/\s+/g, '');
  const asksSkillFacts = /(?:具体数值|倍率|伤害类型|算什么伤害|属于什么伤害|吃(?:什么|哪种|哪类)?(?:战技|终结技|大招|连携技|普攻|重击)?加成)/.test(normalized);
  const namesSkillOrHit = /(?:技能|战技|连携|终结技|大招|普攻|重击|攻击|水龙卷|图腾|层|(?:^|[^a-z])[abeq](?:[^a-z]|$))/i.test(normalized);
  const asksCurrentDamageReport = /(?:当前|这个按钮|伤害报告|总伤害|伤害面板)/.test(normalized);
  const asksEquipmentFact = /(?:武器|装备|配件|护手|护甲)/.test(normalized);
  if (asksSkillFacts && namesSkillOrHit && !asksCurrentDamageReport && !asksEquipmentFact) {
    return { kind: 'exact-skill-facts', sourceText: normalized };
  }
  return null;
}

// Harness selection only handles the independent timeline/operator-config
// transition. Catalog evidence is a tool choice inside the current Harness;
// it never rewrites the selected candidate for a read-only turn.
function routeNativeTurnHarness(binding, userText = '') {
  const selector = binding?.harnessBinding?.selector || 'stable';
  const harnessId = binding?.harnessBinding?.harness?.harnessId || '';
  const text = typeof userText === 'string' ? userText.trim() : '';
  const executablePolicy = classifyDefExecutableTurnPolicy(text);
  if (executablePolicy) {
    return {
      selector,
      reason: 'exact-skill-facts-turn-policy',
      sessionSelector: selector,
      task: executablePolicy.kind,
    };
  }
  const specializedOperatorConfig = /^def-operator-config(?:-|$)/.test(harnessId);
  if (specializedOperatorConfig && TIMELINE_INTENT.test(text)) {
    return {
      selector: 'stable',
      reason: 'timeline-intent-overrides-operator-config-candidate',
      sessionSelector: selector,
      task: 'timeline',
    };
  }
  return {
    selector,
    reason: 'session-harness-matches-turn',
    sessionSelector: selector,
    task: specializedOperatorConfig ? 'operator-config' : 'general',
  };
}

module.exports = { classifyDefExecutableTurnPolicy, isDirectCurrentNodeQuestion, routeNativeTurnHarness };
