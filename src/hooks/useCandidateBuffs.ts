/**
 * 候选 Buff 管理 Hook
 * 负责候选 Buff 加载、刷新、搜索匹配
 * 不涉及已选 Buff 添加逻辑
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { CandidateBuff, BuffData } from '../core/domain/buff';
import { setCandidateBuffList, getCandidateBuffList } from '../core/repositories';
import { getCharacterConfigMap } from '../utils/storage';
import { buildWeaponSearchIndex, searchWeapons } from '../utils/weaponFuzzySearch';

interface CandidateCharacterRef {
  id: string;
  name: string;
}

/**
 * 从 sessionStorage 读取角色武器配置映射
 * @param characters - 已选角色引用
 * @returns 角色显示名到武器名的映射对象
 */
const getCharacterWeapons = (characters: CandidateCharacterRef[]): Record<string, string> => {
  try {
    const configMap = getCharacterConfigMap();
    if (Object.keys(configMap).length === 0) {
      console.log('未找到角色配置数据');
      return {};
    }

    const selectedNameSet = new Set(characters.map((character) => character.name));
    const selectedIdToNameMap = new Map(characters.map((character) => [character.id, character.name]));
    const weaponMap: Record<string, string> = {};
    Object.entries(configMap).forEach(([characterId, config]) => {
      const selectedCharacterName =
        selectedIdToNameMap.get(characterId) ||
        (selectedNameSet.has(config.characterName) ? config.characterName : null);
      if (selectedCharacterName && config.weaponName && config.weaponName !== '无') {
        // 后续角色 buff 仍按显示名 charName 加载，这里统一把武器映射落到显示名。
        weaponMap[selectedCharacterName] = config.weaponName;
      }
    });

    console.log('从 characterConfigMap 提取的武器配置:', weaponMap);
    return weaponMap;
  } catch (error) {
    console.warn('读取角色武器配置失败:', error);
    return {};
  }
};

/**
 * 加载单个 buff.json 文件
 * @param path - JSON 文件路径
 * @returns Promise<BuffData> Buff 数据对象
 */
const loadBuffFile = async (path: string): Promise<BuffData> => {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`加载失败: ${path}`);
  }
  return response.json();
};

interface NameListItem {
  name?: string;
}

async function loadNameList(path: string): Promise<string[]> {
  const response = await fetch(path);
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
  }));
}

function mapWeaponBuffJsonToCandidates(sourceName: string, data: BuffData): CandidateBuff[] {
  return (data.buffs || []).map((buff) => ({
    ...buff,
    source: sourceName,
  }));
}

async function loadAllCharacterCandidateBuffs(keyword: string): Promise<CandidateBuff[]> {
  const operatorNames = await loadNameList('/data/characters/operators-list.json');
  const matchedNames = operatorNames.filter((name) => includesKeyword(name, keyword));
  const results = await Promise.allSettled(
    matchedNames.map(async (name) => {
      const path = `/data/characters/${name}/${name}buff.json`;
      const data = await loadBuffFile(path);
      return mapCharacterBuffJsonToCandidates(name, data);
    })
  );
  return results
    .filter((result): result is PromiseFulfilledResult<CandidateBuff[]> => result.status === 'fulfilled')
    .flatMap((result) => result.value);
}

async function loadAllWeaponCandidateBuffs(keyword: string): Promise<CandidateBuff[]> {
  const weaponNames = await loadNameList('/data/weapons/weapons-list.json');
  const matchedNames = weaponNames.filter((name) => includesKeyword(name, keyword));
  const results = await Promise.allSettled(
    matchedNames.map(async (name) => {
      const path = `/data/weapons/${name}/${name}buff.json`;
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
    if (!searchKeyword.trim()) {
      return [];
    }
    return searchWeapons(searchKeyword, buffSearchIndex);
  }, [searchKeyword, buffSearchIndex]);

  /**
   * 获取匹配到的 Buff 列表
   */
  const matchedBuffs = useMemo(() => {
    if (matchedSources.length === 0) {
      return [];
    }
    return buffList.filter(buff => matchedSources.includes(buff.source));
  }, [matchedSources, buffList]);

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
   * 加载所有 Buff 数据并合并
   */
  const loadAllBuffs = useCallback(async (): Promise<CandidateBuff[]> => {
    const characterNames = characters.map((character) => character.name);
    const weapons = getCharacterWeapons(characters);

    console.log('【刷新 Buff 数据】');
    console.log('搜索的角色:', characterNames.length > 0 ? characterNames.join(', ') : '无');
    console.log('角色武器配置:', weapons);

    const loadTasks: Array<{ path: string; source: string; type: 'character' | 'weapon' }> = [];

    // 暂时停用“刷新时按已选角色自动加载角色 Buff”。
    // 保留下面的武器 Buff 刷新链路，以及 DamageTab 里的手动搜索入口。
    // characterNames.forEach((charName) => {
    //   if (charName) {
    //     loadTasks.push({
    //       path: `/data/characters/${charName}/${charName}buff.json`,
    //       source: charName,
    //       type: 'character',
    //     });
    //   }
    // });

    characterNames.forEach((charName) => {
      const weaponName = weapons[charName];
      if (weaponName) {
        loadTasks.push({
          path: `/data/weapons/${weaponName}/${weaponName}buff.json`,
          source: weaponName,
          type: 'weapon',
        });
      }
    });

    console.log('需要加载的文件:', loadTasks.map(t => `${t.source} (${t.type})`));

    const results = await Promise.allSettled(
      loadTasks.map(async ({ path, source, type }) => {
        try {
          const data = await loadBuffFile(path);
          console.log(`✓ 找到 ${type === 'character' ? '角色' : '武器'} buff: ${source}`);
          return (data.buffs || []).map((buff) => ({
            ...buff,
            source,
          }));
        } catch (error) {
          console.warn(`✗ 未找到 ${type === 'character' ? '角色' : '武器'} buff: ${source} (${path})`);
          return [];
        }
      })
    );

    const allBuffs: CandidateBuff[] = [];
    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        allBuffs.push(...result.value);
      }
    });

    console.log(`共加载 ${allBuffs.length} 个 buff`);
    return allBuffs;
  }, [characters]);

  /**
   * 刷新按钮点击处理函数
   */
  const handleRefresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const buffs = await loadAllBuffs();
      setBuffList(buffs);
      // 只写入候选 Buff 列表，不触碰已选 Buff 实体表
      setCandidateBuffList(buffs);
    } catch (error) {
      console.error('刷新 Buff 列表失败:', error);
    } finally {
      setIsLoading(false);
    }
  }, [loadAllBuffs]);

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

