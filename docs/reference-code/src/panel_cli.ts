import { calculatePanel, formatPanelResult, EquipmentBonus } from './panel_template';

function parseArgs(): { character: string; weapon: string | null; charLevel: number; weaponLevel: number; matrix: string; equipment: Partial<EquipmentBonus> } {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.log('用法: npm run panel -- <角色名> [武器名] [角色等级] [武器等级] [珠子码] [装备加成JSON]');
    console.log('');
    console.log('示例:');
    console.log('  npm run panel -- 管理员 宏愿 90 90 663');
    console.log('  npm run panel -- 管理员 宏愿 90 90 663 \'{"critRate":0.1,"critDmg":0.2}\'');
    console.log('  npm run panel -- 管理员 无 90 0 0');
    process.exit(1);
  }

  const character = args[0];
  const weapon = args[1] && args[1] !== '无' ? args[1] : null;
  const charLevel = parseInt(args[2]) || 90;
  const weaponLevel = parseInt(args[3]) || 0;
  const matrix = args[4] || '0';
  
  let equipment: Partial<EquipmentBonus> = {};
  if (args[5]) {
    try {
      equipment = JSON.parse(args[5]);
    } catch (e) {
      console.error('装备加成 JSON 解析失败，将使用默认值');
    }
  }

  return { character, weapon, charLevel, weaponLevel, matrix, equipment };
}

function main(): void {
  const { character, weapon, charLevel, weaponLevel, matrix, equipment } = parseArgs();

  try {
    const result = calculatePanel({
      characterName: character,
      characterLevel: charLevel,
      weaponName: weapon || undefined,
      weaponLevel: weapon ? weaponLevel : undefined,
      matrixCode: matrix,
      equipment
    });

    console.log(formatPanelResult(result));
  } catch (error) {
    console.error('计算失败:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
