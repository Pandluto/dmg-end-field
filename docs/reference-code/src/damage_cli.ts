import {
  DamageBonusInput,
  DamagePanelInput,
  EnemySideInput,
  calculateSkillDamage,
  formatDamageResult,
  resolveSkillType
} from './damage_template';

interface DamageCliOptions {
  characterName: string;
  skillType: string;
  skillLevel?: string;
  panel: Partial<DamagePanelInput>;
  hitKeyWhitelist?: string[];
  damageBonus?: Partial<DamageBonusInput>;
  triggerConditions?: Record<string, boolean>;
  enemy?: Partial<EnemySideInput>;
}

function printUsage(): void {
  console.log('用法: npm run damage -- <角色名> <技能类型> [技能等级] [面板JSON] [配置JSON]');
  console.log('');
  console.log('技能类型支持: 普通攻击 | 战技 | 连携技 | 终结技');
  console.log('技能等级默认: 9，可传 M3');
  console.log('');
  console.log('示例:');
  console.log(
    'npm run damage -- 汤汤 战技 9 \'{"atk":3000,"critRate":0.3,"critDmg":0.8,"iceDmgBonus":0.25,"skillDmgBonus":0.2,"allSkillDmgBonus":0.1}\''
  );
  console.log(
    'npm run damage -- 汤汤 战技 M3 \'{"atk":3000}\' \'{"damageBonus":{"bonusUnconditional":0.1,"bonusConditional":{"低血线":0.2}},"triggerConditions":{"低血线":true},"enemy":{"fragile":0.15}}\''
  );
}

function parseJson<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(`JSON 解析失败: ${raw}`);
  }
}

function parseArgs(argv: string[]): DamageCliOptions {
  if (argv.length < 2) {
    printUsage();
    process.exit(1);
  }

  const [characterName, skillType, maybeLevel, panelJsonRaw, optionsJsonRaw] = argv;
  const maybeLevelUpper = (maybeLevel ?? '').toUpperCase();
  const hasLevelArg = /^(M[1-3]|[1-9])$/.test(maybeLevelUpper);
  const skillLevel = hasLevelArg ? maybeLevelUpper : undefined;
  const panelJson = hasLevelArg ? panelJsonRaw : maybeLevel;
  const optionsJson = hasLevelArg ? optionsJsonRaw : panelJsonRaw;

  const panel = parseJson<Partial<DamagePanelInput>>(panelJson, {});
  const options = parseJson<
    {
      hitKeyWhitelist?: string[];
      damageBonus?: Partial<DamageBonusInput>;
      triggerConditions?: Record<string, boolean>;
      enemy?: Partial<EnemySideInput>;
    }
  >(optionsJson, {});

  return {
    characterName,
    skillType,
    skillLevel,
    panel,
    hitKeyWhitelist: options.hitKeyWhitelist,
    damageBonus: options.damageBonus,
    triggerConditions: options.triggerConditions,
    enemy: options.enemy
  };
}

function main(): void {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = calculateSkillDamage({
      characterName: options.characterName,
      skillType: resolveSkillType(options.skillType),
      skillLevel: options.skillLevel as '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'M1' | 'M2' | 'M3' | undefined,
      panel: options.panel as DamagePanelInput,
      hitKeyWhitelist: options.hitKeyWhitelist,
      damageBonus: options.damageBonus,
      triggerConditions: options.triggerConditions,
      enemy: options.enemy
    });

    console.log(formatDamageResult(result));
  } catch (error) {
    console.error(`计算失败: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main();
