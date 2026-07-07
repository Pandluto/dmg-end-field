import type { MainWorkbenchSnapshot } from '../../utils/mainWorkbenchControl';
import { inferMainWorkbenchGoal, type MainWorkbenchGoal } from './goalModel';

type SkillButtonSnapshot = MainWorkbenchSnapshot['skillButtons'][number];
type SkillButtonBuffSnapshot = NonNullable<SkillButtonSnapshot['selectedBuffs']>[number];
type OperatorConfigSnapshot = NonNullable<MainWorkbenchSnapshot['operatorConfigs']>[number];

export type MainWorkbenchSnapshotEvidenceFocus = {
  kind: 'skillButton';
  reason: string;
  buttonId: string;
  label: string;
  characterName: string;
  skillType: string;
  skillDisplayName: string;
  staffIndex: number;
  lineIndex: number;
  nodeIndex?: number;
  position: string;
  buffCount: number;
  buffs: string[];
  stale?: boolean;
};

export type MainWorkbenchSnapshotEvidenceFocusState = {
  focus?: MainWorkbenchSnapshotEvidenceFocus | null;
  previousFocus?: MainWorkbenchSnapshotEvidenceFocus | null;
};

function formatEquipmentLine(config: OperatorConfigSnapshot) {
  const slotLabels: Record<string, string> = {
    armor: '护甲',
    glove: '护手',
    accessory1: '配件1',
    accessory2: '配件2',
  };
  const slotOrder = ['armor', 'glove', 'accessory1', 'accessory2'];
  const equipment = [...config.equipment]
    .sort((a, b) => slotOrder.indexOf(a.slotKey) - slotOrder.indexOf(b.slotKey))
    .map((item) => `${slotLabels[item.slotKey] || item.part || item.slotKey}: ${item.name}`)
    .join('；');
  const weapon = config.weapon
    ? `${config.weapon.name} Lv.${config.weapon.level} ${config.weapon.potential || ''}`.trim()
    : '未配置';
  return `${config.characterName} 当前武器：${weapon}；装备：${equipment || '未配置'}。`;
}

function formatBuffName(buff: SkillButtonBuffSnapshot) {
  return buff.displayName || buff.name || buff.id;
}

function formatButtonLabel(button: SkillButtonSnapshot) {
  return `${button.characterName}-${button.skillDisplayName || button.skillType}@${button.staffIndex + 1}-${(button.nodeIndex ?? 0) + 1}`;
}

function formatDamageValue(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return Math.round(value).toLocaleString('zh-CN');
}

function formatEvidenceDamageValue(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(value);
}

function matchesGoalCharacter(goal: MainWorkbenchGoal, characterName: string) {
  return goal.characterNames.length === 0 || goal.characterNames.includes(characterName);
}

function normalizeFocusText(value: string | undefined) {
  return String(value || '')
    .replace(/燃尽/g, '燃烬')
    .replace(/[「」"'\s]/g, '')
    .toLowerCase();
}

function parseChineseOrdinal(value: string | undefined) {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, '');
  const numeric = Number(normalized);
  if (Number.isInteger(numeric) && numeric > 0) return numeric;
  const map: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  return map[normalized] || null;
}

function parseOrdinalFromPrompt(prompt: string) {
  if (/首个|第一个|第一次|第1个|第1次/i.test(prompt)) return 1;
  const match = prompt.match(/第\s*([一二两三四五六七八九十\d]+)\s*(?:个|次)/);
  return parseChineseOrdinal(match?.[1]);
}

function parsePositionFromPrompt(prompt: string) {
  const atMatch = prompt.match(/@(\d+)\s*[-－]\s*(\d+)/);
  if (atMatch) return { staffIndex: Number(atMatch[1]) - 1, nodeIndex: Number(atMatch[2]) - 1 };
  const rowColumnMatch = prompt.match(/行\s*(\d+).*?第?\s*(\d+)\s*列/);
  if (rowColumnMatch) return { staffIndex: Number(rowColumnMatch[1]) - 1, nodeIndex: Number(rowColumnMatch[2]) - 1 };
  return null;
}

function buildButtonFocus(button: SkillButtonSnapshot, reason: string): MainWorkbenchSnapshotEvidenceFocus {
  const buffs = button.selectedBuffs?.length
    ? button.selectedBuffs.map(formatBuffName)
    : button.selectedBuffIds;
  return {
    kind: 'skillButton',
    reason,
    buttonId: button.id,
    label: formatButtonLabel(button),
    characterName: button.characterName,
    skillType: button.skillType,
    skillDisplayName: button.skillDisplayName || button.skillType,
    staffIndex: button.staffIndex,
    lineIndex: button.lineIndex,
    nodeIndex: button.nodeIndex,
    position: `${button.staffIndex + 1}-${(button.nodeIndex ?? 0) + 1}`,
    buffCount: buffs.length,
    buffs,
  };
}

function hydratePreviousFocus(
  snapshot: MainWorkbenchSnapshot,
  previousFocus?: MainWorkbenchSnapshotEvidenceFocus | null,
) {
  if (!previousFocus) return null;
  const button = snapshot.skillButtons.find((item) => item.id === previousFocus.buttonId)
    || snapshot.skillButtons.find((item) => formatButtonLabel(item) === previousFocus.label);
  if (!button) {
    return { ...previousFocus, reason: 'previous-focus-stale', stale: true };
  }
  return buildButtonFocus(button, 'previous-focus');
}

function resolvePromptFocus(snapshot: MainWorkbenchSnapshot, prompt: string) {
  const normalizedPrompt = normalizeFocusText(prompt);
  const mentionedCharacterNames = snapshot.selectedCharacters
    .filter((character) => normalizedPrompt.includes(normalizeFocusText(character.name)))
    .map((character) => character.name);
  const skillNames = [...new Set(snapshot.skillButtons
    .map((button) => button.skillDisplayName || button.skillType)
    .filter(Boolean))];
  const mentionedSkillNames = skillNames.filter((skillName) => normalizeFocusText(prompt).includes(normalizeFocusText(skillName)));
  const position = parsePositionFromPrompt(prompt);
  const ordinal = parseOrdinalFromPrompt(prompt);

  let candidates = snapshot.skillButtons;
  if (mentionedCharacterNames.length) {
    candidates = candidates.filter((button) => mentionedCharacterNames.includes(button.characterName));
  }
  if (mentionedSkillNames.length) {
    candidates = candidates.filter((button) => mentionedSkillNames.includes(button.skillDisplayName || button.skillType));
  }
  if (position) {
    candidates = candidates.filter((button) => (
      button.staffIndex === position.staffIndex &&
      (button.nodeIndex ?? -1) === position.nodeIndex
    ));
  }
  if (!position && !mentionedSkillNames.length && !ordinal) return null;
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((left, right) => (
    (left.staffIndex - right.staffIndex) ||
    (left.lineIndex - right.lineIndex) ||
    ((left.nodeIndex ?? 0) - (right.nodeIndex ?? 0))
  ));
  const target = sorted[Math.max(0, (ordinal || 1) - 1)] || null;
  return target ? buildButtonFocus(target, 'prompt-focus') : null;
}

export function resolveMainWorkbenchSnapshotFocus(
  snapshot: MainWorkbenchSnapshot | null,
  prompt = '',
  previousFocus?: MainWorkbenchSnapshotEvidenceFocus | null,
): MainWorkbenchSnapshotEvidenceFocusState {
  if (!snapshot) {
    return {
      focus: null,
      previousFocus: previousFocus ? { ...previousFocus, reason: 'previous-focus-unverified', stale: true } : null,
    };
  }
  return {
    focus: resolvePromptFocus(snapshot, prompt),
    previousFocus: hydratePreviousFocus(snapshot, previousFocus),
  };
}

function buildBuffAnswer(goal: MainWorkbenchGoal, snapshot: MainWorkbenchSnapshot) {
  const targetButtons = snapshot.skillButtons.filter((button) => matchesGoalCharacter(goal, button.characterName));
  if (!targetButtons.length) {
    const target = goal.characterNames.join('、') || '当前主界面';
    return `${target} 当前没有技能按钮，无法列出 Buff。`;
  }

  const buttonBuffs = targetButtons.map((button) => ({
    button,
    buffs: button.selectedBuffs?.length
      ? button.selectedBuffs.map(formatBuffName)
      : button.selectedBuffIds,
  }));
  const uniqueBuffs = [...new Set(buttonBuffs.flatMap((item) => item.buffs))];
  const target = goal.characterNames.join('、') || '当前主界面';
  if (!uniqueBuffs.length) {
    return `${target} 当前 ${targetButtons.length} 个技能按钮均无 Buff。`;
  }

  if (goal.kind !== 'buffDetail') {
    const buffLines = uniqueBuffs.map((buff, index) => `${index + 1}. ${buff}`);
    const buttonsWithBuff = buttonBuffs.filter((item) => item.buffs.length > 0).length;
    return [
      `${target} 当前共有 ${uniqueBuffs.length} 个唯一 Buff，分布在 ${buttonsWithBuff}/${targetButtons.length} 个技能按钮上：`,
      ...buffLines,
    ].join('\n');
  }

  const visible = buttonBuffs.slice(0, 8).map(({ button, buffs }) => {
    const names = buffs.slice(0, 6);
    const suffix = buffs.length > names.length ? ` 等 ${buffs.length} 个` : '';
    return `${formatButtonLabel(button)}：${names.length ? `${names.join('、')}${suffix}` : '无 Buff'}`;
  });
  const remaining = buttonBuffs.length - visible.length;
  if (remaining > 0) {
    visible.push(`另有 ${remaining} 个技能按钮未展开。可追问“详细列出全部 Buff”。`);
  }
  return visible.join('\n');
}

function buildTopDamageAnswer(goal: MainWorkbenchGoal, snapshot: MainWorkbenchSnapshot) {
  const reportButtons = snapshot.damageReport?.buttons || [];
  if (!reportButtons.length) return '当前没有可用伤害报告，请先计算伤害。';
  const candidates = reportButtons.filter((button) => matchesGoalCharacter(goal, button.characterName));
  if (!candidates.length) {
    const target = goal.characterNames.join('、') || '当前主界面';
    return `${target} 当前没有可用伤害按钮。`;
  }
  const [top, ...rest] = [...candidates].sort((a, b) => b.expected - a.expected);
  const runnerUp = rest[0];
  const target = goal.characterNames.join('、') || '当前主界面';
  return [
    `${target} 当前最高期望伤害技能是 ${top.characterName}-${top.skillName}，期望伤害 ${formatDamageValue(top.expected)}。`,
    runnerUp ? `第二名是 ${runnerUp.characterName}-${runnerUp.skillName}，期望伤害 ${formatDamageValue(runnerUp.expected)}。` : '',
    snapshot.damageReport ? `当前总期望伤害 ${formatDamageValue(snapshot.damageReport.totalExpected)}，按钮数 ${snapshot.damageReport.buttonCount}。` : '',
  ].filter(Boolean).join('\n');
}

function buildEquipmentAnswer(goal: MainWorkbenchGoal, snapshot: MainWorkbenchSnapshot) {
  const configs = snapshot.operatorConfigs || [];
  const targets = configs.filter((config) => matchesGoalCharacter(goal, config.characterName));
  const visible = targets.length > 0 ? targets : configs.slice(0, Math.min(configs.length, 2));
  if (!visible.length) return '当前没有可用装备配置。';
  return visible.map(formatEquipmentLine).join('\n');
}

function buildButtonAnswer(goal: MainWorkbenchGoal, snapshot: MainWorkbenchSnapshot) {
  const buttons = snapshot.skillButtons.filter((button) => matchesGoalCharacter(goal, button.characterName));
  if (!buttons.length) return '当前没有技能按钮。';
  return `当前技能按钮：${buttons.map(formatButtonLabel).join('；')}。`;
}

function buildDamageAnswer(snapshot: MainWorkbenchSnapshot) {
  if (!snapshot.damageReport) return '当前没有可用伤害报告，请先计算伤害。';
  return `当前总期望伤害：${formatDamageValue(snapshot.damageReport.totalExpected)}，按钮数：${snapshot.damageReport.buttonCount}。`;
}

function buildSelectionAnswer(snapshot: MainWorkbenchSnapshot) {
  const selected = snapshot.selectedCharacters.map((character) => character.name).join('、') || '无';
  return `已核对快照。当前已选干员：${selected}。`;
}

export function buildMainWorkbenchSnapshotAnswer(goal: MainWorkbenchGoal, snapshot: MainWorkbenchSnapshot | null) {
  if (!snapshot) return '';
  if (goal.kind === 'topDamage') return buildTopDamageAnswer(goal, snapshot);
  if (goal.kind === 'buffSummary' || goal.kind === 'buffDetail') return buildBuffAnswer(goal, snapshot);
  if (goal.kind === 'equipmentSummary') return buildEquipmentAnswer(goal, snapshot);
  if (goal.kind === 'buttonSummary') return buildButtonAnswer(goal, snapshot);
  if (goal.kind === 'damageSummary') return buildDamageAnswer(snapshot);
  if (goal.kind === 'selectionSummary') return buildSelectionAnswer(snapshot);
  return buildSelectionAnswer(snapshot);
}

export function buildMainWorkbenchSnapshotAnswerFromPrompt(prompt: string | undefined, snapshot: MainWorkbenchSnapshot | null) {
  return buildMainWorkbenchSnapshotAnswer(inferMainWorkbenchGoal(prompt, snapshot), snapshot);
}

export function buildMainWorkbenchSnapshotEvidence(
  snapshot: MainWorkbenchSnapshot | null,
  prompt = '',
  focusState: MainWorkbenchSnapshotEvidenceFocusState = {},
) {
  if (!snapshot) {
    return 'MAIN_WORKBENCH_READONLY_EVIDENCE: unavailable';
  }
  const goal = inferMainWorkbenchGoal(prompt, snapshot);
  const selectedCharacters = snapshot.selectedCharacters.map((character) => ({
    id: character.id,
    name: character.name,
    element: character.element,
    profession: character.profession,
  }));
  const buttons = snapshot.skillButtons.map((button) => {
    const buffNames = button.selectedBuffs?.length
      ? button.selectedBuffs.map(formatBuffName)
      : button.selectedBuffIds;
    return {
      id: button.id,
      label: formatButtonLabel(button),
      characterName: button.characterName,
      skillType: button.skillType,
      skillDisplayName: button.skillDisplayName || button.skillType,
      staffIndex: button.staffIndex,
      lineIndex: button.lineIndex,
      nodeIndex: button.nodeIndex,
      position: `${button.staffIndex + 1}-${(button.nodeIndex ?? 0) + 1}`,
      buffCount: buffNames.length,
      buffs: buffNames,
    };
  });
  const mentionedButtons = goal.characterNames.length
    ? buttons.filter((button) => goal.characterNames.includes(button.characterName))
    : buttons;
  const equipment = (snapshot.operatorConfigs || []).map((config) => ({
    characterName: config.characterName,
    weapon: config.weapon
      ? {
        name: config.weapon.name,
        level: config.weapon.level,
        potential: config.weapon.potential,
      }
      : null,
    equipment: config.equipment.map((item) => ({
      slotKey: item.slotKey,
      part: item.part,
      name: item.name,
    })),
  }));
  const damageButtons = (snapshot.damageReport?.buttons || []).map((button) => ({
    id: button.id,
    label: `${button.characterName}-${button.skillName}`,
    characterName: button.characterName,
    skillName: button.skillName,
    skillType: button.skillType,
    expected: formatEvidenceDamageValue(button.expected),
    damage: formatEvidenceDamageValue(button.damage),
  }));
  const evidence = {
    source: 'current-checkout-snapshot',
    note: [
      'This is read-only evidence from the current checked-out main workbench state.',
      'Use this evidence to answer the user in natural language.',
      'Do not treat this evidence as an appdata AI work node.',
      'Do not enqueue mutation commands for read-only questions.',
      'For follow-up pronouns like it/this/that/刚才那个, use the prior conversation plus this evidence.',
      'If focus is present, prioritize focus over character-level or global summaries.',
      'If focus is absent and previousFocus is valid, use previousFocus for pronoun follow-ups.',
      'When the user asks about a specific button, answer for that button, not the whole character or whole timeline.',
    ],
    prompt,
    inferredGoal: {
      kind: goal.kind,
      characterNames: goal.characterNames,
      mutating: goal.mutating,
    },
    selectedCharacters,
    focus: focusState.focus || null,
    previousFocus: focusState.previousFocus || null,
    buttons,
    mentionedCharacterButtons: mentionedButtons,
    equipment,
    damageReport: snapshot.damageReport
      ? {
        totalExpected: formatEvidenceDamageValue(snapshot.damageReport.totalExpected),
        totalNonCrit: formatEvidenceDamageValue(snapshot.damageReport.totalNonCrit),
        buttonCount: snapshot.damageReport.buttonCount,
        buttons: damageButtons,
      }
      : null,
    lastCommand: snapshot.lastCommand,
  };
  return `MAIN_WORKBENCH_READONLY_EVIDENCE:\n${JSON.stringify(evidence, null, 2)}`;
}
