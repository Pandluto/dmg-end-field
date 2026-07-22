const TIMELINE_INTENT = /(排轴|调轴|改轴|(?:技能)?按钮|技能.*(?:顺序|位置|节点)|(?:新增|添加|移动|删除|替换).{0,8}(?:普攻|重击|战技|连携|大招|终结技|技能|buff)|先.*(?:战技|连携|大招|终结技).*(?:再|然后|最后))/i;
const DIRECT_CURRENT_NODE_QUESTION = /^(?:请)?(?:告诉我|查看|查询|确认)?(?:一下)?(?:当前|现在)(?:的)?(?:工作)?节点(?:是|为|叫)?(?:什么|哪个|哪一个|多少|的名称|的ID|的id)?[？?。！!]*$/;
const { isDefEquipment3Plus1HarnessBinding } = require('./session-harness-activation.cjs');

function isDirectCurrentNodeQuestion(userText = '') {
  return DIRECT_CURRENT_NODE_QUESTION.test(typeof userText === 'string' ? userText.trim() : '');
}

function isDefEquipment3Plus1Correction(userText = '') {
  const normalized = String(userText || '').normalize('NFKC').replace(/\s+/g, '');
  const keepsEquipmentContext = /(?:配件|装备|套装|护甲|护手|词条|主属性|副属性|这套|该方案|上个方案)/.test(normalized);
  const asksToReconsider = /(?:为什么|为何|怎么|哪(?:件|个)|不用|不选|选择|换成|对比|比较|解释)/.test(normalized);
  const changesDomain = /(?:攻略|原文|来源|武器|技能|伤害|排轴|按钮)/.test(normalized);
  return keepsEquipmentContext && asksToReconsider && !changesDomain;
}

function classifyDefExecutableTurnPolicy(userText = '', options = {}) {
  const normalized = String(userText || '').normalize('NFKC').replace(/\s+/g, '');
  const namesThreePlusOne = /(?:3[^+\n]{0,16}\+1|三[^+\n]{0,16}\+一)/i.test(normalized);
  const asksEquipmentRecommendation = /(?:装备|配装|套装|配件|护甲|护手)/.test(normalized)
    && /(?:挑|选|推荐|规划|适配|方案|为什么不用|为什么选|对比|比较)/.test(normalized);
  if (options.equipment3Plus1Enabled === true && namesThreePlusOne && asksEquipmentRecommendation) {
    return { kind: 'equipment-3plus1-composite', sourceText: normalized };
  }
  const asksSkillFacts = /(?:具体数值|倍率|伤害类型|算什么伤害|属于什么伤害|吃(?:什么|哪种|哪类)?(?:战技|终结技|大招|连携技|普攻|重击)?加成)/.test(normalized);
  const namesSkillOrHit = /(?:技能|战技|连携|终结技|大招|普攻|重击|攻击|水龙卷|图腾|层|(?:^|[^a-z])[abeq](?:[^a-z]|$))/i.test(normalized);
  const asksCurrentDamageReport = /(?:当前|这个按钮|伤害报告|总伤害|伤害面板)/.test(normalized);
  const asksEquipmentFact = /(?:武器|装备|配件|护手|护甲)/.test(normalized);
  if (asksSkillFacts && namesSkillOrHit && !asksCurrentDamageReport && !asksEquipmentFact) {
    return { kind: 'exact-skill-facts', sourceText: normalized };
  }
  return null;
}

// Turn classification is trace metadata only. Harness selection is immutable
// after native-session creation and must never change here.
function routeNativeTurnHarness(binding, userText = '', options = {}) {
  const selector = binding?.harnessBinding?.selector || 'stable';
  const harnessId = binding?.harnessBinding?.harness?.harnessId || '';
  const text = typeof userText === 'string' ? userText.trim() : '';
  const equipment3Plus1Enabled = isDefEquipment3Plus1HarnessBinding(binding, options);
  const executablePolicy = classifyDefExecutableTurnPolicy(text, { equipment3Plus1Enabled })
    || (equipment3Plus1Enabled && isDefEquipment3Plus1Correction(text)
      ? { kind: 'equipment-3plus1-composite', sourceText: text, continuation: true }
      : null);
  if (executablePolicy) {
    return {
      selector,
      reason: `${executablePolicy.kind}-turn-policy`,
      sessionSelector: selector,
      task: executablePolicy.kind,
    };
  }
  const specializedOperatorConfig = /^def-operator-config(?:-|$)/.test(harnessId);
  if (specializedOperatorConfig && TIMELINE_INTENT.test(text)) {
    return {
      selector,
      reason: 'session-harness-pinned-timeline-turn',
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

module.exports = {
  classifyDefExecutableTurnPolicy,
  isDefEquipment3Plus1Correction,
  isDirectCurrentNodeQuestion,
  routeNativeTurnHarness,
};
