import type {
  DefHarnessBusinessId,
  DefHarnessOperationId,
} from '../contracts/index.ts';

export type DefDeterministicContinuationIntent = 'confirm' | 'reject' | 'resume' | 'correct';

export type DefDeterministicHarnessIntent =
  | {
      readonly kind: 'route';
      readonly businessId: DefHarnessBusinessId;
      readonly operation: DefHarnessOperationId;
      readonly reason:
        | 'conversation'
        | 'current-node'
        | 'current-roster'
        | 'current-loadout'
        | 'skill-fact';
    }
  | {
      readonly kind: 'continuation';
      readonly intent: DefDeterministicContinuationIntent;
    };

const DIRECT_CURRENT_NODE = /^(?:请)?(?:告诉我|查看|查询|确认)?(?:一下)?(?:当前|现在)(?:的)?(?:工作)?节点(?:是|为|叫)?(?:什么|哪个|哪一个|多少|的名称|的ID|的id)?[？?。！!]*$/u;
const DIRECT_SESSION_ID = /^(?:请)?(?:告诉我|给我|查看|查询)?(?:一下)?(?:当前|这个|本次)?(?:的)?会话(?:的)?(?:ID|id|编号)(?:(?:是|为)?(?:什么|多少)|(?:给我|告诉我))?[？?。！!]*$/iu;

function normalizedText(value: string): string {
  return value.normalize('NFKC').trim();
}

function compactText(value: string): string {
  return normalizedText(value).replace(/\s+/gu, '');
}

function conversationIntent(compact: string): boolean {
  if (DIRECT_SESSION_ID.test(compact)) return true;
  if (
    /^(?:(?:嗨|哈喽|你好|您好|hello|hi|hey|在吗|喂)[呀啊哦哟嘛吗]*|早上好|中午好|下午好|晚上好)[，,。.!！?？]*$/iu.test(compact)
  ) return true;
  if (
    /^(?:(?:你)?(?:还)?(?:挺|真|很)?(?:聪明|厉害|靠谱|专业|牛(?:逼)?|不错)|干得好|做得好|可以(?:可以)?|漂亮|好家伙)[呀啊哦哟嘛]*[，,。.!！?？]*$/u.test(compact)
  ) return true;
  if (
    /^(?:谢谢|多谢|谢了|感谢|好的?|行(?:吧)?|可以|ok|okay|嗯+|明白了?|知道了?|收到|没事|暂时不用(?:了)?|不用了?|先这样(?:吧)?|之后再说|回头再说|再见|拜拜)[呀啊哦哟嘛]*[，,。.!！?？]*$/iu.test(compact)
  ) return true;
  if (
    /^(?:请)?(?:告诉我|列出|查看)?(?:一下)?你(?:的)?(?:所有|全部)?(?:工具|能力)(?:有哪些|是什么|有多少)?[？?。！!]*$/u.test(compact)
  ) return true;
  if (
    /(?:工具|刚才|上一次|上个|前面).*(?:原始)?(?:JSON|json|返回值|返回结果)/u.test(compact)
    || /(?:刚才|上一次|上个|前面).*(?:做了什么|改了什么|结果|发生了什么)/u.test(compact)
  ) return true;
  return false;
}

function continuationIntent(compact: string): DefDeterministicContinuationIntent | null {
  if (/^(?:确认|同意|应用|换上|就按这套|按这套|执行)(?:应用|换上|执行|刚才|那套|该方案|此方案|它|吧|。|！|!)*$/u.test(compact)) {
    return 'confirm';
  }
  if (/^(?:拒绝|取消|不要|先不|暂不)(?:[。！!吧])?$/u.test(compact)) return 'reject';
  if (/^(?:继续|接着|继续处理|接着处理)(?:[。！!吧])?$/u.test(compact)) return 'resume';
  if (/(?:为什么不用|不对|修正|重新规划|重新推荐|(?:刚才|那套|该方案|这个方案).*(?:改成|换成))/u.test(compact)) {
    return 'correct';
  }
  return null;
}

/**
 * Resolve only short, high-confidence intents. A null result is deliberate:
 * ambiguous or compound product work remains owned by the model-visible
 * Harness route instead of being guessed by a regular expression.
 */
export function classifyDeterministicHarnessIntent(
  userMessage: string,
): DefDeterministicHarnessIntent | null {
  const compact = compactText(userMessage);
  if (!compact || compact.length > 160) return null;

  const continuation = continuationIntent(compact);
  if (continuation) return { kind: 'continuation', intent: continuation };
  if (conversationIntent(compact)) {
    return { kind: 'route', businessId: 'conversation', operation: 'respond', reason: 'conversation' };
  }
  if (DIRECT_CURRENT_NODE.test(compact)) {
    return { kind: 'route', businessId: 'timeline', operation: 'current', reason: 'current-node' };
  }
  if (
    /^(?:请)?(?:告诉我|查看|查询|确认)?(?:一下)?(?:当前|现在|这次)?(?:的)?(?:队伍|阵容)(?:里|中)?(?:有谁|是谁|有哪些|成员|选了谁|已选哪些干员)[？?。！!]*$/u.test(compact)
  ) {
    return { kind: 'route', businessId: 'selection', operation: 'inspect', reason: 'current-roster' };
  }
  if (
    /^(?:请)?(?:告诉我|查看|查询|确认)?(?:一下)?(?:当前|现在|这个|这套)(?:的)?(?:配装|武器|装备)(?:是什么|有哪些|配了什么|穿了什么|带了什么)?[？?。！!]*$/u.test(compact)
  ) {
    return { kind: 'route', businessId: 'loadout', operation: 'inspect', reason: 'current-loadout' };
  }
  const asksSkillFact = /(?:具体数值|倍率|伤害类型|算什么伤害|属于什么伤害|吃(?:什么|哪种|哪类)?(?:战技|终结技|大招|连携技|普攻|重击)?加成)/u.test(compact);
  const namesSkill = /(?:技能|战技|连携|终结技|大招|普攻|重击|攻击|水龙卷|图腾|(?:^|[^a-z])[abeq](?:[^a-z]|$))/iu.test(compact);
  const asksCurrentReport = /(?:当前|这个按钮|伤害报告|总伤害|伤害面板)/u.test(compact);
  if (asksSkillFact && namesSkill && !asksCurrentReport) {
    return { kind: 'route', businessId: 'calculation', operation: 'skill_fact', reason: 'skill-fact' };
  }
  return null;
}
