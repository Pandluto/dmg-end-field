export type AiFillSourceKind = 'character' | 'weapon' | 'mixed' | 'generic';

export type AiFillSectionType =
  | 'talent'
  | 'potential'
  | 'skill'
  | 'weaponFixed'
  | 'weaponSpecial'
  | 'generic';

export interface AiFillWorkflowSection {
  id: string;
  title: string;
  promptLabel: string;
  sourceKind: AiFillSourceKind;
  sectionType: AiFillSectionType;
  rawText: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  rawResponse: string;
  errors: string[];
}

export interface AiFillWorkflowState {
  sourceKind: AiFillSourceKind;
  sections: AiFillWorkflowSection[];
}

function createSection(
  id: string,
  title: string,
  promptLabel: string,
  sourceKind: AiFillSourceKind,
  sectionType: AiFillSectionType,
  rawText: string,
): AiFillWorkflowSection {
  return {
    id,
    title,
    promptLabel,
    sourceKind,
    sectionType,
    rawText: rawText.trim(),
    status: 'pending',
    rawResponse: '',
    errors: [],
  };
}

function normalizeLines(sourceText: string) {
  return sourceText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim());
}

function chunkByHeadings(lines: string[], headings: string[]) {
  const sections: Array<{ heading: string; lines: string[] }> = [];
  let currentHeading = '';
  let currentLines: string[] = [];

  const flush = () => {
    if (!currentHeading || currentLines.length === 0) {
      return;
    }
    sections.push({ heading: currentHeading, lines: currentLines.slice() });
  };

  lines.forEach((line) => {
    if (!line) {
      if (currentLines.length > 0) {
        currentLines.push('');
      }
      return;
    }
    if (headings.includes(line)) {
      flush();
      currentHeading = line;
      currentLines = [];
      return;
    }
    if (!currentHeading) {
      currentHeading = 'generic';
    }
    currentLines.push(line);
  });

  flush();
  return sections;
}

function splitMixedSourceLines(lines: string[]) {
  const characterHeadings = new Set(['天赋', '潜能', '技能']);
  const weaponHeadings = new Set(['固定值', '特效']);
  const genericLines: string[] = [];
  const characterLines: string[] = [];
  const weaponLines: string[] = [];
  let currentZone: 'character' | 'weapon' | null = null;

  lines.forEach((line) => {
    if (characterHeadings.has(line)) {
      currentZone = 'character';
      characterLines.push(line);
      return;
    }
    if (weaponHeadings.has(line)) {
      currentZone = 'weapon';
      weaponLines.push(line);
      return;
    }
    if (currentZone === 'character') {
      characterLines.push(line);
      return;
    }
    if (currentZone === 'weapon') {
      weaponLines.push(line);
      return;
    }
    genericLines.push(line);
  });

  return {
    genericLines,
    characterLines,
    weaponLines,
  };
}

function inferMixedGenericSectionTarget(text: string): { promptLabel: string; sourceKind: AiFillSourceKind } {
  const inferredKind = detectAiFillSourceKind(text);
  if (inferredKind === 'weapon') {
    return { promptLabel: '武器 Buff', sourceKind: 'weapon' };
  }
  if (inferredKind === 'character') {
    return { promptLabel: '角色 Buff', sourceKind: 'character' };
  }
  return { promptLabel: '通用 Buff', sourceKind: 'generic' };
}

export function detectAiFillSourceKind(sourceText: string): AiFillSourceKind {
  const text = sourceText.toLowerCase();
  const hasCharacterMarkers = ['天赋', '潜能', '技能', '突破', '普通攻击', '战技', '终结技'].some((keyword) => text.includes(keyword));
  const hasWeaponMarkers = ['武器', '特效', '固定值', 'skill3', '装备者', '连携技伤害', '施加附着'].some((keyword) => text.includes(keyword));

  if (hasCharacterMarkers && hasWeaponMarkers) {
    return 'mixed';
  }
  if (hasCharacterMarkers) {
    return 'character';
  }
  if (hasWeaponMarkers) {
    return 'weapon';
  }
  return 'generic';
}

export function splitAiFillWorkflow(sourceText: string): AiFillWorkflowState {
  const sourceKind = detectAiFillSourceKind(sourceText);
  const lines = normalizeLines(sourceText);

  if (sourceKind === 'character') {
    const chunks = chunkByHeadings(lines, ['天赋', '潜能', '技能']);
    const sections = chunks.map<AiFillWorkflowSection>((chunk, index) => {
      const sectionType =
        chunk.heading === '天赋' ? 'talent' :
        chunk.heading === '潜能' ? 'potential' :
        chunk.heading === '技能' ? 'skill' :
        'generic';
      return createSection(
        `section-${index + 1}`,
        chunk.heading === 'generic' ? `片段 ${index + 1}` : chunk.heading,
        '角色 Buff',
        sourceKind,
        sectionType,
        chunk.lines.join('\n'),
      );
    }).filter((section) => section.rawText);

    if (sections.length > 0) {
      return { sourceKind, sections };
    }
  }

  if (sourceKind === 'weapon') {
    const chunks = chunkByHeadings(lines, ['固定值', '特效']);
    const sections = chunks.map<AiFillWorkflowSection>((chunk, index) => {
      const sectionType =
        chunk.heading === '固定值' ? 'weaponFixed' :
        chunk.heading === '特效' ? 'weaponSpecial' :
        'generic';
      return createSection(
        `section-${index + 1}`,
        chunk.heading === 'generic' ? `片段 ${index + 1}` : chunk.heading,
        '武器 Buff',
        sourceKind,
        sectionType,
        chunk.lines.join('\n'),
      );
    }).filter((section) => section.rawText);

    if (sections.length > 0) {
      return { sourceKind, sections };
    }
  }

  if (sourceKind === 'mixed') {
    const sections: AiFillWorkflowSection[] = [];
    const { genericLines, characterLines, weaponLines } = splitMixedSourceLines(lines);
    const characterChunks = chunkByHeadings(characterLines, ['天赋', '潜能', '技能']);
    const weaponChunks = chunkByHeadings(weaponLines, ['固定值', '特效']);

    if (characterChunks.length > 0) {
      sections.push(
        ...characterChunks.map((chunk, index) => {
          const sectionType =
            chunk.heading === '天赋' ? 'talent' :
            chunk.heading === '潜能' ? 'potential' :
            chunk.heading === '技能' ? 'skill' :
            'generic';
          return createSection(
            `character-section-${index + 1}`,
            `角色-${chunk.heading === 'generic' ? `片段 ${index + 1}` : chunk.heading}`,
            '角色 Buff',
            'character',
            sectionType,
            chunk.lines.join('\n'),
          );
        }).filter((section) => section.rawText)
      );
    }

    if (weaponChunks.length > 0) {
      sections.push(
        ...weaponChunks.map((chunk, index) => {
          const sectionType =
            chunk.heading === '固定值' ? 'weaponFixed' :
            chunk.heading === '特效' ? 'weaponSpecial' :
            'generic';
          return createSection(
            `weapon-section-${index + 1}`,
            `武器-${chunk.heading === 'generic' ? `片段 ${index + 1}` : chunk.heading}`,
            '武器 Buff',
            'weapon',
            sectionType,
            chunk.lines.join('\n'),
          );
        }).filter((section) => section.rawText)
      );
    }

    if (genericLines.some((line) => line.trim())) {
      const genericTarget = inferMixedGenericSectionTarget(genericLines.join('\n'));
      sections.push(
        createSection(
          'mixed-generic-1',
          '混合-补充文本',
          genericTarget.promptLabel,
          genericTarget.sourceKind,
          'generic',
          genericLines.join('\n'),
        ),
      );
    }

    if (sections.length === 0) {
      sections.push(
        createSection('character-section-1', '角色-原始文本', '角色 Buff', 'character', 'generic', sourceText),
        createSection('weapon-section-1', '武器-原始文本', '武器 Buff', 'weapon', 'generic', sourceText),
      );
    }

    return { sourceKind, sections };
  }

  return {
    sourceKind,
    sections: [
      createSection(
        'section-1',
        '原始文本',
        sourceKind === 'weapon' ? '武器 Buff' : '角色 Buff',
        sourceKind === 'weapon' ? 'weapon' : 'character',
        'generic',
        sourceText,
      ),
    ],
  };
}

export function extractArkOutputText(value: unknown): string {
  if (value && typeof value === 'object') {
    const root = value as Record<string, unknown>;
    if (Array.isArray(root.choices)) {
      for (const choice of root.choices) {
        if (choice && typeof choice === 'object') {
          const message = (choice as Record<string, unknown>).message;
          if (message && typeof message === 'object') {
            const content = (message as Record<string, unknown>).content;
            if (typeof content === 'string' && content.trim()) {
              return content.trim();
            }
          }
        }
      }
    }
  }

  const texts: string[] = [];
  const visit = (node: unknown) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node === 'object') {
      const candidate = node as Record<string, unknown>;
      if (candidate.type === 'output_text' && typeof candidate.text === 'string' && candidate.text.trim()) {
        texts.push(candidate.text.trim());
      }
      if (typeof candidate.text === 'string' && candidate.text.trim()) {
        texts.push(candidate.text.trim());
      }
      Object.values(candidate).forEach(visit);
    }
  };
  visit(value);
  return texts.join('\n\n').trim();
}

function buildSectionPromptRules(section: AiFillWorkflowSection) {
  if (section.sourceKind === 'weapon') {
    return [
      '这是武器 Buff 片段。',
      '只提取条件 Buff 或特效 Buff。',
      '常驻面板说明、基础属性说明、没有明确增减数值的文案不要生成 effect。',
      section.sectionType === 'weaponFixed'
        ? '当前片段偏固定值说明，只有明确能映射成 Buff 的固定数值才保留。'
        : '当前片段偏特效说明，优先提取触发条件明确的 Buff。',
    ].join('\n');
  }

  if (section.sectionType === 'skill') {
    return [
      '这是角色技能说明片段。',
      '纯技能动作描述、攻击方式说明、段数说明、造成某属性伤害这类内容不是 Buff，不要生成 effect。',
      '只有明确出现提升、增加、降低、增幅、易伤、倍率变化、属性变化时，才生成 effect。',
    ].join('\n');
  }

  if (section.sectionType === 'potential') {
    return [
      '这是角色潜能片段。',
      '潜能 1/2/3/4/5 通常归在同一个 item 下。',
      '白名单外机制直接舍弃，不要输出空壳 effect。',
    ].join('\n');
  }

  if (section.sectionType === 'talent') {
    return [
      '这是角色天赋片段。',
      '同名天赋不同突破阶段可以归在同一个 item 下，按独立 effect 输出。',
      '白名单外机制直接舍弃，不要输出空壳 effect。',
    ].join('\n');
  }

  if (section.sourceKind === 'generic' || section.promptLabel === '通用 Buff') {
    return [
      '这是混合补充片段或通用 Buff 片段。',
      '只提取原文明确能映射成当前编辑器支持字段的 Buff。',
      '如果只是标题、前置说明、来源说明或无法判断归属的文本，不要生成 effect。',
    ].join('\n');
  }

  return section.promptLabel === '武器 Buff' ? '这是武器 Buff 片段。' : '这是角色 Buff 片段。';
}

export function buildBuffFillSectionPrompt(
  systemPrompt: string,
  catalogPrompt: string,
  section: AiFillWorkflowSection,
) {
  return [
    systemPrompt.trim(),
    '',
    '执行补充：',
    '1. 只返回一个 JSON 对象。',
    '2. 必须返回数组中间结构：items 是数组，effects 是数组。',
    '3. 只处理当前片段，不要脑补片段之外的内容。',
    '4. 不合法 effect 直接舍弃，不要输出空壳 effect。',
    '5. 根对象必须显式提供 id/name/sourceName/source/description/items 这 6 个字段。',
    '6. 每个 item 必须显式提供 name/sourceName/description/effects 这 4 个字段。',
    '7. 每个 effect 必须使用扁平字段：displayName/name/level/source/sourceName/description/condition/effectKind/type/value/evidenceText/confidence。',
    '',
    buildSectionPromptRules(section),
    '',
    'modifier.type 白名单词典：',
    catalogPrompt,
    '',
    `当前片段标题：${section.title}`,
    `当前片段类型：${section.sectionType}`,
    '',
    '待整理内容：',
    section.rawText.trim(),
  ].join('\n');
}
