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

/**
 * 从 sessionStorage 读取角色武器配置映射
 * @param characterNames - 角色名称数组
 * @returns 角色名到武器名的映射对象
 */
const getCharacterWeapons = (characterNames: string[]): Record<string, string> => {
  try {
    const configMap = getCharacterConfigMap();
    if (Object.keys(configMap).length === 0) {
      console.log('未找到角色配置数据');
      return {};
    }

    const weaponMap: Record<string, string> = {};
    Object.entries(configMap).forEach(([characterId, config]) => {
      if (characterNames.includes(characterId) &&
        config.weaponName &&
        config.weaponName !== '无') {
        weaponMap[characterId] = config.weaponName;
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
 * @param characterNames - 角色名称列表
 * @returns 候选 Buff 状态和操作
 */
export function useCandidateBuffs(characterNames: string[]): UseCandidateBuffsReturn {
  // 候选 Buff 列表：从 ddd.candidate-buff-list.v1 回填，避免切换后变空
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
    const characters = characterNames;
    const weapons = getCharacterWeapons(characters);

    console.log('【刷新 Buff 数据】');
    console.log('搜索的角色:', characters.length > 0 ? characters.join(', ') : '无');
    console.log('角色武器配置:', weapons);

    const loadTasks: Array<{ path: string; source: string; type: 'character' | 'weapon' }> = [];

    characters.forEach((charName) => {
      if (charName) {
        loadTasks.push({
          path: `/data/characters/${charName}/${charName}buff.json`,
          source: charName,
          type: 'character',
        });
      }
    });

    characters.forEach((charName) => {
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
  }, [characterNames]);

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
