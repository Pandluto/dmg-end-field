const TIMELINE_INTENT = /(排轴|调轴|改轴|(?:技能)?按钮|技能.*(?:顺序|位置|节点)|(?:新增|添加|移动|删除|替换).{0,8}(?:普攻|重击|战技|连携|大招|终结技|技能|buff)|先.*(?:战技|连携|大招|终结技).*(?:再|然后|最后))/i;
const DIRECT_CURRENT_NODE_QUESTION = /^(?:请)?(?:告诉我|查看|查询|确认)?(?:一下)?(?:当前|现在)(?:的)?(?:工作)?节点(?:是|为|叫)?(?:什么|哪个|哪一个|多少|的名称|的ID|的id)?[？?。！!]*$/;
const NATIVE_CATALOG_INTENT = /(装备|武器|套装|词条|属性|力量|智识|意志|寒冷|电磁|伤害|比较|对比|筛选|资料|数据|推荐|挑选|(?:3\s*[+＋]\s*1)|查(?:一)?下|看看)/i;
// “配装” can mean a read-only request for a recommendation.  Only explicit
// application language may leave the catalog route; otherwise an innocuous
// “挑选一套配装” silently bypasses the session-local evidence contract.
const OPERATOR_CONFIG_MUTATION_INTENT = /(换上|穿上|装上|替换|(?:确认|请).{0,12}(?:应用|配置)|(?:给|为).{0,16}(?:换|穿|装备|配置).{0,12}(?:武器|装备|套装|配件|护甲|护手)|(?:把).{0,16}(?:换|装备).{0,12}(?:成|为|上)|应用.{0,16}(?:配装|装备|武器|套装))/i;
const THREE_PLUS_ONE_INTENT = /3(?:\s|件|套|[^\d+＋]){0,20}[+＋]\s*1/i;

function isDirectCurrentNodeQuestion(userText = '') {
  return DIRECT_CURRENT_NODE_QUESTION.test(typeof userText === 'string' ? userText.trim() : '');
}

function classifyNativeCatalogTurn(userText = '') {
  const text = typeof userText === 'string' ? userText.trim() : '';
  const mutation = OPERATOR_CONFIG_MUTATION_INTENT.test(text);
  return {
    text,
    mutation,
    nativeCatalog: NATIVE_CATALOG_INTENT.test(text) && !mutation,
    threePlusOne: THREE_PLUS_ONE_INTENT.test(text),
  };
}

function routeNativeTurnHarness(binding, userText = '') {
  const selector = binding?.harnessBinding?.selector || 'stable';
  const harnessId = binding?.harnessBinding?.harness?.harnessId || '';
  const catalog = classifyNativeCatalogTurn(userText);
  const text = catalog.text;
  const timelineIntent = TIMELINE_INTENT.test(text);
  const nativeCatalogIntent = catalog.nativeCatalog;
  const specializedOperatorConfig = /^def-operator-config(?:-|$)/.test(harnessId);
  if (specializedOperatorConfig && timelineIntent) {
    return {
      selector: 'stable',
      reason: 'timeline-intent-overrides-operator-config-candidate',
      sessionSelector: selector,
      task: 'timeline',
    };
  }
  // A pinned operator-config candidate may require exact resolvers and forbid
  // native file reads. Catalog exploration is a different read-only task, so
  // it must return to the stable Harness where the session-local retrieval
  // artifact contract lives. This is a turn route, not a candidate promotion
  // or a change to the pinned session binding.
  if (specializedOperatorConfig && nativeCatalogIntent) {
    return {
      selector: 'stable',
      reason: 'native-catalog-intent-overrides-operator-config-candidate',
      sessionSelector: selector,
      task: 'native-catalog',
    };
  }
  if (nativeCatalogIntent) {
    return {
      selector: 'stable',
      reason: 'read-only-native-catalog-turn',
      sessionSelector: selector,
      task: 'native-catalog',
      threePlusOne: catalog.threePlusOne,
    };
  }
  return {
    selector,
    reason: 'session-harness-matches-turn',
    sessionSelector: selector,
    task: specializedOperatorConfig ? 'operator-config' : 'general',
  };
}

module.exports = { classifyNativeCatalogTurn, isDirectCurrentNodeQuestion, routeNativeTurnHarness };
