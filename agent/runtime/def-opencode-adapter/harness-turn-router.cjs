const TIMELINE_INTENT = /(排轴|调轴|改轴|(?:技能)?按钮|技能.*(?:顺序|位置|节点)|(?:新增|添加|移动|删除|替换).{0,8}(?:普攻|重击|战技|连携|大招|终结技|技能|buff)|先.*(?:战技|连携|大招|终结技).*(?:再|然后|最后))/i;
const DIRECT_CURRENT_NODE_QUESTION = /^(?:请)?(?:告诉我|查看|查询|确认)?(?:一下)?(?:当前|现在)(?:的)?(?:工作)?节点(?:是|为|叫)?(?:什么|哪个|哪一个|多少|的名称|的ID|的id)?[？?。！!]*$/;

function isDirectCurrentNodeQuestion(userText = '') {
  return DIRECT_CURRENT_NODE_QUESTION.test(typeof userText === 'string' ? userText.trim() : '');
}

function routeNativeTurnHarness(binding, userText = '') {
  const selector = binding?.harnessBinding?.selector || 'stable';
  const harnessId = binding?.harnessBinding?.harness?.harnessId || '';
  const text = typeof userText === 'string' ? userText.trim() : '';
  const timelineIntent = TIMELINE_INTENT.test(text);
  const specializedOperatorConfig = /^def-operator-config(?:-|$)/.test(harnessId);
  if (specializedOperatorConfig && timelineIntent) {
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

module.exports = { isDirectCurrentNodeQuestion, routeNativeTurnHarness };
