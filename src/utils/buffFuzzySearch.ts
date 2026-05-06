import Fuse from 'fuse.js';
import { pinyin } from 'pinyin-pro';

export interface BuffSearchIndexEntry<T> {
  item: T;
  rawText: string;
  normalizedText: string;
  fullPinyin: string;
  initials: string;
}

const normalizeText = (value: string) => value.toLowerCase().replace(/[\s.\-_/|]/g, '');

const buildPhoneticFields = (value: string) => {
  const pinyinArray = pinyin(value, { toneType: 'none', type: 'array' })
    .map((item) => normalizeText(String(item)))
    .filter((item) => item.length > 0);
  const fullPinyin = pinyinArray.join('');
  const initials = pinyinArray.map((item) => item[0]).join('');
  return { fullPinyin, initials };
};

export const buildBuffSearchIndex = <T>(
  items: T[],
  pickSearchTexts: (item: T) => Array<string | null | undefined>
): BuffSearchIndexEntry<T>[] =>
  items.map((item) => {
    const rawText = pickSearchTexts(item)
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join('|');
    const normalizedText = normalizeText(rawText);
    const { fullPinyin, initials } = buildPhoneticFields(rawText);
    return {
      item,
      rawText,
      normalizedText,
      fullPinyin,
      initials,
    };
  });

export const searchBuffs = <T>(
  keyword: string,
  index: BuffSearchIndexEntry<T>[]
): T[] => {
  const trimmedKeyword = keyword.trim();
  const normalizedKeyword = normalizeText(trimmedKeyword);
  if (!normalizedKeyword) {
    return [];
  }

  const directMatches = index
    .filter(({ rawText, normalizedText, fullPinyin, initials }) => {
      const rawIncludes = rawText.includes(trimmedKeyword);
      const normalizedIncludes = normalizedText.includes(normalizedKeyword);
      const pinyinIncludes = fullPinyin.includes(normalizedKeyword);
      const initialsIncludes = initials.includes(normalizedKeyword);
      return rawIncludes || normalizedIncludes || pinyinIncludes || initialsIncludes;
    })
    .map(({ item }) => item);

  const fuse = new Fuse(index, {
    keys: ['rawText', 'normalizedText', 'fullPinyin', 'initials'],
    threshold: 0.38,
    ignoreLocation: true,
    includeScore: true,
    shouldSort: true,
  });
  const fuzzyMatches = fuse.search(normalizedKeyword).map((result) => result.item.item);

  return Array.from(new Set([...directMatches, ...fuzzyMatches]));
};
