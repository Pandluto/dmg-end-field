function formatBuffName(buff) {
  return buff?.displayName || buff?.name || buff?.id || '';
}

function formatButtonLabel(button) {
  return `${button?.characterName || '未知'}-${button?.skillDisplayName || button?.skillType || '技能'}@${(button?.staffIndex || 0) + 1}-${(button?.nodeIndex ?? 0) + 1}`;
}

function normalizeFocusText(value) {
  return String(value || '')
    .replace(/燃尽/g, '燃烬')
    .replace(/[「」"'\s]/g, '')
    .toLowerCase();
}

function parseOrdinal(value) {
  if (!value) return null;
  const normalized = String(value).replace(/\s+/g, '');
  const numeric = Number(normalized);
  if (Number.isInteger(numeric) && numeric > 0) return numeric;
  const map = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  return map[normalized] || null;
}

function parseOrdinalFromPrompt(prompt) {
  if (/首个|第一个|第一次|第1个|第1次/i.test(prompt)) return 1;
  const match = String(prompt || '').match(/第\s*([一二两三四五六七八九十\d]+)\s*(?:个|次)/);
  return parseOrdinal(match?.[1]);
}

function parsePositionFromPrompt(prompt) {
  const text = String(prompt || '');
  const atMatch = text.match(/@(\d+)\s*[-－]\s*(\d+)/);
  if (atMatch) return { staffIndex: Number(atMatch[1]) - 1, nodeIndex: Number(atMatch[2]) - 1 };
  const rowColumnMatch = text.match(/行\s*(\d+).*?第?\s*(\d+)\s*列/);
  if (rowColumnMatch) return { staffIndex: Number(rowColumnMatch[1]) - 1, nodeIndex: Number(rowColumnMatch[2]) - 1 };
  return null;
}

export function buildMainWorkbenchButtonEvidence(button, reason = 'button') {
  const buffs = Array.isArray(button?.selectedBuffs) && button.selectedBuffs.length
    ? button.selectedBuffs.map(formatBuffName).filter(Boolean)
    : (Array.isArray(button?.selectedBuffIds) ? button.selectedBuffIds : []);
  return {
    kind: 'skillButton',
    reason,
    buttonId: button?.id || '',
    label: formatButtonLabel(button),
    characterName: button?.characterName || '',
    skillType: button?.skillType || '',
    skillDisplayName: button?.skillDisplayName || button?.skillType || '',
    staffIndex: typeof button?.staffIndex === 'number' ? button.staffIndex : 0,
    lineIndex: typeof button?.lineIndex === 'number' ? button.lineIndex : 0,
    nodeIndex: typeof button?.nodeIndex === 'number' ? button.nodeIndex : undefined,
    position: `${(button?.staffIndex || 0) + 1}-${(button?.nodeIndex ?? 0) + 1}`,
    buffCount: buffs.length,
    buffs,
  };
}

function resolvePromptFocus(snapshot, prompt) {
  const buttons = Array.isArray(snapshot?.skillButtons) ? snapshot.skillButtons : [];
  if (!buttons.length) return null;
  const normalizedPrompt = normalizeFocusText(prompt);
  const mentionedCharacterNames = (Array.isArray(snapshot?.selectedCharacters) ? snapshot.selectedCharacters : [])
    .filter((character) => normalizedPrompt.includes(normalizeFocusText(character?.name)))
    .map((character) => character.name);
  const skillNames = [...new Set(buttons.map((button) => button?.skillDisplayName || button?.skillType).filter(Boolean))];
  const mentionedSkillNames = skillNames.filter((skillName) => normalizedPrompt.includes(normalizeFocusText(skillName)));
  const position = parsePositionFromPrompt(prompt);
  const ordinal = parseOrdinalFromPrompt(prompt);
  if (!position && !mentionedSkillNames.length && !ordinal) return null;

  let candidates = buttons;
  if (mentionedCharacterNames.length) {
    candidates = candidates.filter((button) => mentionedCharacterNames.includes(button?.characterName));
  }
  if (mentionedSkillNames.length) {
    candidates = candidates.filter((button) => mentionedSkillNames.includes(button?.skillDisplayName || button?.skillType));
  }
  if (position) {
    candidates = candidates.filter((button) => button?.staffIndex === position.staffIndex && (button?.nodeIndex ?? -1) === position.nodeIndex);
  }
  if (!candidates.length) return null;
  const sorted = [...candidates].sort((left, right) => (
    ((left?.staffIndex || 0) - (right?.staffIndex || 0)) ||
    ((left?.lineIndex || 0) - (right?.lineIndex || 0)) ||
    ((left?.nodeIndex ?? 0) - (right?.nodeIndex ?? 0))
  ));
  const target = sorted[Math.max(0, (ordinal || 1) - 1)];
  return target ? buildMainWorkbenchButtonEvidence(target, 'prompt-focus') : null;
}

function resolvePreviousFocus(snapshot, previousFocusOrButtonId) {
  if (!previousFocusOrButtonId) return null;
  const previousFocus = typeof previousFocusOrButtonId === 'string'
    ? { buttonId: previousFocusOrButtonId }
    : previousFocusOrButtonId;
  const buttonId = typeof previousFocus.buttonId === 'string' && previousFocus.buttonId.trim()
    ? previousFocus.buttonId.trim()
    : '';
  const label = typeof previousFocus.label === 'string' ? previousFocus.label : '';
  const button = (Array.isArray(snapshot?.skillButtons) ? snapshot.skillButtons : []).find((item) => item?.id === buttonId)
    || (label ? (snapshot?.skillButtons || []).find((item) => formatButtonLabel(item) === label) : null);
  if (!button) {
    return {
      ...previousFocus,
      kind: 'skillButton',
      reason: 'previous-focus-stale',
      buttonId,
      stale: true,
    };
  }
  return buildMainWorkbenchButtonEvidence(button, 'previous-focus');
}

export function resolveMainWorkbenchSnapshotFocus(snapshot, prompt = '', previousFocusOrButtonId = null) {
  if (!snapshot) {
    return {
      focus: null,
      previousFocus: previousFocusOrButtonId
        ? {
          ...(typeof previousFocusOrButtonId === 'string' ? { buttonId: previousFocusOrButtonId } : previousFocusOrButtonId),
          kind: 'skillButton',
          reason: 'previous-focus-unverified',
          stale: true,
        }
        : null,
    };
  }
  return {
    focus: resolvePromptFocus(snapshot, prompt),
    previousFocus: resolvePreviousFocus(snapshot, previousFocusOrButtonId),
  };
}

function formatDamageValue(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
}

export function buildMainWorkbenchEvidence(snapshot, options = {}) {
  const prompt = typeof options.prompt === 'string' ? options.prompt : '';
  const inferredGoal = options.inferredGoal || null;
  const focusState = options.focusState || resolveMainWorkbenchSnapshotFocus(
    snapshot,
    prompt,
    options.previousFocus || options.previousButtonId || null,
  );
  const buttons = (Array.isArray(snapshot?.skillButtons) ? snapshot.skillButtons : []).map((button) => buildMainWorkbenchButtonEvidence(button));
  const mentionedCharacterNames = Array.isArray(inferredGoal?.characterNames) ? inferredGoal.characterNames : [];
  const mentionedCharacterButtons = mentionedCharacterNames.length
    ? buttons.filter((button) => mentionedCharacterNames.includes(button.characterName))
    : buttons;
  const damageButtons = (snapshot?.damageReport?.buttons || []).map((button) => ({
    id: button?.id || '',
    label: `${button?.characterName || ''}-${button?.skillName || ''}`,
    characterName: button?.characterName || '',
    skillName: button?.skillName || '',
    skillType: button?.skillType || '',
    expected: formatDamageValue(button?.expected),
    damage: formatDamageValue(button?.damage),
  }));
  return {
    source: 'current-checkout-snapshot',
    readonly: true,
    note: [
      'This evidence is read from the current checked-out main workbench snapshot.',
      'It is not an appdata AI work node and must not be treated as branch/commit/rollback state.',
      'Use focus or previousFocus for pronoun follow-ups before falling back to character/global summaries.',
      'If focus is present, prioritize focus over character-level or global summaries.',
      'If focus is absent and previousFocus is valid, use previousFocus for pronoun follow-ups.',
      'When the user asks about a specific button, answer for that button, not the whole character or whole timeline.',
    ],
    prompt,
    inferredGoal,
    selectedCharacters: (Array.isArray(snapshot?.selectedCharacters) ? snapshot.selectedCharacters : []).map((character) => ({
      id: character?.id || '',
      name: character?.name || '',
      element: character?.element || '',
      profession: character?.profession || '',
    })),
    focus: focusState.focus || null,
    previousFocus: focusState.previousFocus || null,
    buttons,
    mentionedCharacterButtons,
    equipment: (Array.isArray(snapshot?.operatorConfigs) ? snapshot.operatorConfigs : []).map((config) => ({
      characterName: config?.characterName || '',
      weapon: config?.weapon ? {
        name: config.weapon.name,
        level: config.weapon.level,
        potential: config.weapon.potential,
      } : null,
      equipment: (Array.isArray(config?.equipment) ? config.equipment : []).map((item) => ({
        slotKey: item?.slotKey || '',
        part: item?.part || '',
        name: item?.name || '',
      })),
    })),
    damageReport: snapshot?.damageReport ? {
      totalExpected: formatDamageValue(snapshot.damageReport.totalExpected),
      totalNonCrit: formatDamageValue(snapshot.damageReport.totalNonCrit),
      buttonCount: snapshot.damageReport.buttonCount,
      buttons: damageButtons,
    } : null,
    lastCommand: snapshot?.lastCommand || null,
  };
}
