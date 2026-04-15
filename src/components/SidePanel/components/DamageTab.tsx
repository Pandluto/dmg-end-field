// DamageTab.tsx
// 伤害加成标签页内容组件 - 提供文本输入框和 Buff 陈列区

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useAppContext } from '../../../context/AppContext';
import { buildWeaponSearchIndex, searchWeapons } from '../../../utils/weaponFuzzySearch';
import { getSelectedSkillButton, SkillButtonBuff } from '../../../hooks/useSkillButtonBuffs';

/**
 * Buff 数据项接口
 * 定义单个 Buff 的基本属性
 */
interface BuffItem {
  displayName: string; // Buff 显示名称，用于在 UI 中显示
  name: string;      // Buff 名称
  level: string; // Buff 等级，用于在 UI 中显示
  value?: number;    // Buff 数值（可选）
  type?: string;     // Buff 类型（可选）
  source: string;    // Buff 来源（角色名或武器名）
  sourceName: string; // Buff 来源名称，用于在 UI 中显示
  description: string; // Buff 描述，用于在 UI 中显示
  condition?: string; // Buff 触发条件（可选）
}


/**
 * Buff JSON 文件结构接口
 */
interface BuffData {
  buffs?: Array<{
    displayName: string; // Buff 显示名称，用于在 UI 中显示
    name: string;      // Buff 名称
    level: string; // Buff 等级，用于在 UI 中显示
    value?: number;    // Buff 数值（可选）
    type?: string;     // Buff 类型（可选）
    source: string;    // Buff 来源（角色名或武器名）
    sourceName: string; // Buff 来源名称，用于在 UI 中显示
    description: string; // Buff 描述，用于在 UI 中显示
    condition?: string; // Buff 触发条件（可选）
  }>;
}

/**
 * 角色配置接口（来自 OperatorConfigPanel）
 */
interface CharacterConfigJson {
  characterId: string;
  characterName: string;
  weaponName: string;
  // 其他字段省略
}

/**
 * sessionStorage key（与 OperatorConfigPanel 保持一致）
 */
const CHARACTER_CONFIG_SESSION_KEY = 'ddd.operator-config.character-config-map.v1';

/**
 * 从 sessionStorage 读取角色武器配置映射
 * 从 OperatorConfigPanel 存储的 characterConfigMap 中提取武器配置
 * @param characterNames - 角色名称数组，用于过滤需要的武器配置
 * @returns 角色名到武器名的映射对象，解析失败返回空对象
 */
const getCharacterWeapons = (characterNames: string[]): Record<string, string> => {
  try {
    const data = sessionStorage.getItem(CHARACTER_CONFIG_SESSION_KEY);
    if (!data) {
      console.log('未找到角色配置数据，key:', CHARACTER_CONFIG_SESSION_KEY);
      return {};
    }
    const configMap: Record<string, CharacterConfigJson> = JSON.parse(data);
    
    // 从配置映射中提取角色名到武器名的映射
    const weaponMap: Record<string, string> = {};
    Object.values(configMap).forEach((config) => {
      // 只提取当前已选角色的武器配置
      if (config.characterName && 
          characterNames.includes(config.characterName) && 
          config.weaponName && 
          config.weaponName !== '无') {
        weaponMap[config.characterName] = config.weaponName;
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

/**
 * 伤害加成标签页组件
 * 提供文本输入框和 Buff 陈列区功能
 */
export function DamageTab() {
  // 从 AppContext 获取已选角色列表
  const { state } = useAppContext();
  const { selectedCharacters } = state;
  
  // 提取角色名称列表
  const characterNames = selectedCharacters.map(char => char.name);
  
  // 文本输入框的值（受控组件）
  const [inputValue, setInputValue] = useState('');
  // Buff 列表数据
  const [buffList, setBuffList] = useState<BuffItem[]>([]);
  // 加载状态
  const [isLoading, setIsLoading] = useState(false);
  
  // 搜索关键词
  const [searchKeyword, setSearchKeyword] = useState('');
  // 抽屉是否打开
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  // 抽屉容器引用（用于点击外部关闭）
  const drawerHostRef = useRef<HTMLDivElement>(null);

  // 选中的 Buff（用于弹窗显示详情）
  const [selectedBuff, setSelectedBuff] = useState<BuffItem | null>(null);
  // 弹窗是否打开
  const [isModalOpen, setIsModalOpen] = useState(false);

  // 用于区分单击/双击的引用
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clickCountRef = useRef(0);

  /**
   * 构建 Buff 搜索索引
   * 从 buffList 中提取所有唯一的 source 值构建搜索索引
   */
  const buffSearchIndex = useMemo(() => {
    // 从 buffList 中提取所有唯一的 source 值
    const sources = Array.from(new Set(buffList.map(buff => buff.source)));
    return buildWeaponSearchIndex(sources);
  }, [buffList]);

  /**
   * 搜索匹配的 source 列表
   * 使用 searchWeapons 根据关键词搜索匹配的 source
   */
  const matchedSources = useMemo(() => {
    if (!searchKeyword.trim()) {
      return [];  // 无关键词时返回空数组
    }
    
    // 使用 searchWeapons 搜索匹配的 source
    return searchWeapons(searchKeyword, buffSearchIndex);
  }, [searchKeyword, buffSearchIndex]);

  /**
   * 获取匹配到的 Buff 列表（用于抽屉展示）
   * 根据匹配的 source 获取对应的 Buff 列表
   */
  const matchedBuffs = useMemo(() => {
    if (matchedSources.length === 0) {
      return [];
    }
    // 获取所有 source 匹配的 Buff
    return buffList.filter(buff => matchedSources.includes(buff.source));
  }, [matchedSources, buffList]);

  /**
   * 点击外部关闭抽屉
   * 监听 mousedown 事件，点击抽屉外部时关闭抽屉
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
   * 并行加载所有角色和武器的 buff.json 文件
   * @returns Promise<BuffItem[]> 合并后的 Buff 列表
   */
  const loadAllBuffs = useCallback(async (): Promise<BuffItem[]> => {
    // 从 AppContext 获取已选角色名称
    const characters = characterNames;
    // 从 sessionStorage 获取武器配置
    const weapons = getCharacterWeapons(characters);

    // 在控制台输出搜索的角色和武器信息
    console.log('【刷新 Buff 数据】');
    console.log('搜索的角色:', characters.length > 0 ? characters.join(', ') : '无');
    console.log('角色武器配置:', weapons);

    // 构造所有需要加载的文件路径
    const loadTasks: Array<{ path: string; source: string; type: 'character' | 'weapon' }> = [];

    // 添加角色 buff 文件
    characters.forEach((charName) => {
      if (charName) {
        loadTasks.push({
          path: `/data/characters/${charName}/${charName}buff.json`,
          source: charName,
          type: 'character',
        });
      }
    });

    // 添加武器 buff 文件
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

    // 并行加载所有 buff 文件
    const results = await Promise.allSettled(
      loadTasks.map(async ({ path, source, type }) => {
        try {
          const data = await loadBuffFile(path);
          console.log(`✓ 找到 ${type === 'character' ? '角色' : '武器'} buff: ${source}`);
          // 将 buffs 数组转换为 BuffItem 数组
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

    // 合并所有成功的结果
    const allBuffs: BuffItem[] = [];
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
   * 加载所有 Buff 数据并更新列表
   */
  const handleRefresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const buffs = await loadAllBuffs();
      setBuffList(buffs);
      // 存储到 sessionStorage
      sessionStorage.setItem('allBuffList', JSON.stringify(buffs));
    } catch (error) {
      console.error('刷新 Buff 列表失败:', error);
    } finally {
      setIsLoading(false);
    }
  }, [loadAllBuffs]);

  /**
   * 添加 Buff 到当前选中的技能按钮
   * @param buff - Buff 数据
   */
  const addBuffToSkillButton = useCallback((buff: BuffItem) => {
    const selectedButtonId = getSelectedSkillButton();
    if (!selectedButtonId) {
      console.warn('没有选中的技能按钮，无法添加 Buff');
      return false;
    }

    // 从 sessionStorage 读取当前 Buff 数据
    const key = 'ddd.skill-button-buffs.v1';
    const data = sessionStorage.getItem(key);
    const buttonBuffs: Record<string, SkillButtonBuff[]> = data ? JSON.parse(data) : {};
    const currentBuffs = buttonBuffs[selectedButtonId] || [];

    // 检查是否已存在
    if (currentBuffs.some(b => b.displayName === buff.displayName)) {
      console.log('Buff 已存在:', buff.displayName);
      return false;
    }

    // 添加新 Buff
    const newBuff: SkillButtonBuff = {
      id: `buff-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      displayName: buff.displayName,
      name: buff.name,
      sourceName: buff.sourceName,
      type: buff.type,
      value: buff.value,
    };

    buttonBuffs[selectedButtonId] = [...currentBuffs, newBuff];
    sessionStorage.setItem(key, JSON.stringify(buttonBuffs));

    console.log('添加 Buff 到技能按钮:', buff.displayName);
    console.log(buff);
    
    // 触发自定义事件，通知 SkillButton 弹窗刷新 Buff 列表
    window.dispatchEvent(new CustomEvent('skillbutton-buff-added', { 
      detail: { buttonId: selectedButtonId, buff: newBuff } 
    }));
    
    return true;
  }, []);

  /**
   * 处理 Buff 项点击事件
   * 用 0.2s 区分单击和双击
   * 单击：添加 Buff 到当前选中的技能按钮
   * 双击：打开弹窗显示 Buff 详细信息
   * @param buff - 被点击的 Buff 数据
   */
  const handleBuffClick = useCallback((buff: BuffItem) => {
    clickCountRef.current += 1;

    if (clickCountRef.current === 1) {
      // 第一次点击，启动定时器
      clickTimerRef.current = setTimeout(() => {
        // 0.2s 后如果没有第二次点击，视为单击
        if (clickCountRef.current === 1) {
          addBuffToSkillButton(buff);
        }
        clickCountRef.current = 0;
      }, 200);
    } else if (clickCountRef.current === 2) {
      // 第二次点击，视为双击
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      clickCountRef.current = 0;
      setSelectedBuff(buff);
      setIsModalOpen(true);
    }
  }, [addBuffToSkillButton]);

  /**
   * 关闭弹窗
   */
  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
    setSelectedBuff(null);
  }, []);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
      }
    };
  }, []);

  return (
    <div className="tab-content-damage">
      {/* 文本输入区 - 抽屉宿主 */}
      <div className="damage-input-section drawer-host" ref={drawerHostRef}>
        <input
          type="text"
          className="damage-input"
          value={inputValue}
          onChange={(e) => {
            const value = e.target.value;
            setInputValue(value);
            setSearchKeyword(value);
            setIsDrawerOpen(value.trim().length > 0);
          }}
          onFocus={() => {
            if (searchKeyword.trim().length > 0) {
              setIsDrawerOpen(true);
            }
          }}
          placeholder="输入内容"
        />
        
        {/* 下滑抽屉 - 展示匹配的 Buff displayName 列表 */}
        <div className={`damage-search-drawer${isDrawerOpen ? ' is-open' : ''}`}>
          {matchedBuffs.length > 0 ? (
            matchedBuffs.map((buff, index) => (
              <button
                key={index}
                className="damage-search-option"
                onClick={() => handleBuffClick(buff)}
              >
                {buff.displayName}
              </button>
            ))
          ) : (
            <div className="damage-search-empty">未匹配到 Buff</div>
          )}
        </div>
      </div>

      {/* 陈列区 */}
      <div className="damage-display-section">
      
        {/* Buff 列表 - 始终显示全部，不受搜索影响 */}
        <div className="buff-list">
          {buffList.length === 0 ? (
            <div className="buff-empty">点击刷新加载 Buff 数据</div>
          ) : (
            buffList.map((buff, index) => (
              <div
                key={index}
                className="buff-item"
                title={buff.displayName}
                onClick={() => handleBuffClick(buff)}
              >
                {buff.displayName}
              </div>
            ))
          )}
        </div>
        
        {/* 刷新行 */}
        <div className="refresh-row">
          <button
            className="refresh-button"
            onClick={handleRefresh}
            disabled={isLoading}
          >
            {isLoading ? '...' : '刷新'}
          </button>
        </div>
      </div>

      {/* Buff 详情弹窗 */}
      {isModalOpen && selectedBuff && (
        <div className="buff-detail-modal-overlay" onClick={handleCloseModal}>
          <div className="buff-detail-modal" onClick={e => e.stopPropagation()}>
            <h4>Buff 详情</h4>
            <div className="buff-detail-content">
              <p><strong>显示名称:</strong> {selectedBuff.displayName}</p>
              <p><strong>名称:</strong> {selectedBuff.name}</p>
              <p><strong>来源:</strong> {selectedBuff.sourceName}</p>
              <p><strong>类型:</strong> {selectedBuff.type || '无'}</p>
              <p><strong>数值:</strong> {selectedBuff.value !== undefined ? selectedBuff.value : '无'}</p>
              <p><strong>等级:</strong> {selectedBuff.level}</p>
              <p><strong>描述:</strong> {selectedBuff.description}</p>
              {selectedBuff.condition && <p><strong>条件:</strong> {selectedBuff.condition}</p>}
            </div>
            <button className="buff-detail-close-btn" onClick={handleCloseModal}>
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
