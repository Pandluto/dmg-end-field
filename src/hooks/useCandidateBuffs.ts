/**
 * 候选 Buff 管理 Hook
 * 负责候选 Buff 加载、刷新、搜索匹配
 * 不涉及已选 Buff 添加逻辑
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { CandidateBuff, BuffData } from '../core/domain/buff';
import { setCandidateBuffList, getCandidateBuffList } from '../core/repositories';
import {
  refreshAvailableCandidateBuffsForCharacters,
} from '../core/services/operatorConfigCandidateBuffService';
import { buildWeaponSearchIndex, searchWeapons } from '../utils/weaponFuzzySearch';
import { resolvePublicPath } from '../utils/assetResolver';

interface CandidateCharacterRef {
  id: string;
  name: string;
}

/**
 * 加载单个 buff.json 文件
 * @param path - JSON 文件路径
 * @returns Promise<BuffData> Buff 数据对象
 */
const loadBuffFile = async (path: string): Promise<BuffData> => {
  const response = await fetch(resolvePublicPath(path), { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`加载失败: ${path}`);
  }
  return response.json();
};

interface NameListItem {
  name?: string;
}

async function loadNameList(path: string): Promise<string[]> {
  const response = await fetch(resolvePublicPath(path), { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`加载失败: ${path}`);
  }
  const parsed = await response.json() as NameListItem[];
  return parsed
    .map((item) => item.name?.trim() || '')
    .filter((name) => name.length > 0);
}

function normalizeKeyword(value: string): string {
  return value.trim().toLowerCase();
}

function buffMatchesKeyword(buff: CandidateBuff, keyword: string): boolean {
  if (!keyword) return false;
  return [
    buff.source,
    buff.sourceName,
    buff.displayName,
    buff.name,
    buff.description,
    buff.condition ?? '',
  ].some((value) => value.toLowerCase().includes(keyword));
}

function includesKeyword(name: string, keyword: string): boolean {
  if (!keyword) {
    return false;
  }
  return name.toLowerCase().includes(keyword);
}

function mapCharacterBuffJsonToCandidates(sourceName: string, data: BuffData): CandidateBuff[] {
  return (data.buffs || []).map((buff) => ({
    ...buff,
    source: sourceName,
    sourceName: buff.sourceName || sourceName,
    ownerBuffDomain: buff.ownerBuffDomain || 'operator',
  }));
}

function mapWeaponBuffJsonToCandidates(sourceName: string, data: BuffData): CandidateBuff[] {
  return (data.buffs || []).map((buff) => ({
    ...buff,
    source: sourceName,
    sourceName: buff.sourceName || sourceName,
    ownerBuffDomain: buff.ownerBuffDomain || 'weapon',
    ownerBuffGroup: buff.ownerBuffGroup || 'weaponSkill',
  }));
}

async function loadAllCharacterCandidateBuffs(keyword: string): Promise<CandidateBuff[]> {
  const operatorNames = await loadNameList('data/characters/operators-list.json');
  const matchedNames = operatorNames.filter((name) => includesKeyword(name, keyword));
  const results = await Promise.allSettled(
    matchedNames.map(async (name) => {
      const path = `data/characters/${name}/${name}buff.json`;
      const data = await loadBuffFile(path);
      return mapCharacterBuffJsonToCandidates(name, data);
    })
  );
  return results
    .filter((result): result is PromiseFulfilledResult<CandidateBuff[]> => result.status === 'fulfilled')
    .flatMap((result) => result.value);
}

async function loadAllWeaponCandidateBuffs(keyword: string): Promise<CandidateBuff[]> {
  const weaponNames = await loadNameList('data/weapons/weapons-list.json');
  const matchedNames = weaponNames.filter((name) => includesKeyword(name, keyword));
  const results = await Promise.allSettled(
    matchedNames.map(async (name) => {
      const path = `data/weapons/${name}/${name}buff.json`;
      const data = await loadBuffFile(path);
      return mapWeaponBuffJsonToCandidates(name, data);
    })
  );
  return results
    .filter((result): result is PromiseFulfilledResult<CandidateBuff[]> => result.status === 'fulfilled')
    .flatMap((result) => result.value);
}

export async function searchManualCandidateBuffsByName(keyword: string): Promise<CandidateBuff[]> {
  const normalizedKeyword = normalizeKeyword(keyword);
  if (!normalizedKeyword) {
    return [];
  }

  const [characterBuffs, weaponBuffs] = await Promise.all([
    loadAllCharacterCandidateBuffs(normalizedKeyword),
    loadAllWeaponCandidateBuffs(normalizedKeyword),
  ]);
  return [...characterBuffs, ...weaponBuffs];
}

export interface UseCandidateBuffsReturn {
  /** 候选 Buff 列表 */
  buffList: CandidateBuff[];
  /** 搜索关键词 */
  searchKeyword: string;
  /** 设置搜索关键词 */
  setSearchKeyword: (keyword: string) => void;
  /** 匹配的 source 列表 */
  matchedSources: string[];
  /** 匹配的 Buff 列表 */
  matchedBuffs: CandidateBuff[];
  /** 加载状态 */
  isLoading: boolean;
  /** 刷新候选 Buff 列表 */
  handleRefresh: () => Promise<void>;
  /** 抽屉是否打开 */
  isDrawerOpen: boolean;
  /** 设置抽屉是否打开 */
  setIsDrawerOpen: (isOpen: boolean) => void;
  /** 抽屉容器引用 */
  drawerHostRef: React.RefObject<HTMLDivElement>;
}

/**
 * 候选 Buff 管理 Hook
 * @param characters - 角色引用列表
 * @returns 候选 Buff 状态和操作
 */
export function useCandidateBuffs(characters: CandidateCharacterRef[]): UseCandidateBuffsReturn {
  // 候选 Buff 列表：从 def.candidate-buff-list.v1 回填，避免切换后变空
  const [buffList, setBuffList] = useState<CandidateBuff[]>(() => getCandidateBuffList());
  // 加载状态
  const [isLoading, setIsLoading] = useState(false);
  // 搜索关键词
  const [searchKeyword, setSearchKeyword] = useState('');
  // 抽屉是否打开
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  // 抽屉容器引用
  const drawerHostRef = useRef<HTMLDivElement>(null);

  /**
   * 构建 Buff 搜索索引
   */
  const buffSearchIndex = useMemo(() => {
    const sources = Array.from(new Set(buffList.map(buff => buff.source)));
    return buildWeaponSearchIndex(sources);
  }, [buffList]);

  /**
   * 搜索匹配的 source 列表
   */
  const matchedSources = useMemo(() => {
    const normalizedKeyword = normalizeKeyword(searchKeyword);
    if (!normalizedKeyword) {
      return [];
    }
    const sourceMatches = searchWeapons(searchKeyword, buffSearchIndex);
    const directMatches = buffList
      .filter((buff) => buffMatchesKeyword(buff, normalizedKeyword))
      .map((buff) => buff.source);
    return Array.from(new Set([...sourceMatches, ...directMatches]));
  }, [searchKeyword, buffSearchIndex, buffList]);

  /**
   * 获取匹配到的 Buff 列表
   */
  const matchedBuffs = useMemo(() => {
    const normalizedKeyword = normalizeKeyword(searchKeyword);
    if (matchedSources.length === 0 && !normalizedKeyword) {
      return [];
    }
    return buffList.filter((buff) => (
      matchedSources.includes(buff.source)
      || buffMatchesKeyword(buff, normalizedKeyword)
    ));
  }, [matchedSources, buffList, searchKeyword]);

  /**
   * 点击外部关闭抽屉
   */
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (drawerHostRef.current && !drawerHostRef.current.contains(event.target as Node)) {
        setIsDrawerOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  /**
   * 刷新按钮点击处理函数
   */
  const handleRefresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const buffs = await refreshAvailableCandidateBuffsForCharacters(characters);
      setBuffList(buffs);
      // 只写入候选 Buff 列表，不触碰已选 Buff 实体表
      setCandidateBuffList(buffs);
    } catch (error) {
      console.error('刷新 Buff 列表失败:', error);
    } finally {
      setIsLoading(false);
    }
  }, [characters]);

  return {
    buffList,
    searchKeyword,
    setSearchKeyword,
    matchedSources,
    matchedBuffs,
    isLoading,
    handleRefresh,
    isDrawerOpen,
    setIsDrawerOpen,
    drawerHostRef,
  };
}
