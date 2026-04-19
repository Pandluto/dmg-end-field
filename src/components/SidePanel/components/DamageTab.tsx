// DamageTab.tsx
// 伤害加成标签页内容组件 - 提供文本输入框和 Buff 陈列区

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useAppContext } from '../../../context/AppContext';
import { STORAGE_KEYS } from '../../../constants/storage-keys';
import { buildWeaponSearchIndex, searchWeapons } from '../../../utils/weaponFuzzySearch';
import {
  addSkillButtonBuff,
  getSelectedSkillButton,
} from '../../../hooks/useSkillButtonBuffs';
import { SkillButtonBuff } from '../../../types/storage';
import { getCharacterConfigMap, setStorageJson } from '../../../utils/storage';

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
/**
 * 从 sessionStorage 读取角色武器配置映射
 * 从 OperatorConfigPanel 存储的 characterConfigMap 中提取武器配置
 * @param characterNames - 角色名称数组（现在与 characterId 一致），用于过滤需要的武器配置
 * @returns 角色名到武器名的映射对象，解析失败返回空对象
 */
const getCharacterWeapons = (characterNames: string[]): Record<string, string> => {
  try {
    const configMap = getCharacterConfigMap();
    if (Object.keys(configMap).length === 0) {
      console.log('未找到角色配置数据，key: ddd.operator-config.character-input-map.v3');
      return {};
    }

    // 从配置映射中提取角色名到武器名的映射
    // 注意：characterName 现在与 characterId 一致（storage.ts 中的兼容处理）
    const weaponMap: Record<string, string> = {};
    Object.entries(configMap).forEach(([characterId, config]) => {
      // 使用 characterId 进行匹配（与 selectedCharacters 中的 name 一致）
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

  // ========== 拖拽状态管理 ==========
  // 当前是否处于长按准备阶段
  const [isLongPressPreparing, setIsLongPressPreparing] = useState(false);
  // 当前是否进入拖拽状态
  const [isDragging, setIsDragging] = useState(false);
  // 当前被拖拽的 Buff 数据
  const [draggedBuff, setDraggedBuff] = useState<BuffItem | null>(null);
  // 当前拖拽位置
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
  // 长按定时器引用
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 拖拽起始位置（用于判断是否真的在拖拽）
  const dragStartPosRef = useRef({ x: 0, y: 0 });
  // 是否已触发长按（用于区分点击和拖拽）
  const hasLongPressedRef = useRef(false);

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
   * 注意：候选 Buff 列表使用独立 key，与已选 Buff 实体表隔离
   */
  const handleRefresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const buffs = await loadAllBuffs();
      setBuffList(buffs);
      // 使用独立的候选 Buff key，避免覆盖已选 Buff 实体表
      setStorageJson(STORAGE_KEYS.CANDIDATE_BUFF_LIST, buffs);
    } catch (error) {
      console.error('刷新 Buff 列表失败:', error);
    } finally {
      setIsLoading(false);
    }
  }, [loadAllBuffs]);

  /**
 * 添加 Buff 到当前选中的技能按钮
 * 新模型：写入 buff-list 总表 + 更新 skill-button 总表的 selectedBuff
 * @param buff - Buff 数据
 */
  const addBuffToSkillButton = useCallback((buff: BuffItem) => {
    const selectedButtonId = getSelectedSkillButton();
    if (!selectedButtonId) {
      console.warn('没有选中的技能按钮，无法添加 Buff');
      return false;
    }

    // 生成完整 Buff 对象（包含所有字段）
    // buffId 由 addSkillButtonBuff 内部生成或使用传入的 id
    const newBuff: SkillButtonBuff = {
      id: '', // 占位，实际 id 由 addSkillButtonBuff 生成
      name: buff.name,
      displayName: buff.displayName,
      sourceName: buff.sourceName,
      level: buff.level,
      type: buff.type,
      value: buff.value,
      description: buff.description,
      source: buff.source,
      condition: buff.condition,
    };

    const result = addSkillButtonBuff(selectedButtonId, newBuff);
    if (!result.success) {
      console.log('Buff 添加失败:', buff.displayName);
      return false;
    }

    if (result.isDuplicate) {
      console.log('Buff 已存在:', buff.displayName);
      return true; // 幂等，返回成功
    }

    const actualBuffId = result.buffId!;
    const finalBuff = { ...newBuff, id: actualBuffId };

    console.log('添加 Buff 到技能按钮:', buff.displayName, actualBuffId);
    console.log(finalBuff);
    
    // 触发自定义事件，通知 SkillButton 弹窗刷新 Buff 列表
    // 使用实际生成的 buffId
    window.dispatchEvent(new CustomEvent('skillbutton-buff-added', { 
      detail: { buttonId: selectedButtonId, buff: finalBuff, buffId: actualBuffId } 
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

  // ========== 长按拖拽逻辑 ==========
  const LONG_PRESS_THRESHOLD = 200; // 长按阈值 200ms（与双击一致）
  const DRAG_THRESHOLD = 5; // 拖拽阈值 5px

  /**
   * 清理拖拽状态
   */
  const clearDragState = useCallback(() => {
    setIsLongPressPreparing(false);
    setIsDragging(false);
    setDraggedBuff(null);
    hasLongPressedRef.current = false;
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  /**
   * 检查点是否在 SkillButton 弹窗区域内
   * 使用 document.querySelector 查找弹窗元素
   */
  const isPointInSkillButtonModal = useCallback((x: number, y: number): boolean => {
    const modal = document.querySelector('.skill-button-modal');
    if (!modal) return false;
    const rect = modal.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }, []);

  /**
   * 处理 Buff 项鼠标按下（开始长按检测）
   */
  const handleBuffMouseDown = useCallback((buff: BuffItem, e: React.MouseEvent) => {
    // 只有左键才触发
    if (e.button !== 0) return;

    // 记录起始位置
    dragStartPosRef.current = { x: e.clientX, y: e.clientY };
    hasLongPressedRef.current = false;

    // 启动长按定时器
    longPressTimerRef.current = setTimeout(() => {
      hasLongPressedRef.current = true;
      setIsLongPressPreparing(false);
      setIsDragging(true);
      setDraggedBuff(buff);
      setDragPosition({ x: e.clientX, y: e.clientY });
    }, LONG_PRESS_THRESHOLD);

    setIsLongPressPreparing(true);
  }, []);

  /**
   * 处理鼠标移动（拖拽中）
   */
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) {
      // 如果还没进入拖拽态，检查是否移动超过阈值
      if (isLongPressPreparing && longPressTimerRef.current) {
        const dx = Math.abs(e.clientX - dragStartPosRef.current.x);
        const dy = Math.abs(e.clientY - dragStartPosRef.current.y);
        if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
          // 移动超过阈值，取消长按
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
          setIsLongPressPreparing(false);
        }
      }
      return;
    }

    // 更新拖拽位置
    setDragPosition({ x: e.clientX, y: e.clientY });
  }, [isDragging, isLongPressPreparing]);

  /**
   * 处理鼠标释放（拖拽结束）
   */
  const handleMouseUp = useCallback((e: MouseEvent) => {
    // 如果还在长按准备阶段，说明是点击而非拖拽
    if (isLongPressPreparing) {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      setIsLongPressPreparing(false);

      // 如果没有触发长按，让点击事件处理
      if (!hasLongPressedRef.current) {
        return;
      }
    }

    // 如果不在拖拽态，不处理
    if (!isDragging || !draggedBuff) {
      return;
    }

    // 检查是否在 SkillButton 弹窗区域内释放
    const isOverSkillButtonModal = isPointInSkillButtonModal(e.clientX, e.clientY);
    if (isOverSkillButtonModal) {
      // 执行添加
      addBuffToSkillButton(draggedBuff);
    }

    // 清理状态
    clearDragState();
  }, [isDragging, isLongPressPreparing, draggedBuff, isPointInSkillButtonModal, addBuffToSkillButton, clearDragState]);

  /**
   * 全局鼠标事件监听
   */
  useEffect(() => {
    if (isDragging || isLongPressPreparing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, isLongPressPreparing, handleMouseMove, handleMouseUp]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
      }
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
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
                className={`buff-item${draggedBuff?.name === buff.name ? ' is-dragging' : ''}`}
                title={buff.displayName}
                onClick={() => handleBuffClick(buff)}
                onMouseDown={(e) => handleBuffMouseDown(buff, e)}
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

      {/* 拖拽中的 Buff 跟随鼠标 */}
      {isDragging && draggedBuff && (
        <div
          className="dragging-buff-follower"
          style={{
            left: dragPosition.x,
            top: dragPosition.y,
            transform: 'translate(-50%, -50%)',
          }}
        >
          {draggedBuff.displayName}
        </div>
      )}

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
