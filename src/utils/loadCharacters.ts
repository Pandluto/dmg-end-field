import { Character } from '../types';
import { resolvePublicPath } from './assetResolver';

const CHARACTER_FILES = [
  '管理员.json',
  '汤汤.json',
  '洛茜.json',
  '别礼.json',
  '埃特拉.json',
  '阿列什.json',
  '陈千语.json',
];

export async function loadCharacters(): Promise<Character[]> {
  const characters: Character[] = [];

  for (const fileName of CHARACTER_FILES) {
    try {
      const response = await fetch(resolvePublicPath(`data/characters/${fileName}`));
      if (!response.ok) {
        console.warn(`Failed to load ${fileName}: ${response.status}`);
        continue;
      }
      const data = await response.json();
      characters.push(data as Character);
    } catch (error) {
      console.warn(`Failed to load ${fileName}:`, error);
    }
  }

  return characters;
}

export function getCharacterElement(name: string): string {
  const elementMap: Record<string, string> = {
    physical: '物理',
    fire: '灼热',
    ice: '寒冷',
    electric: '电磁',
    nature: '自然',
  };
  return elementMap[name] || name;
}

export function getCharacterRarity(rarity: number): string {
  return '★'.repeat(rarity);
}
