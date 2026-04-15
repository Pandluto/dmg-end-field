import Fuse from 'fuse.js';
import { pinyin } from 'pinyin-pro';

export interface WeaponSearchEntry {
  name: string;
  normalizedName: string;
  fullPinyin: string;
  initials: string;
}

const normalizeText = (value: string) => value.toLowerCase().replace(/[\s.\-_/]/g, '');

const buildPhoneticFields = (value: string) => {
  const pinyinArray = pinyin(value, { toneType: 'none', type: 'array' })
    .map((item) => normalizeText(String(item)))
    .filter((item) => item.length > 0);
  const fullPinyin = pinyinArray.join('');
  const initials = pinyinArray.map((item) => item[0]).join('');
  return { fullPinyin, initials };
};

export const buildWeaponSearchIndex = (weaponNames: string[]): WeaponSearchEntry[] =>
  weaponNames.map((name) => {
    const normalizedName = normalizeText(name);
    const { fullPinyin, initials } = buildPhoneticFields(name);
    return {
      name,
      normalizedName,
      fullPinyin,
      initials,
    };
  });

export const searchWeapons = (keyword: string, index: WeaponSearchEntry[]) => {
  const normalizedKeyword = normalizeText(keyword);
  if (!normalizedKeyword) {
    return [];
  }

  const directMatches = index
    .filter(({ name, normalizedName, fullPinyin, initials }) => {
      const rawIncludes = name.includes(keyword.trim());
      const normalizedIncludes = normalizedName.includes(normalizedKeyword);
      const pinyinIncludes = fullPinyin.includes(normalizedKeyword);
      const initialsIncludes = initials.includes(normalizedKeyword);
      return rawIncludes || normalizedIncludes || pinyinIncludes || initialsIncludes;
    })
    .map(({ name }) => name);

  const fuse = new Fuse(index, {
    keys: ['name', 'normalizedName', 'fullPinyin', 'initials'],
    threshold: 0.38,
    ignoreLocation: true,
    includeScore: true,
    shouldSort: true,
  });
  const fuzzyMatches = fuse.search(normalizedKeyword).map((item) => item.item.name);

  return Array.from(new Set([...directMatches, ...fuzzyMatches]));
};
