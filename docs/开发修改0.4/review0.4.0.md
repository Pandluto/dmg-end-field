# SessionStorage 使用规范审查报告

## 审查概述
- **审查日期**: 2026-04-15
- **审查范围**: 项目中所有使用 sessionStorage 的代码
- **审查目标**: 找出不规范、不合理的用法，并提供修改建议

---

## 一、发现的 SessionStorage Key 汇总

| Key | 用途 | 所在文件 |
|-----|------|----------|
| `def.operator-config.character-config-map.v1` | 角色配置数据（武器、装备、面板等） | OperatorConfigPanel.tsx, SkillButton.tsx, DamageTab.tsx |
| `def.skill-button-buffs.v1` | 技能按钮 Buff 列表 | useSkillButtonBuffs.ts, SkillButton.tsx, DamageTab.tsx |
| `def.selected-skill-button` | 当前选中的技能按钮 ID | useSkillButtonBuffs.ts |
| `def.timeline.data.v1` | 排轴数据 | useTimelineData.ts |
| `allBuffList` | 所有 Buff 列表缓存 | DamageTab.tsx |

---

## 二、不规范/不合理问题汇总

### 问题 1: Key 命名不统一，缺乏命名空间规范

**严重程度**: 🔴 高

**描述**:
项目中使用了多种不同的 key 命名风格：
- `def.operator-config.character-config-map.v1` (规范)
- `def.skill-button-buffs.v1` (规范)
- `def.selected-skill-button` (规范)
- `def.timeline.data.v1` (规范)
- `allBuffList` (❌ 不规范，无命名空间，无版本)

**所在文件**:
- `src/components/SidePanel/components/DamageTab.tsx:275`

**当前代码**:
```typescript
sessionStorage.setItem('allBuffList', JSON.stringify(buffs));
```

**修改建议**:
```typescript
// 统一使用 DEF 命名空间 + 版本号
const ALL_BUFF_LIST_KEY = 'def.all-buff-list.v1';
sessionStorage.setItem(ALL_BUFF_LIST_KEY, JSON.stringify(buffs));
```

---

### 问题 2: 多处硬编码 Key，未集中管理

**严重程度**: 🔴 高

**描述**:
同一个 key 在多个文件中重复定义，导致维护困难，容易出错。

**重复定义的 Key**:
1. `def.operator-config.character-config-map.v1`
   - `OperatorConfigPanel.tsx:139` - 定义了 `CHARACTER_CONFIG_SESSION_KEY`
   - `SkillButton.tsx:92` - 直接硬编码
   - `DamageTab.tsx:56` - 重复定义 `CHARACTER_CONFIG_SESSION_KEY`

2. `def.skill-button-buffs.v1`
   - `useSkillButtonBuffs.ts:29` - 定义了 `SKILL_BUTTON_BUFFS_KEY`
   - `SkillButton.tsx:78` - 直接硬编码
   - `DamageTab.tsx:295` - 直接硬编码

**修改建议**:
创建一个统一的 storage-keys.ts 文件集中管理所有 key：
```typescript
// src/constants/storage-keys.ts
export const STORAGE_KEYS = {
  CHARACTER_CONFIG_MAP: 'def.operator-config.character-config-map.v1',
  SKILL_BUTTON_BUFFS: 'def.skill-button-buffs.v1',
  SELECTED_SKILL_BUTTON: 'def.selected-skill-button',
  TIMELINE_DATA: 'def.timeline.data.v1',
  ALL_BUFF_LIST: 'def.all-buff-list.v1',
} as const;
```

---

### 问题 3: 缺乏错误处理和 JSON 解析保护

**严重程度**: 🟡 中

**描述**:
部分代码在读取 sessionStorage 后直接 JSON.parse，没有 try-catch 保护，可能导致应用崩溃。

**问题代码位置**:
1. `SkillButton.tsx:79-82`
```typescript
const data = sessionStorage.getItem(key);
if (data) {
  const buttonBuffs: Record<string, SkillButtonBuff[]> = JSON.parse(data);
  // ...
}
```

2. `SkillButton.tsx:93-99`
```typescript
const data = sessionStorage.getItem(key);
if (data) {
  const configMap = JSON.parse(data);
  // ...
}
```

3. `DamageTab.tsx:66-71`
```typescript
const data = sessionStorage.getItem(CHARACTER_CONFIG_SESSION_KEY);
if (!data) {
  return {};
}
const configMap = JSON.parse(data); // 无错误处理
```

**修改建议**:
所有 JSON.parse 操作都应该有 try-catch 保护：
```typescript
const loadData = () => {
  try {
    const data = sessionStorage.getItem(key);
    if (data) {
      return JSON.parse(data);
    }
  } catch (error) {
    console.warn(`解析 sessionStorage 数据失败 [${key}]:`, error);
    // 可选：清除损坏的数据
    sessionStorage.removeItem(key);
  }
  return defaultValue;
};
```

---

### 问题 4: 数据版本管理不完善

**严重程度**: 🟡 中

**描述**:
虽然 key 中包含了版本号（如 `.v1`），但代码中没有实际的版本校验和迁移机制。当数据结构变更时，旧数据可能导致解析错误。

**当前情况**:
- 所有 key 都以 `.v1` 结尾，但没有版本检查逻辑
- 如果未来需要修改数据结构，没有迁移机制

**修改建议**:
1. 在数据存储时加入版本信息：
```typescript
interface StorageData<T> {
  version: string;
  data: T;
  timestamp: number;
}

const saveData = <T>(key: string, data: T, version: string) => {
  const storageData: StorageData<T> = {
    version,
    data,
    timestamp: Date.now(),
  };
  sessionStorage.setItem(key, JSON.stringify(storageData));
};
```

2. 读取时进行版本校验：
```typescript
const loadData = <T>(key: string, expectedVersion: string): T | null => {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed: StorageData<T> = JSON.parse(raw);
    if (parsed.version !== expectedVersion) {
      console.warn(`数据版本不匹配 [${key}]: 期望 ${expectedVersion}, 实际 ${parsed.version}`);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
};
```

---

### 问题 5: 频繁读写 sessionStorage

**严重程度**: 🟡 中

**描述**:
部分代码在每次渲染或状态变化时都写入 sessionStorage，可能影响性能。

**问题代码位置**:
1. `OperatorConfigPanel.tsx:987-989`
```typescript
React.useEffect(() => {
  writeCharacterConfigMapToSession(characterConfigMap);
}, [characterConfigMap]);
```
每次 characterConfigMap 变化都写入，可能导致频繁写入。

2. `useSkillButtonBuffs.ts:66-68`
```typescript
useEffect(() => {
  saveBuffsToStorage(buttonBuffs);
}, [buttonBuffs]);
```

**修改建议**:
1. 使用防抖（debounce）减少写入频率：
```typescript
import { useEffect, useRef } from 'react';

const useDebouncedSessionStorage = <T>(key: string, data: T, delay: number = 500) => {
  const timeoutRef = useRef<NodeJS.Timeout>();
  
  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      sessionStorage.setItem(key, JSON.stringify(data));
    }, delay);
    
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [key, data, delay]);
};
```

2. 或者在特定时机保存（如页面卸载前）：
```typescript
useEffect(() => {
  const handleBeforeUnload = () => {
    sessionStorage.setItem(key, JSON.stringify(data));
  };
  window.addEventListener('beforeunload', handleBeforeUnload);
  return () => window.removeEventListener('beforeunload', handleBeforeUnload);
}, [key, data]);
```

---

### 问题 6: 缺乏数据清理机制

**严重程度**: 🟡 中

**描述**:
代码中没有清理过期或无效数据的机制，长期运行可能导致 sessionStorage 数据累积。

**修改建议**:
1. 添加数据清理函数：
```typescript
// src/utils/storageCleanup.ts
export const cleanupStorage = () => {
  const keys = Object.keys(sessionStorage);
  const DEFKeys = keys.filter(key => key.startsWith('def.'));
  
  DEFKeys.forEach(key => {
    try {
      const data = sessionStorage.getItem(key);
      if (data) {
        const parsed = JSON.parse(data);
        // 检查是否有时间戳，超过一定时间则清理
        if (parsed.timestamp && Date.now() - parsed.timestamp > 24 * 60 * 60 * 1000) {
          sessionStorage.removeItem(key);
        }
      }
    } catch {
      // 解析失败，删除损坏的数据
      sessionStorage.removeItem(key);
    }
  });
};
```

---

### 问题 7: 类型定义分散，缺乏统一管理

**严重程度**: 🟢 低

**描述**:
存储的数据类型定义分散在各个文件中，没有统一的接口定义文件。

**问题位置**:
- `OperatorConfigPanel.tsx:112-124` - CharacterConfigJson 接口
- `useSkillButtonBuffs.ts:11-19` - SkillButtonBuff 接口
- `useTimelineData.ts` - TimelineData 类型从 types 导入

**修改建议**:
创建统一的 storage-types.ts 文件：
```typescript
// src/types/storage.ts
export interface CharacterConfigJson {
  characterId: string;
  characterName: string;
  characterPotential: string;
  skillLevelModeMap: Record<string, 'L9' | 'M3'>;
  weaponName: string;
  weaponPotentialMode: 'P0' | 'PMAX';
  equipment: EquipmentConfig;
  panelSnapshot: PanelSummary | null;
  infoSnapshot: string[];
  infoSnap: DamageBonusSnapshot;
  weaponBuffSnapshot: string[];
}

export interface SkillButtonBuff {
  id: string;
  name: string;
  displayName: string;
  sourceName: string;
  level?: string;
  type?: string;
  value?: number;
}

export interface TimelineStorageData {
  version: string;
  createdAt: number;
  updatedAt: number;
  staffLines: StaffLineData[];
}
```

---

### 问题 8: window 对象访问未做 SSR 兼容

**严重程度**: 🟢 低

**描述**:
部分代码直接访问 `window.sessionStorage`，在 SSR（服务端渲染）环境下会报错。

**当前代码**:
```typescript
// OperatorConfigPanel.tsx:286
const raw = window.sessionStorage.getItem(CHARACTER_CONFIG_SESSION_KEY);

// OperatorConfigPanel.tsx:305
window.sessionStorage.setItem(CHARACTER_CONFIG_SESSION_KEY, JSON.stringify(value));
```

**修改建议**:
使用安全的 sessionStorage 访问封装：
```typescript
// src/utils/storage.ts
const isClient = typeof window !== 'undefined';

export const safeSessionStorage = {
  getItem: (key: string): string | null => {
    if (!isClient) return null;
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key: string, value: string): void => {
    if (!isClient) return;
    try {
      sessionStorage.setItem(key, value);
    } catch (error) {
      console.warn('写入 sessionStorage 失败:', error);
    }
  },
  removeItem: (key: string): void => {
    if (!isClient) return;
    try {
      sessionStorage.removeItem(key);
    } catch {
      // ignore
    }
  },
};
```

---

### 问题 9: 重复的数据解析逻辑

**严重程度**: 🟢 低

**描述**:
多个组件中都重复编写了从 sessionStorage 读取和解析相同数据的逻辑。

**重复逻辑**:
1. 读取角色配置数据：
   - `OperatorConfigPanel.tsx:281-298`
   - `SkillButton.tsx:91-100`
   - `DamageTab.tsx:64-91`

2. 读取 Buff 数据：
   - `useSkillButtonBuffs.ts:34-44`
   - `SkillButton.tsx:77-86`
   - `DamageTab.tsx:294-297`

**修改建议**:
创建统一的 storage 工具函数：
```typescript
// src/utils/storage.ts
import { STORAGE_KEYS } from '../constants/storage-keys';
import { CharacterConfigJson, SkillButtonBuffMap } from '../types/storage';

export const storage = {
  // 角色配置
  getCharacterConfigMap: (): Record<string, CharacterConfigJson> => {
    try {
      const data = safeSessionStorage.getItem(STORAGE_KEYS.CHARACTER_CONFIG_MAP);
      return data ? JSON.parse(data) : {};
    } catch {
      return {};
    }
  },
  setCharacterConfigMap: (map: Record<string, CharacterConfigJson>) => {
    safeSessionStorage.setItem(STORAGE_KEYS.CHARACTER_CONFIG_MAP, JSON.stringify(map));
  },
  
  // Buff 数据
  getSkillButtonBuffs: (): SkillButtonBuffMap => {
    try {
      const data = safeSessionStorage.getItem(STORAGE_KEYS.SKILL_BUTTON_BUFFS);
      return data ? JSON.parse(data) : {};
    } catch {
      return {};
    }
  },
  setSkillButtonBuffs: (buffs: SkillButtonBuffMap) => {
    safeSessionStorage.setItem(STORAGE_KEYS.SKILL_BUTTON_BUFFS, JSON.stringify(buffs));
  },
  
  // 其他...
};
```

---

## 三、修改优先级建议

| 优先级 | 问题 | 原因 |
|--------|------|------|
| P0 | 问题 2: Key 硬编码 | 维护成本高，容易出错 |
| P0 | 问题 3: 缺乏错误处理 | 可能导致应用崩溃 |
| P1 | 问题 1: Key 命名不统一 | 规范性问题 |
| P1 | 问题 4: 版本管理不完善 | 数据兼容性风险 |
| P2 | 问题 5: 频繁读写 | 性能优化 |
| P2 | 问题 6: 缺乏清理机制 | 数据累积风险 |
| P3 | 问题 7: 类型定义分散 | 代码组织 |
| P3 | 问题 8: SSR 兼容 | 架构兼容性 |
| P3 | 问题 9: 重复逻辑 | 代码复用 |

---

## 四、推荐的文件结构

```
src/
├── constants/
│   └── storage-keys.ts      # 集中管理所有 storage key
├── types/
│   └── storage.ts           # 统一的 storage 类型定义
├── utils/
│   └── storage.ts           # 安全的 storage 工具函数
└── hooks/
    └── useStorage.ts        # 封装 useState + sessionStorage 的 Hook
```

---

## 五、示例代码

### 5.1 storage-keys.ts
```typescript
export const STORAGE_KEYS = {
  CHARACTER_CONFIG_MAP: 'def.operator-config.character-config-map.v1',
  SKILL_BUTTON_BUFFS: 'def.skill-button-buffs.v1',
  SELECTED_SKILL_BUTTON: 'def.selected-skill-button',
  TIMELINE_DATA: 'def.timeline.data.v1',
  ALL_BUFF_LIST: 'def.all-buff-list.v1',
} as const;

export type StorageKey = typeof STORAGE_KEYS[keyof typeof STORAGE_KEYS];
```

### 5.2 storage.ts
```typescript
import { STORAGE_KEYS } from '../constants/storage-keys';

const isClient = typeof window !== 'undefined';

export const safeSessionStorage = {
  getItem: (key: string): string | null => {
    if (!isClient) return null;
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key: string, value: string): void => {
    if (!isClient) return;
    try {
      sessionStorage.setItem(key, value);
    } catch (error) {
      console.warn(`写入 sessionStorage 失败 [${key}]:`, error);
    }
  },
  removeItem: (key: string): void => {
    if (!isClient) return;
    try {
      sessionStorage.removeItem(key);
    } catch {
      // ignore
    }
  },
};

export const storage = {
  get: <T>(key: string, defaultValue: T): T => {
    try {
      const data = safeSessionStorage.getItem(key);
      return data ? JSON.parse(data) : defaultValue;
    } catch (error) {
      console.warn(`读取 storage 失败 [${key}]:`, error);
      return defaultValue;
    }
  },
  set: <T>(key: string, value: T): void => {
    try {
      safeSessionStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.warn(`写入 storage 失败 [${key}]:`, error);
    }
  },
  remove: (key: string): void => {
    safeSessionStorage.removeItem(key);
  },
};
```

### 5.3 useStorage.ts
```typescript
import { useState, useEffect, useCallback } from 'react';
import { storage } from '../utils/storage';

export function useSessionStorage<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    return storage.get(key, initialValue);
  });

  const setValue = useCallback((value: T | ((prev: T) => T)) => {
    setState((prev) => {
      const nextValue = typeof value === 'function' 
        ? (value as (prev: T) => T)(prev) 
        : value;
      storage.set(key, nextValue);
      return nextValue;
    });
  }, [key]);

  return [state, setValue];
}
```

---

## 六、总结

本次审查发现了 9 个主要问题，其中：
- **高优先级问题 2 个**: Key 硬编码、缺乏错误处理
- **中优先级问题 3 个**: 命名不统一、版本管理不完善、频繁读写
- **低优先级问题 4 个**: 缺乏清理机制、类型定义分散、SSR 兼容、重复逻辑

建议按照优先级逐步修复，优先解决高优先级问题，以确保代码的健壮性和可维护性。

